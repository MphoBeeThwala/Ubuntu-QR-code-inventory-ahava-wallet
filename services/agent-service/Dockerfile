# Ahava eWallet — agent-service (builder stage)
# This is a pnpm workspace monorepo (pnpm-workspace.yaml + the
# "packageManager" field in root package.json). Several services'
# package.json files use the pnpm-only "workspace:" version protocol,
# and none of these @ahava/* internal packages exist on the public npm
# registry — plain "npm ci" fails here (EUNSUPPORTEDPROTOCOL, or a 404
# trying to fetch "@ahava/shared-errors" from npm). Must use pnpm.
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@8.15.9 --activate

# Full workspace manifest + source. pnpm needs every workspace member's
# package.json visible (pnpm-workspace.yaml globs packages/*,
# services/*, apps/*) to resolve internal @ahava/* dependencies
# correctly, even though only one service actually gets built below.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY prisma/ prisma/
COPY packages/ packages/
COPY services/ services/
COPY apps/pwa/package.json apps/pwa/
COPY apps/agent-portal/package.json apps/agent-portal/

# pnpm-lock.yaml can drift from package.json between deploys (it isn't
# regenerated automatically here on every dependency change) —
# --no-frozen-lockfile lets pnpm resolve against the real package.json
# files instead of hard-failing on a stale lockfile.
RUN pnpm install --no-frozen-lockfile

RUN npx prisma generate

# Builds the target service and every @ahava/* package it depends on —
# the "..." suffix pulls in workspace dependencies, in build order.
RUN pnpm --filter "@ahava/agent-service..." run build

FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 ahava && useradd --uid 1001 --gid ahava --create-home ahava

COPY --from=builder --chown=ahava:ahava /app/node_modules ./node_modules
COPY --from=builder --chown=ahava:ahava /app/packages ./packages
COPY --from=builder --chown=ahava:ahava /app/prisma ./prisma
COPY --from=builder --chown=ahava:ahava /app/services/agent-service ./services/agent-service

USER ahava
ENV NODE_ENV=production
EXPOSE 6009

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-6009}/health || exit 1

CMD ["node", "services/agent-service/dist/main.js"]
