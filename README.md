# ResearcherIt — multi-agent research, markdown out

Ask a topic in the Agent chat → a LangGraph team (planner, searchers,
synthesizer — stub in Step 2, live in Step 3) returns markdown you can keep.
History persists in Postgres, session state in Redis.

## What's inside?

### Apps

- `apps/web` — React + Vite SPA: landing, login/signup, protected Agent chat,
  profile. Bun-initialised.
- `apps/api` — TypeScript + Express: auth (email/username + Google), conversation
  CRUD, agent endpoints, websocket server (`/ws`), Redis state. Runs on Bun.

### Packages

- `packages/db` — Prisma + Postgres schema (`User`, `Conversation`, `Message`).
  Single PrismaClient singleton imported by the api.
- `packages/agent` — LangGraph package. Step 2 ships a stub `StateGraph` with
  the final `runResearch({ topic }) → { markdown }` contract so web/api
  integrate once; Step 3 swaps in real nodes + streaming.
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

## Environment files

| File | Used by | Notes |
| --- | --- | --- |
| `.env.example` → `.env` | docker compose | service hostnames (`postgres`, `redis`) |
| `apps/api/.env.example` | api (local) | `localhost` URLs, `JWT_SECRET`, `GOOGLE_CLIENT_ID` |
| `apps/web/.env.example` | web (local) | `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID` |
| `packages/db/.env.example` | prisma CLI | `DATABASE_URL` for migrate/studio |
| `packages/agent/.env.example` | agent (Step 3) | `OPENAI_API_KEY`, `TAVILY_API_KEY` |

Google login: create a **Web** OAuth client in Google Cloud Console, put the id
in `GOOGLE_CLIENT_ID` (api) + `VITE_GOOGLE_CLIENT_ID` (web). Without it, the
web hides the Google button and the api accepts decoded dev credentials only
when `ALLOW_INSECURE_GOOGLE_DEV=true` (never in production).

## API surface

- `POST /api/auth/register|login|google|logout`, `GET /api/auth/me`,
  `PATCH /api/auth/profile`, `POST /api/auth/change-password`
- `GET|POST /api/conversations`, `GET|PATCH|DELETE /api/conversations/:id`
- `POST /api/conversations/:id/messages` — chat loop (user msg → agent → markdown)
- `POST /api/agent/research` — first-message convenience (creates conversation)
- `GET /api/agent/info` — which graph build is running
- `WS /ws?token=<JWT>` — `{"type":"research","topic"}` → status/result frames
  (coarse progress in Step 2; token stream in Step 3)

## Useful Links

- [Turborepo tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Prisma docs](https://www.prisma.io/docs)
- [LangGraph docs](https://langchain-ai.github.io/langgraph/)
