DATA RECOVERY PROCEDURES - Ubuntu Pay Platform

All monetary values are BIGINT cents and must be preserved with exact precision.

1. ACCIDENTAL DATA DELETION

1.1 Single Record Deletion
- Identification: Check audit logs, transaction logs
- Recovery: Extract from backup using pg_restore -t <table> -a <backup>.dump
- Verification: Confirm record restored, no duplicates, referential integrity maintained

1.2 Bulk Data Deletion
- Immediate: Stop writes, take snapshot, identify scope, notify stakeholders
- Recovery: Restore from full backup, apply WAL logs to point before deletion
- Verification: All records restored, no duplicates, financial data correct

2. DATA CORRUPTION

2.1 Detecting Corruption
- Database: pg_checksums -v -D /var/lib/postgresql/15/main
- Financial: Check ledger balance, wallet balances, invalid BIGINT values

2.2 Recovering from Corruption
- From replica: Promote standby, verify data
- From backup: Restore from last known good backup
- Manual: Create correcting entries (NEVER delete)

3. HARDWARE FAILURE

3.1 Disk Failure (Primary Database)
- Failover to standby (automatic with Patroni)
- Replace failed disk
- Rebuild primary from standby
- Rejoin primary to cluster

3.2 Server Failure
- Database: Automatic failover, provision new server, restore/replicate
- Application: Kubernetes reschedules, provision new node if needed

4. RANSOMWARE ATTACK

4.1 Immediate Actions
- Isolate affected systems
- Stop all database connections
- Take all systems offline if needed
- Preserve evidence
- Notify security team

4.2 Recovery
- From offline backups: Identify clean backup, restore to clean environment
- Verification: All tables have expected counts, constraints satisfied, BIGINT columns valid, ledger balanced

5. HUMAN ERROR

5.1 Incorrect Data Update
- Identification: Check audit logs, compare with backup
- Recovery: Restore specific records or manually correct

5.2 Schema Migration Error
- Rollback: npm run migrate:down or restore from schema backup
- Verification: Schema matches expectations, all BIGINT columns present

6. FINANCIAL DATA RECOVERY

6.1 Ledger Imbalance
- Detection: SELECT SUM(debit_amount_cents) - SUM(credit_amount_cents) FROM ledger_entries
- Correction: Create correcting entry (NEVER delete), verify with npm run verify:ledger

6.2 Missing Transactions
- Identification: Check for gaps in IDs, missing references
- Recovery: Restore from backup or manually recreate

6.3 Duplicate Transactions
- Identification: Find duplicate reference IDs
- Resolution: Mark as duplicate, create reversing transaction, verify ledger balanced

7. VERIFICATION PROCEDURES

7.1 Post-Recovery Verification
- Database: Check table counts, constraints
- Financial: Run npm run verify:all
- Application: Health checks, sample API calls

7.2 Automated Verification
- Ledger: SUM(debits) = SUM(credits)
- Wallets: Each wallet balance matches ledger total
- Transactions: No duplicates, all references unique

8. BACKUP AND RESTORE PROCEDURES

8.1 Backup Verification
- Daily: Check backup files exist, check size
- Weekly: Restore to test environment, run verification scripts

8.2 Restore Procedures
- Full Restore: Stop services, restore database, start services, verify
- Point-in-Time: Create recovery.conf, start PostgreSQL, verify timestamp

Version: 1.0 | Last Updated: 2026-08-21 | Owner: Platform Engineering Team