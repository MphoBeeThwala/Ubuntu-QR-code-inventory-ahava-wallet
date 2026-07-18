# Ubuntu Pay

**South Africa's inclusive digital wallet and QR commerce platform**

Ubuntu Pay enables consumers, merchants, and agents to participate in everyday digital transactions through:
- Phone-first digital wallets
- QR code payments for goods and services
- Agent-assisted cash-in and cash-out
- USSD access for basic phones
- Merchant acceptance with simple QR codes
- Future PayShap interoperability

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start local infrastructure
npm run docker:up

# 3. Run migrations
npm run db:migrate

# 4. Seed demo data
npx ts-node scripts/seed-demo-data.ts

# 5. Start services
npm run dev
```

## 🏗️ Architecture

- **Backend**: 8 Node.js/TypeScript microservices
- **Frontend**: Flutter (mobile), Next.js (PWA, Agent Portal)
- **Database**: PostgreSQL 16 + TimescaleDB
- **Cache**: Redis
- **Infrastructure**: Terraform (AWS), Docker, Kubernetes

## 📚 Key Documents

- [MVP Delivery Plan](MVP_DELIVERY_PLAN.md)
- [Investor Product Brief](INVESTOR_PRODUCT_BRIEF.md)
- [Production Roadmap](PRODUCTION_ROADMAP.md)
- [SARB Compliance Map](SARB_COMPLIANCE_MAP.md)
- [Demo Runbook](DEMO_RUNBOOK.md)

## 🎯 MVP Demo Flow

1. User registers and creates wallet
2. Wallet is funded (seeded with demo balance)
3. User scans merchant QR code
4. Payment completes instantly
5. Merchant sees confirmation
6. Agent can cash-in/cash-out
7. Inventory management for merchants
8. PayShap integration-ready

## 💡 Core Features

### Wallet
- Register with phone number
- PIN authentication (Argon2id)
- Balance management
- Transaction history

### Payments
- Wallet-to-wallet transfers
- QR code payments
- Atomic transactions (double-entry accounting)
- Idempotency keys (prevent duplicate payments)

### Merchant
- QR code generation (static and dynamic)
- Instant payment confirmation
- Transaction history
- Inventory management

### Agent
- Cash-in and cash-out
- Float management
- Commission tracking
- Transaction processing

### Compliance
- KYC tier system (TIER_0 to MERCHANT)
- AML screening
- Audit logging
- SARB-aligned architecture

## 🔐 Security

- **Authentication**: JWT RS256 with AWS Secrets Manager
- **Encryption**: AES-256-GCM for PII
- **Hashing**: Argon2id for PINs
- **Rate Limiting**: 100 req/min per device
- **Audit Trail**: Immutable logs with hash chaining

## 📞 Contact

For more information, see the [Investor Product Brief](INVESTOR_PRODUCT_BRIEF.md) or check out the [MVP Delivery Plan](MVP_DELIVERY_PLAN.md).
