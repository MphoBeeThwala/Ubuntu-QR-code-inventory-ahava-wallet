#!/usr/bin/env node
/**
 * scripts/check-coverage.js
 * Reads Jest coverage-summary.json from each service and enforces
 * minimum thresholds. Exit 1 if any service is below threshold.
 *
 * Usage: node scripts/check-coverage.js
 * Called by CI after `npm run test:coverage`
 */

const fs = require("fs");
const path = require("path");

// Services that must produce coverage reports
const SERVICES = [
  "services/auth-service",
  "services/payment-service",
  "services/wallet-service",
  "services/kyc-service",
  "services/aml-service",
  "services/notification-service",
  "services/reporting-service",
];

// Minimum thresholds (lines %, functions %, branches %)
const THRESHOLDS = {
  // Financial-critical services: strict
  "services/payment-service": { lines: 95, functions: 95, branches: 80 },
  "services/auth-service":    { lines: 95, functions: 95, branches: 80 },
  // Other services: standard
  default:                    { lines: 80, functions: 80, branches: 70 },
};

const ROOT = path.resolve(__dirname, "..");

let failed = false;

for (const service of SERVICES) {
  const summaryPath = path.join(ROOT, service, "coverage", "coverage-summary.json");

  if (!fs.existsSync(summaryPath)) {
    console.error(`❌ [${service}] coverage-summary.json not found. Did you run test:coverage?`);
    failed = true;
    continue;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const total = summary.total;
  const thresholds = THRESHOLDS[service] || THRESHOLDS.default;

  const metrics = [
    { name: "lines",     pct: total.lines.pct,     min: thresholds.lines },
    { name: "functions", pct: total.functions.pct, min: thresholds.functions },
    { name: "branches",  pct: total.branches.pct,  min: thresholds.branches },
  ];

  const serviceFailed = metrics.some((m) => m.pct < m.min);

  if (serviceFailed) {
    console.error(`\n❌ [${service}] Coverage below threshold:`);
    for (const m of metrics) {
      const icon = m.pct >= m.min ? "✅" : "❌";
      console.error(`   ${icon} ${m.name.padEnd(12)} ${m.pct.toFixed(1)}%  (min: ${m.min}%)`);
    }
    failed = true;
  } else {
    console.log(`✅ [${service}] Coverage OK — lines: ${total.lines.pct.toFixed(1)}%, functions: ${total.functions.pct.toFixed(1)}%, branches: ${total.branches.pct.toFixed(1)}%`);
  }
}

if (failed) {
  console.error("\n\nCoverage check failed. Fix the services above before merging.\n");
  process.exit(1);
} else {
  console.log("\nAll coverage thresholds passed.\n");
  process.exit(0);
}
