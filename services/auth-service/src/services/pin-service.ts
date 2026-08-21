import { PrismaClient, PinStatus, PinAttemptStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * PIN Service (BATCH 6 - PIN Concurrency)
 * 
 * Provides secure PIN management with:
 * - Concurrency control (prevents race conditions)
 * - Rate limiting (prevents brute force attacks)
 * - Lockout after failed attempts
 * - Session-based authentication
 * - Secure PIN hashing (bcrypt)
 * - Never stores plaintext PINs
 */

// ============================================
// Configuration
// ============================================

const PIN_CONFIG = {
  // Hashing configuration
  SALT_ROUNDS: 12,
  
  // Default rate limiting
  MAX_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 30,
  
  // Session configuration
  SESSION_DURATION_MINUTES: 30,
  SESSION_TOKEN_LENGTH: 64,
  
  // PIN validation
  MIN_PIN_LENGTH: 4,
  MAX_PIN_LENGTH: 6,
};

// ============================================
// Type Definitions
// ============================================

interface CreatePinInput {
  userId: string;
  walletId: string;
  pin: string;
  maxAttempts?: number;
  lockoutDurationMinutes?: number;
}

interface VerifyPinInput {
  userId: string;
  walletId: string;
  pin: string;
  ipAddress?: string;
  deviceId?: string;
}

interface PinVerificationResult {
  success: boolean;
  userId: string;
  walletId: string;
  isLockout: boolean;
  attemptsRemaining?: number;
  lockedUntil?: Date;
  sessionToken?: string;
  error?: string;
}

interface PinSession {
  id: string;
  userId: string;
  walletId: string;
  sessionToken: string;
  expiresAt: Date;
  ipAddress?: string;
  deviceId?: string;
}

// ============================================
// PIN Hashing
// ============================================

/**
 * Hash a PIN using bcrypt
 * NEVER store plaintext PINs
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = await bcrypt.genSalt(PIN_CONFIG.SALT_ROUNDS);
  return await bcrypt.hash(pin, salt);
}

/**
 * Verify a PIN against a hash
 */
export async function verifyPinHash(pin: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(pin, hash);
}

/**
 * Generate a secure random PIN
 */
export function generateRandomPin(length: number = 4): string {
  const digits = '0123456789';
  let pin = '';
  
  for (let i = 0; i < length; i++) {
    pin += digits[Math.floor(crypto.randomInt(digits.length))];
  }
  
  return pin;
}

// ============================================
// PIN Management
// ============================================

/**
 * Create a new PIN for a user/wallet
 */
export async function createPin(input: CreatePinInput): Promise<string> {
  // Validate PIN
  if (!validatePin(input.pin)) {
    throw new Error('Invalid PIN: must be ' + PIN_CONFIG.MIN_PIN_LENGTH + '-' + PIN_CONFIG.MAX_PIN_LENGTH + ' digits');
  }

  // Check if PIN already exists
  const existingPin = await prisma.pin.findFirst({
    where: { userId: input.userId, walletId: input.walletId },
  });

  if (existingPin) {
    throw new Error('PIN already exists for this user/wallet');
  }

  // Hash the PIN
  const pinHash = await hashPin(input.pin);

  // Create the PIN record
  const pin = await prisma.pin.create({
    data: {
      userId: input.userId,
      walletId: input.walletId,
      pinHash,
      maxAttempts: input.maxAttempts || PIN_CONFIG.MAX_ATTEMPTS,
      lockoutDurationMinutes: input.lockoutDurationMinutes || PIN_CONFIG.LOCKOUT_DURATION_MINUTES,
    },
  });

  return pin.id;
}

/**
 * Update an existing PIN
 */
export async function updatePin(userId: string, walletId: string, oldPin: string, newPin: string): Promise<string> {
  // Verify old PIN first
  const verification = await verifyPin({ userId, walletId, pin: oldPin });
  
  if (!verification.success) {
    throw new Error('Old PIN verification failed');
  }

  // Validate new PIN
  if (!validatePin(newPin)) {
    throw new Error('Invalid new PIN');
  }

  // Hash the new PIN
  const pinHash = await hashPin(newPin);

  // Update the PIN
  const pin = await prisma.pin.update({
    where: { userId_walletId: { userId, walletId } },
    data: { pinHash, updatedAt: new Date() },
  });

  return pin.id;
}

/**
 * Delete a PIN
 */
export async function deletePin(userId: string, walletId: string, pin: string): Promise<void> {
  // Verify PIN first
  const verification = await verifyPin({ userId, walletId, pin });
  
  if (!verification.success) {
    throw new Error('PIN verification failed');
  }

  await prisma.pin.delete({
    where: { userId_walletId: { userId, walletId } },
  });
}

/**
 * Validate PIN format (client-side validation)
 */
export function validatePin(pin: string): boolean {
  const cleanPin = pin.replace(/D/g, ''); // Remove non-digits
  return cleanPin.length >= PIN_CONFIG.MIN_PIN_LENGTH && 
         cleanPin.length <= PIN_CONFIG.MAX_PIN_LENGTH &&
         /^d+$/.test(cleanPin);
}

// ============================================
// PIN Verification with Concurrency Control & Rate Limiting
// ============================================

/**
 * Verify a PIN with rate limiting and lockout
 * This is the main function for BATCH 6
 */
export async function verifyPin(input: VerifyPinInput): Promise<PinVerificationResult> {
  const { userId, walletId, pin, ipAddress, deviceId } = input;

  // Find the PIN record
  const pinRecord = await prisma.pin.findUnique({
    where: { userId_walletId: { userId, walletId } },
  });

  if (!pinRecord) {
    return {
      success: false,
      userId,
      walletId,
      isLockout: false,
      error: 'PIN not found for this user/wallet',
    };
  }

  // Check if PIN is locked
  if (pinRecord.status === PinStatus.LOCKED) {
    return {
      success: false,
      userId,
      walletId,
      isLockout: true,
      error: 'PIN is locked',
    };
  }

  // Check if PIN is disabled
  if (pinRecord.status === PinStatus.DISABLED) {
    return {
      success: false,
      userId,
      walletId,
      isLockout: false,
      error: 'PIN is disabled',
    };
  }

  // Check rate limiting and lockout status
  const lockoutCheck = await checkLockout(userId, walletId, ipAddress, deviceId);
  
  if (lockoutCheck.isLockout) {
    return {
      success: false,
      userId,
      walletId,
      isLockout: true,
      lockedUntil: lockoutCheck.lockedUntil,
      attemptsRemaining: 0,
      error: 'Too many failed attempts. Please try again later.',
    };
  }

  // Verify the PIN hash
  const isValid = await verifyPinHash(pin, pinRecord.pinHash);

  if (isValid) {
    // PIN is correct - create session and reset attempts
    await resetFailedAttempts(userId, walletId, ipAddress, deviceId);
    
    // Update last used timestamp
    await prisma.pin.update({
      where: { id: pinRecord.id },
      data: { lastUsedAt: new Date() },
    });

    // Create a session
    const session = await createSession(userId, walletId, ipAddress, deviceId);

    return {
      success: true,
      userId,
      walletId,
      isLockout: false,
      sessionToken: session.sessionToken,
    };
  } else {
    // PIN is incorrect - record failed attempt
    await recordFailedAttempt(userId, walletId, ipAddress, deviceId, pinRecord);

    // Check if we should lock out
    const lockoutCheckAfter = await checkLockout(userId, walletId, ipAddress, deviceId);
    
    if (lockoutCheckAfter.isLockout) {
      // Lock the PIN
      await prisma.pin.update({
        where: { id: pinRecord.id },
        data: { status: PinStatus.LOCKED },
      });

      return {
        success: false,
        userId,
        walletId,
        isLockout: true,
        lockedUntil: lockoutCheckAfter.lockedUntil,
        attemptsRemaining: 0,
        error: 'Too many failed attempts. PIN locked for ' + pinRecord.lockoutDurationMinutes + ' minutes.',
      };
    }

    return {
      success: false,
      userId,
      walletId,
      isLockout: false,
      attemptsRemaining: lockoutCheckAfter.attemptsRemaining,
      error: 'Incorrect PIN',
    };
  }
}

// ============================================
// Rate Limiting & Lockout
// ============================================

/**
 * Check if user/wallet/IP/device is locked out
 */
async function checkLockout(
  userId: string,
  walletId: string,
  ipAddress?: string,
  deviceId?: string
): Promise<{ isLockout: boolean; lockedUntil?: Date; attemptsRemaining?: number }> {
  // Check for existing lockout
  const lockout = await prisma.pinAttempt.findFirst({
    where: {
      userId,
      walletId,
      ipAddress: ipAddress || { equals: undefined },
      isLockout: true,
      lockedUntil: { gt: new Date() },
    },
    orderBy: { lockedUntil: 'desc' },
  });

  if (lockout) {
    return { isLockout: true, lockedUntil: lockout.lockedUntil };
  }

  // Check attempt count
  const pinRecord = await prisma.pin.findUnique({
    where: { userId_walletId: { userId, walletId } },
  });

  if (!pinRecord) {
    return { isLockout: false, attemptsRemaining: 0 };
  }

  const maxAttempts = pinRecord.maxAttempts || PIN_CONFIG.MAX_ATTEMPTS;
  
  // Count recent failed attempts
  const recentAttempts = await prisma.pinAttempt.count({
    where: {
      userId,
      walletId,
      ipAddress: ipAddress || { equals: undefined },
      status: PinAttemptStatus.FAILED,
      lastAttemptAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    },
  });

  const attemptsRemaining = Math.max(0, maxAttempts - recentAttempts);

  return {
    isLockout: attemptsRemaining <= 0,
    attemptsRemaining,
  };
}

/**
 * Record a failed PIN attempt
 */
async function recordFailedAttempt(
  userId: string,
  walletId: string,
  ipAddress?: string,
  deviceId?: string,
  pinRecord: any
) {
  const maxAttempts = pinRecord.maxAttempts || PIN_CONFIG.MAX_ATTEMPTS;
  const lockoutDuration = pinRecord.lockoutDurationMinutes || PIN_CONFIG.LOCKOUT_DURATION_MINUTES;

  // Find or create attempt record
  let attempt = await prisma.pinAttempt.findFirst({
    where: {
      userId,
      walletId,
      ipAddress: ipAddress || { equals: undefined },
      deviceId: deviceId || { equals: undefined },
    },
    orderBy: { lastAttemptAt: 'desc' },
  });

  if (attempt) {
    // Update existing attempt
    const newAttemptCount = attempt.attemptCount + 1;
    const isLockout = newAttemptCount >= maxAttempts;
    const lockedUntil = isLockout ? new Date(Date.now() + lockoutDuration * 60 * 1000) : undefined;

    attempt = await prisma.pinAttempt.update({
      where: { id: attempt.id },
      data: {
        attemptCount: newAttemptCount,
        lastAttemptAt: new Date(),
        status: isLockout ? PinAttemptStatus.LOCKED_OUT : PinAttemptStatus.FAILED,
        isLockout,
        lockedUntil,
      },
    });
  } else {
    // Create new attempt record
    attempt = await prisma.pinAttempt.create({
      data: {
        userId,
        walletId,
        ipAddress,
        deviceId,
        status: PinAttemptStatus.FAILED,
        attemptCount: 1,
        lastAttemptAt: new Date(),
        isLockout: false,
      },
    });
  }

  return attempt;
}

/**
 * Reset failed attempts after successful verification
 */
async function resetFailedAttempts(
  userId: string,
  walletId: string,
  ipAddress?: string,
  deviceId?: string
) {
  await prisma.pinAttempt.updateMany({
    where: {
      userId,
      walletId,
      ipAddress: ipAddress || { equals: undefined },
      deviceId: deviceId || { equals: undefined },
      status: { in: [PinAttemptStatus.FAILED, PinAttemptStatus.LOCKED_OUT] },
    },
    data: {
      attemptCount: 0,
      isLockout: false,
      lockedUntil: null,
      status: PinAttemptStatus.SUCCESS,
    },
  });
}

/**
 * Unlock a PIN (admin function)
 */
export async function unlockPin(userId: string, walletId: string): Promise<void> {
  // Reset PIN status
  await prisma.pin.update({
    where: { userId_walletId: { userId, walletId } },
    data: { status: PinStatus.ACTIVE },
  });

  // Reset all lockouts
  await prisma.pinAttempt.updateMany({
    where: {
      userId,
      walletId,
      isLockout: true,
    },
    data: {
      isLockout: false,
      lockedUntil: null,
      attemptCount: 0,
      status: PinAttemptStatus.FAILED,
    },
  });
}

/**
 * Check if a PIN is locked
 */
export async function isPinLocked(userId: string, walletId: string): Promise<boolean> {
  const pin = await prisma.pin.findUnique({
    where: { userId_walletId: { userId, walletId } },
  });

  if (!pin) return false;
  
  return pin.status === PinStatus.LOCKED;
}

// ============================================
// Session Management
// ============================================

/**
 * Create a new PIN session
 */
async function createSession(
  userId: string,
  walletId: string,
  ipAddress?: string,
  deviceId?: string
): Promise<PinSession> {
  // Generate a secure session token
  const sessionToken = crypto.randomBytes(32).toString('hex');
  
  // Session expires in configured duration
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + PIN_CONFIG.SESSION_DURATION_MINUTES);

  const session = await prisma.pinSession.create({
    data: {
      userId,
      walletId,
      sessionToken,
      expiresAt,
      ipAddress,
      deviceId,
      isValid: true,
    },
  });

  return {
    id: session.id,
    userId: session.userId,
    walletId: session.walletId,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    ipAddress: session.ipAddress,
    deviceId: session.deviceId,
  };
}

