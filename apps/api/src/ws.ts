import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "@repo/db";
import { streamResearch } from "@repo/agent";
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
 * Websocket streaming endpoint (spec 02).
 * The graph streams node status + LLM token chunks; the api persists the
 * user message up front and the assistant markdown at the end, mirroring
 * the HTTP chat loop.
 *
 * Connect: ws://host:PORT/ws?token=<JWT>
 * Send:    {"type":"research","topic":"...","conversationId?":"...","depth?":"quick"|"standard"|"deep"}
 * Receive: {"type":"status","status":"connected"|"running"|"completed"|"failed",...}
 *          {"type":"node","node":"planner"|"writer"|"editor","detail?"}
 *          {"type":"token","token":"...","conversationId"}
 *          {"type":"result","conversationId","markdown","verdict","revisionCount","offline"}
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

      const result = await streamRunToClient(ws, conversationId, {
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
      send(ws, { type: "result", conversationId, markdown: result.markdown, verdict: result.verdict, revisionCount: result.revisionCount, offline: result.offline });
    } catch (err) {
      console.error("[ws] research failed:", err);
      send(ws, { type: "status", status: "failed" });
      send(ws, { type: "error", error: "Research failed, please try again" });
    }
  }

  console.log("[ws] listening on /ws");
}

/** Fan the agent's async-generator events out as ws frames. Resolves with
 *  the final result so the caller can persist it. */
async function streamRunToClient(
  ws: WebSocket,
  conversationId: string,
  input: { topic: string; conversationId: string; depth: "quick" | "standard" | "deep" },
): Promise<{ markdown: string; verdict: string; revisionCount: number; offline: boolean }> {
  let final: { markdown: string; verdict: string; revisionCount: number; offline: boolean } | null = null;
  for await (const event of streamResearch(input)) {
    if (event.type === "status") {
      send(ws, { type: "node", node: event.node, detail: event.detail, conversationId });
    } else if (event.type === "token") {
      send(ws, { type: "token", token: event.token, conversationId });
    } else {
      final = event.result;
    }
  }
  if (!final) throw new Error("Research stream ended without a result");
  return final;
}
