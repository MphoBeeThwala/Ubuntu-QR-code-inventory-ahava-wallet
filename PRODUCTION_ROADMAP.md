# 🚀 AHAVA eWallet — Production Readiness Roadmap

**Current Project Maturity: ~15-20% (Early Alpha)**  
**Date: March 2026 | Target SARB PSP Launch: 2026 (pending regulatory approval)**

---

## 📊 Executive Summary

| Dimension | Status | Grade |
|-----------|--------|-------|
| **Architecture & Design** | Complete | ✅ A |
| **Database Schema** | Complete | ✅ A |
| **Core Business Logic** | 60% (Auth, Payment, AML logic written; missing: Wallet, KYC, Notification services) | 🟡 C |
| **HTTP Entry Points & APIs** | 0% (services have no Express apps, routes, or middlewares) | 🔴 F |
| **Database Migrations** | Not generated (schema exists, migrations folder empty) | 🔴 F |
| **Mobile App** | 5% (theme + one BLoC, missing: 15+ screens, auth, offline sync) | 🔴 F |
| **Web/PWA Apps** | 0% (PWA, USSD gateway, agent portal all missing) | 🔴 F |
| **Infrastructure as Code (IaC)** | 10% (backend config only, no resources defined) | 🔴 F |
| **Testing** | 0% (zero test files, 0% coverage; mandate: 80-95%) | 🔴 F |
| **CI/CD** | 20% (lint/typecheck only; missing: builds, deployments) | 🟡 D |
| **Security** | 70% (Argon2id, RS256 designed; missing: certificate pinning impl, TLS enforcement, Secrets Manager integration) | 🟡 C |
| **Regulatory Compliance** | 50% (audit logs designed; missing: POPIA consent flows, AML STR filing automation) | 🟡 C |

**Overall Production Readiness: 18%** ← Too immature to deploy anything yet.

---

## 🎯 What's Complete (Green Lights)

### Backend Services — Business Logic Only
- ✅ **Auth Service** (`auth.service.ts`)
  - Argon2id PIN hashing
  - RS256 JWT token generation + device binding
  - User registration flow modeled
  
- ✅ **Payment Service** (`payment.service.ts`)
  - Idempotency key validation (Redis check)
  - Fee calculation (percentage + fixed amount)
  - Double-entry accounting safeguard
  - Sanctions screening queue integration
  
- ✅ **AML Service** (`aml.engine.ts`)
  - Post-transaction AML rules engine
  - ComplyAdvantage API integration
  - Risk scoring + flagging
  - MLRO notification dispatch

- ✅ **PayShap Client** (`payshap/payshap.client.ts`)
  - mTLS certificate handling
  - JWS request signing for SARB compliance
  - Payment rail integration scaffolding

### Database
- ✅ **Prisma Schema** (`prisma/schema.prisma`)
  - 12+ models: User, Wallet, WalletTransaction, PaymentQrCode, YouthWalletControl, Agent, AmlFlag, KycDocument, RefreshToken, Notification, SanctionsScreening, AuditLog
  - Correct monetary representation (BigInt for cents)
  - Soft delete flags (`deleted_at`, `is_deleted`)
  - PII field structure (ready for pgcrypto encryption)
  - Comprehensive enums (KycTier, TransactionType, etc.)
  - TimescaleDB, uuid_ossp, pgcrypto extensions configured

- ✅ **Seed Data** (`packages/database/src/seed.ts`)
  - Test user + wallet generators
  - KYC tier progression logic
  - Transaction history generator

### Mobile
- ✅ **Theme System** (`apps/mobile/core/theme/ahava_theme.dart`)
  - Complete Ahava design system (colors, typography, spacing)
  - WCAG accessibility semantics

- ✅ **Payment BLoC** (`apps/mobile/features/payments/bloc/payment_bloc.dart`)
  - Event-driven architecture pattern
  - Ready for expansion to other features

