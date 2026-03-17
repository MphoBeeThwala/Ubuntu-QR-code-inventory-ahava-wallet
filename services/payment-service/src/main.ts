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
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "payment-service" }));
});

// POST /payments - Create payment transaction
app.post("/payments", async (req: Request, res: Response, next: NextFunction) => {
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

    if (!senderWalletId || !receiverWalletId || !amountCents || !idempotencyKey) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields",
        { requestId: req.id }
      );
    }

    if (amountCents <= 0) {
      throw new AhavaError(
        AhavaErrorCode.PAY_INVALID_AMOUNT,
        "Amount must be positive",
        { requestId: req.id }
      );
    }

    // Check idempotency - prevent duplicates
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
        { requestId: req.id }
      );
    }

    // Get sender wallet with SELECT FOR UPDATE (prevents race conditions)
    type WalletRow = {
      id: string;
      userId: string;
      isDeleted: boolean;
      status: string;
      balance: bigint;
    };

    const [senderWallet] = await prisma.$queryRaw<WalletRow[]>`
      SELECT id, user_id AS "userId", is_deleted AS "isDeleted", status, balance
      FROM wallets
      WHERE id = ${senderWalletId}::uuid
      FOR UPDATE
    `;

    if (!senderWallet || senderWallet.isDeleted) {
      throw new AhavaError(
        AhavaErrorCode.WAL_NOT_FOUND,
        "Sender wallet not found",
        { requestId: req.id }
      );
    }

    if (senderWallet.status !== "ACTIVE") {
      throw new AhavaError(
        AhavaErrorCode.WAL_WALLET_SUSPENDED,
        "Sender wallet is not active",
        { requestId: req.id }
      );
    }

    // Check balance
    if (Number(senderWallet.balance) < amountCents) {
      throw new AhavaError(
        AhavaErrorCode.WAL_INSUFFICIENT_BALANCE,
        `Insufficient balance. Available: ${senderWallet.balance} cents`,
        { requestId: req.id, statusCode: 402 }
      );
    }

    // Calculate fees (percentage + fixed)
    const feePercentage = 0.5; // 0.5%
    const minimumFee = 25; // R0.25
    const calculatedFee = Math.ceil(amountCents * (feePercentage / 100));
    const feeAmount = Math.max(calculatedFee, minimumFee);
    const netAmount = amountCents - feeAmount;

    // Get receiver wallet
    const receiverWallet = await prisma.wallet.findUnique({
      where: { id: receiverWalletId },
    });

    if (!receiverWallet) {
      throw new AhavaError(
        AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND,
        "Receiver wallet not found",
        { requestId: req.id }
      );
    }

    const senderBalanceAfter = senderWallet.balance - BigInt(amountCents);
    const receiverBalanceAfter = receiverWallet.balance + BigInt(netAmount);

    // Create sender debit transaction
    const debitTxn = await prisma.walletTransaction.create({
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

    // Create receiver credit transaction  
    const creditTxn = await prisma.walletTransaction.create({
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

    // Update both wallet balances
    await prisma.wallet.update({
      where: { id: senderWalletId },
      data: { balance: { decrement: amountCents } },
    });

    await prisma.wallet.update({
      where: { id: receiverWalletId },
      data: { balance: { increment: netAmount } },
    });

    // Create fee transaction
    const feePoolWallet = await prisma.wallet.findFirst({
      where: { walletType: "FEE_POOL" },
    });

    if (feePoolWallet) {
      await prisma.walletTransaction.create({
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
          description: `Fee from transaction ${idempotencyKey}`,
          idempotencyKey: `${idempotencyKey}-fee`,
        },
      });

      await prisma.wallet.update({
        where: { id: feePoolWallet.id },
        data: { balance: { increment: feeAmount } },
      });
    }

    // TODO: Publish PAYMENT_CREATED event for AML screening
    // TODO: Publish PAYMENT_COMPLETED event for notifications
    // TODO: Send SMS notification to both parties

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: senderWallet.userId,
        action: "PAYMENT_SENT",
        entityType: "wallet_transaction",
        entityId: debitTxn.id,
        previousState: JSON.stringify({ balance: senderWallet.balance.toString() }),
        newState: JSON.stringify({ balance: senderBalanceAfter.toString() }),
        ipAddress,
        deviceId,
        serviceId: "payment-service",
        correlationId: idempotencyKey,
      },
    });

    res.status(201).json(
      createSuccessResponse({
        transaction: {
          debit: debitTxn,
          credit: creditTxn,
          fee: feeAmount,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

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
  console.log(`✅ Payment Service listening on port ${PORT}`);
});

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
