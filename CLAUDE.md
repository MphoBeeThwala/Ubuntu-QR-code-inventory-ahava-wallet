# AHAVA eWallet — Claude Code Master Context

## Project identity
- **Product**: Ahava eWallet — inclusive South African digital wallet
- **Meaning**: Ahava (אהבה) = love in Hebrew. Every UX decision carries warmth, trust, care.
- **Owner**: [COMPANY_NAME_TBD]
- **Regulatory status**: SARB PSP licence applicant under PEM Programme (2026)
- **Primary market**: South Africa — all platforms including USSD for feature phones

## Monorepo structure
```
ahava/
├── apps/
│   ├── mobile/          # Flutter 3.x — Android + iOS
│   ├── pwa/             # Next.js 14 — Web PWA
│   ├── ussd/            # Node.js — Africa's Talking USSD gateway
│   └── agent-portal/    # Next.js 14 — Cash agent web dashboard
├── services/
│   ├── api-gateway/     # Express — single ingress, JWT auth, rate limiting
│   ├── auth-service/    # User registration, KYC, JWT, biometric
│   ├── wallet-service/  # Wallet CRUD, balances, limits, youth accounts
│   ├── payment-service/ # Transactions, QR, PayShap, fees, idempotency
│   ├── kyc-service/     # Tiered KYC, FICA, document verification
│   ├── notification-service/ # Push, SMS (Africa's Talking), email (SES)
│   ├── reporting-service/    # VAT, statements, SARB compliance exports
│   └── aml-service/     # Real-time AML, fraud scoring, STR filing
├── packages/
│   ├── shared-types/    # TypeScript interfaces shared across all services
│   ├── shared-errors/   # Custom error classes, error codes
│   ├── shared-crypto/   # Encryption utilities, key management wrappers
│   ├── shared-events/   # Bull queue definitions, event types
│   └── database/        # Prisma client, migrations, seeds
├── infrastructure/
│   ├── terraform/       # AWS Cape Town (af-south-1) IaC
│   ├── docker/          # Dockerfiles per service
│   └── k8s/             # Kubernetes manifests (EKS)
├── .github/
│   └── workflows/       # CI/CD pipelines
├── prisma/
│   └── schema.prisma    # Single source of truth — all tables
├── CLAUDE.md            # THIS FILE — read at start of every session
├── turbo.json           # Turborepo pipeline config
├── package.json         # Root workspace
└── docker-compose.yml   # Local dev environment
```

## Absolute rules — never break these

### Financial integrity
- ALL monetary amounts stored as **integers in cents** (kobo/cents). R 10.50 = 1050. No floats in the DB ever.
- **No hard deletes** on any financial record. Use `deleted_at` soft delete + `is_deleted` flag.
- Every wallet mutation (debit/credit) must use `SELECT FOR UPDATE` to prevent race conditions.
- Every payment must carry an **idempotency key** (UUID from client). Check Redis cache before processing.
- Double-entry accounting: every rand that leaves one wallet must arrive in another. No money created or destroyed.
- All timestamps stored as **UTC** in the database. Display in SAST (UTC+2) in the UI.

### Security non-negotiables
- PIN hashing: **Argon2id** only. Never bcrypt, never MD5, never plaintext.
- JWT signing: **RS256** (asymmetric). Private key in AWS Secrets Manager. Never in env vars or code.
- **Certificate pinning** in Flutter app (dio_certificate_pinning). Reject any cert not matching the pinned SHA-256.
- Database: **pgcrypto AES-256** for PII fields (id_number, phone, biometric_hash).
- TLS: **1.3 minimum**. Reject TLS 1.2 and below at the load balancer.
- Rate limiting at API Gateway: 100 req/min per device. Payment endpoint: 10 req/min. Login: 5 attempts/15min.
- **No secrets in code, env files, or Docker images**. All secrets via AWS Secrets Manager + Parameter Store.

### Regulatory (SARB / FICA / POPIA)
- Every API mutation creates an **audit log entry** (who, what, when, IP, device fingerprint).
- KYC tier limits enforced server-side. Client-side limit display is cosmetic only.
- All personal data encrypted at rest. POPIA: no data sold, no third-party sharing without consent.
- AML: sanctions screening on every transaction (ComplyAdvantage API). STRs filed within 24h of detection.
- Data residency: **all data stays in af-south-1 (Cape Town)**. No cross-region replication to non-SA regions.
- Wallet transaction records retained for **minimum 5 years** (FICA requirement).
- VAT at **15%** for all applicable transactions.

### Code quality
- TypeScript **strict mode** everywhere. No `any`. No `as unknown`.
- Test coverage minimum: **80% lines** for service logic. Payment and accounting: **95%**.
- All PRs require two approvals. No direct pushes to `main` or `staging`.
- **Write tests before implementation** for: payment processing, KYC logic, AML rules, accounting engine.
- Database migrations: **never destructive** in production. Add columns, don't remove. Rename via alias + backfill.
- API responses: always `{ success: boolean, data: T, error?: ErrorDetail }` shape.

## Tech stack reference
| Layer | Technology | Version |
|-------|-----------|---------|
| Mobile | Flutter | 3.19+ |
| State management | flutter_bloc | 8.x |
| Mobile HTTP | Dio + interceptors | 5.x |
| Local DB (offline) | Hive + SQLite (drift) | Latest |
| QR scanning | mobile_scanner (ML Kit) | 4.x |
| Web/PWA | Next.js | 14.x |
| Backend runtime | Node.js | 20 LTS |
| Backend framework | Express | 4.x |
| Language | TypeScript | 5.x |
| ORM | Prisma | 5.x |
| Primary DB | PostgreSQL | 16 |
| Cache / queues | Redis 7 + BullMQ | Latest |
| Time-series | TimescaleDB extension | Latest |
| Infrastructure | Terraform | 1.7+ |
| Container orchestration | AWS EKS (Kubernetes) | 1.29 |
| CI/CD | GitHub Actions | Latest |
| Monitoring | Datadog (APM + logs) | Latest |
| Error tracking | Sentry | Latest |
| Payments | PayShap (SARB) | v1 |
| SMS / USSD | Africa's Talking | Latest |
| Push notifications | Firebase Cloud Messaging | Latest |
| Email | AWS SES | Latest |

## Environment tiers
- `local` — docker-compose, local Postgres + Redis, mock payment rails
- `dev` — AWS dev account, real Africa's Talking sandbox, PayShap sandbox
- `staging` — AWS staging account, full integration, production-like data volume
- `production` — AWS Cape Town af-south-1, real money, real people

## Key contacts / service accounts (fill before first deploy)
- SARB PSP Licence number: `[PENDING_APPLICATION]`
- ComplyAdvantage API key: `[IN_SECRETS_MANAGER: /ahava/prod/comply-advantage-key]`
- Africa's Talking: `[IN_SECRETS_MANAGER: /ahava/prod/at-api-key]`
- PayShap credentials: `[IN_SECRETS_MANAGER: /ahava/prod/payshap-cert]`
- Firebase project ID: `ahava-ewallet-prod`
- Datadog API key: `[IN_SECRETS_MANAGER: /ahava/prod/datadog-key]`

## Opening prompt for new Claude Code sessions
Paste this at the start of every new session:
```
Read CLAUDE.md fully before writing any code. We are building Ahava eWallet — 
a SARB-regulated South African inclusive digital wallet. Stack: Flutter + Node.js 
TypeScript monorepo + PostgreSQL + Redis + AWS Cape Town. All monetary values in 
cents as integers. No hard deletes. Argon2id for PINs. RS256 JWTs. Ask before 
any irreversible action.
```
