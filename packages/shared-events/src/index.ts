/**
 * Event definitions and BullMQ queue configurations for Ahava eWallet
 * Inter-service communication via Redis-backed message queues
 *
 * Queues:
 * - payments.* — Payment service events
 * - kyc.* — KYC service events
 * - aml.* — AML screening events
 * - notifications.* — Notification dispatch events
 * - reporting.* — Reporting/compliance events
 * - wallet.* — Wallet state changes
 */

// ─────────────────────────────────────────────────────────────────
// PAYMENT EVENTS
// ─────────────────────────────────────────────────────────────────

export interface PaymentCreatedEvent {
  transactionId: string;
  walletId: string;
  userId: string;
  amountCents: number;
  feeAmountCents: number;
  paymentMethod: "UBUNTUPAY_WALLET" | "PAYSHAP" | "CASH_IN" | "CASH_OUT";
  counterpartyWalletId?: string;
  counterpartyUserId?: string;
  description?: string;
  idempotencyKey: string;
  deviceId: string;
  ipAddress: string;
  latitude?: number;
  longitude?: number;
  createdAt: string; // ISO 8601
}

export interface PaymentCompletedEvent {
  transactionId: string;
  walletId: string;
  userId: string;
  amountCents: number;
  feeAmountCents: number;
  balanceAfterCents: number;
  completedAt: string;
}

export interface PaymentFailedEvent {
  transactionId: string;
  walletId: string;
  userId: string;
  amountCents: number;
  reason: string;
  errorCode: string;
  failedAt: string;
}

export interface PaymentReversedEvent {
  transactionId: string;
  originalTransactionId: string;
  walletId: string;
  userId: string;
  amountCents: number;
  reversalReason: string;
  reversedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// KYC EVENTS
// ─────────────────────────────────────────────────────────────────

export interface UserKycProgressedEvent {
  userId: string;
  fromTier: "TIER_0" | "TIER_1" | "TIER_2" | "MERCHANT";
  toTier: "TIER_0" | "TIER_1" | "TIER_2" | "MERCHANT";
  newLimits: {
    dailyLimitCents: number;
    monthlyLimitCents: number;
    maxBalanceCents: number;
    perTransactionLimitCents: number;
  };
  progressedAt: string;
}

export interface KycDocumentUploadedEvent {
  userId: string;
  documentId: string;
  documentType: string;
  s3Key: string;
  uploadedAt: string;
}

export interface KycDocumentVerifiedEvent {
  userId: string;
  documentId: string;
  documentType: string;
  verifiedBy: string; // Admin user ID
  verifiedAt: string;
}

export interface KycDocumentRejectedEvent {
  userId: string;
  documentId: string;
  documentType: string;
  rejectionReason: string;
  rejectedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// AML EVENTS
// ─────────────────────────────────────────────────────────────────

export interface TransactionScreenedForAmlEvent {
  transactionId: string;
  walletId: string;
  userId: string;
  amountCents: number;
  screeningRef: string;
  riskScore: number; // 0-100
  flagsTriggered: string[]; // e.g., ["VELOCITY", "GEO_ANOMALY"]
  screenedAt: string;
}

export interface AmlFlagRaisedEvent {
  flagId: string;
  userId?: string;
  walletId?: string;
  transactionId?: string;
  flagType: "VELOCITY" | "ROUND_TRIP" | "STRUCTURING" | "SANCTIONS_MATCH" | "GEO_ANOMALY" | "PEP_FLAG";
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskScore: number;
  description: string;
  evidenceJson: Record<string, unknown>;
  raisedAt: string;
}

export interface SanctionsScreeningMatchEvent {
  screeningId: string;
  userId?: string;
  transactionId?: string;
  matchCount: number;
  bestMatchScore: number;
  matchDetails: Record<string, unknown>;
  screenedAt: string;
}

export interface StrFiledEvent {
  flagId: string;
  strFilingRef: string;
  userId?: string;
  transactionId?: string;
  reason: string;
  filedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// NOTIFICATION EVENTS
// ─────────────────────────────────────────────────────────────────

export interface NotificationQueuedEvent {
  userId: string;
  channel: "PUSH" | "SMS" | "EMAIL" | "WHATSAPP";
  title?: string;
  body: string;
  metadata?: Record<string, unknown>;
  queuedAt: string;
}

export interface NotificationSentEvent {
  notificationId: string;
  userId: string;
  channel: "PUSH" | "SMS" | "EMAIL" | "WHATSAPP";
  externalRef?: string;
  sentAt: string;
}

export interface NotificationFailedEvent {
  notificationId: string;
  userId: string;
  channel: "PUSH" | "SMS" | "EMAIL" | "WHATSAPP";
  failureReason: string;
  failedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// WALLET EVENTS
// ─────────────────────────────────────────────────────────────────

export interface WalletCreatedEvent {
  walletId: string;
  userId: string;
  walletNumber: string;
  walletType: "PERSONAL" | "YOUTH" | "MERCHANT" | "AGENT" | "ESCROW" | "FEE_POOL";
  kycTier: "TIER_0" | "TIER_1" | "TIER_2" | "MERCHANT";
  createdAt: string;
}

export interface WalletSuspendedEvent {
  walletId: string;
  userId: string;
  suspendedReason: string;
  suspendedAt: string;
}

export interface WalletFrozenEvent {
  walletId: string;
  userId: string;
  frozenReason: string;
  frozenAt: string;
}

export interface WalletLimitChangedEvent {
  walletId: string;
  userId: string;
  changes: {
    dailyLimitCents?: {
      from: number;
      to: number;
    };
    monthlyLimitCents?: {
      from: number;
      to: number;
    };
    maxBalanceCents?: {
      from: number;
      to: number;
    };
  };
  changedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// REPORTING EVENTS
// ─────────────────────────────────────────────────────────────────

export interface ReportingDataCollectedEvent {
  reportId: string;
  reportType: "VAT" | "SARB_COMPLIANCE" | "RECONCILIATION" | "TRANSACTION_EXPORT";
  dataCollectionStartedAt: string;
  dataCollectionCompletedAt: string;
  recordCount: number;
  periodStart: string;
  periodEnd: string;
}

export interface VatStatementGeneratedEvent {
  statementId: string;
  periodStart: string;
  periodEnd: string;
  totalTransactionsCents: number;
  vatCollectedCents: number;
  generatedAt: string;
  s3Key: string;
}

// ─────────────────────────────────────────────────────────────────
// QUEUE NAMES
// ─────────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  // Payment processing
  PAYMENTS_CREATED: "payments:created",
  PAYMENTS_COMPLETED: "payments:completed",
  PAYMENTS_FAILED: "payments:failed",
  PAYMENTS_REVERSED: "payments:reversed",

