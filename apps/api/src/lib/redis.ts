import { Redis } from "ioredis";
import { config } from "../env.js";

// Best-effort Redis client. The API must keep serving auth/CRUD even when
// Redis is down (local dev without docker), so every helper catches and
// returns null instead of throwing.
let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;
  try {
    client = new Redis(config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    client.on("error", (err) => {
      console.warn("[redis] connection error (continuing without cache):", err.message);
    });
    client.connect().catch((err) => {
      console.warn("[redis] connect failed (continuing without cache):", err.message);
    });
    return client;
  } catch (err) {
    console.warn("[redis] init failed (continuing without cache):", (err as Error).message);
    return null;
  }
}

export async function blacklistToken(token: string, ttlSeconds: number): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    await r.set(`bl:${token}`, "1", "EX", ttlSeconds);
  } catch {
    // ignore — logout still succeeds, token just stays valid until expiry
  }
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const r = getRedis();
    if (!r) return false;
    const v = await r.get(`bl:${token}`);
    return v === "1";
  } catch {
    return false;
  }
}

export async function setConversationStatus(conversationId: string, status: string, ttlSeconds = 3600): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    await r.set(`conv:${conversationId}:status`, status, "EX", ttlSeconds);
  } catch {
    // ignore
  }
}

/**
 * Fixed-window rate limit. Returns true when the caller is within budget.
 * Best-effort like everything else here: if Redis is down we allow the
 * request (fail-open) so local dev without docker keeps working.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const r = getRedis();
    if (!r) return true;
    const full = `rl:${key}`;
    const count = await r.incr(full);
    if (count === 1) await r.expire(full, windowSeconds);
    return count <= limit;
  } catch {
    return true;
  }
}
