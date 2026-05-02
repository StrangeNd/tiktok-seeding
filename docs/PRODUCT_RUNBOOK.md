# Product Runbook

This runbook is for a non-developer Windows operator running the local operator application without opening source files.

## What the product includes

- Fastify master API on `MASTER_PORT`, run from compiled `apps/master/dist/index.js` in operator mode.
- Built React dashboard served by the master at `/dashboard/`.
- BullMQ worker connected to Redis/Memurai, run from compiled `apps/worker/dist/index.js` in operator mode.
- PostgreSQL storage for profiles, orders, jobs, accounts, proxies, and encrypted secret blobs.
- Windows PowerShell scripts for setup, start, stop, restart, status, logs, backup, restore, update, shortcut creation, PM2 helpers, and release checks.
- Optional PM2 process manager configuration for auto-restart.

## First-time setup

From the repo root or release folder in PowerShell:

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
- `AUTH_SESSION_SECRET`
- `DATABASE_URL` if not using local Postgres
- `REDIS_URL` if not using local Redis/Memurai
- `GPM_ENDPOINT` and `GPM_API_PREFIX` for real GPM Login

Do not commit `.env` or real `.secrets/*` files.

## Day-to-day operator commands

| Command | Purpose |
|---|---|
| `pnpm doctor` | Pre-flight check for tools, env, DB, Redis, GPM, port, schema, dashboard build. |
| `pnpm build` | Build dashboard, master, worker, and required workspace package dist artifacts. |
| `pnpm start:all` | Start compiled master and worker as detached local processes. |
| `pnpm start:all:dev` | Maintainer-only source/dev runtime using `tsx`. |
| `pnpm status` | Show health, workers, queues, profile/order/job counts, warnings, and recent logs. |
| `pnpm ports` | Show configured/common runtime port owners, command lines, and safe action guidance. |
| `pnpm logs` | Print recent master and worker logs. |
| `pnpm logs -- -Follow` | Follow logs live. |
| `pnpm restart:all` | Stop and start master/worker safely. |
| `pnpm stop:all` | Stop master/worker for this checkout. |
| `pnpm close:all` | Hard close repo-owned runtime processes, clear PID files, and free repo-owned runtime ports. |
| `pnpm kill:runtime` | Alias for `pnpm close:all`. |
| `pnpm backup` | Create a timestamped backup under `.backups/`. |
| `pnpm restore -- -BackupPath .backups\YYYYMMDD-HHMMSS -RestoreEnv -RestoreSecrets -RestoreDatabase` | Restore selected backup parts. |
| `pnpm update` | Backup, fast-forward current branch, install, build, and migrate. |
| `pnpm package:local` | Create `.releases/tiktok-seeding-YYYYMMDD-HHMMSS/`. |
| `pnpm release:check` | Run package JSON, secret guardrail, typecheck, lint, build, PM2, package, and release exclusion checks. |

## Development mode

Development mode is for maintainers working from source:

```powershell
pnpm install
pnpm start:all:dev
```

This uses `tsx` and source files. Operators should use production/operator mode instead.

## Production/operator mode

Production/operator mode runs compiled JavaScript with `node`:

```powershell
pnpm install
pnpm build
pnpm start:all
```

The master entrypoint is:

```powershell
node apps/master/dist/index.js
```

The worker entrypoint is:

```powershell
node apps/worker/dist/index.js
```

`pnpm start:all` fails with an actionable message if required dist artifacts are missing.

## Open the dashboard

After `pnpm start:all`, open:

```text
http://127.0.0.1:7000/dashboard/
```

If `MASTER_PORT` differs in `.env`, replace `7000` with that port.

Create the first dashboard user from **Register**. The first registered user becomes `admin`. Later self-registered users become `user` accounts and may require admin approval if `AUTH_REQUIRE_ADMIN_APPROVAL=true`.

Dashboard sessions use HttpOnly cookies. Raw account, mailbox, cookie, auth, and proxy secrets are never returned to the dashboard.

## Desktop shortcuts and stale runtime recovery

Create daily-use shortcuts:

```powershell
pnpm shortcuts:create
```

The shortcuts are:

- **Start TikTok Seeding**
- **Stop TikTok Seeding**
- **Restart TikTok Seeding**
- **Close TikTok Seeding**
- **Open TikTok Seeding Dashboard**
- **TikTok Seeding Logs**
- **TikTok Seeding Backup**

Use **Close TikTok Seeding** or `pnpm close:all` when the dashboard or API appears stale after an update. Stale `node.exe` processes can keep port `7000` or a validation port open and make requests hit old code. Diagnose with:

```powershell
pnpm status
pnpm ports
netstat -ano | findstr ":7000"
```

Then recover safely:

```powershell
pnpm close:all
pnpm start:all
```

The close/stop scripts kill only repo-owned master/worker runtime processes. If a port is held by a foreign process, they report it and leave it alone.

