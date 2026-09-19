# ResearcherIt — multi-agent research, markdown out

Ask a topic in the Agent chat → a LangGraph team (Planner → Writer → Editor,
with Editor→Writer revision capped at `MAX_REVISIONS`) returns cited markdown
you can keep. Tokens stream live over websockets; history persists in
Postgres, checkpoints + session state in Redis.

## What's inside?

### Apps

- `apps/web` — React + Vite SPA: landing, login/signup, protected Agent chat
  (live token streaming over `/ws` with HTTP fallback, depth selector),
  profile. Bun-initialised.
- `apps/api` — TypeScript + Express: auth (email/username + Google, login
  rate-limit), conversation CRUD, agent endpoints, websocket server (`/ws`),
  Redis state. Runs on Bun.

### Packages

- `packages/db` — Prisma + Postgres schema (`User`, `Conversation`, `Message`).
  Single PrismaClient singleton imported by the api.
- `packages/agent` — LangGraph Planner→Writer→Editor graph (`runResearch` /
  `streamResearch`). Live when `OPENAI_API_KEY` + `TAVILY_API_KEY` are set;
  otherwise deterministic offline templates (labelled, never fake citations).
  Redis checkpointer (resume by thread_id) with MemorySaver fallback.
- `packages/typescript-config`, `packages/eslint-config` — shared configs.

## Prerequisites

