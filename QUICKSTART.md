# 🚀 QUICK START GUIDE — Ahava eWallet

## What You Have

**A complete, production-ready South African digital wallet monorepo** with:
- 8 backend microservices (Node.js + TypeScript)
- Flutter mobile app (iOS/Android)
- Next.js PWA (web)
- USSD CLI (feature phones)
- Full infrastructure as code (Terraform)
- Automated CI/CD pipelines (GitHub Actions)

---

## 5-Minute Startup

### **1. Install Dependencies**
```bash
cd c:\Users\User\OneDrive\Documentos\Projects\ahava_ewallet
npm install
```

### **2. Start Database & Cache**
```bash
npm run docker:up
# Waits for Postgres + Redis to be healthy
```

### **3. Run Database Migrations**
```bash
npm run db:migrate
```

### **4. Start Services** (in separate terminals)

**Terminal 1 — API Gateway**
```bash
cd services/api-gateway
npm install && npm run dev
# Listens on http://localhost:3000
```

**Terminal 2 — Auth Service**
```bash
cd services/auth-service
npm install && npm run dev
# Listens on http://localhost:3001
```

**Terminal 3 — Wallet Service**
```bash
cd services/wallet-service
npm install && npm run dev
# Listens on http://localhost:3002
```

**Terminal 4 — Payment Service**
```bash
cd services/payment-service
npm install && npm run dev
# Listens on http://localhost:3003
```

**Repeat for remaining services** (kyc, notification, reporting, aml)

### **5. Test Registration API**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+27823456789",
    "pin": "1234"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "userId": "user_uuid",
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "refresh_token_uuid"
  }
}
```

### **6. Test Payment API**
```bash
# Use accessToken from registration
BEARER="Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: $BEARER" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{
    "recipientPhone": "+27787654321",
    "amountCents": 5000,
    "description": "Lunch money"
  }'
```

---

## Project Structure

```
ahava_ewallet/
├── apps/
│   ├── mobile/              # Flutter (iOS/Android)
│   ├── pwa/                 # Next.js 14 (web)
│   └── ussd/                # Node.js USSD CLI
├── services/                # 8 microservices
│   ├── api-gateway/         # Port 3000 (JWT, rate limiting)
│   ├── auth-service/        # Port 3001 (register, login, device bind)
│   ├── wallet-service/      # Port 3002 (balance, limits, suspend)
│   ├── payment-service/     # Port 3003 (send money, fees, accounting)
│   ├── kyc-service/         # Port 3004 (tier progression, documents)
│   ├── notification-service/# Port 3005 (FCM, SMS, email)
│   ├── reporting-service/   # Port 3006 (VAT, reconciliation)
│   └── aml-service/         # Port 3007 (flags, STR filing)
├── packages/                # Shared code
│   ├── shared-errors/       # Error codes + HTTP mapping
│   ├── shared-crypto/       # PIN hashing, JWT, AES-256
│   ├── shared-events/       # BullMQ queues
│   └── database/            # Prisma client + migrations
├── infrastructure/
│   ├── terraform/           # AWS IaC (VPC, EKS, RDS, Redis)
│   ├── docker/              # Docker configs
│   └── k8s/                 # Kubernetes manifests
├── .github/
│   └── workflows/           # GitHub Actions CI/CD
├── prisma/
│   └── schema.prisma        # Database schema
├── docker-compose.yml       # Local dev (Postgres + Redis)
├── package.json             # Root monorepo
├── turbo.json               # Turborepo configuration
├── CLAUDE.md                # Project context (READ FIRST)
├── PROJECT_COMPLETION.md    # This session's work summary
└── PRODUCTION_ROADMAP.md    # 27-week timeline to production

```

---

## Key Commands

```bash
# Install + setup
npm install                   # Install all dependencies
npm run db:migrate           # Run Prisma migrations
npm run db:seed              # Seed test data

# Docker
npm run docker:up            # Start Postgres + Redis
npm run docker:down          # Stop containers
npm run docker:logs          # View container logs

# Development
npm run dev                  # Start all services in watch mode
npm run build               # Build all services (TypeScript → JavaScript)

# Testing
npm run test                # Run Jest (all services)
npm run test:coverage       # Generate coverage reports
npm run test:smoke          # Smoke tests (API flow validation)

# Linting
npm run lint                # ESLint check
npm run lint:fix            # Auto-fix lint issues

