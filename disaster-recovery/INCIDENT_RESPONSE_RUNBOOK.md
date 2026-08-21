INCIDENT RESPONSE RUNBOOK - Ubuntu Pay Platform

QUICK REFERENCE

Emergency Contacts:
- On-Call Engineer: +27 XXX XXX XXXX
- Backup On-Call: +27 XXX XXX XXXX
- DevOps Lead: +27 XXX XXX XXXX
- CTO: +27 XXX XXX XXXX

Critical Systems:
- Database: postgres.ubuntu-pay.co.za
- Redis: redis.ubuntu-pay.co.za
- API Gateway: api.ubuntu-pay.co.za
- Monitoring: grafana.ubuntu-pay.co.za

Quick Commands:
- Check database: pg_isready -h postgres -p 5432
- Check Redis: redis-cli ping
- Check API: curl https://api.ubuntu-pay.co.za/health
- View logs: kubectl logs -n ubuntu-pay <pod-name>
- Restart: kubectl rollout restart deployment/<name> -n ubuntu-pay

INCIDENT RESPONSE PROCEDURES

1. Initial Response
1.1 Identify: Symptoms, severity (Level 1-3), scope, impact
1.2 Activate: Level 1 = On-call, Level 2 = On-call + backup, Level 3 = Full team
1.3 Assess: Check monitoring, review alerts, check system logs, verify financial integrity

2. Containment
2.1 Immediate Actions: Stop the bleeding, isolate systems, prevent data loss, maintain audit trail
2.2 Communication: Notify stakeholders, update status page, begin documentation

3. Diagnosis

Common Issues:
- Database: Connection pool exhausted, slow queries, lock contention, disk full
- Application: Memory leaks, CPU spikes, crashes, dependency failures
- Infrastructure: Network latency, DNS, certificates, hardware
- Financial: Ledger imbalance, duplicates, incorrect fees, missing transactions

Diagnostic Commands:

Database:
- Active connections: psql -c "SELECT count(*) FROM pg_stat_activity;"
- Long queries: psql -c "SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10;"
- Table sizes: psql -c "SELECT table_name, pg_size_pretty(pg_total_relation_size(table_name)) FROM information_schema.tables WHERE table_schema = 'public' ORDER BY pg_total_relation_size(table_name) DESC;"

Redis:
- Memory: redis-cli info memory
- Clients: redis-cli info clients
- Keyspace: redis-cli info keyspace

Application:
- CPU/Memory: kubectl top pods -n ubuntu-pay
- Logs: kubectl logs -n ubuntu-pay <pod-name> --tail=100
- Resources: kubectl describe pod -n ubuntu-pay <pod-name>

4. Resolution

Database Recovery:
- Connection pool exhausted: Kill idle connections >1 hour
- Slow queries: Identify with pg_stat_statements, add indexes
- Lock contention: Identify blocking locks, resolve appropriately

Application Recovery:
- Memory leak: Restart service, scale up
- Service crash: Check logs, restart with debug mode

Financial Recovery:
- Ledger imbalance: Run npm run verify:ledger, create correcting entries (NEVER delete)
- Duplicate transaction: Mark as duplicate, create reversing transaction
- Incorrect fees: Calculate correct fee, create adjusting transaction

5. Verification
5.1 System: All services running, health checks pass, monitoring green, alerts resolved
5.2 Financial: Ledger balanced, all wallet balances positive, no duplicates, all fees correct, audit logs complete
5.3 User: Sample transactions verified, balance inquiries work, payments process, reports accurate

6. Financial Incident Response

6.1 Ledger Imbalance:
- Identify: Run verification scripts
- Isolate: Determine time range
- Analyze: Check for duplicates, missing, or incorrect transactions
- Correct: Create correcting entries (never delete)
- Verify: Re-run verification
- Document: Record all actions

6.2 Duplicate Transaction:
- Identify: Find duplicate reference IDs
- Isolate: Determine which is duplicate
- Mark: Mark duplicate (do not delete)
- Reverse: Create reversing transaction if needed
- Verify: Confirm ledger is balanced
- Notify: Inform affected users

7. Escalation
7.1 When: Not resolved in 30 min, financial corruption, multiple systems, customer data at risk, legal implications
7.2 Path: On-Call (0-30min) -> Backup (30-60min) -> DevOps Lead (60-120min) -> CTO (120+min) -> Executive

8. Post-Incident
8.1 Immediate: Verify stability, confirm financial integrity, update docs, conduct retrospective
8.2 Within 24h: Complete post-mortem, identify root cause, document lessons, create action items
8.3 Within 1w: Implement preventative measures, update runbooks, conduct training, review monitoring

9. Tools
- Monitoring: Grafana, Prometheus, Alertmanager
- Logging: ELK Stack, /var/log/ubuntu-pay/, /var/log/postgresql/
- Infrastructure: Kubernetes Dashboard, Rancher, Cloud Provider Console
- Verification: npm run verify:ledger, npm run verify:wallets, npm run verify:transactions

Version: 1.0 | Last Updated: 2026-08-21 | Owner: Platform Engineering Team