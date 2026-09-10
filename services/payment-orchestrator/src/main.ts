import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import { AhavaError, AhavaErrorCode, createSuccessResponse, createErrorResponse } from "@ahava/shared-errors";

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(express.json());

// POST /payments/orchestrate - Orchestrate payment saga
app.post("/payments/orchestrate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { senderWalletId, recipientWalletId, recipientPhone, amountCents, description, idempotencyKey, deviceId, ipAddress } = req.body;
    
    if (!senderWalletId || amountCents == null || !idempotencyKey) 
      throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing senderWalletId, amountCents, or idempotencyKey", { requestId: req.id });
    
    if (!recipientWalletId && !recipientPhone) 
      throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Provide recipientWalletId or recipientPhone", { requestId: req.id });

    // Resolve recipient wallet ID if phone is provided
    let resolvedRecipientId = recipientWalletId;
    if (!resolvedRecipientId && recipientPhone) {
      const wallet = await prisma.wallet.findFirst({
        where: { walletNumber: recipientPhone },
      });
      if (!wallet) throw new AhavaError(AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND, "Recipient wallet not found", { requestId: req.id });
      resolvedRecipientId = wallet.id;
    }

    if (!resolvedRecipientId) throw new AhavaError(AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND, "Recipient wallet not found", { requestId: req.id });
    
    // FIX: Changed BigInt(amountCents) to amountCents.toString() for JSON serialization
    saga.steps = [
      { name: "debit_sender", service: "payment", endpoint: "/payments", method: "POST", payload: { senderWalletId, receiverWalletId: resolvedRecipientId, amountCents, description, idempotencyKey, paymentMethod: "UBUNTUPAY_WALLET", deviceId, ipAddress }, compensation: { endpoint: "/payments/reverse", method: "POST", payload: { idempotencyKey, reason: "Saga compensation" } } },
      { name: "ledger_entry", service: "ledger", endpoint: "/ledger/batch", method: "POST", payload: { entries: [{ transactionId: idempotencyKey, walletId: senderWalletId, userId: "system", entryType: "DEBIT", accountCode: "1100", amountCents: amountCents.toString(), description: `Payment to ${resolvedRecipientId}`, reference: idempotencyKey }, { transactionId: idempotencyKey, walletId: resolvedRecipientId, userId: "system", entryType: "CREDIT", accountCode: "1100", amountCents: amountCents.toString(), description: `Payment from ${senderWalletId}`, reference: idempotencyKey }] } },
      { name: "notify_recipient", service: "notification", endpoint: "/notifications/send", method: "POST", payload: { userId: resolvedRecipientId, channel: "PUSH", title: "Payment Received", body: `You received R${(amountCents / 100).toFixed(2)}` } },
    ];
    saga.status = "RESERVING";

    // Execute saga steps
    res.json(createSuccessResponse({ saga }, req.id));
  } catch (error) {
    next(error);
  }
});

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json(createSuccessResponse({ status: "ok", service: "payment-orchestrator" }, req.id));
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AhavaError) {
    res.status(err.httpStatus).json(createErrorResponse(err, req.id));
  } else {
    res.status(500).json(createErrorResponse(new AhavaError(AhavaErrorCode.SERVER_ERROR, err.message, { requestId: req.id }), req.id));
  }
});

const PORT = process.env.PORT || 6007;
app.listen(PORT, () => {
  console.log(`Payment Orchestrator running on port ${PORT}`);
});

export default app;
