import { Router } from "express";
import { z } from "zod";
import { prisma } from "@repo/db";
import { generateConversationTitle, heuristicTitle, runResearch } from "@repo/agent";
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

export function titleFromTopic(topic: string): string {
  return heuristicTitle(topic);
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
    // Newest-first windowing: page 1 holds the latest `limit` messages in
    // chronological order; higher pages prepend older ones. This keeps the
    // initial view on the newest messages no matter how long the thread is.
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);

    const convo = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { _count: { select: { messages: true } } },
    });
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const totalMessages = convo._count.messages;
    const totalPages = Math.ceil(totalMessages / limit);
    // Window into the chronological list counted back from the newest end.
    const newestCount = totalMessages - (page - 1) * limit;
    const take = Math.max(Math.min(limit, newestCount), 0);
    const skip = Math.max(newestCount - take, 0);
    const messages =
      take > 0
        ? await prisma.message.findMany({
            where: { conversationId: convo.id },
            orderBy: { createdAt: "asc" },
            skip,
            take,
          })
        : [];
    res.json({
      conversation: {
        id: convo.id,
        title: convo.title,
        status: convo.status,
        messages,
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
      },
      pagination: {
        page,
        limit,
        totalMessages,
        totalPages,
        hasMore: page < totalPages,
      },
    });
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
        title: convo.title === "New research" ? heuristicTitle(body.content) : convo.title,
      },
    });
    if (convo.title === "New research") {
      // Upgrade to an LLM title without blocking the research run.
      const quickTitle = heuristicTitle(body.content);
      void generateConversationTitle(body.content).then(async (title) => {
        if (title !== quickTitle) {
          await prisma.conversation
            .update({ where: { id: convo!.id }, data: { title } })
            .catch(() => undefined);
        }
      });
    }
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
