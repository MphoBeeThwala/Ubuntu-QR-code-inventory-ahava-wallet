# Ubuntu Pay Platform API Documentation

## Overview

The Ubuntu Pay Platform provides a comprehensive REST API for digital payments in South Africa.

## Base URL

- Production: https://api.ubuntu-pay.co.za
- Staging: https://staging-api.ubuntu-pay.co.za
- Development: http://localhost:3000

## Authentication

All API requests require a valid JWT access token in the Authorization header:

Authorization: Bearer <access_token>

## Rate Limiting

- API Endpoints: 100 requests per 15 minutes
- Authentication: 5 requests per hour
- Payments: 10 requests per minute

## Financial Values

IMPORTANT: All monetary values are BIGINT cents (never floats).
Example: R100.00 = 10000 cents, R1,500.00 = 150000 cents

## Endpoints

### Health
- GET /health - Health check
- GET /ready - Readiness check
- GET /live - Liveness check
- GET /metrics - Prometheus metrics

### Authentication
- POST /api/v1/auth/login - Login with phone and PIN
- POST /api/v1/auth/refresh - Refresh access token
- POST /api/v1/auth/logout - Logout

### Wallet
- GET /api/v1/wallet - Get wallet balance
- GET /api/v1/wallet/transactions - Get transaction history

### Payments
- POST /api/v1/payments/transfer - Transfer to another user
- POST /api/v1/payments/qr/generate - Generate QR code
- POST /api/v1/payments/qr/scan - Process scanned QR
- POST /api/v1/payments/payshap - PayShap payment

### Agents
- GET /api/v1/agents - List agents

### Reporting
- GET /api/v1/reports/transactions - Transaction report
- GET /api/v1/reports/users - User report

## Webhooks

- transaction.completed
- transaction.failed
- wallet.updated
- payment.received

## Versioning

Current version: v1

## Support

Contact: support@ubuntu-pay.co.za