# Ahava eWallet — Incident Response Runbook

**Owner:** On-call Engineering  
**Pager:** Datadog monitors → PagerDuty → Slack `#engineering-incidents`  
**Severity Levels:** P1 (payment down) | P2 (degraded) | P3 (non-critical)

---

## Severity Matrix

| Severity | Condition                                                    | Response Time       | Example                                             |
| -------- | ------------------------------------------------------------ | ------------------- | --------------------------------------------------- |
| **P1**   | Payment service unavailable, data loss risk, security breach | Immediate (< 5 min) | Payment 500s, DB unreachable, JWT key leaked        |
| **P2**   | Elevated errors (> 1%), AML queue stuck, KYC failures        | 15 min              | Redis down, >50 failed logins/min, EKS node failure |
| **P3**   | Non-critical service degraded, monitoring gaps               | 1 hour              | Reporting slow, notification delays                 |

---

## 1. Payment Service Down (P1)

```bash
# 1. Check pod status
kubectl get pods -n ahava -l app=payment-service
kubectl describe pod <pod> -n ahava
kubectl logs <pod> -n ahava --tail=100

# 2. Check RDS connectivity from pod
kubectl exec -it <pod> -n ahava -- \
  node -e "const p=require('@prisma/client'); new p.PrismaClient().\$connect().then(()=>console.log('DB OK')).catch(console.error)"

# 3. Check Redis connectivity
kubectl exec -it <pod> -n ahava -- \
  node -e "const r=require('ioredis'); new r(process.env.REDIS_URL).ping().then(console.log)"

# 4. Check recent error logs
kubectl logs -l app=payment-service -n ahava --tail=200 | grep '"level":"error"'

# 5. If pods are CrashLooping, check for config issues
kubectl get secret ahava-secrets -n ahava -o jsonpath='{.data}' | \
  jq 'keys'  # Verify all required keys exist

# 6. Emergency rollback to previous image
kubectl rollout undo deployment/payment-service -n ahava-prod
kubectl rollout status deployment/payment-service -n ahava-prod --timeout=120s
```

**Escalation:** If unresolved in 15 min → Page CTO + notify SARB if payment downtime > 30 min.

---

## 2. AML Queue Stuck (P2)

```bash
# Check BullMQ queue depth via Redis CLI
kubectl exec -it <redis-pod> -n ahava -- redis-cli \
  -a $REDIS_PASSWORD \
  llen "bull:ahava:payments-created:wait"

# Check for stalled jobs
kubectl exec -it <redis-pod> -n ahava -- redis-cli \
  -a $REDIS_PASSWORD \
  lrange "bull:ahava:payments-created:stalled" 0 -1

# Restart AML service worker to re-process stalled jobs
kubectl rollout restart deployment/aml-service -n ahava

# Monitor queue draining
watch -n5 'kubectl exec -it <redis-pod> -n ahava -- redis-cli -a $REDIS_PASSWORD llen "bull:ahava:payments-created:wait"'
```

---

## 3. Elevated Failed PIN Attempts (P2 — Possible Brute Force)

CloudWatch alarm `ahava-production-auth-failure-spike` triggers at > 50 failures/min.

```bash
# Identify source IPs from logs
kubectl logs -l app=auth-service -n ahava --tail=500 | \
  grep '"level":"warn"' | \
  jq -r '.ipAddress' | sort | uniq -c | sort -rn | head -20

# Block source IP at WAF level
aws wafv2 get-web-acl \
  --name ahava-production-api-waf \
  --scope REGIONAL \
  --region af-south-1

# Add IP block rule via AWS Console or CLI
# Document the IP, time, and action in #security-incidents channel
```

---

## 4. KYC Document Upload Failure (P2)

```bash
# Check S3 bucket accessibility
aws s3 ls s3://ahava-production-kyc-documents/ --region af-south-1

# Verify IRSA permissions on KYC pod
kubectl exec -it <kyc-pod> -n ahava -- \
  aws sts get-caller-identity

# Check KYC service logs
kubectl logs -l app=kyc-service -n ahava --tail=100 | grep '"level":"error"'

# Verify KMS key for S3 encryption is active
aws kms describe-key \
  --key-id alias/ahava-production-data \
  --region af-south-1 \
  --query "KeyMetadata.[KeyState,Enabled]"
```

---

## 5. JWT Signing Key Rotation (Security Incident)

If `JWT_PRIVATE_KEY` is suspected compromised:

```bash
# 1. Generate new RS256 keypair
openssl genrsa -out new-private.pem 4096
openssl rsa -in new-private.pem -pubout -out new-public.pem

# 2. Stage new key in Secrets Manager (keep old key for transition period)
aws secretsmanager put-secret-value \
  --secret-id /ahava/production/jwt-private-key \
  --secret-string "$(cat new-private.pem)" \
  --region af-south-1

aws secretsmanager put-secret-value \
  --secret-id /ahava/production/jwt-public-key \
  --secret-string "$(cat new-public.pem)" \
  --region af-south-1

# 3. Force ESO to sync new secret to k8s
kubectl annotate externalsecret ahava-secrets \
  force-sync=$(date +%s) -n ahava

# 4. Restart all services to pick up new key
for SVC in api-gateway auth-service wallet-service payment-service kyc-service; do
  kubectl rollout restart deployment/$SVC -n ahava
done

# 5. All existing JWTs are now invalid — users must re-authenticate
# Notify via push notifications / status page
```

**Note:** All active sessions are invalidated. Coordinate with product team before executing.

---

## 6. Critical AML Flag — MLRO Workflow

When `POST /aml/flag` severity=CRITICAL auto-suspends a wallet:

1. AML service logs `[aml-service] MLRO notified for user <userId>`
2. Check suspended wallet:
   ```bash
   # Via reporting service
   curl -H "Authorization: Bearer $TOKEN" \
     https://api.ahava.co.za/aml/flags?severity=CRITICAL | jq
   ```
3. MLRO reviews via admin portal (or direct DB query):
   ```sql
   SELECT u.phone_number, u.id_number_hash, af.flag_type, af.risk_score,
          af.created_at, w.status
   FROM "AmlFlag" af
   JOIN "Wallet" w ON w.user_id = af.user_id
   JOIN "User" u ON u.id = af.user_id
   WHERE af.severity = 'CRITICAL' AND af.status = 'OPEN'
   ORDER BY af.created_at DESC;
   ```
4. If STR (Suspicious Transaction Report) required:
   ```bash
   curl -X POST https://api.ahava.co.za/aml/str-file \
     -H "Authorization: Bearer $MLRO_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"flagId": "<flag-id>", "reason": "Suspicious transfer pattern"}'
   ```
5. File STR with SARB/FIC within 15 business days (FICA obligation)

---

## 7. On-Call Handover Checklist

- [ ] Datadog dashboards reviewed (no anomalous metrics)
- [ ] All services: `kubectl get pods -n ahava` — all Running
- [ ] Payment smoke test passing: `npm run smoke:payment`
- [ ] Open AML flags reviewed: `GET /aml/flags`
- [ ] CloudWatch alarms: all OK
- [ ] Redis queue depth: < 100 pending jobs
- [ ] No open P1/P2 incidents in `#engineering-incidents`
