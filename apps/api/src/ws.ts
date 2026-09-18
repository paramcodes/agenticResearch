import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "@repo/db";
import { runResearch } from "@repo/agent";
import { verifyToken } from "./lib/jwt.js";
import { isTokenBlacklisted, setConversationStatus } from "./lib/redis.js";

interface ClientMsg {
  type: string;
  token?: string;
  topic?: string;
  conversationId?: string;
  depth?: "quick" | "standard" | "deep";
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(payload));
}

/**
 * Websocket endpoint for future streaming (Step 3).
 * Step 2: speaks the same protocol, but progress events are coarse
 * (received -> running -> done) since the stub graph has no token stream.
 * The React frontend uses HTTP for now; this stays ready for the swap.
 *
 * Connect: ws://host:PORT/ws?token=<JWT>
 * Send:    {"type":"research","topic":"...","conversationId?":"..."}
 * Receive: {"type":"status","status":"running"|"completed"|"failed",...}
 *          {"type":"result","conversationId","markdown"}
 *          {"type":"error","error":"..."}
 */
export function attachWs(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const token = url.searchParams.get("token") ?? "";
    let userId: string | null = null;
    const pending: string[] = [];

    // Attach synchronously — anything arriving during async auth is queued,
    // otherwise a client that sends on `open` loses its first frame.
    ws.on("message", (raw) => {
      const text = String(raw);
      if (!userId) {
        pending.push(text);
        return;
      }
      void handleMessage(ws, userId, text);
    });

    void (async () => {
      try {
        if (!token || (await isTokenBlacklisted(token)))
          throw new Error("unauthorized");
        const sub = verifyToken(token).sub;
        const user = await prisma.user.findUnique({ where: { id: sub } });
        if (!user) throw new Error("unauthorized");
        userId = sub;
      } catch {
        send(ws, {
          type: "error",
          error: "Unauthorized: provide ?token=<JWT>",
        });
        ws.close(4401, "Unauthorized");
        return;
      }

      send(ws, { type: "status", status: "connected" });
      const queued = pending.splice(0);
      for (const text of queued) {
        if (userId) await handleMessage(ws, userId, text);
      }
    })();
  });
  async function handleMessage(ws: WebSocket, userId: string, text: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(text) as ClientMsg;
    } catch {
      send(ws, { type: "error", error: "Invalid JSON" });
      return;
    }
    if (msg.type === "ping") {
      send(ws, { type: "pong" });
      return;
    }
    if (msg.type !== "research" || !msg.topic?.trim()) {
      send(ws, {
        type: "error",
        error: 'Send {"type":"research","topic":"..."}',
      });
      return;
    }

    try {
      send(ws, { type: "status", status: "running", progress: 0.1 });
      let convo =
        msg.conversationId != null
          ? await prisma.conversation.findFirst({
              where: { id: msg.conversationId, userId },
            })
          : null;
      if (!convo) {
        const t = msg.topic.trim().replace(/\s+/g, " ");
        convo = await prisma.conversation.create({
          data: {
            userId,
            title: t.length > 60 ? `${t.slice(0, 60)}…` : t,
            status: "running",
          },
        });
      }
      const conversationId = convo.id;
      await prisma.message.create({
        data: { conversationId, role: "user", content: msg.topic },
      });
      await setConversationStatus(conversationId, "running");
      send(ws, {
        type: "status",
        status: "running",
        progress: 0.5,
        conversationId,
      });

      const result = await runResearch({
        topic: msg.topic,
        conversationId,
        depth: msg.depth ?? "standard",
      });
      await prisma.message.create({
        data: { conversationId, role: "assistant", content: result.markdown },
      });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "completed" },
      });
      await setConversationStatus(conversationId, "completed");
      send(ws, {
        type: "status",
        status: "completed",
        progress: 1,
        conversationId,
      });
      send(ws, { type: "result", conversationId, markdown: result.markdown });
    } catch (err) {
      console.error("[ws] research failed:", err);
      send(ws, { type: "status", status: "failed" });
      send(ws, { type: "error", error: "Research failed, please try again" });
    }
  }

  console.log("[ws] listening on /ws");
}
