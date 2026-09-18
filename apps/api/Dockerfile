# ---- base: install workspace deps with bun ----
FROM oven/bun:1.3 AS base
WORKDIR /app
COPY package.json bun.lock turbo.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/agent/package.json ./packages/agent/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
RUN bun install

# ---- dev: run everything from source with hot reload ----
FROM base AS dev
COPY . .
# Bake the Prisma client (no DB needed) so `bun run` works on plain `docker run`.
RUN bun --filter=@repo/db run db:generate
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["bun", "run", "--hot", "src/index.ts"]
