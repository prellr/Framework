# Framework — Claude Code Context

## What this is
A reusable full-stack web app starter extracted from the WineryManager architecture.
Clone/copy it to start a new internal-tool style project: typed API, RBAC auth,
admin page, background jobs, real-time events, Docker deploy.

To start a new project from this template:
1. Copy the repo, then find-and-replace `@framework/` → `@yourapp/` and `framework` → `yourapp` in package names, docker-compose `name:`, and imports.
2. Replace the "Framework" branding (login pages, Sidebar, index.html title, favicon).
3. Delete the example Notes module (schema `notes.ts`, router `notes.ts`, `NotesPage.tsx`, its route + nav item) once you have real domain modules.
4. Run the Getting started steps in README.md.

---

## Monorepo structure
```
apps/api/        Hono + tRPC backend (Node, TypeScript, tsx runtime — no build step)
apps/web/        React + Vite + TanStack Router frontend
packages/db/     Drizzle ORM schema + migrations (PostgreSQL)
packages/config/ Shared prettier/eslint/tsconfig
nginx/           nginx.conf for production reverse proxy (serves web build, proxies /api)
```

## Tech stack
- **Frontend**: React 19, Vite, TanStack Router, TanStack Query (v5), tRPC client, Tailwind CSS v4, shadcn/ui-style components
- **Backend**: Hono (HTTP), tRPC v11 (typed RPC), Better Auth (session/RBAC), Drizzle ORM
- **DB**: PostgreSQL (Docker, pgvector image), migrations via `drizzle-kit`
- **Jobs**: BullMQ + Redis (repeatable jobs registered in `apps/api/src/jobs/queue.ts`)
- **Real-time**: SSE endpoint (`/api/sse`) backed by Redis pub/sub channel `app:events`
- **Auth**: Better Auth with custom RBAC — roles: `viewer / operator / manager / admin`

---

## Key workflows

### Type-check
```bash
pnpm --filter @framework/api type-check
pnpm --filter @framework/web type-check
```

### DB migration
```bash
pnpm --filter @framework/db db:generate   # generate SQL from schema changes
pnpm --filter @framework/db db:migrate    # apply locally (dev only)
# In production: the migrate container runs automatically on deploy
```
Always commit the generated SQL in `packages/db/drizzle/`.

### Local dev
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up postgres redis -d
pnpm --filter @framework/api dev        # API on :3001
pnpm --filter @framework/web dev        # Vite on :5174, proxies /api → :3001
pnpm --filter @framework/api worker:dev # optional: BullMQ worker
```

### First user
```bash
pnpm --filter @framework/api create-first-user
# ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD env vars override the defaults
```

### Production deploy
`docker compose up --build -d` on the server. Services: postgres, redis, migrate
(runs then exits), api, worker, nginx (serves the built SPA + proxies /api).

---

## RBAC roles (least → most privileged)
`viewer < operator < manager < admin`

Enforcement lives in two places, both required:
- **Server (real)**: `requireRole()` middleware in `apps/api/src/trpc/middleware.ts` — use `protectedProcedure` / `operatorProcedure` / `managerProcedure` / `adminProcedure`.
- **Client (UX)**: `requireRole()` in `apps/web/src/router.tsx` (route redirect) and `minRole` on nav items in `Sidebar.tsx` (visibility).

Agent/MCP access: a valid `X-API-Key` header (matching the `AGENT_API_KEY` setting)
injects a synthetic manager-role user in `apps/api/src/trpc/context.ts`.

---

## Adding a feature module (the pattern)
1. **Schema**: `packages/db/src/schema/<module>.ts`, export from `schema/index.ts`, then `db:generate` + `db:migrate`.
2. **Router**: `apps/api/src/routers/<module>.ts`, mount in `apps/api/src/trpc/router.ts`. Use zod inputs, role-gated procedures, `audit()` on mutations.
3. **Page**: `apps/web/src/pages/<module>/`, add route in `router.tsx`, nav item in `Sidebar.tsx`.
4. **Job** (if needed): processor in `apps/api/src/jobs/processors/`, Queue + schedule in `jobs/queue.ts`, `makeWorker()` call in `jobs/worker.ts`.
5. **External service client** (if needed): `apps/api/src/services/<name>.ts` reading credentials via `getSetting()` at call time (not import time), plus a `resetXClient()` registered in `admin.updateSettings`. Add the keys to `SETTING_GROUPS` in `routers/admin.ts` so they're editable in Admin → Settings.

The Notes module (`schema/notes.ts`, `routers/notes.ts`, `pages/notes/NotesPage.tsx`) is a working reference for steps 1–3. Delete it when real modules exist.

## Runtime-configurable settings
- `app_settings` table (key/value) + `getSetting(key)` in `apps/api/src/services/config.ts`: DB value first, then `process.env`.
- Services read settings at call time so admins can rotate credentials from Admin → Settings without a restart.
- `setSetting()` is also used for job state (sync cursors etc.).

---

## Key gotchas (inherited from WineryManager production)

### docker-compose env vars
New env vars must be added to BOTH the server's `.env` file AND the `environment:`
section in `docker-compose.yml`. Injected at container startup, not baked into the image.

### TanStack Router type system
`useParams({ from: "..." })` requires the exact registered route path in the `Register`
interface. Workaround for brand-new routes: `window.location.pathname.split("/").pop()`.

### React Query v5
No `onSuccess` on `useQuery` — use a `useEffect` watching the data.

### BigInt IDs
`bigserial` columns come back as BigInt; `JSON.stringify` throws on them. Serialize as
strings (`id.toString()`), parse with `BigInt(id)`.

### iOS Safari `position:fixed` clipping
`overflow-y-auto` on `<main>` (AppShell) clips fixed children. Use
`createPortal(content, document.body)` for modals/overlays.

### nginx DNS re-resolution
nginx uses `set $upstream http://api:3000;` (not a static upstream block) so Docker DNS
re-resolves after container restarts — see `nginx/nginx.conf`.

### SSE through nginx
`/api/sse` needs `proxy_buffering off` (already configured). Any new streaming endpoint
needs its own location block with the same flags.

### pg connection pool
`packages/db/src/client.ts` sets keepAlive + connectionTimeoutMillis — Docker bridge
networks silently drop idle TCP connections; without these a pool hiccup becomes a
multi-minute hang. Don't remove them.

### Background refetch
Leave TanStack Query background refetch at defaults. `refetchIntervalInBackground: true`
multiplied API load ~3x in production (every open tab polls forever).

### Custom /api/auth/* routes
Mount them BEFORE `app.all("/api/auth/*", auth.handler)` in `apps/api/src/index.ts`,
or Better Auth swallows them with a 404.
