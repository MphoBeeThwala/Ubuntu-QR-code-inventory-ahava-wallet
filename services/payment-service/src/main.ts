import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { QUEUE_NAMES } from "@ahava/shared-events";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3003;

const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

const paymentCreatedQueue = new Queue(QUEUE_NAMES.PAYMENTS_CREATED, {
  connection: redisConnection,
});

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (_req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "payment-service" }));
});

// POST /payments/qr - Generate a payment QR code (static or dynamic)
app.post(
  "/payments/qr",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        walletId,
        qrType = "DYNAMIC",
        amountCents,
        description,
        ttlSeconds = 600, // 10 min default for dynamic
      } = req.body;

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
        select: { id: true, walletNumber: true, status: true, isDeleted: true },
      });

      if (!wallet || wallet.isDeleted) {
        throw new AhavaError(AhavaErrorCode.WAL_NOT_FOUND, "Wallet not found", {
          requestId: req.id,
        });
      }
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
        createSuccessResponse({
          qrCode: {
            id: qrCode.id,
            qrType: qrCode.qrType,
            qrPayload: qrCode.qrPayload,
            qrHash: qrCode.qrHash,
            amountCents: qrCode.amountCents?.toString() ?? null,
            expiresAt: qrCode.expiresAt,
            isActive: qrCode.isActive,
          },
        }),
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
};

// POST /payments - Create payment transaction (atomic double-entry)
app.post(
  "/payments",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        senderWalletId,
        receiverWalletId,
        amountCents,
        description,
        idempotencyKey,
        paymentMethod,
        deviceId,
        ipAddress,
      } = req.body;

      if (
        !senderWalletId ||
        !receiverWalletId ||
        amountCents == null ||
        !idempotencyKey
      ) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing required fields",
          { requestId: req.id },
        );
      }

      if (amountCents <= 0) {
        throw new AhavaError(
          AhavaErrorCode.PAY_INVALID_AMOUNT,
          "Amount must be positive",
          { requestId: req.id },
        );
      }

      // Idempotency check BEFORE opening transaction (read-only)
      const existingTxn = await prisma.walletTransaction.findUnique({
        where: { idempotencyKey },
      });

      if (existingTxn) {
        if (existingTxn.status === "COMPLETED") {
          return res.json(createSuccessResponse({ transaction: existingTxn }));
        }
        throw new AhavaError(
          AhavaErrorCode.PAY_DUPLICATE_IDEMPOTENCY_KEY,
          "Idempotency key already used",
          { requestId: req.id },
        );
      }

      // ─────────────────────────────────────────────────────────────
      // ATOMIC TRANSACTION: all reads-with-lock + all writes in one unit
      // ─────────────────────────────────────────────────────────────
      const result = await prisma.$transaction(
        async (tx) => {
          // Acquire row locks in deterministic UUID order to prevent deadlocks
          // when two concurrent payments involve the same pair of wallets.
          const [firstId, secondId] =
            senderWalletId < receiverWalletId
              ? [senderWalletId, receiverWalletId]
              : [receiverWalletId, senderWalletId];

          const lockedWallets = await tx.$queryRaw<WalletRow[]>`
        SELECT id, user_id AS "userId", is_deleted AS "isDeleted", status, balance
        FROM wallets
        WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
        ORDER BY id
        FOR UPDATE
      `;

          const senderWallet = lockedWallets.find(
            (w) => w.id === senderWalletId,
          );
          const receiverWallet = lockedWallets.find(
            (w) => w.id === receiverWalletId,
          );

          if (!senderWallet || senderWallet.isDeleted) {
            throw new AhavaError(
              AhavaErrorCode.WAL_NOT_FOUND,
              "Sender wallet not found",
            );
          }
          if (!receiverWallet || receiverWallet.isDeleted) {
            throw new AhavaError(
              AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND,
              "Receiver wallet not found",
            );
          }
          if (senderWallet.status !== "ACTIVE") {
            throw new AhavaError(
              AhavaErrorCode.WAL_WALLET_SUSPENDED,
              "Sender wallet is not active",
            );
          }
          if (Number(senderWallet.balance) < amountCents) {
            throw new AhavaError(
              AhavaErrorCode.WAL_INSUFFICIENT_BALANCE,
              `Insufficient balance. Available: ${senderWallet.balance} cents`,
              { statusCode: 402 },
            );
          }

          // Fee calculation: 0.5%, minimum R0.25
          const feeAmount = Math.max(Math.ceil(amountCents * 0.005), 25);
          const netAmount = amountCents - feeAmount;

          const senderBalanceAfter = senderWallet.balance - BigInt(amountCents);
          const receiverBalanceAfter =
            receiverWallet.balance + BigInt(netAmount);

          // Create debit record (sender)
          const debitTxn = await tx.walletTransaction.create({
            data: {
              walletId: senderWalletId,
              transactionType: "DEBIT",
              status: "COMPLETED",
              paymentMethod: paymentMethod || "UBUNTUPAY_WALLET",
              amount: amountCents,
              feeAmount,
              netAmount,
              balanceBefore: senderWallet.balance,
              balanceAfter: senderBalanceAfter,
              counterpartyWalletId: receiverWalletId,
              description,
              idempotencyKey,
              deviceId,
              ipAddress,
            },
          });

          // Create credit record (receiver)
          const creditTxn = await tx.walletTransaction.create({
            data: {
              walletId: receiverWalletId,
              transactionType: "CREDIT",
              status: "COMPLETED",
              paymentMethod: paymentMethod || "UBUNTUPAY_WALLET",
              amount: netAmount,
              feeAmount: 0,
              netAmount,
              balanceBefore: receiverWallet.balance,
              balanceAfter: receiverBalanceAfter,
              counterpartyWalletId: senderWalletId,
              description,
              idempotencyKey: `${idempotencyKey}-credit`,
            },
          });

          // Update wallet balances atomically
          await tx.wallet.update({
            where: { id: senderWalletId },
            data: { balance: { decrement: amountCents } },
          });
          await tx.wallet.update({
            where: { id: receiverWalletId },
            data: { balance: { increment: netAmount } },
          });

          // Fee pool (best-effort — find inside tx to stay consistent)
          const feePoolWallet = await tx.wallet.findFirst({
            where: { walletType: "FEE_POOL" },
          });
          if (feePoolWallet) {
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
                balanceAfter: feePoolWallet.balance + BigInt(feeAmount),
                description: `Fee for ${idempotencyKey}`,
                idempotencyKey: `${idempotencyKey}-fee`,
              },
            });
            await tx.wallet.update({
              where: { id: feePoolWallet.id },
              data: { balance: { increment: feeAmount } },
            });
          }

          // Audit log
          await tx.auditLog.create({
            data: {
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
            },
          });

          return {
            debitTxn,
            creditTxn,
            feeAmount,
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
          feeAmountCents: result.feeAmount,
          paymentMethod: paymentMethod || "UBUNTUPAY_WALLET",
          counterpartyWalletId: receiverWalletId,
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
        createSuccessResponse({
          transaction: {
            debit: result.debitTxn,
            credit: result.creditTxn,
            fee: result.feeAmount,
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
    console.log(`✅ Payment Service listening on port ${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
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
