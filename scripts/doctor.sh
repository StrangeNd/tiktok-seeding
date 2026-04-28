#!/usr/bin/env bash
# Pre-flight check: verify that all required services and env vars are present.
# Usage: bash scripts/doctor.sh
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0
WARN=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  OK   $1"; }
warn() { WARN=$((WARN + 1)); echo "  WARN $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }

echo "=== Doctor — Pre-flight Check ==="
echo ""

# ── Node.js ─────────────────────────────────────────────
echo "--- Runtime ---"
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version 2>/dev/null)
  ok "Node.js $NODE_VER"
else
  fail "Node.js not found"
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_VER=$(pnpm --version 2>/dev/null)
  ok "pnpm $PNPM_VER"
else
  fail "pnpm not found (run: corepack enable)"
fi

# ── PostgreSQL ──────────────────────────────────────────
echo "--- PostgreSQL ---"
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    ok "PostgreSQL accepting connections on 127.0.0.1:5432"
  else
    fail "PostgreSQL not accepting connections on 127.0.0.1:5432"
    echo "       Fix: sudo systemctl start postgresql"
  fi
else
  fail "pg_isready not found"
  echo "       Fix: sudo apt-get install -y postgresql-client"
fi

# Check DB exists
if command -v psql >/dev/null 2>&1; then
  if PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -lqt 2>/dev/null | cut -d\| -f1 | grep -qw seeding; then
    ok "Database 'seeding' exists"
  else
    fail "Database 'seeding' not found"
    echo "       Fix: sudo -u postgres createdb seeding"
  fi

  # Check password auth works
  if PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d seeding -c "SELECT 1" >/dev/null 2>&1; then
    ok "Password auth works for postgres user"
  else
    warn "Password auth failed — may need pg_hba.conf fix"
    echo "       Fix: bash scripts/setup-local.sh"
  fi
fi

# ── Redis ───────────────────────────────────────────────
echo "--- Redis ---"
if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
    ok "Redis accepting connections on 127.0.0.1:6379"
  else
    fail "Redis not responding on 127.0.0.1:6379"
    echo "       Fix: sudo systemctl start redis-server"
  fi
else
  fail "redis-cli not found"
  echo "       Fix: sudo apt-get install -y redis-server"
fi

# ── .env file ───────────────────────────────────────────
echo "--- Environment ---"
if [ -f .env ]; then
  ok ".env file exists"
else
  fail ".env file missing"
  echo "       Fix: cp .env.example .env"
fi

# Check for placeholder URLs in process env
for VAR_NAME in DATABASE_URL REDIS_URL GPM_ENDPOINT; do
  VAL="${!VAR_NAME:-}"
  if [ -n "$VAL" ] && echo "$VAL" | grep -qE '\.(invalid|example)\b|placeholder'; then
    warn "$VAR_NAME has placeholder value: $VAL"
    echo "       The app auto-replaces placeholders with .env values"
  fi
done

GPM_MODE_VAL="${GPM_MODE:-$(grep -E '^GPM_MODE=' .env 2>/dev/null | cut -d= -f2)}"
GPM_MODE_VAL="${GPM_MODE_VAL:-live}"
if [ "$GPM_MODE_VAL" = "mock" ]; then
  ok "GPM_MODE=mock (mock profiles, no real browser needed)"
elif [ "$GPM_MODE_VAL" = "live" ]; then
  warn "GPM_MODE=live (requires real GPM Login on Windows)"
  echo "       Set GPM_MODE=mock in .env for cloud/CI environments"
fi

# ── Dependencies ────────────────────────────────────────
echo "--- Dependencies ---"
if [ -d node_modules ]; then
  ok "node_modules exists"
else
  fail "node_modules missing"
  echo "       Fix: pnpm install"
fi

# ── Master reachable ────────────────────────────────────
MASTER_PORT_VAL="${MASTER_PORT:-$(grep -E '^MASTER_PORT=' .env 2>/dev/null | cut -d= -f2)}"
MASTER_PORT_VAL="${MASTER_PORT_VAL:-7000}"
echo "--- Master API ---"
if curl -sf "http://127.0.0.1:$MASTER_PORT_VAL/health" >/dev/null 2>&1; then
  HEALTH=$(curl -sf "http://127.0.0.1:$MASTER_PORT_VAL/health")
  ok "Master responding on :$MASTER_PORT_VAL ($HEALTH)"
else
  warn "Master not running on :$MASTER_PORT_VAL (start with: pnpm master)"
fi

# ── Summary ─────────────────────────────────────────────
echo ""
echo "=== Summary: $PASS passed, $WARN warnings, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Run 'bash scripts/setup-local.sh' to fix most issues."
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  echo ""
  echo "Warnings present but not blocking. Ready to run."
  exit 0
fi

echo ""
echo "All checks passed. Ready to go!"
