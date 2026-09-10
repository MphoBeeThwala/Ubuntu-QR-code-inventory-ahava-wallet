import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";
import { sendSms, txSentMessage, txReceivedMessage } from "./sms";
import { writeAuditLog } from "@ahava/shared-audit";
import {
  decryptPII,
  fetchPIIEncryptionKey,
  parseBearerToken,
  verifyJWT,
} from "@ahava/shared-crypto";
import { metricsMiddleware, metricsEndpoint } from "@ahava/shared-observability";
import { z } from "zod";

// Type-shape validation layered in front of, not instead of, the existing
// business-rule checks (required-field presence, balance sufficiency,
// etc.) — see the identical helper in payment-service/src/main.ts for why.
function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  requestId?: string,
): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AhavaError(
      AhavaErrorCode.VAL_INVALID_INPUT,
      issue
        ? `${issue.path.join(".") || "body"}: ${issue.message}`
        : "Invalid request body",
      { requestId },
    );
  }
  return result.data;
}

const qrPayBodySchema = z.object({
  senderWalletId: z.string().min(1).optional(),
  amountCents: z.coerce.number().optional(),
  idempotencyKey: z.string().min(1).optional(),
});

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6002;

const redisConnection = getRedisConnectionConfig();

// /wallets/:walletId/suspend and /freeze had NO authorization check at
// all — any request carrying any valid customer JWT (issued to any regular
// registered user, e.g. one they got by registering their own account)
// could freeze or suspend ANY OTHER user's wallet by guessing/observing a
// walletId, since these routes are reachable through api-gateway's generic
// `/wallets/*` proxying with no additional restriction. aml-service's own
// auto-suspend logic (services/aml-service/src/main.ts) never calls this
// HTTP endpoint at all — it writes prisma.wallet.update() directly against
// the shared database — so nothing legitimate currently depends on these
// being reachable by ordinary users.
//
// This requires an agent-role token (the same role claim agent-service
// issues for cash-in/cash-out) as a minimum bar until a dedicated
// compliance/admin role exists — agents aren't really the right owner of
// this action either, but it closes the "any random customer" attack
// surface immediately using auth infrastructure that already exists,
// rather than leaving it wide open while a proper role is designed.
async function requireAgentRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_UNAUTHORIZED,
      "Authorization header missing or malformed",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
    return;
  }

  try {
    const payload = await verifyJWT(token);
    if (payload.role !== "AGENT") {
      throw new Error("insufficient role");
    }
    next();
  } catch {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_UNAUTHORIZED,
      "This action requires an authorized agent account",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
  }
}

// Same problem as suspend/freeze, but across nearly every other route in
// this file: wallet detail, balance, transaction history, QR generation,
// and — most seriously — QR payment all trusted whatever walletId/
// senderWalletId the request body or URL contained, with no check that the
// caller actually owns it. That's not just an information leak on the
// read routes (any authenticated customer could read any other customer's
// balance and transaction history); on POST /qr/:qrHash/pay it meant any
// authenticated customer could drain funds from ANY OTHER wallet just by
// supplying its id as senderWalletId — a direct theft vector, not merely
// disclosure. payment-service/src/main.ts's POST /payments had the
// identical gap for peer-to-peer transfers; fixed there too.
//
// requireAuth verifies the JWT (same as requireAgentRole) but accepts any
// valid token, populating req.userId/req.role for handlers to check
// against a resource's actual owner via assertOwnerOrAgent below. AGENT
// tokens bypass ownership checks — agents legitimately act on customers'
// wallets during cash-in/cash-out and in-person QR assistance.
async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_UNAUTHORIZED,
      "Authorization header missing or malformed",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
    return;
  }

  try {
    const payload = await verifyJWT(token);
    req.userId = (payload.userId ?? payload.sub) as string | undefined;
    req.role = payload.role as string | undefined;
    if (!req.userId) {
      throw new Error("token has no subject");
    }
    next();
  } catch {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_INVALID_TOKEN,
      "Invalid or expired access token",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
  }
}

/** Throws (caught by the route's own try/catch, same as every other
 * AhavaError in this file) unless the caller is an AGENT or the resource's
 * actual owner. Call after fetching the resource — req.userId is only
 * meaningful once requireAuth has run for this request. */
