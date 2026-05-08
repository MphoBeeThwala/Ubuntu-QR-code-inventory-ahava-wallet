# ─── Stage 1: Builder ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json turbo.json ./
COPY prisma/ prisma/
COPY packages/shared-errors/package.json packages/shared-errors/
COPY packages/shared-crypto/package.json packages/shared-crypto/
COPY packages/shared-events/package.json packages/shared-events/
COPY packages/shared-types/package.json  packages/shared-types/
COPY services/api-gateway/package.json   services/api-gateway/

RUN npm ci

COPY packages/ packages/
COPY services/api-gateway/src/        services/api-gateway/src/
COPY services/api-gateway/tsconfig.json services/api-gateway/

RUN npm run build --workspace=packages/shared-errors \
 && npm run build --workspace=packages/shared-crypto \
 && npm run build --workspace=packages/shared-events \
 && npm run build --workspace=services/api-gateway

# ─── Stage 2: Runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S ahava && adduser -S ahava -u 1001 -G ahava

COPY --from=builder --chown=ahava:ahava /app/node_modules             ./node_modules
COPY --from=builder --chown=ahava:ahava /app/prisma                    ./prisma
COPY --from=builder --chown=ahava:ahava /app/services/api-gateway/dist ./dist
COPY --from=builder --chown=ahava:ahava /app/services/api-gateway/package.json ./

USER ahava
ENV NODE_ENV=production
EXPOSE 6000

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:6000/health || exit 1

CMD ["node", "dist/main.js"]
