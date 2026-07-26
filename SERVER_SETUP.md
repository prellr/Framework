# Alchemy — Server Setup & Deploy Runbook

Operational runbook for the deployed instance. For architecture and the feature build-out, see
`JESTER_ANALYSIS_DESIGN.md` and `CLAUDE.md`.

---

## Where it runs

| Thing | Value |
| --- | --- |
| Host | **server2** — `192.168.2.17` (macOS, arm64, OrbStack) |
| Repo on server | `~/jester-analytics` |
| SSH target | `admin@192.168.2.17` (`server2` is descriptive; do not depend on a local alias) |
| Compose project | **`jester-analytics`** (isolated `name:` — never collides with the other stacks on this shared host: `framework`, `multica-prod`, `edassess`) |
| Host port | **8090** → nginx :80 in-container |
| LAN URL | http://192.168.2.17:8090 |
| Public URL | **https://jester.wisco.wine** (Cloudflare Tunnel) |
| MCP endpoint | `POST /mcp` (JSON-RPC; API-key gated) |

> **Shared host rule:** server2 also runs other production stacks. Do not remap port 8090, do not
> touch the other compose projects, and keep this project's `name:` intact so `docker compose`
> only ever acts on Jester's containers.

---

## Services (docker-compose.yml)

| Service | Role | Notes |
| --- | --- | --- |
| `postgres` | Postgres 17 (pgvector image) | No host port — reachable only on the docker network. Volume `postgres_data`. |
| `redis` | BullMQ queue + SSE pub/sub | No host port. Volume `redis_data` (appendonly). |
| `migrate` | Runs Drizzle migrations then exits | Multi-stage `target: migrator`. **Rebuild this whenever the schema changes** or the migration silently no-ops on a stale image. |
| `api` | Hono + tRPC + Better Auth | Health at `/health`. |
| `worker` | BullMQ workers (sweeps, rescreen) | Decrypts per-user keys, so it needs `JESTER_MASTER_KEY` too. |
| `nginx` | Serves the built SPA + proxies `/api`, `/mcp`, `/api/sse` | Host `8090:80`. |

---

## Environment (`~/jester-analytics/.env`, mode 600)

Secrets were generated **on the server** and never printed. Every var below must exist in BOTH
`.env` and the `environment:` block of the relevant service in `docker-compose.yml` — values are
injected at container start, not baked into the image.

| Var | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Postgres superuser password |
| `BETTER_AUTH_SECRET` | Better Auth session signing secret |
| `BETTER_AUTH_URL` | `https://jester.wisco.wine` (canonical origin) |
| `TRUSTED_ORIGINS` | Comma-separated extra origins Better Auth accepts: `http://192.168.2.17:8090,http://server2.local:8090,https://jester.wisco.wine` |
| `AGENT_API_KEY` | `X-API-Key` for MCP / agent access (maps to a synthetic role — see `trpc/context.ts`) |
| `JESTER_MASTER_KEY` | AES-256-GCM master key encrypting per-user Jester API keys (`services/crypto.ts`). **Rotating this orphans every stored user key.** |

To rotate a value: edit `.env`, then `docker compose up -d api worker` (recreates with the new env).
Never commit `.env`.

---

## Standard redeploy (code change)

From the **local** repo (`/Users/Storage/Jester/jester-analysis`):

