// Saga Types and Constants (BATCH 5)
// All monetary values in BIGINT cents - NEVER use floats

export const SAGA_TYPES = {
  PAYMENT: 'PAYMENT',
  TRANSFER: 'TRANSFER',
  WITHDRAWAL: 'WITHDRAWAL',
  DEPOSIT: 'DEPOSIT',
  REFUND: 'REFUND',
  SETTLEMENT: 'SETTLEMENT',
} as const;

export type SagaType = typeof SAGA_TYPES[keyof typeof SAGA_TYPES];

export const SAGA_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSING: 'REVERSING',
  REVERSED: 'REVERSED',
  PARTIALLY_REVERSED: 'PARTIALLY_REVERSED',
} as const;

export type SagaStatus = typeof SAGA_STATUS[keyof typeof SAGA_STATUS];

export const SAGA_STEP_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  REVERSING: 'REVERSING',
  REVERSED: 'REVERSED',
} as const;

export type SagaStepStatus = typeof SAGA_STEP_STATUS[keyof typeof SAGA_STEP_STATUS];

// Account codes for saga operations
export const SAGA_ACCOUNT_CODES = {
  RESERVED_FUNDS: 'RESERVED_FUNDS',
  AVAILABLE_BALANCE: 'AVAILABLE_BALANCE',
  HOLDING_ACCOUNT: 'HOLDING_ACCOUNT',
  SETTLEMENT_ACCOUNT: 'SETTLEMENT_ACCOUNT',
} as const;

// Default saga timeouts (in milliseconds)
export const SAGA_TIMEOUTS = {
  PAYMENT: 300000, // 5 minutes
  TRANSFER: 300000, // 5 minutes
  WITHDRAWAL: 600000, // 10 minutes
  DEPOSIT: 600000, // 10 minutes
  REFUND: 600000, // 10 minutes
  SETTLEMENT: 1800000, // 30 minutes
} as const;

// Maximum retry attempts for saga steps
export const MAX_SAGA_RETRIES = 3;

// Maximum time to wait between retries (exponential backoff)
export const MAX_RETRY_DELAY = 30000; // 30 seconds
