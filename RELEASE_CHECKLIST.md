# MVP Release Checklist

## Scope lock

- [ ] MVP flow confirmed: Register → Login → Wallet → Send Money → History
- [ ] No feature creep merged after scope lock

## Build & test

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run integration:up` works on a clean machine with Docker Desktop
- [ ] `npm run integration:smoke` passes
- [ ] `npm run integration:down` cleans up containers
- [ ] Runbook executed: `INTEGRATION_RUNBOOK.md` + `VERIFY_RELEASE.md`

## API contract

- [ ] All JSON endpoints return the shared envelope:
  - success: `{ success: true, data, requestId, timestamp }`
  - error: `{ success: false, error: { code, message, statusCode, requestId, timestamp, details? } }`
- [ ] `X-Request-ID` propagated end-to-end through gateway and services

## Data integrity

- [ ] Money handled in integer cents (no float math in critical paths)
- [ ] Double-entry accounting enforced for transfers/payments
- [ ] Idempotency covered for payments

## Security hygiene

- [ ] No secrets committed to repo
- [ ] JWT keys sourced from secrets manager / runtime secrets
- [ ] Rate limiting enabled at the gateway
- [ ] Audit logs written for all mutations

## Demo readiness

- [ ] Demo seed data exists and produces two wallets with balances
- [ ] Demo runbook followed successfully end-to-end
