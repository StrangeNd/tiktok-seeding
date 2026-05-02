# AGENTS.md — Agent-Ready Reference

Quick-start for AI agents (Devin, Cursor, etc.) and human contributors.

## Prerequisites

| Tool       | Version   | Notes                      |
|------------|-----------|----------------------------|
| Docker     | 24+       | Recommended (easiest setup)|
| Node.js    | >= 20     | See `.nvmrc` (native only) |
| pnpm       | 9.12+     | `corepack enable && pnpm --version` (native only) |
| PostgreSQL | 14+       | Local or remote (native only) |
| Redis      | 6+        | Local or remote (native only) |

## Setup — Docker (recommended)

The fastest way to get everything running:

```bash
docker compose up
```

This starts Postgres, Redis, runs DB migrations, then starts master and worker.
All services are pre-configured with mock GPM mode.

```bash
# Verify:
curl http://localhost:7000/health

# Run CLI commands against the Dockerized master:
docker compose run --rm cli sync-profiles
docker compose run --rm cli create-order -- --url=https://www.tiktok.com/@tiktok/live --count=2 --watch=20
docker compose run --rm cli list-orders

# View logs:
docker compose logs -f master worker

# Stop:
docker compose down       # keep data
docker compose down -v    # remove volumes
```

## Setup — Native (one-time)

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
│   └── cli/             # CLI scripts (sync, create-order, list-orders)
├── packages/
│   ├── shared/          # Env, logger, types
│   ├── gpm-client/      # GPM API client + mock client
│   └── tiktok-actions/  # Browser automation actions (live-view)
├── scripts/
│   ├── setup-local.sh   # One-time local setup
│   └── smoke-test.sh    # End-to-end smoke test
├── Dockerfile           # Multi-stage build (master, worker, cli targets)
├── docker-compose.yml   # Full stack: postgres + redis + master + worker
└── docs/                # Architecture, plan, schema docs
```

## Docker Targets

The `Dockerfile` uses multi-stage builds:

```bash
# Build specific target:
docker build --target master -t seeding-master .
docker build --target worker -t seeding-worker .
docker build --target cli -t seeding-cli .

# Run standalone (requires external Postgres + Redis):
docker run --env-file .env -p 7000:7000 seeding-master
```

For production with real GPM, override environment in `docker-compose.yml`:

```yaml
# docker-compose.override.yml
services:
  master:
    environment:
      GPM_MODE: live
  worker:
    environment:
      GPM_MODE: live
      GPM_ENDPOINT: http://host.docker.internal:9495
```

## Known Blockers / Limitations

- **GPM Login is Windows-only**: Real browser automation requires GPM Login
  running on Windows machines. Use `GPM_MODE=mock` for CI and cloud agents.
- **Puppeteer/Chrome not available in mock mode**: The worker skips real
  browser interaction in mock mode. Live mode requires Chrome + GPM on the
  target machine.
- **Docker worker cannot reach host GPM directly**: Use `host.docker.internal`
  or `--network host` when the worker container needs to reach GPM Login
  running on the Docker host.
