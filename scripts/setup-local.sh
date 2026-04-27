#!/usr/bin/env bash
# Setup local dev environment: Postgres + Redis + DB migration.
# Usage: bash scripts/setup-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Setup local dev environment ==="

# 1. Ensure Postgres + Redis are installed and running
for svc in postgresql redis-server; do
  if ! systemctl is-active --quiet "$svc" 2>/dev/null; then
    echo "Starting $svc..."
    sudo systemctl start "$svc"
  fi
done

# 2. Create database if not exists
if ! sudo -u postgres psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw seeding; then
  echo "Creating database 'seeding'..."
  sudo -u postgres createdb seeding
fi

# 3. Ensure postgres password is set for local connections
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true

# 4. Copy .env if missing
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  # Override for local dev
  sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seeding|' .env
  sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://127.0.0.1:6379|' .env
fi

# 5. Install deps
echo "Installing dependencies..."
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm install

# 6. Run DB migration
echo "Running DB migrations..."
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seeding \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm db:generate
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seeding \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm db:migrate

echo ""
echo "=== Setup complete ==="
echo "Start services:"
echo "  pnpm master    # Fastify API on :7000"
echo "  pnpm worker    # BullMQ worker"
