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
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

// Health check
app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "wallet-service" }));
});

// GET /wallets/:walletId - Get wallet details
app.get("/wallets/:walletId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletId } = req.params;

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        user: {
          select: { phoneNumber: true, kycTier: true },
        },
      },
    });

    if (!wallet || wallet.isDeleted) {
      throw new AhavaError(
        AhavaErrorCode.WAL_NOT_FOUND,
        "Wallet not found",
        { requestId: req.id }
      );
    }

    res.json(
      createSuccessResponse({
        wallet: {
          id: wallet.id,
          walletNumber: wallet.walletNumber,
          walletType: wallet.walletType,
          status: wallet.status,
          balance: wallet.balance,
          pendingBalance: wallet.pendingBalance,
          dailyLimit: wallet.dailyLimit,
          monthlyLimit: wallet.monthlyLimit,
          maxBalance: wallet.maxBalance,
          dailySpent: wallet.dailySpent,
          monthlySpent: wallet.monthlySpent,
          currency: wallet.currency,
          kycTier: wallet.kycTier,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

// GET /wallets/:walletId/transactions - Get transaction history
app.get("/wallets/:walletId/transactions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 250);
    const offset = parseInt(req.query.offset as string) || 0;

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new AhavaError(
        AhavaErrorCode.WAL_NOT_FOUND,
        "Wallet not found",
        { requestId: req.id }
      );
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: {
        walletId,
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    res.json(createSuccessResponse({ transactions }));
  } catch (error) {
    next(error);
  }
});

// POST /wallets/:walletId/limits - Update wallet limits (KYC tier change)
app.post(
  "/wallets/:walletId/limits",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletId } = req.params;
      const { dailyLimit, monthlyLimit, maxBalance, perTransactionLimit } = req.body;

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        throw new AhavaError(
          AhavaErrorCode.WAL_NOT_FOUND,
          "Wallet not found",
          { requestId: req.id }
        );
      }

      // Update limits
      const updated = await prisma.wallet.update({
        where: { id: walletId },
        data: {
          dailyLimit: dailyLimit || wallet.dailyLimit,
          monthlyLimit: monthlyLimit || wallet.monthlyLimit,
          maxBalance: maxBalance || wallet.maxBalance,
          perTransactionLimit: perTransactionLimit || wallet.perTransactionLimit,
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: wallet.userId,
          action: "WALLET_LIMITS_UPDATED",
          entityType: "Wallet",
          entityId: walletId,
          newState: JSON.stringify({
            dailyLimit,
            monthlyLimit,
            maxBalance,
            perTransactionLimit,
          }),
          serviceId: "wallet-service",
        },
      });

      res.json(createSuccessResponse({ wallet: updated }));
    } catch (error) {
      next(error);
    }
  }
);

// GET /wallets/:walletId/balance - Get balance (read-only)
app.get("/wallets/:walletId/balance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletId } = req.params;

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        balance: true,
        pendingBalance: true,
        reservedBalance: true,
        currency: true,
      },
    });

    if (!wallet) {
      throw new AhavaError(
        AhavaErrorCode.WAL_NOT_FOUND,
        "Wallet not found",
        { requestId: req.id }
      );
    }

    const available = Number(wallet.balance) - Number(wallet.pendingBalance) - Number(wallet.reservedBalance);

    res.json(
      createSuccessResponse({
        balance: {
          available: Math.max(0, available),
          pending: Number(wallet.pendingBalance),
          reserved: Number(wallet.reservedBalance),
          total: Number(wallet.balance),
          currency: wallet.currency,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

// POST /wallets/:walletId/suspend - Suspend wallet (for AML)
app.post("/wallets/:walletId/suspend", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletId } = req.params;
    const { reason } = req.body;

    const wallet = await prisma.wallet.update({
      where: { id: walletId },
      data: {
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspendedReason: reason || "AML Review",
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: wallet.userId,
        action: "WALLET_SUSPENDED",
        entityType: "Wallet",
        entityId: walletId,
        newState: JSON.stringify({ reason }),
        serviceId: "wallet-service",
      },
    });

    res.json(createSuccessResponse({ wallet }));
  } catch (error) {
    next(error);
  }
});

// POST /wallets/:walletId/freeze - Freeze wallet (regulatory)
app.post("/wallets/:walletId/freeze", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletId } = req.params;
    const { reason } = req.body;

    const wallet = await prisma.wallet.update({
      where: { id: walletId },
      data: {
        status: "FROZEN",
        frozenAt: new Date(),
        frozenReason: reason || "Regulatory Order",
      },
    });

    res.json(createSuccessResponse({ wallet }));
  } catch (error) {
    next(error);
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  console.error("Unhandled error:", err);
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id }
  );
  res.status(500).json(createErrorResponse(genericError));
});

app.listen(PORT, () => {
  console.log(`✅ Wallet Service listening on port ${PORT}`);
});

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
