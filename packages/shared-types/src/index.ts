// packages/shared-types/src/index.ts
// Single source of truth for all TypeScript interfaces shared across services.
// These mirror the Prisma schema but are transport-layer types (camelCase, no BigInt).

// ─────────────────────────────────────────────────────────────────
// ENUMS (mirrored from Prisma — kept in sync manually)
// ─────────────────────────────────────────────────────────────────

export enum KycTier {
  TIER_0 = 'TIER_0',
  TIER_1 = 'TIER_1',
  TIER_2 = 'TIER_2',
  MERCHANT = 'MERCHANT',
}

export enum KycStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  EXPIRED = 'EXPIRED',
}

export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  FROZEN = 'FROZEN',
  CLOSED = 'CLOSED',
}

export enum WalletType {
  PERSONAL = 'PERSONAL',
  YOUTH = 'YOUTH',
  MERCHANT = 'MERCHANT',
  AGENT = 'AGENT',
}

export enum TransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
  FEE = 'FEE',
  REFUND = 'REFUND',
  REVERSAL = 'REVERSAL',
  INTEREST = 'INTEREST',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
  DISPUTED = 'DISPUTED',
}

export enum PaymentMethod {
  AHAVA_WALLET = 'UBUNTUPAY_WALLET',
  PAYSHAP = 'PAYSHAP',
  CASH_IN = 'CASH_IN',
  CASH_OUT = 'CASH_OUT',
}

export enum QrCodeType {
  STATIC = 'STATIC',
  DYNAMIC = 'DYNAMIC',
  REQUEST = 'REQUEST',
}

export enum AmlFlagSeverity {
  INFO = 'INFO',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// ─────────────────────────────────────────────────────────────────
// KYC TIER LIMITS (authoritative constants — used server-side only)
// ─────────────────────────────────────────────────────────────────

export const KYC_TIER_LIMITS = {
  [KycTier.TIER_0]: {
    dailyLimitCents: 50_000,       // R 500
    monthlyLimitCents: 200_000,    // R 2,000
    maxBalanceCents: 250_000,      // R 2,500
    perTxnLimitCents: 50_000,      // R 500
    label: 'Basic',
    description: 'Phone + selfie only',
  },
  [KycTier.TIER_1]: {
    dailyLimitCents: 200_000,      // R 2,000
    monthlyLimitCents: 1_000_000,  // R 10,000
    maxBalanceCents: 1_000_000,    // R 10,000
    perTxnLimitCents: 200_000,     // R 2,000
    label: 'Verified',
    description: 'SA ID or asylum document',
  },
  [KycTier.TIER_2]: {
    dailyLimitCents: 500_000,      // R 5,000
    monthlyLimitCents: 2_500_000,  // R 25,000
    maxBalanceCents: 2_500_000,    // R 25,000
    perTxnLimitCents: 500_000,     // R 5,000
    label: 'Full FICA',
    description: 'Full FICA verification',
  },
  [KycTier.MERCHANT]: {
    dailyLimitCents: Number.MAX_SAFE_INTEGER,
    monthlyLimitCents: Number.MAX_SAFE_INTEGER,
    maxBalanceCents: Number.MAX_SAFE_INTEGER,
    perTxnLimitCents: Number.MAX_SAFE_INTEGER,
    label: 'Merchant',
    description: 'Full FICA + business verification',
  },
} as const;

// ─────────────────────────────────────────────────────────────────
// FEE SCHEDULE (authoritative — computed server-side)
// ─────────────────────────────────────────────────────────────────

export function calculateFee(amountCents: number, isFamilyTransfer: boolean): number {
  if (isFamilyTransfer && amountCents <= 20_000) return 0; // Free under R200 family
  if (amountCents <= 10_000) return 50;   // R0.50 for R3–R100
  if (amountCents <= 50_000) return 100;  // R1.00 for R101–R500
  return Math.round(amountCents * 0.005); // 0.5% above R500
}

// ─────────────────────────────────────────────────────────────────
// API RESPONSE WRAPPER
// ─────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface ResponseMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  requestId?: string;
}

// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;         // user ID
  walletId: string;    // primary wallet ID
  tier: KycTier;
  deviceId: string;
  iat: number;
  exp: number;
}

export interface RegisterTier0Dto {
  phoneNumber: string;   // E.164 format: +27XXXXXXXXX
  selfieBase64: string;  // JPEG base64, max 2MB
  pinHash?: string;      // Argon2id hash computed client-side
  preferredLanguage?: 'en' | 'zu' | 'xh' | 'st' | 'af';
  popiConsent: true;     // Must be explicitly true
  termsAccepted: true;
  deviceId: string;
  deviceName?: string;
}

export interface RegisterTier1Dto extends RegisterTier0Dto {
  idNumber: string;      // 13-digit SA ID or document number
  idType: 'SA_ID_BOOK' | 'SA_ID_CARD' | 'PASSPORT' | 'ASYLUM_DOCUMENT' | 'REFUGEE_DOCUMENT';
}

export interface LoginDto {
  phoneNumber: string;
  pinHash: string;       // Argon2id hash computed CLIENT-SIDE before transmission
  deviceId: string;
  deviceName?: string;
  biometricToken?: string;  // Optional biometric assertion
}

export interface AuthTokens {
  accessToken: string;   // 15-minute JWT, RS256
  refreshToken: string;  // 30-day opaque token, bound to device
  expiresIn: number;     // Seconds until access token expires
}

export interface AuthResult extends AuthTokens {
  user: UserSummary;
  wallet: WalletSummary;
}

// ─────────────────────────────────────────────────────────────────
// USER
// ─────────────────────────────────────────────────────────────────

export interface UserSummary {
  id: string;
  preferredName?: string;
  fullName?: string;
  kycTier: KycTier;
  kycStatus: KycStatus;
  isMinor: boolean;
  preferredLanguage: string;
  createdAt: string;  // ISO 8601
}

export interface UserProfile extends UserSummary {
  phoneNumber: string;  // Masked: +27 XX XXX XXXX
  email?: string;
  dateOfBirth?: string;
  biometricEnabled: boolean;
  popiConsentAt?: string;
  guardianUserId?: string;
}

// ─────────────────────────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────────────────────────

export interface WalletSummary {
  id: string;
  walletNumber: string;  // AHV-XXXX-XXXX-XXXX
  walletType: WalletType;
  status: WalletStatus;
  kycTier: KycTier;
  balanceCents: number;
  pendingBalanceCents: number;
  currency: string;
}

export interface WalletDetail extends WalletSummary {
  dailyLimitCents: number;
  monthlyLimitCents: number;
  maxBalanceCents: number;
  perTransactionLimitCents: number;
  dailySpentCents: number;
  monthlySpentCents: number;
  dailyRemainingCents: number;
  monthlyRemainingCents: number;
  createdAt: string;
  youthControl?: YouthControlSummary;
}

export interface YouthControlSummary {
  guardianUserId: string;
  dailySpendLimitCents: number;
  singleTxnLimitCents: number;
  allowCashOut: boolean;
  allowedCategories?: string[];
  blockedCategories?: string[];
  notifyOnEveryTxn: boolean;
}

// ─────────────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────────────

export interface InitiatePaymentDto {
  idempotencyKey: string;       // UUID generated by client — REQUIRED
  recipientWalletId?: string;   // Internal wallet ID
  recipientWalletNumber?: string; // AHV-XXXX-XXXX — alternative to ID
  recipientPhoneNumber?: string;  // +27XX — alternative
  amountCents: number;          // In cents. Minimum: 300 (R3)
  currency?: string;            // Default ZAR
  reference?: string;           // User description, max 140 chars
  isFamilyTransfer?: boolean;   // Affects fee calculation
  paymentMethod: PaymentMethod;
  qrCodeId?: string;            // If payment initiated via QR scan
  deviceId: string;
  latitude?: number;
  longitude?: number;
}

export interface PaymentResult {
  transactionId: string;
  idempotencyKey: string;
  status: TransactionStatus;
  amountCents: number;
  feeAmountCents: number;
  totalDebitedCents: number;
  recipientName: string;
  recipientWalletNumber: string;
  reference?: string;
  completedAt?: string;
  receipt: PaymentReceipt;
}

