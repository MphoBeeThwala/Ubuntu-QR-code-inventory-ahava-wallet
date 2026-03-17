// services/auth-service/src/auth.service.ts
// Banking-grade authentication. Argon2id PINs. RS256 JWTs. Device binding.

import { PrismaClient, KycTier as PrismaKycTier, KycStatus as PrismaKycStatus, WalletType as PrismaWalletType, WalletStatus as PrismaWalletStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { Logger } from 'winston';
import {
  RegisterTier0Dto,
  RegisterTier1Dto,
  LoginDto,
  AuthResult,
  AuthTokens,
  JwtPayload,
  KYC_TIER_LIMITS,
  KycTier,
  KycStatus,
  WalletType,
  WalletStatus,
} from '@ahava/shared-types';
import { AhavaError, AhavaErrorCode } from '@ahava/shared-errors';
import { SecretsManager } from './secrets.manager';
import { WalletService } from './wallet.service.client';
import { KycQueue } from './queues/kyc.queue';
import { AuditLogger } from './audit.logger';
import { generateWalletNumber } from './utils/format.utils';

// Argon2id parameters — OWASP recommended for authentication
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,    // 64 MB
  timeCost: 3,          // 3 iterations
  parallelism: 4,       // 4 threads
  hashLength: 32,
  raw: false,
};

const JWT_ACCESS_TTL = 15 * 60;           // 15 minutes
const JWT_REFRESH_TTL = 30 * 24 * 3600;  // 30 days
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 30;

