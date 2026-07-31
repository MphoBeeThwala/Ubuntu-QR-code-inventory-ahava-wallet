/**
 * PayShap Mock Service
 * Simulates SARB PayShap API responses for demo purposes
 * Production-ready code that can be replaced with real API calls later
 */

import express, { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@ahava/shared-errors';

const app: express.Express = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6011;

app.use(express.json());

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get('X-Request-ID');
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : uuidv4();
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json(createSuccessResponse({ status: 'ok', service: 'payshap-mock' }, req.id));
});

/**
 * POST /payshap/transactions
 * Simulate PayShap payment initiation
 * In production, this would call real PayShap API
 */
app.post('/payshap/transactions', async (req, res, next) => {
  try {
    const {
      debtorAccountRef,
      creditorAccountRef,
      amountCents,
      currency = 'ZAR',
      remittanceInfo,
      debtorName,
      creditorName,
    } = req.body;

    if (!debtorAccountRef || !creditorAccountRef || amountCents === undefined) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        'debtorAccountRef, creditorAccountRef, and amountCents are required',
        { requestId: req.id },
      );
    }

    // Validate wallets exist
    const debtorWallet = await prisma.wallet.findFirst({
      where: { walletNumber: debtorAccountRef, isDeleted: false },
    });

    const creditorWallet = await prisma.wallet.findFirst({
      where: { walletNumber: creditorAccountRef, isDeleted: false },
    });

    if (!debtorWallet || !creditorWallet) {
      throw new AhavaError(
        AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND,
        'Debtor or creditor wallet not found',
        { requestId: req.id },
      );
    }

    // Simulate PayShap response
    const payshapMsgId = `PSHAP-${uuidv4().slice(0, 8).toUpperCase()}`;
    const payshapEndToEndId = uuidv4();

    // In production: Call real PayShap API here
    // For mock: Simulate instant settlement
    const mockResponse = {
      payshapMsgId,
      payshapEndToEndId,
      amountCents: BigInt(amountCents),
      currency,
      debtorName: debtorName || 'Ubuntu User',
      debtorAccountRef,
      creditorName: creditorName || 'Ubuntu Merchant',
      creditorAccountRef,
      remittanceInfo: remittanceInfo || 'Ubuntu Pay Transaction',
      status: 'ACCEPTED',
      statusReason: null,
      submittedAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
      rawRequest: JSON.stringify(req.body),
      rawResponse: JSON.stringify({
        message: 'Transaction accepted',
        status: 'ACCEPTED',
        timestamp: new Date().toISOString(),
      }),
    };

    // Store in database
    await prisma.payshapTransaction.create({
      data: {
        id: uuidv4(),
        ahavaTransactionId: uuidv4(),
        payshapMsgId,
        payshapEndToEndId,
        amountCents: BigInt(amountCents),
        currency,
        debtorName: debtorName || 'Ubuntu User',
        debtorAccountRef,
        creditorName: creditorName || 'Ubuntu Merchant',
        creditorAccountRef,
        remittanceInfo: remittanceInfo || 'Ubuntu Pay Transaction',
        status: 'SETTLED',
        submittedAt: new Date(),
        settledAt: new Date(),
        rawRequest: JSON.stringify(req.body),
        rawResponse: JSON.stringify(mockResponse),
      },
    });

    res.status(201).json(
      createSuccessResponse(
        {
          payshapTransaction: {
            ...mockResponse,
            amountCents: mockResponse.amountCents.toString(),
          },
          qrCode: {
            type: 'PAYSHAP',
            payload: JSON.stringify({
              ...mockResponse,
              qrType: 'PAYSHAP',
              timestamp: new Date().toISOString(),
            }),
            qrHash: uuidv4(),
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payshap/transactions/:payshapMsgId
 * Get PayShap transaction status
 */
app.get('/payshap/transactions/:payshapMsgId', async (req, res, next) => {
  try {
    const { payshapMsgId } = req.params;

    const transaction = await prisma.payshapTransaction.findUnique({
      where: { payshapMsgId },
    });

    if (!transaction) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'PayShap transaction not found',
        { requestId: req.id },
      );
    }

    res.json(
      createSuccessResponse(
        {
          payshapTransaction: {
            ...transaction,
            amountCents: transaction.amountCents.toString(),
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * POST /payshap/qr
 * Generate a PayShap-compatible QR code
 */
app.post('/payshap/qr', async (req, res, next) => {
  try {
    const { walletNumber, amountCents, description } = req.body;

    if (!walletNumber) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        'walletNumber is required',
        { requestId: req.id },
      );
    }

    // Validate wallet
    const wallet = await prisma.wallet.findFirst({
      where: { walletNumber, isDeleted: false },
    });

    if (!wallet) {
      throw new AhavaError(
        AhavaErrorCode.WAL_NOT_FOUND,
        'Wallet not found',
        { requestId: req.id },
      );
    }

    // Generate PayShap QR payload
    const qrPayload = {
      type: 'PAYSHAP_QR',
      walletNumber,
      amountCents: amountCents ? BigInt(amountCents) : null,
      currency: 'ZAR',
      description: description || 'Ubuntu Pay Payment',
      timestamp: new Date().toISOString(),
      payshap: {
        version: '1.0',
        merchantId: walletNumber,
        amount: amountCents ? amountCents / 100 : null,
      },
    };

    const qrHash = uuidv4();

    res.status(201).json(
      createSuccessResponse(
        {
          qrCode: {
            type: 'PAYSHAP',
            payload: qrPayload,
            qrHash,
            walletNumber,
            amountCents: amountCents?.toString(),
            expiresAt: amountCents ? new Date(Date.now() + 10 * 60 * 1000) : null,
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

// Error handling
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  console.error('Unhandled error:', err);
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    'Internal server error',
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(genericError));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ PayShap Mock Service listening on port ${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
  });
}

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}