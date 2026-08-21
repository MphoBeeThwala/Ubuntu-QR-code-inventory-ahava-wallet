import express, { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import {
  checkQrIdempotency,
  recordQrPayment,
  updateQrPaymentStatus,
  isQrCodeExpired,
} from './utils/qr-idempotency';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6011;

app.use(express.json());

// QR Payment Idempotency Middleware
async function qrIdempotencyMiddleware(req, res, next) {
  try {
    const qrCodeId = req.body.qrCodeId;
    const transactionId = req.body.transactionId;
    
    if (!qrCodeId) {
      return next();
    }

    const checkResult = await checkQrIdempotency(qrCodeId, transactionId);

    if (checkResult.isDuplicate) {
      const existingPayment = checkResult.existingPayment;
      return res.status(409).json({
        error: 'DUPLICATE_PAYMENT',
        message: 'This QR code or transaction has already been processed',
        paymentId: existingPayment.id,
        status: existingPayment.status,
        transactionId: existingPayment.transactionId,
      });
    }

    const isExpired = await isQrCodeExpired(qrCodeId);
    if (isExpired) {
      return res.status(400).json({
        error: 'QR_CODE_EXPIRED',
        message: 'This QR code has expired',
        qrCodeId,
      });
    }

    next();
  } catch (error) {
    console.error('Idempotency check error:', error);
    next();
  }
}

// Generate QR code
app.post('/payshap/qr', async (req, res) => {
  try {
    const walletId = req.body.walletId;
    const amountCents = req.body.amountCents;
    const reference = req.body.reference;
    const metadata = req.body.metadata;

    if (!walletId || !amountCents) {
      return res.status(400).json({
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'walletId and amountCents are required',
      });
    }

    const qrCodeId = 'qr_' + uuidv4();
    const transactionId = 'txn_' + uuidv4();

    await recordQrPayment({
      qrCodeId,
      transactionId,
      walletId,
      amountCents: BigInt(amountCents).toString(),
      reference,
      metadata,
      expiresInMinutes: 30,
    });

    res.json({
      success: true,
      qrCodeId,
      transactionId,
      walletId,
      amountCents: amountCents.toString(),
      currency: 'ZAR',
      status: 'PENDING',
      reference,
      metadata,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      qrCodeUrl: 'https://api.example.com/payshap/qr/' + qrCodeId,
    });
  } catch (error) {
    console.error('Generate QR error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to generate QR code',
    });
  }
});

// Validate QR code
app.get('/payshap/qr/:id', async (req, res) => {
  try {
    const qrCodeId = req.params.id;

    const payment = await prisma.qrPayment.findUnique({
      where: { qrCodeId },
    });

    if (!payment) {
      return res.status(404).json({
        error: 'QR_CODE_NOT_FOUND',
        message: 'QR code not found or invalid',
        qrCodeId,
      });
    }

    if (payment.expiresAt < new Date()) {
      await updateQrPaymentStatus(qrCodeId, 'EXPIRED');
      return res.status(400).json({
        error: 'QR_CODE_EXPIRED',
        message: 'This QR code has expired',
        qrCodeId,
        status: 'EXPIRED',
      });
    }

    res.json({
      success: true,
      qrCodeId: payment.qrCodeId,
      transactionId: payment.transactionId,
      walletId: payment.walletId,
      amountCents: payment.amountCents.toString(),
      currency: payment.currency,
      status: payment.status,
      reference: payment.reference,
      metadata: payment.metadata,
      expiresAt: payment.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Validate QR error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to validate QR code',
    });
  }
});

// Process payment with idempotency check
app.post('/payshap/pay', qrIdempotencyMiddleware, async (req, res) => {
  try {
    const qrCodeId = req.body.qrCodeId;
    const transactionId = req.body.transactionId;
    const amountCents = req.body.amountCents;

    if (!qrCodeId || !transactionId) {
      return res.status(400).json({
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'qrCodeId and transactionId are required',
      });
    }

    const existingPayment = await prisma.qrPayment.findUnique({
      where: { qrCodeId },
    });

    if (!existingPayment) {
      return res.status(404).json({
        error: 'QR_CODE_NOT_FOUND',
        message: 'QR code not found',
        qrCodeId,
      });
    }

    if (existingPayment.amountCents !== BigInt(amountCents.toString())) {
      return res.status(400).json({
        error: 'AMOUNT_MISMATCH',
        message: 'Payment amount does not match QR code amount',
        expected: existingPayment.amountCents.toString(),
        received: amountCents.toString(),
      });
    }

    await updateQrPaymentStatus(qrCodeId, 'COMPLETED', transactionId);

    res.json({
      success: true,
      paymentId: existingPayment.id,
      qrCodeId,
      transactionId,
      walletId: existingPayment.walletId,
      amountCents: existingPayment.amountCents.toString(),
      currency: existingPayment.currency,
      status: 'COMPLETED',
      reference: existingPayment.reference,
      metadata: existingPayment.metadata,
      processedAt: new Date().toISOString(),
      payShapReference: 'PS_' + uuidv4(),
    });
  } catch (error) {
    console.error('Process payment error:', error);
    if (qrCodeId) {
      try {
        await updateQrPaymentStatus(qrCodeId, 'FAILED');
      } catch (updateError) {
        console.error('Failed to update payment status:', updateError);
      }
    }
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to process payment',
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payshap-mock', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('PayShap Mock service running on port ' + PORT);
});

export default app;