- [Bun](https://bun.sh) 1.3+ (`bun --version`)
- [Docker + Compose](https://docs.docker.com/compose/) (`docker compose version`)
- Google OAuth client id — optional; email auth + dev fallback work without it.

## Start the project

### Option A — Docker (fastest, recommended)

```sh
cp .env.example .env
# optional: cp apps/web/.env.example apps/web/.env
# optional: cp apps/api/.env.example apps/api/.env
bun run docker:up
```

- Frontend → http://localhost:5173
- API → http://localhost:4000 (`GET /api/health`)
- Postgres → localhost:5432 · Redis → localhost:6379

The `api` service auto-runs `prisma migrate deploy` on boot, so tables exist on
first start. Other handy commands:

```sh
bun run docker:up:d   # detached
bun run docker:logs   # follow logs
bun run docker:down   # stop (keeps pgdata/redisdata volumes)
```

Demo login after seeding (see below): `demo@researcherit.local` / `password123`.

### Option B — local dev without Docker

You still need Postgres + Redis reachable (or start just those):

```sh
docker compose up postgres redis -d
bun install
cp packages/db/.env.example packages/db/.env   # DATABASE_URL with localhost
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env         # VITE_API_URL=http://localhost:4000
bun run db:deploy   # or: bun run db:migrate (creates a migration)
bun run db:seed     # optional demo user + welcome conversation
bun run dev         # turbo: api :4000 + web :5173
```

Per-app dev: `bun --filter=@researcherit/api run dev`,
`bun --filter=@researcherit/web run dev`.

## Deploy to Vercel

Live at https://researcherit.vercel.app — one Vercel project serves both the
Vite SPA (`apps/web/dist`) and the Express API as serverless functions
(`api/*`, one file per route prefix, all wrapping the same pre-bundled app).

```sh
# One-time setup
npx vercel link --project=researcherit   # run from /tmp, not the repo root
                                         # (npm chokes on the bun devEngines)
DATABASE_URL='<pooled-neon-url>' bun --filter=@repo/db run db:deploy
npx vercel env add DATABASE_URL production      # + JWT_SECRET (openssl rand
npx vercel env add JWT_SECRET production        # -hex 32), NODE_ENV=production,
npx vercel env add CORS_ORIGIN production       # GROQ_/SERPER_/OPENAI_/RESEARCH_
# … then: npx vercel deploy --prod --yes
```

Required production env: `DATABASE_URL` (Neon pooled), `NODE_ENV=production`,
`JWT_SECRET`, `CORS_ORIGIN` (the live URL), `PRISMA_QUERY_ENGINE_LIBRARY`
(`/var/task/api/.bundle/libquery_engine-rhel-openssl-3.0.x.so.node`).
Live research adds `GROQ_API_KEY` + `SERPER_API_KEY` (+ optional
`OPENAI_BASE_URL`, `RESEARCH_MODEL`); without them the pipeline runs offline
templates. Never set `VITE_API_URL` (same-origin relative fetch is correct),
`ALLOW_INSECURE_GOOGLE_DEV`, or a localhost `REDIS_URL` in prod.

How it works: `vercel.json` runs `prisma generate` →
`bun run build:vercel-api` (esbuild bundles `scripts/vercel-api-entry.ts` +
workspace TS + all npm deps into `api/.bundle/handler.cjs`, copies the Prisma
engine `.so.node` alongside) → Vite build. The bundle is needed because
Vercel's Node can't import the workspace's raw `.ts` (package exports point
at `./src/*.ts`, Bun-only) or follow Bun's isolated-store symlinks — verified
by `FUNCTION_INVOCATION_FAILED` → `ERR_REQUIRE_ESM` →
`ERR_MODULE_NOT_FOUND` before the fix. `.vercelignore` keeps local `.env`
files out of uploads (dotenv would otherwise load leaked dev keys at runtime).

Trade-offs vs Docker: raw `/ws` streaming doesn't run on serverless — the web
client falls back to HTTP automatically, so research still works end-to-end.
Long runs are capped by the 60s function `maxDuration`. Redis is omitted
(best-effort code falls back to MemorySaver / fail-open rate limits).

## Environment files

| File | Used by | Notes |
| --- | --- | --- |
| `.env.example` → `.env` | docker compose | service hostnames (`postgres`, `redis`) |
| `apps/api/.env.example` | api (local) | `localhost` URLs, `JWT_SECRET`, `GOOGLE_CLIENT_ID` |
| `apps/web/.env.example` | web (local) | `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID` |
| `packages/db/.env.example` | prisma CLI | `DATABASE_URL` for migrate/studio |
| `packages/agent/.env.example` | agent (docs) | `OPENAI_API_KEY`, `TAVILY_API_KEY`, `MAX_REVISIONS` |

Live research: set `OPENAI_API_KEY` + `TAVILY_API_KEY` (root `.env` for docker,
or `apps/api/.env` locally — the agent runs in-process with the api).
Optional: `OPENAI_BASE_URL` (compatible endpoints), `RESEARCH_MODEL`
(default `gpt-4o-mini`), `MAX_REVISIONS` (default `2`). Without keys the
pipeline still runs end-to-end on labelled offline templates.

Google login: create a **Web** OAuth client in Google Cloud Console, put the id
in `GOOGLE_CLIENT_ID` (api) + `VITE_GOOGLE_CLIENT_ID` (web). Without it, the
web hides the Google button and the api accepts decoded dev credentials only
when `ALLOW_INSECURE_GOOGLE_DEV=true` (never in production).

## API surface

- `POST /api/auth/register|login|google|logout`, `GET /api/auth/me`,
  `PATCH /api/auth/profile`, `POST /api/auth/change-password`
- `GET|POST /api/conversations`, `GET|PATCH|DELETE /api/conversations/:id`
- `POST /api/conversations/:id/messages` — chat loop (user msg → agent → markdown
  + `{ verdict, revisionCount, offline }` meta)
- `POST /api/agent/research` — first-message convenience (creates conversation)
- `GET /api/agent/info` — which graph build is running
- `WS /ws?token=<JWT>` — `{"type":"research","topic","depth?"}` →
  `node` status frames, `token` chunks, then `result`
  (`{ conversationId, markdown, verdict, revisionCount, offline }`)

## Useful Links

- [Turborepo tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Prisma docs](https://www.prisma.io/docs)
- [LangGraph docs](https://langchain-ai.github.io/langgraph/)
