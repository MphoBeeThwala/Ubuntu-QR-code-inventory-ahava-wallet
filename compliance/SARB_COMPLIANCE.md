# SARB Compliance Checklist - Ubuntu Pay Platform

## Overview

This document outlines the technical compliance requirements for the Ubuntu Pay Platform to meet South African Reserve Bank (SARB) standards.

**Note:** Regulatory licensing is not yet complete — this document is not legal advice, and covers technical implementation only. See `SARB_COMPLIANCE_MAP.md` at the repo root for the engineering team's own up-to-date readiness assessment, which this document should agree with; if the two ever conflict, trust that one and fix this one.

Every file path, table name, and command below was checked against the actual codebase and schema — not assumed. If you're reading this after a schema or service change, re-verify before trusting it.

## 1. Double-Entry Accounting

### Requirements
- All financial transactions recorded with both debit and credit entries
- SUM of all debits must equal SUM of all credits at all times
- Ledger entries are append-only (never deleted)
- All monetary values stored as BIGINT cents (never floats)

### Implementation
- Ledger Service: `services/ledger-service/src/main.ts`
- Live payment paths write ledger entries directly inside their own DB transaction (see `services/payment-service/src/main.ts` and `services/wallet-service/src/main.ts`), rather than over HTTP, so the ledger write is atomic with the balance change it records
- Schema: `ledger_entries` table (Prisma model `LedgerEntry`) — a single `"amountCents"` BIGINT column plus an `"entryType"` enum (`DEBIT`/`CREDIT`), not separate debit/credit columns

