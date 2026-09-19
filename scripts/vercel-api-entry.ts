import { existsSync, mkdirSync, readdirSync, copyFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../apps/api/src/app.js";

// Vercel serverless entry (bundled by scripts/bundle-vercel-api.mjs into a
// self-contained `handler.cjs` copied next to every api/* wrapper — see
// vercel.json buildCommand). The bundle is needed because Vercel's Node
// cannot import the workspace's raw `.ts` (package exports point at
// `./src/*.ts`, Bun-only) or follow Bun's isolated-store symlinks.

// Prisma engine self-provisioning. The query engine `.so.node` travels next
// to each handler copy, but Prisma's default search locations don't include
// the bundle dir in every function layout — while `PRISMA_QUERY_ENGINE_LIBRARY`
// (checked first, when the file exists) is fully deterministic. On cold start
// this copies the sibling engine binary to /tmp (the only writable dir) and
// points the env var at it. Engine load is lazy (first query), so setting the
// var here — after imports — is still in time. Respects a pre-set value.
function ensureEngine(): void {
  if (process.env.PRISMA_QUERY_ENGINE_LIBRARY?.trim()) return;
  // __dirname is always defined in the CJS bundle output.
  const here = __dirname;
  const engine = readdirSync(here).find(
    (f) => f.startsWith("libquery_engine") && f.endsWith(".so.node"),
  );
  if (!engine) {
    console.warn("[vercel-api] query engine not found next to bundle");
    return;
  }
  const dir = join(tmpdir(), "prisma-engines");
  const dest = join(dir, engine);
  if (!existsSync(dest)) {
    mkdirSync(dir, { recursive: true });
    const tmp = `${dest}.tmp.${process.pid}`;
    copyFileSync(join(here, engine), tmp);
    renameSync(tmp, dest);
  }
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = dest;
}

ensureEngine();

export default function handler(req: unknown, res: unknown): unknown {
  return (app as (req: unknown, res: unknown) => unknown)(req, res);
}
