FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json turbo.json ./
COPY prisma/ prisma/
COPY packages/shared-errors/package.json packages/shared-errors/
COPY packages/shared-crypto/package.json packages/shared-crypto/
COPY packages/shared-events/package.json packages/shared-events/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-audit/package.json packages/shared-audit/
COPY services/payment-service/package.json services/payment-service/

RUN npm ci
RUN npx prisma generate

COPY packages/ packages/
COPY services/payment-service/src/ services/payment-service/src/
COPY services/payment-service/tsconfig.json services/payment-service/

RUN npm run build --workspace=packages/shared-errors \
 && npm run build --workspace=packages/shared-crypto \
 && npm run build --workspace=packages/shared-events \
 && npm run build --workspace=packages/shared-types \
 && npm run build --workspace=packages/shared-audit \
 && npm run build --workspace=services/payment-service

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S ahava && adduser -S ahava -u 1001 -G ahava

COPY --from=builder --chown=ahava:ahava /app/node_modules ./node_modules
COPY --from=builder --chown=ahava:ahava /app/packages ./packages
COPY --from=builder --chown=ahava:ahava /app/prisma ./prisma
COPY --from=builder --chown=ahava:ahava /app/services/payment-service ./services/payment-service

USER ahava
ENV NODE_ENV=production
EXPOSE 6003

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-6003}/health || exit 1

CMD ["node", "services/payment-service/dist/main.js"]
