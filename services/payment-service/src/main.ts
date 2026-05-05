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
import { QUEUE_NAMES } from "@ahava/shared-events";
import { writeAuditLog } from "@ahava/shared-audit";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6003;

const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

const paymentCreatedQueue = new Queue(QUEUE_NAMES.PAYMENTS_CREATED, {
  connection: redisConnection,
});

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  req.id =
    typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(
    createSuccessResponse({ status: "ok", service: "payment-service" }, req.id),
  );
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

// POST /payments - Create payment transaction (atomic double-entry)
app.post(
  "/payments",
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
      } = req.body;

      if (!senderWalletId || amountCents == null || !idempotencyKey) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing required fields: senderWalletId, recipient, amountCents, idempotencyKey",
          { requestId: req.id },
        );
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
        throw new Error("Invalid amount");
      }

      // Idempotency check BEFORE opening transaction (read-only)
      const existingTxn = await prisma.walletTransaction.findUnique({
        where: { idempotencyKey },
      });

      if (existingTxn) {
        if (existingTxn.status === "COMPLETED") {
          return res.json(
            createSuccessResponse({ transaction: existingTxn }, req.id),
          );
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
              AhavaErrorCode.PAY_SENDER_NOT_FOUND,
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

          const feeAmount = Math.max(0, Math.floor(amountCents * 0.01));
          const totalDebitCents = amountCents + feeAmount;
          const senderBalanceAfter = senderWallet.balance - BigInt(totalDebitCents);
          const receiverBalanceAfter = receiverWallet.balance + BigInt(amountCents);

          if (senderWallet.balance < BigInt(totalDebitCents)) {
            throw new AhavaError(
              AhavaErrorCode.PAY_INSUFFICIENT_FUNDS,
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
              amount: amountCents,
              feeAmount,
              netAmount: amountCents - feeAmount,
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
              amount: amountCents,
              feeAmount: 0,
              netAmount: amountCents,
              balanceBefore: receiverWallet.balance,
              balanceAfter: receiverBalanceAfter,
              counterpartyWalletId: senderWalletId,
              description,
              idempotencyKey: creditIdempotencyKey,
            },
          });

          await tx.wallet.update({
            where: { id: senderWalletId },
            data: { balance: { decrement: BigInt(totalDebitCents) } },
          });
          await tx.wallet.update({
            where: { id: receiverWalletIdFinal },
            data: { balance: { increment: BigInt(amountCents) } },
          });

          const feeIdempotencyKey = `fee-${idempotencyKey}`;
          const feePoolWallet = await tx.wallet.findFirst({
            where: { walletType: "FEE_POOL" },
          });
          if (feePoolWallet && feeAmount > 0) {
            await tx.walletTransaction.create({
              data: {
                walletId: feePoolWallet.id,
                transactionType: "FEE",
                status: "COMPLETED",
                paymentMethod: "UBUNTUPAY_WALLET",
                amount: BigInt(feeAmount),
                feeAmount: 0,
                netAmount: BigInt(feeAmount),
                balanceBefore: feePoolWallet.balance,
                balanceAfter: feePoolWallet.balance + BigInt(feeAmount),
                description: `Fee for ${idempotencyKey}`,
                idempotencyKey: feeIdempotencyKey,
              },
            });
            await tx.wallet.update({
              where: { id: feePoolWallet.id },
              data: { balance: { increment: BigInt(feeAmount) } },
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
          feeAmountCents: result.feeAmount,
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
              debit: result.debitTxn,
              credit: result.creditTxn,
              fee: result.feeAmount,
              totalDebitedCents: result.totalDebitCents,
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

