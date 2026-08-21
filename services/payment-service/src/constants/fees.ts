// Fee Accounting Constants (BATCH 4)
// All values in BIGINT cents - NEVER use floats for monetary values

export const FEE_TYPES = {
  TRANSACTION_FEE: 'TRANSACTION_FEE',
  WITHDRAWAL_FEE: 'WITHDRAWAL_FEE',
  DEPOSIT_FEE: 'DEPOSIT_FEE',
  SETTLEMENT_FEE: 'SETTLEMENT_FEE',
  PLATFORM_FEE: 'PLATFORM_FEE',
  AGENT_COMMISSION: 'AGENT_COMMISSION',
  SERVICE_FEE: 'SERVICE_FEE',
  FX_FEE: 'FX_FEE',
} as const;

export type FeeType = typeof FEE_TYPES[keyof typeof FEE_TYPES];

export const FEE_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  REVERSED: 'REVERSED',
  REFUNDED: 'REFUNDED',
} as const;

export type FeeStatus = typeof FEE_STATUS[keyof typeof FEE_STATUS];

// Account codes for double-entry accounting
export const FEE_ACCOUNT_CODES = {
  FEE_INCOME: 'FEE_INCOME',
  FEE_PAYABLE: 'FEE_PAYABLE',
  FEE_RECEIVABLE: 'FEE_RECEIVABLE',
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
  AGENT_COMMISSION_PAYABLE: 'AGENT_COMMISSION_PAYABLE',
  SETTLEMENT_HOLDING: 'SETTLEMENT_HOLDING',
} as const;

// Default fee configurations (in cents)
export const DEFAULT_FEES = {
  TRANSACTION_FEE_PERCENTAGE: 150n, // 1.5%
  TRANSACTION_FEE_MIN: 0n,
  TRANSACTION_FEE_MAX: 5000n, // R50.00 max
  WITHDRAWAL_FEE_FLAT: 1000n, // R10.00
  DEPOSIT_FEE_PERCENTAGE: 0n, // 0% - free deposits
  SETTLEMENT_FEE_PERCENTAGE: 50n, // 0.5%
  PLATFORM_FEE_PERCENTAGE: 20n, // 0.2%
  AGENT_COMMISSION_PERCENTAGE: 500n, // 5%
} as const;

// Calculation methods
export const CALCULATION_METHODS = {
  PERCENTAGE: 'PERCENTAGE',
  FLAT: 'FLAT',
  TIERED: 'TIERED',
} as const;

export type CalculationMethod = typeof CALCULATION_METHODS[keyof typeof CALCULATION_METHODS];
