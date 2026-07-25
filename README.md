# Framework

A full-stack web app starter (extracted from the WineryManager architecture) for
internal-tool style projects.

**Stack**: pnpm workspaces + Turborepo · Hono + tRPC v11 · Better Auth (RBAC) ·
Drizzle ORM + PostgreSQL · BullMQ + Redis · React 19 + Vite + TanStack Router/Query ·
Tailwind CSS v4 · Docker Compose + nginx deploy.

**Included out of the box**
- Email/password auth with roles (`viewer / operator / manager / admin`), login /
  forgot-password / reset-password pages
- Admin page: user management (create, role, password reset, remove), durable
  successful-login history, and a runtime settings editor backed by the
  `app_settings` table
- `getSetting()` runtime config: DB override first, env var fallback — rotate
  credentials without restarts
- Audit log table + `audit()` helper
- BullMQ worker with repeatable-job registration and stall-recovery defaults
- SSE endpoint (`/api/sse`) via Redis pub/sub + `useSSE()` React hook
- Agent/MCP access via `X-API-Key` header
- Example **Notes** module demonstrating the schema → router → page pattern
- Production Dockerfile (api / worker / migrator / nginx targets) + compose files

## Getting started

```bash
pnpm install
cp .env.example .env            # edit BETTER_AUTH_SECRET at minimum

# Start Postgres + Redis
docker compose -f docker-compose.yml -f docker-compose.dev.yml up postgres redis -d

# Create tables
pnpm --filter @framework/db db:generate
pnpm --filter @framework/db db:migrate

# Bootstrap the first admin (admin@localhost / Admin123! by default)
pnpm --filter @framework/api create-first-user

# Run it
pnpm --filter @framework/api dev    # API on :3001
pnpm --filter @framework/web dev    # web on :5174
```

Open http://localhost:5174 and sign in.

## Starting a new project from this template

1. Copy the repo; rename `@framework/*` package scopes, the compose project `name:`,
   and imports to your app's name.
2. Rebrand: `index.html` title, favicon, login pages, Sidebar logo/name.
3. Build your first real module following the Notes example (see CLAUDE.md →
   "Adding a feature module"), then delete the Notes module.
4. Set up deploy: fill the server's `.env`, `docker compose up --build -d`.

See [CLAUDE.md](CLAUDE.md) for the full architecture guide and production gotchas.