```bash
# 1. If the schema changed, generate + COMMIT the migration first (local):
pnpm --filter @framework/db db:generate

# 2. Type-check both packages before shipping:
pnpm --filter @framework/api type-check
pnpm --filter @framework/web type-check

# 3. Create a recovery point on Server2 before replacing its rsynced source tree.
#    The deployment tree intentionally has no .git directory, so git checkout is not a rollback.
ssh admin@192.168.2.17 '
  set -eu
  cd /Users/admin/jester-analytics
  release_stamp=$(date -u +%Y%m%dT%H%M%SZ)
  recovery_dir=/Users/admin/jester-releases/$release_stamp
  mkdir -p "$recovery_dir"
  tar \
    --exclude=.env \
    --exclude=.git \
    --exclude=node_modules \
    --exclude='.codex-*' \
    --exclude=backups \
    --exclude=.ruff_cache \
    --exclude=.pytest_cache \
    --exclude=.mypy_cache \
    --exclude=.turbo \
    --exclude=.benchmarks \
    --exclude=tmp \
    --exclude=.venv \
    --exclude=__pycache__ \
    --exclude='*.egg-info' \
    --exclude='*.pyc' \
    --exclude=dist \
    --exclude=.DS_Store \
    -czf "$recovery_dir/source.tgz" .
  /Users/admin/.orbstack/bin/docker compose exec -T postgres \
    pg_dump -U app app | gzip > "$recovery_dir/database.sql.gz"
  shasum -a 256 "$recovery_dir/source.tgz" "$recovery_dir/database.sql.gz" \
    > "$recovery_dir/SHA256SUMS"
  printf "%s\n" "$recovery_dir"
'

# 4. Preview the exact source delta. Review deletes before removing -n. `.research-data` is
#    generated/persisted on Server2 and must never be reconciled to the source checkout.
rsync -azn --delete --itemize-changes \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude '.codex-*' --exclude backups --exclude .research-data \
  --exclude .ruff_cache --exclude .pytest_cache --exclude .mypy_cache \
  --exclude .turbo --exclude .benchmarks \
  --exclude tmp --exclude .venv --exclude __pycache__ \
  --exclude '*.egg-info' --exclude '*.pyc' --exclude dist \
  ./ admin@192.168.2.17:/Users/admin/jester-analytics/

# 5. Sync the repo to the server. In-tree historical recovery material and generated research
#    datasets are protected from --delete; new release recovery points live outside the tree.
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude '.codex-*' --exclude backups --exclude .research-data \
  --exclude .ruff_cache --exclude .pytest_cache --exclude .mypy_cache \
  --exclude .turbo --exclude .benchmarks \
  --exclude tmp --exclude .venv --exclude __pycache__ \
  --exclude '*.egg-info' --exclude '*.pyc' --exclude dist \
  ./ admin@192.168.2.17:/Users/admin/jester-analytics/
```

Then on **server2**
(`ssh admin@192.168.2.17 && cd /Users/admin/jester-analytics`):

```bash
# Rebuild changed services. ALWAYS include `migrate` when the schema changed,
# or migrations silently skip on the stale image.
docker compose build api worker nginx migrate

# Apply migrations explicitly (don't rely on the implicit run):
docker compose run --rm migrate

# Roll the services:
docker compose up -d

# Verify:
curl -fsS http://localhost:8090/health && echo OK
docker compose ps
```

Then confirm the public site: open **https://jester.wisco.wine**, log in, and click through the
changed pages. Check the worker picked up new jobs with `docker compose logs -f worker`.

> **Gotcha (learned the hard way):** `docker compose build api worker nginx` without `migrate`
> leaves the migrate image stale, so a new migration never runs and the new columns 500 the API.
> When in doubt, rebuild `migrate` and run it explicitly.

### Source rollback

If the new application tier fails verification, leave Postgres and Redis volumes running, identify
the exact printed recovery directory, verify its checksums, and restore the source into a temporary
directory before syncing it back. Never guess the recovery path and never restore the database
merely because the application image failed.

```bash
recovery_dir=/Users/admin/jester-releases/REPLACE_WITH_EXACT_STAMP
test -f "$recovery_dir/source.tgz"
test -f "$recovery_dir/SHA256SUMS"
cd "$recovery_dir"
shasum -a 256 -c SHA256SUMS

restore_dir=$(mktemp -d)
tar -xzf "$recovery_dir/source.tgz" -C "$restore_dir"
rsync -az --delete \
  --exclude .env --exclude .git --exclude node_modules \
  --exclude '.codex-*' --exclude backups --exclude .research-data \
  --exclude .ruff_cache --exclude .pytest_cache --exclude .mypy_cache \
  --exclude .turbo --exclude .benchmarks \
  --exclude tmp --exclude .venv --exclude __pycache__ \
  --exclude '*.egg-info' --exclude '*.pyc' --exclude dist \
  "$restore_dir/" /Users/admin/jester-analytics/

cd /Users/admin/jester-analytics
/Users/admin/.orbstack/bin/docker compose build api worker nginx migrate
/Users/admin/.orbstack/bin/docker compose run --rm migrate
/Users/admin/.orbstack/bin/docker compose up -d
curl -fsS http://localhost:8090/health
```

