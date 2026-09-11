# Ahava eWallet — api-gateway (builder stage)
# This is a pnpm workspace monorepo (pnpm-workspace.yaml + the
# "packageManager" field in root package.json). Several services'
# package.json files use the pnpm-only "workspace:" version protocol,
# and none of these @ahava/* internal packages exist on the public npm
# registry — plain "npm ci" fails here (EUNSUPPORTEDPROTOCOL, or a 404
# trying to fetch "@ahava/shared-errors" from npm). Must use pnpm.
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl ca-certificates \
  && corepack enable \
  && corepack prepare pnpm@8.15.0 --activate

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
RUN pnpm --filter "@ahava/api-gateway..." run build

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S ahava && adduser -S ahava -u 1001 -G ahava

COPY --from=builder --chown=ahava:ahava /app/node_modules             ./node_modules
COPY --from=builder --chown=ahava:ahava /app/packages                 ./packages
COPY --from=builder --chown=ahava:ahava /app/prisma                   ./prisma
COPY --from=builder --chown=ahava:ahava /app/services/api-gateway/dist ./dist
COPY --from=builder --chown=ahava:ahava /app/services/api-gateway/package.json ./

USER ahava
ENV NODE_ENV=production
EXPOSE 6000

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:6000/health || exit 1

CMD ["node", "dist/main.js"]
