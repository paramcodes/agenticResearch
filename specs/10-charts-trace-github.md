# 10 — Learnings from charts, trace persistence, and GitHub push

Three user-reported issues in one pass: (1) a "generate a graph" request
returned `(Insert a bar chart image here, e.g., ![…](https://example.com/…))`
plus prose describing a chart that doesn't exist; (2) the reasoning trace
shows during a new chat then vanishes on the Vercel deployment; (3) push to
GitHub and link Vercel for auto-deploys.

## Decisions

### 1. Charts = mermaid, with exact syntax pinned in the prompt

- Text LLMs can't produce image files, so the old output did the worst
  possible thing: a placeholder with a fabricated `example.com` URL plus
  hallucinated figure description. Two-sided fix:
  - `packages/agent/src/graph.ts` writer prompt: may emit ONE ```mermaid
    block **only when asked**, data only from numbered sources (`[n]` in
    labels/comments); never `![alt](url)` (no hosting exists); never Figure
    captions/prose about charts not in the output. Editor prompt strips both
    violations. Offline drafts get an honest "re-run with search enabled"
    note instead of a fabricated chart (mock sources must never back data).
  - `apps/web/src/components/Markdown.tsx`: ```mermaid fences render to SVG
    via lazy `import("mermaid")` (keeps it out of the main chunk —
    `mermaid.core`/`elk` split into async chunks), `securityLevel: "strict"`,
    placeholder while streaming, raw code fallback on parse failure.
- First live run still produced invalid syntax (`series GLM 5.2: 1` —
  invented xychart grammar), which renders as code, not a crash. Fix: the
  prompt now carries the exact template (`x-axis ["A [1]", "B [2]"]`,
  `y-axis "Score" 0 --> 100`, `bar [88, 92]`; pie one-per-line). Verified
  live: valid pie with cited slices, zero image markdown, zero phantom prose.

### 2. Trace persistence via `stepsFromMeta` (Agent.tsx)

- Root cause: `reconcile` only saved `liveStepsRef`, which is populated by
  `/ws` node frames. On Vercel `/ws` never connects, so every production run
  is HTTP-only and the trace area (live "thinking" indicator) cleared to
  nothing on completion.
- `stepsFromMeta(meta, depth)` synthesizes the four done-steps from the
  response meta both endpoints already return (`verdict`, `revisionCount`,
  `offline`): decomposition, search (offline-labelled when so), synthesis
  with revision count, editorial review with verdict. `reconcile` accepts it
  as fallback; `runHttp` (both branches) and the `saveEdit` HTTP fallback
  store it under the assistant message id. The stages genuinely ran
  server-side, so this is honest — and it renders collapsed, matching the
  WS-path UX.

### 3. GitHub push done; Vercel git link blocked on OAuth

- Remote `origin → paramcodes/agenticResearch` already existed, `gh`
  authenticated — `git push origin main` just worked (`29fca0d..4cdb3f5`).
- `vercel git connect <url>` fails: `You need to add a Login Connection to
  your GitHub account first (400)`. Unblocks only in the browser:
  vercel.com → Account Settings → Login Connections → GitHub (OAuth), then
  either re-run `vercel git connect` from /tmp or Project → Settings → Git
  → Connect in the dashboard. After that, pushes to `main` auto-deploy
  (env vars + `vercel.json` build already live on the project).

## Tooling gotchas

- `npx vercel` from the repo dir dies with `EBADDEVENGINES` (npm vs bun
  devEngines) — always run from /tmp with `--cwd`. (Third time this bit;
  now in AGENTS.md.)
- `vercel deploy` upload (~28MB with engine copies) intermittently fails
  with bare `fetch failed` — immediate retry succeeds.
- An empty API response body with no error usually means the client-side
  curl timeout fired first (research near the 60s function cap), not a
  server bug — re-check with `-w 'HTTP:%{http_code} time:%{time_total}s'`.
- `mermaid.parse` can't validate syntax in plain node (needs DOMPurify+DOM)
  — validate template shape against docs, then verify one live run.