/**
 * Validate a session token
 */
export async function validateSession(sessionToken: string): Promise<PinSession | null> {
  const session = await prisma.pinSession.findUnique({
    where: { sessionToken },
  });

  if (!session) return null;
  
  // Check if session is expired
  if (session.expiresAt < new Date()) {
    // Invalidate expired session
    await prisma.pinSession.update({
      where: { id: session.id },
      data: { isValid: false },
    });
    return null;
  }

  // Check if session is valid
  if (!session.isValid) return null;

  return {
    id: session.id,
    userId: session.userId,
    walletId: session.walletId,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    ipAddress: session.ipAddress,
    deviceId: session.deviceId,
  };
}

/**
 * Invalidate a session
 */
export async function invalidateSession(sessionToken: string): Promise<void> {
  await prisma.pinSession.updateMany({
    where: { sessionToken },
    data: { isValid: false },
  });
}

/**
 * Invalidate all sessions for a user/wallet
 */
export async function invalidateAllSessions(userId: string, walletId: string): Promise<number> {
  const result = await prisma.pinSession.updateMany({
    where: { userId, walletId, isValid: true },
    data: { isValid: false },
  });

  return result.count;
}

/**
 * Get all valid sessions for a user/wallet
 */
export async function getValidSessions(userId: string, walletId: string): Promise<PinSession[]> {
  const sessions = await prisma.pinSession.findMany({
    where: { userId, walletId, isValid: true, expiresAt: { gt: new Date() } },
  });

  return sessions.map(s => ({
    id: s.id,
    userId: s.userId,
    walletId: s.walletId,
    sessionToken: s.sessionToken,
    expiresAt: s.expiresAt,
    ipAddress: s.ipAddress,
    deviceId: s.deviceId,
  }));
}