## Managing operator data

Use dashboard pages:

- **Overview** for high-level health and summaries.
- **Profiles** to sync and inspect GPM profiles.
- **Accounts** to import owned account records and manually retrieve mailbox codes.
- **Proxies** to import and test neutral proxy connectivity.
- **Orders** to create and inspect orders.
- **Activity** to inspect jobs.
- **Admin** for health and safe recovery actions.
- **Users** for admin-only user management.
- **Audit** for safe operational audit logs.
- **Settings** for local browser dashboard settings.

Mailbox code retrieval is operator-assisted only. It reads an owned mailbox through OAuth2, returns the code to the operator, and does not automate TikTok login or submit codes.

## Roles and permissions

- **Admin**: full local operator access, including user management, audit logs, account/proxy import, order creation, and recovery actions.
- **User**: login, dashboard/status/log viewing, order creation, account import, and masked account/proxy viewing.

Users cannot manage users or run recovery actions. Users can import proxies only when `USER_CAN_IMPORT_PROXIES=true`.

Passwords are stored as `scrypt` hashes. This local role system is suitable for private/operator use, not a complete internet-facing identity platform.

## Proxy assignment

Account/proxy assignment is deterministic round-robin. Rebalance orders accounts by account id and proxies by proxy id, then assigns accounts across available proxies.

The dashboard shows proxy assignment counts and assigned proxy labels only. Proxy passwords and account secrets remain encrypted and are not returned by the API.

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

Backup scripts do not print secret contents. `.backups/` is gitignored. Backups may contain `.env` and encrypted/local secret inputs, so protect backup folders as sensitive operator data.

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

For release-folder deployment, update by creating or receiving a new `.releases/tiktok-seeding-YYYYMMDD-HHMMSS/` folder, copying local `.env`/authorized local secret inputs into that release folder, running `pnpm install --prod`, then starting from that folder. Roll back by stopping the current release and starting the previous known-good release folder with the same `.env` and database.

## Release packaging

Create a local release folder:

```powershell
pnpm package:local
```

The release appears at:

```text
.releases\tiktok-seeding-YYYYMMDD-HHMMSS\
```

It includes compiled runtime artifacts, dashboard dist, Windows operator scripts, PM2 configs, database migrations under `apps/master/drizzle`, selected docs, `.env.example`, `.secrets/README.md`, and `.secrets/*.example.txt`.

It intentionally excludes `.git/`, `node_modules/`, source folders where compiled output is enough, `.env`, real `.secrets/*`, `.runtime/`, `.backups/`, `.local-backup/`, coverage, logs, and raw account/proxy data.

## Service mode with PM2

PM2 is optional. Do not install it silently on operator machines.

If the operator chooses PM2:

```powershell
npm install -g pm2
pnpm pm2:start
pnpm pm2:status
pnpm pm2:logs
pnpm pm2:stop
```

Only run `pm2 startup` if the operator intentionally wants PM2 to register startup services on that machine.

Create or update daily-use desktop shortcuts:

```powershell
pnpm shortcuts:create
```

The shortcuts call local package scripts and the dashboard URL. They do not embed `.env` values, API keys, auth secrets, account data, proxy credentials, cookies, refresh tokens, or passwords.

Stop/remove services:

```powershell
pm2 stop ecosystem.config.cjs
pm2 delete ecosystem.config.cjs
```

Logs are written under `.runtime/pm2-*.log` and `.runtime/pm2-*.err.log`.

## Troubleshooting

- Run `pnpm doctor` first.
- If the dashboard build is missing, run `pnpm build:dashboard`.
- If port `MASTER_PORT` is occupied, run `pnpm status` or `pnpm ports` to identify the owner. Do not kill unrelated processes blindly.
- If the dashboard acts stale, run `pnpm close:all` then `pnpm start:all`.
- If `GPM_MODE=live`, GPM Login must be running and reachable.
- If secrets fail to decrypt, confirm `CREDENTIALS_ENCRYPTION_KEY` matches the key used during import.
- If mailbox code retrieval returns `provider_unsupported`, set `MAIL_PROVIDER=microsoft` only after configuring owned Microsoft mailbox OAuth2 credentials.

## Security rules

- Never commit `.env`.
- Never commit real `.secrets/accounts.txt` or `.secrets/proxies.txt`.
- Never paste credentials, refresh tokens, cookies, mailbox codes, or proxy passwords into chat/issues/docs.
- Replace default `MASTER_API_KEY` and `CREDENTIALS_ENCRYPTION_KEY` before production-like use.
- Keep `CREDENTIALS_ENCRYPTION_KEY` stable; changing it makes existing encrypted blobs unreadable unless you migrate/re-import.
- Keep this deployment local unless you add TLS and a stronger authentication model.
- Source-minimized release packaging is operational hiding, not impossible reverse-engineering protection.
