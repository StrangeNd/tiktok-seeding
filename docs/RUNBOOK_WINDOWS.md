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
| `pnpm doctor`          | Pre-flight: Node, pnpm, .env, Postgres, Redis, GPM, port :7000               |
| `pnpm start:all`       | Runs `doctor`, then starts master + worker as detached processes             |
| `pnpm status`          | Process state, port, /health/deep, heartbeat, profile pool, recent log tails |
| `pnpm stop:all`        | Graceful taskkill /T of master + worker + orphan node.exe in this worktree   |
| `pnpm restart:all`     | `stop:all` then `start:all`                                                  |
| `pnpm reset:profiles`  | Calls master `/admin/reset-stuck-profiles` to release orphan `in_use` rows   |

Power-user flags:

```powershell
pnpm start:all -- -SkipDoctor       # skip pre-flight (faster restarts)
pnpm start:all -- -OnlyMaster       # leave worker alone
pnpm stop:all  -- -Force            # immediate taskkill /F /T (no graceful)
```

> Note the `--` separator: pnpm forwards everything after it to the script.

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
pnpm doctor                                    # everything green
pnpm start:all                                 # master + worker up

pnpm --filter @app/cli run sync-profiles
pnpm --filter @app/cli run create-order -- --url=https://www.tiktok.com/@tiktok/live --count=2 --watch=20 --spread=3
pnpm --filter @app/cli run list-orders
pnpm --filter @app/cli run list-orders -- --id=1

pnpm status                                    # verify everything still healthy

pnpm stop:all                                  # clean shutdown
```

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
- `pnpm doctor` flags port `:7000` if held by a foreign PID.
- `pnpm start:all` refuses to start if PID file points at a live process
  (idempotent — re-running is safe).
- `pnpm stop:all` uses `taskkill /T` to kill the whole process tree (cmd.exe
  → pnpm → node + tsx loader). It also scans for orphan `node.exe` whose
  command line includes this worktree path and kills those too — covering the
  case where the wrapper exited but its tsx-loaded child kept running.
- `pnpm stop:all` only kills processes whose command line points at THIS
  worktree, so it won't disturb other Cascade sessions / worktrees on the
  same machine.

---

## 6. Troubleshooting

| Symptom                                              | Action                                                                        |
|------------------------------------------------------|-------------------------------------------------------------------------------|
| `pnpm doctor` says port :7000 occupied by foreign PID | `pnpm stop:all` (uses our PID file). If that fails: `taskkill /F /PID <n>`.   |
| `pnpm start:all` hangs at "Waiting for master /health" | `Get-Content .runtime\master.err.log -Tail 40`. Common: bad `DATABASE_URL`.   |
| Profiles stuck `in_use` after crash                  | `pnpm reset:profiles` (or just restart master — it auto-recovers on startup). |
| `JobTimeout` errors in list-orders                   | Increase `watchSeconds` budget OR check GPM Login UI for stuck profiles.      |
| `ProfileInUse` errors                                | A previous tab didn't close. `pnpm reset:profiles` then retry.                |
| Worker logs show heartbeat failing                   | Master is down or `MASTER_API_KEY` mismatch between `.env` and master.        |
| `pnpm status` shows worker PID file but no live node | Worker crashed; `pnpm start:all -- -OnlyWorker` to relaunch it.               |

---

## 7. Where things live

```
scripts/windows/
├── _common.ps1          shared helpers (env parser, PID file IO, port check…)
├── doctor.ps1           pre-flight
├── start.ps1            spawn detached master + worker
├── stop.ps1             graceful then force tree-kill, scoped to this worktree
├── restart.ps1          stop + start
├── status.ps1           one-screen overview
└── reset-profiles.ps1   wraps /admin/reset-stuck-profiles

apps/master/src/services/recovery.ts   # the SQL that releases stuck profiles
apps/worker/src/job-runner.ts          # hard timeout + connect timeout
```

---

## 8. What is intentionally NOT automated yet

- PM2 / NSSM as a Windows Service (referenced in `OPERATIONS.md` for prod;
  out of scope for the operator-on-laptop workflow this runbook covers).
- Log rotation. `*.log` files are truncated on every `start:all`.
- Automated cleanup of zombie GPM browser windows that GPM Login itself loses
  track of — handle manually inside the GPM UI for now.
- Cross-worktree process discovery — `pnpm stop:all` is intentionally scoped
  to this worktree only, so other Cascade sessions are never disturbed.