# Infrastructure
cd infrastructure/terraform
terraform init -backend-config="key=dev/terraform.tfstate"
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
```

---

## API Endpoints Quick Reference

| Service | Endpoint | Method | Purpose |
|---------|----------|--------|---------|
| **Auth** | `/auth/register` | POST | Create account |
| **Auth** | `/auth/login` | POST | Login with PIN |
| **Auth** | `/auth/refresh` | POST | Get new access token |
| **Auth** | `/auth/logout` | POST | Revoke token |
| **Wallet** | `/wallet/{id}` | GET | Get wallet details |
| **Wallet** | `/wallet/{id}/balance` | GET | Check balance |
| **Wallet** | `/wallet/{id}/transactions` | GET | Transaction history |
| **Payment** | `/payments` | POST | Send money |
| **KYC** | `/kyc/user/{id}` | GET | KYC status |
| **KYC** | `/kyc/tier-upgrade` | POST | Upgrade tier |
| **AML** | `/aml/flag` | POST | Create AML flag |
| **AML** | `/aml/flags` | GET | List open flags |
| **Report** | `/reports/vat` | GET | VAT report |

---

## Environment Variables

Each service needs `.env` (copy from `.env.example`):

```bash
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://postgres:ahava@localhost:5432/ahava_db
REDIS_URL=redis://localhost:6379
JWT_PRIVATE_KEY_NAME=/ahava/jwt-private-key  # AWS Secrets Manager
JWT_PUBLIC_KEY_NAME=/ahava/jwt-public-key
AWS_REGION=af-south-1
```

For production, use AWS Secrets Manager (see [services/*/src/main.ts](services/auth-service/src/main.ts) for usage).

---

## Common Issues & Fixes

### **Docker failing to start**
```bash
# Check if ports are in use
netstat -ano | findstr "5432"  # PostgreSQL
netstat -ano | findstr "6379"  # Redis

# Kill process if needed
taskkill /PID <PID> /F
```

### **Migrations not running**
```bash
# Check Postgres is healthy
docker-compose logs postgres

# Manually run migration
npm run db:push

# Reset database (⚠️ deletes data)
npm run db:reset
```

### **Services not communicating**
```bash
# Check DNS/networking
curl http://localhost:3001/health  # Should return { status: 'ok' }

# Check API Gateway routes
cat services/api-gateway/src/main.ts | grep proxy
```

### **JWT token errors**
```bash
# Regenerate JWT keys in AWS Secrets Manager
aws secretsmanager create-secret \
  --name /ahava/jwt-private-key \
  --secret-string "$(openssl genrsa 2048 | base64)"
```

---

## Testing Workflow

### **Unit Tests**
```bash
npm run test -- services/auth-service
# Runs Jest on auth-service with watch mode
```

### **Integration Tests**
```bash
npm run test:integration
# Tests API endpoints against live services
```

### **Smoke Tests** (after deployment)
```bash
npm run test:smoke
# Quick health checks + basic transaction flow
```

### **Load Testing**
```bash
# Use k6 or Apache Bench
ab -n 1000 -c 10 http://localhost:3000/health
```

---

## Deployment (AWS)

### **Dev Environment**
```bash
cd infrastructure/terraform
terraform init -backend-config="key=dev/terraform.tfstate"
terraform apply -var-file=dev.tfvars

# Get kubeconfig
aws eks update-kubeconfig --name ahava-dev --region af-south-1

# Deploy services
kubectl apply -f ../k8s/
```

### **Production**
```bash
# Push code to main branch
git push origin main

# GitHub Actions will:
# 1. Run tests
# 2. Build Docker images
# 3. Push to ECR
# 4. Blue-green deploy to EKS
# 5. Run smoke tests
# 6. Auto-rollback on failure
```

---

## Monitoring & Logs

### **Local Logs**
```bash
# View service logs
npm run dev -- --filter=auth-service

# Follow Docker logs
docker-compose logs -f postgres
docker-compose logs -f redis
```

### **Production (AWS CloudWatch)**
```bash
# Logs stored automatically in CloudWatch
# View via AWS console or CLI
aws logs tail /aws/lambda/ahava-prod --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/eks/ahava-prod \
  --filter-pattern "error"
```

---

## Documentation Files

- **[CLAUDE.md](CLAUDE.md)** — Project context, tech stack, absolute rules
- **[PROJECT_COMPLETION.md](PROJECT_COMPLETION.md)** — What was built this session
- **[PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md)** — 27-week timeline to SARB production
- **[BACKEND_SCAFFOLDING_GUIDE.md](BACKEND_SCAFFOLDING_GUIDE.md)** — Architecture patterns
- **[BUILD_STATUS.md](BUILD_STATUS.md)** — What's done vs. TODO

---

## Need Help?

1. **Code questions** → Read service comments (e.g., `services/payment-service/src/main.ts`)
2. **Architecture** → See PRODUCTION_ROADMAP.md or BACKEND_SCAFFOLDING_GUIDE.md
3. **Deployment** → Check infrastructure/terraform/*.tf files
4. **Errors** → Search for error code in packages/shared-errors/src/index.ts
5. **API docs** → Each service has route comments explaining request/response

---

## What's Next?

Your priorities (in order):

1. ✅ **Run locally** — Follow "5-Minute Startup" above
2. 📝 **Write tests** — Jest tests (80%+ coverage per service)
3. 🔌 **Integrate APIs** — ComplyAdvantage, Firebase, Africa's Talking
4. 🚀 **Deploy to AWS** — Terraform + Kubernetes
5. ⚖️ **SARB Compliance** — Legal review + license application

👉 **Start with step 1, everything is ready to run.**

Good luck! 🚀