function assertOwnerOrAgent(req: Request, resourceUserId: string): void {
  if (req.role === "AGENT") return;
  if (req.userId && req.userId === resourceUserId) return;
  throw new AhavaError(
    AhavaErrorCode.AUTH_UNAUTHORIZED,
    "You do not have access to this resource",
    { requestId: req.id },
  );
}

/** Generate wallet number: AHV-XXXX-XXXX-XXXX */
function generateWalletNumber(): string {
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AHV-${seg()}-${seg()}-${seg()}`;
}

function compactIdempotencyKey(prefix: string, key: string): string {
  return crypto
    .createHash("sha256")
    .update(`${prefix}:${key}`)
    .digest("hex")
    .slice(0, 36);
}

// Mirrors services/ledger-service's CHART_OF_ACCOUNTS — see the same
// constant in payment-service/src/main.ts for why it's duplicated rather
// than shared, and why both wallets in a QR payment use this one code.
const LEDGER_ACCOUNT_CUSTOMER_WALLETS = "1100";

type LockedWalletRow = {
  id: string;
  userId: string;
  isDeleted: boolean;
  status: string;
  balance: bigint;
  walletNumber: string;
};

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
  const incoming = req.get("X-Request-ID");
  const requestId =
    typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});
app.use(metricsMiddleware("wallet-service"));

// Health check
app.get("/health", (req, res) => {
  res.json(
    createSuccessResponse({ status: "ok", service: "wallet-service" }, req.id),
  );
});

app.get("/metrics", metricsEndpoint);

// POST /wallets - Create a new wallet for a user
app.post(
  "/wallets",
  requireAuth,
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

      assertOwnerOrAgent(req, userId);

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

      await writeAuditLog(prisma, {
        userId,
        action: "WALLET_CREATED",
        entityType: "Wallet",
        entityId: wallet.id,
        newState: JSON.stringify({
          walletNumber: wallet.walletNumber,
          walletType: wallet.walletType,
        }),
        serviceId: "wallet-service",
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
          createSuccessResponse(
            { wallet: serializeWallet(wallet as any) },
            req.id,
          ),
        );
    } catch (error) {
      next(error);
    }
  },
);

// GET /wallets/lookup?walletNumber=AHV-xxxx-xxxx  (MUST be before /:walletId)
// Intentionally cross-user: this is how a sender resolves a recipient's
// wallet before paying them (see apps/mobile's payment flow), so it stays
// open to any authenticated caller rather than owner-only. It must NOT
// return the recipient's balance, though — a sender has no legitimate
// reason to see a stranger's balance just from looking up their wallet
// number, and the response used to include it.
app.get(
  "/wallets/lookup",
  requireAuth,
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
        createSuccessResponse(
          {
            wallet: {
              id: wallet.id,
              walletNumber: wallet.walletNumber,
              holderName: wallet.user?.fullName ?? wallet.walletNumber,
              status: wallet.status,
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

// GET /wallets/:walletId - Get wallet details
// serializeWallet returns the full row (balance, limits, spend totals) —
// owner or agent only, unlike /wallets/lookup above.
app.get(
  "/wallets/:walletId",
  requireAuth,
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

      assertOwnerOrAgent(req, wallet.userId);

      res.json(
        createSuccessResponse(
          { wallet: serializeWallet(wallet as any) },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /wallets/:walletId/transactions - Get transaction history
app.get(
  "/wallets/:walletId/transactions",
  requireAuth,
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

      assertOwnerOrAgent(req, wallet.userId);

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
        createSuccessResponse(
          {
            transactions: transactions.map((t: any) => ({
              ...t,
              amount: t.amount?.toString(),
              feeAmount: t.feeAmount?.toString(),
              netAmount: t.netAmount?.toString(),
              balanceBefore: t.balanceBefore?.toString(),
              balanceAfter: t.balanceAfter?.toString(),
            })),
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST /wallets/:walletId/limits - Update wallet limits (KYC tier change)
// Orphaned from any legitimate internal caller today (kyc-service applies
// tier-driven limit changes via a direct prisma.wallet.updateMany() call,
// not this HTTP endpoint) but state-mutating and previously wide open — a
// customer could raise their own spending limits past their KYC tier, or
// tamper with someone else's. Same agent-role bar as suspend/freeze.
app.post(
  "/wallets/:walletId/limits",
  requireAgentRole,
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

      await writeAuditLog(prisma, {
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
      });

      res.json(
        createSuccessResponse(
          { wallet: serializeWallet(updated as any) },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /wallets/:walletId/balance - Get balance (read-only)
app.get(
  "/wallets/:walletId/balance",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletId } = req.params;

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
        select: {
          id: true,
          userId: true,
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

      assertOwnerOrAgent(req, wallet.userId);

      const available =
        Number(wallet.balance) -
        Number(wallet.pendingBalance) -
        Number(wallet.reservedBalance);

      res.json(
        createSuccessResponse(
          {
            balance: {
              available: Math.max(0, available).toString(),
              pending: wallet.pendingBalance.toString(),
              reserved: wallet.reservedBalance.toString(),
              total: wallet.balance.toString(),
              currency: wallet.currency,
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

// POST /wallets/:walletId/suspend - Suspend wallet (for AML)
app.post(
  "/wallets/:walletId/suspend",
  requireAgentRole,
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

      await writeAuditLog(prisma, {
        userId: wallet.userId,
        action: "WALLET_SUSPENDED",
        entityType: "Wallet",
        entityId: walletId,
        newState: JSON.stringify({ reason }),
        serviceId: "wallet-service",
      });

      res.json(
        createSuccessResponse(
          { wallet: serializeWallet(wallet as any) },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST /wallets/:walletId/freeze - Freeze wallet (regulatory)
app.post(
  "/wallets/:walletId/freeze",
  requireAgentRole,
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
        createSuccessResponse(
          { wallet: serializeWallet(wallet as any) },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─────────────────────────────────────────────────────────────────
// QR CODE ROUTES
// ─────────────────────────────────────────────────────────────────

// POST /wallets/:walletId/qr — generate a static or dynamic QR code
app.post(
  "/wallets/:walletId/qr",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletId } = req.params;
      const {
        qrType = "STATIC",
        amountCents,
        description,
        ttlMinutes = 10,
      } = req.body;

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId, isDeleted: false },
        select: { id: true, userId: true, walletNumber: true, status: true },
      });

      if (!wallet) {
        throw new AhavaError(AhavaErrorCode.WAL_NOT_FOUND, "Wallet not found", {
          requestId: req.id,
        });
      }

      assertOwnerOrAgent(req, wallet.userId);

      if (wallet.status !== "ACTIVE") {
        throw new AhavaError(
          AhavaErrorCode.WAL_WALLET_SUSPENDED,
          "Wallet is not active",
          { requestId: req.id },
        );
      }

      if (qrType === "DYNAMIC" && (!amountCents || amountCents <= 0)) {
        throw new AhavaError(
          AhavaErrorCode.PAY_INVALID_AMOUNT,
          "amountCents is required and must be positive for DYNAMIC QR",
          { requestId: req.id },
        );
      }

      const payload = JSON.stringify({
        walletId: wallet.id,
        walletNumber: wallet.walletNumber,
        qrType,
        ...(amountCents && { amountCents }),
        ...(description && { description }),
        nonce: uuidv4(),
      });

      const crypto = await import("crypto");
      const qrHash = crypto.createHash("sha256").update(payload).digest("hex");

      const expiresAt =
        qrType === "STATIC"
          ? null
          : new Date(Date.now() + ttlMinutes * 60 * 1000);

      const qr = await prisma.paymentQrCode.create({
        data: {
          walletId: wallet.id,
          qrType,
          qrPayload: payload,
          qrHash,
          amountCents: amountCents ? BigInt(amountCents) : null,
          currency: "ZAR",
          description: description || null,
          expiresAt,
          maxUsage: qrType === "STATIC" ? null : 1,
        },
      });

      res.status(201).json(
        createSuccessResponse(
          {
            qrId: qr.id,
            qrHash: qr.qrHash,
            qrType: qr.qrType,
            qrPayload: qr.qrPayload,
            amountCents: qr.amountCents ? Number(qr.amountCents) : null,
            expiresAt: qr.expiresAt?.toISOString() ?? null,
            deepLink: `ubuntu://pay?qr=${qr.qrHash}`,
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// GET /qr/:qrHash — look up a QR code for display / pre-flight check.
// Intentionally cross-user: the payer looks up a QR someone else
// generated. Already omits the recipient's balance, so requireAuth here is
// about caller identification, not an ownership check.
app.get(
  "/qr/:qrHash",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { qrHash } = req.params;

      const qr = await prisma.paymentQrCode.findFirst({
        where: { qrHash, isActive: true },
        include: {
          wallet: {
            select: {
              walletNumber: true,
              status: true,
              walletType: true,
              user: {
                select: {
                  preferredName: true,
                  fullName: true,
                },
              },
            },
          },
        },
      });

      if (!qr) {
        throw new AhavaError(
          AhavaErrorCode.QR_NOT_FOUND,
          "QR code not found or inactive",
          { requestId: req.id },
        );
      }

      if (qr.expiresAt && qr.expiresAt < new Date()) {
        throw new AhavaError(AhavaErrorCode.QR_EXPIRED, "QR code has expired", {
          requestId: req.id,
        });
      }

      if (qr.maxUsage !== null && qr.usageCount >= qr.maxUsage) {
        throw new AhavaError(
          AhavaErrorCode.QR_MAX_USAGE_REACHED,
          "QR code has already been used",
          { requestId: req.id },
        );
      }

      res.json(
        createSuccessResponse(
          {
            qrId: qr.id,
            qrType: qr.qrType,
            recipientName:
              qr.wallet.user?.preferredName ?? qr.wallet.user?.fullName ?? null,
            walletNumber: qr.wallet.walletNumber,
            walletType: qr.wallet.walletType,
            amountCents: qr.amountCents ? Number(qr.amountCents) : null,
            currency: qr.currency,
            description: qr.description,
            expiresAt: qr.expiresAt?.toISOString() ?? null,
            usageCount: qr.usageCount,
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST /qr/:qrHash/pay — pay via QR code (debit sender, credit QR wallet)
// CRITICAL: senderWalletId used to be trusted straight from the request
// body with no check that the authenticated caller actually owns it — any
// customer could drain funds from ANY wallet just by supplying its id
// here. Fixed below via assertOwnerOrAgent once the sender row is locked
// (it's already fetched for the balance check, so this doesn't add a
// query) — see the ownership-check comment near requireAuth's definition.
app.post(
  "/qr/:qrHash/pay",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { qrHash } = req.params;
      const { senderWalletId, amountCents, idempotencyKey } = validateBody(
        qrPayBodySchema,
        req.body,
        req.id,
      );

      if (!senderWalletId || !amountCents || !idempotencyKey) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "senderWalletId, amountCents, and idempotencyKey are required",
          { requestId: req.id },
        );
      }

      if (amountCents <= 0) {
        throw new AhavaError(
          AhavaErrorCode.PAY_INVALID_AMOUNT,
          "amountCents must be positive",
          { requestId: req.id },
        );
      }

      const qr = await prisma.paymentQrCode.findFirst({
        where: { qrHash, isActive: true },
        include: {
          wallet: true,
        },
      });

      if (!qr) {
        throw new AhavaError(
          AhavaErrorCode.QR_NOT_FOUND,
          "QR code not found or inactive",
          { requestId: req.id },
        );
      }

      if (qr.expiresAt && qr.expiresAt < new Date()) {
        throw new AhavaError(AhavaErrorCode.QR_EXPIRED, "QR code has expired", {
          requestId: req.id,
        });
      }

      if (qr.maxUsage !== null && qr.usageCount >= qr.maxUsage) {
        throw new AhavaError(
          AhavaErrorCode.QR_MAX_USAGE_REACHED,
          "QR code has already been used",
          { requestId: req.id },
        );
      }

      // For dynamic QR, enforce locked amount
      const payAmount =
        qr.qrType === "DYNAMIC" && qr.amountCents
          ? Number(qr.amountCents)
          : amountCents;

      if (qr.qrType === "DYNAMIC" && qr.amountCents) {
        if (amountCents !== Number(qr.amountCents)) {
          throw new AhavaError(
            AhavaErrorCode.PAY_INVALID_AMOUNT,
            `Dynamic QR requires exact amount of ${Number(qr.amountCents)} cents`,
            { requestId: req.id },
          );
        }
      }

      if (senderWalletId === qr.walletId) {
        throw new AhavaError(
          AhavaErrorCode.PAY_SELF_TRANSFER,
          "Cannot pay yourself",
          { requestId: req.id },
        );
      }

      const debitIdempotencyKey = compactIdempotencyKey(
        "qr-debit",
        idempotencyKey,
      );
      const creditIdempotencyKey = compactIdempotencyKey(
        "qr-credit",
        idempotencyKey,
      );
      const payAmountBig = BigInt(payAmount);

      // ───────────────────────────────────────────────────────────────
      // Previously: balance/status were checked with a plain findUnique
      // BEFORE this point, then the wallet updates + transaction rows ran
      // in a bare array-form $transaction with no row locking and no
      // re-check inside it. Two concurrent scans of the same QR code
      // could both pass the outside-the-lock balance check and both
      // debit, driving the sender's balance negative — and, separately,
      // a single-use QR's usageCount/maxUsage check was read outside any
      // lock too, so it could be paid twice concurrently before either
      // request's increment landed. Both are fixed by moving every check
      // and every write inside one FOR UPDATE-locked transaction.
      // ───────────────────────────────────────────────────────────────
      const result = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const [firstId, secondId] =
            senderWalletId < qr.walletId
              ? [senderWalletId, qr.walletId]
              : [qr.walletId, senderWalletId];

          const lockedWallets = await tx.$queryRaw<LockedWalletRow[]>`
            SELECT id, "userId" AS "userId", "isDeleted" AS "isDeleted", status, balance, "walletNumber" AS "walletNumber"
            FROM wallets
            WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
            ORDER BY id
            FOR UPDATE
          `;

          const senderWallet = lockedWallets.find((w) => w.id === senderWalletId);
          const receiverWallet = lockedWallets.find((w) => w.id === qr.walletId);

          if (!senderWallet || senderWallet.isDeleted) {
            throw new AhavaError(
              AhavaErrorCode.WAL_NOT_FOUND,
              "Sender wallet not found",
              { requestId: req.id },
            );
          }
          assertOwnerOrAgent(req, senderWallet.userId);
          if (!receiverWallet) {
            throw new AhavaError(
              AhavaErrorCode.WAL_NOT_FOUND,
              "Receiver wallet not found",
              { requestId: req.id },
            );
          }
          if (senderWallet.status === "SUSPENDED") {
            throw new AhavaError(
              AhavaErrorCode.WAL_WALLET_SUSPENDED,
              "Sender wallet is suspended",
              { requestId: req.id },
            );
          }
          if (senderWallet.status === "FROZEN") {
            throw new AhavaError(
              AhavaErrorCode.WAL_WALLET_FROZEN,
              "Sender wallet is frozen",
              { requestId: req.id },
            );
          }
          if (senderWallet.balance < payAmountBig) {
            throw new AhavaError(
              AhavaErrorCode.WAL_INSUFFICIENT_BALANCE,
              "Insufficient balance",
              { requestId: req.id },
            );
          }

          // Re-check single-use/expiry inside the lock: a second concurrent
          // request that reached here after the first committed will see
          // the updated row and correctly reject.
          const lockedQr = await tx.$queryRaw<
            { usageCount: number; maxUsage: number | null; isActive: boolean; expiresAt: Date | null }[]
          >`SELECT "usageCount" AS "usageCount", "maxUsage" AS "maxUsage", "isActive" AS "isActive", "expiresAt" AS "expiresAt" FROM payment_qr_codes WHERE id = ${qr.id}::uuid FOR UPDATE`;
          const qrRow = lockedQr[0];
          if (!qrRow || !qrRow.isActive) {
            throw new AhavaError(AhavaErrorCode.QR_NOT_FOUND, "QR code not found or inactive", { requestId: req.id });
          }
          if (qrRow.expiresAt && qrRow.expiresAt < new Date()) {
            throw new AhavaError(AhavaErrorCode.QR_EXPIRED, "QR code has expired", { requestId: req.id });
          }
          if (qrRow.maxUsage !== null && qrRow.usageCount >= qrRow.maxUsage) {
            throw new AhavaError(AhavaErrorCode.QR_MAX_USAGE_REACHED, "QR code has already been used", { requestId: req.id });
          }

          const senderBalanceAfter = senderWallet.balance - payAmountBig;
          const receiverBalanceAfter = receiverWallet.balance + payAmountBig;

          const debitTxn = await tx.walletTransaction.create({
            data: {
              walletId: senderWalletId,
              transactionType: "DEBIT",
              paymentMethod: "UBUNTUPAY_WALLET",
              amount: payAmountBig,
              feeAmount: 0,
              netAmount: payAmountBig,
              balanceBefore: senderWallet.balance,
              balanceAfter: senderBalanceAfter,
              status: "COMPLETED",
              description:
                qr.description || `QR payment to ${receiverWallet.walletNumber}`,
              counterpartyWalletId: qr.walletId,
              paymentQrId: qr.id,
              idempotencyKey: debitIdempotencyKey,
            },
          });
          const creditTxn = await tx.walletTransaction.create({
            data: {
              walletId: qr.walletId,
              transactionType: "CREDIT",
              paymentMethod: "UBUNTUPAY_WALLET",
              amount: payAmountBig,
              feeAmount: 0,
              netAmount: payAmountBig,
              balanceBefore: receiverWallet.balance,
              balanceAfter: receiverBalanceAfter,
              status: "COMPLETED",
              description: qr.description || `QR payment received`,
              counterpartyWalletId: senderWalletId,
              paymentQrId: qr.id,
              idempotencyKey: creditIdempotencyKey,
            },
          });

          await tx.wallet.update({
            where: { id: senderWalletId },
            data: { balance: { decrement: payAmountBig } },
          });
          await tx.wallet.update({
            where: { id: qr.walletId },
            data: { balance: { increment: payAmountBig } },
          });
          await tx.paymentQrCode.update({
            where: { id: qr.id },
            data: {
              usageCount: { increment: 1 },
              usedAt: new Date(),
              isActive: qr.maxUsage === 1 ? false : true,
            },
          });

          // Ledger: same rationale as payment-service's /payments route —
          // every balance movement gets a matching debit/credit pair.
          await tx.ledgerEntry.create({
            data: {
              transactionId: debitTxn.id,
              walletId: senderWalletId,
              userId: senderWallet.userId,
              entryType: "DEBIT",
              accountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
              amountCents: payAmountBig,
              description: qr.description || "QR payment",
              reference: idempotencyKey,
              counterpartyWalletId: qr.walletId,
              counterpartyAccountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              transactionId: debitTxn.id,
              walletId: qr.walletId,
              userId: receiverWallet.userId,
              entryType: "CREDIT",
              accountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
              amountCents: payAmountBig,
              description: qr.description || "QR payment",
              reference: idempotencyKey,
              counterpartyWalletId: senderWalletId,
              counterpartyAccountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
            },
          });

          return { debitTxn, creditTxn, senderWallet, receiverWallet };
        },
        { timeout: 10_000 },
      );

      const { debitTxn, senderWallet, receiverWallet } = result;

      res.status(201).json(
        createSuccessResponse(
          {
            transactionId: debitTxn.id,
            amountCents: payAmount,
            receiverWalletNumber: receiverWallet.walletNumber,
            qrType: qr.qrType,
          },
          req.id,
        ),
      );

      // Fire-and-forget SMS notifications — never blocks the response
      const newSenderBalance = Number(senderWallet.balance) - payAmount;
      const newReceiverBalance = Number(receiverWallet.balance) + payAmount;

      const [senderUser, receiverUser] = await Promise.all([
        prisma.user.findUnique({
          where: { id: senderWallet.userId },
          select: { phoneNumber: true },
        }),
        prisma.user.findUnique({
          where: { id: receiverWallet.userId },
          select: { phoneNumber: true },
        }),
      ]);

      // phoneNumber is stored via @ahava/shared-crypto's encryptPII, which
      // produces "<ivHex>:<authTagHex>:<cipherHex>" — not base64. The
      // previous `Buffer.from(phoneNumber, "base64")` decoded neither an
      // encrypted nor a plaintext number correctly and silently sent SMS
      // to garbage numbers. decryptPII understands the real format; the
      // ":" check keeps this working for any still-plaintext legacy rows.
      const decryptPhone = async (raw: string): Promise<string> => {
        if (!raw.includes(":")) return raw;
        try {
          return decryptPII(raw, await fetchPIIEncryptionKey());
        } catch {
          return raw;
        }
      };

      if (senderUser) {
        const senderPhone = await decryptPhone(senderUser.phoneNumber);
        void sendSms(
          senderPhone,
          txSentMessage(
            payAmount,
            receiverWallet.walletNumber,
            newSenderBalance,
          ),
        );
      }
      if (receiverUser) {
        const receiverPhone = await decryptPhone(receiverUser.phoneNumber);
        void sendSms(
          receiverPhone,
          txReceivedMessage(
            payAmount,
            senderWallet.walletNumber,
            newReceiverBalance,
          ),
        );
      }
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
      userId?: string;
      role?: string;
    }
  }
}
