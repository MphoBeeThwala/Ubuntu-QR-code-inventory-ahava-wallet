import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * QR Payment Idempotency Utility (BATCH 3)
 * 
 * Ensures QR code payments cannot be processed multiple times.
 * Uses the QrPayment table to track processed QR codes and transactions.
 */

interface QrPaymentData {
  qrCodeId: string;
  transactionId: string;
  walletId: string;
  amountCents: bigint | string;
  reference?: string;
  metadata?: any;
  expiresInMinutes?: number;
}

interface IdempotencyCheckResult {
  isDuplicate: boolean;
  existingPayment?: {
    id: string;
    status: string;
    transactionId: string;
  };
}

/**
 * Check if a QR code or transaction has already been processed
 */
export async function checkQrIdempotency(
  qrCodeId: string,
  transactionId?: string
): Promise<IdempotencyCheckResult> {
  try {
    // Check by QR code ID first
    const existingByQrCode = await prisma.qrPayment.findUnique({
      where: { qrCodeId },
    });

    if (existingByQrCode) {
      return {
        isDuplicate: true,
        existingPayment: {
          id: existingByQrCode.id,
          status: existingByQrCode.status,
          transactionId: existingByQrCode.transactionId,
        },
      };
    }

    // Check by transaction ID if provided
    if (transactionId) {
      const existingByTxn = await prisma.qrPayment.findUnique({
        where: { transactionId },
      });

      if (existingByTxn) {
        return {
          isDuplicate: true,
          existingPayment: {
            id: existingByTxn.id,
            status: existingByTxn.status,
            transactionId: existingByTxn.transactionId,
          },
        };
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    console.error('Idempotency check failed:', error);
    // Fail safe: allow the payment to proceed if we can't check
    return { isDuplicate: false };
  }
}

/**
 * Record a new QR payment for idempotency tracking
 */
export async function recordQrPayment(data: QrPaymentData): Promise<string> {
  try {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (data.expiresInMinutes || 30));

    const payment = await prisma.qrPayment.create({
      data: {
        qrCodeId: data.qrCodeId,
        transactionId: data.transactionId,
        walletId: data.walletId,
        amountCents: BigInt(data.amountCents.toString()),
        currency: 'ZAR',
        status: 'PENDING',
        reference: data.reference,
        metadata: data.metadata,
        expiresAt,
      },
    });

    return payment.id;
  } catch (error) {
    console.error('Failed to record QR payment:', error);
    throw error;
  }
}

/**
 * Update QR payment status
 */
export async function updateQrPaymentStatus(
  qrCodeId: string,
  status: 'COMPLETED' | 'FAILED' | 'EXPIRED',
  transactionId?: string
): Promise<void> {
  try {
    const where = transactionId
      ? { transactionId }
      : { qrCodeId };

    await prisma.qrPayment.updateMany({
      where,
      data: {
        status: status as any,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to update QR payment status:', error);
    throw error;
  }
}

/**
 * Check if a QR code has expired
 */
export async function isQrCodeExpired(qrCodeId: string): Promise<boolean> {
  try {
    const payment = await prisma.qrPayment.findUnique({
      where: { qrCodeId },
    });

    if (!payment) {
      return false; // Not found, so not expired
    }

    return payment.expiresAt < new Date();
  } catch (error) {
    console.error('Failed to check QR code expiry:', error);
    return false; // Fail safe: assume not expired
  }
}

/**
 * Clean up expired QR payments
 */
export async function cleanupExpiredQrPayments(): Promise<number> {
  try {
    const result = await prisma.qrPayment.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    return result.count;
  } catch (error) {
    console.error('Failed to cleanup expired QR payments:', error);
    return 0;
  }
}

export default {
  checkQrIdempotency,
  recordQrPayment,
  updateQrPaymentStatus,
  isQrCodeExpired,
  cleanupExpiredQrPayments,
};