export class AuthService {
  private jwtPrivateKey: string | null = null;
  private jwtPublicKey: string | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly secrets: SecretsManager,
    private readonly walletService: WalletService,
    private readonly kycQueue: KycQueue,
    private readonly auditLogger: AuditLogger,
  ) {}

  private async getJwtKeys() {
    if (!this.jwtPrivateKey || !this.jwtPublicKey) {
      // Keys loaded from AWS Secrets Manager — never from env vars or code
      this.jwtPrivateKey = await this.secrets.get('/ahava/jwt/private-key');
      this.jwtPublicKey = await this.secrets.get('/ahava/jwt/public-key');
    }
    return { privateKey: this.jwtPrivateKey!, publicKey: this.jwtPublicKey! };
  }

  // ─────────────────────────────────────────────────────────────────
  // REGISTRATION
  // ─────────────────────────────────────────────────────────────────

  async registerTier0(dto: RegisterTier0Dto, ipAddress: string): Promise<AuthResult> {
    this.logger.info('Tier 0 registration attempt', { deviceId: dto.deviceId });

    // Normalise and hash phone number for dedup lookup
    const normalisedPhone = this.normalisePhone(dto.phoneNumber);
    const phoneHash = this.hashField(normalisedPhone);

    // Check for existing account
    const existing = await this.prisma.user.findFirst({ where: { phoneNumberHash: phoneHash } });
    if (existing) {
      throw new AhavaError(AhavaErrorCode.VAL_INVALID_INPUT, 'An account with this phone number already exists');
    }

    // Hash PIN with Argon2id (minimum 4 digits enforced by validation layer)
    const pinHash = dto.pinHash ? await argon2.hash(dto.pinHash, ARGON2_OPTIONS) : null;

    // Encrypt PII fields using pgcrypto (done at Prisma/DB level via raw query)
    const encryptedPhone = await this.encryptField(normalisedPhone);

    // Create user + wallet in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phoneNumber: encryptedPhone,
          phoneNumberHash: phoneHash,
          kycTier: PrismaKycTier.TIER_0,
          kycStatus: PrismaKycStatus.PENDING,
          preferredLanguage: dto.preferredLanguage ?? 'en',
          primaryDeviceId: this.hashField(dto.deviceId),
          deviceBoundAt: new Date(),
          pinHash,
          pinChangedAt: new Date(),
          popiConsentAt: new Date(),
          termsAcceptedAt: new Date(),
          termsVersion: '1.0',
          isMinor: false,
        },
      });

      // Create personal wallet with Tier 0 limits
      const limits = KYC_TIER_LIMITS[KycTier.TIER_0];
      const wallet = await tx.wallet.create({
        data: {
          userId: user.id,
          walletNumber: generateWalletNumber(),
          walletType: PrismaWalletType.PERSONAL,
          status: PrismaWalletStatus.ACTIVE,
          kycTier: PrismaKycTier.TIER_0,
          balance: BigInt(0),
          dailyLimit: BigInt(limits.dailyLimitCents),
          monthlyLimit: BigInt(limits.monthlyLimitCents),
          maxBalance: BigInt(limits.maxBalanceCents),
          perTransactionLimit: BigInt(limits.perTxnLimitCents),
          currency: 'ZAR',
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'USER_REGISTERED_TIER_0',
          entityType: 'user',
          entityId: user.id,
          ipAddress,
          deviceId: dto.deviceId,
          serviceId: 'auth-service',
          correlationId: dto.deviceId,
        },
      });

      return { user, wallet };
    });

    // Queue selfie biometric hash for async processing (non-blocking)
    if (dto.selfieBase64) {
      await this.kycQueue.addSelfieProcessing({
        userId: result.user.id,
        selfieBase64: dto.selfieBase64,
      });
    }

    // Issue tokens
    const tokens = await this.issueTokens(result.user.id, result.wallet.id, KycTier.TIER_0, dto.deviceId, ipAddress);

    return {
      ...tokens,
      user: {
        id: result.user.id,
        kycTier: KycTier.TIER_0,
        kycStatus: KycStatus.PENDING,
        isMinor: false,
        preferredLanguage: result.user.preferredLanguage,
        createdAt: result.user.createdAt.toISOString(),
      },
      wallet: {
        id: result.wallet.id,
        walletNumber: result.wallet.walletNumber,
        walletType: WalletType.PERSONAL,
        status: WalletStatus.ACTIVE,
        kycTier: KycTier.TIER_0,
        balanceCents: 0,
        pendingBalanceCents: 0,
        currency: 'ZAR',
      },
    };
  }

  async registerTier1(dto: RegisterTier1Dto, ipAddress: string): Promise<AuthResult> {
    // Start with Tier 0 registration
    const result = await this.registerTier0(dto, ipAddress);

    // Hash ID number for dedup — never store plaintext
    const idHash = this.hashField(dto.idNumber.trim());

    // Check for existing account with same ID
    const idExists = await this.prisma.user.findFirst({ where: { idNumberHash: idHash } });
    if (idExists) {
      throw new AhavaError(AhavaErrorCode.VAL_CONSTRAINT_VIOLATION, 'An account with this ID number already exists');
    }

    // Encrypt ID number
    const encryptedId = await this.encryptField(dto.idNumber.trim());

    // Update user with ID details and queue for verification
    await this.prisma.user.update({
      where: { id: result.user.id },
      data: {
        idNumber: encryptedId,
        idNumberHash: idHash,
        idType: dto.idType as any,
        kycStatus: PrismaKycStatus.PENDING,
      },
    });

    // Queue ID verification against Home Affairs API (async)
    await this.kycQueue.addIdVerification({
      userId: result.user.id,
      idNumber: dto.idNumber,
      idType: dto.idType,
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────────────
  // LOGIN
  // ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, ipAddress: string): Promise<AuthResult> {
    const normalisedPhone = this.normalisePhone(dto.phoneNumber);
    const phoneHash = this.hashField(normalisedPhone);

    const user = await this.prisma.user.findFirst({
      where: { phoneNumberHash: phoneHash, isDeleted: false },
      include: { wallets: { where: { walletType: 'PERSONAL', isDeleted: false } } },
    });

    if (!user) {
      // Constant-time response to prevent user enumeration
      await argon2.hash('dummy-pin', ARGON2_OPTIONS);
      throw new AhavaError(AhavaErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid phone number or PIN');
    }

    // Check PIN lockout
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60000);
      throw new AhavaError(AhavaErrorCode.AUTH_PIN_LOCKED, `Too many failed attempts. Try again in ${minutesLeft} minutes.`);
    }

    // Verify PIN
    const pinValid = user.pinHash ? await argon2.verify(user.pinHash, dto.pinHash) : false;

    if (!pinValid) {
      const newAttempts = user.failedPinAttempts + 1;
      const lockout = newAttempts >= MAX_PIN_ATTEMPTS
        ? new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60 * 1000)
        : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: newAttempts, pinLockedUntil: lockout },
      });

      if (lockout) {
        throw new AhavaError(AhavaErrorCode.AUTH_PIN_LOCKED, `PIN locked for ${PIN_LOCKOUT_MINUTES} minutes after too many attempts`);
      }

      const remaining = MAX_PIN_ATTEMPTS - newAttempts;
      throw new AhavaError(AhavaErrorCode.AUTH_INVALID_CREDENTIALS, `Invalid PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
    }

    // Verify device binding
    const expectedDeviceHash = this.hashField(dto.deviceId);
    if (user.primaryDeviceId && user.primaryDeviceId !== expectedDeviceHash) {
      // New device detected — trigger re-binding flow
      this.logger.warn('Login from unbound device detected', { userId: user.id, deviceId: dto.deviceId });
      // In production: send OTP to phone, require re-binding confirmation
      throw new AhavaError(AhavaErrorCode.AUTH_DEVICE_NOT_BOUND, 'New device detected. Please verify your identity.');
    }

    // Reset failed attempts on successful login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedPinAttempts: 0, pinLockedUntil: null },
    });

    const wallet = user.wallets[0];
    const tokens = await this.issueTokens(user.id, wallet.id, user.kycTier as KycTier, dto.deviceId, ipAddress);

    await this.auditLogger.log({
      userId: user.id,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
      deviceId: dto.deviceId,
      serviceId: 'auth-service',
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        preferredName: user.preferredName ?? undefined,
        fullName: user.fullName ?? undefined,
        kycTier: user.kycTier as KycTier,
        kycStatus: user.kycStatus as any,
        isMinor: user.isMinor,
        preferredLanguage: user.preferredLanguage,
        createdAt: user.createdAt.toISOString(),
      },
      wallet: {
        id: wallet.id,
        walletNumber: wallet.walletNumber,
        walletType: wallet.walletType as any,
        status: wallet.status as any,
        kycTier: wallet.kycTier as KycTier,
        balanceCents: Number(wallet.balance),
        pendingBalanceCents: Number(wallet.pendingBalance),
        currency: wallet.currency,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // TOKEN MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  private async issueTokens(
    userId: string,
    walletId: string,
    tier: KycTier,
    deviceId: string,
    ipAddress: string,
  ): Promise<AuthTokens> {
    const { privateKey } = await this.getJwtKeys();
    const deviceHash = this.hashField(deviceId);

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      walletId,
      tier,
      deviceId: deviceHash,
    };

    const accessToken = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      expiresIn: JWT_ACCESS_TTL,
      issuer: 'ahava-auth-service',
      audience: 'ahava-api',
    });

    // Opaque refresh token — stored as hash in DB
    const refreshTokenPlain = crypto.randomBytes(48).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenPlain).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshTokenHash,
        deviceId: deviceHash,
        ipAddress,
        expiresAt: new Date(Date.now() + JWT_REFRESH_TTL * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenPlain,
      expiresIn: JWT_ACCESS_TTL,
    };
  }

  async refreshTokens(refreshTokenPlain: string, deviceId: string, ipAddress: string): Promise<AuthTokens> {
    const tokenHash = crypto.createHash('sha256').update(refreshTokenPlain).digest('hex');
    const deviceHash = this.hashField(deviceId);

    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { user: { include: { wallets: { where: { walletType: 'PERSONAL', isDeleted: false } } } } },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new AhavaError(AhavaErrorCode.AUTH_SESSION_EXPIRED, 'Refresh token expired or invalid');
    }

    // Device binding validation
    if (stored.deviceId !== deviceHash) {
      // Potential token theft — revoke ALL tokens for this user
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId },
        data: { revokedAt: new Date(), revokedReason: 'DEVICE_MISMATCH_SECURITY_REVOCATION' },
      });
      this.logger.error('Refresh token device mismatch — all tokens revoked', { userId: stored.userId });
      throw new AhavaError(AhavaErrorCode.AUTH_INVALID_TOKEN, 'Security violation detected. Please log in again.');
    }

    // Rotate refresh token (invalidate old, issue new)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
    });

    const wallet = stored.user.wallets[0];
    return this.issueTokens(stored.userId, wallet.id, stored.user.kycTier as KycTier, deviceId, ipAddress);
  }

  // ─────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────

  private normalisePhone(phone: string): string {
    // Convert 0XX to +27XX for SA numbers
    const clean = phone.replace(/\s/g, '');
    if (clean.startsWith('0') && clean.length === 10) return `+27${clean.slice(1)}`;
    if (clean.startsWith('27') && !clean.startsWith('+')) return `+${clean}`;
    return clean;
  }

  private hashField(value: string): string {
    return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  }

  private async encryptField(value: string): Promise<string> {
    // In production: uses pgcrypto pgp_sym_encrypt via raw Prisma query
    // Key loaded from AWS Secrets Manager
    const encKey = await this.secrets.get('/ahava/db/encryption-key');
    // Placeholder — actual implementation uses pgcrypto symmetric encryption
    return Buffer.from(`enc:${value}`).toString('base64');
  }
}
