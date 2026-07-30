# Ubuntu Pay - Deployment Guide

**Author: Mpho Thwala, CEO of Ahava on 88 Pty Ltd**
**Version: 1.0.0**
**Date: July 2026**

## Overview

This guide provides step-by-step instructions for deploying Ubuntu Pay (formerly Ahava Wallet) to Render.com using the provided render.yaml blueprint.

## Prerequisites

- GitHub account with access to the repository
- Render.com account (free tier available)
- OpenSSL installed locally (for JWT key generation)
- Basic familiarity with command line

---

## Step 1: Prepare Your Repository

### 1.1 Clone the Repository

git clone https://github.com/MphoBeeThwala/Ubuntu-QR-code-inventory-ahava-wallet.git
cd Ubuntu-QR-code-inventory-ahava-wallet

### 1.2 Ensure All Files Are Present

Verify the following files exist:
- render.yaml - Render deployment blueprint
- services/auth-service/src/main.ts - Authentication service
- services/api-gateway/src/middleware/rate-limit.middleware.ts - Rate limiting
- services/ledger-service/src/main.ts - Ledger service
- services/payment-orchestrator/src/main.ts - Payment orchestrator
- services/ledger-service/package.json - Ledger dependencies
- services/payment-orchestrator/package.json - Orchestrator dependencies
- services/notification-service/src/sms.ts - SMS stub
- services/aml-service/src/comply-advantage.ts - AML stub
- services/notification-service/src/firebase.ts - Firebase stub
- scripts/generate-jwt-keys.sh - JWT key generator
- .env.example - Environment variables template

---

## Step 2: Generate JWT Keys

### 2.1 Run the Generation Script

chmod +x scripts/generate-jwt-keys.sh
./scripts/generate-jwt-keys.sh

This creates:
- keys/private_key.pem - RSA 4096-bit private key
- keys/public_key.pem - RSA 4096-bit public key

### 2.2 Prepare Keys for Render

For JWT_PRIVATE_KEY:
cat keys/private_key.pem | grep -v "BEGIN\|END" | tr -d "\n"

For JWT_PUBLIC_KEY:
cat keys/public_key.pem | grep -v "BEGIN\|END" | tr -d "\n"

Save these values - you will need them for Step 4

---

## Step 3: Configure Firebase (Optional - Free Tier)

### 3.1 Create Firebase Project

1. Go to https://console.firebase.google.com
2. Click Add project -> Ubuntu Pay
3. Follow the setup steps
4. Enable Firebase Cloud Messaging (FCM)

### 3.2 Get Service Account Key

1. Go to Project Settings -> Service Accounts
2. Click Generate new private key
3. Save the JSON file
4. Copy the entire JSON content

Save this JSON - you will need it for Step 4

---

## Step 4: Deploy to Render

### 4.1 Create New Blueprint

1. Go to https://dashboard.render.com
2. Click New -> Blueprint
3. Click Import Existing Resources
4. Select your GitHub repository: MphoBeeThwala/Ubuntu-QR-code-inventory-ahava-wallet
5. Select branch: main
6. Upload render.yaml file
7. Click Apply

Render will automatically:
- Create PostgreSQL database (ahava-postgres)
- Create Redis instance (ahava-redis)
- Deploy all 12 services
- Set up internal networking

### 4.2 Configure Environment Variables

After deployment starts, configure secrets for each service:

#### For ALL Services:
- NODE_ENV = production
- SERVICE_NAME = [service-name] (e.g., auth-service)

#### For auth-service:
- JWT_PRIVATE_KEY = (your private key from Step 2, without BEGIN/END lines)
- JWT_PUBLIC_KEY = (your public key from Step 2, without BEGIN/END lines)
- AT_USERNAME = (optional - leave empty for stub mode)
- AT_API_KEY = (optional - leave empty for stub mode)

#### For notification-service:
- AFRICAS_TALKING_API_KEY = (optional - leave empty for stub mode)
- AFRICAS_TALKING_USERNAME = (optional - leave empty for stub mode)
- FIREBASE_SERVICE_ACCOUNT_JSON = (optional - your Firebase JSON from Step 3)

#### For aml-service:
- COMPLYADVANTAGE_API_KEY = (optional - leave empty for stub mode)

Note: DATABASE_URL and REDIS_URL are automatically injected by Render

---

## Step 5: Verify Deployment

### 5.1 Check Service Status

All services should show Live status in Render dashboard.

### 5.2 Test Health Endpoints

curl https://ahava-api-gateway.onrender.com/health
curl https://ahava-auth-service.onrender.com/health
curl https://ahava-ledger-service.onrender.com/health
curl https://ahava-payment-orchestrator.onrender.com/health

### 5.3 Test Authentication Flow

curl -X POST https://ahava-auth-service.onrender.com/auth/register   -H Content-Type: application/json   -d '{"phoneNumber": "+27123456789", "pin": "123456", "deviceId": "test-device"}'

curl -X POST https://ahava-auth-service.onrender.com/auth/login   -H Content-Type: application/json   -d '{"phoneNumber": "+27123456789", "pin": "123456", "deviceId": "test-device"}'

