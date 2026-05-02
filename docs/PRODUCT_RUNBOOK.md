# Product Runbook

This runbook is for a non-developer Windows operator running the local operator application without opening source files.

## What the product includes

- Fastify master API on `MASTER_PORT`.
- Built React dashboard served by the master at `/dashboard/`.
- BullMQ worker connected to Redis/Memurai.
- PostgreSQL storage for profiles, orders, jobs, accounts, proxies, and encrypted secret blobs.
- Windows PowerShell scripts for setup, start, stop, restart, status, logs, backup, restore, update, and release checks.
- Optional PM2 process manager configuration for auto-restart.

## First-time setup

From the repo root in PowerShell:

```powershell
pnpm setup:win
```

This command:

1. Creates `.env` from `.env.example` if missing.
2. Installs dependencies.
3. Builds the dashboard and server packages.
4. Applies database migrations.
5. Runs `pnpm doctor`.

Before production-like use, edit `.env` and replace default values for:

- `MASTER_API_KEY`
- `CREDENTIALS_ENCRYPTION_KEY`
- `DATABASE_URL` if not using local Postgres
- `REDIS_URL` if not using local Redis/Memurai
- `GPM_ENDPOINT` and `GPM_API_PREFIX` for real GPM Login

Do not commit `.env` or real `.secrets/*` files.

## Day-to-day operator commands

| Command | Purpose |
|---|---|
| `pnpm doctor` | Pre-flight check for tools, env, DB, Redis, GPM, port, schema, dashboard build. |
| `pnpm start:all` | Start master and worker as detached local processes. |
| `pnpm status` | Show health, workers, queues, profile/order/job counts, warnings, and recent logs. |
| `pnpm logs` | Print recent master and worker logs. |
| `pnpm logs -- -Follow` | Follow logs live. |
| `pnpm restart:all` | Stop and start master/worker safely. |
| `pnpm stop:all` | Stop master/worker for this checkout. |
| `pnpm backup` | Create a timestamped backup under `.backups/`. |
| `pnpm restore -- -BackupPath .backups\YYYYMMDD-HHMMSS -RestoreEnv -RestoreSecrets -RestoreDatabase` | Restore selected backup parts. |
| `pnpm update` | Backup, fast-forward current branch, install, build, and migrate. |
| `pnpm release:check` | Run package JSON, conflict-marker, install, typecheck, lint, and build checks. |

## Open the dashboard

After `pnpm start:all`, open:

```text
http://127.0.0.1:7000/dashboard/
```

If `MASTER_PORT` differs in `.env`, replace `7000` with that port.

Log in using `MASTER_API_KEY` from your local `.env`. The dashboard stores the API key only in your browser local storage. Raw account, mailbox, cookie, and proxy secrets are never returned to the dashboard.

## Managing operator data

Use dashboard pages:

- **Overview** for high-level health and summaries.
- **Profiles** to sync and inspect GPM profiles.
- **Accounts** to import owned account records and manually retrieve mailbox codes.
- **Proxies** to import and test neutral proxy connectivity.
- **Orders** to create and inspect orders.
- **Activity** to inspect jobs.
- **Admin** for health and safe recovery actions.
- **Settings** for local browser dashboard settings.

Mailbox code retrieval is operator-assisted only. It reads an owned mailbox through OAuth2, returns the code to the operator, and does not automate TikTok login or submit codes.

## Backup

Run:

```powershell
pnpm backup
```

Backups go to:

```text
.backups\YYYYMMDD-HHMMSS\
```

A backup may include:

- `.env`
- `.secrets/`
- `postgres.dump` when `pg_dump` is available and `DATABASE_URL` is reachable
- optional `.runtime/` logs with `pnpm backup -- -IncludeLogs`

Backup scripts do not print secret contents. `.backups/` is gitignored.

## Restore

Restore only what you need:

```powershell
pnpm restore -- -BackupPath .backups\YYYYMMDD-HHMMSS -RestoreEnv
pnpm restore -- -BackupPath .backups\YYYYMMDD-HHMMSS -RestoreSecrets
pnpm restore -- -BackupPath .backups\YYYYMMDD-HHMMSS -RestoreDatabase
```

Existing `.env` and `.secrets/` are copied aside before replacement. Database restore uses `pg_restore --clean --if-exists` against `DATABASE_URL`.

## Update

Run:

```powershell
pnpm update
```

The update script:

1. Creates a backup unless `-SkipBackup` is passed.
2. Fetches from `origin`.
3. Requires the current branch to match the requested branch, default `main`.
4. Runs `git pull --ff-only`.
5. Installs dependencies.
6. Builds dashboard/server packages.
7. Applies migrations.

Then restart:

```powershell
pnpm restart:all
```

## Service mode with PM2

PM2 is optional. Do not install it silently on operator machines.

If the operator chooses PM2:

```powershell
npm install -g pm2
pnpm build:dashboard
pnpm build:server
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
pm2 save
```

Stop/remove services:

```powershell
pm2 stop ecosystem.config.cjs
pm2 delete ecosystem.config.cjs
```

Logs are written under `.runtime/pm2-*.log` and `.runtime/pm2-*.err.log`.

## Troubleshooting

- Run `pnpm doctor` first.
- If the dashboard build is missing, run `pnpm build:dashboard`.
- If port `MASTER_PORT` is occupied, run `pnpm status` to identify the owner. Do not kill unrelated processes blindly.
- If `GPM_MODE=live`, GPM Login must be running and reachable.
- If secrets fail to decrypt, confirm `CREDENTIALS_ENCRYPTION_KEY` matches the key used during import.
- If mailbox code retrieval returns `provider_unsupported`, set `MAIL_PROVIDER=microsoft` only after configuring owned Microsoft mailbox OAuth2 credentials.

## Security rules

- Never commit `.env`.
- Never commit real `.secrets/accounts.txt` or `.secrets/proxies.txt`.
- Never paste credentials, refresh tokens, cookies, mailbox codes, or proxy passwords into chat/issues/docs.
- Replace default `MASTER_API_KEY` and `CREDENTIALS_ENCRYPTION_KEY` before production-like use.
- Keep this deployment local unless you add TLS and a stronger authentication model.