### Verification Commands
- Run the automated check: `npm run compliance:check` (runs `compliance_scripts.ts`'s `verifyDoubleEntry`, which queries `ledger_entries` directly)
- Manual check: `psql -c "SELECT SUM(CASE WHEN \"entryType\"='DEBIT' THEN \"amountCents\" ELSE 0 END) - SUM(CASE WHEN \"entryType\"='CREDIT' THEN \"amountCents\" ELSE 0 END) AS imbalance FROM ledger_entries;"`

## 2. Audit Trail

### Requirements
- Complete audit log of all financial transactions
- Immutable audit records
- User identification for all actions
- Timestamp precision to milliseconds
- Correlation IDs for tracing across services

### Implementation
- Audit writer: `packages/shared-audit/src/index.ts` (`writeAuditLog`) — hash-chains each row (`prevHash`/`recordHash`) so tampering with history is detectable
- Storage: `audit_logs` table (Prisma model `AuditLog`)

### Status — NOT fully true yet
- Hash chaining is real and in use.
- **Append-only enforcement is not**: the migration meant to make `audit_logs` immutable at the database level (`audit_logs_append_only`) shipped as an empty placeholder — nothing currently stops an `UPDATE`/`DELETE` on this table. Don't cite immutability as achieved until that migration has real SQL (a trigger or `REVOKE UPDATE, DELETE` for the application role).

### Verification
- `npm run compliance:check` (`verifyAuditTrail`) checks that completed `wallet_transactions` have a matching `audit_logs` row.

## 3. Transaction Integrity

### Requirements
- Unique transaction references
- Idempotency for all payment operations
- Prevention of duplicate processing
- Atomic transaction processing

### Implementation
- Idempotency Keys: `wallet_transactions."idempotencyKey"` has a unique DB constraint, checked before the transaction opens
- Reference IDs: cuid/UUID primary keys throughout
- Status Tracking: `wallet_transactions.status` (Prisma enum `TransactionStatus`)

### Verification
- `npm run compliance:check` (`verifyTransactionIntegrity`) — checks for negative amounts/fees and debit-side balance arithmetic directly against `wallet_transactions`. Duplicate `idempotencyKey` values can't actually occur (enforced by the unique index itself), so that's not re-checked here.

## 4. KYC/AML Compliance

### Requirements
- Tiered KYC (`users."kycTier"`: `TIER_0` through `MERCHANT`) — TIER_0/unverified is a legitimate, designed-for state with lower transaction limits, not itself a compliance failure
- AML screening for transactions
- Risk-based approach to compliance
- Suspicious activity reporting

### Implementation
- AML engine: `services/aml-service/src/aml.engine.ts` — `screenSanctions()` (synchronous, blocking, called by payment-service before every `/payments` request commits) and `runPostPaymentChecks()` (async risk-scoring after commit)
- Sanctions provider: `services/aml-service/src/comply-advantage.client.ts` — real ComplyAdvantage integration when `COMPLYADVANTAGE_API_KEY` is set; without it, runs in stub mode and always returns `CLEAR`. Confirm the key is actually configured in whichever environment you're checking.
- STR filing: `POST /aml/str-file` on aml-service

### Verification
- `npm run compliance:check` (`verifyKycAml`) reports the KYC tier distribution and flags any unresolved `CRITICAL` severity row in `aml_flags`.

## 5. Data Protection

### Requirements
- Encryption of sensitive data at rest and in transit
- Access controls for financial data
- Data retention policies

### Implementation
- PII encryption: `packages/shared-crypto/src/index.ts` (`encryptPII`, AES-256-GCM) — applied to phone numbers on write in auth-service. This covers PII fields specifically, not literally every column at rest.
- PIN hashing: Argon2id (`hashPin`/`verifyPin` in the same package)
- Transport: TLS termination is an infrastructure/ingress concern, not enforced in application code — confirm it's actually configured wherever this is deployed before citing it as done.
- Access Control: JWT (RS256) authentication via api-gateway

### Verification
- `npm run compliance:check` (`verifyDataProtection`) checks `DATABASE_URL` for `sslmode` and that no `users."pinHash"` value is missing its Argon2 prefix.

## 6. Reporting

### Requirements
- Transaction reporting
- Compliance reporting
- SARB reporting (format ready)

### Implementation
- Reporting Service: `services/reporting-service` — queries `wallet_transactions` directly; there are no separate `transaction_reports`/`compliance_reports` tables in this schema.
- SARB regulatory reporting format: not yet built — this is a real gap, not just undocumented.

## 7. Business Continuity

### Requirements
- Disaster recovery plan in place
- Backup and restore procedures
- Incident response procedures

### Status
Disaster-recovery documentation exists in `disaster-recovery/` but has not yet been corrected to match the real schema and actual available tooling (no HA/Patroni setup exists in this repo's infra as committed) — treat it as a draft to be verified, not a tested procedure, until someone has actually run a restore against this schema.

## 8. Security

### Requirements
- Rate limiting on all endpoints
- Input validation on financial/PII endpoints
- Security headers on all responses
- Authentication and authorization
- Secure password (PIN) storage

### Implementation
- Rate Limiting: `services/api-gateway/src/middleware/rate-limit.middleware.ts` — Redis-backed, applied at the gateway
- Security Headers: `helmet` in `services/api-gateway/src/main.ts`
- Input Validation: zod schemas on payment-service's `/payments` and `/payments/qr`, wallet-service's `/qr/:qrHash/pay`, and auth-service's `/auth/register`/`/auth/login` — layered in front of the existing business-rule checks, not yet extended to every endpoint
- Authentication: JWT (RS256) with device binding
- PIN Storage: Argon2id

### Verification
- Manual: confirm rate limiting and headers are active by inspecting response headers from a live gateway instance.

## 9. Monitoring and Alerting

### Requirements
- Real-time monitoring of instrumented services
- Alerting on critical issues
- Financial data integrity monitoring

### Implementation
- Metrics: `packages/shared-observability` (Prometheus client) — wired into payment-service and wallet-service (`GET /metrics` on each); other services are not yet instrumented
- Config: `monitoring/prometheus.yml`, `monitoring/alert.rules` — only lists the services actually exposing `/metrics`; don't add a service to the scrape config until it's actually instrumented
- Financial Alerts: `LedgerImbalance` and `FailedTransactions` rules in `alert.rules`

## 10. Testing

### Requirements
- Unit tests for financial logic
- Compliance checks runnable on demand

### Implementation
- Unit/integration tests: Jest, per service (`services/*/src/__tests__/`)
- Compliance checks: `npm run compliance:check` runs `compliance/compliance_scripts.ts` against the live database

### Status
No CI workflow currently runs the compliance checks automatically on deploy — `npm run compliance:check` must be run manually today.

## Compliance Verification Scripts

### Run All Compliance Checks
```
npm run compliance:check
```

This runs every check in `compliance/compliance_scripts.ts` (`verifyDoubleEntry`, `verifyAuditTrail`, `verifyTransactionIntegrity`, `verifyDataProtection`, `verifyKycAml`, `verifyReporting`) against `DATABASE_URL` and prints a pass/fail summary. There are no separate per-check npm scripts — import the individual functions from that file if you need to run one in isolation.

## Notes

1. **Regulatory licensing**: not yet complete. This document covers technical implementation only — see the audit artifact / `SARB_COMPLIANCE_MAP.md` for the regulatory strategy (TPPP registration, PASA, etc.).
2. **Technical standards**: several items above are marked "NOT yet true" deliberately — read the Status sections, don't assume every requirement listed is satisfied just because it's listed.
3. **No compliance dashboard exists.** An earlier version of this document linked to `https://compliance.ubuntu-pay.co.za` — that URL does not resolve to anything and should never have been cited as real infrastructure. Don't add a fabricated URL back in; if a real dashboard gets built, link it then.
4. **External audit**: will be required before SARB licensing regardless of the technical state.

## Document Information

Owner: Engineering | Status: Technical implementation in progress (see Status notes per section) | Regulatory licensing: not started