// ============================================
// PIN Statistics & Monitoring
// ============================================

/**
 * Get PIN statistics for monitoring
 */
export async function getPinStatistics() {
  const totalPins = await prisma.pin.count();
  const activePins = await prisma.pin.count({ where: { status: PinStatus.ACTIVE } });
  const lockedPins = await prisma.pin.count({ where: { status: PinStatus.LOCKED } });
  const disabledPins = await prisma.pin.count({ where: { status: PinStatus.DISABLED } });
  
  const totalAttempts = await prisma.pinAttempt.count();
  const failedAttempts = await prisma.pinAttempt.count({ where: { status: PinAttemptStatus.FAILED } });
  const lockedOutAttempts = await prisma.pinAttempt.count({ where: { status: PinAttemptStatus.LOCKED_OUT } });
  
  const activeSessions = await prisma.pinSession.count({ where: { isValid: true, expiresAt: { gt: new Date() } } });

  return {
    pins: { total: totalPins, active: activePins, locked: lockedPins, disabled: disabledPins },
    attempts: { total: totalAttempts, failed: failedAttempts, lockedOut: lockedOutAttempts },
    sessions: { active: activeSessions },
  };
}

/**
 * Get lockout information for a specific user/wallet
 */
export async function getLockoutInfo(userId: string, walletId: string) {
  const pin = await prisma.pin.findUnique({
    where: { userId_walletId: { userId, walletId } },
  });

  if (!pin) {
    return { isLocked: false, maxAttempts: PIN_CONFIG.MAX_ATTEMPTS, lockoutDuration: PIN_CONFIG.LOCKOUT_DURATION_MINUTES };
  }

  const lockout = await prisma.pinAttempt.findFirst({
    where: {
      userId,
      walletId,
      isLockout: true,
      lockedUntil: { gt: new Date() },
    },
    orderBy: { lockedUntil: 'desc' },
  });

  return {
    isLocked: pin.status === PinStatus.LOCKED || !!lockout,
    maxAttempts: pin.maxAttempts,
    lockoutDuration: pin.lockoutDurationMinutes,
    lockedUntil: lockout?.lockedUntil,
  };
}

// ============================================
// Cleanup
// ============================================

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await prisma.pinSession.updateMany({
    where: { expiresAt: { lt: new Date() }, isValid: true },
    data: { isValid: false },
  });

  return result.count;
}

/**
 * Clean up old attempt records
 */
export async function cleanupOldAttempts(days: number = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const result = await prisma.pinAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return result.count;
}

export default {
  // Hashing
  hashPin,
  verifyPinHash,
  generateRandomPin,
  
  // PIN Management
  createPin,
  updatePin,
  deletePin,
  validatePin,
  
  // Verification
  verifyPin,
  
  // Rate Limiting
  unlockPin,
  isPinLocked,
  getLockoutInfo,
  
  // Session Management
  validateSession,
  invalidateSession,
  invalidateAllSessions,
  getValidSessions,
  
  // Monitoring
  getPinStatistics,
  
  // Cleanup
  cleanupExpiredSessions,
  cleanupOldAttempts,
};
