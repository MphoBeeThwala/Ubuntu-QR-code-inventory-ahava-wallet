#!/usr/bin/env node
// scripts/load-test.js
// Load test for the Ubuntu Pay / Ahava backend (via API gateway).
//
// Exercises real endpoints through api-gateway with real JWTs obtained via
// a real login/register flow (no forged tokens, no bypassing auth) — a
// weighted mix of read-heavy scenarios (balance, transaction history, QR
// lookup) that dominate real usage, plus a smaller share of actual
// peer-to-peer payments through the funded seed accounts.
//
// Prerequisites (none of this happens automatically — run these first):
//   1. docker-compose up -d postgres redis
//   2. node scripts/integration-up.js       (migrates + seeds the DB —
//      creates the funded accounts this script logs in as)
//   3. Start every backend service the scenarios below touch: api-gateway,
//      auth-service, wallet-service, payment-service (+ aml-service if
//      SANCTIONS_SCREENING_ENABLED=true, which requires a ComplyAdvantage
//      key or degrades to always-CLEAR — see .env.example).
//
// Usage:
//   node scripts/load-test.js
//   LOAD_TEST_VUS=50 LOAD_TEST_DURATION_SECONDS=120 node scripts/load-test.js
//
// Config (all optional, sensible defaults below):
//   LOAD_TEST_BASE_URL             default http://localhost:6000
//   LOAD_TEST_VUS                  default 10   (virtual users)
//   LOAD_TEST_DURATION_SECONDS     default 30   (steady-state duration, excludes ramp-up)
//   LOAD_TEST_RAMP_UP_SECONDS      default 5    (VUs start staggered across this window)
//   LOAD_TEST_THINK_TIME_MS        default 200  (pause between a VU's requests; 0 = max throughput)
//   LOAD_TEST_REQUEST_TIMEOUT_MS   default 10000
//   LOAD_TEST_P95_THRESHOLD_MS     default 1000 (pass/fail gate, per scenario)
//   LOAD_TEST_ERROR_RATE_THRESHOLD default 0.01 (1% — pass/fail gate, per scenario)
//   LOAD_TEST_FUNDED_PHONE_1/2/3   override the funded seed accounts used for payments

const crypto = require("crypto");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────

function getBaseUrl() {
  const raw = process.env.LOAD_TEST_BASE_URL || "http://localhost:6000";
  const normalised = raw.trim().replace(/\/+$/, "");
  new URL(normalised); // throws on malformed input — fail fast
  return normalised;
}

const BASE_URL = getBaseUrl();
const VUS = Math.max(1, Number(process.env.LOAD_TEST_VUS || 10));
const DURATION_MS = Math.max(1, Number(process.env.LOAD_TEST_DURATION_SECONDS || 30)) * 1000;
const RAMP_UP_MS = Math.max(0, Number(process.env.LOAD_TEST_RAMP_UP_SECONDS || 5)) * 1000;
const THINK_TIME_MS = Math.max(0, Number(process.env.LOAD_TEST_THINK_TIME_MS ?? 200));
const REQUEST_TIMEOUT_MS = Number(process.env.LOAD_TEST_REQUEST_TIMEOUT_MS || 10000);
const P95_THRESHOLD_MS = Number(process.env.LOAD_TEST_P95_THRESHOLD_MS || 1000);
const ERROR_RATE_THRESHOLD = Number(process.env.LOAD_TEST_ERROR_RATE_THRESHOLD || 0.01);

// Funded accounts from packages/database/src/seed.ts's canonical seed
// data — all share PIN "1234" (see that file). These are the only
// accounts with a real balance, so they're the ones the "payment"
// scenario sends from/to. A freshly /auth/register-ed user starts at R0
// and cannot send money, which is realistic (that's genuinely how the
// product works) but means most VUs are read-only by construction, not
// as a load-test shortcut.
const FUNDED_ACCOUNTS = [
  { phone: process.env.LOAD_TEST_FUNDED_PHONE_1 || "+27799999999", pin: "1234", label: "Tumi" },
  { phone: process.env.LOAD_TEST_FUNDED_PHONE_2 || "+27722345678", pin: "1234", label: "Gwede" },
  { phone: process.env.LOAD_TEST_FUNDED_PHONE_3 || "+27833456789", pin: "1234", label: "Mama Thandi" },
];

