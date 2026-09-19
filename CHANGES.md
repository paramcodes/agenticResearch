# Changes

User-facing changelog, newest first. Each entry maps to one commit on `main`.

## 2026-09-19 — `2a8eddc` — Fixed production 500s, Upstash Redis live

- Follow-up messages and conversation history no longer 500: every
  serverless wrapper dir now ships its own copy of the API bundle + Prisma
  engine (per-function file tracing dropped the shared `../.bundle`
  requires), and the engine self-provisions to `/tmp` on cold start.
- Redis in production via Upstash REST: logout actually revokes tokens now,
  login/register rate limits are enforced, no more `ECONNREFUSED` log noise.
  (The graph checkpointer stays on MemorySaver — Upstash lacks RediSearch.)
- Remaining known limit: a single deep research run can exceed the 60s Hobby
  function timeout. See `specs/09-learnings-from-prod-500s-and-upstash.md`.

## 2026-09-19 — `b07456c` — Vercel deployment (live: researcherit.vercel.app)

- One Vercel project serves the Vite SPA and the Express API (serverless
  functions, one file per route prefix, all wrapping a pre-bundled app).
- Neon Postgres (migrations applied), Groq + Serper for live research;
  verified end-to-end on production (register → research → cited markdown).
- Serverless trade-offs: `/ws` streaming falls back to HTTP automatically,
  long runs capped at the 60s function timeout, Redis omitted (fail-open
  fallbacks cover it). See `specs/08-learnings-from-vercel-deployment.md`.

## 2026-09-19 — `9df2495` — Readable type, linked citations, top-anchored output

- Removed the CursorGothic webfont: the files rendered distorted. Display text
  now uses system fallbacks, matching the approved Figma mock (which ships no
  font files).
- Every `[n]` citation number is an orange chip that jumps to its source card,
  visible even while streaming.
- Sending a question pins it to the top of the view; the chat no longer chases
  the streaming bottom.
- Content column widened 672px → 880px, shrinking the side gaps.

## 2026-09-19 — `75776c3` — Single sources render, tables, persisted trace, paper theme

- Fixed sources rendering twice (dark block + light cards). One cards section
  per answer; stray `*` cleaned from source titles.
- Markdown tables now render (GFM support) with paper styling.
- The reasoning trace persists under each answer after the run finishes.
- Whole app flipped to the paper theme (landing, login, navbar included);
  sidebar wordmark links home, user card links to profile.

## 2026-09-19 — `ba8433f` — Researcher paper UI from the Figma design

- New ChatGPT-style chat UI in the Cursor paper aesthetic: history sidebar,
  topbar with conversation title, Quick/Standard/Deep pills, and Export.
- Live reasoning trace with colored steps (decomposition → search → synthesis
  → review) and status pills; thinking dots while agents work.
- Sources as collapsible cards with domain + link; inline citations as chips.
- Working Export button downloads the thread as `.md`; textarea composer with
  Enter-to-send. Navbar hides on `/agent` (the design brings its own chrome).

## 2026-09-19 — `f35e21c` — Full-length outputs (token ceiling fix)

- Fixed answers ending mid-sentence before Sources: Groq caps `gpt-oss-20b`
  at 2048 output tokens unless asked. Writer/editor now request up to 16384
  and automatically continue past length cutoffs. New research runs complete
  with Sources; old truncated messages stay as-is in history.

## 2026-09-19 — `45de65c` — Docs: enhancement learnings (spec 05)

## 2026-09-18 — `c3d1066` — Autoscroll only sticks at the bottom

- Streaming no longer yanks the view while reading history; it follows only
  when already at the bottom (later superseded by top-anchoring in `9df2495`).

## 2026-09-18 — `85636aa` — Refresh tokens, LLM titles, pagination, sources, chat refresh

- Login sessions survive access-token expiry: opaque rotating refresh tokens
  (30 days), auto-refresh on 401, logout clears all.
- Conversation titles: instant heuristic title, upgraded by the LLM seconds
  later without blocking research.
- Message pagination: newest-first, "Load older messages" prepends history.
- Sources parsed robustly into cards at the bottom of each answer.
- First chat UI refresh (composer docked at bottom, GSAP entrances) — later
  replaced by the Figma port in `ba8433f`.
- Database migration `20260918164337_add_refresh_tokens` (applies
  automatically on api boot).

## 2026-09-18 — `73c00af` — Fix: lots of errors

- Batch of stability fixes from the initial implementation review.

## 2026-09-18 — `9ce1ec5` — DESIGN.md

- Full architecture/design documentation (agent graph, API, frontend,
  deployment, security).

## 2026-09-18 — `1b27cec` — Planner→Writer→Editor agent

- LangGraph agent with Tavily/Serper search, Redis checkpointer, WebSocket
  token streaming, depth selector, offline mock mode.

## 2026-09-18 — `ff7321c` / `1e013e3` — Initial scaffold

- Turborepo + Bun monorepo (React/Vite web, Express api, Prisma/Postgres,
  Redis), JWT + Google auth, conversations API, Docker Compose stack.
