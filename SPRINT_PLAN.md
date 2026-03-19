# Ahava eWallet Sprint Plan

## Goal
Deliver a working mobile payment experience with backend integration, resilience, and security, starting from the current working prototype.

---

## Sprint 1 (2 weeks) — Payment MVP + Security

### 1) End‑to‑end payment integration (3-4 points)
- [ ] ✅ Ensure local backend services are running (wallet-service, payment-service, api-gateway, postgres, redis)
- [ ] Implement/validate `/wallets/lookup` and confirm it returns `{ wallet: { id, walletNumber, holderName } }`
- [ ] Confirm mobile app can resolve a wallet number → wallet ID and call `/payments` with that ID
- [ ] Verify idempotency behavior: same `idempotencyKey` on retries, clearing after success or terminal failure

**Success criteria**: Payment call completes with a real backend transaction and app handles both success and retryable failure states.

---

### 2) Payment UI flow (4 points)
- [ ] Build payment entry screen (recipient wallet number + amount + memo)
- [ ] Build confirmation screen showing recipient name, fee, and total (client display only)
- [ ] Build success receipt screen (transaction ID, amount, recipient, time)
- [ ] Build failure screen with retry behavior depending on `isRetryable`

**Success criteria**: A user can complete a payment from start to finish in the app without needing to use debug tools.

---

### 3) Security hardening (3 points)
- [ ] Ensure lock screen triggers on app launch and after 5m background (biometric/PIN)
- [ ] Confirm certificate pinning works in dev (rejects invalid certs)
- [ ] Implement lockout after X incorrect PIN attempts + optional reset workflow

**Success criteria**: Sensitive screens cannot be accessed without unlocking, and app rejects invalid TLS certs.

---

### 4) Resilience + offline behavior (2 points)
- [ ] Validate retry strategy when network is offline / flaky
- [ ] Confirm cached idempotency key is reused across retries and cleared after completion

**Success criteria**: Network failures can be retried without creating duplicate backend payments.

---

### 5) Tests + CI (3 points)
- [ ] Add unit tests for `PaymentRepository` (idempotency + wallet lookup)
- [ ] Add bloc tests for `PaymentBloc` (success, retry, failure, cancel)
- [ ] Ensure `flutter analyze` and `flutter test` run in CI and pass

**Success criteria**: CI pipeline runs lint + tests and fails if regressions are introduced.

---

## Notes
- `apiBaseUrl` in `AppConfig` points to `http://localhost:6000` (API gateway). Ensure local gateway routes `/wallets/*` & `/payments/*` to the appropriate services.
- Offline caching uses Hive via `OfflineCache`.
- Idempotency key persistence is stored in `OfflineCache` under `payment.pending`.

---

## Suggestions for next sprint (post-MVP)
- Add transaction history screen + reconciliation (wallet transactions list)
- Add QR payment flow (scan and pay) with dynamic QR codes
- Add KYC flow (user document upload, tier upgrade)
- Add AML screening + STR filing integration
- Improve analytics/monitoring (Sentry + Datadog tracing)
