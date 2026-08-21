# SARB Compliance Checklist - Ubuntu Pay Platform

## Overview

This document outlines the technical compliance requirements for the Ubuntu Pay Platform to meet South African Reserve Bank (SARB) standards.

**Note:** Regulatory compliance in licensing is not yet complete, but the system software must meet all technical standards.

## 1. Double-Entry Accounting

### Requirements
- All financial transactions recorded with both debit and credit entries
- SUM of all debits must equal SUM of all credits at all times
- Ledger entries are append-only (never deleted)
- All monetary values stored as BIGINT cents (never floats)

### Implementation
- Ledger Service: services/ledger-service/src/services/ledger-service.ts
- Verification: npm run verify:ledger
- Schema: ledger_entries table with debit_amount_cents and credit_amount_cents as BIGINT

### Verification Commands
- Check ledger balance: psql -c "SELECT SUM(debit_amount_cents) - SUM(credit_amount_cents) AS imbalance FROM ledger_entries;"
- Check by date range: psql -c "SELECT DATE_TRUNC('day', created_at) AS day, SUM(debit_amount_cents) - SUM(credit_amount_cents) AS daily_imbalance FROM ledger_entries GROUP BY day ORDER BY day;"
- Run automated verification: npm run verify:ledger

## 2. Audit Trail

### Requirements
- Complete audit log of all financial transactions
- Immutable audit records
- User identification for all actions
- Timestamp precision to milliseconds
- Correlation IDs for tracing across services

### Implementation
- Audit Logger: services/shared/src/config/logger.ts
- Storage: Audit logs stored in PostgreSQL with retention policy

### Verification
- All financial actions are logged
- Audit logs cannot be modified or deleted
- All changes include before/after values
- User identification is present for all entries

## 3. Transaction Integrity

### Requirements
- Unique transaction references
- Idempotency for all payment operations
- Prevention of duplicate processing
- Atomic transaction processing

### Implementation
- Idempotency Keys: All payment requests include idempotency key
- Reference IDs: Unique UUID v4 for all transactions
- Status Tracking: Transactions have clear status

### Verification
- Check for duplicate references: psql -c "SELECT reference_id, COUNT(*) FROM transactions GROUP BY reference_id HAVING COUNT(*) > 1;"
- Check for duplicate ledger entries: psql -c "SELECT reference_id, COUNT(*) FROM ledger_entries GROUP BY reference_id HAVING COUNT(*) > 1;"
- Run idempotency tests: npm run test:idempotency

## 4. KYC/AML Compliance

### Requirements
- KYC verification for all users
- AML screening for all transactions
- Risk-based approach to compliance
- Suspicious activity reporting

### Implementation
- KYC Service: services/kyc-service (if exists)
- AML Service: services/aml-service/src/services/aml-service.ts
- Watchlist Screening: Placeholder implementation in BATCH 8

### Verification
- All users have KYC status
- All transactions are screened for AML
- High-risk transactions are flagged
- Suspicious activities are reported

## 5. Data Protection

### Requirements
- Encryption of sensitive data at rest
- Encryption of sensitive data in transit
- Access controls for financial data
- Data retention policies

### Implementation
- Encryption: TLS 1.3 for all communications
- Database: PostgreSQL with encryption options
- Backups: AES-256 encryption
- Access Control: JWT authentication with role-based access

### Verification
- All API endpoints use HTTPS
- Database connections are encrypted
- Backup files are encrypted
- Access to financial data is role-restricted

## 6. Reporting

### Requirements
- Transaction reporting
- Compliance reporting
- Audit reporting
- SARB reporting (format ready)

### Implementation
- Reporting Service: services/reporting-service
- Scheduled Reports: Daily, weekly, monthly
- Ad-hoc Reports: On-demand reporting

## 7. Business Continuity

### Requirements
- Disaster recovery plan in place
- Backup and restore procedures
- High availability configuration
- Incident response procedures

### Implementation
- Disaster Recovery: BATCH 14 documentation
- High Availability: Multi-region deployment
- Incident Response: Runbook in BATCH 14

### Verification
- DR plan tested quarterly
- Backups verified daily
- HA failover tested monthly
- Incident response tested

## 8. Security

### Requirements
- Rate limiting on all endpoints
- Input validation on all inputs
- Security headers on all responses
- Authentication and authorization
- Secure password storage

### Implementation
- Rate Limiting: BATCH 11 - rateLimiter.ts
- Input Validation: BATCH 11 - validation.ts
- Security Headers: BATCH 11 - securityHeaders.ts
- Authentication: JWT with device binding
- Password Storage: Argon2 hashing

### Verification
- Rate limiting active on all endpoints
- Input validation on all API endpoints
- Security headers present on all responses
- Authentication required for sensitive endpoints
- Passwords are hashed (not stored in plaintext)

## 9. Monitoring and Alerting

### Requirements
- Real-time monitoring of all services
- Alerting on critical issues
- Financial data integrity monitoring
- Compliance metric tracking

### Implementation
- Monitoring: BATCH 10 - Prometheus + Grafana
- Alerting: BATCH 10 - Alert rules
- Financial Alerts: Ledger imbalance detection

### Alerts
- Ledger Imbalance: Immediate alert if debits != credits
- High Error Rate: Alert if error rate > 1%
- Service Downtime: Alert if any service down > 1 minute
- Financial Limits: Alert if approaching daily/monthly limits

## 10. Testing

### Requirements
- Unit tests for all financial logic
- Integration tests for all services
- End-to-end tests for all flows
- Compliance tests for all requirements

### Implementation
- Unit Tests: Jest tests in each service
- Integration Tests: Service-to-service testing
- E2E Tests: User journey testing
- Compliance Tests: npm run test:compliance

## Compliance Verification Scripts

### Run All Compliance Checks
npm run compliance:check

### Individual Checks
npm run compliance:double-entry
npm run compliance:audit-trail
npm run compliance:transaction-integrity
npm run compliance:data-protection
npm run compliance:kyc-aml
npm run compliance:reporting

## Compliance Status Dashboard

Access the compliance dashboard at: https://compliance.ubuntu-pay.co.za

## Notes

1. Regulatory Licensing: Not yet complete. This document focuses on technical compliance.
2. System Software: All technical standards are met or will be met by the end of BATCH 15.
3. Verification: All compliance checks must pass before production deployment.
4. Maintenance: Compliance status must be verified after each deployment.
5. Audit: External audit of compliance will be required before SARB licensing.

## Document Information

Version: 1.0 | Last Updated: 2026-08-21 | Next Review: 2026-11-21 | Owner: Compliance Team | Status: Technical compliance in progress (licensing pending)