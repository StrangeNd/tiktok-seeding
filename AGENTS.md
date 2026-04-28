# AGENTS.md — Agent-Ready Reference

Quick-start for AI agents (Devin, Cursor, etc.) and human contributors.

## Prerequisites

| Tool       | Version   | Notes                      |
|------------|-----------|----------------------------|
| Node.js    | >= 20     | See `.nvmrc`               |
| pnpm       | 9.12+     | `corepack enable && pnpm --version` |
| PostgreSQL | 14+       | Local or remote             |
| Redis      | 6+        | Local or remote             |

## Setup (one-time)

```bash
# 1. Install system deps (Ubuntu / Devin VM)
sudo apt-get install -y postgresql redis-server
sudo systemctl start postgresql redis-server

# 2. Create DB + set password
sudo -u postgres createdb seeding
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"

# 3. Install project deps
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
pnpm install

# 4. Copy env and run migrations
cp .env.example .env
# Edit .env — see "Environment Variables" below
pnpm db:generate
pnpm db:migrate
```

Or use the all-in-one script:

```bash
bash scripts/setup-local.sh
```

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable        | Default                          | Notes                                    |
|-----------------|----------------------------------|------------------------------------------|
| `DATABASE_URL`  | `postgres://postgres:postgres@127.0.0.1:5432/seeding` | Local Postgres |
| `REDIS_URL`     | `redis://127.0.0.1:6379`        | Local Redis                              |
| `GPM_MODE`      | `live`                           | Set to `mock` when real GPM is unreachable |
| `GPM_ENDPOINT`  | `http://127.0.0.1:9495`         | GPM Login API base URL                   |
| `MASTER_PORT`   | `7000`                          | Fastify API port                         |
| `MASTER_API_KEY`| `dev-key-change-me`             | API key for master endpoints             |
| `WORKER_NAME`   | `worker-local`                  | Identifies worker in heartbeat           |
| `CONCURRENCY`   | `10`                            | Max parallel browser tabs per worker     |

### Mock GPM Mode

Set `GPM_MODE=mock` when running on Devin Cloud or any environment without
access to the Windows-only GPM Login software. The mock client provides 5 fake
profiles and simulates start/stop lifecycle so the entire pipeline (sync →
order → job execution) works end-to-end without a real browser.

## Running Services

From repo root:

```bash
pnpm master          # Start Fastify API on :7000
pnpm worker          # Start BullMQ worker (connects to master + Redis)
pnpm dashboard       # Start dashboard UI on :3000 (proxies API to :7000)
```

Or with pnpm filter:

```bash
pnpm --filter @app/master run dev    # dev with watch
pnpm --filter @app/worker run dev    # dev with watch
```

## CLI Commands

```bash
pnpm --filter @app/cli run sync-profiles
pnpm --filter @app/cli run create-order -- --url=https://www.tiktok.com/@tiktok/live --count=2 --watch=20 --spread=3
pnpm --filter @app/cli run list-orders
```

## Type Check & Lint

```bash
pnpm typecheck       # tsc --noEmit across all packages
pnpm lint            # biome lint
pnpm check           # biome check --write (format + lint)
```

## Database

```bash
pnpm db:generate     # Generate Drizzle migration from schema changes
pnpm db:migrate      # Apply pending migrations
pnpm db:studio       # Open Drizzle Studio GUI
```

## Smoke Test

Validates the full pipeline: typecheck → DB migration → master startup →
profile sync → worker startup → create order → wait for completion → list orders.

```bash
bash scripts/smoke-test.sh
```

Runs in `GPM_MODE=mock` by default. Override with `GPM_MODE=live` to test
against a real GPM instance.

## Project Structure

```
tiktok-seeding/
├── apps/
│   ├── master/          # Fastify API + BullMQ producer + Drizzle DB
│   ├── worker/          # BullMQ consumer + GPM + Puppeteer
│   ├── dashboard/       # React dashboard UI (Vite + Tailwind)
│   └── cli/             # CLI scripts (sync, create-order, list-orders)
├── packages/
│   ├── shared/          # Env, logger, types
│   ├── gpm-client/      # GPM API client + mock client
│   └── tiktok-actions/  # Browser automation actions (live-view)
├── scripts/
│   ├── setup-local.sh   # One-time local setup
│   └── smoke-test.sh    # End-to-end smoke test
└── docs/                # Architecture, plan, schema docs
```

## Known Blockers / Limitations

- **GPM Login is Windows-only**: Real browser automation requires GPM Login
  running on Windows machines. Use `GPM_MODE=mock` for CI and cloud agents.
- **No remote Postgres/Redis configured for Devin Cloud**: The smoke test
  uses local instances. Set `DATABASE_URL` and `REDIS_URL` for remote services
  if available.
- **Puppeteer/Chrome not available in mock mode**: The worker skips real
  browser interaction in mock mode. Live mode requires Chrome + GPM on the
  target machine.