const PAYMENT_AMOUNT_CENTS = Number(process.env.LOAD_TEST_PAYMENT_AMOUNT_CENTS || 100); // R1 — small relative to seeded balances (R1200+) so a run doesn't deplete them

function randomDeviceId() {
  return `loadtest-${crypto.randomBytes(6).toString("hex")}`;
}

function randomSaPhone() {
  // auth-service's register handler requires exactly 9 digits after +27
  // with a non-zero first digit (^(\+27|0)[1-9]\d{8}$) — "6" + 8 random
  // digits satisfies that and stays clear of the seed accounts above.
  const digits = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("");
  return `+276${digits}`;
}

// ─────────────────────────────────────────────────────────────────
// HTTP CLIENT
// ─────────────────────────────────────────────────────────────────

const client = axios.create({
  baseURL: BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  validateStatus: () => true, // never throw on non-2xx — the caller records the real status
});

// ─────────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────────

class ScenarioMetrics {
  constructor() {
    this.latencies = [];
    this.success = 0;
    this.fail = 0;
    this.statusCounts = new Map();
    this.errors = [];
  }
  record(latencyMs, status, ok, errorDetail) {
    this.latencies.push(latencyMs);
    if (ok) this.success++;
    else {
      this.fail++;
      if (errorDetail && this.errors.length < 5) this.errors.push(errorDetail);
    }
    this.statusCounts.set(status, (this.statusCounts.get(status) || 0) + 1);
  }
  get total() {
    return this.success + this.fail;
  }
  get errorRate() {
    return this.total === 0 ? 0 : this.fail / this.total;
  }
  percentile(p) {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }
}

const metricsByScenario = new Map();
function metricsFor(scenario) {
  if (!metricsByScenario.has(scenario)) metricsByScenario.set(scenario, new ScenarioMetrics());
  return metricsByScenario.get(scenario);
}

async function timed(scenario, fn) {
  const start = process.hrtime.bigint();
  let status = 0;
  let ok = false;
  let errorDetail;
  try {
    const res = await fn();
    status = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) {
      errorDetail = `HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`;
    }
  } catch (err) {
    status = -1;
    errorDetail = err instanceof Error ? err.message : String(err);
  } finally {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    metricsFor(scenario).record(latencyMs, status, ok, errorDetail);
  }
}

// ─────────────────────────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────────────────────────

