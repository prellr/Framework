ARG NODE_VERSION=22

# ─── Base ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /app

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --frozen-lockfile

# ─── Build web ────────────────────────────────────────────────────────────────
FROM deps AS web-builder
COPY . .
RUN pnpm --filter @framework/web build

# ─── Migrator ─────────────────────────────────────────────────────────────────
FROM deps AS migrator
COPY . .
WORKDIR /app/packages/db
CMD ["pnpm", "db:migrate"]

# ─── API ──────────────────────────────────────────────────────────────────────
FROM deps AS api
COPY . .
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["pnpm", "start"]

# ─── Worker ───────────────────────────────────────────────────────────────────
FROM deps AS worker
COPY . .
WORKDIR /app/apps/api
CMD ["pnpm", "worker"]

# ─── Nginx (serves web build) ─────────────────────────────────────────────────
FROM nginx:alpine AS nginx
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80 443
