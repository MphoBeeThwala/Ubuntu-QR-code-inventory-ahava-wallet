#!/usr/bin/env node
// scripts/smoke-payment.js
// Smoke test for the Ahava backend payment flow (via API gateway).
// Usage:
//   SMOKE_SENDER_WALLET_NUMBER=AHV-TUMI-3321-8894 \
//   SMOKE_RECEIVER_WALLET_NUMBER=AHV-GWED-7734-2291 \
//   node scripts/smoke-payment.js

const crypto = require("crypto");
const axios = require("axios");

function getBaseUrl() {
  const raw = process.env.SMOKE_API_BASE_URL;
  const fallback = "http://localhost:6000";
  const trimmed = (raw && raw.length ? raw : fallback).trim();
  const normalised = trimmed.replace(/\/+$/, "");
  new URL(normalised);
  return normalised;
}

const BASE_URL = getBaseUrl();
const senderWalletNumber =
  process.env.SMOKE_SENDER_WALLET_NUMBER || "AHV-TUMI-3321-8894";
const receiverWalletNumber =
  process.env.SMOKE_RECEIVER_WALLET_NUMBER || "AHV-GWED-7734-2291";
const loginPhoneNumber = process.env.SMOKE_LOGIN_PHONE || "+27799999999";
const loginPin = process.env.SMOKE_LOGIN_PIN || "1234";
const deviceId = process.env.SMOKE_DEVICE_ID || "smoke-test";
const amountCents = Number(process.env.SMOKE_AMOUNT_CENTS || "1000");
const idempotencyKey = process.env.SMOKE_IDEMPOTENCY_KEY || crypto.randomUUID();

async function fetchJson(url, opts = {}) {
  const method = opts.method || "GET";
  const headers = opts.headers || {};
  let data;
  if (opts.body !== undefined) {
    try {
      data = typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body;
    } catch {
      data = opts.body;
    }
  }
  const response = await axios({
    url,
    method,
    headers,
    data,
    timeout: 15000,
    validateStatus: () => true,
  });
  const res = {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
  };
  const parsed =
    typeof response.data === "string"
      ? (() => {
          try {
            return JSON.parse(response.data);
          } catch {
            throw new Error(`Invalid JSON from ${url}: ${response.data}`);
          }
        })()
      : response.data;
  return { res, data: parsed };
}

async function login() {
  const url = new URL("/auth/login", BASE_URL).toString();
  const body = {
    phoneNumber: loginPhoneNumber,
    pin: loginPin,
    deviceId,
    deviceName: "smoke-test",
    userAgent: "smoke-test",
    ipAddress: "127.0.0.1",
  };

  const { res, data } = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Id": deviceId },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(data)}`);
  }
  const accessToken = data?.data?.accessToken;
  if (!accessToken) {
    throw new Error(
      `Login response missing data.accessToken: ${JSON.stringify(data)}`,
    );
  }
  return accessToken;
}

async function lookupWallet(walletNumber) {
  const url = new URL(
    `/wallets/lookup?walletNumber=${encodeURIComponent(walletNumber)}`,
    BASE_URL,
  ).toString();
  const { res, data } = await fetchJson(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${globalThis.__SMOKE_TOKEN}`,
      "X-Device-Id": deviceId,
    },
  });
  if (!res.ok) {
    throw new Error(`Lookup failed (${res.status}): ${JSON.stringify(data)}`);
  }
  if (!data?.data?.wallet?.id) {
    throw new Error(`Lookup response missing wallet.id: ${JSON.stringify(data)}`);
  }
  return data.data.wallet;
}

async function createPayment(senderId, receiverId) {
  const url = new URL("/payments", BASE_URL).toString();
  const body = {
    senderWalletId: senderId,
    receiverWalletId: receiverId,
    amountCents,
    description: "Smoke test payment",
    idempotencyKey,
    paymentMethod: "UBUNTUPAY_WALLET",
    deviceId,
    ipAddress: "127.0.0.1",
  };

  const { res, data } = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${globalThis.__SMOKE_TOKEN}`,
      "X-Device-Id": deviceId,
    },
    body: JSON.stringify(body),
  });

  return { res, data };
}

(async () => {
  console.log(`Using gateway base URL: ${BASE_URL}`);
  console.log("1) Checking gateway health...");
  try {
    const { res, data } = await fetchJson(new URL("/health", BASE_URL).toString());
    if (!res.ok) {
      throw new Error(`Health check failed (${res.status}): ${JSON.stringify(data)}`);
    }
    console.log("✔ Gateway is reachable and healthy.");
  } catch (err) {
    console.error("✖ Gateway health check failed:", err);
    process.exit(1);
  }

  console.log("\n2) Logging in to get access token...");
  try {
    globalThis.__SMOKE_TOKEN = await login();
    console.log("✔ Logged in.");
  } catch (err) {
    console.error("✖ Login failed:", err);
    process.exit(1);
  }

  console.log("\n3) Looking up sender wallet ID...");
  const sender = await lookupWallet(senderWalletNumber);
  console.log(`✔ Sender: ${sender.walletNumber} → ${sender.id}`);

  console.log("\n4) Looking up receiver wallet ID...");
  const receiver = await lookupWallet(receiverWalletNumber);
  console.log(`✔ Receiver: ${receiver.walletNumber} → ${receiver.id}`);

  console.log("\n5) Sending payment (idempotencyKey =", idempotencyKey, ")...");
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
