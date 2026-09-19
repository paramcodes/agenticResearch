import { createServer } from "node:http";
import { app } from "./app.js";
import { config } from "./env.js";
import { attachWs } from "./ws.js";

// Long-running server: local dev (`bun run dev`) + Docker.
// On Vercel the Express app (apps/api/src/app.ts) runs pre-bundled inside
// the serverless functions (see scripts/bundle-vercel-api.mjs) — no listen(),
// no raw WebSocket server there. The web client already falls back to plain
// HTTP when /ws is unreachable, so realtime token streaming degrades
// gracefully to request/response on serverless.
const server = createServer(app);

if (process.env.VERCEL !== "1") {
  attachWs(server);
}

if (process.env.VERCEL !== "1") {
  server.listen(config.port, () => {
    console.log(`[api] listening on :${config.port} (${config.nodeEnv})`);
  });
}

export default server;
