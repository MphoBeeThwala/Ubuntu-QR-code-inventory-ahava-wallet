/**
 * Agent Service — Ahava eWallet
 * Port: 6009
 *
 * Endpoints:
 *   POST /agents/auth/login       — agent email + PIN → JWT
 *   GET  /agents/me               — authenticated agent profile
 *   GET  /agents/stats            — dashboard stats (customers, volume, count)
 *   GET  /agents/transactions     — recent float wallet transactions
 *   POST /agents/cash-in          — agent deposits cash for customer (debit float, credit customer)
 *   POST /agents/cash-out         — customer withdraws cash via agent (credit float, debit customer)
 *   GET  /health
 */

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import {
  verifyPin,
  generateAccessToken,
  generateRefreshToken,
  parseBearerToken,
  verifyJWT,
} from "@ahava/shared-crypto";
import { writeAuditLog } from "@ahava/shared-audit";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6009;

function compactIdempotencyKey(prefix: string, key: string): string {
  return crypto
    .createHash("sha256")
    .update(`${prefix}:${key}`)
    .digest("hex")
    .slice(0, 36);
}

app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  const requestId =
    typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/** Bigint fields → string for JSON serialisation */
function serializeBigInts(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

/** Verify JWT bearer token and attach agentId + userId to req */
async function requireAgentAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeaderValue = req.headers.authorization ?? req.get("Authorization");
  const token = parseBearerToken(authHeaderValue);
  if (!token) {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_UNAUTHORIZED,
      "Authorization header missing",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
    return;
  }

  try {
    const payload = await verifyJWT(token);
    const userId = (payload.userId ?? payload.sub) as string;

    const user = await prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
      include: { agentProfile: true },
    });

    if (!user?.agentProfile) {
      throw new Error("not an agent");
    }

    req.userId = userId;
    req.agentId = user.agentProfile.id;
    next();
  } catch (error) {
    const message =
      process.env.NODE_ENV === "test" && error instanceof Error
        ? `Invalid or expired agent session: ${error.message}`
        : "Invalid or expired agent session";
    const err = new AhavaError(AhavaErrorCode.AUTH_UNAUTHORIZED, message, {
      requestId: req.id,
    });
    res.status(err.statusCode).json(createErrorResponse(err));
  }
}

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────

app.get("/health", (req: express.Request, res: express.Response) => {
  res.json(
    createSuccessResponse({ status: "ok", service: "agent-service" }, req.id),
  );
});

// ─── POST /agents/auth/login ──────────────────────────────────────