  // KYC processing
  KYC_PROGRESSED: "kyc:progressed",
  KYC_DOCUMENT_UPLOADED: "kyc:document:uploaded",
  KYC_DOCUMENT_VERIFIED: "kyc:document:verified",
  KYC_DOCUMENT_REJECTED: "kyc:document:rejected",

  // AML screening
  TRANSACTION_SCREENED_FOR_AML: "aml:transaction:screened",
  AML_FLAG_RAISED: "aml:flag:raised",
  SANCTIONS_SCREENING_MATCH: "aml:sanctions:match",
  STR_FILED: "aml:str:filed",

  // Notifications
  NOTIFICATION_QUEUED: "notifications:queued",
  NOTIFICATION_SENT: "notifications:sent",
  NOTIFICATION_FAILED: "notifications:failed",

  // Wallet management
  WALLET_CREATED: "wallet:created",
  WALLET_SUSPENDED: "wallet:suspended",
  WALLET_FROZEN: "wallet:frozen",
  WALLET_LIMIT_CHANGED: "wallet:limit:changed",

  // Reporting
  REPORTING_DATA_COLLECTED: "reporting:data:collected",
  VAT_STATEMENT_GENERATED: "reporting:vat:statement:generated",
} as const;

// ─────────────────────────────────────────────────────────────────
// QUEUE CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────

export const QUEUE_SETTINGS = {
  defaultSettings: {
    concurrency: 10,
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // 1 hour
    },
    removeOnFail: {
      age: 86400, // 24 hours (keep for audit)
    },
  },
  high_priority: {
    concurrency: 20,
    attempts: 5,
    backoff: {
      type: "exponential" as const,
      delay: 1000,
    },
  },
  notification: {
    concurrency: 50, // High concurrency for notifications
    attempts: 5,
    backoff: {
      type: "exponential" as const,
      delay: 5000,
    },
  },
  aml: {
    concurrency: 5, // Lower concurrency for external API calls
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 10000,
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────
// EVENT TYPE DISCRIMINATOR
// ─────────────────────────────────────────────────────────────────

export type AhavaEvent =
  | { type: typeof QUEUE_NAMES.PAYMENTS_CREATED; data: PaymentCreatedEvent }
  | { type: typeof QUEUE_NAMES.PAYMENTS_COMPLETED; data: PaymentCompletedEvent }
  | { type: typeof QUEUE_NAMES.PAYMENTS_FAILED; data: PaymentFailedEvent }
  | { type: typeof QUEUE_NAMES.PAYMENTS_REVERSED; data: PaymentReversedEvent }
  | { type: typeof QUEUE_NAMES.KYC_PROGRESSED; data: UserKycProgressedEvent }
  | { type: typeof QUEUE_NAMES.KYC_DOCUMENT_UPLOADED; data: KycDocumentUploadedEvent }
  | { type: typeof QUEUE_NAMES.KYC_DOCUMENT_VERIFIED; data: KycDocumentVerifiedEvent }
  | { type: typeof QUEUE_NAMES.KYC_DOCUMENT_REJECTED; data: KycDocumentRejectedEvent }
  | { type: typeof QUEUE_NAMES.TRANSACTION_SCREENED_FOR_AML; data: TransactionScreenedForAmlEvent }
  | { type: typeof QUEUE_NAMES.AML_FLAG_RAISED; data: AmlFlagRaisedEvent }
  | { type: typeof QUEUE_NAMES.SANCTIONS_SCREENING_MATCH; data: SanctionsScreeningMatchEvent }
  | { type: typeof QUEUE_NAMES.STR_FILED; data: StrFiledEvent }
  | { type: typeof QUEUE_NAMES.NOTIFICATION_QUEUED; data: NotificationQueuedEvent }
  | { type: typeof QUEUE_NAMES.NOTIFICATION_SENT; data: NotificationSentEvent }
  | { type: typeof QUEUE_NAMES.NOTIFICATION_FAILED; data: NotificationFailedEvent }
  | { type: typeof QUEUE_NAMES.WALLET_CREATED; data: WalletCreatedEvent }
  | { type: typeof QUEUE_NAMES.WALLET_SUSPENDED; data: WalletSuspendedEvent }
  | { type: typeof QUEUE_NAMES.WALLET_FROZEN; data: WalletFrozenEvent }
  | { type: typeof QUEUE_NAMES.WALLET_LIMIT_CHANGED; data: WalletLimitChangedEvent }
  | { type: typeof QUEUE_NAMES.REPORTING_DATA_COLLECTED; data: ReportingDataCollectedEvent }
  | { type: typeof QUEUE_NAMES.VAT_STATEMENT_GENERATED; data: VatStatementGeneratedEvent };

export default {
  QUEUE_NAMES,
  QUEUE_SETTINGS,
};
