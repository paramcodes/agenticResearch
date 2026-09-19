# AGENTS.md — how to work in this repo

Monorepo: Turborepo + Bun workspaces (`apps/*`, `packages/*`).
Stack: React/Vite web · Express api (Bun runtime) · Prisma/Postgres (`@repo/db`)
· Redis (ioredis best-effort + redis-stack for the graph checkpointer)
· LangGraph 0.4 Planner→Writer→Editor (`@repo/agent`).

## Start the project

```sh
cp .env.example .env
bun run docker:up        # postgres + redis + api (:4000) + web (:5173)
bun run docker:logs      # follow logs
bun run docker:down      # stop, keep volumes
```

Local (no docker images for node): `docker compose up postgres redis -d`,
then `bun install && bun run db:deploy && bun run dev`.
Seed demo user: `bun run db:seed` (`demo@researcherit.local` / `password123`).

## Env files (never commit `.env`)

- Root `.env` ← `.env.example` (compose; hostnames `postgres`/`redis`)
- `apps/api/.env` ← `apps/api/.env.example` (localhost URLs for local dev)
- `apps/web/.env` ← `apps/web/.env.example` (`VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`)
- `packages/db/.env` ← `packages/db/.env.example` (`DATABASE_URL` for CLI)
- `packages/agent/.env` ← `packages/agent/.env.example` (docs only; agent runs
  in-process with the api — set `OPENAI_*`/`TAVILY_*`/`MAX_REVISIONS` on the api)

## Commands

- `bun install` — install all workspaces (bun 1.3+)
- `bun run dev | build | lint | check-types` — turbo across workspaces
- `bun run db:generate|db:migrate|db:deploy|db:seed` — prisma via `@repo/db`
- `bun --filter=@researcherit/api run dev` / `bun --filter=@researcherit/web run dev`

## Conventions

- DB changes: edit `packages/db/prisma/schema.prisma`, then
  `bun run db:migrate`. Api imports `prisma` from `@repo/db` — never new-up a
  second client.
- Agent changes: keep `runResearch(input)` / `streamResearch(input)` in
  `packages/agent/src/index.ts` stable. Chart policy: writer may emit ONE
  ```mermaid block (exact xychart-beta/pie syntax in the prompt) only when
  asked, data from cited sources only; never `![](url)` image markdown, never
  prose about nonexistent figures (editor strips both). Graph lives in `src/graph.ts`
  (Planner→Writer→Editor, revise cap `MAX_REVISIONS`); search in `src/search.ts`
  (Tavily, offline mocks use `example.invalid` — never invent real citations);
  checkpointer in `resolveCheckpointer` (Redis via patched 0.0.3 saver, else
  MemorySaver). Thread per run: `conv:<id>:<rand>`; resume via
  `getResearchState(threadId)`. `/ws` streams node/token/result frames.
- Auth: JWT Bearer (`apps/api/src/lib/jwt.ts`), `requireAuth` middleware,
  login/register rate-limit (`checkRateLimit`, fail-open without Redis),
  Google verify in `lib/google.ts` (dev fallback only with
  `ALLOW_INSECURE_GOOGLE_DEV=true`, never prod). Redis token blacklist +
  `conv:<id>:status` are best-effort — api must boot without Redis.
- Web: token in `localStorage`, `src/lib/api.ts` wrapper (`streamResearch`
  over `/ws` with HTTP fallback), `ProtectedRoute` for `/agent` + `/profile`.
  Depth selector sends quick/standard/deep (search breadth + writer scope).
  `Markdown.tsx` renders ```mermaid fences to SVG (lazy import, strict mode,
  code fallback); `Agent.tsx` persists a collapsed trace from response meta
  for HTTP-path runs (`stepsFromMeta`) since `/ws` frames never arrive there.
- Docker: api `Dockerfile` target `dev` runs `bun --hot` + `prisma migrate
  deploy` on boot; web `Dockerfile` bakes `VITE_*` at build time — changing
  them needs `docker compose up --build`.
- Vercel (live: https://researcherit.vercel.app, specs 08–09): single project,
  web static + Express via `api/*` serverless wrappers around the esbuild
  bundle (`bun run build:vercel-api` → `handler.cjs` + Prisma engine copied
  next to every wrapper; entry self-provisions the engine to
  `/tmp/prisma-engines` on cold start — never set
  `PRISMA_QUERY_ENGINE_LIBRARY` in `vercel env`). One file per route prefix
  — top-level `api/[...all]` only matches one segment, so `auth/*`,
  `agent/*`, `conversations/*`, `[id]/messages` each get their own entry.
  Redis in prod is Upstash REST (`UPSTASH_REDIS_REST_URL`/`_TOKEN`, via
  `@upstash/redis` in `lib/redis.ts` — the REST token is not a RESP
  password); no `REDIS_URL` (checkpointer needs RediSearch, falls back to
  MemorySaver). Never upload `.env` (`.vercelignore`); set secrets via
  `vercel env`. Never set `VITE_API_URL` (same-origin), `ALLOW_INSECURE_*`,
  or localhost `REDIS_URL` in prod. Run `npx vercel` from /tmp — npm inside
  the repo chokes on the bun devEngines.
- Verify before claiming done: `bun run check-types`, `bun run build`,
  `docker compose config`, and boot the stack if you touched runtime code.
