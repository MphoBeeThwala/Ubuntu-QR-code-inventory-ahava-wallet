# Ahava eWallet — Scaling Runbook

**Owner:** Platform Engineering  
**Environment:** EKS (af-south-1) | Last reviewed: March 2026

---

## 1. Horizontal Pod Autoscaling (HPA)

All services ship with HPA manifests in `k8s/`. HPAs trigger on CPU ≥ 70% or memory ≥ 80%.

### Check current HPA status

```bash
kubectl get hpa -n ahava
kubectl describe hpa <service>-hpa -n ahava
```

### Manual override (temporary burst)

```bash
# Scale payment-service to 10 replicas immediately
kubectl scale deployment payment-service --replicas=10 -n ahava

# Revert — HPA will take over within ~2 minutes
kubectl scale deployment payment-service --replicas=3 -n ahava
```

---

## 2. EKS Node Group Scaling

### Check node utilisation

```bash
kubectl top nodes
kubectl describe node <node-name> | grep -A5 "Allocated resources"
```

### Scale node group via AWS CLI

```bash
# Get current node group config
aws eks describe-nodegroup \
  --cluster-name ahava-production \
  --nodegroup-name ahava-production-node-group \
  --region af-south-1 \
  --query "nodegroup.scalingConfig"

# Scale up (e.g., surge for Black Friday)
aws eks update-nodegroup-config \
  --cluster-name ahava-production \
  --nodegroup-name ahava-production-node-group \
  --region af-south-1 \
  --scaling-config minSize=3,maxSize=30,desiredSize=10

# Scale back down after event
aws eks update-nodegroup-config \
  --cluster-name ahava-production \
  --nodegroup-name ahava-production-node-group \
  --region af-south-1 \
  --scaling-config minSize=3,maxSize=20,desiredSize=3
```

### Monitor node group scaling activity

```bash
aws autoscaling describe-scaling-activities \
  --region af-south-1 \
  --query "Activities[?contains(AutoScalingGroupName, 'ahava')].[StartTime,StatusCode,Description]" \
  --output table
```

---

## 3. RDS Scaling

### Vertical scaling (change instance class)

**Warning:** Causes ~1-2 min downtime. Schedule during off-peak (02:00–04:00 SAST).

```bash
aws rds modify-db-instance \
  --db-instance-identifier ahava-production-postgres \
  --db-instance-class db.r6g.2xlarge \
  --apply-immediately \
  --region af-south-1

# Monitor the modification
aws rds describe-db-instances \
  --db-instance-identifier ahava-production-postgres \
  --query "DBInstances[0].[DBInstanceStatus,DBInstanceClass,PendingModifiedValues]" \
  --output table
```

### Read replica (for reporting queries)

```bash
aws rds create-db-instance-read-replica \
  --db-instance-identifier ahava-production-postgres-replica \
  --source-db-instance-identifier ahava-production-postgres \
  --db-instance-class db.t3.medium \
  --region af-south-1
```

---

## 4. ElastiCache Redis Scaling

### Scale Redis node type

```bash
aws elasticache modify-replication-group \
  --replication-group-id ahava-production-redis \
  --cache-node-type cache.r6g.large \
  --apply-immediately \
  --region af-south-1
```

---

## 5. Capacity Planning

| Service              | Baseline Pods | Burst Target | Notes                      |
| -------------------- | ------------- | ------------ | -------------------------- |
| api-gateway          | 3             | 15           | Main ingress — scale first |
| payment-service      | 3             | 10           | 95% coverage mandate       |
| auth-service         | 2             | 8            | PIN attempts rate-limited  |
| wallet-service       | 2             | 8            | SELECT FOR UPDATE locking  |
| kyc-service          | 2             | 4            | S3 upload bound            |
| aml-service          | 2             | 6            | BullMQ worker              |
| notification-service | 2             | 4            | Fire-and-forget            |
| reporting-service    | 1             | 3            | Batch jobs only            |

**Alert thresholds that indicate scaling is needed:**

- API Gateway P99 latency > 500ms
- Payment service error rate > 0.5%
- RDS CPU > 70% sustained for 5 min
- Redis memory > 70%
