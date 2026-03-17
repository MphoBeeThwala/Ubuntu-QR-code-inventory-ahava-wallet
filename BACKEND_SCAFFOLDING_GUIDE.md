# Backend Service Scaffolding Guide

This document guides you through building the 8 backend services and filling in the TODO logic.

## 🏗️ Service Architecture

Each service follows this structure:

```
services/
├── api-gateway/
│   ├── src/
│   │   ├── main.ts             # Entry point
│   │   ├── app.ts              # Express app + middleware
│   │   ├── middleware/
│   │   │   ├── auth.ts         # JWT verification
│   │   │   ├── errorHandler.ts # Error boundary
│   │   │   ├── logging.ts      # Request/response logging
│   │   │   └── rateLimit.ts    # Rate limiting
│   │   ├── routes/
│   │   │   ├── index.ts        # Route aggregator
│   │   │   ├── auth.routes.ts  # /auth/* endpoints
│   │   │   ├── wallet.routes.ts
│   │   │   └── ...
│   │   ├── health.ts           # Health check endpoint
│   │   └── types/
│   │       ├── requests.ts     # Request DTOs
│   │       └── responses.ts    # Response DTOs
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── jest.config.js (for tests)
```

## 📋 Replicating Services

### Step 1: Create Service Directory Structure

```bash
mkdir -p services/{auth-service,payment-service,wallet-service,kyc-service,notification-service,reporting-service,aml-service,api-gateway}/src/{middleware,routes,types}
```

### Step 2: Copy & Adapt Boilerplate

Use `services/api-gateway/` as a template. For each new service:

1. Copy the full `api-gateway` structure to new service folder
2. Update `package.json` name: `@ahava/auth-service` etc.
3. Update `main.ts` PORT (6001-6008 assigned below)
4. Update `app.ts` with service-specific middleware
5. Replace `routes/` with service-specific endpoints

### Step 3: Service Ports & Startup

| Service | Port | Startup Command | Dependencies |
|---------|------|-----------------|--------------|
| auth-service | 6001 | `npm run dev` | PostgreSQL, Redis |
| wallet-service | 6002 | `npm run dev` | PostgreSQL, Redis |
| payment-service | 6003 | `npm run dev` | PostgreSQL, Redis, PayShap certs |
| kyc-service | 6004 | `npm run dev` | PostgreSQL, S3 |
| notification-service | 6005 | `npm run dev` | Redis (BullMQ consumer), FCM, SES, Africa's Talking |
| reporting-service | 6006 | `npm run dev` | PostgreSQL, TimescaleDB |
| aml-service | 6007 | `npm run dev` | Redis (BullMQ consumer), ComplyAdvantage API |
| api-gateway | 6000 | `npm run dev` | Redis (rate limiting), all other services |

### Step 4: Fill in TODO Logic

Each route has a `TODO:` comment marking where business logic goes. Example:

```typescript
// routes/auth.routes.ts
router.post("/auth/register", async (req, res, next) => {
  try {
    const { phoneNumber, pin, deviceId } = req.body;

    // TODO: Validate input (use @ahava/shared-errors)
    // TODO: Check if user already exists
    // TODO: Hash PIN using shared-crypto
    // TODO: Create user in database
    // TODO: Generate JWT tokens
    // TODO: Publish USER_REGISTERED event
    // TODO: Send welcome SMS notification
    // TODO: Log to audit trail

    res.json(createSuccessResponse({ userId, token }));
  } catch (error) {
    next(error);
  }
});
```

**You fill in the TODOs** using:
- Database: `@prisma/client`
- Crypto: `@ahava/shared-crypto`
- Errors: `@ahava/shared-errors`
- Events: `bullmq` + `@ahava/shared-events`
- Notifications: `bullmq` queue, then `notification-service` consumes

### Step 5: Environment Variables

Each service needs `.env`:

```bash
# Core
NODE_ENV=dev
SERVICE_NAME=auth-service
SERVICE_PORT=6001
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ahava_dev

# Redis
REDIS_URL=redis://localhost:6379

# Secrets (fetch from AWS in production)
PII_ENCRYPTION_KEY=<32-byte hex string>
JWT_PRIVATE_KEY=<RSA private key>
JWT_PUBLIC_KEY=<RSA public key>

# AWS
AWS_REGION=af-south-1
NODE_ENV=dev # or staging/production

# Service URLs (for API Gateway)
AUTH_SERVICE_URL=http://localhost:6001
WALLET_SERVICE_URL=http://localhost:6002
PAYMENT_SERVICE_URL=http://localhost:6003
KYC_SERVICE_URL=http://localhost:6004
NOTIFICATION_SERVICE_URL=http://localhost:6005
REPORTING_SERVICE_URL=http://localhost:6006
AML_SERVICE_URL=http://localhost:6007
```

