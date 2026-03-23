# ─── Stage 1: Builder ────────────────────────────────────────────
# Build context: monorepo root  (context: . in ci-cd.yml)
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

# Root workspace manifests
COPY package.json package-lock.json turbo.json ./

# All shared-package manifests
COPY packages/shared-errors/package.json  packages/shared-errors/
COPY packages/shared-crypto/package.json  packages/shared-crypto/
COPY packages/shared-events/package.json  packages/shared-events/
COPY packages/shared-types/package.json   packages/shared-types/
COPY services/agent-service/package.json  services/agent-service/

RUN npm ci

# Prisma schema
COPY prisma/ prisma/
RUN npx prisma generate

# Shared package sources
COPY packages/ packages/

# Service source + tsconfig
COPY services/agent-service/src/        services/agent-service/src/
COPY services/agent-service/tsconfig.json services/agent-service/

RUN npm run build --workspace=services/agent-service

# ─── Stage 2: Runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S ahava && adduser -S ahava -u 1001 -G ahava

COPY --from=builder --chown=ahava:ahava /app/node_modules           ./node_modules
COPY --from=builder --chown=ahava:ahava /app/services/agent-service/dist ./dist
COPY --from=builder --chown=ahava:ahava /app/services/agent-service/package.json ./

USER ahava
ENV NODE_ENV=production
EXPOSE 6009

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:6009/health || exit 1

CMD ["node", "dist/main.js"]
