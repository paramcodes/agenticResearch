# AGENTS.md — how to work in this repo

Monorepo: Turborepo + Bun workspaces (`apps/*`, `packages/*`).
Stack: React/Vite web · Express api (Bun runtime) · Prisma/Postgres (`@repo/db`)
· Redis (ioredis, best-effort) · LangGraph (`@repo/agent`, stub until Step 3).

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
- `packages/agent/.env` ← `packages/agent/.env.example` (Step-3 LLM keys)

## Commands

- `bun install` — install all workspaces (bun 1.3+)
- `bun run dev | build | lint | check-types` — turbo across workspaces
- `bun run db:generate|db:migrate|db:deploy|db:seed` — prisma via `@repo/db`
- `bun --filter=@researcherit/api run dev` / `bun --filter=@researcherit/web run dev`

## Conventions

- DB changes: edit `packages/db/prisma/schema.prisma`, then
  `bun run db:migrate`. Api imports `prisma` from `@repo/db` — never new-up a
  second client.
- Agent changes: keep `runResearch(input) → { markdown, sources }` in
  `packages/agent/src/index.ts` stable. Real graph + Redis checkpointer land
  in Step 3; `/ws` protocol in `apps/api/src/ws.ts` already matches it.
- Auth: JWT Bearer (`apps/api/src/lib/jwt.ts`), `requireAuth` middleware,
  Google verify in `lib/google.ts` (dev fallback only with
  `ALLOW_INSECURE_GOOGLE_DEV=true`, never prod). Redis token blacklist +
  `conv:<id>:status` are best-effort — api must boot without Redis.
- Web: token in `localStorage`, `src/lib/api.ts` wrapper, `ProtectedRoute`
  for `/agent` + `/profile`. Agent page uses HTTP in Step 2; don't build WS
  UI until the graph streams.
- Docker: api `Dockerfile` target `dev` runs `bun --hot` + `prisma migrate
  deploy` on boot; web `Dockerfile` bakes `VITE_*` at build time — changing
  them needs `docker compose up --build`.
- Verify before claiming done: `bun run check-types`, `bun run build`,
  `docker compose config`, and boot the stack if you touched runtime code.
