# 05 — Learnings from the enhancement implementation (spec 04)

Spec 04 asked for: refresh tokens + LLM conversation titles + message pagination,
a sources fix, and a ChatGPT/Claude-grade chat UI with GSAP. Part of it was
done mid-session before this pass; the rest, plus two user-reported runtime
issues ("no UI change", "output stuck", docker build failures), is recorded here
with the decisions behind each fix.

## Decisions

### 1. Refresh tokens: opaque, DB-backed, rotated, best-effort like everything else

- Opaque `crypto.randomBytes(32)` tokens in a `RefreshToken` model
  (`token unique, userId, expiresAt 30d`, cascade delete) — not a second JWT.
  Reason: revocation is a DB delete; no signature bookkeeping, matches the
  existing Redis-blacklist approach to logout.
- `POST /api/auth/refresh` rotates (delete old, issue new) so a leaked token
  has a one-use window. Logout deletes **all** of the user's refresh tokens.
- Web `api.ts` retries once after a 401 via a subscriber queue
  (`isRefreshing` + `refreshSubscribers`) so concurrent requests trigger one
  refresh. On refresh failure it clears both tokens — the user re-logs in
  instead of looping on 401s.

### 2. LLM titles: heuristic instantly, LLM upgrade async

- New `packages/agent/src/titles.ts` exports `heuristicTitle` (the old
  keyword-stripping logic, moved verbatim) and `generateConversationTitle`.
- All three conversation-creation paths (HTTP `/research`, WS handler,
  follow-up `/messages`) create with the heuristic title, then fire-and-forget
  the LLM upgrade (`void … .then(update).catch(() => undefined)`).
- Why: the sidebar must never wait on an LLM call; titles must never break a
  research run. Offline (no key) the upgrade is a no-op that skips the update.
- Frontend `reconcile` schedules a second `refreshList` after 12s to pick up
  the async-upgraded title without polling.

### 3. Pagination: newest-first windowing, not forward offsets

- The mid-session implementation used `skip=(page-1)*limit` with `asc` order —
  page 1 was the *oldest* 50, so any thread over 50 messages opened on stale
  history and never showed the newest reply. Fixed: page 1 = the latest
  `limit` messages in chronological order, computed as a window from the end
  (`newestCount = total - (page-1)*limit`, `skip = newestCount - take`).
  `hasMore` now means "older pages exist".
- Frontend prepends (`[...older, ...prev]`), never appends, for page 2+.
- `reconcile` (post-research) reloads page 1 — the view re-anchors on the
  newest exchange, ChatGPT-style. Trade-off accepted: previously loaded older
  pages collapse back; re-opening them is one click.
- `getConversation` query building moved to `URLSearchParams` (the old
  template produced a leading `&` when only `limit` was passed). Limit clamped
  1–100 server-side.

### 4. Sources: parse generously, never destroy content

- The old extractor matched `Sources\n…` non-greedily up to the first blank
  line, truncating multi-item lists, and only understood `N. [t](u)`. Live LLM
  output varies (`- [t](u)`, `[n] title — url`, bare URLs, `## Sources used`),
  so sources "weren't loading".
- New parser: split at the **last** `#{1,4} Sources( used)?` heading, take
  everything after it, accept all formats above, dedupe by URL, renumber.
  If nothing parses, the original markdown is returned untouched — a failed
  parse must degrade to plain text, never to lost content.
- Rendered as cards at the bottom of each assistant bubble (title link +
  hostname), which is what "sources at the bottom of the chat" meant.

### 5. Chat UI: ChatGPT/Claude layout, GSAP per the skill

- Layout principles borrowed: history sidebar, thread in the middle, composer
  **docked at the bottom** (was sticky-top), centered hero composer when empty.
  Fixed-height layout (`calc(100vh - 140px)`) with an internally scrolling
  thread keeps the composer always visible.