Database restoration is a separate, destructive incident-recovery decision. Use the matching
`database.sql.gz` only after confirming that a forward migration changed persisted data in a way
the restored application cannot read; do not make database rollback part of the normal app-tier
rollback.

---

## First-time / fresh server bring-up

```bash
cd ~/jester-analytics
# 1. Create .env (mode 600) with all vars above — generate secrets on-box:
#    openssl rand -hex 32   (for BETTER_AUTH_SECRET / JESTER_MASTER_KEY / AGENT_API_KEY / POSTGRES_PASSWORD)
umask 077 && $EDITOR .env

# 2. Build everything and start:
docker compose build
docker compose up -d          # migrate runs automatically before api/worker

# 3. Create the first admin user:
docker compose exec -e ADMIN_EMAIL=ryan@wisco.wine -e ADMIN_NAME="Ryan" \
  api pnpm --filter @framework/api create-first-user
#    (ADMIN_PASSWORD passed via stdin/env — never on the command line in shared history)

# 4. Verify /health, then log in at the LAN URL before wiring the tunnel.
```

---

## Cloudflare Tunnel (public HTTPS)

- Tunnel name **`jester`** (id `5ade9991-e828-4f45-ac97-bf59b8041334`), zone **wisco.wine**.
- Config: `~/.cloudflared/jester-config.yml` — routes `jester.wisco.wine` → `http://localhost:8090`.
- Runs under launchd: `~/Library/LaunchAgents/com.jester.cloudflared.plist` (KeepAlive), mirroring
  the homelab / edassess / pulse tunnels already on this box.

Ops:

```bash
launchctl list | grep cloudflared                       # is it loaded?
launchctl unload ~/Library/LaunchAgents/com.jester.cloudflared.plist   # stop
launchctl load   ~/Library/LaunchAgents/com.jester.cloudflared.plist   # start
tail -f ~/.cloudflared/jester.log                       # (if logging enabled in the plist)
```

If login breaks with **"Invalid origin"** after a URL change: the origin must be in
`TRUSTED_ORIGINS` (see env table). `auth.ts` merges that comma-separated list into Better Auth's
trusted origins; update `.env` and `docker compose up -d api`.

---

## Background jobs (worker)

Registered repeatables (`apps/api/src/jobs/queue.ts`, upserted on every worker start):

| Job | Schedule | What it does |
| --- | --- | --- |
| `heartbeat` | every 5 min | SSE liveness ping |
| `rescreen` | daily 06:15 UTC | Re-evaluates every auto-rescreen screen and refreshes its alert diff |

Sweep cells run on the `backtest-cell` queue at **concurrency 5** (limiter 5/sec) against Jester's
async `/backtests` queue. Cache hits are free; only fresh cells hit Jester.

---

## Common ops

```bash
# Logs
docker compose logs -f api
docker compose logs -f worker

# Restart just the app tier (after an .env change)
docker compose up -d api worker

# psql access (no exposed port)
docker compose exec postgres psql -U app -d app

# Redis / queue peek
docker compose exec redis redis-cli
docker compose exec redis redis-cli keys 'bull:*'

# Full restart
docker compose down && docker compose up -d

# Disk: prune old build layers (safe; keeps volumes)
docker image prune -f
```

### Backups

The state that matters lives in the `postgres_data` volume (warehouse, users, screens, credentials).

```bash
docker compose exec -T postgres pg_dump -U app app | gzip > ~/jester-backup-$(date +%F).sql.gz
```

Restore into a fresh DB with `gunzip -c … | docker compose exec -T postgres psql -U app -d app`.

---

## Safety invariants (do not weaken)

- **Analysis-only.** Every outbound Jester call passes through `services/jester-allowlist.ts`
  (fail-closed). Mutating tools are hard-blocked; the app can never place an order or move funds.
- **Per-user keys are encrypted at rest** with `JESTER_MASTER_KEY` and only decrypted at call time.
- Postgres and Redis have **no host ports** — reachable only on the docker network.