### Infrastructure & Build
- ✅ **Terraform Backend** (`infrastructure/terraform/main.tf`)
  - S3 state management (af-south-1)
  - DynamoDB locks
  - AWS provider v5.40 pinned

- ✅ **Monorepo Setup**
  - Turbo configuration w/ task pipeline
  - Workspace structure (apps/, services/, packages/)
  - Root npm scripts for dev, build, typecheck, db operations

- ✅ **Local Dev Environment** (`docker-compose.yml`)
  - PostgreSQL 16 + TimescaleDB
  - Redis 7
  - Health checks + volumes

- ✅ **Shared Types** (`packages/shared-types/src/index.ts`)
  - Core enums (KycTier, WalletStatus, TransactionType, etc.)
  - Type skeleton ready for expansion

---

## ❌ What's Missing (Red Lights)

### 🔴 **CRITICAL BLOCKERS** (Must fix before any deployment)

#### 1. **No HTTP Entry Points** (Services not runnable)
**Status:** 0 complete | **Impact:** Cannot deploy any backend service
- **Auth Service:** Missing `main.ts`, `app.ts`, Express app, routes (`POST /auth/register`, `POST /auth/login`), middleware
- **Payment Service:** Missing Express app, routes (`POST /payments`, `POST /payments/qr`), webhook handlers
- **AML Service:** Missing Express app, event consumer (should subscribe to `payments.transaction.created` queue event)
- **Wallet Service:** Missing entirely — needs full CRUD service (GET/POST/PUT `/wallets`, balance queries, limit enforcement)
- **KYC Service:** Missing entirely — needs document upload, tier progression, verification workflows
- **Notification Service:** Missing entirely — needs event consumer, FCM/SMS/SES dispatcher
- **Reporting Service:** Missing entirely — needs VAT/SARB export generators
- **API Gateway:** Missing entirely — needs to be central ingress with JWT auth, rate limiting, request ID logging

**What you need to do:**
- [ ] For each service with logic + missing Express, create `src/main.ts` entry point
- [ ] Add Express setup: app initialization, CORS, body parsing, request ID middleware
- [ ] Add Prisma client instantiation + connection pooling (`@prisma/client/edge` for serverless compatibility)
- [ ] Add error boundary middleware (catch AhavaError, return `{ success: false, error: { code, message } }`)
- [ ] Add Sentry + Datadog instrumentation middleware
- [ ] Create `src/routes/` folder with route handlers for each endpoint
- [ ] Add OpenAPI/Swagger documentation

#### 2. **No Database Migrations** (Schema not deployable)
**Status:** Schema written, migrations folder empty | **Impact:** Cannot initialize any database
- Prisma schema is complete, but `prisma/migrations/` folder does not exist
- No migration history means no way to version DB changes for production
- Cannot run `prisma migrate deploy` in CI/CD

**What you need to do:**
- [ ] Run `npx prisma migrate dev --name init` to generate initial migration
- [ ] Verify migration creates: `SELECT * FROM information_schema.tables WHERE table_schema = 'public'` has 12+ tables
- [ ] Commit `prisma/migrations/` folder to version control
- [ ] Test migration locally: `docker-compose up`, `npx prisma migrate dev`, confirm seed runs

#### 3. **Missing Shared Foundations** (Blocks all services)
**Status:** Referenced but not implemented | **Impact:** Services cannot initialize
- ❌ `shared-errors/` — Custom error codes (INSUFFICIENT_BALANCE, KYC_TIER_EXCEEDED, INVALID_DEVICE_CERTIFICATE, etc.)
- ❌ `shared-crypto/` — PII encryption wrappers, key rotation, secret fetching from AWS Secrets Manager
- ❌ `shared-events/` — Bull queue definitions (PaymentCreated, UserKycUpdated, AmlFlagged events)
- ❌ Secrets injection — Services hardcode "AWS Secrets Manager" but no code exists to fetch them

