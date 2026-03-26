# SARB-Aligned Compliance Map (Engineering View)

This document is a practical engineering mapping of common South African fintech / payments platform expectations (SARB oversight, PASA/scheme rules where applicable, FICA/AML obligations, POPIA privacy obligations, and general security best practice) to what exists in this repository today, plus the remaining gaps to reach an audit-ready posture.

This is not legal advice; it is an implementation readiness checklist.

## Scope

- Platform: Ahava eWallet (microservices + mobile + PWA + infra)
- Environments: dev, staging, prod
- Security baseline: least privilege, secure defaults, tamper-evident audit trails, strong cryptography, separation of duties

## Current Strengths (Already Implemented)

### Identity, Authentication, Session Security

- Strong PIN hashing (Argon2id) and JWT auth (RS256) patterns
  - Evidence: [auth.service.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/auth-service/src/auth.service.ts)
- Gateway-based access control + per-path rate limiting + request IDs for traceability
  - Evidence: [main.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/api-gateway/src/main.ts), [rate-limit.middleware.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/api-gateway/src/middleware/rate-limit.middleware.ts)

### Transaction Integrity and Financial Controls

- Atomic balance updates + deterministic locking to prevent double-spend/race conditions
- Idempotency keys to prevent duplicate processing
- Double-entry accounting pattern for wallet-to-wallet movements
  - Evidence: Payment logic + tests in [payment.test.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/payment-service/src/__tests__/payment.test.ts)

### Auditability and Traceability

- Request ID propagation and error standardization across services
  - Evidence: [shared-errors index.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/packages/shared-errors/src/index.ts), service entrypoints under [services](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services)
- Audit log writer (DB-backed in auth service)
  - Evidence: [audit.logger.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/auth-service/src/audit.logger.ts)

### AML / KYC Architecture

- AML service structure, screening client, MLRO notification routing (queue-based)
  - Evidence: [aml.engine.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/aml-service/src/aml.engine.ts), [comply-advantage.client.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/aml-service/src/comply-advantage.client.ts), [mlro.notifier.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/aml-service/src/mlro.notifier.ts)
- KYC workflow queue producer in auth service
  - Evidence: [kyc.queue.ts](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/services/auth-service/src/queues/kyc.queue.ts)

### Secrets and Environment Separation

- Secrets Manager naming and Kubernetes ExternalSecrets integration pattern established
  - Evidence: [secrets.tf](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/infrastructure/terraform/secrets.tf), [overlays](file:///c:/Users/User/OneDrive/Documentos/Projects/ahava_ewallet/Ubuntu-QR-code-inventory-ahava-wallet/k8s/overlays)

## Required for SARB-Grade “Audit Ready” (Still Needed)

These are requirements that typically determine whether a platform is audit-ready, even when the application logic is strong.

### 1) Governance, Risk, and Operational Controls (Non-Code Deliverables)

- Information security policy set (access control, encryption, logging/monitoring, vulnerability management)
- Incident response plan + tested tabletop exercises
- Change management policy + approvals + rollback evidence
- Vendor due diligence pack for third parties (SMS, push, screening, cloud)
- Business continuity and disaster recovery plan + RTO/RPO targets + evidence

### 2) Key Management and Cryptographic Controls (Code + Infra)

- Enforce AWS KMS-backed encryption for secrets and data at rest, with rotation evidence
- Enforce environment isolation and least-privilege IAM (no wildcard secrets access)
- Rotate JWT keys, mTLS certs, and API keys with controlled rollout and monitoring

### 3) Audit Trail Quality (Code + Ops)

- Tamper-evident audit logging (immutability controls, write-once storage, retention)
- Centralized log ingestion with retention and alerting (SIEM/APM)
- Structured logging with redaction rules (PII/secrets must never be logged)

### 4) AML/KYC Operations (Code + Ops)

- Define “hold / release / reject” states for suspicious payments and a case management workflow
- STR workflow routing and evidence generation (who reviewed, when, decision, rationale)
- Threshold tuning and testing evidence (false positives/negatives, escalation rules)

### 5) POPIA (Privacy) Readiness (Code + Ops)

- Data retention schedules + deletion workflows + access request workflows
- Consent capture where required, privacy notices, and purpose limitation controls

## Engineering Next Steps (Completed)

- ~~Implement baseline security headers + proxy hardening at the API gateway~~ (Done: `helmet` added)
- ~~Add redaction rules for logs (headers/body fields that must never appear)~~ (Done: `redactLog` helper)
- ~~Implement immutable audit log pattern (hash chaining and/or WORM storage integration)~~ (Done: `shared-audit` and `migration.sql`)
- ~~Expand automated security testing (dependency scanning, SAST) and enforce in CI~~ (Done: enforced in GitHub Actions)

## Evidence Pack (What Auditors Usually Ask For)

- System architecture diagram + data flow diagram
- Threat model (STRIDE-style) + mitigation mapping
- Penetration test report + remediation evidence
- Access control matrix (roles, permissions, approval flows)
- Audit log retention policy and proof of log integrity