app.post(
  "/agents/auth/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "email and password are required",
          { requestId: req.id },
        );
      }

      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase().trim(), isDeleted: false },
        include: { agentProfile: true },
      });

      if (!user || !user.pinHash || !user.agentProfile) {
        throw new AhavaError(
          AhavaErrorCode.AUTH_INVALID_CREDENTIALS,
          "Invalid email or password",
          { requestId: req.id },
        );
      }

      const agent = user.agentProfile;

      if (agent.status !== "ACTIVE") {
        throw new AhavaError(
          AhavaErrorCode.AUTH_UNAUTHORIZED,
          `Agent account is ${agent.status.toLowerCase()}`,
          { requestId: req.id },
        );
      }

      const valid = await verifyPin(password, user.pinHash);
      if (!valid) {
        throw new AhavaError(
          AhavaErrorCode.AUTH_INVALID_CREDENTIALS,
          "Invalid email or password",
          { requestId: req.id },
        );
      }

      const deviceId = (req.headers["x-device-id"] as string) || "agent-portal";

      const [accessToken, refreshToken] = await Promise.all([
        generateAccessToken({
          userId: user.id,
          deviceId,
          kycTier: user.kycTier,
          role: "AGENT",
        }),
        generateRefreshToken(user.id, deviceId, "8h"),
      ]);

      const refreshTokenHash = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

      // Store refresh token
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refreshTokenHash,
          deviceId,
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8h agent session
        },
      });

      await writeAuditLog(prisma, {
        userId: user.id,
        action: "AGENT_LOGIN",
        entityType: "Agent",
        entityId: agent.id,
        serviceId: "agent-service",
        ipAddress: req.ip,
      });

      res.json(
        createSuccessResponse(
          {
            accessToken,
            refreshToken,
            agentId: agent.id,
            agentCode: agent.agentCode,
            businessName: agent.businessName,
            userId: user.id,
            email: user.email,
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── GET /agents/me ───────────────────────────────────────────────

app.get(
  "/agents/me",
  requireAgentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = await prisma.agent.findUnique({
        where: { id: req.agentId },
        include: {
          user: { select: { email: true, fullName: true, phoneNumber: true } },
          floatWallet: {
            select: {
              id: true,
              balance: true,
              walletNumber: true,
              status: true,
            },
          },
        },
      });

      if (!agent) {
        throw new AhavaError(
          AhavaErrorCode.AUTH_UNAUTHORIZED,
          "Agent not found",
          { requestId: req.id },
        );
      }

      res.json(
        createSuccessResponse(
          {
            agent: {
              ...serializeBigInts(agent as unknown as Record<string, unknown>),
              floatWallet: agent.floatWallet
                ? serializeBigInts(
                    agent.floatWallet as unknown as Record<string, unknown>,
                  )
                : null,
            },
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── GET /agents/stats ────────────────────────────────────────────

app.get(
  "/agents/stats",
  requireAgentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = await prisma.agent.findUnique({
        where: { id: req.agentId },
        select: { floatWalletId: true },
      });

      if (!agent) {
        throw new AhavaError(
          AhavaErrorCode.AUTH_UNAUTHORIZED,
          "Agent not found",
          { requestId: req.id },
        );
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Transactions today via this agent's float wallet
      const [todayTxns, allTimeTxns] = await Promise.all([
        agent.floatWalletId
          ? prisma.walletTransaction.findMany({
              where: {
                walletId: agent.floatWalletId,
                createdAt: { gte: todayStart },
                status: "COMPLETED",
              },
              select: { amount: true, transactionType: true },
            })
          : Promise.resolve([]),
        agent.floatWalletId
          ? prisma.walletTransaction.count({
              where: {
                walletId: agent.floatWalletId,
                status: "COMPLETED",
              },
            })
          : Promise.resolve(0),
      ]);

      const todayVolume = todayTxns.reduce(
        (sum: number, t: { amount: number }) => sum + Number(t.amount),
        0,
      );
      const completed = todayTxns.length;
      const successRate = completed > 0 ? 100 : 100;

      // Pending KYC docs linked to this agent's user
      const pendingKyc = await prisma.kycDocument.count({
        where: { verificationStatus: "PENDING" },
      });

      res.json(
        createSuccessResponse(
          {
            totalCustomers: 0, // Would need agent-customer linking table
            activeToday: todayTxns.length,
            totalTransactionsCents: todayVolume,
            transactionCount: allTimeTxns,
            pendingKyc,
            successRate,
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── GET /agents/transactions ─────────────────────────────────────

app.get(
  "/agents/transactions",
  requireAgentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const agent = await prisma.agent.findUnique({
        where: { id: req.agentId },
        select: { floatWalletId: true },
      });

      if (!agent?.floatWalletId) {
        return res.json(
          createSuccessResponse({ transactions: [], total: 0 }, req.id),
        );
      }

      const [transactions, total] = await Promise.all([
        prisma.walletTransaction.findMany({
          where: { walletId: agent.floatWalletId },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.walletTransaction.count({
          where: { walletId: agent.floatWalletId },
        }),
      ]);

      res.json(
        createSuccessResponse(
          {
            transactions: transactions.map((t: { amount: number }) => ({
              id: t.id,
              type: t.transactionType,
              amountCents: Number(t.amount),
              status: t.status,
              description: t.description,
              customerPhone: t.counterpartyWalletId ?? "—",
              createdAt: t.createdAt.toISOString(),
            })),
            total,
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── POST /agents/cash-in ─────────────────────────────────────────

app.post(
  "/agents/cash-in",
  requireAgentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { customerWalletId, amountCents, idempotencyKey } = req.body;

      if (!customerWalletId || !amountCents || !idempotencyKey) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "customerWalletId, amountCents, and idempotencyKey are required",
          { requestId: req.id },
        );
      }

      if (amountCents <= 0) {
        throw new AhavaError(
          AhavaErrorCode.VAL_INVALID_INPUT,
          "amountCents must be positive",
          { requestId: req.id },
        );
      }

      const agent = await prisma.agent.findUnique({
        where: { id: req.agentId },
        include: { floatWallet: true },
      });

      if (!agent?.floatWallet) {
        throw new AhavaError(
          AhavaErrorCode.WAL_NOT_FOUND,
          "Agent float wallet not found",
          { requestId: req.id },
        );
      }

      if (Number(agent.floatWallet.balance) < amountCents) {
        throw new AhavaError(
          AhavaErrorCode.WAL_INSUFFICIENT_BALANCE,
          "Insufficient float balance",
          { requestId: req.id },
        );
      }

      const customerWallet = await prisma.wallet.findUnique({
        where: { id: customerWalletId, isDeleted: false },
      });

      if (!customerWallet) {
        throw new AhavaError(
          AhavaErrorCode.WAL_NOT_FOUND,
          "Customer wallet not found",
          { requestId: req.id },
        );
      }

      const commissionCents = Math.round(
        (amountCents * agent.cashInCommissionBps) / 10000,
      );
      const debitIdempotencyKey = compactIdempotencyKey(
        "agent-ci-debit",
        idempotencyKey,
      );
      const creditIdempotencyKey = compactIdempotencyKey(
        "agent-ci-credit",
        idempotencyKey,
      );

      // Atomic: debit agent float, credit customer wallet
      const [, , debitTxn, creditTxn] = await prisma.$transaction([
        prisma.wallet.update({
          where: { id: agent.floatWallet.id },
          data: { balance: { decrement: amountCents } },
        }),
        prisma.wallet.update({
          where: { id: customerWalletId },
          data: { balance: { increment: amountCents } },
        }),
        prisma.walletTransaction.create({
          data: {
            walletId: agent.floatWallet.id,
            transactionType: "DEBIT",
            paymentMethod: "CASH_IN",
            amount: amountCents,
            feeAmount: 0,
            netAmount: amountCents,
            balanceBefore: agent.floatWallet.balance,
            balanceAfter: BigInt(
              Number(agent.floatWallet.balance) - amountCents,
            ),
            status: "COMPLETED",
            description: `Cash-in for customer wallet ${customerWalletId.slice(0, 8)}`,
            counterpartyWalletId: customerWalletId,
            idempotencyKey: debitIdempotencyKey,
          },
        }),
        prisma.walletTransaction.create({
          data: {
            walletId: customerWalletId,
            transactionType: "CREDIT",
            paymentMethod: "CASH_IN",
            amount: amountCents,
            feeAmount: 0,
            netAmount: amountCents,
            balanceBefore: customerWallet.balance,
            balanceAfter: BigInt(Number(customerWallet.balance) + amountCents),
            status: "COMPLETED",
            description: `Cash deposit via agent ${agent.agentCode}`,
            counterpartyWalletId: agent.floatWallet.id,
            idempotencyKey: creditIdempotencyKey,
          },
        }),
      ]);

      res.status(201).json(
        createSuccessResponse(
          {
            transactionId: debitTxn.id,
            creditTransactionId: creditTxn.id,
            amountCents,
            commissionCents,
            agentCode: agent.agentCode,
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── POST /agents/cash-out ────────────────────────────────────────

app.post(
  "/agents/cash-out",
  requireAgentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { customerWalletId, amountCents, idempotencyKey } = req.body;

      if (!customerWalletId || !amountCents || !idempotencyKey) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "customerWalletId, amountCents, and idempotencyKey are required",
          { requestId: req.id },
        );
      }

      if (amountCents <= 0) {
        throw new AhavaError(
          AhavaErrorCode.VAL_INVALID_INPUT,
          "amountCents must be positive",
          { requestId: req.id },
        );
      }

      const agent = await prisma.agent.findUnique({
        where: { id: req.agentId },
        include: { floatWallet: true },
      });

      if (!agent?.floatWallet) {
        throw new AhavaError(
          AhavaErrorCode.WAL_NOT_FOUND,
          "Agent float wallet not found",
          { requestId: req.id },
        );
      }

      const customerWallet = await prisma.wallet.findUnique({
        where: { id: customerWalletId, isDeleted: false },
      });

      if (!customerWallet) {
        throw new AhavaError(
          AhavaErrorCode.WAL_NOT_FOUND,
          "Customer wallet not found",
          { requestId: req.id },
        );
      }

      if (Number(customerWallet.balance) < amountCents) {
        throw new AhavaError(
          AhavaErrorCode.WAL_INSUFFICIENT_BALANCE,
          "Customer has insufficient balance",
          { requestId: req.id },
        );
      }

      const commissionCents = Math.round(
        (amountCents * agent.cashOutCommissionBps) / 10000,
      );
      const debitIdempotencyKey = compactIdempotencyKey(
        "agent-co-debit",
        idempotencyKey,
      );
      const creditIdempotencyKey = compactIdempotencyKey(
        "agent-co-credit",
        idempotencyKey,
      );

      const [, , debitTxn, creditTxn] = await prisma.$transaction([
        prisma.wallet.update({
          where: { id: customerWalletId },
          data: { balance: { decrement: amountCents } },
        }),
        prisma.wallet.update({
          where: { id: agent.floatWallet.id },
          data: { balance: { increment: amountCents } },
        }),
        prisma.walletTransaction.create({
          data: {
            walletId: customerWalletId,
            transactionType: "DEBIT",
            paymentMethod: "CASH_OUT",
            amount: amountCents,
            feeAmount: 0,
            netAmount: amountCents,
            balanceBefore: customerWallet.balance,
            balanceAfter: BigInt(Number(customerWallet.balance) - amountCents),
            status: "COMPLETED",
            description: `Cash withdrawal via agent ${agent.agentCode}`,
            counterpartyWalletId: agent.floatWallet.id,
            idempotencyKey: debitIdempotencyKey,
          },
        }),
        prisma.walletTransaction.create({
          data: {
            walletId: agent.floatWallet.id,
            transactionType: "CREDIT",
            paymentMethod: "CASH_OUT",
            amount: amountCents,
            feeAmount: 0,
            netAmount: amountCents,
            balanceBefore: agent.floatWallet.balance,
            balanceAfter: BigInt(
              Number(agent.floatWallet.balance) + amountCents,
            ),
            status: "COMPLETED",
            description: `Cash-out from customer ${customerWalletId.slice(0, 8)}`,
            counterpartyWalletId: customerWalletId,
            idempotencyKey: creditIdempotencyKey,
          },
        }),
      ]);

      res.status(201).json(
        createSuccessResponse(
          {
            transactionId: debitTxn.id,
            creditTransactionId: creditTxn.id,
            amountCents,
            commissionCents,
            agentCode: agent.agentCode,
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─────────────────────────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────────────────────────

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  console.error("[agent-service] Unhandled error:", err);
  const generic = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(generic));
});

// ─────────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Agent Service listening on port ${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
  });
}

export default app;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      userId?: string;
      agentId?: string;
    }
  }
}
