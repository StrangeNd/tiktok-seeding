#!/usr/bin/env bash
# Setup local dev environment: Postgres + Redis + DB migration.
# Usage: bash scripts/setup-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Setup local dev environment ==="
echo ""

# 1. Ensure Postgres + Redis are installed
echo "--- Checking system dependencies ---"
MISSING=""
command -v psql >/dev/null 2>&1 || MISSING="$MISSING postgresql postgresql-client"
command -v redis-cli >/dev/null 2>&1 || MISSING="$MISSING redis-server"

if [ -n "$MISSING" ]; then
  echo "Installing:$MISSING"
  sudo apt-get update -qq
  sudo apt-get install -y -qq $MISSING
fi

# 2. Start services
echo "--- Starting services ---"
sudo systemctl start postgresql 2>/dev/null || true
sudo systemctl start redis-server 2>/dev/null || true

# 3. Create database if not exists
echo "--- Setting up database ---"
if ! sudo -u postgres psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw seeding; then
  echo "Creating database 'seeding'..."
  sudo -u postgres createdb seeding
else
  echo "Database 'seeding' already exists"
fi

# 4. Ensure postgres password + password auth
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true

# Fix pg_hba.conf to allow password auth (needed on fresh Ubuntu installs)
PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file" 2>/dev/null | tr -d ' ')
if [ -n "$PG_HBA" ] && [ -f "$PG_HBA" ]; then
  if grep -q 'local.*all.*postgres.*peer' "$PG_HBA"; then
    echo "Fixing pg_hba.conf for password auth..."
    sudo sed -i 's/local\s\+all\s\+postgres\s\+peer/local   all             postgres                                md5/' "$PG_HBA"
    sudo sed -i 's/local\s\+all\s\+all\s\+peer/local   all             all                                     md5/' "$PG_HBA"
    sudo systemctl restart postgresql
  fi
fi

# Verify password auth works
if PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d seeding -c "SELECT 1" >/dev/null 2>&1; then
  echo "Password auth: OK"
else
  echo "WARNING: Password auth failed. You may need to manually fix pg_hba.conf."
fi

# 5. Copy .env if missing
echo ""
echo "--- Environment ---"
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seeding|' .env
  sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://127.0.0.1:6379|' .env
  sed -i 's|^GPM_MODE=.*|GPM_MODE=mock|' .env
  echo ".env created with local defaults (GPM_MODE=mock)"
else
  echo ".env already exists"
fi

# 6. Install deps
echo ""
echo "--- Dependencies ---"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm install

# 7. Run DB migration
echo ""
echo "--- Database migration ---"
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seeding \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm db:generate

DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seeding \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm db:migrate

echo ""
echo "=== Setup complete ==="
echo ""
echo "Quick start:"
echo "  pnpm master          # Start API on :7000"
echo "  pnpm worker          # Start BullMQ worker"
echo "  pnpm sync            # Sync GPM profiles"
echo "  pnpm order --url=... # Create an order"
echo "  pnpm orders          # List orders"
echo "  pnpm doctor          # Pre-flight check"
echo "  pnpm smoke           # End-to-end smoke test"