### 5.4 Check Logs

In Render dashboard:
1. Go to each service
2. Click Logs tab
3. Verify no errors
4. Check for stub messages (if using stub mode)

---

## Step 6: Post-Deployment Configuration

### 6.1 Update DNS (Optional)

If you have a custom domain:
1. Go to Render dashboard
2. Select your service
3. Click Settings -> Custom Domains
4. Add your domain and follow verification steps

### 6.2 Set Up Monitoring

Render provides built-in monitoring. For enhanced monitoring:
1. Set up alerts in Render dashboard
2. Configure health check endpoints
3. Set up Slack/email notifications

### 6.3 Configure Backups

1. For PostgreSQL: Enable automatic backups in Render
2. For Redis: Enable persistence
3. Test restore procedure

---

## Step 7: Enable Production Features (When Ready)

### 7.1 Enable Real SMS (Africa's Talking)

1. Sign up at https://account.africastalking.com
2. Get your username and API key
3. Update AT_USERNAME and AT_API_KEY in auth-service and notification-service
4. Restart services

### 7.2 Enable Real AML Screening (ComplyAdvantage)

1. Sign up at https://complyadvantage.com
2. Get your API key
3. Update COMPLYADVANTAGE_API_KEY in aml-service
4. Restart aml-service

### 7.3 Enable Real Push Notifications (Firebase)

1. Complete Firebase setup (Step 3)
2. Update FIREBASE_SERVICE_ACCOUNT_JSON in notification-service
3. Restart notification-service

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed
- Cause: Incorrect DATABASE_URL
- Solution: Verify Render auto-injected the correct URL
- Check: echo $DATABASE_URL in service logs

#### 2. Redis Connection Failed
- Cause: Incorrect REDIS_URL
- Solution: Verify Render auto-injected the correct URL
- Check: echo $REDIS_URL in service logs

#### 3. JWT Token Verification Failed
- Cause: Private/public key mismatch
- Solution: Regenerate keys and update both JWT_PRIVATE_KEY and JWT_PUBLIC_KEY
- Check: Verify keys match (remove BEGIN/END lines)

#### 4. Service Not Starting
- Cause: Missing dependencies or build error
- Solution: Check logs for npm install errors
- Check: npm install locally and verify no errors

#### 5. Health Endpoint Returns 500
- Cause: Missing environment variables
- Solution: Verify all required variables are set
- Check: Compare with .env.example

---

## Cost Analysis

| Service | Cost | Notes |
|---------|------|-------|
| Render Hosting | FREE | Free tier available |
| PostgreSQL (Render) | FREE | Included in free tier |
| Redis (Render) | FREE | Included in free tier |
| Firebase | FREE | Free tier sufficient for development |
| Africa's Talking | Paid | Optional - stub mode available |
| ComplyAdvantage | Paid | Optional - stub mode available |
| Total | $0 | Using free tiers and stubs |

---

## Architecture Overview

### Services (12 Total)

#### Backend Microservices
1. api-gateway - Request routing, rate limiting, authentication
2. auth-service - User authentication, PIN management
3. wallet-service - Wallet creation and management
4. payment-service - Payment processing
5. ledger-service - Double-entry accounting
6. payment-orchestrator - Saga pattern orchestration
7. kyc-service - Identity verification
8. notification-service - SMS, push, email notifications
9. aml-service - Anti-money laundering screening
10. payshap-mock - PayShap integration (mock)
11. ussd-service - USSD menu system
12. reporting-service - Reports and analytics

#### Frontend Applications
1. pwa - Progressive Web App for users
2. agent-portal - Web portal for agents

### Infrastructure
- Database: PostgreSQL (managed by Render)
- Cache: Redis (managed by Render)
- Queue: BullMQ (Redis-backed)
- Container: Docker
- Deployment: Render.com

---

## Security Best Practices

### 1. JWT Keys
- Generate new keys for production
- Rotate keys periodically (every 6-12 months)
- Never commit private keys to Git
- Store private keys in secure vault (Render secrets)

### 2. Database
- Use strong passwords
- Enable SSL connections
- Regular backups
- Limited access

### 3. API Security
- Rate limiting enabled (via api-gateway)
- HTTPS enforcement
- Input validation on all endpoints
- JWT token verification
- Circuit breakers for external services

### 4. Monitoring
- Health endpoints on all services
- Structured logging
- Error tracking (Sentry integration in auth-service)
- Audit logging for compliance

---

## Compliance

### SARB Compliance
- Double-entry accounting (ledger-service)
- Audit logging (all services)
- Transaction reconciliation
- Complete ledger history
- Trial balance reports

### Data Protection
- PII encryption at rest
- Secure token handling
- No hardcoded secrets
- Environment variable management

---

## Support

For deployment issues or questions:
- Primary: Mpho Thwala - themol581@gmail.com
- Repository: https://github.com/MphoBeeThwala/Ubuntu-QR-code-inventory-ahava-wallet
- Documentation: See README.md and other markdown files in repo

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | July 2026 | Mpho Thwala | Initial deployment guide |

---

Ahava on 88 Pty Ltd | Ubuntu Pay Platform | Made in South Africa
