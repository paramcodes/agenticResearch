import { Redis as IoRedis } from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { config } from "../env.js";

// Best-effort key-value layer. The API must keep serving auth/CRUD even when
// Redis is down (local dev without docker), so every helper catches and
// returns a safe default instead of throwing.
//
// Two backends, same helper API:
// - Upstash REST (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) —
//   for serverless, where a persistent RESP connection per invocation is
//   wasteful and Upstash REST tokens don't work as RESP passwords anyway.
// - ioredis over `REDIS_URL` — local dev + Docker (redis-stack).
// Neither backend failing may break a request: all helpers fail open.

interface Kv {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, exSeconds?: number): Promise<void>;
  incr(k: string): Promise<number>;
  expire(k: string, seconds: number): Promise<void>;
}

class IoRedisKv implements Kv {
  constructor(readonly client: IoRedis) {}
  async get(k: string): Promise<string | null> {
    return this.client.get(k);
  }
  async set(k: string, v: string, exSeconds?: number): Promise<void> {
    if (exSeconds != null) await this.client.set(k, v, "EX", exSeconds);
    else await this.client.set(k, v);
  }
  async incr(k: string): Promise<number> {
    return this.client.incr(k);
  }
  async expire(k: string, seconds: number): Promise<void> {
    await this.client.expire(k, seconds);
  }
}

class UpstashKv implements Kv {
  constructor(private readonly client: UpstashRedis) {}
  async get(k: string): Promise<string | null> {
    const v: unknown = await this.client.get(k);
    return typeof v === "string" ? v : v == null ? null : String(v);
  }
  async set(k: string, v: string, exSeconds?: number): Promise<void> {
    if (exSeconds != null) await this.client.set(k, v, { ex: exSeconds });
    else await this.client.set(k, v);
  }
  async incr(k: string): Promise<number> {
    return this.client.incr(k);
  }
  async expire(k: string, seconds: number): Promise<void> {
    await this.client.expire(k, seconds);
  }
}

let kv: Kv | null | undefined;

function getKv(): Kv | null {
  if (kv !== undefined) return kv;
  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (restUrl && restToken) {
    kv = new UpstashKv(new UpstashRedis({ url: restUrl, token: restToken }));
    return kv;
  }
  try {
    const client = new IoRedis(config.redisUrl, {
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
    kv = new IoRedisKv(client);
    return kv;
  } catch (err) {
    console.warn("[redis] init failed (continuing without cache):", (err as Error).message);
    kv = null;
    return kv;
  }
}

/** Legacy accessor (ioredis client or null). Prefer the helpers above. */
export function getRedis(): IoRedis | null {
  const backend = getKv();
  return backend instanceof IoRedisKv ? backend.client : null;
}

export async function blacklistToken(token: string, ttlSeconds: number): Promise<void> {
  try {
    const r = getKv();
    if (!r) return;
    await r.set(`bl:${token}`, "1", ttlSeconds);
  } catch {
    // ignore — logout still succeeds, token just stays valid until expiry
  }
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const r = getKv();
    if (!r) return false;
    const v = await r.get(`bl:${token}`);
    return v === "1";
  } catch {
    return false;
  }
}

export async function setConversationStatus(conversationId: string, status: string, ttlSeconds = 3600): Promise<void> {
  try {
    const r = getKv();
    if (!r) return;
    await r.set(`conv:${conversationId}:status`, status, ttlSeconds);
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
    const r = getKv();
    if (!r) return true;
    const full = `rl:${key}`;
    const count = await r.incr(full);
    if (count === 1) await r.expire(full, windowSeconds);
    return count <= limit;
  } catch {
    return true;
  }
}
