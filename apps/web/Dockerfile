# ---- build: bun install + vite build ----
FROM oven/bun:1.3 AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:4000
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
COPY package.json bun.lock turbo.json .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/typescript-config/ ./packages/typescript-config/
COPY packages/eslint-config/ ./packages/eslint-config/
COPY apps/web/ ./apps/web/
RUN bun install && bun --filter=@researcherit/web run build

# ---- serve: tiny nginx serving the static dist ----
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
