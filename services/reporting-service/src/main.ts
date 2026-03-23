import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3006;

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(
    createSuccessResponse({ status: "ok", service: "reporting-service" }),
  );
});

// GET /reports/vat - Generate VAT report
app.get(
  "/reports/vat",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { periodStart, periodEnd } = req.query;

      if (!periodStart || !periodEnd) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing periodStart or periodEnd",
          { requestId: req.id },
        );
      }

      const start = new Date(periodStart as string);
      const end = new Date(periodEnd as string);

      // Calculate total transactions for VAT (15%)
      const agg = await prisma.walletTransaction.aggregate({
        where: {
          status: "COMPLETED",
          transactionType: "DEBIT",
          createdAt: { gte: start, lte: end },
        },
        _sum: { amount: true },
        _count: { id: true },
      });

      const totalAmountCents = agg._sum.amount ?? BigInt(0);
      const vatCollectedCents = BigInt(
        Math.round(Number(totalAmountCents) * 0.15),
      );

      res.json(
        createSuccessResponse({
          report: {
            period: { start, end },
            totalAmountCents: totalAmountCents.toString(),
            transactionCount: agg._count.id,
            vatCollectedCents: vatCollectedCents.toString(),
            currency: "ZAR",
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /reports/reconciliation - Double-entry reconciliation report
app.get(
  "/reports/reconciliation",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [debits, credits] = await Promise.all([
        prisma.walletTransaction.aggregate({
          where: { transactionType: "DEBIT", status: "COMPLETED" },
          _sum: { amount: true },
          _count: { id: true },
        }),
        prisma.walletTransaction.aggregate({
          where: { transactionType: "CREDIT", status: "COMPLETED" },
          _sum: { amount: true },
          _count: { id: true },
        }),
      ]);

      const totalDebits = debits._sum.amount ?? BigInt(0);
      const totalCredits = credits._sum.amount ?? BigInt(0);

      res.json(
        createSuccessResponse({
          reconciliation: {
            totalDebitsCents: totalDebits.toString(),
            totalCreditsCents: totalCredits.toString(),
            debitCount: debits._count.id,
            creditCount: credits._count.id,
            balanced: totalDebits === totalCredits,
            discrepancyCents: (totalDebits - totalCredits).toString(),
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /reports/sarb - SARB monthly transaction report (FICA reporting)
app.get(
  "/reports/sarb",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { year, month } = req.query;

      if (!year || !month) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "year and month query parameters are required",
          { requestId: req.id },
        );
      }

      const y = parseInt(year as string);
      const m = parseInt(month as string) - 1; // 0-indexed
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);

      const [totalAgg, largeTransactions, uniqueUsers] = await Promise.all([
        prisma.walletTransaction.aggregate({
          where: {
            status: "COMPLETED",
            transactionType: "DEBIT",
            createdAt: { gte: start, lte: end },
          },
          _sum: { amount: true },
          _count: { id: true },
        }),
        // Transactions >= R5000 must be reported per FICA
        prisma.walletTransaction.findMany({
          where: {
            status: "COMPLETED",
            transactionType: "DEBIT",
            createdAt: { gte: start, lte: end },
            amount: { gte: BigInt(500000) }, // R5000 in cents
          },
          select: {
            id: true,
            amount: true,
            createdAt: true,
            wallet: { select: { userId: true } },
          },
          orderBy: { amount: "desc" },
          take: 1000,
        }),
        prisma.walletTransaction.findMany({
          where: {
            status: "COMPLETED",
            transactionType: "DEBIT",
            createdAt: { gte: start, lte: end },
          },
          distinct: ["walletId"],
          select: { walletId: true },
        }),
      ]);

      res.json(
        createSuccessResponse({
          report: {
            period: { year: y, month: m + 1, start, end },
            totalAmountCents: (totalAgg._sum.amount ?? BigInt(0)).toString(),
            totalTransactions: totalAgg._count.id,
            uniqueWallets: uniqueUsers.length,
            largeTransactionCount: largeTransactions.length,
            largeTransactions: largeTransactions.map(
              (t: {
                id: string;
                amount: bigint;
                createdAt: Date;
                wallet: { userId: string };
              }) => ({
                id: t.id,
                amountCents: t.amount.toString(),
                userId: t.wallet.userId,
                createdAt: t.createdAt,
              }),
            ),
            generatedAt: new Date().toISOString(),
            currency: "ZAR",
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(genericError));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Reporting Service listening on port ${PORT}`);
  });
}

export default app;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
