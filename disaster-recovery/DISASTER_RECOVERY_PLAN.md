DISASTER RECOVERY PLAN - Ubuntu Pay Platform

1. Introduction
This Disaster Recovery Plan outlines procedures for recovering the Ubuntu Pay Platform. All monetary values are BIGINT cents.

2. Recovery Objectives
- RTO: 2 hours
- RPO: 5 minutes
- MTD: 4 hours
- Data Loss Tolerance: 0 (for financial data)

3. Backup Strategy
- Full Backups: Daily at 2 AM
- Incremental Backups: Hourly
- WAL Archiving: Continuous
- Retention: 30 days on disk, 90 days in cloud
- Encryption: AES-256

4. Recovery Procedures

4.1 Database Recovery
- Point-in-Time Recovery (PITR): Restore from full backup + apply WAL logs
- Full Restore: Restore from full backup, verify BIGINT integrity

4.2 Application Recovery
- Deploy latest version from Git
- Restore configuration files
- Start services in dependency order
- Verify financial data integrity

5. Financial Data Integrity
- SUM(ledger_entries.debit_amount_cents) must equal SUM(ledger_entries.credit_amount_cents)
- All wallet balances must match ledger totals
- No duplicate transactions
- All transaction references must be unique

6. Verification Commands
- Ledger: npm run verify:ledger
- Wallets: npm run verify:wallets
- Transactions: npm run verify:transactions

7. Testing Schedule
- Full DR Test: Quarterly
- Partial DR Test: Monthly
- Backup Verification: Daily
- Restore Test: Weekly

8. Contact Information
- Primary: +27 XXX XXX XXXX
- Secondary: +27 XXX XXX XXXX
- Escalation: +27 XXX XXX XXXX
