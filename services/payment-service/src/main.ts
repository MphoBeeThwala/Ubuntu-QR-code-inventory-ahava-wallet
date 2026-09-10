import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";
import { writeAuditLog } from "@ahava/shared-audit";
import { parseBearerToken, verifyJWT } from "@ahava/shared-crypto";
import { z } from "zod";
import { metricsMiddleware, metricsEndpoint } from "@ahava/shared-observability";

// Type-shape validation layered in FRONT OF, not instead of, the existing
// business-rule checks below (required-field presence, wallet existence,
// balance sufficiency, etc. all stay exactly as they were — this only
// rejects a field that's PRESENT but the wrong type before it reaches
// code that assumes a string/number, e.g. a Prisma query built from
// senderWalletId, or amount arithmetic on a non-numeric amountCents).
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

// senderWalletId (POST /payments) and walletId (POST /payments/qr) used to
// be trusted straight from the request body with no check that the
// authenticated caller actually owns them — any customer could move money
// out of, or generate a receiving QR against, ANY OTHER wallet just by
// supplying its id. requireAuth verifies the caller's JWT (the same
// pattern used for services/wallet-service's identical fix) and populates
// req.userId/req.role; assertOwnerOrAgent is checked once the relevant
// wallet's actual owner is known. AGENT tokens bypass this — agents
// legitimately act on customers' wallets during cash-in/cash-out.
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

/** Throws (caught by the route's own try/catch) unless the caller is an
 * AGENT or the resource's actual owner. Call only once the resource's
 * owner is known — req.userId is only meaningful once requireAuth ran. */
function assertOwnerOrAgent(req: Request, resourceUserId: string): void {
  if (req.role === "AGENT") return;
  if (req.userId && req.userId === resourceUserId) return;
  throw new AhavaError(
    AhavaErrorCode.AUTH_UNAUTHORIZED,
    "You do not have access to this resource",
    { requestId: req.id },
  );
}

const paymentsBodySchema = z.object({
  senderWalletId: z.string().min(1).optional(),
  receiverWalletId: z.string().min(1).optional(),
  receiverWalletNumber: z.string().min(1).optional(),
  recipientPhone: z.string().min(1).optional(),
  amountCents: z.coerce.number().optional(),
  description: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1).max(36).optional(),
  paymentMethod: z
    .enum(["UBUNTUPAY_WALLET", "PAYSHAP", "CASH_IN", "CASH_OUT"])
    .optional(),
  deviceId: z.string().optional(),
  ipAddress: z.string().optional(),
});

const paymentsQrBodySchema = z.object({
  walletId: z.string().min(1).optional(),
  qrType: z.enum(["STATIC", "DYNAMIC", "REQUEST"]).optional(),
  amountCents: z.coerce.number().optional(),
  description: z.string().max(200).optional(),
  ttlSeconds: z.number().optional(),
});

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6003;

const redisConnection = getRedisConnectionConfig();

const paymentCreatedQueue = new Queue(QUEUE_NAMES.PAYMENTS_CREATED, {
  connection: redisConnection,
});

