#!/usr/bin/env node

const { spawnSync } = require("child_process");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function runNodeBin(binEntry, args, opts = {}) {
  const entryPath = require.resolve(binEntry);
  const res = spawnSync(process.execPath, [entryPath, ...args], {
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function runCompose(args, opts = {}) {
  const first = spawnSync("docker-compose", args, {
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (first.status === 0) return;

  const second = spawnSync("docker", ["compose", ...args], {
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (second.status !== 0) {
    process.exit(second.status ?? 1);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForContainerHealthy(name, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = spawnSync(
      "docker",
      ["inspect", "-f", "{{.State.Health.Status}}", name],
      { encoding: "utf8" },
    );
    const status = (res.stdout || "").trim();
    if (status === "healthy") return;
    await sleep(2000);
  }
  console.error(`Timed out waiting for ${name} to become healthy`);
  process.exit(1);
}

(async () => {
  runCompose(["up", "-d", "postgres", "redis"]);

  await waitForContainerHealthy("ahava-postgres", 120000);
  await waitForContainerHealthy("ahava-redis", 60000);

  const env = {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ||
      "postgresql://ahava:ahava_dev_pw_local@localhost:5432/ahava_dev",
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
    NODE_ENV: "integration",
  };

  runNodeBin("prisma/build/index.js", ["migrate", "deploy", "--schema=prisma/schema.prisma"], {
    env,
  });

  runNodeBin("prisma/build/index.js", ["generate", "--schema=prisma/schema.prisma"], {
    env,
  });

  runNodeBin("ts-node/dist/bin.js", ["packages/database/src/seed.ts"], { env });
})();
