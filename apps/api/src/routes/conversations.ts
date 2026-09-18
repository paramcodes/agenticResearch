import { Router } from "express";
import { z } from "zod";
import { prisma } from "@repo/db";
import { runResearch } from "@repo/agent";
import { setConversationStatus } from "../lib/redis.js";
import { asyncHandler, requireAuth } from "../middleware/auth.js";

const router: Router = Router();
router.use(requireAuth);

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

const messageSchema = z.object({
  content: z.string().min(1).max(8000),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
});

function titleFromTopic(topic: string): string {
  const t = topic.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 60)}…` : t || "New research";
}

// List own conversations (no message bodies — keeps sidebar fast)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const convos = await prisma.conversation.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { _count: { select: { messages: true } } },
    });
    res.json({
      conversations: convos.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        messageCount: c._count.messages,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = createSchema.parse(req.body ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed" });
        return;
      }
      throw err;
    }
    const convo = await prisma.conversation.create({
      data: { userId: req.user!.id, title: body.title ?? "New research" },
    });
    res.status(201).json({ conversation: convo });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const convo = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ conversation: convo });
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { title } = z.object({ title: z.string().min(1).max(200) }).parse(req.body);
    const convo = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const updated = await prisma.conversation.update({
      where: { id: convo.id },
      data: { title },
    });
    res.json({ conversation: updated });
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const convo = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    await prisma.conversation.delete({ where: { id: convo.id } });
    res.json({ ok: true });
  }),
);

/**
 * POST /api/conversations/:id/messages — the Step-2 chat loop.
 * Saves the user message, runs the agent (stub graph for now), saves the
 * assistant markdown reply. Synchronous (no streaming yet) — the frontend
 * shows a progress bar while awaiting this response.
 */
router.post(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = messageSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.flatten().fieldErrors });
        return;
      }
      throw err;
    }
    const convo = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const userMessage = await prisma.message.create({
      data: { conversationId: convo.id, role: "user", content: body.content },
    });
    await prisma.conversation.update({
      where: { id: convo.id },
      data: {
        status: "running",
        title: convo.title === "New research" ? titleFromTopic(body.content) : convo.title,
      },
    });
    await setConversationStatus(convo.id, "running");

    try {
      const result = await runResearch({
        topic: body.content,
        conversationId: convo.id,
        depth: body.depth,
      });
      const assistantMessage = await prisma.message.create({
        data: { conversationId: convo.id, role: "assistant", content: result.markdown },
      });
      await prisma.conversation.update({
        where: { id: convo.id },
        data: { status: "completed" },
      });
      await setConversationStatus(convo.id, "completed");
      res.status(201).json({ userMessage, assistantMessage, meta: { verdict: result.verdict, revisionCount: result.revisionCount, offline: result.offline } });
    } catch (err) {
      console.error("[agent] research failed:", err);
      await prisma.conversation.update({
        where: { id: convo.id },
        data: { status: "failed" },
      });
      await setConversationStatus(convo.id, "failed");
      res.status(500).json({ error: "Research failed, please try again", userMessage });
    }
  }),
);

export default router;
