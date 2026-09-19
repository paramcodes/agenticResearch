// Vercel serverless entry — thin wrapper over the pre-bundled Express app
// (`api/.bundle/handler.cjs`, built by `scripts/bundle-vercel-api.mjs` during
// `vercel build`). A static relative require keeps nft file-tracing working;
// the bundle is fully self-contained so no node_modules resolution happens
// at runtime. One file per route: Vercel only matches single-segment dynamic
// routes here, so each Express prefix gets its own entry instead of a
// top-level catch-all.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler } = require("./.bundle/handler.cjs") as {
  default: (req: unknown, res: unknown) => unknown;
};
export default handler;
