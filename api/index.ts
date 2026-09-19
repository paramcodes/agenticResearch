// Vercel serverless entry — thin wrapper over the pre-bundled Express app.
// `scripts/bundle-vercel-api.mjs` (runs in `vercel build`) emits one
// self-contained `handler.cjs` next to every wrapper; the same-dir require
// keeps nft file-tracing working where `../.bundle/…` requires from nested
// function dirs were silently dropped (500 "Cannot find module").
// One file per route: Vercel only matches single-segment dynamic routes
// here, so each Express prefix gets its own entry instead of a top-level
// catch-all.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler } = require("./handler.cjs") as {
  default: (req: unknown, res: unknown) => unknown;
};
export default handler;