### Step 6: Testing

Each service uses Jest. Tests follow this pattern:

```typescript
// tests/auth.service.test.ts
describe("Auth Service", () => {
  describe("POST /auth/register", () => {
    it("should create user and return tokens", async () => {
      // TODO: Mock Prisma client
      // TODO: Mock crypto functions
      // TODO: Mock queue publishing
      // TODO: Assert user created
      // TODO: Assert tokens returned
    });

    it("should reject duplicate phone", async () => {
      // TODO: Setup existing user in mock DB
      // TODO: Attempt register same phone
      // TODO: Assert CONFLICT_PHONE_ALREADY_REGISTERED error
    });
  });
});
```

## 🔧 Common Middleware to Implement

All services should have:

```typescript
// middleware/requestId.ts — Generate UUID for request tracing
// middleware/errorHandler.ts — Catch AhavaError, return JSON responses
// middleware/logging.ts — Log requests to Datadog/console
// middleware/auth.ts — JWT verification (if not API Gateway)
// middleware/rateLimit.ts — Redis-based rate limiting (API Gateway only)
```

## 🗂️ Database & Event Integration

### Prisma Usage

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Safe from race conditions:
const wallet = await prisma.wallet.update({
  where: { id: walletId },
  data: { balance: wallet.balance - amountCents },
});
```

### Publishing Events

```typescript
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@ahava/shared-events";

const paymentQueue = new Queue(QUEUE_NAMES.PAYMENTS_CREATED, {
  connection: redis,
});

await paymentQueue.add(
  "payment-created",
  {
    transactionId,
    walletId,
    amountCents,
    // ... rest of event
  },
  { jobId: idempotencyKey } // Prevent duplicates
);
```

### Consuming Events (Notification & AML Services)

```typescript
const worker = new Worker(QUEUE_NAMES.PAYMENTS_CREATED, async (job) => {
  const { transactionId, amountCents } = job.data;
  // Process event...
  // Send notification, screen AML, etc.
});
```

## 📡 API Gateway Pattern

The API Gateway (`6000`) proxies to backend services:

```
Client
  ↓
API Gateway (6000)
  │
  ├→ POST /auth/register → Auth Service (6001)
  ├→ GET /wallets/:id → Wallet Service (6002)
  ├→ POST /payments → Payment Service (6003)
  └→ ...
```

Example proxy middleware:

```typescript
app.post("/auth/register", async (req, res, next) => {
  try {
    const response = await fetch(`${process.env.AUTH_SERVICE_URL}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": req.id,
        "X-Forwarded-For": req.ip,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    next(error);
  }
});
```

## ✅ Checklist per Service

- [ ] Created service directory + boilerplate files
- [ ] Updated `package.json` with correct service name
- [ ] Implemented all route handlers (fill TODOs)
- [ ] Added Prisma database calls
- [ ] Published events for inter-service communication
- [ ] Implemented middleware (error handling, logging, auth)
- [ ] Created `.env.example`
- [ ] Added unit tests (80%+ coverage)
- [ ] Created Dockerfile
- [ ] Tested locally: `npm run dev` starts on correct port
- [ ] Tested locally: `POST /health` returns `{ status: "ok" }`

## 🚀 Deployment (EKS)

Each service becomes a Docker image + Kubernetes deployment:

```yaml
# k8s/auth-service.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: auth-service
        image: <ECR_REGISTRY>/ahava/auth-service:latest
        ports:
        - containerPort: 6001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
```

---

## 📚 Next Steps

1. **Create service directories** for remaining 7 services
2. **Use api-gateway boilerplate** as the template
3. **Implement TODO logic** in routes (payment processing, KYC, AML, wallet CRUD, notifications)
4. **Add Prisma calls** to persist data
5. **Configure BullMQ** event publishing/consuming
6. **Write tests** (80%+ coverage mandate)
7. **Deploy to EKS** with monitoring

---

### Quick Start Command

```bash
# Start all services locally in tmux or separate terminals
npm run docker:up  # Start Postgres + Redis

# Terminal 1: Auth Service
cd services/auth-service && npm run dev

# Terminal 2: Wallet Service
cd services/wallet-service && npm run dev

# Terminal 3: Payment Service
cd services/payment-service && npm run dev

# ... etc for remaining services

# Terminal 9: API Gateway (last, depends on others)
cd services/api-gateway && npm run dev

# Now test: curl http://localhost:6000/health
```

---

For questions on specific implementations, refer to the boilerplate files marked with `TODO:` comments.
