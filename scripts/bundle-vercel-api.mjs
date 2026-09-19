// Bundles the Express API into a single self-contained CJS file for Vercel
// serverless functions (`api/.bundle/handler.cjs`), plus the Prisma query
// engine binary the bundle loads via PRISMA_QUERY_ENGINE_LIBRARY.
//
// Why: Vercel compiles `api/*.ts` to CJS and traces files with nft, but the
// workspace ships raw `.ts` (exports map → `./src/*.ts`) behind Bun's
// isolated-store symlinks — neither survives. esbuild inlines everything
// (workspace TS → JS, all npm deps) so the function needs no node_modules at
// runtime except the native engine binary, which is copied alongside.

import { buildSync } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "api", ".bundle");
mkdirSync(outDir, { recursive: true });

buildSync({
  entryPoints: [join(root, "scripts", "vercel-api-entry.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: join(outDir, "handler.cjs"),
  logLevel: "info",
});

// Locate the generated Prisma client + its library engine (bun store layout:
// node_modules/.bun/@prisma+client@*/node_modules/.prisma/client/).
const require = createRequire(join(root, "packages", "db", "package.json"));
const prismaClientDir = dirname(
  require.resolve("@prisma/client/package.json", {
    paths: [join(root, "packages", "db")],
  }),
);
const generatedDir = join(prismaClientDir, "..", "..", ".prisma", "client");
const engineFile = readdirSync(generatedDir).find(
  (f) => f.startsWith("libquery_engine") && f.endsWith(".so.node"),
);
if (!engineFile) throw new Error(`Query engine not found in ${generatedDir}`);
copyFileSync(join(generatedDir, engineFile), join(outDir, engineFile));
console.log(`[bundle-vercel-api] engine: ${engineFile}`);

if (!existsSync(join(outDir, "handler.cjs")))
  throw new Error("Bundle output missing");
console.log("[bundle-vercel-api] done → api/.bundle/handler.cjs");

// Vercel traces files per function, and relative requires climbing out of
// nested function dirs (api/conversations/[id]/ → ../../.bundle/…) are not
// reliably included — nested routes 500'd with "Cannot find module" while
// top-level ones worked. So every dir holding a wrapper gets its own copies;
// wrappers require ./handler.cjs (same-dir, trivially traceable). The Prisma
// engine travels with them because its runtime resolution is
// `path.join(__dirname, "libquery_engine-…")` — i.e. next to the bundle —
// and no single PRISMA_QUERY_ENGINE_LIBRARY value can cover five different
// dirs, so that var must stay UNSET (see vercel.json docs below).
const handlerSrc = join(outDir, "handler.cjs");
const engineSrc = join(outDir, engineFile);
for (const dir of [
  join(root, "api"),
  join(root, "api", "auth"),
  join(root, "api", "agent"),
  join(root, "api", "conversations"),
  join(root, "api", "conversations", "[id]"),
]) {
  copyFileSync(handlerSrc, join(dir, "handler.cjs"));
  copyFileSync(engineSrc, join(dir, engineFile));
}
console.log("[bundle-vercel-api] handler + engine copies placed next to wrappers");
