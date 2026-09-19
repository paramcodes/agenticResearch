# 09 — Learnings from the production 500s + Upstash Redis

After spec 08 the app was live but the Agent page showed "internal server
error" on nearly every action. Production logs gave three distinct causes,
all fixed and verified (follow-up research, conversation open, logout →
revoked-token 401). Upstash Redis was wired in the same pass.

## Decisions

### 1. "Every 500" was nested functions missing the bundle, not app code

- Symptom from the frontend: first answer sometimes appeared, then every
  follow-up / history open failed. Logs:
  `Cannot find module '../../.bundle/handler.cjs'` from
  `api/conversations/[id].js` and `'../../../.bundle/…'` from
  `[id]/messages.js` — while top-level wrappers (`../.bundle/…`) worked.
  Vercel's per-function file tracing silently drops requires that climb out
  of nested function dirs.
- Fix: `scripts/bundle-vercel-api.mjs` now copies `handler.cjs` next to
  **every** wrapper (`api/`, `api/auth/`, `api/agent/`, `api/conversations/`,
  `api/conversations/[id]/`); wrappers require `./handler.cjs`. Same-dir
  requires are the only shape tracing includes reliably.
- Telling the two 404s/500s apart by body (spec 08 §tooling-5) is what
  located this in minutes instead of hours.

### 2. Prisma engine: self-provision to /tmp, unset the env var

- After fix 1, a new crash: `Unable to require(
  /var/task/api/.bundle/libquery_engine-….so.node)` — nothing referenced
  `api/.bundle` anymore so nft dropped the engine, and the single
  `PRISMA_QUERY_ENGINE_LIBRARY` value can't cover five different function
  dirs anyway.
- Fix: the bundle script copies the `.so.node` next to every handler copy,
  `PRISMA_QUERY_ENGINE_LIBRARY` was **removed** from `vercel env`, and
  `scripts/vercel-api-entry.ts` (`ensureEngine`) copies the sibling engine
  to `/tmp/prisma-engines/` on cold start (atomic via tmp+rename) and points
  the var at it. Safe timing: Prisma loads the engine lazily on first query,
  so setting the var at module top — after imports — is still in time.
- Proven locally first: plain `node` (not Bun), no env var, `/tmp` cleared —
  engine self-provisioned, Neon queried, login 401 as expected.

### 3. Upstash via REST (`@upstash/redis`), not RESP

- The provided credentials are REST-only: `curl …/ping` with the token
  returns `PONG`, but ioredis over `rediss://default:<token>@host:6379`
  never connects (TCP fine — auth rejected). The REST token is not a RESP
  password, so it must never go in `REDIS_URL`.
- `apps/api/src/lib/redis.ts` now has a `Kv` interface with two backends:
  `UpstashKv` (`@upstash/redis`, used when `UPSTASH_REDIS_REST_URL` +
  `_TOKEN` are set — i.e. Vercel) and `IoRedisKv` (existing lazy ioredis
  over `REDIS_URL` — local/Docker untouched). All four helpers
  (`blacklistToken`, `isTokenBlacklisted`, `setConversationStatus`,
  `checkRateLimit`) fail open exactly as before; `getRedis()` still returns
  the ioredis client or null for compatibility.
- Verified: local helper roundtrip against Upstash (blacklist → `true`,
  rate-limit increments), production logout → token reuse 401s
  ("Token revoked"), and the `[redis] ECONNREFUSED 127.0.0.1` log noise is
  gone.
- Deliberately out of scope: the LangGraph checkpointer (`RedisSaver`
  needs wire protocol **plus** RediSearch for its indexes — Upstash has
  neither). `REDIS_URL` stays unset in prod so `resolveCheckpointer` takes
  the silent MemorySaver path, which is correct for serverless
  (thread-per-run never resumes across invocations anyway).

### 4. The other two 500 sources (no code change)

- **60s Hobby timeout**: one `POST /api/agent/research` (deep) died with
  `Vercel Runtime Timeout Error: Task timed out after 60 seconds`. Only Pro
  (300s) raises this; quick/standard usually fit. Documented, not fixed.
- **Transient Neon blip**: one local smoke run failed with "Can't reach
  database server" though the same URL worked minutes before and after
  (TCP ok on retry). Retried, green — don't chase single blips.

## Tooling gotchas

- `bun run check-types` hit Turbo cache **again** after editing
  `lib/redis.ts` (reported success on stale inputs) — `--force` showed the
  real result (green). Treat any turbo green after source edits as suspect
  until forced.
- `npx vercel env rm … --yes` needs the `--yes` **after** the name (flag
  order matters); `env add` output must be grepped case-insensitively
  (`✓ Added` vs `added`) or successes look like failures.
- `vercel deploy` upload can fail with bare `fetch failed` on a ~28MB
  payload — immediate retry succeeded.
- Cleanup scripts: run inside `packages/db/` (module resolution) **with**
  the Neon `DATABASE_URL` (its local `.env` points at localhost, happily
  deleting 0 rows). Test users cascade-delete their conversations via
  Prisma `onDelete: Cascade` — verified (re-login 401s).
