import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient, Prisma } from "@prisma/client";
import { AhavaError, AhavaErrorCode, createSuccessResponse, createErrorResponse } from "@ahava/shared-errors";
import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";
import { writeAuditLog } from "@ahava/shared-audit";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6004;
const redisConnection = getRedisConnectionConfig();

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  req.id = typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

const CHART_OF_ACCOUNTS = {
  ASSETS: { CASH_FLOAT: "1001", CUSTOMER_WALLETS: "1100", FEE_POOL: "1200", ESCROW: "1300", BANK_ACCOUNT: "1500" },
  LIABILITIES: { CUSTOMER_DEPOSITS: "2000", AGENT_FLOAT_LIABILITY: "2100", MERCHANT_SETTLEMENT: "2200" },
  EQUITY: { RETAINED_EARNINGS: "3000", SHARE_CAPITAL: "3100" },
  REVENUE: { TRANSACTION_FEES: "4000", FX_SPREAD: "4100", INTEREST_INCOME: "4200" },
  EXPENSES: { PROCESSING_FEES: "5000", AGENT_COMMISSIONS: "5100", AML_SCREENING: "5200", TECH_INFRA: "5300" },
};

app.get("/health", (req, res) => { res.json(createSuccessResponse({ status: "ok", service: "ledger-service" }, req.id)); });

app.post("/ledger/entries", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId, walletId, userId, entryType, accountCode, amountCents, currency = "ZAR", description, reference, counterpartyWalletId, counterpartyAccountCode, metadata } = req.body;
    if (!transactionId || !walletId || !accountCode || amountCents == null) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing required fields", { requestId: req.id });
    const allCodes = Object.values(CHART_OF_ACCOUNTS).flatMap((c) => Object.values(c));
    if (!allCodes.includes(accountCode)) throw new AhavaError(AhavaErrorCode.VAL_INVALID_INPUT, `Invalid account code: ${accountCode}`, { requestId: req.id });
    const entry = await prisma.$queryRaw`INSERT INTO ledger_entries (id, transaction_id, wallet_id, user_id, entry_type, account_code, amount_cents, currency, description, reference, counterparty_wallet_id, counterparty_account_code, metadata, created_at) VALUES (gen_random_uuid(), ${transactionId}, ${walletId}, ${userId}, ${entryType}, ${accountCode}, ${amountCents}, ${currency}, ${description || ""}, ${reference || ""}, ${counterpartyWalletId || null}, ${counterpartyAccountCode || null}, ${metadata ? JSON.stringify(metadata) : null}, NOW()) RETURNING *`;
    await writeAuditLog(prisma, { userId, action: "LEDGER_ENTRY_CREATED", entityType: "ledger_entry", entityId: transactionId, newState: JSON.stringify({ accountCode, entryType, amountCents: amountCents.toString() }), serviceId: "ledger-service", correlationId: req.id });
    res.status(201).json(createSuccessResponse({ entry: (entry as any[])[0] }, req.id));
  } catch (error) { next(error); }
});

app.post("/ledger/batch", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entries } = req.body;
    if (!entries || entries.length === 0) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "entries array required", { requestId: req.id });
    const totalDebits = entries.filter((e: any) => e.entryType === "DEBIT").reduce((sum: bigint, e: any) => sum + BigInt(e.amountCents), BigInt(0));
    const totalCredits = entries.filter((e: any) => e.entryType === "CREDIT").reduce((sum: bigint, e: any) => sum + BigInt(e.amountCents), BigInt(0));
    if (totalDebits !== totalCredits) throw new AhavaError(AhavaErrorCode.VAL_INVALID_INPUT, `Imbalance: debits=${totalDebits} credits=${totalCredits}`, { requestId: req.id });
    const result = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const entry of entries) {
        const row = await tx.$queryRaw`INSERT INTO ledger_entries (id, transaction_id, wallet_id, user_id, entry_type, account_code, amount_cents, currency, description, reference, counterparty_wallet_id, counterparty_account_code, metadata, created_at) VALUES (gen_random_uuid(), ${entry.transactionId}, ${entry.walletId}, ${entry.userId}, ${entry.entryType}, ${entry.accountCode}, ${entry.amountCents}, ${entry.currency || "ZAR"}, ${entry.description || ""}, ${entry.reference || ""}, ${entry.counterpartyWalletId || null}, ${entry.counterpartyAccountCode || null}, ${entry.metadata ? JSON.stringify(entry.metadata) : null}, NOW()) RETURNING *`;
        created.push((row as any[])[0]);
      }
      return created;
    });
    const q = new Queue(QUEUE_NAMES.LEDGER_RECONCILIATION, { connection: redisConnection });
    q.add("reconcile", { batchId: uuidv4(), entryCount: entries.length, totalDebits: totalDebits.toString(), totalCredits: totalCredits.toString(), timestamp: new Date().toISOString() }).then(() => q.close()).catch((e) => console.error("[ledger] event publish failed:", e));
    res.status(201).json(createSuccessResponse({ entries: result, summary: { entryCount: entries.length, totalDebits: totalDebits.toString(), totalCredits: totalCredits.toString(), balanced: true } }, req.id));
  } catch (error) { next(error); }
});

