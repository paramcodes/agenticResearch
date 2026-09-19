# 08 — Learnings from the Vercel deployment

Deployed the monorepo to a single Vercel project (live:
https://researcherit.vercel.app): Vite SPA as static output + the Express api
as serverless functions, Neon Postgres, Groq + Serper for live research.
Verified end-to-end on production: register → `POST /api/agent/research`
(live run, verdict `approved`, 4.8k chars cited markdown) → login 401 on bad
password → test user deleted. Decisions and traps below.

## Decisions

### 1. One Vercel project, not two (web + api)

- `vercel.json` at root: `outputDirectory: apps/web/dist`, serverless
  functions from `api/*`. Same origin for frontend and api, so `VITE_API_URL`
  stays **unset** — the web client falls back to relative `/api/…` fetches
  (see `apps/web/src/lib/api.ts`). No CORS configuration needed in practice
  (`CORS_ORIGIN` is still set to the live URL for correctness).
- Alternative considered (separate Vercel projects for web/api) was rejected:
  two URLs to keep in sync, CORS preflights on every JSON POST, and
  `VITE_API_URL` baked at build time pointing at a moving target.

### 2. Express app extracted to `apps/api/src/app.ts`

- `app.ts` owns all middleware + route mounting and exports the app with zero
  side effects (no `listen()`, no WebSocket attach), so both the long-running
  server and the serverless entries can import it.
- `apps/api/src/index.ts` keeps `createServer` + `attachWs` + `listen`, but
  skips both when `VERCEL=1`. The web client already falls back from `/ws`
  to plain HTTP (`streamResearch` rejects → `runHttp`), so realtime token
  streaming degrades gracefully to request/response on serverless.
- Verified locally that the refactor didn't change dev/Docker behavior:
  `PORT=4123 start` still serves `/api/health` + `/health`, `bun run
  check-types` green, `docker compose config` clean.

### 3. One serverless file per route prefix — no top-level catch-all

- First attempt: `api/index.ts` + `api/[...all].ts`. Result: `/api/x`
  (one segment) reached Express, `/api/x/y` (two+) got Vercel router 404
  (`x-vercel-error: NOT_FOUND`, function never invoked). The catch-all only
  matched a single segment in this project setup.
- Fix: explicit entries per Express mount — `api/health.ts`,
  `api/auth/[...all].ts` + `api/auth/index.ts`, same pair for `agent`,
  `api/conversations/index.ts`, `api/conversations/[id].ts`,
  `api/conversations/[id]/messages.ts`. Single-segment dynamic routes are the
  mechanism proven to work; `:id/messages` gets its own file because it is
  two segments under its prefix.
- The stray `api/entry.ts` (esbuild source) briefly became a live
  `/api/entry` function — build-only sources must live outside `api/`
  (now `scripts/vercel-api-entry.ts`).

### 4. esbuild self-contained bundle (`bun run build:vercel-api`)

- Runtime failures, in order: `FUNCTION_INVOCATION_FAILED` →
  `ERR_REQUIRE_ESM` (Vercel compiles `api/*` to CJS, workspace is ESM
  `"type": "module"`) → `ERR_MODULE_NOT_FOUND:
  …/node_modules/@repo/db/src/index.ts` after switching to dynamic import.
- Root cause, deeper than symlinks: workspace packages export **raw `.ts`**
  (`"exports": {".": "./src/index.ts"}`, `allowImportingTsExtensions`). Even
  with perfect file tracing, Vercel's Node 22 cannot import `.ts` without a
  loader; and Bun's isolated-store symlinks don't survive nft tracing.
- So `scripts/bundle-vercel-api.mjs` bundles `scripts/vercel-api-entry.ts` +
  all workspace TS + all npm deps into one CJS file
  (`api/.bundle/handler.cjs`, ~5.5MB). Every `api/*.ts` entry is a 5-line
  `require("./.bundle/handler.cjs")` wrapper, which nft traces as a single
  relative file — no `node_modules` resolution at runtime at all.
- `esbuild` added as a root devDependency (hence the `bun.lock` change).

### 5. Prisma engine: copy + `PRISMA_QUERY_ENGINE_LIBRARY`

- The generated client + `libquery_engine-rhel-openssl-3.0.x.so.node` live in
  the Bun store and reference each other via bundler annotations
  (`path.join(__dirname, …)`), which break once bundled. The runtime honors
  `PRISMA_QUERY_ENGINE_LIBRARY`, so the bundle script copies the `.so.node`
  next to `handler.cjs` and the var points at
  `/var/task/api/.bundle/libquery_engine-rhel-openssl-3.0.x.so.node` in prod.
- Gotcha: Vercel exposes prod env to the **build** too, and `prisma
  generate` aborts when the var points at a path that doesn't exist yet in
  the build container. Fix: `env -u PRISMA_QUERY_ENGINE_LIBRARY` for the
  generate step only (`vercel.json` buildCommand).
- The whole chain was proven **before** deploying by running the bundle
  under plain `node` (not Bun) against Neon: `/api/health` 200 + bad-login
  401 (real DB roundtrip). Always smoke-test the bundle this way — it catches
  engine/path issues in seconds instead of deploy cycles.

### 6. `.vercelignore`: never upload local `.env`

- Mid-verify surprise: a research run returned `offline: False` with live
  content although no LLM/search keys were set in `vercel env`. Cause: the
  first deployments uploaded root `.env` (which holds `GROQ_API_KEY` +
  `SERPER_API_KEY`), and `dotenv/config` loaded it at runtime.
- Fix: `.vercelignore` excludes `.env`, `.env*.local`, `api/.bundle`
  (regenerated every build — uploading the local 23MB copy wastes time and
  risks a stale engine), `.turbo`, logs. Secrets now live only in
  `vercel env` (copied once from local `.env`: Groq, Serper, base URL,
  model). Deliberately **not** promoted: `VITE_API_URL` (would break
  same-origin fetch), `ALLOW_INSECURE_GOOGLE_DEV` (dev-only Google fallback,
  never prod), localhost `REDIS_URL` (best-effort code fails open; a bogus
  URL just burns connect timeouts).

### 7. Neon over the pooler, migrate from local

- `DATABASE_URL` = Neon **pooled** URL (works for both the serverless
  functions and the one-off `bun --filter=@repo/db run db:deploy`, which
  applied both migrations cleanly over the pooler).
- New env vars only take effect on the **next** deployment: order was
  deploy → read live URL → set `CORS_ORIGIN` → redeploy.

## Tooling gotchas (Vercel CLI + this repo)

1. **Run `npx vercel` from /tmp, never the repo root.** npm reads root
   `package.json` devEngines (`bun 1.3.4`) and dies with `EBADDEVENGINES`;
   pass `--cwd=/home/param/Documents/ai-projects/researcherit` instead.
   (This also bit `env add` in a loop that `cd`'d into the repo first.)
2. **Shell env doesn't persist between tool calls** — the token had to be
   inlined (`--token='…'`) on every invocation.
3. **`vercel link` litters**: creates `.env.local` (gitignored, fine) and
   appends a sloppy `.env*` rule to `.gitignore` (reverted — it would shadow
   `.env.example`; `.env.local` was already covered).
4. **Direct deployment URLs sit behind SSO** (`302 → vercel.com/sso-api`)
   while the alias is public. When verifying, always curl the alias
   (`researcherit.vercel.app`); a 302 on the `*.vercel.app` host means
   Deployment Protection, not a broken app.
5. **Distinguish Express-404 from router-404 by body**: `{"error":"Not
   found"}` = reached Express (route/method unknown); `The page could not
   be found / NOT_FOUND` + `x-vercel-error` header = Vercel routing never
   invoked a function.
6. **Cleanup scripts must run inside the workspace with the prod URL.**
   A script in /tmp resolved a stray global `@prisma/client`; one in
   `packages/db/` without `DATABASE_URL` happily deleted 0 rows from the
   **local** DB. Test-user deletion needed `DATABASE_URL=<neon> bun
   cleanup-tmp.mjs` from `packages/db/` (script deleted afterwards).
7. **`functions.maxDuration: 60`** on all api entries (research is the
   long pole; Hobby caps at 60s). A run exceeding it surfaces as a 500 —
   acceptable, documented in README.
