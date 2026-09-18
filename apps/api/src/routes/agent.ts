import { Router } from "express";
import { z } from "zod";
import { prisma } from "@repo/db";
import { agentInfo, generateConversationTitle, heuristicTitle, runResearch } from "@repo/agent";
import { asyncHandler, requireAuth } from "../middleware/auth.js";

const router: Router = Router();

router.get("/info", (_req, res) => {
  res.json({ agent: agentInfo });
});

// Convenience endpoint: create-or-reuse a conversation and run research.
// The Agent page uses this for the first message (no conversation yet).
router.post(
  "/research",
  requireAuth,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      topic: z.string().min(1).max(8000),
      conversationId: z.string().optional(),
      depth: z.enum(["quick", "standard", "deep"]).default("standard"),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.flatten().fieldErrors });
        return;
      }
      throw err;
    }

    let convo =
      body.conversationId != null
        ? await prisma.conversation.findFirst({
            where: { id: body.conversationId, userId: req.user!.id },
          })
        : null;
    if (!convo) {
      const quickTitle = heuristicTitle(body.topic);
      convo = await prisma.conversation.create({
        data: {
          userId: req.user!.id,
          title: quickTitle,
          status: "running",
        },
      });
      // Upgrade to an LLM title without blocking the research run.
      void generateConversationTitle(body.topic).then(async (title) => {
        if (title !== quickTitle) {
          await prisma.conversation
            .update({ where: { id: convo!.id }, data: { title } })
            .catch(() => undefined);
        }
      });
    } else {
      await prisma.conversation.update({ where: { id: convo.id }, data: { status: "running" } });
    }

    const userMessage = await prisma.message.create({
      data: { conversationId: convo.id, role: "user", content: body.topic },
    });
    try {
      const result = await runResearch({
        topic: body.topic,
        conversationId: convo.id,
        depth: body.depth,
      });
      const assistantMessage = await prisma.message.create({
        data: { conversationId: convo.id, role: "assistant", content: result.markdown },
      });
      await prisma.conversation.update({ where: { id: convo.id }, data: { status: "completed" } });
      res.status(201).json({ conversationId: convo.id, userMessage, assistantMessage, meta: { verdict: result.verdict, revisionCount: result.revisionCount, offline: result.offline } });
    } catch (err) {
      console.error("[agent] research failed:", err);
      await prisma.conversation.update({ where: { id: convo.id }, data: { status: "failed" } });
      res.status(500).json({ error: "Research failed, please try again", conversationId: convo.id, userMessage });
    }
  }),
);

export default router;