**What you need to do:**
- [ ] Create `packages/shared-errors/src/index.ts` with AhavaError class + error code enum
- [ ] Create `packages/shared-crypto/src/` with PGCrypto encryption, key rotation, AWS Secrets Manager client
- [ ] Create `packages/shared-events/src/` with BullMQ queue definitions + TypeScript event interfaces
- [ ] Update all services to import from these packages
- [ ] Add environment secrets: `smtpClient.create()` should fetch from AWS Secrets Manager, not env vars

#### 4. **API Gateway Not Implemented** (No ingress control)
**Status:** 0% | **Impact:** Services exposed directly, no rate limiting, no central JWT validation
- CLAUDE.md specifies: API Gateway rate limit 100 req/min per device, payment endpoint 10 req/min, login 5 attempts/15min
- No central JWT verification middleware
- No request ID tracing
- No audit logging aggregation

**What you need to do:**
- [ ] Create `services/api-gateway/src/main.ts` Express app
- [ ] Add middleware: request ID generation (UUID), JWT verification, device fingerprinting, rate limiter (ioredis + min-rate-limit or similar)
- [ ] Add request/response logging (structured JSON to Datadog)
- [ ] Create routes that proxy to internal services: `GET /wallets/:id` → `http://wallet-service:3002/wallets/:id`
- [ ] Ensure all responses follow `{ success: boolean, data: T, error?: { code, message } }` shape
- [ ] Add Sentry error tracking

#### 5. **Mobile Apps Missing** (No frontend)
**Status:** 5% (theme + one feature only) | **Impact:** Users cannot access wallet on any platform
- ❌ No auth screens (login, register, PIN setup, biometric enrollment)
- ❌ No wallet dashboard (balance, transaction history, limits)
- ❌ No payment screens (send money, request payment, QR scan)
- ❌ No offline sync (Hive + SQLite drift missing)
- ❌ No biometric support (local_auth package)
- ❌ No certificate pinning (dio_certificate_pinning package)

