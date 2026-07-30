# Ubuntu Pay / Ahava Wallet - Quick Start Guide

**Developed by: Mpho Thwala, CEO of Ahava on 88 Pty Ltd**
**Version: 1.0.0**
**Date: July 2026**

## Overview

Ubuntu Pay is a next-generation digital wallet and payment platform built for the African market.

## Prerequisites

- Node.js 18+
- Docker and Docker Compose
- PostgreSQL 14+
- Redis 6+
- Git

## Local Development Setup

### 1. Clone the Repository

git clone https://github.com/MphoBeeThwala/Ubuntu-QR-code-inventory-ahava-wallet.git
cd Ubuntu-QR-code-inventory-ahava-wallet

### 2. Install Dependencies

npm install
npm run bootstrap

### 3. Configure Environment

Create a .env file in the root directory:

cp .env.example .env

Edit .env with your local configurations:

NODE_ENV=development
DATABASE_URL=postgresql://ahava:ahava_dev_pass@localhost:5432/ahava_dev
REDIS_URL=redis://localhost:6379
JWT_PRIVATE_KEY=your_generated_private_key
JWT_PUBLIC_KEY=your_generated_public_key

### 4. Set Up Database

Start PostgreSQL and Redis via Docker:

docker-compose -f docker-compose.dev.yml up -d

Run migrations:

npx prisma migrate dev

Seed database (optional):

npx prisma db seed

### 5. Start Services

Start all services:

npm run dev

Or start individual services:

cd services/auth-service && npm run dev
cd services/api-gateway && npm run dev

### 6. Test the System

Health check all services:

curl http://localhost:3000/health
curl http://localhost:6001/health
curl http://localhost:6002/health

Test authentication:

curl -X POST http://localhost:6001/auth/register   -H Content-Type: application/json   -d '{"phoneNumber": "+27123456789", "pin": "123456", "deviceId": "test-device"}'

## Service Ports

| Service | Port | Health Endpoint |
|---------|------|-----------------|
| api-gateway | 3000 | /health |
| auth-service | 6001 | /health |
| wallet-service | 6002 | /health |
| payment-service | 6003 | /health |
| ledger-service | 6004 | /health |
| payment-orchestrator | 6005 | /health |
| kyc-service | 6006 | /health |
| notification-service | 6007 | /health |
| aml-service | 6008 | /health |

## Troubleshooting

### Database Connection Issues
- Verify Docker containers are running: docker ps
- Check database logs: docker logs container_id

### Redis Connection Issues
- Verify Redis is running: redis-cli ping

### Port Conflicts
- Check running processes: lsof -i :3000

## Next Steps

- Set up local development environment
- Test all service endpoints
- Configure third-party integrations (optional)
- Run integration tests

## Support

For issues or questions, contact Mpho Thwala at themol581@gmail.com.

---

Ahava on 88 Pty Ltd | Ubuntu Pay Platform | Made in South Africa