app.get("/ledger/trial-balance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, accountCode } = req.query;
    const targetDate = date ? new Date(date as string) : new Date();
    const targetDateEnd = new Date(targetDate); targetDateEnd.setHours(23, 59, 59, 999);
    const whereClause = accountCode ? Prisma.sql`AND account_code = ${accountCode as string}` : Prisma.sql``;
    const rows = await prisma.$queryRaw`SELECT account_code, entry_type, SUM(amount_cents) as total_cents, COUNT(*) as entry_count FROM ledger_entries WHERE created_at <= ${targetDateEnd} ${whereClause} GROUP BY account_code, entry_type ORDER BY account_code, entry_type`;
    const accounts: Record<string, { debits: bigint; credits: bigint; count: number }> = {};
    for (const row of rows as any[]) {
      const code = row.account_code;
      if (!accounts[code]) accounts[code] = { debits: BigInt(0), credits: BigInt(0), count: 0 };
      if (row.entry_type === "DEBIT") accounts[code].debits += BigInt(row.total_cents); else accounts[code].credits += BigInt(row.total_cents);
      accounts[code].count += Number(row.entry_count);
    }
    const totalDebits = Object.values(accounts).reduce((sum, a) => sum + a.debits, BigInt(0));
    const totalCredits = Object.values(accounts).reduce((sum, a) => sum + a.credits, BigInt(0));
    res.json(createSuccessResponse({ asOf: targetDate.toISOString(), accounts: Object.entries(accounts).map(([code, vals]) => ({ accountCode: code, debits: vals.debits.toString(), credits: vals.credits.toString(), netBalance: (vals.debits - vals.credits).toString(), entryCount: vals.count })), summary: { totalDebits: totalDebits.toString(), totalCredits: totalCredits.toString(), balanced: totalDebits === totalCredits } }, req.id));
  } catch (error) { next(error); }
});

app.get("/ledger/reconcile", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletId } = req.query;
    const wallet = walletId ? await prisma.wallet.findUnique({ where: { id: walletId as string }, select: { id: true, balance: true, walletNumber: true } }) : null;
    const ledgerBalance = await prisma.$queryRaw`SELECT COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_cents ELSE 0 END), 0) as total_debits, COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_cents ELSE 0 END), 0) as total_credits FROM ledger_entries WHERE account_code = ${CHART_OF_ACCOUNTS.ASSETS.CUSTOMER_WALLETS} ${walletId ? Prisma.sql`AND wallet_id = ${walletId as string}` : Prisma.sql``}`;
    const lb = (ledgerBalance as any[])[0];
    const ledgerNet = BigInt(lb.total_credits) - BigInt(lb.total_debits);
    const walletSum = await prisma.wallet.aggregate({ _sum: { balance: true }, where: { isDeleted: false, status: "ACTIVE" } });
    const totalWalletBalance = walletSum._sum.balance || BigInt(0);
    const discrepancy = totalWalletBalance - ledgerNet;
    res.json(createSuccessResponse({ walletId: wallet?.id || "ALL", walletBalance: wallet?.balance?.toString() || totalWalletBalance.toString(), ledgerNetBalance: ledgerNet.toString(), discrepancy: discrepancy.toString(), reconciled: discrepancy === BigInt(0), timestamp: new Date().toISOString() }, req.id));
  } catch (error) { next(error); }
});

app.get("/ledger/chart-of-accounts", (req: Request, res: Response) => { res.json(createSuccessResponse({ chart: CHART_OF_ACCOUNTS }, req.id)); });

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) return res.status(err.statusCode).json(createErrorResponse(err));
  console.error("Unhandled error:", err);
  res.status(500).json(createErrorResponse(new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, "Internal server error", { requestId: req.id })));
});

export function startServer() {
  app.listen(PORT, () => { console.log(`✅ Ledger Service on port ${PORT}`); console.log(`📊 Trial balance: http://localhost:${PORT}/ledger/trial-balance`); console.log(`🔄 Reconcile: http://localhost:${PORT}/ledger/reconcile`); });
}
if (require.main === module) startServer();
export default app;

declare global { namespace Express { interface Request { id?: string; } } }