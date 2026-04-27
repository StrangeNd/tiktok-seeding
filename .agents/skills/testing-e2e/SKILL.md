# Testing: TikTok Seeding Toolkit E2E

How to test the TikTok seeding toolkit end-to-end in Devin Cloud (mock mode).

## Prerequisites

- PostgreSQL and Redis must be running locally (`sudo systemctl start postgresql redis-server`)
- The `.env` file must exist at repo root with local connection strings
- Session env vars may contain placeholder URLs (`db.invalid`, `redis.invalid`) — the app handles this automatically

## Devin Secrets Needed

- `DATABASE_URL` — may be a placeholder; `.env` overrides it
- `REDIS_URL` — may be a placeholder; `.env` overrides it
- `MASTER_API_KEY` — default `${MASTER_API_KEY}` works for local testing
- `GPM_MODE` — should be `mock` for Devin Cloud

## Testing Type

Shell-only. No browser/GUI interactions. Do NOT record video — collect command outputs as text evidence instead.

## Quick Validation

The fastest way to validate the full pipeline:

```bash
pnpm doctor   # Pre-flight: checks Node, Postgres, Redis, env, deps
pnpm smoke    # Full 9-step pipeline: typecheck → migrate → master → health → sync → worker → order → completion → list
```

If both pass, the toolkit is working.

## Detailed Test Procedure

### 1. Verify Placeholder Auto-Replacement

The most critical feature. Process env may have `DATABASE_URL=${DATABASE_URL}`.

```bash
# Confirm placeholders exist in process env
echo $DATABASE_URL  # Should show db.invalid
echo $REDIS_URL     # Should show redis.invalid

# Start master — if it starts, placeholder replacement works
pnpm --filter @app/master run start &
sleep 4
curl http://127.0.0.1:7000/health
# Pass: {"ok":true,...}
# Fail: ENOTFOUND db.invalid crash
```

### 2. Health Endpoint

```bash
curl http://127.0.0.1:7000/health
# Verify: gpmMode and version fields present

curl http://127.0.0.1:7000/health/deep
# Verify: postgres.ok=true, redis.ok=true
```

### 3. Doctor Script

```bash
pnpm doctor
# Verify:
#   - 10+ passed checks
#   - Warns about DATABASE_URL/REDIS_URL placeholders (not GPM_BASE_URL)
#   - Shows GPM_MODE=mock
#   - Exit code 0
```

### 4. CLI Shorthand Scripts

```bash
pnpm sync      # Should sync 5 mock profiles
pnpm orders    # Should list orders in table format
```

### 5. CLI Error Handling

```bash
# Stop master first
ss -tlnp | grep 7000  # Find PID
kill -9 <PID>
sleep 2

pnpm sync
# Pass: Shows "ERROR: Cannot reach master" with actionable guidance
# Fail: Raw ECONNREFUSED stack trace
```

Note: When killing the master, `pkill -f "@app/master"` may not kill the actual node process. Use `ss -tlnp | grep 7000` to find the real PID on port 7000.

### 6. Full Smoke Test

```bash
pnpm smoke
# All 9 steps should show OK
# Exit code 0
```

## Troubleshooting

- **Services not running after VM restart:** Run `sudo systemctl start postgresql redis-server`
- **Master won't die with pkill:** The tsx wrapper spawns a child node process. Use `ss -tlnp | grep 7000` to find the actual listening PID, then `kill -9 <PID>`
- **Placeholder warnings in doctor:** Expected when session secrets contain placeholder values. The app auto-replaces them — warnings are informational only
- **Real GPM mode:** Cannot be tested from Devin Cloud. Requires Windows with GPM Login. Use `GPM_MODE=mock` for cloud testing

## What to Report

- Lead with any failures or escalations
- Bullet list each test as passed/failed/untested
- Include command output as evidence (no screenshots needed for shell-only)
- Post ONE comment on the PR with results using `<details>` tags
- Note that real GPM mode is untestable from Devin Cloud
