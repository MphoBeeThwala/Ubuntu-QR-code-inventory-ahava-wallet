/**
 * Compliance Target Policy — Ubuntu Pay Platform
 *
 * This is a TARGET policy document, not a live configuration: nothing in
 * this codebase imports this file, and several of the flags below are not
 * actually true yet (marked inline where known). Treat every `true` here
 * as "this is the policy we're building toward," not "this is enforced
 * today" — check the actual code (or compliance_scripts.ts, which does
 * query the real database) before citing anything here as current state.
 * See SARB_COMPLIANCE_MAP.md for the up-to-date engineering-verified
 * status of what's actually implemented.
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
      // NOT YET TRUE: hash-chaining exists (prevHash/recordHash on
      // AuditLog), but the append-only DB enforcement migration
      // (audit_logs_append_only) shipped as an empty placeholder — nothing
      // currently stops an UPDATE/DELETE on audit_logs at the DB level.
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

    // Fee schedule deliberately omitted: the real, live fee logic is in
    // services/payment-service/src/main.ts (currently a flat 0.5%, 25c
    // minimum), and the DB-configurable version of it is
    // prisma's FeeConfiguration/FeeRule tables. A third static copy of
    // these numbers here would just be one more place to forget to update
    // — go to the code, not this file, for the actual fee schedule.
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
        // Real when COMPLYADVANTAGE_API_KEY is set (see aml-service's
        // ComplyAdvantageClient); without it, screening runs in stub mode
        // and always returns CLEAR. Confirm the key is actually configured
        // in whichever environment this is being checked against.
        ENABLED: true,
        PROVIDERS: ['ComplyAdvantage'],
        SCREENING_FREQUENCY: 'daily',
      },
    },
  },

  DATA_PROTECTION: {
    ENCRYPTION: {
      // PII fields (phone numbers) go through encryptPII (AES-256-GCM) —
      // not literally "everything at rest" is encrypted, just PII columns.
      AT_REST: true,
      IN_TRANSIT: true,
      ALGORITHM: 'AES-256-GCM',
    },

    ACCESS_CONTROL: {
      ROLE_BASED: true,
      // NOT YET TRUE: no MFA implementation exists anywhere in this
      // codebase (login is phone + PIN only).
      MFA_REQUIRED: false,
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
      // NOT YET TRUE: no CI workflow currently runs
      // compliance_scripts.ts's runAllComplianceChecks() on deploy.
      ON_DEPLOYMENT: false,
    },
    
    COVERAGE: {
      MINIMUM: 80,
      TARGET: 95,
    },
  },
};

export type ComplianceConfig = typeof COMPLIANCE;

export default COMPLIANCE;
