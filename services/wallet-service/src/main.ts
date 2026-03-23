import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@ahava/shared-events";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6002;

const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD,
};

/** Generate wallet number: AHV-XXXX-XXXX-XXXX */
function generateWalletNumber(): string {
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AHV-${seg()}-${seg()}-${seg()}`;
}

/** Serialize BigInt fields to strings for JSON */
function serializeWallet(w: Record<string, unknown>) {
  const bigIntFields = [
    "balance",
    "pendingBalance",
    "reservedBalance",
    "dailyLimit",
    "monthlyLimit",
    "maxBalance",
    "perTransactionLimit",
    "dailySpent",
    "monthlySpent",
    "dailyReceived",
  ];
  const out: Record<string, unknown> = { ...w };
  for (const f of bigIntFields) {
    if (out[f] !== undefined) out[f] = out[f]!.toString();
  }
  return out;
}

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

// POST /wallets - Create a new wallet for a user
app.post(
  "/wallets",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, walletType } = req.body;

      if (!userId) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "userId is required",
          { requestId: req.id },
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: userId, isDeleted: false },
        select: { id: true, kycTier: true },
      });

      if (!user) {
        throw new AhavaError(
          AhavaErrorCode.AUTH_UNAUTHORIZED,
          "User not found",
          { requestId: req.id },
        );
      }

      // Tier-based limits (in cents)
      const tierLimits = {
        TIER_0: {
          daily: 50000,
          monthly: 200000,
          maxBalance: 250000,
          perTx: 50000,
        },
        TIER_1: {
          daily: 200000,
          monthly: 1000000,
          maxBalance: 1000000,
          perTx: 200000,
        },
        TIER_2: {
          daily: 500000,
          monthly: 5000000,
          maxBalance: 25000000,
          perTx: 500000,
        },
      } as const;
      const limits =
        tierLimits[user.kycTier as keyof typeof tierLimits] ??
        tierLimits.TIER_0;

      const wallet = await prisma.wallet.create({
        data: {
          userId,
          walletNumber: generateWalletNumber(),
          walletType: walletType || "PERSONAL",
          kycTier: user.kycTier,
          dailyLimit: limits.daily,
          monthlyLimit: limits.monthly,
          maxBalance: limits.maxBalance,
          perTransactionLimit: limits.perTx,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "WALLET_CREATED",
          entityType: "Wallet",
          entityId: wallet.id,
          newState: JSON.stringify({
            walletNumber: wallet.walletNumber,
            walletType: wallet.walletType,
          }),
          serviceId: "wallet-service",
        },
      });

      // Publish WALLET_CREATED event (fire-and-forget)
      const q = new Queue(QUEUE_NAMES.WALLET_CREATED, {
        connection: redisConnection,
      });
      q.add("wallet-created", {
        walletId: wallet.id,
        userId,
        walletType: wallet.walletType,
      })
        .then(() => q.close())
        .catch((e) =>
          console.error("[wallet-service] event publish failed:", e),
        );

      res
        .status(201)
        .json(
          createSuccessResponse({ wallet: serializeWallet(wallet as any) }),
        );
    } catch (error) {
      next(error);
    }
  },
);

// GET /wallets/lookup?walletNumber=AHV-xxxx-xxxx  (MUST be before /:walletId)
app.get(
  "/wallets/lookup",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletNumber = req.query.walletNumber as string;

      if (!walletNumber) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing required fields",
          { requestId: req.id },
        );
      }

      const wallet = await prisma.wallet.findUnique({
        where: { walletNumber },
        include: {
          user: {
            select: { fullName: true },
          },
        },
      });

      if (!wallet || wallet.isDeleted) {
        throw new AhavaError(AhavaErrorCode.WAL_NOT_FOUND, "Wallet not found", {
          requestId: req.id,
        });
      }

      res.json(
        createSuccessResponse({
          wallet: {
            id: wallet.id,
            walletNumber: wallet.walletNumber,
            holderName: wallet.user?.fullName ?? wallet.walletNumber,
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /wallets/:walletId - Get wallet details
app.get(
  "/wallets/:walletId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletId } = req.params;

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet || wallet.isDeleted) {
        throw new AhavaError(AhavaErrorCode.WAL_NOT_FOUND, "Wallet not found", {
          requestId: req.id,
        });
      }

      res.json(
        createSuccessResponse({ wallet: serializeWallet(wallet as any) }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /wallets/:walletId/transactions - Get transaction history
app.get(
  "/wallets/:walletId/transactions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 250);
      const offset = parseInt(req.query.offset as string) || 0;

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        throw new AhavaError(AhavaErrorCode.WAL_NOT_FOUND, "Wallet not found", {
          requestId: req.id,
        });
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

      res.json(
        createSuccessResponse({
          transactions: transactions.map((t: any) => ({
            ...t,
            amount: t.amount?.toString(),
            feeAmount: t.feeAmount?.toString(),
            netAmount: t.netAmount?.toString(),
            balanceBefore: t.balanceBefore?.toString(),
            balanceAfter: t.balanceAfter?.toString(),
          })),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST /wallets/:walletId/limits - Update wallet limits (KYC tier change)
app.post(
  "/wallets/:walletId/limits",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletId } = req.params;
      const { dailyLimit, monthlyLimit, maxBalance, perTransactionLimit } =
        req.body;

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        throw new AhavaError(AhavaErrorCode.WAL_NOT_FOUND, "Wallet not found", {
          requestId: req.id,
        });
      }

      // Update limits
      const updated = await prisma.wallet.update({
        where: { id: walletId },
        data: {
          dailyLimit: dailyLimit || wallet.dailyLimit,
          monthlyLimit: monthlyLimit || wallet.monthlyLimit,
          maxBalance: maxBalance || wallet.maxBalance,
          perTransactionLimit:
            perTransactionLimit || wallet.perTransactionLimit,
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

      res.json(
        createSuccessResponse({ wallet: serializeWallet(updated as any) }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /wallets/:walletId/balance - Get balance (read-only)
app.get(
  "/wallets/:walletId/balance",
  async (req: Request, res: Response, next: NextFunction) => {
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
        throw new AhavaError(AhavaErrorCode.WAL_NOT_FOUND, "Wallet not found", {
          requestId: req.id,
        });
      }

      const available =
        Number(wallet.balance) -
        Number(wallet.pendingBalance) -
        Number(wallet.reservedBalance);

      res.json(
        createSuccessResponse({
          balance: {
            available: Math.max(0, available).toString(),
            pending: wallet.pendingBalance.toString(),
            reserved: wallet.reservedBalance.toString(),
            total: wallet.balance.toString(),
            currency: wallet.currency,
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST /wallets/:walletId/suspend - Suspend wallet (for AML)
app.post(
  "/wallets/:walletId/suspend",
  async (req: Request, res: Response, next: NextFunction) => {
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

      res.json(
        createSuccessResponse({ wallet: serializeWallet(wallet as any) }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST /wallets/:walletId/freeze - Freeze wallet (regulatory)
app.post(
  "/wallets/:walletId/freeze",
  async (req: Request, res: Response, next: NextFunction) => {
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

      res.json(
        createSuccessResponse({ wallet: serializeWallet(wallet as any) }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// Error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  console.error("Unhandled error:", err);
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(genericError));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Wallet Service listening on port ${PORT}`);
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
