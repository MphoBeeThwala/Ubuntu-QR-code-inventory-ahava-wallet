HIGH AVAILABILITY CONFIGURATION - Ubuntu Pay Platform

ARCHITECTURE
- Multi-Region: Africa (Johannesburg), Africa (Cape Town), Europe (Frankfurt)
- Active-Active: Database with streaming replication, Redis Cluster, multiple app replicas

DATABASE HIGH AVAILABILITY

PostgreSQL Configuration (postgresql.conf):
- wal_level = replica
- synchronous_commit = on
- synchronous_standby_names = 'standby1,standby2'
- max_wal_senders = 10
- max_replication_slots = 10
- wal_keep_size = 1GB
- hot_standby = on

Standby Configuration (recovery.conf):
- standby_mode = 'on'
- primary_conninfo = 'host=primary-db port=5432 user=replication'
- primary_slot_name = 'standby1'
- trigger_file = '/tmp/promote'

Connection Pooling (PgBouncer):
- pool_mode = transaction
- max_client_conn = 1000
- default_pool_size = 50
- min_pool_size = 10

Failover Procedures:
- Automatic: Patroni detects failure, promotes standby, updates DNS, total <30s
- Manual: touch /tmp/promote on standby, verify with patronictl list

REDIS HIGH AVAILABILITY

Redis Cluster Configuration:
- cluster-enabled yes
- cluster-config-file nodes.conf
- cluster-node-timeout 5000
- appendonly yes

Sentinel Configuration:
- sentinel monitor ubuntu-pay-redis redis-primary 6379 2
- sentinel down-after-milliseconds ubuntu-pay-redis 5000
- sentinel failover-timeout ubuntu-pay-redis 60000

Failover Testing:
- Simulate: redis-cli -h redis-primary SHUTDOWN
- Check: redis-cli -h sentinel1 SENTINEL masters
- Verify: redis-cli -h redis-new-primary PING

APPLICATION HIGH AVAILABILITY

Kubernetes Configuration:
- Replicas: 3 minimum
- Strategy: RollingUpdate with 25% maxSurge, 25% maxUnavailable
- Anti-affinity: Spread pods across nodes

Horizontal Pod Autoscaler:
- Min replicas: 3
- Max replicas: 20
- CPU target: 70%
- Memory target: 80%

Health Checks:
- Liveness: /live every 10s, 3 failures
- Readiness: /ready every 10s, 1 failure
- Financial: /financial-health every 60s, 1 failure

LOAD BALANCING
- Global: api.ubuntu-pay.co.za with health checks every 10s, failover on 3 failures
- Regional: lb-za, lb-na, lb-eu

DATA REPLICATION
- PostgreSQL: Primary -> Standby1 (sync), Primary -> Standby2 (sync), Standby1 -> Standby2 (async)
- Replication slots prevent WAL cleanup until acknowledged

Verification:
- Lag: psql -c "SELECT pg_current_wal_lsn() - replay_lsn FROM pg_stat_replication;"
- Status: psql -c "SELECT * FROM pg_stat_replication;"
- Slots: psql -c "SELECT * FROM pg_replication_slots;"

MONITORING AND ALERTING

High Availability Metrics:
- Replication lag: <1s (alert at 5s)
- Standby count: >=2 (alert at <2)
- Failover time: <30s (alert at >60s)
- Data consistency: 100% (alert on discrepancy)

Alerts:
- PostgreSQLReplicationLagHigh: Lag >5s for 1m
- PostgreSQLStandbyDown: Standby down for 1m
- RedisClusterDegraded: Cluster degraded state
- ApplicationReplicasLow: >1 replica not ready for 5m

FINANCIAL DATA PROTECTION
- All BIGINT values (amount_cents, balance_cents, fee_cents) protected through:
  1. Replication: All standbys receive identical BIGINT values
  2. Validation: Pre-commit validation of BIGINT values
  3. Verification: Post-recovery verification of all BIGINT columns
  4. Backup: All backups preserve BIGINT precision

Data Consistency Checks:
- Ledger balance: SUM(debit_amount_cents) - SUM(credit_amount_cents) = 0
- Wallet totals: SUM(balance_cents) matches across replicas

TESTING
- Monthly: Single node failure
- Quarterly: Data center failure
- Annually: Regional failure

Test Procedures:
- PostgreSQL: patronictl failover
- Redis: redis-cli -h redis-primary SHUTDOWN
- Application: kubectl delete pod <pod-name>
- Verification: npm run verify:ledger, npm run verify:wallets

MAINTENANCE
- Daily: Verify replication status
- Weekly: Test failover procedures
- Monthly: Review HA metrics
- Quarterly: Full failover test

Patch Management:
- PostgreSQL: Test on standbys first
- Redis: Rolling updates with sentinel
- Application: Blue-green deployments
- Infrastructure: Canary releases

Version: 1.0 | Last Updated: 2026-08-21 | Owner: Platform Engineering Team