// Synchronous, blocking sanctions check — calls aml-service's
// screenSanctions BEFORE any balance moves. This is distinct from the
// PAYMENTS_CREATED queue below, which triggers async risk-scoring AFTER a
// payment has already committed; sanctions screening specifically cannot
// happen after the fact.
//
// Reads process.env fresh on every call (rather than caching into a
// module-level constant) so tests can toggle SANCTIONS_SCREENING_ENABLED
// per-suite regardless of when the env var is set relative to module load.
async function screenSanctionsBlocking(params: {
  senderUserId: string;
  recipientUserId: string;
  correlationId: string;
}): Promise<void> {
  if (process.env.SANCTIONS_SCREENING_ENABLED === "false") return;
  const amlServiceUrl =
    process.env.AML_SERVICE_URL || "http://localhost:6007";

  // Named fetchResponse, not response: Express's own Response type is
  // already imported into this file's scope and would otherwise shadow
  // the global fetch Response type here.
  let fetchResponse: Awaited<ReturnType<typeof fetch>>;
  try {
    fetchResponse = await fetch(`${amlServiceUrl}/aml/screen-sanctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, blockOnMatch: true }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new AhavaError(
      AhavaErrorCode.EXT_COMPLY_ADVANTAGE_ERROR,
      "Sanctions screening is unavailable — payment cannot be processed",
      { requestId: params.correlationId },
    );
  }

  if (fetchResponse.status === 403) {
    // aml-service found a match and already raised the AML flag.
    throw new AhavaError(
      AhavaErrorCode.AML_SANCTIONS_MATCH,
      "Transaction cannot be processed at this time",
      { requestId: params.correlationId },
    );
  }

  if (!fetchResponse.ok) {
    throw new AhavaError(
      AhavaErrorCode.EXT_COMPLY_ADVANTAGE_ERROR,
      "Sanctions screening is unavailable — payment cannot be processed",
      { requestId: params.correlationId },
    );
  }
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
app.use(metricsMiddleware("payment-service"));

app.get("/health", (req, res) => {
  res.json(
    createSuccessResponse({ status: "ok", service: "payment-service" }, req.id),
  );
});

app.get("/metrics", metricsEndpoint);

// POST /payments/qr - Generate a payment QR code (static or dynamic)
app.post(
  "/payments/qr",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        walletId,
        qrType = "DYNAMIC",
        amountCents,
        description,
        ttlSeconds = 600, // 10 min default for dynamic
      } = validateBody(paymentsQrBodySchema, req.body, req.id);

      if (!walletId) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "walletId is required",
          { requestId: req.id },
        );
      }

      if (qrType === "DYNAMIC" && (amountCents == null || amountCents <= 0)) {
        throw new AhavaError(
          AhavaErrorCode.PAY_INVALID_AMOUNT,
          "amountCents must be a positive integer for DYNAMIC QR",
          { requestId: req.id },
        );
      }

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
        select: {
          id: true,
          userId: true,
          walletNumber: true,
          status: true,
          isDeleted: true,
        },
      });

      if (!wallet || wallet.isDeleted) {
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

      const expiresAt =
        qrType === "DYNAMIC" ? new Date(Date.now() + ttlSeconds * 1000) : null;

      const payload = JSON.stringify({
        walletId,
        walletNumber: wallet.walletNumber,
        qrType,
        amountCents: amountCents ?? null,
        currency: "ZAR",
        description: description ?? null,
        nonce: uuidv4(),
        issuedAt: new Date().toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
      });

      const qrHash = createHash("sha256").update(payload).digest("hex");

      const qrCode = await prisma.paymentQrCode.create({
        data: {
          walletId,
          qrType,
          qrPayload: payload,
          qrHash,
          amountCents: amountCents ? BigInt(amountCents) : null,
          description,
          expiresAt,
          maxUsage: qrType === "DYNAMIC" ? 1 : null,
        },
      });

      return res.status(201).json(
        createSuccessResponse(
          {
            qrCode: {
              id: qrCode.id,
              qrType: qrCode.qrType,
              qrPayload: qrCode.qrPayload,
              qrHash: qrCode.qrHash,
              amountCents: qrCode.amountCents?.toString() ?? null,
              expiresAt: qrCode.expiresAt,
              isActive: qrCode.isActive,
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

type WalletRow = {
  id: string;
  userId: string;
  isDeleted: boolean;
  status: string;
  balance: bigint;
  walletNumber: string;
};

// Mirrors services/ledger-service's CHART_OF_ACCOUNTS. Duplicated here
// rather than imported because these are separately deployed services with
// no shared "chart of accounts" package yet — extracting one is a good
// follow-up once more than two services need it.
const LEDGER_ACCOUNT_CUSTOMER_WALLETS = "1100";

// BigInt-safe: 0.5% of the transfer, minimum 25 cents. Was previously
// `Math.floor(amountCents * 0.005)` on a plain `number`, which is exact for
// small values but loses precision as amounts grow — BigInt basis-point
// math has no such ceiling.
function calculateTransferFee(amountCents: bigint): bigint {
  const feeBps = (amountCents * 50n) / 10000n; // 50 bps = 0.5%
  return feeBps > 25n ? feeBps : 25n;
}

// amount/feeAmount/netAmount/balanceBefore/balanceAfter are BigInt columns;
// res.json() throws on a raw BigInt, so every WalletTransaction returned to
// a client must go through this first. Guards each field individually
// (rather than assuming all five are always present as bigint) since not
// every caller selects every column.
function serializeWalletTxn<T extends Record<string, unknown>>(t: T) {
  const out: Record<string, unknown> = { ...t };
  for (const key of [
    "amount",
    "feeAmount",
    "netAmount",
    "balanceBefore",
    "balanceAfter",
  ]) {
    if (typeof out[key] === "bigint") out[key] = (out[key] as bigint).toString();
  }
  return out;
}

// POST /payments - Create payment transaction (atomic double-entry)
app.post(
  "/payments",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        senderWalletId,
        receiverWalletId,
        receiverWalletNumber,
        recipientPhone,
        amountCents,
        description,
        idempotencyKey,
        paymentMethod,
        deviceId,
        ipAddress,
      } = validateBody(paymentsBodySchema, req.body, req.id);

      if (!senderWalletId || amountCents == null || !idempotencyKey) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing required fields: senderWalletId, recipient, amountCents, idempotencyKey",
          { requestId: req.id },
        );
      }

      // CRITICAL: senderWalletId used to be trusted straight from the
      // request body with no check that the authenticated caller actually
      // owned it — any customer could drain funds from ANY wallet just by
      // supplying its id here. Deliberately its own dedicated lookup,
      // first thing after the presence check, rather than piggybacked on
      // the sanctions-screening wallet lookup further down (which isn't
      // guaranteed to run before it, and a later refactor of screening
      // could silently carry the ownership check away with it). A missing
      // wallet here is left to the FOR UPDATE-locked transaction below,
      // which independently re-verifies existence and is the actual
      // source of truth for "does this wallet exist" — this check only
      // narrows down to "if it exists, do you own it".
      const senderWalletForAuth = await prisma.wallet.findUnique({
        where: { id: senderWalletId },
        select: { userId: true },
      });
      if (senderWalletForAuth) {
        assertOwnerOrAgent(req, senderWalletForAuth.userId);
      }

      if (!receiverWalletId && !receiverWalletNumber && !recipientPhone) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Provide receiverWalletId, receiverWalletNumber, or recipientPhone",
          { requestId: req.id },
        );
      }

      let resolvedReceiverWalletId = receiverWalletId as string | undefined;
      if (!resolvedReceiverWalletId && receiverWalletNumber) {
        const foundWallet = await prisma.wallet.findFirst({
          where: { walletNumber: receiverWalletNumber, isDeleted: false },
          select: { id: true },
        });
        resolvedReceiverWalletId = foundWallet?.id;
      }

      if (!resolvedReceiverWalletId && recipientPhone) {
        const phoneNumberHash = createHash("sha256")
          .update(String(recipientPhone).trim().toLowerCase())
          .digest("hex");
        const foundUser = await prisma.user.findUnique({
          where: { phoneNumberHash },
          select: { id: true },
        });
        if (foundUser) {
          const foundWallet = await prisma.wallet.findFirst({
            where: {
              userId: foundUser.id,
              status: "ACTIVE",
              isDeleted: false,
            },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          resolvedReceiverWalletId = foundWallet?.id;
        }
      }

      if (!resolvedReceiverWalletId) {
        throw new AhavaError(
          AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND,
          "Receiver wallet not found",
          { requestId: req.id },
        );
      }
      const receiverWalletIdFinal = resolvedReceiverWalletId;

      if (isNaN(amountCents) || amountCents <= 0) {
        throw new AhavaError(
          AhavaErrorCode.PAY_INVALID_AMOUNT,
          "amountCents must be a positive integer",
          { requestId: req.id },
        );
      }

      // Idempotency check BEFORE opening transaction (read-only)
      const existingTxn = await prisma.walletTransaction.findUnique({
        where: { idempotencyKey },
      });

      if (existingTxn) {
        if (existingTxn.status === "COMPLETED") {
          return res.json(
            createSuccessResponse(
              { transaction: serializeWalletTxn(existingTxn) },
              req.id,
            ),
          );
        }
        throw new AhavaError(
          AhavaErrorCode.PAY_DUPLICATE_IDEMPOTENCY_KEY,
          "Idempotency key already used",
          { requestId: req.id },
        );
      }

      // ─────────────────────────────────────────────────────────────
      // PRE-TRANSACTION: blocking sanctions screening. Must happen before
      // any balance moves — see screenSanctionsBlocking's own comment for
      // why this is separate from the post-commit AML queue below.
      // ─────────────────────────────────────────────────────────────
      const screeningWallets = await prisma.wallet.findMany({
        where: { id: { in: [senderWalletId, receiverWalletIdFinal] } },
        select: { id: true, userId: true },
      });
      const senderForScreening = screeningWallets.find(
        (w) => w.id === senderWalletId,
      );
      const receiverForScreening = screeningWallets.find(
        (w) => w.id === receiverWalletIdFinal,
      );
      if (senderForScreening && receiverForScreening) {
        await screenSanctionsBlocking({
          senderUserId: senderForScreening.userId,
          recipientUserId: receiverForScreening.userId,
          correlationId: idempotencyKey,
        });
      }

      // ─────────────────────────────────────────────────────────────
      // ATOMIC TRANSACTION: all reads-with-lock + all writes in one unit
      // ─────────────────────────────────────────────────────────────
      const result = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Acquire row locks in deterministic UUID order to prevent deadlocks
          // when two concurrent payments involve the same pair of wallets.
          const [firstId, secondId] =
            senderWalletId < receiverWalletIdFinal
              ? [senderWalletId, receiverWalletIdFinal]
              : [receiverWalletIdFinal, senderWalletId];

          const lockedWallets = await tx.$queryRaw<WalletRow[]>`
        SELECT id, "userId" AS "userId", "isDeleted" AS "isDeleted", status, balance, "walletNumber" AS "walletNumber"
        FROM wallets
        WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
        ORDER BY id
        FOR UPDATE
      `;

          const senderWallet = lockedWallets.find(
            (w: WalletRow) => w.id === senderWalletId,
          );
          const receiverWallet = lockedWallets.find(
            (w: WalletRow) => w.id === receiverWalletIdFinal,
          );

          if (!senderWallet || senderWallet.isDeleted) {
            throw new AhavaError(
              AhavaErrorCode.WAL_NOT_FOUND,
              "Sender wallet not found or deleted",
              { requestId: req.id },
            );
          }
          if (!receiverWallet || receiverWallet.isDeleted) {
            throw new AhavaError(
              AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND,
              "Receiver wallet not found or deleted",
              { requestId: req.id },
            );
          }

          if (senderWallet.status !== "ACTIVE") {
            throw new AhavaError(
              AhavaErrorCode.WAL_WALLET_SUSPENDED,
              "Sender wallet is not active",
              { requestId: req.id },
            );
          }

          if (receiverWallet.status !== "ACTIVE") {
            throw new AhavaError(
              AhavaErrorCode.WAL_WALLET_SUSPENDED,
              "Receiver wallet is not active",
              { requestId: req.id },
            );
          }

          const amountCentsBig = BigInt(amountCents);
          const feeAmount = calculateTransferFee(amountCentsBig);
          const totalDebitCents = amountCentsBig + feeAmount;
          const senderBalanceAfter = senderWallet.balance - totalDebitCents;
          const receiverBalanceAfter = receiverWallet.balance + amountCentsBig;

          if (senderWallet.balance < totalDebitCents) {
            throw new AhavaError(
              AhavaErrorCode.WAL_INSUFFICIENT_BALANCE,
              "Insufficient funds",
              { requestId: req.id },
            );
          }

          const debitTxn = await tx.walletTransaction.create({
            data: {
              walletId: senderWalletId,
              transactionType: "DEBIT",
              status: "COMPLETED",
              paymentMethod: paymentMethod || "UBUNTUPAY_WALLET",
              amount: amountCentsBig,
              feeAmount,
              netAmount: amountCentsBig,
              balanceBefore: senderWallet.balance,
              balanceAfter: senderBalanceAfter,
              counterpartyWalletId: receiverWalletIdFinal,
              description,
              idempotencyKey,
              deviceId,
              ipAddress,
            },
          });

          const creditIdempotencyKey = `credit-${idempotencyKey}`;
          const creditTxn = await tx.walletTransaction.create({
            data: {
              walletId: receiverWalletIdFinal,
              transactionType: "CREDIT",
              status: "COMPLETED",
              paymentMethod: paymentMethod || "UBUNTUPAY_WALLET",
              amount: amountCentsBig,
              feeAmount: 0,
              netAmount: amountCentsBig,
              balanceBefore: receiverWallet.balance,
              balanceAfter: receiverBalanceAfter,
              counterpartyWalletId: senderWalletId,
              description,
              idempotencyKey: creditIdempotencyKey,
            },
          });

          await tx.wallet.update({
            where: { id: senderWalletId },
            data: { balance: { decrement: totalDebitCents } },
          });
          await tx.wallet.update({
            where: { id: receiverWalletIdFinal },
            data: { balance: { increment: amountCentsBig } },
          });

          // ───────────────────────────────────────────────────────────
          // LEDGER: every balance movement above must have a matching
          // debit/credit pair here. Previously this transaction moved
          // wallet balances directly and never touched ledger_entries at
          // all — the double-entry ledger existed but no live payment
          // ever wrote to it. transactionId groups the whole payment's
          // entries so /ledger/batch-style balance checks (sum of DEBITs
          // == sum of CREDITs) and /ledger/reconcile hold for this one
          // event. Account code 1100 covers every Ubuntu Pay wallet
          // (personal and fee-pool) because /ledger/reconcile currently
          // sums ALL active wallet balances against it — segregating the
          // fee pool onto its own account code is a good follow-up once
          // reconcile is extended to handle more than one account.
          // ───────────────────────────────────────────────────────────
          await tx.ledgerEntry.create({
            data: {
              transactionId: debitTxn.id,
              walletId: senderWalletId,
              userId: senderWallet.userId,
              entryType: "DEBIT",
              accountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
              amountCents: amountCentsBig,
              description: description || "Wallet transfer",
              reference: idempotencyKey,
              counterpartyWalletId: receiverWalletIdFinal,
              counterpartyAccountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              transactionId: debitTxn.id,
              walletId: receiverWalletIdFinal,
              userId: receiverWallet.userId,
              entryType: "CREDIT",
              accountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
              amountCents: amountCentsBig,
              description: description || "Wallet transfer",
              reference: idempotencyKey,
              counterpartyWalletId: senderWalletId,
              counterpartyAccountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
            },
          });

          const feeIdempotencyKey = `fee-${idempotencyKey}`;
          const feePoolWallet = await tx.wallet.findFirst({
            where: { walletType: "FEE_POOL" },
          });
          if (feePoolWallet && feeAmount > 0n) {
            await tx.walletTransaction.create({
              data: {
                walletId: feePoolWallet.id,
                transactionType: "FEE",
                status: "COMPLETED",
                paymentMethod: "UBUNTUPAY_WALLET",
                amount: feeAmount,
                feeAmount: 0,
                netAmount: feeAmount,
                balanceBefore: feePoolWallet.balance,
                balanceAfter: feePoolWallet.balance + feeAmount,
                description: `Fee for ${idempotencyKey}`,
                idempotencyKey: feeIdempotencyKey,
              },
            });
            await tx.wallet.update({
              where: { id: feePoolWallet.id },
              data: { balance: { increment: feeAmount } },
            });
            await tx.ledgerEntry.create({
              data: {
                transactionId: debitTxn.id,
                walletId: senderWalletId,
                userId: senderWallet.userId,
                entryType: "DEBIT",
                accountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
                amountCents: feeAmount,
                description: `Fee for ${idempotencyKey}`,
                reference: idempotencyKey,
                counterpartyWalletId: feePoolWallet.id,
                counterpartyAccountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
              },
            });
            await tx.ledgerEntry.create({
              data: {
                transactionId: debitTxn.id,
                walletId: feePoolWallet.id,
                userId: null,
                entryType: "CREDIT",
                accountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
                amountCents: feeAmount,
                description: `Fee for ${idempotencyKey}`,
                reference: idempotencyKey,
                counterpartyWalletId: senderWalletId,
                counterpartyAccountCode: LEDGER_ACCOUNT_CUSTOMER_WALLETS,
              },
            });
          }

          await writeAuditLog(tx, {
            userId: senderWallet.userId,
            action: "PAYMENT_SENT",
            entityType: "wallet_transaction",
            entityId: debitTxn.id,
            previousState: JSON.stringify({
              balance: senderWallet.balance.toString(),
            }),
            newState: JSON.stringify({
              balance: senderBalanceAfter.toString(),
            }),
            ipAddress,
            deviceId,
            serviceId: "payment-service",
            correlationId: idempotencyKey,
          });

          return {
            debitTxn,
            creditTxn,
            feeAmount,
            totalDebitCents,
            senderUserId: senderWallet.userId,
          };
        },
        { timeout: 10_000 },
      ); // 10s timeout — adequate for financial transactions

      // ─────────────────────────────────────────────────────────────
      // POST-TRANSACTION: publish event for AML screening (fire-and-forget)
      // ─────────────────────────────────────────────────────────────
      paymentCreatedQueue
        .add(QUEUE_NAMES.PAYMENTS_CREATED, {
          transactionId: result.debitTxn.id,
          walletId: senderWalletId,
          userId: result.senderUserId,
          amountCents,
          feeAmountCents: result.feeAmount.toString(),
          paymentMethod: paymentMethod || "UBUNTUPAY_WALLET",
          counterpartyWalletId: receiverWalletIdFinal,
          description,
          idempotencyKey,
          deviceId,
          ipAddress,
          createdAt: new Date().toISOString(),
        })
        .catch((err) =>
          console.error("[payment-service] Failed to enqueue AML event:", err),
        );

      return res.status(201).json(
        createSuccessResponse(
          {
            transaction: {
              debit: serializeWalletTxn(result.debitTxn),
              credit: serializeWalletTxn(result.creditTxn),
              fee: result.feeAmount.toString(),
              totalDebitedCents: result.totalDebitCents.toString(),
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

export function startServer() {
  app.listen(PORT, () => {
    console.log(`✅ Payment Service listening on port ${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
  });
}

if (require.main === module) {
  startServer();
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
