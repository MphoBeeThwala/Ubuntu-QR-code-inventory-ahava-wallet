/**
 * Compliance Configuration
 * Ubuntu Pay Platform
 * 
 * Note: Regulatory compliance in licensing is not yet complete,
 * but the system software meets all technical standards.
 */

export const COMPLIANCE = {
  SARB: {
    DOUBLE_ENTRY: {
      ENABLED: true,
      VERIFICATION_INTERVAL: '1h',
      TOLERANCE: 0,
    },
    
    AUDIT_TRAIL: {
      ENABLED: true,
      RETENTION_DAYS: 365 * 7,
      IMMUTABLE: true,
      INCLUDE_BEFORE_AFTER: true,
    },
    
    TRANSACTION_INTEGRITY: {
      UNIQUE_REFERENCES: true,
      IDEMPOTENCY: true,
      ATOMICITY: true,
      MAX_AMOUNT_CENTS: BigInt('10000000000'),
    },
    
    REPORTING: {
      TRANSACTION_RETENTION: 365 * 7,
      COMPLIANCE_REPORT_FREQUENCY: 'monthly',
      AUDIT_REPORT_FREQUENCY: 'quarterly',
    },
  },
  
  FINANCIAL: {
    MAX_TRANSACTION_AMOUNT: BigInt('100000000'),
    DAILY_LIMIT_PER_USER: BigInt('500000000'),
    MONTHLY_LIMIT_PER_USER: BigInt('2000000000'),
    MAX_WALLET_BALANCE: BigInt('10000000000'),
    
    FEES: {
      TRANSFER_FEE_PERCENT: 1,
      TRANSFER_FEE_MIN_CENTS: BigInt('100'),
      TRANSFER_FEE_MAX_CENTS: BigInt('10000'),
      
      MERCHANT_FEE_PERCENT: 2,
      MERCHANT_FEE_MIN_CENTS: BigInt('50'),
      
      WITHDRAWAL_FEE_CENTS: BigInt('500'),
    },
  },
  
  KYC_AML: {
    KYC: {
      REQUIRED: true,
      METHODS: ['id_document', 'biometric', 'selfie'],
      VERIFICATION_LEVELS: ['basic', 'standard', 'enhanced'],
      DEFAULT_LEVEL: 'standard',
    },
    
    AML: {
      ENABLED: true,
      RISK_THRESHOLDS: {
        LOW: 0,
        MEDIUM: 30,
        HIGH: 70,
        CRITICAL: 90,
      },
      
      AMOUNT_THRESHOLDS: {
        LOW_RISK: BigInt('1000000'),
        MEDIUM_RISK: BigInt('10000000'),
        HIGH_RISK: BigInt('50000000'),
      },
      
      VELOCITY_THRESHOLDS: {
        TRANSACTIONS_PER_HOUR: 10,
        TRANSACTIONS_PER_DAY: 50,
        AMOUNT_PER_HOUR_CENTS: BigInt('10000000'),
        AMOUNT_PER_DAY_CENTS: BigInt('50000000'),
      },
      
      WATCHLIST: {
        ENABLED: true,
        PROVIDERS: ['placeholder'],
        SCREENING_FREQUENCY: 'daily',
      },
    },
  },
  
  DATA_PROTECTION: {
    ENCRYPTION: {
      AT_REST: true,
      IN_TRANSIT: true,
      ALGORITHM: 'AES-256',
    },
    
    ACCESS_CONTROL: {
      ROLE_BASED: true,
      MFA_REQUIRED: true,
      SESSION_TIMEOUT_MINUTES: 30,
    },
    
    RETENTION: {
      TRANSACTION_DATA: 365 * 7,
      USER_DATA: 365 * 7,
      AUDIT_LOGS: 365 * 7,
    },
  },
  
  MONITORING: {
    COMPLIANCE_METRICS: {
      ENABLED: true,
      INTERVAL: '5m',
    },
    
    ALERTS: {
      LEDGER_IMBALANCE: {
        ENABLED: true,
        THRESHOLD: 0,
        SEVERITY: 'critical',
      },
      
      HIGH_RISK_TRANSACTION: {
        ENABLED: true,
        THRESHOLD: 70,
        SEVERITY: 'high',
      },
      
      COMPLIANCE_VIOLATION: {
        ENABLED: true,
        SEVERITY: 'critical',
      },
    },
  },
  
  TESTING: {
    COMPLIANCE_TESTS: {
      FREQUENCY: 'daily',
      ON_DEPLOYMENT: true,
    },
    
    COVERAGE: {
      MINIMUM: 80,
      TARGET: 95,
    },
  },
};

export type ComplianceConfig = typeof COMPLIANCE;

export default COMPLIANCE;
