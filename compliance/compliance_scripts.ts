/**
 * Compliance Verification Scripts
 * Ubuntu Pay Platform
 *
 * Runs read-only checks directly against the real schema (see
 * prisma/schema.prisma) — every query below was cross-checked against the
 * actual migration history, not assumed. Previous version of this file
 * queried tables and columns (transactions, aml_configurations,
 * debit_amount_cents/credit_amount_cents, users.password, ...) that have
 * never existed in this database; it would have failed with a SQL error on
 * every single check. Treat a clean run of this file as evidence for an
 * audit pack, not as a substitute for one — see SARB_COMPLIANCE.md for
 * what still requires a human sign-off (governance, key management,
 * incident response, POPIA/FICA registration).
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ahava_dev',
});

/**
 * Verify double-entry accounting: SUM(DEBIT) must equal SUM(CREDIT) in
 * ledger_entries. Mirrors services/ledger-service's own /ledger/reconcile
 * logic — this script exists to run the same check outside the service,
 * e.g. from a scheduled job or CI.
 */
export async function verifyDoubleEntry(): Promise<{ passed: boolean; imbalance?: bigint }> {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN "entryType" = 'DEBIT' THEN "amountCents" ELSE 0 END), 0) AS total_debits,
         COALESCE(SUM(CASE WHEN "entryType" = 'CREDIT' THEN "amountCents" ELSE 0 END), 0) AS total_credits
       FROM ledger_entries`
    );

    const debits = BigInt(result.rows[0].total_debits || 0);
    const credits = BigInt(result.rows[0].total_credits || 0);
    const imbalance = debits - credits;

    if (imbalance === 0n) {
      console.log('PASS: Double-entry accounting verified (debits == credits)');
      return { passed: true };
    } else {
      console.error('FAIL: Double-entry accounting imbalance detected');
      console.error('   Imbalance: ' + imbalance + ' cents');
      return { passed: false, imbalance };
    }
  } finally {
    client.release();
  }
}

/**
 * Verify that completed payments produced an audit trail entry.
 * payment-service writes an audit_logs row with entityType =
 * 'wallet_transaction' for every completed /payments call (see
 * services/payment-service/src/main.ts) — this checks that invariant
 * holds rather than asserting a per-wallet audit requirement that isn't
 * how this system is designed (wallets themselves aren't individually
 * audit-logged on creation; USER_REGISTERED covers that at the user level).
 */
export async function verifyAuditTrail(): Promise<{ passed: boolean; missing?: string[] }> {
  const client = await pool.connect();
  const missing: string[] = [];

  try {
    const completedTxResult = await client.query(
      `SELECT COUNT(*) AS count FROM wallet_transactions WHERE status = 'COMPLETED'`
    );
    const auditResult = await client.query(
      `SELECT COUNT(*) AS count FROM audit_logs WHERE "entityType" = 'wallet_transaction'`
    );

    const completedTransactions = parseInt(completedTxResult.rows[0].count, 10);
    const auditedTransactions = parseInt(auditResult.rows[0].count, 10);

    if (auditedTransactions < completedTransactions) {
      missing.push(
        `wallet_transaction audit logs: ${completedTransactions} completed transactions, only ${auditedTransactions} audited`,
      );
    }

    if (missing.length === 0) {
      console.log('PASS: Audit trail coverage verified');
      return { passed: true };
    } else {
      console.error('FAIL: Audit trail completeness check failed');
      missing.forEach((m) => console.error('   - ' + m));
      return { passed: false, missing };
    }
  } finally {
    client.release();
  }
}

/**
 * Verify transaction integrity invariants that aren't already enforced by
 * a DB constraint (idempotencyKey has a UNIQUE index, and status/amount
 * types are enforced by the column type itself, so those can't actually
 * be violated — this checks things Postgres doesn't guarantee for you).
 */
export async function verifyTransactionIntegrity(): Promise<{ passed: boolean; issues?: string[] }> {
  const client = await pool.connect();
  const issues: string[] = [];

  try {
    const negativeAmountResult = await client.query(
      `SELECT COUNT(*) AS count FROM wallet_transactions WHERE amount < 0`
    );
    if (parseInt(negativeAmountResult.rows[0].count, 10) > 0) {
      issues.push('wallet_transactions with a negative amount: ' + negativeAmountResult.rows[0].count);
    }

    const negativeFeeResult = await client.query(
      `SELECT COUNT(*) AS count FROM wallet_transactions WHERE "feeAmount" < 0`
    );
    if (parseInt(negativeFeeResult.rows[0].count, 10) > 0) {
      issues.push('wallet_transactions with a negative feeAmount: ' + negativeFeeResult.rows[0].count);
    }

    const balanceMismatchResult = await client.query(
      `SELECT COUNT(*) AS count FROM wallet_transactions
       WHERE "transactionType" = 'DEBIT' AND "balanceAfter" != "balanceBefore" - amount - "feeAmount"`
    );
    if (parseInt(balanceMismatchResult.rows[0].count, 10) > 0) {
      issues.push('DEBIT wallet_transactions where balanceAfter != balanceBefore - amount - fee: ' + balanceMismatchResult.rows[0].count);
    }

    if (issues.length === 0) {
      console.log('PASS: Transaction integrity verified');
      return { passed: true };
    } else {
      console.error('FAIL: Transaction integrity check failed');
      issues.forEach((i) => console.error('   - ' + i));
      return { passed: false, issues };
    }
  } finally {
    client.release();
  }
}

/**
 * Verify basic data-protection posture: DB connection uses SSL, and PIN
 * hashes look like real Argon2id hashes rather than something that leaked
 * through unhashed. There is no `users.password` column in this schema —
 * PINs are hashed into `users."pinHash"` (see @ahava/shared-crypto).
 */
export async function verifyDataProtection(): Promise<{ passed: boolean; issues?: string[] }> {
  const issues: string[] = [];
  const client = await pool.connect();

  try {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode')) {
      console.log('PASS: Database SSL configured');
    } else {
      issues.push('DATABASE_URL does not specify sslmode — expected outside local dev');
    }

    const unhashedPinResult = await client.query(
      `SELECT COUNT(*) AS count FROM users WHERE "pinHash" IS NOT NULL AND "pinHash" NOT LIKE '$argon2%'`
    );
    if (parseInt(unhashedPinResult.rows[0].count, 10) > 0) {
      issues.push('Users with a pinHash that is not an Argon2 hash: ' + unhashedPinResult.rows[0].count);
    }

    if (issues.length === 0) {
      console.log('PASS: Data protection verified');
      return { passed: true };
    } else {
      console.error('FAIL: Data protection check failed');
      issues.forEach((i) => console.error('   - ' + i));
      return { passed: false, issues };
    }
  } finally {
    client.release();
  }
}

/**
 * Report KYC tier distribution and any unresolved CRITICAL AML flags.
 * This is deliberately a report, not a pass/fail gate on "100% of users
 * are KYC-verified" — TIER_0 (unverified, lower-limit) accounts are a
 * legitimate, designed-for state in a tiered-KYC system, not a compliance
 * failure. What IS actionable is an open CRITICAL aml_flags row.
 */
export async function verifyKycAml(): Promise<{ passed: boolean; issues?: string[] }> {
  const client = await pool.connect();
  const issues: string[] = [];

  try {
    const tierResult = await client.query(
      `SELECT "kycTier", COUNT(*) AS count FROM users WHERE "isDeleted" = false GROUP BY "kycTier"`
    );
    console.log('KYC tier distribution: ' + JSON.stringify(tierResult.rows));

    const openCriticalFlags = await client.query(
      `SELECT COUNT(*) AS count FROM aml_flags WHERE severity = 'CRITICAL' AND status IN ('OPEN', 'UNDER_REVIEW')`
    );
    const openCount = parseInt(openCriticalFlags.rows[0].count, 10);
    if (openCount > 0) {
      issues.push('Unresolved CRITICAL AML flags: ' + openCount);
    }

    if (issues.length === 0) {
      console.log('PASS: No unresolved CRITICAL AML flags');
      return { passed: true };
    } else {
      console.error('FAIL: KYC/AML check failed');
      issues.forEach((i) => console.error('   - ' + i));
      return { passed: false, issues };
    }
  } finally {
    client.release();
  }
}

/**
 * Sanity-check that the system has recent activity to report on. There
 * are no dedicated reporting tables in this schema (reporting-service
 * queries wallet_transactions directly) — the previous version of this
 * function checked for transaction_reports/compliance_reports/
 * audit_reports tables that were never created.
 */
export async function verifyReporting(): Promise<{ passed: boolean; issues?: string[] }> {
  const client = await pool.connect();
  const issues: string[] = [];

  try {
    const recentResult = await client.query(
      `SELECT COUNT(*) AS count FROM wallet_transactions WHERE "createdAt" >= NOW() - INTERVAL '7 days'`
    );

    if (parseInt(recentResult.rows[0].count, 10) === 0) {
      issues.push('No wallet_transactions in the last 7 days — expected for a fresh environment, worth a second look otherwise');
    }

    if (issues.length === 0) {
      console.log('PASS: Recent transaction activity found');
      return { passed: true };
    } else {
      console.error('FAIL: Reporting check failed');
      issues.forEach((i) => console.error('   - ' + i));
      return { passed: false, issues };
    }
  } finally {
    client.release();
  }
}

/**
 * Run all compliance checks
 */
export async function runAllComplianceChecks(): Promise<{
  passed: boolean;
  results: {
    doubleEntry: { passed: boolean; imbalance?: bigint };
    auditTrail: { passed: boolean; missing?: string[] };
    transactionIntegrity: { passed: boolean; issues?: string[] };
    dataProtection: { passed: boolean; issues?: string[] };
    kycAml: { passed: boolean; issues?: string[] };
    reporting: { passed: boolean; issues?: string[] };
  };
}> {
  console.log('Running compliance checks...');
  console.log('');

  const results = {
    doubleEntry: await verifyDoubleEntry(),
    auditTrail: await verifyAuditTrail(),
    transactionIntegrity: await verifyTransactionIntegrity(),
    dataProtection: await verifyDataProtection(),
    kycAml: await verifyKycAml(),
    reporting: await verifyReporting(),
  };

  const allPassed = Object.values(results).every((r) => r.passed);

  console.log('');
  console.log('==================================================');
  if (allPassed) {
    console.log('SUCCESS: ALL COMPLIANCE CHECKS PASSED');
  } else {
    console.log('FAILURE: SOME COMPLIANCE CHECKS FAILED');
  }
  console.log('==================================================');

  return { passed: allPassed, results };
}

if (require.main === module) {
  runAllComplianceChecks()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error running compliance checks: ' + err);
      process.exit(1);
    });
}

export default {
  verifyDoubleEntry,
  verifyAuditTrail,
  verifyTransactionIntegrity,
  verifyDataProtection,
  verifyKycAml,
  verifyReporting,
  runAllComplianceChecks,
};