- GSAP per skill rules: `gsap.context()` with revert on unmount,
  transforms/opacity only (the old sidebar *width* tween caused reflow — the
  CSS transition already handled it, so the tween was deleted),
  `prefers-reduced-motion` guards everywhere, stagger via `[data-anim]`.
- Autoscroll fix (user-reported "output stuck"): streaming used to call
  `scrollIntoView` on **every token**, yanking the view while reading. Now a
  `stickToBottom` flag (set false when the user scrolls >120px up) gates
  follow mode; follow is instant (`auto`) while loading, `smooth` otherwise;
  sending a message re-sticks. Scrolling targets the thread container
  directly — `scrollIntoView` scrolls *all* ancestors including the page.

### 6. Landing: same GSAP hygiene, honest copy

- Rewrote with `gsap.context` + reduced-motion guard + `gsap.set` initial
  state (no FOUC flash). Feature cards now describe shipped behavior
  (streaming, persisted history with LLM titles, cited sources) instead of the
  stale "streaming soon" copy.

## Docker / ops learnings (from the live debugging session)

1. **Web bakes at build time, api live-mounts.** `apps/web/Dockerfile`
   compiles Vite into a static nginx image; `apps/api` mounts `./apps/api/src`
   + `./packages` with `bun --hot`. So "I don't see any UI change" after
   editing web code almost always means a stale image — fix is
   `docker compose up --build` (or `bun run docker:up`, which includes
   `--build`), plus a hard refresh (`index.html` can sit in browser cache;
   hashed js/css filenames make the rebuild sufficient otherwise).
2. **`credsStore: desktop` with no Docker Desktop breaks every pull.**
   `~/.docker/config.json` carried `"credsStore": "desktop"`; fix was deleting
   the key (empty `auths`, nothing lost). Symptom:
   `docker-credential-desktop: executable file not found in $PATH`.
3. **A quiet build is not a stuck build.** `docker compose build` tail showed
   nothing for 10+ minutes while BuildKit pulled `oven/bun`, ran
   `bun install`, and built Vite — both images completed. Judge by
   `docker images`, not the log tail.
4. **Stale containers can reference pruned image IDs**
   (`No such image: sha256:…` on `docker compose images`). `docker compose
   down` + `up --build -d` clears it.
5. **Verify the served bundle, not just the build.** After `up`, grepping the
   served `/assets/*.js` for a new-UI string (`Load older messages`) proves
   nginx serves the new code. Api side: `/health` → 200; boot-time
   `prisma migrate deploy` is idempotent, safe to re-run.

## Small gotchas

- `prisma migrate dev` without `--name` hangs on an interactive prompt under
  non-interactive shells — always pass `--name`. The resulting
  `migration_lock.toml` header-only diff is benign (newer Prisma version).
- `check-types` passes stale under Turbo cache — use `--force` after real
  changes before claiming green.
- The unused `getRefreshToken` import in `auth.tsx` is intentional (symmetric
  token helpers); the write path lives in `api.ts`.

## Truncated output: Groq caps gpt-oss-20b at 2048 output tokens by default

Symptom: assistant messages ending mid-word ("…Considerations\n\nS"), Sources
section missing entirely. Both previously blamed on the sources parser / UI —
the DB rows proved generation itself was cut (`finish_reason: "length"`,
`completionTokens: 2048`, ~380 of them reasoning tokens).

Fix in `packages/agent/src/llm.ts`: `invokeLlm` accepts `maxTokens` (passed to
the model) plus `maxContinuations` — while `finish_reason === "length"`, it
re-invokes with `[system, human(original), AI(partial), human("continue …")]`
and appends. Budgets: writer/editor 16384 + 2 continuations, planner 8192,
titles 64. Verified live: 7672 chars/`length` before → 16252 chars/`stop`
after, ending on real Sources entries.

Notes: continuation tokens flow through the same `onToken` sink in order, so
streaming is unaffected; the api container picks this up via `bun --hot`
(live `./packages` mount) with no image rebuild. `repro-length.ts` was a
throwaway diagnostic, deleted after use.
