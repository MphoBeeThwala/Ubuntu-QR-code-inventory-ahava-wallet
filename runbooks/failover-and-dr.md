# Ahava eWallet — Failover & Disaster Recovery Runbook

**Owner:** Platform Engineering  
**RTO Target:** 30 minutes | **RPO Target:** 5 minutes  
**Environment:** EKS + RDS Multi-AZ + ElastiCache (af-south-1)

---

## 1. RDS Automatic Failover (Multi-AZ)

Production RDS is Multi-AZ. AWS promotes the standby automatically within ~60-120s on primary failure. No manual action required.

### Verify failover completed

```bash
aws rds describe-events \
  --source-identifier ahava-production-postgres \
  --source-type db-instance \
  --duration 60 \
  --region af-south-1 \
  --query "Events[?contains(Message,'failover')]"

# Check new primary endpoint
aws rds describe-db-instances \
  --db-instance-identifier ahava-production-postgres \
  --query "DBInstances[0].[DBInstanceStatus,Endpoint.Address,MultiAZ,SecondaryAvailabilityZone]" \
  --output table
```

### Force manual failover (for scheduled maintenance)

```bash
aws rds reboot-db-instance \
  --db-instance-identifier ahava-production-postgres \
  --force-failover \
  --region af-south-1
```

---

## 2. EKS Node Failure

Kubernetes automatically reschedules pods from failed nodes. Monitor recovery:

```bash
# Watch pod rescheduling
kubectl get pods -n ahava -w

# Check node status
kubectl get nodes -o wide

# Force evict stuck pods from failed node
kubectl drain <failed-node-name> \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --force

# Remove failed node from cluster
kubectl delete node <failed-node-name>
```

---

## 3. Full AZ Failure

EKS nodes and RDS standby span 3 AZs (af-south-1a, 1b, 1c). If one AZ fails:

1. RDS auto-promotes standby in a healthy AZ (automatic)
2. EKS ASG replaces nodes in remaining AZs (automatic, ~5 min)
3. Verify pod distribution:
   ```bash
   kubectl get pods -n ahava -o wide | awk '{print $7}' | sort | uniq -c
   ```
4. If ASG is slow, manually set desired capacity on remaining AZs:
   ```bash
   aws autoscaling set-desired-capacity \
     --auto-scaling-group-name <asg-name> \
     --desired-capacity 6 \
     --region af-south-1
   ```

---

## 4. Redis Failure

If Redis becomes unavailable:

- BullMQ jobs will fail to enqueue (payment events, notifications)
- Services log `[service] Failed to enqueue event: Redis unavailable`
- Payment service still returns 201 (fire-and-forget queue design)

### Recovery steps

1. Check ElastiCache status:
   ```bash
   aws elasticache describe-replication-groups \
     --replication-group-id ahava-production-redis \
     --query "ReplicationGroups[0].[Status,AutomaticFailover,MemberClusters]" \
     --region af-south-1
   ```
2. If primary failed, ElastiCache auto-promotes replica (~30s)
3. If cluster is corrupt, restore from snapshot:
   ```bash
   aws elasticache restore-replication-group-from-s3 \
     --replication-group-id ahava-production-redis-restore \
     --replication-group-description "Restored from snapshot" \
     --snapshot-name <snapshot-name> \
     --region af-south-1
   ```

---

## 5. Full Region Failure

Ahava operates in af-south-1 only (POPIA data residency). In a full region outage:

1. **Activate status page** — update `status.ahava.co.za` with maintenance message
2. **Notify SARB** — major PSP outage must be reported within 2 hours (regulatory obligation)
3. **Activate cold standby** (if provisioned in eu-west-1 for DR):
   ```bash
   terraform workspace select dr
   terraform apply -var="environment=production" \
     -var="activate_dr=true" \
     -target=module.eks
   ```
4. Restore RDS from latest automated snapshot to DR region
5. Update Route53 health checks to point to DR endpoint

**RTO in full region failure: 2-4 hours (manual)**

---

## 6. Database Point-in-Time Recovery

RDS backups: automated daily + 5-year retention (FICA requirement).

```bash
# List available restore points
aws rds describe-db-instance-automated-backups \
  --db-instance-identifier ahava-production-postgres \
  --region af-south-1 \
  --query "DBInstanceAutomatedBackups[0].[RestoreWindow]"

# Restore to specific time (creates new instance)
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier ahava-production-postgres \
  --target-db-instance-identifier ahava-production-postgres-restored \
  --restore-time 2026-03-22T02:00:00Z \
  --db-instance-class db.r6g.xlarge \
  --multi-az \
  --region af-south-1

# After validation, update DATABASE_URL secret in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id /ahava/production/rds-master-password \
  --secret-string '{"connection_url":"postgresql://ahava_admin:PASS@new-endpoint:5432/ahava?sslmode=require"}' \
  --region af-south-1

# Trigger ESO refresh (External Secrets Operator syncs k8s secret)
kubectl annotate externalsecret ahava-secrets \
  force-sync=$(date +%s) -n ahava
```

---

## 7. Post-Incident Checklist

- [ ] All services returning `200 /health`
- [ ] Payment service processing transactions (smoke test passing)
- [ ] RDS replication lag < 1s (if Multi-AZ)
- [ ] Redis connected (`redis-cli ping`)
- [ ] CloudWatch alarms in OK state
- [ ] AML queue draining (no stuck jobs)
- [ ] Incident timeline documented in `#engineering-incidents` Slack
- [ ] Post-mortem scheduled within 48 hours
- [ ] SARB notification filed if downtime > 30 min (regulatory requirement)
