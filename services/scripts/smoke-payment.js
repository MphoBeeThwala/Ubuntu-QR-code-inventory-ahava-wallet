#!/usr/bin/env node
// scripts/smoke-payment.js
// Smoke test for the Ahava backend payment flow (via API gateway).
// Usage:
//   SMOKE_SENDER_WALLET_NUMBER=AHV-0000-0001 \
//   SMOKE_RECEIVER_WALLET_NUMBER=AHV-0000-0002 \
//   node scripts/smoke-payment.js

const BASE_URL = process.env.SMOKE_API_BASE_URL || "http://localhost:6000";
const senderWalletNumber = process.env.SMOKE_SENDER_WALLET_NUMBER;
const receiverWalletNumber = process.env.SMOKE_RECEIVER_WALLET_NUMBER;
const amountCents = Number(process.env.SMOKE_AMOUNT_CENTS || "1000");
const idempotencyKey = process.env.SMOKE_IDEMPOTENCY_KEY || crypto.randomUUID();

if (!senderWalletNumber || !receiverWalletNumber) {
  console.error(
    "Missing required env vars. Set SMOKE_SENDER_WALLET_NUMBER and SMOKE_RECEIVER_WALLET_NUMBER."
  );
  process.exit(1);
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON from ${url}: ${text}`);
  }
  return { res, data };
}

async function lookupWallet(walletNumber) {
  const url = `${BASE_URL}/wallets/lookup?walletNumber=${encodeURIComponent(walletNumber)}`;
  const { res, data } = await fetchJson(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Lookup failed (${res.status}): ${JSON.stringify(data)}`);
  }
  if (!data?.data?.wallet?.id) {
    throw new Error(`Lookup response missing wallet.id: ${JSON.stringify(data)}`);
  }
  return data.data.wallet;
}

async function createPayment(senderId, receiverId) {
  const url = `${BASE_URL}/payments`;
  const body = {
    senderWalletId: senderId,
    receiverWalletId: receiverId,
    amountCents,
    description: "Smoke test payment",
    idempotencyKey,
    paymentMethod: "AHAVA_WALLET",
    deviceId: "smoke-test",
    ipAddress: "127.0.0.1",
  };

  const { res, data } = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return { res, data };
}

(async () => {
  console.log(`Using gateway base URL: ${BASE_URL}`);
  console.log("1) Checking gateway health...");
  try {
    const { res, data } = await fetchJson(`${BASE_URL}/health`);
    if (!res.ok) {
      throw new Error(`Health check failed (${res.status}): ${JSON.stringify(data)}`);
    }
    console.log("✔ Gateway is reachable and healthy.");
  } catch (err) {
    console.error("✖ Gateway health check failed:", err);
    process.exit(1);
  }

  console.log("\n2) Looking up sender wallet ID...");
  const sender = await lookupWallet(senderWalletNumber);
  console.log(`✔ Sender: ${sender.walletNumber} → ${sender.id}`);

  console.log("\n3) Looking up receiver wallet ID...");
  const receiver = await lookupWallet(receiverWalletNumber);
  console.log(`✔ Receiver: ${receiver.walletNumber} → ${receiver.id}`);

  console.log("\n4) Sending payment (idempotencyKey =", idempotencyKey, ")...");
  const { res, data } = await createPayment(sender.id, receiver.id);
  console.log(`→ HTTP ${res.status}`);
  console.log(JSON.stringify(data, null, 2));

  if (res.status === 201 || res.status === 200) {
    console.log("\n✔ Payment call succeeded.");
    console.log(`✔ To verify idempotency, re-run with the same SMOKE_IDEMPOTENCY_KEY to ensure the backend returns the same result or the duplicate-key response.`);
    process.exit(0);
  } else {
    console.error("✖ Payment call failed.");
    process.exit(1);
  }
})();
