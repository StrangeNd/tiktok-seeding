# RUNBOOK — Local Windows Operator

The day-to-day playbook for running this worktree on a Windows host with real
PostgreSQL, Redis/Memurai, and GPM Login.

> **Scope**: a single Windows machine in dev / pre-prod mode. Multi-machine
> production deployment is in `OPERATIONS.md`.

---

## 1. One-time setup

Prerequisites (covered in `PHASE1_SETUP.md`):

- Node.js >= 20 (`node --version`)
- pnpm 9.12+ (`corepack enable; corepack prepare pnpm@9.12.0 --activate`)
- PostgreSQL 14+ with database `seeding`, user `postgres` / pass `postgres`
- Redis or Memurai listening on `127.0.0.1:6379`
- GPM Login Global running on `127.0.0.1:9495` with at least 1 profile

Bootstrap the worktree:

```powershell
# From the worktree root
Copy-Item .env.example .env       # only if .env doesn't exist
pnpm install
pnpm db:generate                  # idempotent
pnpm db:migrate                   # idempotent
```

---

## 2. Day-to-day operator commands

All commands run from the worktree root.

| Command                | What it does                                                                 |
|------------------------|------------------------------------------------------------------------------|
| `pnpm setup:win`       | First-time setup: env stub, install, build, migrate, doctor                  |
| `pnpm doctor`          | Pre-flight: Node, pnpm, .env, Postgres, Redis, GPM, port :7000, dashboard    |
| `pnpm build`           | Builds dashboard plus compiled master/worker/workspace package dist artifacts |
| `pnpm start:all`       | Runs `doctor`, then starts compiled master + worker with `node`              |
| `pnpm start:all:dev`   | Maintainer-only source/dev runtime using `tsx`                               |
| `pnpm dashboard`       | Development-only Vite dashboard on `DASHBOARD_PORT` (default :5173)          |
| `pnpm status`          | Non-hanging health, port owner, repo ownership, worker PIDs, dashboard URL   |
| `pnpm ports`           | Port diagnostics using `Get-NetTCPConnection` plus `netstat` fallback        |
| `pnpm logs`            | Tail master/worker logs from `.runtime/`                                     |
| `pnpm backup`          | Create `.env`, `.secrets/`, and Postgres backup under `.backups/`            |
| `pnpm restore`         | Restore selected backup parts from `.backups/`                               |
| `pnpm update`          | Backup, fast-forward, install, build, migrate                                |
| `pnpm stop:all`        | Stop master + worker + repo-owned orphan runtime processes                   |
| `pnpm close:all`       | Hard close all repo-owned runtime processes and clear PID files              |
| `pnpm kill:runtime`    | Alias for `pnpm close:all`                                                   |
| `pnpm restart:all`     | `stop:all` then `start:all`                                                  |
| `pnpm release:check`   | Install/typecheck/lint/build validation for release readiness                |
| `pnpm reset:profiles`  | Calls master `/admin/reset-stuck-profiles` to release orphan `in_use` rows   |
| `pnpm shortcuts:create` | Creates desktop shortcuts for start/stop/restart/close/dashboard/logs/backup |
| `pnpm pm2:start`       | Optional PM2 compiled-runtime start helper                                   |
| `pnpm pm2:status`      | Optional PM2 status helper                                                   |
| `pnpm pm2:logs`        | Optional PM2 logs helper                                                     |
| `pnpm pm2:stop`        | Optional PM2 stop/remove helper                                              |

Power-user flags:

```powershell
pnpm start:all -- -SkipDoctor       # skip pre-flight (faster restarts)
pnpm start:all:dev                  # explicit source/dev runtime
pnpm start:all -- -OnlyMaster       # leave worker alone
pnpm stop:all  -- -Force            # immediate taskkill /F /T (no graceful)
pnpm close:all                      # hard close repo-owned stale runtime
```

> Note the `--` separator: pnpm forwards everything after it to the script.

Production-like dashboard URL after `pnpm start:all`:

```text
http://127.0.0.1:7000/dashboard/
```

If `MASTER_PORT` differs, replace `7000` with the configured port.

Default operator runtime entrypoints:

```powershell
node apps/master/dist/index.js
node apps/worker/dist/index.js
```

---

## 3. Files the operator scripts manage

```
.runtime/                  (gitignored)
├── master.pid             ← PID of the cmd.exe wrapper that spawned master
├── master.log             ← stdout
├── master.err.log         ← stderr
├── worker.pid
├── worker.log
└── worker.err.log
```

Each `pnpm start:all` truncates the `*.log` files; tail them in another shell:

```powershell
Get-Content .runtime\master.log -Wait
Get-Content .runtime\worker.log -Wait
```

