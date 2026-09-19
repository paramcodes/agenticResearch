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
