# Railway Deployment Guide

## Prerequisites
- Railway account (free tier available)
- GitHub repository connected

## Deployment Steps

1. **Create Railway Project**
   - Go to [Railway.app](https://railway.app)
   - Create new project
   - Connect your GitHub repository

2. **Railway Auto-Deployment**
   - Railway will detect `railway.json` and deploy all services
   - Services: pwa (frontend), api-gateway, auth-service, wallet-service, payment-service, kyc-service, notification-service, reporting-service, aml-service, ussd-service, agent-service

3. **Environment Variables**
   Set these in Railway dashboard (Variables tab):

   ### Database
   ```
   DATABASE_URL=postgresql://user:pass@host:5432/db
   ```

   ### Redis
   ```
   REDIS_URL=redis://host:6379
   REDIS_PASSWORD=your-redis-password
   ```

   ### JWT Keys
   ```
   JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
   JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
   ```

   ### Africa's Talking
   ```
   AFRICAS_TALKING_API_KEY=your-api-key
   AFRICAS_TALKING_USERNAME=your-username
   AFRICAS_TALKING_SENDER_ID=AHAVA
   ```

   ### AWS SES (Email)
   ```
   AWS_REGION=af-south-1
   SES_FROM_ADDRESS=noreply@ahava.co.za
   ```

   ### Firebase (Push Notifications)
   ```
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   ```

   ### Comply Advantage (AML)
   ```
   COMPLY_ADVANTAGE_API_KEY=your-api-key
   ```

   ### Service URLs (Railway will provide these)
   ```
   AUTH_SERVICE_URL=https://auth-service-production.up.railway.app
   WALLET_SERVICE_URL=https://wallet-service-production.up.railway.app
   PAYMENT_SERVICE_URL=https://payment-service-production.up.railway.app
   KYC_SERVICE_URL=https://kyc-service-production.up.railway.app
   NOTIFICATION_SERVICE_URL=https://notification-service-production.up.railway.app
   AGENT_SERVICE_URL=https://agent-service-production.up.railway.app
   ```

4. **Database Setup**
   - Railway provides PostgreSQL plugin
   - Run Prisma migrations: `npx prisma migrate deploy --schema=prisma/schema.prisma`
   - Or add a migration service in railway.json if needed

5. **Health Checks**
   - Each service has `/health` endpoint
   - Railway monitors these for service health

6. **Domain**
   - Set custom domain in Railway dashboard
   - Point frontend domain to pwa service

## Production Ready Features
- ✅ Health checks on all services
- ✅ Multi-service architecture
- ✅ Environment-based configuration
- ✅ Error handling and logging
- ✅ Security headers (Helmet)
- ✅ Rate limiting
- ✅ JWT authentication
- ✅ Database migrations
- ✅ PWA support

## Monitoring
- Railway provides logs and metrics
- Health endpoints for uptime monitoring
- Database and Redis monitoring included