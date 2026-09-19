# 07 — Readability round (user-reported)

## 1. Drop the CursorGothic webfont — it rendered distorted

The `imjac0b/CursorGothic` woff2 files (verified real, served 200 via
jsdelivr, shipped in the bundle) render poorly — the repo is a 16-star
recreation, not the actual Cursor typeface. Telling detail: the Figma mock the
user approved ships **no font files at all**, so its clean look *is* the
fallback stacks (system-ui/Helvetica, Georgia, ui-monospace). Removed the
`@font-face` block; stacks unchanged, fallbacks now do the work. Lesson: a
verified URL is not a verified render — check letterforms on screen before
adopting a lookalike font.

## 2. Citation numbers link to their source cards

`[n]` markers were plain text whenever the Sources section hadn't parsed yet
(mid-stream) and unclickable chips afterwards. Now every guarded `[n]` becomes
`[n](#ri-source-n)` unconditionally, chips render as anchors, and each card
carries the matching `id` (`scroll-margin-top` included) — clicking a number
scrolls the thread to its card. `arr[1]`-style code and `[^1]` footnotes are
still excluded by the leading-char guard.

## 3. New output anchors at its top, not the streaming bottom

Old behavior: every token scrolled to the bottom (then: stick-if-at-bottom).
User reads top-down, so: on submit/edit the thread jumps the new question to
the top (`scrollToNewExchange`, via `getBoundingClientRect` math against the
thread container — `offsetTop` is unreliable without a positioned ancestor)
and nothing scrolls afterwards, including post-reconcile. The follow-effect,
`stickToBottom`, `prepending` flag, and scroll tracker are deleted, not
flagged off.

## 4. Content column 672px → 880px

`.ri-thread-inner` and `.ri-footer-inner` widened; side gaps shrink, 2-up
source cards breathe. The Figma `max-w-2xl` was tuned for its narrower mock,
not our viewport.
