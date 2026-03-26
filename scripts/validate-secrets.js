const REQUIRED_ALWAYS = [];

const REQUIRED_IN_CI_OR_PROD = [
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
  "PII_ENCRYPTION_KEY",
];

function isBlank(value) {
  return value == null || String(value).trim().length === 0;
}

function validate(required, modeLabel) {
  const missing = required.filter((name) => isBlank(process.env[name]));
  if (missing.length === 0) return { ok: true, missing: [] };
  return { ok: false, missing, modeLabel };
}

function main() {
  const results = [];

  results.push(validate(REQUIRED_ALWAYS, "always"));

  const isCi = String(process.env.CI || "").toLowerCase() === "true";
  const isProd = String(process.env.NODE_ENV || "dev").toLowerCase() === "production";
  if (isCi || isProd) {
    results.push(validate(REQUIRED_IN_CI_OR_PROD, "ci-or-production"));
  }

  const failures = results.filter((r) => r && r.ok === false);
  const warnings = results.filter((r) => r && r.ok === false && r.modeLabel === "always");

  if (failures.length === 0) {
    process.stdout.write("✅ secrets:validate passed\n");
    return;
  }

  for (const failure of failures) {
    process.stderr.write(
      `❌ secrets:validate missing (${failure.modeLabel}): ${failure.missing.join(", ")}\n`,
    );
  }

  if (warnings.length > 0 && failures.length === warnings.length) {
    process.stderr.write(
      "Set required values in your environment (local dev) or Secrets Manager (CI/prod).\n",
    );
  }

  process.exit(1);
}

main();