- ❌ No PWA (Next.js 14 web app missing entirely)
- ❌ No USSD gateway (Node.js/Africa's Talking gateway missing entirely)
- ❌ No agent portal (cash agent dashboard missing entirely)

**What you need to do:**
- [ ] Complete Flutter mobile app (8-10 weeks):
  - Auth feature: login/register/PIN screens (BLoC + UI)
  - Wallet feature: balance view, transaction history, limits display
  - Payment feature: complete send/request flows, QR scanner
  - Settings feature: KYC status, account security, device management
  - Offline sync: Hive + drift for local persistence
  - Add certificate pinning + TLS 1.3 validation
  - Add biometric support (TouchID/FaceID on iOS, fingerprint on Android)
  
- [ ] Build Next.js 14 PWA (~4-6 weeks)
- [ ] Build USSD gateway for Africa's Talking (~4-6 weeks)
- [ ] Build agent portal for cash agents (~4-6 weeks)

#### 6. **Zero Test Coverage** (SARB regulatory issue)
**Status:** 0% coverage, 0 test files | **Impact:** Cannot certify readiness, SARB will reject
- CLAUDE.md mandate: **80% lines minimum, 95% for payment + accounting logic**
- No test infrastructure (Jest not configured)
- Zero tests for: payment idempotency, KYC tier enforcement, AML flagging, balance calculations

**What you need to do:**
- [ ] Set up Jest in root `package.json` with coverage thresholds: 80% lines, 95% for payment/accounting
- [ ] Write tests BEFORE implementing missing services (payments, KYC, wallet, notification, reporting)
- [ ] For payment service: test idempotency (same request = no double charge), fee calculation, account reconciliation
- [ ] For KYC service: test tier progression (Tier 0→1→2), document validation, limits enforcement
- [ ] For wallet service: test concurrent balance updates (SELECT FOR UPDATE), soft delete logic
- [ ] Integrate coverage reports into GitHub Actions CI
- [ ] Block PR merges if coverage < threshold

#### 7. **Infrastructure Not Defined** (Terraform incomplete)
**Status:** Backend config only, no resources | **Impact:** Cannot provision AWS environment
- ❌ No RDS (PostgreSQL 16 + TimescaleDB + pgcrypto)
- ❌ No EKS cluster
- ❌ No VPC, load balancer, NAT gateway
- ❌ No ECR repositories for service images
- ❌ No AWS Secrets Manager secrets
- ❌ No RDS backup snapshots
- ❌ No Datadog APM agent
- ❌ No CloudWatch log groups

**What you need to do:**
- [ ] Add Terraform modules:
  - VPC: subnets, security groups, route tables (af-south-1)
  - RDS: PostgreSQL 16, TimescaleDB extension, backup retention 30 days
  - EKS: control plane + node groups (t3.medium minimum), RBAC, add-ons (VPC CNI, CoreDNS, kube-proxy)
  - ECR: registry for 8 service images
  - Secrets Manager: SARB PSP cert, PayShap cert, API keys, JWT private key
  - Parameter Store: non-secret config (database host, Redis endpoint)
  - CloudWatch: log groups per service, alarm thresholds

- [ ] Create separate stacks: `dev`, `staging`, `production` (different instance sizes, backup policies)
- [ ] Document infrastructure deployment runbook

#### 8. **CI/CD Incomplete** (No automated deployment)
**Status:** Lint + typecheck only | **Impact:** Manual deployments, high error risk
- ❌ No Docker builds
- ❌ No ECR pushes
- ❌ No deployment to EKS
- ❌ No smoke tests post-deployment
- ❌ No rollback strategy

**What you need to do:**
- [ ] Add GitHub Actions job: `docker-build.yml` — build images per service, push to ECR
- [ ] Add `deploy-staging.yml` — trigger after merge to staging branch
- [ ] Add `deploy-production.yml` — manual trigger (require approval) after merge to main
- [ ] Add smoke test job: verify all service healthchecks after deploy (`GET /health`)
- [ ] Add rollback job: revert to previous image tag on failure
- [ ] Integrate Datadog monitoring to detect service degradation

---

## 📋 Production Readiness Checklist

### Phase 0: Foundation (Weeks 1-2) — **CURRENT PRIORITY**
- [ ] Generate Prisma migrations (`prisma migrate dev --name init`)
- [ ] Create `shared-errors/` package with AhavaError class + error codes
- [ ] Create `shared-crypto/` package with encryption utilities + AWS Secrets Manager client
- [ ] Create `shared-events/` package with BullMQ queue definitions
- [ ] Set up Jest testing framework in root
- [ ] Scaffold API Gateway service (`services/api-gateway/`)
- [ ] Scaffold missing services: wallet, KYC, notification, reporting

### Phase 1: Backend HTTP & Data Layer (Weeks 3-6)
- [ ] Add Express entry points to all 8 services (auth, payment, wallet, kyc, notification, reporting, aml, api-gateway)
- [ ] Implement auth service routes: `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/device-bind`
- [ ] Implement wallet service CRUD: GET/POST/PUT `/wallets`
- [ ] Implement payment service routes: POST `/payments`, POST `/payments/qr`, webhook handlers
- [ ] Implement KYC service: document upload, tier progression, limits enforcement
- [ ] Implement notification service: event consumer, FCM/SMS/SES dispatcher
- [ ] Add Prisma database initialization + connection pooling
- [ ] Add audit logging to all mutation endpoints
- [ ] Write 80% coverage for all services
- [ ] Test locally: `docker-compose up` → all services healthy

### Phase 2: Infrastructure & Deployment (Weeks 7-10)
- [ ] Define Terraform resources: RDS, EKS, VPC, ECR, Secrets Manager
- [ ] Create separate dev/staging/production stacks
- [ ] Add GitHub Actions CI/CD: Docker builds, ECR pushes, EKS deployments
- [ ] Set up monitoring: Datadog APM, Sentry error tracking, CloudWatch logs
- [ ] Create runbooks: scaling, failover, disaster recovery
- [ ] Provision dev environment in AWS; deploy to EKS
- [ ] Smoke test all API endpoints

### Phase 3: Mobile & Frontend (Weeks 11-18)
- [ ] Complete Flutter app: auth, wallet, payments, settings (8-10 weeks)
- [ ] Build Next.js PWA (4-6 weeks)
- [ ] Build USSD gateway (4-6 weeks)
- [ ] Build agent portal (4-6 weeks)
- [ ] Integration testing: app ↔ backend, payments end-to-end
- [ ] Performance testing: load test payment endpoint (target: 1000 req/sec)

### Phase 4: Security Hardening & Compliance (Weeks 19-22)
- [ ] Certificate pinning in Flutter (dio_certificate_pinning)
- [ ] TLS 1.3 enforcement at API Gateway
- [ ] POPIA consent flows + data deletion workflows
- [ ] AML STR filing automation (ComplyAdvantage triggers)
- [ ] Penetration testing by external firm
- [ ] SARB PSP readiness audit
- [ ] Compliance sign-off from legal/compliance team

### Phase 5: Staging & Load Testing (Weeks 23-26)
- [ ] Deploy to staging environment (production-like data volume: 100K users)
- [ ] Load testing: payment throughput (target: 1000 concurrent users)
- [ ] Chaos engineering: simulate RDS failover, service crashes, network latency
- [ ] User acceptance testing (UAT) with Ahava team
- [ ] Performance optimization: cache strategies, database query optimization
- [ ] Documentation: runbooks, API docs, deployment guides

### Phase 6: Pre-Launch (Week 27 onwards)
- [ ] Final SARB PSP approval (regulatory gate — likely **2026 H2**)
- [ ] Production secrets provisioning (PayShap cert, API keys)
- [ ] Blue/green deployment to production (af-south-1)
- [ ] Go-live marketing + communications
- [ ] 24/7 on-call coverage (runbook + incident response)
- [ ] Post-launch monitoring + 48h stabilization

---

## 💰 Effort & Timeline Estimate

| Phase | Weeks | FTE | Notes |
|-------|-------|-----|-------|
| **Phase 0: Foundation** | 2 | 2 | Unblock all services; scaffold missing packages |
| **Phase 1: Backend** | 4 | 3 | Express routes, DB layer, 80% tests |
| **Phase 2: Infrastructure** | 4 | 2 | Terraform, EKS, CI/CD, monitoring |
| **Phase 3: Frontend** | 8 | 2 | Flutter (8-10w), PWA (4-6w) in parallel |
| **Phase 4: Security & Compliance** | 4 | 2 | Hardening, SARB audit, legal approval |
| **Phase 5: Staging & Testing** | 4 | 3 | Load testing, UAT, optimization |
| **Phase 6: Launch** | 1+ | 2 | Go-live, monitoring, incident response |
| **TOTAL** | **27 weeks** | **~2-3 eng** | **~7 months** (Sep 2026 target) |

**Critical Gate:** SARB PSP licence approval (application pending, likely Sep 2026)

---

## 🎬 What YOU Need to Do (Priority Ranked)

### Immediate (This week)
1. **Decide: Build vs Partner**
   - [ ] Can you allocate 2-3 full-time engineers for 7 months?
   - [ ] Or hire engineering agency/partner?
   - [ ] Ahava team capacity for product/compliance review?

2. **Secure Key Infrastructure & Credentials**
   - [ ] AWS account in af-south-1 (Cape Town)
   - [ ] PayShap SARB cert (mTLS) + API credentials
   - [ ] ComplyAdvantage API key (AML screening)
   - [ ] Africa's Talking account (SMS/USSD sandbox)
   - [ ] Firebase project (push notifications)
   - [ ] Datadog + Sentry accounts (monitoring)

3. **Create Session Memory**
   - [ ] Track milestones, blockers, decisions in this PRODUCTION_ROADMAP
   - [ ] Update weekly with progress

### Short-term (Weeks 1-4)
1. **Coordinate Regulatory**
   - [ ] Submit SARB PSP licence application (if not done)
   - [ ] Engage legal: POPIA consent templates, AML STR processes
   - [ ] Confirm KYC tier limits (Tier 0: R1000, Tier 1: R50K, Tier 2: no limit?)

2. **Finalize Design & Contracts**
   - [ ] Lock API specifications (document in OpenAPI/Swagger)
   - [ ] Finalize mobile UX (Figma mockups for all 15+ screens)
   - [ ] Confirm payment rails (PayShap, bank partnerships)
   - [ ] Legal review: terms of service, privacy policy

3. **Provision Development Environment**
   - [ ] Set up GitHub organization + repo
   - [ ] Configure branch protection (main/staging)
   - [ ] Add team members to AWS
   - [ ] Provision dev VPC in af-south-1

### Mid-term (Weeks 5-13)
1. **Engineering Execution**
   - [ ] Assign lead engineers per layer (backend, mobile, infra)
   - [ ] Daily standups: track blockers
   - [ ] 2-week sprints with clear goals
   - [ ] Code reviews for all PRs (2 approvals mandatory)

2. **Compliance Tracking**
   - [ ] Audit log every transaction (FICA requirement)
   - [ ] Document KYC tier enforcement (SARB audit trail)
   - [ ] Track AML flags + STR filings (regulatory reporting)

3. **Stakeholder Comms**
   - [ ] Weekly demo to product team
   - [ ] Bi-weekly SARB regulatory updates (if applicable)
   - [ ] Monthly metrics: deployment frequency, test coverage, incident response time

### Long-term (Weeks 14-27)
1. **User Testing**
   - [ ] Recruit beta users (100-500) from Ahava networks
   - [ ] Conduct usability testing (mobile + web)
   - [ ] Iterate based on feedback

2. **Go-Live Readiness**
   - [ ] Load testing: 1000 concurrent users, 100K transaction/day
   - [ ] Chaos testing: service failures, network latency, back-of-envelope math on cost failure modes
   - [ ] Security hardening review (third-party penetration test)
   - [ ] Final SARB approval letter in hand

3. **Launch Day Operations**
   - [ ] On-call team trained (runbooks, incident escalation)
   - [ ] Monitoring dashboards live (Datadog, alert thresholds)
   - [ ] Communication plan: status page, notification channels
   - [ ] Rollback plan documented + tested

---

## 🚨 Top 5 Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **SARB regulatory delays** | 3-6 month slip | Submit application NOW; engage regulatory advisor; monthly check-ins |
| **No payment rails ready** | Cannot process real money | Lock PayShap integration + testing; have bank backup; start 2 months early |
| **Database schema issues discovered late** | Major rework at scale | Load test with 100K users now; verify schema in staging early (week 13) |
| **Mobile app bugs at launch** | High uninstall rate | Flutter E2E testing framework; beta with 500 users; track crash rate |
| **Insufficient engineering capacity** | Slippage to 2027 | Hire now if internal team < 2 FTE; consider agency for frontend work |

---

## 📞 Next Steps

1. **Review this roadmap with your team** — does effort / timeline align with capacity?
2. **Lock down regulatory path** — confirm SARB application status
3. **Secure infrastructure + credentials** — AWS, PayShap, etc.
4. **Start Phase 0 immediately** — generate migrations, scaffold services (this is a 2-week lift)
5. **Schedule weekly syncs** — track progress against these milestones

---

**Last Updated:** March 17, 2026  
**Owner:** Ahava Engineering Team  
**Next Review:** Weekly in standup
