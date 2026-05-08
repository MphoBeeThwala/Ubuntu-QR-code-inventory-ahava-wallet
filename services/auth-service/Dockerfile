# ─── Stage 1: Builder ────────────────────────────────────────────
# Build context: monorepo root
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

# Root workspace manifests
COPY package.json package-lock.json turbo.json ./

# Copy prisma files before npm ci (needed for postinstall script)
COPY prisma/ prisma/

# All shared-package manifests (npm workspaces need these for resolution)
COPY packages/shared-errors/package.json packages/shared-errors/
COPY packages/shared-crypto/package.json packages/shared-crypto/
COPY packages/shared-events/package.json packages/shared-events/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-audit/package.json packages/shared-audit/
COPY services/auth-service/package.json services/auth-service/

RUN npm ci

# Generate Prisma client after npm install
RUN npx prisma generate

# Shared package sources
COPY packages/ packages/

# Service source + tsconfig
COPY services/auth-service/src/ services/auth-service/src/
COPY services/auth-service/tsconfig.json services/auth-service/

RUN npm run build --workspace=packages/shared-errors \
 && npm run build --workspace=packages/shared-crypto \
 && npm run build --workspace=packages/shared-events \
 && npm run build --workspace=packages/shared-audit \
 && npm run build --workspace=services/auth-service

# ─── Stage 2: Runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S ahava && adduser -S ahava -u 1001 -G ahava

COPY --from=builder --chown=ahava:ahava /app/node_modules ./node_modules
COPY --from=builder --chown=ahava:ahava /app/packages ./packages
COPY --from=builder --chown=ahava:ahava /app/prisma ./prisma
COPY --from=builder --chown=ahava:ahava /app/services/auth-service/dist ./dist
COPY --from=builder --chown=ahava:ahava /app/services/auth-service/package.json ./

USER ahava
ENV NODE_ENV=production
EXPOSE 6001

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-6001}/health || exit 1

CMD ["node", "dist/main.js"]