---

## 4. Typical happy-path session

```powershell
pnpm build                                     # compiled dist artifacts
pnpm doctor                                    # everything green
pnpm start:all                                 # compiled master + worker up

pnpm --filter @app/cli run sync-profiles
pnpm --filter @app/cli run create-order -- --url=https://www.tiktok.com/@tiktok/live --count=2 --watch=20 --spread=3
pnpm --filter @app/cli run list-orders
pnpm --filter @app/cli run list-orders -- --id=1

pnpm status                                    # verify everything still healthy

pnpm stop:all                                  # clean shutdown
```

The same actions are available through desktop shortcuts after:

```powershell
pnpm shortcuts:create
```

Use **Start TikTok Seeding** for normal startup, **Stop TikTok Seeding** for normal shutdown, **Restart TikTok Seeding** for a fresh restart, **Close TikTok Seeding** for hard close, **Open TikTok Seeding Dashboard** for the dashboard, and **TikTok Seeding Logs** for log tails.

Dashboard login uses local users. The first registered dashboard user becomes admin. See `docs/DASHBOARD.md` for roles, account/proxy import, mailbox OAuth2 code retrieval, and security notes.

---

## 5. Crash recovery (what got hardened)

### 5.1 Stuck `in_use` profiles after a crash

The master holds profiles in `in_use` while their job runs. If the master or
worker dies mid-job, those rows can stay leased forever.

**Defense in depth:**

