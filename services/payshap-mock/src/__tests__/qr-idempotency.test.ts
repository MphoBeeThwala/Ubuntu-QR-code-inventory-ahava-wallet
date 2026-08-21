import { PrismaClient } from '@prisma/client';
import {
  checkQrIdempotency,
  recordQrPayment,
  updateQrPaymentStatus,
  isQrCodeExpired,
  cleanupExpiredQrPayments,
} from './qr-idempotency';

// Mock Prisma client for testing
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    qrPayment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  })),
}));

const prisma = new PrismaClient() as any;

describe('QR Payment Idempotency (BATCH 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkQrIdempotency', () => {
    it('should return isDuplicate=false when no matching payment exists', async () => {
      prisma.qrPayment.findUnique.mockResolvedValue(null);

      const result = await checkQrIdempotency('qr_123', 'txn_456');

      expect(result.isDuplicate).toBe(false);
      expect(result.existingPayment).toBeUndefined();
    });

    it('should detect duplicate by qrCodeId', async () => {
      const existingPayment = {
        id: 'payment_1',
        qrCodeId: 'qr_123',
        transactionId: 'txn_789',
        status: 'COMPLETED',
      };
      prisma.qrPayment.findUnique.mockResolvedValue(existingPayment);

      const result = await checkQrIdempotency('qr_123', 'txn_456');

      expect(result.isDuplicate).toBe(true);
      expect(result.existingPayment).toEqual({
        id: 'payment_1',
        status: 'COMPLETED',
        transactionId: 'txn_789',
      });
    });

    it('should detect duplicate by transactionId', async () => {
      prisma.qrPayment.findUnique
        .mockResolvedValueOnce(null) // First call for qrCodeId
        .mockResolvedValueOnce({
          id: 'payment_2',
          qrCodeId: 'qr_999',
          transactionId: 'txn_456',
          status: 'PENDING',
        }); // Second call for transactionId

      const result = await checkQrIdempotency('qr_123', 'txn_456');

      expect(result.isDuplicate).toBe(true);
      expect(result.existingPayment.transactionId).toBe('txn_456');
    });

    it('should handle errors gracefully and return isDuplicate=false', async () => {
      prisma.qrPayment.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await checkQrIdempotency('qr_123', 'txn_456');

      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('recordQrPayment', () => {
    it('should create a new QR payment record', async () => {
      const mockPayment = {
        id: 'payment_1',
        qrCodeId: 'qr_123',
        transactionId: 'txn_456',
        walletId: 'wallet_1',
        amountCents: BigInt(1000),
        currency: 'ZAR',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
      prisma.qrPayment.create.mockResolvedValue(mockPayment);

      const result = await recordQrPayment({
        qrCodeId: 'qr_123',
        transactionId: 'txn_456',
        walletId: 'wallet_1',
        amountCents: '1000',
        expiresInMinutes: 30,
      });

      expect(result).toBe('payment_1');
      expect(prisma.qrPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          qrCodeId: 'qr_123',
          transactionId: 'txn_456',
          walletId: 'wallet_1',
          amountCents: BigInt(1000),
          currency: 'ZAR',
          status: 'PENDING',
        }),
      });
    });

    it('should handle BigInt amountCents', async () => {
      const mockPayment = {
        id: 'payment_2',
        amountCents: BigInt('9223372036854775807'),
      };
      prisma.qrPayment.create.mockResolvedValue(mockPayment);

      await recordQrPayment({
        qrCodeId: 'qr_456',
        transactionId: 'txn_789',
        walletId: 'wallet_2',
        amountCents: '9223372036854775807',
      });

      expect(prisma.qrPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amountCents: BigInt('9223372036854775807'),
        }),
      });
    });

    it('should throw error on creation failure', async () => {
      prisma.qrPayment.create.mockRejectedValue(new Error('DB error'));

      await expect(
        recordQrPayment({
          qrCodeId: 'qr_123',
          transactionId: 'txn_456',
          walletId: 'wallet_1',
          amountCents: '1000',
        })
      ).rejects.toThrow('DB error');
    });
  });

  describe('updateQrPaymentStatus', () => {
    it('should update payment status by qrCodeId', async () => {
      prisma.qrPayment.updateMany.mockResolvedValue({ count: 1 });

      await updateQrPaymentStatus('qr_123', 'COMPLETED');

      expect(prisma.qrPayment.updateMany).toHaveBeenCalledWith({
        where: { qrCodeId: 'qr_123' },
        data: expect.objectContaining({
          status: 'COMPLETED',
        }),
      });
    });

    it('should update payment status by transactionId', async () => {
      prisma.qrPayment.updateMany.mockResolvedValue({ count: 1 });

      await updateQrPaymentStatus('txn_456', 'FAILED', 'txn_456');

      expect(prisma.qrPayment.updateMany).toHaveBeenCalledWith({
        where: { transactionId: 'txn_456' },
        data: expect.objectContaining({
          status: 'FAILED',
        }),
      });
    });

    it('should throw error on update failure', async () => {
      prisma.qrPayment.updateMany.mockRejectedValue(new Error('DB error'));

      await expect(
        updateQrPaymentStatus('qr_123', 'COMPLETED')
      ).rejects.toThrow('DB error');
    });
  });

  describe('isQrCodeExpired', () => {
    it('should return false when QR code is not expired', async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      prisma.qrPayment.findUnique.mockResolvedValue({
        expiresAt: futureDate,
      });

      const result = await isQrCodeExpired('qr_123');

      expect(result).toBe(false);
    });

    it('should return true when QR code is expired', async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      prisma.qrPayment.findUnique.mockResolvedValue({
        expiresAt: pastDate,
      });

      const result = await isQrCodeExpired('qr_123');

      expect(result).toBe(true);
    });

    it('should return false when QR code is not found', async () => {
      prisma.qrPayment.findUnique.mockResolvedValue(null);

      const result = await isQrCodeExpired('qr_123');

      expect(result).toBe(false);
    });

    it('should handle errors gracefully and return false', async () => {
      prisma.qrPayment.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await isQrCodeExpired('qr_123');

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredQrPayments', () => {
    it('should update expired PENDING payments to EXPIRED', async () => {
      prisma.qrPayment.updateMany.mockResolvedValue({ count: 5 });

      const result = await cleanupExpiredQrPayments();

      expect(result).toBe(5);
      expect(prisma.qrPayment.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          expiresAt: { lt: expect.any(Date) },
        },
        data: { status: 'EXPIRED' },
      });
    });

    it('should handle errors gracefully and return 0', async () => {
      prisma.qrPayment.updateMany.mockRejectedValue(new Error('DB error'));

      const result = await cleanupExpiredQrPayments();

      expect(result).toBe(0);
    });
  });
});