export interface PaymentReceipt {
  transactionRef: string;       // AHV-TXN-XXXXXXXXX
  dateTime: string;             // ISO 8601 UTC
  amountFormatted: string;      // "R 50.00"
  feeFormatted: string;         // "R 0.50"
  totalFormatted: string;       // "R 50.50"
  senderWalletNumber: string;
  recipientName: string;
  recipientWalletNumber: string;
  reference?: string;
  newBalanceFormatted: string;  // "R 197.00"
}

export interface TransactionListItem {
  id: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  amountCents: number;
  feeAmountCents: number;
  direction: 'IN' | 'OUT';
  counterpartyName?: string;
  counterpartyWalletNumber?: string;
  reference?: string;
  paymentMethod: PaymentMethod;
  createdAt: string;
  completedAt?: string;
}

// ─────────────────────────────────────────────────────────────────
// QR CODES
// ─────────────────────────────────────────────────────────────────

export interface QrCodePayload {
  version: '1';
  type: QrCodeType;
  walletId: string;
  walletNumber: string;
  holderName: string;
  amountCents?: number;   // Dynamic only
  currency: string;
  qrId: string;
  issuedAt: number;       // Unix timestamp
  expiresAt?: number;     // Dynamic only
  checksum: string;       // SHA-256 of above fields + secret
}

export interface GenerateQrDto {
  type: QrCodeType;
  amountCents?: number;   // Required for DYNAMIC and REQUEST
  description?: string;
}

export interface QrCodeResult {
  qrId: string;
  qrPayload: string;      // JSON string to encode in QR
  svgData: string;        // SVG QR code for display
  pngBase64?: string;     // PNG for download
  expiresAt?: string;     // ISO 8601
}

// ─────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────

export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  channels: Array<'PUSH' | 'SMS' | 'EMAIL'>;
}

// ─────────────────────────────────────────────────────────────────
// ERROR CODES
// ─────────────────────────────────────────────────────────────────

export enum ErrorCode {
  // Auth
  INVALID_CREDENTIALS = 'AUTH_001',
  DEVICE_NOT_BOUND = 'AUTH_002',
  TOKEN_EXPIRED = 'AUTH_003',
  TOKEN_INVALID = 'AUTH_004',
  PIN_LOCKED = 'AUTH_005',
  BIOMETRIC_FAILED = 'AUTH_006',

  // Wallet
  WALLET_NOT_FOUND = 'WAL_001',
  INSUFFICIENT_BALANCE = 'WAL_002',
  DAILY_LIMIT_EXCEEDED = 'WAL_003',
  MONTHLY_LIMIT_EXCEEDED = 'WAL_004',
  MAX_BALANCE_EXCEEDED = 'WAL_005',
  WALLET_SUSPENDED = 'WAL_006',
  WALLET_FROZEN = 'WAL_007',
  PER_TXN_LIMIT_EXCEEDED = 'WAL_008',

  // Payment
  PAYMENT_BELOW_MINIMUM = 'PAY_001',
  DUPLICATE_IDEMPOTENCY_KEY = 'PAY_002',
  RECIPIENT_NOT_FOUND = 'PAY_003',
  PAYSHAP_REJECTED = 'PAY_004',
  QR_EXPIRED = 'PAY_005',
  QR_ALREADY_USED = 'PAY_006',
  QR_INVALID = 'PAY_007',
  SELF_PAYMENT = 'PAY_008',

  // KYC
  KYC_TIER_INSUFFICIENT = 'KYC_001',
  DOCUMENT_UPLOAD_FAILED = 'KYC_002',
  ID_NUMBER_DUPLICATE = 'KYC_003',

  // AML
  SANCTIONS_MATCH = 'AML_001',
  TRANSACTION_FLAGGED = 'AML_002',

  // System
  INTERNAL_ERROR = 'SYS_001',
  SERVICE_UNAVAILABLE = 'SYS_002',
  RATE_LIMITED = 'SYS_003',
  VALIDATION_ERROR = 'SYS_004',
}
