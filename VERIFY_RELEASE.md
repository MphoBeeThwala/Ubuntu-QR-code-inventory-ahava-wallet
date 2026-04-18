# Release Verification

Run these checks before cutting an MVP release.

## Local (no Docker)

```bash
npm ci
npm run build
npm test
```

## Local integration (Docker required)

```bash
npm run integration:up
```

In a second terminal:

```bash
npm run dev
```

Then:

```bash
npm run integration:smoke
```

PowerShell example (optional):

```powershell
$env:SMOKE_LOGIN_PHONE = "+27799999999"
$env:SMOKE_LOGIN_PIN = "1234"
$env:SMOKE_SENDER_WALLET_NUMBER = "AHV-TUMI-3321-8894"
$env:SMOKE_RECEIVER_WALLET_NUMBER = "AHV-GWED-7734-2291"
npm run integration:smoke
```

Finally:

```bash
npm run integration:down
```

## Expected outcomes

- Build succeeds without errors
- Tests pass
- Smoke prints:
  - gateway health ok
  - login ok
  - sender/receiver wallet ids resolved
  - payment returns HTTP 201/200 with success envelope
