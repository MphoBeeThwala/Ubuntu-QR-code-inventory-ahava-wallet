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
COPY services/reporting-service/package.json services/reporting-service/

RUN npm ci
RUN npx prisma generate

COPY packages/ packages/
COPY services/reporting-service/src/ services/reporting-service/src/
COPY services/reporting-service/tsconfig.json services/reporting-service/

RUN npm run build --workspace=packages/shared-errors \
 && npm run build --workspace=packages/shared-crypto \
 && npm run build --workspace=packages/shared-events \
 && npm run build --workspace=packages/shared-types \
 && npm run build --workspace=packages/shared-audit \
 && npm run build --workspace=services/reporting-service

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S ahava && adduser -S ahava -u 1001 -G ahava

COPY --from=builder --chown=ahava:ahava /app/node_modules ./node_modules
COPY --from=builder --chown=ahava:ahava /app/packages ./packages
COPY --from=builder --chown=ahava:ahava /app/prisma ./prisma
COPY --from=builder --chown=ahava:ahava /app/services/reporting-service ./services/reporting-service

USER ahava
ENV NODE_ENV=production
EXPOSE 6007

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-6007}/health || exit 1

CMD ["node", "services/reporting-service/dist/main.js"]
