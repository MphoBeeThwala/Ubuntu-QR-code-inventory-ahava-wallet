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
  res.json(createSuccessResponse({ status: "ok", service: "reporting-service" }));
});

// GET /reports/vat - Generate VAT report
app.get("/reports/vat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodStart, periodEnd } = req.query;

    if (!periodStart || !periodEnd) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing periodStart or periodEnd",
        { requestId: req.id }
      );
    }

    const start = new Date(periodStart as string);
    const end = new Date(periodEnd as string);

    // Calculate total transactions for VAT (15%)
    const transactions = await prisma.walletTransaction.findMany({
      where: {
        status: "COMPLETED",
        transactionType: "DEBIT",
        createdAt: { gte: start, lte: end },
      },
    });

    const totalTransactions = transactions.reduce((sum: number, t: any) => sum + t.amount, 0);
    const vatCollected = Math.round(totalTransactions * 0.15);

    res.json(
      createSuccessResponse({
        report: {
          period: { start, end },
          totalTransactions,
          transactionCount: transactions.length,
          vatCollected,
          currency: "ZAR",
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

// GET /reports/reconciliation - Reconciliation report
app.get(
  "/reports/reconciliation",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { periodStart, periodEnd } = req.query;

      // Basic reconciliation: check double-entry accounting
      const debits = await prisma.walletTransaction.aggregate({
        where: {
          transactionType: "DEBIT",
          status: "COMPLETED",
        },
        _sum: { amount: true },
      });

      const credits = await prisma.walletTransaction.aggregate({
        where: {
          transactionType: "CREDIT",
          status: "COMPLETED",
        },
        _sum: { amount: true },
      });

      res.json(
        createSuccessResponse({
          reconciliation: {
            totalDebits: debits._sum.amount || 0,
            totalCredits: credits._sum.amount || 0,
            balanced: debits._sum.amount === credits._sum.amount,
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id }
  );
  res.status(500).json(createErrorResponse(genericError));
});

app.listen(PORT, () => {
  console.log(`✅ Reporting Service listening on port ${PORT}`);
});

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