1. **Automatic on master startup** — `apps/master/src/index.ts` calls
   `resetStuckProfiles()` before binding the HTTP port. It only releases
   profiles whose linked jobs are ALL in terminal state, so it is safe even if
   a worker is still mid-job (that job's row is `running` and stays leased).
2. **On-demand** — `pnpm reset:profiles` calls
   `POST /admin/reset-stuck-profiles`. Idempotent. Use this if you ran a load
   test and want to release stragglers without restarting master.

### 5.2 Job hangs in Puppeteer / GPM forever

`apps/worker/src/job-runner.ts` now applies two timeouts:

| Stage             | Timeout                              | Result on hit            |
|-------------------|--------------------------------------|--------------------------|
| `puppeteer.connect` | 30 s                                 | `PuppeteerConnectFailed` |
| Whole job         | `watchSeconds + 90 s` (hard limit)    | `JobTimeout`             |

When the hard timeout fires, an `AbortController` aborts `liveView`'s 1-second
poll loop and the `finally` block always runs `browser.disconnect()` then
`gpm.closeProfile()`. The result is reported as `errorCode=JobTimeout` so it
shows up clearly in `pnpm --filter @app/cli run list-orders -- --id=<n>`.

### 5.3 Stale processes / port conflicts

This was the single biggest pain point before this hardening. Mitigations:

- `.runtime\master.pid` and `worker.pid` track the wrapper PID per worktree.
- `pnpm status` and `pnpm ports` show port owner PID, command line, and whether the owner belongs to this repo.
- `pnpm start:all` clears repo-owned stale `MASTER_PORT` owners before start, but fails clearly if a foreign process owns the port.
- `pnpm stop:all` stops PID-file processes, scans repo-owned `node.exe`/`cmd.exe`/PowerShell runtime wrappers, and validates runtime ports are free.
- `pnpm close:all` is the hard-close operator control. It kills all repo-owned master/worker runtime processes, removes `.runtime\*.pid`, and leaves `.env`, `.secrets`, backups, releases, and unrelated processes alone.
- `pnpm stop:all` and `pnpm close:all` only kill processes whose command line points at THIS worktree and master/worker runtime markers, so they won't disturb unrelated Node processes.

If the dashboard acts stale after a code update:

```powershell
pnpm status
pnpm ports
pnpm close:all
pnpm start:all
```

To inspect the port manually:

```powershell
netstat -ano | findstr ":7000"
```

Never kill an unrelated process blindly. If the PID is foreign, stop the owning application or change `MASTER_PORT`.

---

## 6. Troubleshooting

| Symptom                                              | Action                                                                        |
|------------------------------------------------------|-------------------------------------------------------------------------------|
| `pnpm doctor` says port :7000 occupied by foreign PID | `pnpm ports`; if foreign, do not kill blindly. Stop the owning app or change `MASTER_PORT`. |
| Dashboard/API looks like old code                     | `pnpm status`, `pnpm ports`, `pnpm close:all`, then `pnpm start:all`.         |
| `pnpm start:all` hangs at "Waiting for master /health" | `Get-Content .runtime\master.err.log -Tail 40`. Common: bad `DATABASE_URL`.   |
| Profiles stuck `in_use` after crash                  | `pnpm reset:profiles` (or just restart master — it auto-recovers on startup). |
| `JobTimeout` errors in list-orders                   | Increase `watchSeconds` budget OR check GPM Login UI for stuck profiles.      |
| `ProfileInUse` errors                                | A previous tab didn't close. `pnpm reset:profiles` then retry.                |
| Worker logs show heartbeat failing                   | Master is down or `MASTER_API_KEY` mismatch between `.env` and master.        |
| `pnpm status` shows worker PID file but no live node | Worker crashed; `pnpm start:all -- -OnlyWorker` to relaunch it.               |
| Dashboard login fails                                | Verify master is up, browser points at :7000, and the user is active.          |
| First dashboard login has no users                   | Open `/dashboard/register`; the first registered user becomes admin.          |
| Mail code returns `provider_unsupported`             | Set `MAIL_PROVIDER=microsoft` for Microsoft Graph or keep `custom` disabled.  |
| Mail code returns `missing_oauth`                    | Account row lacks email, mailbox refresh token, or mailbox client id.         |
| Mail code returns `token_failed`                     | Refresh token/client id/scope is invalid or revoked. Re-authorize mailbox.    |
| Mail code returns `code_not_found`                   | No 4-8 digit code in recent messages; adjust lookback/sender/subject filters. |

---

## 7. Where things live

```
scripts/windows/
├── _common.ps1          shared helpers (env parser, PID file IO, port check…)
├── doctor.ps1           pre-flight
├── start.ps1            spawn detached compiled master + worker
├── stop.ps1             graceful then force tree-kill, scoped to this worktree
├── close.ps1            hard close all repo-owned runtime processes
├── restart.ps1          stop + start
├── status.ps1           one-screen overview
├── ports.ps1            netstat-backed port diagnostics
└── reset-profiles.ps1   wraps /admin/reset-stuck-profiles
├── create-shortcuts.ps1 creates desktop shortcuts
├── pm2-*.ps1            optional PM2 service-style helpers

apps/master/src/services/recovery.ts   # the SQL that releases stuck profiles
apps/worker/src/job-runner.ts          # hard timeout + connect timeout
docs/DASHBOARD.md                      # operator UI + import/mailbox guide
.secrets/README.md                     # local-only sensitive input rules
```

---

## 8. Release packaging and PM2

Create a source-minimized local release folder:

```powershell
pnpm package:local
```

The output is:

```text
.releases\tiktok-seeding-YYYYMMDD-HHMMSS\
```

The release includes compiled `dist/` artifacts, dashboard `dist/`, Windows scripts, ecosystem configs, docs, `.env.example`, and example-only `.secrets` files. It excludes `.git/`, `.env`, real `.secrets/accounts.txt`, real `.secrets/proxies.txt`, `.runtime/`, `.backups/`, source folders where compiled output is enough, logs, and raw account/proxy data.

For optional PM2 runtime:

```powershell
pnpm build
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
pm2 save
```

Use `pm2 startup` only if the operator intentionally chooses machine startup integration.

Stop/remove PM2:

```powershell
pm2 stop ecosystem.config.cjs
pm2 delete ecosystem.config.cjs
```

## 9. Backup, update, and rollback

Backup before updates or release switches:

```powershell
pnpm backup
```

Backups may include `.env`, `.secrets/`, and database dumps; protect `.backups/` as sensitive data.

Update a repo checkout:

```powershell
pnpm stop:all
pnpm backup
pnpm update
pnpm release:check
pnpm start:all
```

Release-folder rollback means stopping the current release folder and starting the previous known-good release folder with the same local `.env` and database.

Security notes:

- Source-minimized release packaging is operational hiding, not impossible reverse-engineering protection.
- Do not distribute `.env` or real `.secrets/*`.
- Keep `CREDENTIALS_ENCRYPTION_KEY` stable.
- Change the default `MASTER_API_KEY` before production-like use.

## 10. What is intentionally NOT automated yet

- PM2 / NSSM as a Windows Service (referenced in `OPERATIONS.md` for prod;
  out of scope for the operator-on-laptop workflow this runbook covers).
- Log rotation. `*.log` files are truncated on every `start:all`.
- Automated cleanup of zombie GPM browser windows that GPM Login itself loses
  track of — handle manually inside the GPM UI for now.
- Cross-worktree process discovery — `pnpm stop:all` is intentionally scoped
  to this worktree only, so other Cascade sessions are never disturbed.
- TikTok login / re-auth end-to-end. The dashboard can retrieve a mailbox code
  for an owned account after a manual click, but it never submits that code or
  automates platform login/bypass flows.
