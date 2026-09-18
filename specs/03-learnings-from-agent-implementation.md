# 03 — Learnings from implementing spec 02 (Planner→Writer→Editor)

Spec: `02-agent-implementation.md` (moved from repo root into `specs/` for
consistency with 00/01). Verified 2026-09-18: `check-types` 4/4, `build` 4/4,
containerized stack booted from fresh images (api login + HTTP research +
WS token stream all OK), test rows deleted, stack torn down with volumes kept.

## What was built

- `packages/agent` v0.2.0: real `StateGraph` — planner (Tavily search →
  `sources_block` → plan with `[n]` tags) → writer (plan + revision_note →
  markdown draft with closing Sources list) → editor (VERDICT parse) with
  conditional edge `revise && revision_count < MAX_REVISIONS → writer`
  (default 2, env `MAX_REVISIONS`). Forced end on cap publishes latest draft.
- Live path needs `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`,
  `RESEARCH_MODEL`, `TAVILY_API_KEY`); without keys, deterministic offline
  templates run — mock sources use `example.invalid` URLs and output is
  labelled offline, so nothing can be mistaken for real citations.
  Offline editor revises exactly once, exercising the loop without an LLM.
- Streaming: `streamResearch()` async generator (node status → token chunks →
  result). Live tokens via LangChain callback handler; offline drafts chunked
  at word boundaries when the writer update lands.
- Checkpointer: `RedisSaver` (thread `conv:<id>:<rand>` per run, resume via
  `getResearchState`), MemorySaver fallback when `REDIS_URL` is unset or
  Redis is unreachable.
- Api: `/ws` fans out `node`/`token`/`result` frames and persists both
  messages (mirrors HTTP loop); `meta: { verdict, revisionCount, offline }`
  added to HTTP research responses; login/register/Google rate-limited
  (`checkRateLimit`, fail-open, 20/10 per min per IP).
- Web: Agent page streams over `/ws` into a live bubble (phase label:
  planning/writing/editing/revising), reconciles tmp ids via refetch, falls
  back to HTTP on connection-level failure, reconciles (no duplicate POST) on
  mid-stream failure; depth selector (quick/standard/deep → Tavily breadth +
  writer scope, persisted in localStorage); `/ws` added to vite proxy.
- Infra: redis image → `redis/redis-stack-server:7.2.0-v9` (RediSearch for
  saver indexes); agent keys plumbed through root `.env` → compose → api.
  README + AGENTS.md updated.

## Gotchas (do not re-learn these)

1. **checkpoint-redis version must match the langgraph line.** `1.x` needs
   core v1; our 0.3/0.4 line needs `0.0.3` (peers: core `>=0.2.31 <0.4.0`,
   checkpoint `^0.1.2`). That forced `@langchain/langgraph ^0.4.10`
   (0.2.x pins checkpoint `~0.0.17`, incompatible).
2. **`RedisSaver` 0.0.3 has a delta-read bug**: `put` stores only changed
   channels but `getTuple` returns one checkpoint unmerged — after a run,
   `getState` had `finalPost` but empty `draft`/`plan` (MemorySaver was
   fine). Fix in `graph.ts#patchDeltaStorage`: call through with
   `newVersions: undefined`, hitting the saver's keep-everything branch.
   Remove when moving to the langchain v1 line (saver 1.x reads properly).
3. **Thread ids must not contain `:`** — saver keys are
   `checkpoint:<thread>:<ns>:<id>` and "latest" is a lexicographic sort, so
   colons only *happen* to work. Ours (`conv:<id>:<rand>`) survived because
   uuid6 suffixes sort chronologically; keep the `conv:` prefix scheme or go
   colon-free.
4. **redis:7-alpine RDB does not load on redis-stack 7.2** ("Fatal error
   loading the DB" restart loop). Image swap required deleting only the
   `researcherit_redisdata` volume (ephemeral: blacklist, rate limits,
   checkpoints) — never `down -v` (would take pgdata with it).
5. **LangChain callbacks need the class, not an object literal.**
   A `{ handleLLMNewToken }` object fails `BaseCallbackHandler` typing;
   extend the class (`TokenForwarder` in `llm.ts`). Import from
   `@langchain/core/callbacks/base` (the `/callbacks` subpath is gone).
6. **`CompiledStateGraph` needs 3 generics**: `CompiledStateGraph<State,
   Partial<State>, string>` — the node-name param defaults to `START` and
   rejects real graphs.
7. **Docker api `bun install` is just slow (~3 min) + ~1 GB layer export** —
   looks stuck, isn't. Don't kill it; poll the build log, not the process.
8. **One unexplained hang**: a single `streamResearch` run with `REDIS_URL`
   set produced no output before the timeout; reruns (same code/data) pass
   consistently since. Suspect first-run index warmup, not logic. Watch item.
9. **Vite dev needs the `/ws` proxy entry** (`ws: true`) for the web's
   same-origin socket; plain `curl` can't verify it — use a real WS client
   (ping → connected frame).
10. **`testcontainers` is a *runtime* dep of checkpoint-redis 0.0.3** —
    explains part of the dep-tree growth; harmless, do not "fix".
11. **Rate-limit exact counts vary by window** (20/min/IP + prior attempts in
    window) — assert "429s appear", not exact splits.

## Decisions worth keeping

- Offline-first: every live integration (LLM, Tavily, Redis) degrades to an
  honest deterministic mode, so `docker:up` works with zero keys.
- Token sink (`setTokenSink`) is module-global and single-flight — OK because
  the api awaits each run; revisit if runs ever parallelize per process.
- Mid-stream WS failure reconciles via refetch keyed off frame
  `conversationId`s instead of re-POSTing (no duplicate user messages).
- `agentInfo.maxRevisions` is static (2); runtime cap is env-driven.

## Not yet verified (needs real keys)

Live OpenAI/Tavily paths are type-checked and wired but never executed —
no keys in this environment. Before calling live mode done: one run with
keys checking citations map to real URLs, revise loop triggers on real
feedback, and token frames flow writer→editor. Suggested spec 04: live-key
smoke + refresh tokens + LLM conversation titles + message pagination.
