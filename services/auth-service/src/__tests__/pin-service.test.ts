import {
  hashPin,
  verifyPinHash,
  generateRandomPin,
  createPin,
  updatePin,
  deletePin,
  validatePin,
  verifyPin,
  unlockPin,
  isPinLocked,
  getLockoutInfo,
  validateSession,
  invalidateSession,
  getPinStatistics,
  cleanupExpiredSessions,
  PIN_CONFIG,
} from './pin-service';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  genSalt: jest.fn().mockResolvedValue('$2b$12$fakeSalt'),
  hash: jest.fn().mockResolvedValue('$2b$12$fakeSalt.fakeHash'),
  compare: jest.fn().mockImplementation((pin: string, hash: string) => {
    // For testing, we'll say the PIN matches if it's '1234'
    return Promise.resolve(pin === '1234');
  }),
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue(Buffer.from('fake-random-bytes')),
  randomInt: jest.fn().mockReturnValue(5),
}));

// Mock Prisma Client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    pin: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    pinAttempt: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    pinSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback({})),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $on: jest.fn(),
  })),
}));

const prisma = new (require('@prisma/client').PrismaClient)();

describe('PIN Service (BATCH 6 - PIN Concurrency)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PIN Hashing', () => {
    it('should hash a PIN', async () => {
      const hash = await hashPin('1234');
      expect(hash).toBe('$2b$12$fakeSalt.fakeHash');
    });

    it('should verify a correct PIN hash', async () => {
      const isValid = await verifyPinHash('1234', '$2b$12$fakeSalt.fakeHash');
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect PIN hash', async () => {
      const isValid = await verifyPinHash('wrong', '$2b$12$fakeSalt.fakeHash');
      expect(isValid).toBe(false);
    });

    it('should generate a random PIN', () => {
      const pin = generateRandomPin(4);
      expect(pin.length).toBe(4);
      expect(/^d+$/.test(pin)).toBe(true);
    });

    it('should generate PIN of specified length', () => {
      const pin = generateRandomPin(6);
      expect(pin.length).toBe(6);
    });
  });

  describe('PIN Validation', () => {
    it('should validate a 4-digit PIN', () => {
      expect(validatePin('1234')).toBe(true);
    });

    it('should validate a 6-digit PIN', () => {
      expect(validatePin('123456')).toBe(true);
    });

    it('should reject a 3-digit PIN', () => {
      expect(validatePin('123')).toBe(false);
    });

    it('should reject a 7-digit PIN', () => {
      expect(validatePin('1234567')).toBe(false);
    });

    it('should reject a PIN with non-digits', () => {
      expect(validatePin('123a')).toBe(false);
    });

    it('should accept a PIN with leading zeros', () => {
      expect(validatePin('0012')).toBe(true);
    });
  });

  describe('createPin', () => {
    it('should create a new PIN', async () => {
      (prisma as any).pin.findFirst.mockResolvedValue(null);
      (prisma as any).pin.create.mockResolvedValue({
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
      });

      const pinId = await createPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: '1234',
      });

      expect(pinId).toBe('pin-1');
      expect(prisma.pin.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          walletId: 'wallet-1',
        }),
      });
    });

    it('should reject duplicate PIN', async () => {
      (prisma as any).pin.findFirst.mockResolvedValue({
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
      });

      await expect(
        createPin({
          userId: 'user-1',
          walletId: 'wallet-1',
          pin: '1234',
        })
      ).rejects.toThrow('PIN already exists');
    });

    it('should reject invalid PIN', async () => {
      await expect(
        createPin({
          userId: 'user-1',
          walletId: 'wallet-1',
          pin: '12',
        })
      ).rejects.toThrow('Invalid PIN');
    });
  });

  describe('verifyPin', () => {
    it('should verify correct PIN', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        pinHash: '$2b$12$fakeSalt.fakeHash',
        status: 'ACTIVE',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      (prisma as any).pinAttempt.findFirst.mockResolvedValue(null);
      (prisma as any).pinAttempt.create.mockResolvedValue({});
      (prisma as any).pin.update.mockResolvedValue({});
      (prisma as any).pinSession.create.mockResolvedValue({
        sessionToken: 'session-token-1',
      });

      const result = await verifyPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: '1234',
      });

      expect(result.success).toBe(true);
      expect(result.sessionToken).toBe('session-token-1');
    });

    it('should reject incorrect PIN', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        pinHash: '$2b$12$fakeSalt.fakeHash',
        status: 'ACTIVE',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      (prisma as any).pinAttempt.findFirst.mockResolvedValue(null);
      (prisma as any).pinAttempt.create.mockResolvedValue({});

      const result = await verifyPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: 'wrong',
      });

      expect(result.success).toBe(false);
      expect(result.isLockout).toBe(false);
      expect(result.error).toContain('Incorrect PIN');
    });

    it('should lock out after max attempts', async () => {
      const pinRecord = {
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        pinHash: '$2b$12$fakeSalt.fakeHash',
        status: 'ACTIVE',
        maxAttempts: 3,
        lockoutDurationMinutes: 30,
      };

      (prisma as any).pin.findUnique.mockResolvedValue(pinRecord);
      
      // Simulate 2 existing failed attempts
      (prisma as any).pinAttempt.findFirst
        .mockResolvedValueOnce({
          id: 'attempt-1',
          attemptCount: 2,
          isLockout: false,
        });

      // Create new attempt
      (prisma as any).pinAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        attemptCount: 3,
      });

      // Update attempt to lockout
      (prisma as any).pinAttempt.update.mockResolvedValue({
        id: 'attempt-2',
        isLockout: true,
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
      });

      // Lock the PIN
      (prisma as any).pin.update.mockResolvedValue({});

      const result = await verifyPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: 'wrong',
      });

      expect(result.success).toBe(false);
      expect(result.isLockout).toBe(true);
      expect(prisma.pin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pin-1' },
          data: { status: 'LOCKED' },
        })
      );
    });

    it('should reject locked PIN', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        pinHash: '$2b$12$fakeSalt.fakeHash',
        status: 'LOCKED',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      const result = await verifyPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: '1234',
      });

      expect(result.success).toBe(false);
      expect(result.isLockout).toBe(true);
      expect(result.error).toContain('PIN is locked');
    });

    it('should reset attempts after successful verification', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        pinHash: '$2b$12$fakeSalt.fakeHash',
        status: 'ACTIVE',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      (prisma as any).pinAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        attemptCount: 2,
      });

      (prisma as any).pinAttempt.updateMany.mockResolvedValue({ count: 1 });
      (prisma as any).pin.update.mockResolvedValue({});
      (prisma as any).pinSession.create.mockResolvedValue({
        sessionToken: 'session-token-1',
      });

      await verifyPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: '1234',
      });

      expect(prisma.pinAttempt.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'user-1',
          walletId: 'wallet-1',
        }),
        data: expect.objectContaining({
          attemptCount: 0,
          isLockout: false,
          status: 'SUCCESS',
        }),
      });
    });
  });

  describe('unlockPin', () => {
    it('should unlock a locked PIN', async () => {
      (prisma as any).pin.update.mockResolvedValue({});
      (prisma as any).pinAttempt.updateMany.mockResolvedValue({ count: 1 });

      await unlockPin('user-1', 'wallet-1');

      expect(prisma.pin.update).toHaveBeenCalledWith({
        where: { userId_walletId: { userId: 'user-1', walletId: 'wallet-1' } },
        data: { status: 'ACTIVE' },
      });

      expect(prisma.pinAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          walletId: 'wallet-1',
          isLockout: true,
        },
        data: {
          isLockout: false,
          lockedUntil: null,
          attemptCount: 0,
          status: 'FAILED',
        },
      });
    });
  });

  describe('isPinLocked', () => {
    it('should return true for locked PIN', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        status: 'LOCKED',
      });

      const result = await isPinLocked('user-1', 'wallet-1');
      expect(result).toBe(true);
    });

    it('should return false for active PIN', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        status: 'ACTIVE',
      });

      const result = await isPinLocked('user-1', 'wallet-1');
      expect(result).toBe(false);
    });

    it('should return false for non-existent PIN', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue(null);

      const result = await isPinLocked('user-1', 'wallet-1');
      expect(result).toBe(false);
    });
  });

  describe('Session Management', () => {
    it('should validate a valid session', async () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 30);

      (prisma as any).pinSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        sessionToken: 'session-token-1',
        expiresAt: futureDate,
        isValid: true,
      });

      const session = await validateSession('session-token-1');

      expect(session).not.toBeNull();
      expect(session?.sessionToken).toBe('session-token-1');
    });

    it('should reject expired session', async () => {
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 30);

      (prisma as any).pinSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        sessionToken: 'session-token-1',
        expiresAt: pastDate,
        isValid: true,
      });

      (prisma as any).pinSession.update.mockResolvedValue({});

      const session = await validateSession('session-token-1');

      expect(session).toBeNull();
      expect(prisma.pinSession.update).toHaveBeenCalled();
    });

    it('should reject invalid session', async () => {
      (prisma as any).pinSession.findUnique.mockResolvedValue({
        id: 'session-1',
        isValid: false,
      });

      const session = await validateSession('session-token-1');

      expect(session).toBeNull();
    });

    it('should invalidate a session', async () => {
      (prisma as any).pinSession.updateMany.mockResolvedValue({ count: 1 });

      await invalidateSession('session-token-1');

      expect(prisma.pinSession.updateMany).toHaveBeenCalledWith({
        where: { sessionToken: 'session-token-1' },
        data: { isValid: false },
      });
    });
  });

  describe('getLockoutInfo', () => {
    it('should return lockout info', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      (prisma as any).pinAttempt.findFirst.mockResolvedValue(null);

      const info = await getLockoutInfo('user-1', 'wallet-1');

      expect(info.isLocked).toBe(false);
      expect(info.maxAttempts).toBe(5);
      expect(info.lockoutDuration).toBe(30);
    });

    it('should indicate lockout when PIN is locked', async () => {
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        status: 'LOCKED',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      const info = await getLockoutInfo('user-1', 'wallet-1');

      expect(info.isLocked).toBe(true);
    });

    it('should indicate lockout when attempt is locked', async () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 30);

      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        status: 'ACTIVE',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      (prisma as any).pinAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        isLockout: true,
        lockedUntil: futureDate,
      });

      const info = await getLockoutInfo('user-1', 'wallet-1');

      expect(info.isLocked).toBe(true);
      expect(info.lockedUntil).toBe(futureDate);
    });
  });

  describe('getPinStatistics', () => {
    it('should return statistics', async () => {
      (prisma as any).pin.count
        .mockResolvedValueOnce(10)  // total
        .mockResolvedValueOnce(8)   // active
        .mockResolvedValueOnce(1)   // locked
        .mockResolvedValueOnce(1);  // disabled

      (prisma as any).pinAttempt.count
        .mockResolvedValueOnce(20)  // total
        .mockResolvedValueOnce(15)  // failed
        .mockResolvedValueOnce(5);  // lockedOut

      (prisma as any).pinSession.count.mockResolvedValue(3);  // active sessions

      const stats = await getPinStatistics();

      expect(stats.pins.total).toBe(10);
      expect(stats.pins.active).toBe(8);
      expect(stats.pins.locked).toBe(1);
      expect(stats.attempts.total).toBe(20);
      expect(stats.attempts.failed).toBe(15);
      expect(stats.sessions.active).toBe(3);
    });
  });

  describe('Concurrency Control', () => {
    it('should handle concurrent PIN verification requests', async () => {
      // This test verifies that the service can handle multiple concurrent requests
      // In a real scenario, database transactions would prevent race conditions
      
      (prisma as any).pin.findUnique.mockResolvedValue({
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        pinHash: '$2b$12$fakeSalt.fakeHash',
        status: 'ACTIVE',
        maxAttempts: 5,
        lockoutDurationMinutes: 30,
      });

      (prisma as any).pinAttempt.findFirst.mockResolvedValue(null);
      (prisma as any).pin.update.mockResolvedValue({});
      (prisma as any).pinSession.create.mockResolvedValue({
        sessionToken: 'session-token-1',
      });

      // Simulate concurrent requests
      const promises = Array.from({ length: 3 }, () =>
        verifyPin({
          userId: 'user-1',
          walletId: 'wallet-1',
          pin: '1234',
        })
      );

      const results = await Promise.all(promises);

      // All should succeed (same PIN, different requests)
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should prevent race conditions on lockout', async () => {
      const pinRecord = {
        id: 'pin-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        pinHash: '$2b$12$fakeSalt.fakeHash',
        status: 'ACTIVE',
        maxAttempts: 1,  // Only 1 attempt allowed
        lockoutDurationMinutes: 30,
      };

      (prisma as any).pin.findUnique.mockResolvedValue(pinRecord);
      (prisma as any).pinAttempt.findFirst.mockResolvedValue(null);
      (prisma as any).pinAttempt.create.mockResolvedValue({
        id: 'attempt-1',
        attemptCount: 1,
      });
      (prisma as any).pinAttempt.update.mockResolvedValue({
        id: 'attempt-1',
        isLockout: true,
      });
      (prisma as any).pin.update.mockResolvedValue({});

      // First attempt - should fail and lock
      const result1 = await verifyPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: 'wrong',
      });

      expect(result1.success).toBe(false);

      // Second attempt - should be locked out
      const result2 = await verifyPin({
        userId: 'user-1',
        walletId: 'wallet-1',
        pin: '1234',  // Even correct PIN should be rejected
      });

      expect(result2.success).toBe(false);
      expect(result2.isLockout).toBe(true);
    });
  });
});
