export const CACHE = {
  // Redis configuration
  REDIS: {
    URL: process.env.REDIS_URL || 'redis://localhost:6379',
    HOST: process.env.REDIS_HOST || 'localhost',
    PORT: parseInt(process.env.REDIS_PORT || '6379'),
    PASSWORD: process.env.REDIS_PASSWORD || '',
    DB: parseInt(process.env.REDIS_DB || '0'),
    
    // Connection settings
    MAX_RETRIES: 5,
    RETRY_STRATEGY: {
      min: 100,
      max: 5000,
      factor: 2,
    },
    
    // Timeouts
    CONNECT_TIMEOUT: 5000,
    SOCKET_TIMEOUT: 10000,
    
    // Connection pool
    POOL: {
      min: 1,
      max: 10,
    },
  },
  
  // Cache TTLs (in seconds)
  TTL: {
    // User data
    USER: 300, // 5 minutes
    USER_SESSION: 86400, // 24 hours
    
    // Wallet data
    WALLET_BALANCE: 60, // 1 minute
    WALLET_TRANSACTIONS: 120, // 2 minutes
    
    // Payment data
    PAYMENT_REQUEST: 900, // 15 minutes
    PAYMENT_STATUS: 60, // 1 minute
    
    // QR codes
    QR_CODE: 900, // 15 minutes
    
    // Agent data
    AGENT: 600, // 10 minutes
    AGENT_LIST: 300, // 5 minutes
    
    // Reporting
    REPORT: 3600, // 1 hour
    
    // Rate limiting
    RATE_LIMIT: 60, // 1 minute
  },
  
  // Cache prefixes
  PREFIX: {
    USER: 'user',
    WALLET: 'wallet',
    PAYMENT: 'payment',
    QR: 'qr',
    AGENT: 'agent',
    SESSION: 'session',
    RATE_LIMIT: 'ratelimit',
    FEATURE_FLAG: 'feature',
  },
  
  // Cache keys
  KEYS: {
    user: (userId: string) => `${CACHE.PREFIX.USER}:${userId}`,
    walletBalance: (userId: string) => `${CACHE.PREFIX.WALLET}:${userId}:balance`,
    walletTransactions: (userId: string) => `${CACHE.PREFIX.WALLET}:${userId}:transactions`,
    payment: (paymentId: string) => `${CACHE.PREFIX.PAYMENT}:${paymentId}`,
    qrCode: (qrId: string) => `${CACHE.PREFIX.QR}:${qrId}`,
    agent: (agentId: string) => `${CACHE.PREFIX.AGENT}:${agentId}`,
    session: (sessionId: string) => `${CACHE.PREFIX.SESSION}:${sessionId}`,
    rateLimit: (identifier: string) => `${CACHE.PREFIX.RATE_LIMIT}:${identifier}`,
    featureFlag: (flagName: string) => `${CACHE.PREFIX.FEATURE_FLAG}:${flagName}`,
  },
}

export type CacheConfig = typeof CACHE
