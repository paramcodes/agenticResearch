import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "node:http";
import { config } from "./env.js";
import { errorHandler } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import conversationRoutes from "./routes/conversations.js";
import agentRoutes from "./routes/agent.js";
import { attachWs } from "./ws.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "api", env: config.nodeEnv }),
);

app.use("/api/auth", authRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/agent", agentRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const server = createServer(app);
attachWs(server);

server.listen(config.port, () => {
  console.log(`[api] listening on :${config.port} (${config.nodeEnv})`);
});
