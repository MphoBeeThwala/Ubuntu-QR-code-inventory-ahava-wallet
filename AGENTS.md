# Ahava Ubuntu Pay - Development Team

## Project Leadership

**Mpho Thwala** - CEO & Lead Architect  
Ahava on 88 Pty Ltd  
Email: themol581@gmail.com  
Date: July 2026

## Development Team Structure

### Core Team
- **Mpho Thwala** - CEO, System Architect, Full-Stack Developer
  - Responsible for: Overall architecture, payment orchestration, ledger system, authentication
  - Expertise: TypeScript, Node.js, Express, PostgreSQL, Redis, Distributed Systems

### Service Ownership

| Service | Owner | Responsibilities |
|---------|-------|------------------|
| api-gateway | Mpho Thwala | Request routing, rate limiting, authentication middleware |
| auth-service | Mpho Thwala | User authentication, PIN management, device binding |
| wallet-service | Mpho Thwala | Wallet management, balance tracking |
| payment-service | Mpho Thwala | Payment processing, transaction management |
| ledger-service | Mpho Thwala | Double-entry accounting, trial balance, reconciliation |
| payment-orchestrator | Mpho Thwala | Saga orchestration, PayShap integration |
| notification-service | Mpho Thwala | SMS, push notifications, email |
| kyc-service | Mpho Thwala | Identity verification, compliance |
| aml-service | Mpho Thwala | Anti-money laundering, screening |
| pwa | Mpho Thwala | Progressive Web App frontend |
| agent-portal | Mpho Thwala | Agent management interface |

## Development Standards

### Code Quality
- TypeScript strict mode enabled
- ESLint with custom rules
- Pre-commit hooks via Husky
- 100% test coverage for critical paths

### Architecture Principles
- Microservices with clear boundaries
- Event-driven architecture with BullMQ
- Circuit breakers for resilience
- Idempotency for all operations
- Audit logging for compliance

### Security
- JWT tokens with RSA 4096-bit keys
- Rate limiting per service
- Input validation on all endpoints
- PII encryption at rest
- HTTPS enforcement

## Contact

For all development-related inquiries, contact Mpho Thwala at themol581@gmail.com.
