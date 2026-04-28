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
# All-in-one script (recommended):
bash scripts/setup-local.sh

# Or manual steps:
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

After setup, verify with:

```bash
pnpm doctor    # Pre-flight check for all dependencies
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

### Placeholder URL Handling

Cloud platforms (Devin, CI) may inject placeholder secrets with hostnames like
`db.invalid` or `redis.invalid`. The env loader detects these and automatically
replaces them with values from `.env`. No manual override needed.

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

Shorthand (from repo root):

```bash
pnpm sync                                      # Sync profiles from GPM (or mock)
pnpm order --url=https://www.tiktok.com/@tiktok/live --count=2 --watch=20 --spread=3
pnpm orders                                    # List all orders
pnpm orders --id=1                             # Order detail with jobs
```

Or with pnpm filter:

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

## Validation

### Pre-flight Check

```bash
pnpm doctor
```

Checks: Node, pnpm, Postgres, Redis, .env, password auth, dependencies, master status.

### Smoke Test

Validates the full pipeline: typecheck → DB migration → master startup →
deep health check → profile sync → worker startup → create order →
wait for completion → list orders.

```bash
pnpm smoke
```

Runs in `GPM_MODE=mock` by default. Override with `GPM_MODE=live` to test
against a real GPM instance.

## Workflows

### Mock / Cloud Workflow (Devin Cloud, CI)

1. `bash scripts/setup-local.sh` — installs deps, creates DB, runs migrations
2. `.env` is auto-created with `GPM_MODE=mock`
3. `pnpm smoke` — runs full end-to-end flow with mock GPM
4. No real browser or GPM needed

### Real / Windows / Local Workflow

1. Install GPM Login on Windows machine
2. Start GPM Login with API enabled (default port 9495)
3. Set `.env`:
   ```
   GPM_MODE=live
   GPM_ENDPOINT=http://127.0.0.1:9495
   ```
4. `pnpm master` — start the API
5. `pnpm sync` — pull real profiles from GPM
6. `pnpm worker` — start the worker
7. `pnpm order --url=https://www.tiktok.com/@username/live --count=5 --watch=60`

## Project Structure

```
tiktok-seeding/
├── apps/
│   ├── master/          # Fastify API + BullMQ producer + Drizzle DB
│   ├── worker/          # BullMQ consumer + GPM + Puppeteer
│   └── cli/             # CLI scripts (sync, create-order, list-orders)
├── packages/
│   ├── shared/          # Env, logger, types
│   ├── gpm-client/      # GPM API client + mock client + factory
│   └── tiktok-actions/  # Browser automation actions (live-view)
├── scripts/
│   ├── setup-local.sh   # One-time local setup
│   ├── doctor.sh        # Pre-flight health check
│   └── smoke-test.sh    # End-to-end smoke test
└── docs/                # Architecture, plan, schema docs
```

## Troubleshooting

### "Cannot reach master" from CLI

The master must be running before using CLI commands.

```bash
pnpm master          # Start master in one terminal
pnpm sync            # Then use CLI in another
```

### "Invalid environment variables" on startup

The env loader validates all vars via Zod. Check `.env` for typos.
Common issues:
- `DATABASE_URL` must be a valid URL (e.g. `postgres://...`)
- `REDIS_URL` must be a valid URL (e.g. `redis://...`)
- `GPM_MODE` must be `live` or `mock`

### Placeholder secrets in Devin Cloud

Session secrets may contain placeholder values (`db.invalid`, `redis.invalid`).
The app auto-detects these and replaces them with `.env` values. If you still
see errors, ensure `.env` exists with correct local URLs.

### PostgreSQL password auth fails

```bash
# Run the setup script which auto-fixes pg_hba.conf:
bash scripts/setup-local.sh
```

### Redis connection refused

```bash
sudo systemctl start redis-server
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
- **Phase 1 only**: Only `live_view` job type is implemented. Phase 2 will
  add comment, like, and other interaction types.
