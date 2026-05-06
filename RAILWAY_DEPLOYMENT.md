# Railway Deployment Guide

## Current Status

This repo now passes:

- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run test:all`
- `npm run secrets:validate`

`npm run test:all` now passes both workspace Jest thresholds and the repo-level `scripts/check-coverage.js` gate.

## Important Railway Notes

This is a **shared JavaScript monorepo**. Railway's current docs treat that differently from isolated subdirectory apps.

- Do **not** deploy these services by setting the service root to `apps/...` or `services/...` and expecting shared packages to still work.
- Do **not** rely on a single root `railway.json` to define multiple services. Railway config-as-code is resolved per deployment/service.
- Keep each Railway service connected to the **repository root**.
- Use the per-service config files that now live in each deployable package directory, for example:
  - `/apps/pwa/railway.json`
  - `/apps/agent-portal/railway.json`
  - `/services/api-gateway/railway.json`
  - `/services/auth-service/railway.json`
  - `/services/wallet-service/railway.json`
  - `/services/payment-service/railway.json`
  - `/services/notification-service/railway.json`
  - `/services/kyc-service/railway.json`
  - `/services/aml-service/railway.json`
  - `/services/reporting-service/railway.json`
  - `/services/ussd-service/railway.json`
  - `/services/agent-service/railway.json`

Each of those files builds from the repo root with workspace-aware commands and scoped watch patterns.

## Recommended Railway Setup

1. Create an empty Railway project.
2. Add one Railway service per deployable app/service.
3. For each Railway service:
   - Connect the same GitHub repository.
   - Leave the source at the repository root.
   - In service settings, set the Config as Code path to that service's `railway.json`.
4. Expose public domains only where needed:
   - `pwa`
   - `agent-portal` if you want the internal portal public
   - `api-gateway`
5. Keep internal backend services on private networking unless an external consumer truly needs them public.

## Environment Variables

Set shared variables at the environment level where possible.

### Core

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
HASH_SALT=...
AUDIT_LOG_HMAC_KEY=...
PII_ENCRYPTION_KEY=<64 hex chars>
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
AWS_REGION=af-south-1
```

### Service discovery

Use Railway reference variables or private domains for internal calls:

```env
AUTH_SERVICE_URL=${{auth-service.RAILWAY_PRIVATE_DOMAIN}}
WALLET_SERVICE_URL=${{wallet-service.RAILWAY_PRIVATE_DOMAIN}}
PAYMENT_SERVICE_URL=${{payment-service.RAILWAY_PRIVATE_DOMAIN}}
KYC_SERVICE_URL=${{kyc-service.RAILWAY_PRIVATE_DOMAIN}}
NOTIFICATION_SERVICE_URL=${{notification-service.RAILWAY_PRIVATE_DOMAIN}}
AGENT_SERVICE_URL=${{agent-service.RAILWAY_PRIVATE_DOMAIN}}
AML_SERVICE_URL=${{aml-service.RAILWAY_PRIVATE_DOMAIN}}
REPORTING_SERVICE_URL=${{reporting-service.RAILWAY_PRIVATE_DOMAIN}}
USSD_SERVICE_URL=${{ussd-service.RAILWAY_PRIVATE_DOMAIN}}
API_BASE_URL=${{api-gateway.RAILWAY_PUBLIC_DOMAIN}}
NEXT_PUBLIC_API_BASE_URL=${{api-gateway.RAILWAY_PUBLIC_DOMAIN}}
```

### Optional integrations

Only set these for services that use them:

```env
AT_API_KEY=...
AT_USERNAME=...
AFRICAS_TALKING_SENDER_ID=AHAVA
COMPLY_ADVANTAGE_API_KEY=...
FIREBASE_SERVICE_ACCOUNT_JSON={...}
SES_FROM_ADDRESS=noreply@example.com
```

## Service Mapping

Create one Railway service per deployable app or backend. Keep each one pointed at the repository root and set its Config as Code path to the service-local `railway.json`.

Recommended mapping:

- `apps/pwa/railway.json`
  Public: yes
  Purpose: customer web app
- `apps/agent-portal/railway.json`
  Public: optional
  Purpose: internal or partner-facing agent UI
- `services/api-gateway/railway.json`
  Public: yes
  Purpose: single public API entrypoint
- `services/auth-service/railway.json`
  Public: no
  Purpose: auth and session flows
- `services/wallet-service/railway.json`
  Public: no
  Purpose: wallet and QR operations
- `services/payment-service/railway.json`
  Public: no
  Purpose: transfers and payment execution
- `services/notification-service/railway.json`
  Public: no
  Purpose: queue-backed push, SMS, email dispatch
- `services/kyc-service/railway.json`
  Public: no
  Purpose: KYC document intake and tier changes
- `services/aml-service/railway.json`
  Public: no
  Purpose: AML worker and MLRO flows
- `services/reporting-service/railway.json`
  Public: no
  Purpose: compliance and reporting APIs
- `services/ussd-service/railway.json`
  Public: depends on USSD provider callback model
  Purpose: USSD session handling
- `services/agent-service/railway.json`
  Public: no
  Purpose: agent auth, cash-in, cash-out

## Suggested Variable Scope

Set these once at the environment or project level when shared by many services:

- `NODE_ENV`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_PRIVATE_KEY`
- `JWT_PUBLIC_KEY`
- `PII_ENCRYPTION_KEY`
- `AUDIT_LOG_HMAC_KEY`
- `HASH_SALT`
- `AWS_REGION`

Set these only on services that need them:

- `AFRICAS_TALKING_API_KEY`
  Services: `notification-service`, any service sending SMS directly
- `AFRICAS_TALKING_USERNAME`
  Services: `notification-service`, any service sending SMS directly
- `AFRICAS_TALKING_SENDER_ID`
  Services: `notification-service`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
  Services: `notification-service`
- `SES_FROM_ADDRESS`
  Services: `notification-service`
- `COMPLY_ADVANTAGE_API_KEY`
  Services: `aml-service`

## Database Migrations

Do **not** run Prisma migrations independently from every service deploy.

Use one of these patterns:

1. A dedicated one-off Railway service/job whose only responsibility is:
   - `npm run db:migrate:prod`
2. A manual pre-release step before promoting traffic.

Until you add a dedicated migration runner, treat schema migrations as an operational step, not an automatic per-service deploy step.

## Production Risks Still Open

- No end-to-end integration validation against a real Railway Postgres and Redis environment was run here.
- No live Railway deployment was executed from this workspace, so actual service discovery, healthcheck routing, and private networking are still unverified.
- No load, soak, failover, or chaos testing was run.
- Secrets presence was validated by the repo script, but secret values and external provider credentials were not exercised against production services.

## Pre-Launch Checklist

- Provision Railway Postgres and Redis.
- Add all production secrets and internal service URL references.
- Run `npm run db:migrate:prod` once against the production database before first traffic.
- Deploy backend services first, then `api-gateway`, then `pwa` and `agent-portal`.
- Smoke test:
  - auth register/login
  - wallet creation and lookup
  - payment flow
  - notification enqueue path
  - PWA login and dashboard
- Verify notification providers individually:
  - Firebase push
  - Africa's Talking SMS
  - SES email
- Verify private service-to-service calls resolve through Railway internal networking.
- Confirm healthchecks remain green after a redeploy.

## References

- Railway monorepo docs: https://docs.railway.com/guides/monorepo
- Railway config-as-code docs: https://docs.railway.com/config-as-code/reference
