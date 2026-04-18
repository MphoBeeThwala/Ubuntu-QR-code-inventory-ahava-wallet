#!/usr/bin/env node

const { spawnSync } = require("child_process");

const res = spawnSync("node", ["scripts/smoke-payment.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SMOKE_API_BASE_URL: process.env.SMOKE_API_BASE_URL || "http://localhost:6000",
  },
});

process.exit(res.status ?? 1);

