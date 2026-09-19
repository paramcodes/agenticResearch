# 06 — Paper UI fixes (user-reported round)

Follow-up to spec 05's Figma port. Four user reports, all reproduced, with the
root cause and fix for each.

## 1. Sources rendered twice

Symptom: a dark "SOURCES" card block above the light "Show N sources" cards.
Cause: two renderers — `Markdown` drew its own internal `sources-section`
(dark CSS) **and** `Agent` drew the new `ri-cards` from the same parse.
Fix: `Markdown` takes `showSources` (default true); `Agent` passes `false`.
Rule going forward: one owner per parse — `Agent` owns source cards via the
exported `getSources()`, `Markdown` owns body + citation chips.

Related: source titles arrived with literal `*...*` (model emits
`1. [*Title*](url)`). `cleanTitle()` in `Markdown.tsx` strips `**`/`__`/edge
`*`/`_` before display.

## 2. Tables didn't render

`react-markdown` v9 needs a plugin for GFM tables. Added `remark-gfm@4`
(`bun --filter=@researcherit/web add remark-gfm`) and
`remarkPlugins={[remarkGfm]}` in `Markdown`, plus paper table CSS under
`.ri-body` (ruled header, hairline borders, zebra rows). If the model emits
more GFM (task lists, strikethrough), it now works too.

## 3. Reasoning trace vanished after the run

`runStream`/`reconcile` close over the render in which they started, so
`reconcile` read the *submit-time* `liveSteps` (one step or empty) instead of
the fully-built trace — the persisted message got no (or a stub) trace.
Fix: `liveStepsRef` mirror + `setLive()` helper that writes state and ref
together; `reconcile` snapshots the ref, marks all done, and attaches it to
the persisted assistant message id via `traces`. Default collapsed
("View reasoning trace · N steps"), matching the Figma mock.

## 4. No way home + theme mismatch + fonts

- Sidebar wordmark is now a `Link to="/"`, user card links to `/profile`
  (logout button stays). Navbar remains hidden on `/agent`.
- Whole app flipped to the paper theme: `:root` vars
  (`--bg #f2f1ed`, ink text, orange→crimson accents) carry landing/auth/
  profile automatically; hardcoded dark leftovers fixed individually
  (navbar wash, error/success text, `pre`/`code` backgrounds, feature hover
  glow, display font on headings). Old dark agent classes (`.agent-layout`,
  `.msg-*`, …) are dead CSS — left in place, harmless, flagged for a cleanup
  pass; nothing references them.
- CursorGothic wired via `@font-face` from the repo the user linked
  (`imjac0b/CursorGothic`, verified `cursor-gothic.css` + `fonts/` listing):
  jsdelivr `…@main/fonts/CursorGothic-{Regular,Italic,Bold,BoldItalic}.woff2`,
  `font-display: swap`, existing stacks already listed it first so no JSX
  changed. jjannon/berkeleyMono have no provided source — Georgia and
  ui-monospace fallbacks stand in.

## Verification

`check-types --force` 4/4, web `build` clean, `docker compose up --build -d
web`, served bundle grepped for the new strings. Note: `bun add` inside the
monorepo needs `--filter=@pkg` with `=` — bare `--filter` matched nothing.
