import app from "../apps/api/src/app.js";

// Vercel serverless entry (bundled by scripts/bundle-vercel-api.mjs into
// api/.bundle/handler.cjs — see vercel.json buildCommand). The bundle is a
// self-contained CJS file because Vercel's Node runtime cannot import the
// workspace's raw `.ts` sources (package exports point at `./src/*.ts`, which
// only Bun understands) and cannot follow Bun's isolated-store symlinks.
export default function handler(req: unknown, res: unknown): unknown {
  return (app as (req: unknown, res: unknown) => unknown)(req, res);
}
