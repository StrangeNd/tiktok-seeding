# Multi-stage Dockerfile for tiktok-seeding monorepo.
# Builds master, worker, or cli via --target or DOCKER_APP build arg.
#
# Usage:
#   docker compose up                     # all services
#   docker build --build-arg APP=master . # just master

FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/master/package.json apps/master/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/gpm-client/package.json packages/gpm-client/package.json
COPY packages/tiktok-actions/package.json packages/tiktok-actions/package.json
RUN pnpm install --frozen-lockfile

# ── Copy source ───────────────────────────────────────────────────
FROM deps AS source
COPY . .
# Create empty .env so dotenv-cli in db:migrate doesn't fail
# (actual env vars are provided by Docker compose environment block)
RUN touch .env

# ── Master ────────────────────────────────────────────────────────
FROM source AS master
EXPOSE 7000
CMD ["pnpm", "--filter", "@app/master", "run", "start"]

# ── Worker ────────────────────────────────────────────────────────
FROM source AS worker
CMD ["pnpm", "--filter", "@app/worker", "run", "start"]

# ── CLI ───────────────────────────────────────────────────────────
FROM source AS cli
ENTRYPOINT ["pnpm", "--filter", "@app/cli", "run"]

# ── Default target (master) ───────────────────────────────────────
FROM source AS default
EXPOSE 7000
CMD ["pnpm", "--filter", "@app/master", "run", "start"]
