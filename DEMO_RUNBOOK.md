# Ahava MVP Demo Runbook (5–10 minutes)

## Goal

Show the core MVP flow end-to-end:

Register → Login → Wallet → Send Money → History

## Pre-reqs

- Node 20+, npm 10+
- Docker Desktop running (for Postgres + Redis)
- Two demo wallet numbers available (sender + receiver)

## One-command environment

1. Bring up integration dependencies, run migrations, seed demo data:

```bash
npm run integration:up
```

2. Start services (in separate terminal):

```bash
npm run dev
```

3. Run the gateway smoke payment (optional CLI validation):

```bash
SMOKE_SENDER_WALLET_NUMBER=AHV-TUMI-3321-8894 \
SMOKE_RECEIVER_WALLET_NUMBER=AHV-GWED-7734-2291 \
SMOKE_LOGIN_PHONE=+27799999999 \
SMOKE_LOGIN_PIN=1234 \
npm run integration:smoke
```

PowerShell equivalent:

```powershell
$env:SMOKE_SENDER_WALLET_NUMBER = "AHV-TUMI-3321-8894"
$env:SMOKE_RECEIVER_WALLET_NUMBER = "AHV-GWED-7734-2291"
$env:SMOKE_LOGIN_PHONE = "+27799999999"
$env:SMOKE_LOGIN_PIN = "1234"
npm run integration:smoke
```

4. Tear down:

```bash
npm run integration:down
```

## Demo script (recommended speaking order)

1. Health
2. Register
3. Login
4. Wallet dashboard
5. Send money
6. History

## Troubleshooting

- Docker error (cannot connect to docker engine):
  - Start Docker Desktop, then rerun `npm run integration:up`.
- Seed didn’t produce usable demo wallets:
  - Rerun `npm run db:seed` and confirm wallet numbers in the DB.
