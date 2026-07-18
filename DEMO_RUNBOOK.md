# 🎬 Ubuntu Pay Investor Demo Runbook
*Script for live investor presentations*

---

## 📌 Pre-Demo Setup (5 minutes before)

```bash
# 1. Start all services
cd Ubuntu-QR-code-inventory-ahava-wallet
git checkout mv-build-week
npm install
npm run docker:up
npm run db:migrate
npx ts-node scripts/seed-demo-data.ts
npm run dev
```

### 2. Open these URLs in browser tabs:
- http://localhost:3000 (API Gateway health)
- http://localhost:3010 (PWA - Consumer)
- http://localhost:3011 (Agent Portal)

### 3. Prepare test credentials:
- **Consumer 1**: Phone: +27821111111, PIN: 1234, Wallet: UBUNTU-0001-0001-0001, Balance: R5,000
- **Consumer 2**: Phone: +27822222222, PIN: 1234, Wallet: UBUNTU-0002-0002-0002, Balance: R2,500
- **Merchant**: Phone: +27833333333, PIN: 1234, Wallet: UBUNTU-MERCH-001
- **Agent**: Phone: +27844444444, PIN: 1234, Wallet: UBUNTU-AGENT-001, Balance: R10,000

---

## 🎭 Demo Script

### Scene 1: Consumer Onboarding (2 min)
**Steps:**
1. Open PWA: http://localhost:3010
2. Register with phone: +27821111111, PIN: 1234
3. Show dashboard with R5,000 balance

### Scene 2: Merchant Setup (2 min)
**Steps:**
1. Register merchant: +27833333333, PIN: 1234
2. Generate QR code for R150 payment
3. Show merchant wallet: UBUNTU-MERCH-001

### Scene 3: Consumer Payment (3 min)
**Steps:**
1. Consumer scans merchant QR
2. Payment of R150 completes
3. Merchant sees confirmation, balance updates to R150

### Scene 4: Agent Cash-Out (3 min)
**Steps:**
1. Agent initiates cash-out for R500
2. Consumer confirms with PIN
3. Agent float debited, consumer wallet debited

### Scene 5: Inventory Management (3 min)
**Steps:**
1. Show pre-seeded products (Bread, Milk, Eggs, Oil, Sugar)
2. Add new product: Coke (330ml), R12.00
3. Scan product QR code
4. Adjust stock by +10 units

### Scene 6: Transaction History (2 min)
**Steps:**
1. Show consumer transaction history
2. Show merchant transaction history
3. Show full transaction details

### Scene 7: PayShap Vision (2 min)
**Explain:**
- PayShap = SARB real-time payment rail
- Instant clearing, low fees
- Interoperable with all SA banks
- Integration-ready, awaiting API access

---

## 🎯 Success Checklist
- [ ] Consumer registration works
- [ ] Wallet creation and balance display
- [ ] Merchant QR code generation
- [ ] Wallet-to-wallet payment completes
- [ ] Agent cash-out flow works
- [ ] Inventory management works
- [ ] Transaction history visible
- [ ] No errors or exceptions

---

## 💡 Troubleshooting

### Check services:
```bash
curl http://localhost:6000/health
curl http://localhost:6001/health
curl http://localhost:6002/health
curl http://localhost:6003/health
```

### Re-seed data:
```bash
npx ts-node scripts/seed-demo-data.ts
```
