#!/usr/bin/env node

const { spawnSync } = require("child_process");

const first = spawnSync("docker-compose", ["down"], { stdio: "inherit", shell: false });
if (first.status === 0) {
  process.exit(0);
}
const second = spawnSync("docker", ["compose", "down"], { stdio: "inherit", shell: false });
process.exit(second.status ?? 1);