async function login(phone, pin, deviceId) {
  const res = await client.post(
    "/auth/login",
    { phoneNumber: phone, pin, deviceId, deviceName: "load-test", userAgent: "load-test", ipAddress: "127.0.0.1" },
    { headers: { "X-Device-Id": deviceId } },
  );
  if (res.status !== 200 || !res.data?.data?.accessToken) {
    throw new Error(`login(${phone}) failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.data;
}

async function register(phone, pin, deviceId) {
  const res = await client.post(
    "/auth/register",
    { phoneNumber: phone, pin, deviceId, deviceName: "load-test", userAgent: "load-test", ipAddress: "127.0.0.1" },
    { headers: { "X-Device-Id": deviceId } },
  );
  if (res.status !== 201 || !res.data?.data?.accessToken) {
    throw new Error(`register(${phone}) failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.data;
}

function authHeaders(token, deviceId) {
  return { Authorization: `Bearer ${token}`, "X-Device-Id": deviceId };
}

// ─────────────────────────────────────────────────────────────────
// VIRTUAL USERS
// ─────────────────────────────────────────────────────────────────

function pickWeighted(weighted) {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of weighted) {
    r -= w;
    if (r <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

function sleep(ms) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/**
 * A "funded" VU: logs in as one of the seed accounts with a real balance.
 * Mix includes small peer-to-peer payments to the other funded accounts,
 * in addition to the same read scenarios every VU runs.
 */
async function runFundedVu(account, otherAccounts, endTime) {
  const deviceId = randomDeviceId();
  const session = await login(account.phone, account.pin, deviceId);
  const headers = authHeaders(session.accessToken, deviceId);
  const walletId = session.walletId;
  if (!walletId) throw new Error(`login(${account.phone}) returned no walletId`);

  while (Date.now() < endTime) {
    const scenario = pickWeighted([
      ["balance", 30],
      ["transactions", 25],
      ["walletLookup", 15],
      ["qrGenerate", 10],
      ["payment", 20],
    ]);

    if (scenario === "balance") {
      await timed("balance", () => client.get(`/wallets/${walletId}/balance`, { headers }));
    } else if (scenario === "transactions") {
      await timed("transactions", () =>
        client.get(`/wallets/${walletId}/transactions`, { headers, params: { limit: 20 } }),
      );
    } else if (scenario === "walletLookup") {
      const target = otherAccounts[Math.floor(Math.random() * otherAccounts.length)];
      await timed("walletLookup", () =>
        client.get("/wallets/lookup", { headers, params: { walletNumber: target.walletNumber } }),
      );
    } else if (scenario === "qrGenerate") {
      await timed("qrGenerate", () =>
        client.post(`/wallets/${walletId}/qr`, { qrType: "STATIC" }, { headers }),
      );
    } else if (scenario === "payment") {
      const recipient = otherAccounts[Math.floor(Math.random() * otherAccounts.length)];
      await timed("payment", () =>
        client.post(
          "/payments",
          {
            senderWalletId: walletId,
            receiverWalletNumber: recipient.walletNumber,
            amountCents: PAYMENT_AMOUNT_CENTS,
            description: "Load test payment",
            idempotencyKey: crypto.randomUUID(),
            paymentMethod: "UBUNTUPAY_WALLET",
            deviceId,
            ipAddress: "127.0.0.1",
          },
          { headers },
        ),
      );
    }

    await sleep(THINK_TIME_MS);
  }
}

/**
 * A "read-only" VU: registers a fresh throwaway account (R0 balance, so it
 * genuinely cannot pay — that's the real product behaviour, not a
 * load-test limitation) and exercises read scenarios plus QR generation
 * against its own empty wallet.
 */
async function runReadOnlyVu(otherAccounts, endTime) {
  const deviceId = randomDeviceId();
  const phone = randomSaPhone();
  const session = await register(phone, "1234", deviceId);
  const headers = authHeaders(session.accessToken, deviceId);
  const walletId = session.walletId;
  if (!walletId) throw new Error(`register(${phone}) returned no walletId`);

  while (Date.now() < endTime) {
    const scenario = pickWeighted([
      ["balance", 35],
      ["transactions", 25],
      ["walletLookup", 20],
      ["qrGenerate", 20],
    ]);

    if (scenario === "balance") {
      await timed("balance", () => client.get(`/wallets/${walletId}/balance`, { headers }));
    } else if (scenario === "transactions") {
      await timed("transactions", () =>
        client.get(`/wallets/${walletId}/transactions`, { headers, params: { limit: 20 } }),
      );
    } else if (scenario === "walletLookup") {
      const target = otherAccounts[Math.floor(Math.random() * otherAccounts.length)];
      await timed("walletLookup", () =>
        client.get("/wallets/lookup", { headers, params: { walletNumber: target.walletNumber } }),
      );
    } else if (scenario === "qrGenerate") {
      await timed("qrGenerate", () =>
        client.post(`/wallets/${walletId}/qr`, { qrType: "STATIC" }, { headers }),
      );
    }

    await sleep(THINK_TIME_MS);
  }
}

// ─────────────────────────────────────────────────────────────────
// REPORTING
// ─────────────────────────────────────────────────────────────────

function formatMs(n) {
  return `${Math.round(n)}ms`;
}

function printReport(wallClockSeconds) {
  console.log("\n" + "═".repeat(78));
  console.log("LOAD TEST RESULTS");
  console.log("═".repeat(78));

  let totalReq = 0;
  let totalFail = 0;
  let anyThresholdFailed = false;

  const scenarios = [...metricsByScenario.entries()].sort((a, b) => b[1].total - a[1].total);

  for (const [scenario, m] of scenarios) {
    totalReq += m.total;
    totalFail += m.fail;
    const p50 = m.percentile(50);
    const p95 = m.percentile(95);
    const p99 = m.percentile(99);
    const max = m.latencies.length ? Math.max(...m.latencies) : 0;
    const errRatePct = (m.errorRate * 100).toFixed(2);
    const statusBreakdown = [...m.statusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${code === -1 ? "ERR" : code}:${n}`)
      .join(" ");

    const p95Failed = p95 > P95_THRESHOLD_MS;
    const errRateFailed = m.errorRate > ERROR_RATE_THRESHOLD;
    if (p95Failed || errRateFailed) anyThresholdFailed = true;

    console.log(`\n${scenario}  (n=${m.total}, ${errRatePct}% errors${p95Failed || errRateFailed ? "  ⚠ THRESHOLD EXCEEDED" : ""})`);
    console.log(`  latency  p50=${formatMs(p50)}  p95=${formatMs(p95)}  p99=${formatMs(p99)}  max=${formatMs(max)}`);
    console.log(`  status   ${statusBreakdown}`);
    if (m.errors.length > 0) {
      console.log(`  sample errors:`);
      for (const e of m.errors) console.log(`    - ${e}`);
    }
  }

  console.log("\n" + "─".repeat(78));
  console.log(
    `TOTAL: ${totalReq} requests over ${wallClockSeconds.toFixed(1)}s ` +
      `(${(totalReq / wallClockSeconds).toFixed(1)} req/s), ${totalFail} failed ` +
      `(${totalReq === 0 ? "0.00" : ((totalFail / totalReq) * 100).toFixed(2)}%)`,
  );
  console.log(`Thresholds: p95 < ${P95_THRESHOLD_MS}ms, error rate < ${(ERROR_RATE_THRESHOLD * 100).toFixed(1)}% (per scenario)`);
  console.log(anyThresholdFailed ? "RESULT: FAIL ✖ (see ⚠ scenarios above)" : "RESULT: PASS ✔");
  console.log("═".repeat(78) + "\n");

  return !anyThresholdFailed && totalReq > 0;
}

// ─────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Ubuntu Pay load test`);
  console.log(`  base URL:        ${BASE_URL}`);
  console.log(`  virtual users:   ${VUS}`);
  console.log(`  duration:        ${DURATION_MS / 1000}s (+ ${RAMP_UP_MS / 1000}s ramp-up)`);
  console.log(`  think time:      ${THINK_TIME_MS}ms between requests per VU`);
  console.log(`  funded accounts: ${FUNDED_ACCOUNTS.map((a) => a.label).join(", ")}\n`);

  console.log("Checking gateway health...");
  const health = await client.get("/health").catch((e) => ({ status: -1, data: e.message }));
  if (health.status !== 200) {
    console.error(`✖ Gateway not reachable at ${BASE_URL} (HTTP ${health.status}). Is api-gateway running?`);
    console.error(`  See the prerequisites comment at the top of this script.`);
    process.exit(1);
  }
  console.log("✔ Gateway reachable.\n");

  console.log("Resolving funded seed accounts' wallet numbers...");
  const fundedWithWallets = [];
  for (const account of FUNDED_ACCOUNTS) {
    const deviceId = randomDeviceId();
    try {
      const session = await login(account.phone, account.pin, deviceId);
      fundedWithWallets.push({ ...account, walletId: session.walletId, walletNumber: session.walletNumber });
      console.log(`  ✔ ${account.label} (${account.phone}) → ${session.walletNumber}`);
    } catch (err) {
      console.error(`  ✖ Could not log in as ${account.label} (${account.phone}): ${err.message}`);
      console.error(`    Run 'node scripts/integration-up.js' to seed this account, or override`);
      console.error(`    LOAD_TEST_FUNDED_PHONE_1/2/3 to point at real accounts in this environment.`);
      process.exit(1);
    }
  }
  console.log("");

  const wallClockStart = Date.now();
  const steadyStateEnd = wallClockStart + RAMP_UP_MS + DURATION_MS;

  const vuPromises = [];
  const fundedVuCount = Math.min(VUS, fundedWithWallets.length);
  for (let i = 0; i < VUS; i++) {
    const startDelay = RAMP_UP_MS > 0 ? (i / VUS) * RAMP_UP_MS : 0;
    const isFunded = i < fundedVuCount;
    const vuPromise = sleep(startDelay).then(() => {
      if (isFunded) {
        const account = fundedWithWallets[i];
        const others = fundedWithWallets.filter((_, idx) => idx !== i);
        return runFundedVu(account, others.length ? others : fundedWithWallets, steadyStateEnd).catch((err) =>
          console.error(`[VU ${i}, funded/${account.label}] fatal: ${err.message}`),
        );
      }
      return runReadOnlyVu(fundedWithWallets, steadyStateEnd).catch((err) =>
        console.error(`[VU ${i}, read-only] fatal: ${err.message}`),
      );
    });
    vuPromises.push(vuPromise);
  }

  console.log(`Running ${VUS} virtual users (${fundedVuCount} funded, ${VUS - fundedVuCount} read-only)...`);
  await Promise.all(vuPromises);

  const wallClockSeconds = (Date.now() - wallClockStart) / 1000;
  const passed = printReport(wallClockSeconds);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("Load test crashed:", err);
  process.exit(1);
});
