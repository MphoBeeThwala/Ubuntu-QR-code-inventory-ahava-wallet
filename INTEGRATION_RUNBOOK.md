# Integration Runbook

This is the canonical way to bring up the local integration stack and run a gateway smoke payment.

## Prerequisites

- Node 20+, npm 10+
- Docker Desktop running

## Commands

### 1) Bring up dependencies + migrate + seed

```bash
npm run integration:up
```

### 2) Start services

```bash
npm run dev
```

### 3) Run a smoke payment through the API gateway

```bash
SMOKE_LOGIN_PHONE=+27799999999 \
SMOKE_LOGIN_PIN=1234 \
SMOKE_SENDER_WALLET_NUMBER=AHV-TUMI-3321-8894 \
SMOKE_RECEIVER_WALLET_NUMBER=AHV-GWED-7734-2291 \
npm run integration:smoke
```

PowerShell equivalent:

```powershell
$env:SMOKE_LOGIN_PHONE = "+27799999999"
$env:SMOKE_LOGIN_PIN = "1234"
$env:SMOKE_SENDER_WALLET_NUMBER = "AHV-TUMI-3321-8894"
$env:SMOKE_RECEIVER_WALLET_NUMBER = "AHV-GWED-7734-2291"
npm run integration:smoke
```

Optional overrides:

- `SMOKE_API_BASE_URL` (default: `http://localhost:6000`)
- `SMOKE_AMOUNT_CENTS` (default: `1000`)
- `SMOKE_IDEMPOTENCY_KEY` (default: random UUID)
- `SMOKE_DEVICE_ID` (default: `smoke-test`)

### 4) Tear down

```bash
npm run integration:down
```

## What it validates

- API gateway reachable and responding on `/health`
- Auth login works and returns an access token
- Protected routes accept `Bearer` token
- Wallet lookup works via `/wallets/lookup`
- Payment call works via `/payments` with idempotency key
