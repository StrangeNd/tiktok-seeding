#!/usr/bin/env bash
# Smoke test: typecheck, DB migration, service startup, profile sync, small order.
# Runs in mock GPM mode by default. Pass GPM_MODE=live to test against real GPM.
# Usage: bash scripts/smoke-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Local overrides — safe for CI / Devin cloud
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/seeding}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export GPM_MODE="${GPM_MODE:-mock}"
export GPM_ENDPOINT="${GPM_ENDPOINT:-http://127.0.0.1:19500}"
export GPM_API_PREFIX="${GPM_API_PREFIX:-/api/v1}"
export MASTER_API_KEY="${MASTER_API_KEY:-dev-key-change-me}"
export MASTER_PORT="${MASTER_PORT:-7000}"
export WORKER_NAME="${WORKER_NAME:-worker-smoke}"
export CONCURRENCY="${CONCURRENCY:-2}"
export NODE_ENV=development
export LOG_LEVEL=info

PASS=0
FAIL=0
STEPS=()

step_ok()   { PASS=$((PASS + 1)); STEPS+=("OK   $1"); echo "  OK   $1"; }
step_fail() { FAIL=$((FAIL + 1)); STEPS+=("FAIL $1"); echo "  FAIL $1"; }

cleanup() {
  echo ""
  echo "--- Cleaning up ---"
  [ -n "${MASTER_PID:-}" ] && kill "$MASTER_PID" 2>/dev/null && wait "$MASTER_PID" 2>/dev/null || true
  [ -n "${WORKER_PID:-}" ] && kill "$WORKER_PID" 2>/dev/null && wait "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Smoke Test (GPM_MODE=$GPM_MODE) ==="
echo ""

# ── Step 1: Typecheck ──────────────────────────────────────────────
echo "--- Step 1: Typecheck ---"
if pnpm typecheck >/dev/null 2>&1; then
  step_ok "typecheck"
else
  step_fail "typecheck"
fi

# ── Step 2: DB migration ──────────────────────────────────────────
echo "--- Step 2: DB migration ---"
if pnpm db:migrate 2>&1 | tail -2; then
  step_ok "db:migrate"
else
  step_fail "db:migrate"
fi

# ── Step 3: Start master ──────────────────────────────────────────
echo "--- Step 3: Start master ---"
pnpm --filter @app/master run start > /tmp/master.log 2>&1 &
MASTER_PID=$!
sleep 3

if curl -sf http://127.0.0.1:"$MASTER_PORT"/health > /dev/null 2>&1; then
  step_ok "master started (PID $MASTER_PID)"
else
  step_fail "master start (check /tmp/master.log)"
  cat /tmp/master.log | tail -20
fi

# ── Step 4: Profile sync ──────────────────────────────────────────
echo "--- Step 4: Profile sync ---"
SYNC_OUT=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $MASTER_API_KEY" \
  -d '{}' \
  http://127.0.0.1:"$MASTER_PORT"/admin/sync-profiles 2>&1) || true

if echo "$SYNC_OUT" | grep -q '"upserted"'; then
  UPSERTED=$(echo "$SYNC_OUT" | grep -o '"upserted":[0-9]*' | cut -d: -f2)
  step_ok "profile sync (upserted=$UPSERTED)"
else
  step_fail "profile sync: $SYNC_OUT"
fi

# ── Step 5: Start worker ──────────────────────────────────────────
echo "--- Step 5: Start worker ---"
pnpm --filter @app/worker run start > /tmp/worker.log 2>&1 &
WORKER_PID=$!
sleep 3

if kill -0 "$WORKER_PID" 2>/dev/null; then
  step_ok "worker started (PID $WORKER_PID)"
else
  step_fail "worker start (check /tmp/worker.log)"
  cat /tmp/worker.log | tail -20
fi

# ── Step 6: Create a small order ───────────────────────────────────
echo "--- Step 6: Create small order ---"
ORDER_OUT=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $MASTER_API_KEY" \
  -d '{"type":"live_view","targetUrl":"https://www.tiktok.com/@tiktok/live","count":2,"watchSeconds":10,"spreadSeconds":0}' \
  http://127.0.0.1:"$MASTER_PORT"/orders 2>&1) || true

if echo "$ORDER_OUT" | grep -q '"orderId"'; then
  ORDER_ID=$(echo "$ORDER_OUT" | grep -o '"orderId":[0-9]*' | cut -d: -f2)
  step_ok "order created (id=$ORDER_ID)"
else
  step_fail "create order: $ORDER_OUT"
fi

# ── Step 7: Wait for jobs to finish (mock mode should be fast) ────
if [ "$GPM_MODE" = "mock" ] && [ -n "${ORDER_ID:-}" ]; then
  echo "--- Step 7: Wait for mock jobs ---"
  for i in $(seq 1 15); do
    sleep 2
    STATUS_OUT=$(curl -sf \
      -H "X-API-Key: $MASTER_API_KEY" \
      http://127.0.0.1:"$MASTER_PORT"/orders/"$ORDER_ID" 2>&1) || true
    DONE=$(echo "$STATUS_OUT" | grep -o '"completedJobs":[0-9]*' | cut -d: -f2)
    FAILED=$(echo "$STATUS_OUT" | grep -o '"failedJobs":[0-9]*' | cut -d: -f2)
    STATUS=$(echo "$STATUS_OUT" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "    poll $i: status=$STATUS done=$DONE fail=$FAILED"
    if [ "$STATUS" = "done" ]; then
      break
    fi
  done
  if [ "${STATUS:-}" = "done" ]; then
    step_ok "order $ORDER_ID finished (done=$DONE fail=$FAILED)"
  else
    step_fail "order $ORDER_ID did not finish in time (status=${STATUS:-unknown})"
  fi
else
  echo "--- Step 7: Skipped (live mode or no order) ---"
fi

# ── Step 8: List orders ────────────────────────────────────────────
echo "--- Step 8: List orders ---"
LIST_OUT=$(curl -sf \
  -H "X-API-Key: $MASTER_API_KEY" \
  http://127.0.0.1:"$MASTER_PORT"/orders 2>&1) || true

if echo "$LIST_OUT" | grep -q '"orders"'; then
  step_ok "list orders"
else
  step_fail "list orders: $LIST_OUT"
fi

# ── Summary ────────────────────────────────────────────────────────
echo ""
echo "=== Smoke Test Summary ==="
for s in "${STEPS[@]}"; do
  echo "  $s"
done
echo ""
echo "  Passed: $PASS   Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "SMOKE TEST FAILED"
  exit 1
fi
echo ""
echo "SMOKE TEST PASSED"