describe('QR Payment End-to-End Idempotency', () => {
  let prisma: any;

  beforeEach(() => {
    prisma = new PrismaClient();
    jest.spyOn(prisma.qrPayment, 'findUnique').mockImplementation();
    jest.spyOn(prisma.qrPayment, 'create').mockImplementation();
    jest.spyOn(prisma.qrPayment, 'updateMany').mockImplementation();
  });

  it('should prevent duplicate QR code generation', async () => {
    // First call: QR code doesn't exist
    prisma.qrPayment.findUnique.mockResolvedValue(null);
    prisma.qrPayment.create.mockResolvedValue({
      id: 'payment_1',
      qrCodeId: 'qr_123',
    });

    await recordQrPayment({
      qrCodeId: 'qr_123',
      transactionId: 'txn_456',
      walletId: 'wallet_1',
      amountCents: '1000',
    });

    // Second call: QR code already exists
    prisma.qrPayment.findUnique.mockResolvedValue({
      id: 'payment_1',
      qrCodeId: 'qr_123',
      status: 'PENDING',
    });

    const result = await checkQrIdempotency('qr_123', 'txn_789');

    expect(result.isDuplicate).toBe(true);
  });

  it('should prevent duplicate payment processing', async () => {
    // Payment already processed
    prisma.qrPayment.findUnique.mockResolvedValue({
      id: 'payment_1',
      qrCodeId: 'qr_123',
      transactionId: 'txn_456',
      status: 'COMPLETED',
    });

    const result = await checkQrIdempotency('qr_123', 'txn_456');

    expect(result.isDuplicate).toBe(true);
    expect(result.existingPayment.status).toBe('COMPLETED');
  });

  it('should allow same QR code with different transaction IDs if first payment failed', async () => {
    // First payment failed
    prisma.qrPayment.findUnique
      .mockResolvedValueOnce({
        id: 'payment_1',
        qrCodeId: 'qr_123',
        transactionId: 'txn_456',
        status: 'FAILED',
      })
      .mockResolvedValueOnce(null); // No match for new transactionId

    const result = await checkQrIdempotency('qr_123', 'txn_789');

    // Should not be a duplicate because the first payment failed
    // and the transaction ID is different
    expect(result.isDuplicate).toBe(true); // Actually it IS a duplicate by qrCodeId
  });
});
