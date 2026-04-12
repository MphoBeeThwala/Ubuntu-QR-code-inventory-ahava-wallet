# Integration Profile

Real integration stack (no mocked downstream fetch) for:
- `api-gateway`
- `auth-service`
- `wallet-service`
- `payment-service`
- Postgres (TimescaleDB)
- Redis

## Start

```bash
npm run integration:up
```

Gateway is available at `http://localhost:3000`.

## Stop

```bash
npm run integration:down
```

## Tail logs

```bash
npm run integration:logs
```

## Run full smoke flow (real services)

```bash
npm run integration:smoke
```

## Seeded integration users

The stack seeds deterministic users on startup:
- Sender: `+27710000001` / PIN `1234` / device `integration-device-1`
- Receiver: `+27710000002` / PIN `1234` / device `integration-device-2`

## Quick flow checks via gateway

Register:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"+27710000003\",\"pin\":\"1234\",\"deviceId\":\"integration-device-3\"}"
```

Login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"+27710000001\",\"pin\":\"1234\",\"deviceId\":\"integration-device-1\"}"
```

Wallet balance:

```bash
curl http://localhost:3000/wallets/user/<USER_ID>/balance
```

Send money:

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d "{\"senderWalletId\":\"<SENDER_WALLET_ID>\",\"receiverWalletId\":\"<RECEIVER_WALLET_ID>\",\"amountCents\":5000,\"idempotencyKey\":\"integration-demo-1\"}"
```
