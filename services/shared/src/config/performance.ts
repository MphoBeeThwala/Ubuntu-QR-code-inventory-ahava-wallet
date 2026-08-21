export const PERFORMANCE = {
  // Cache settings
  CACHE: {
    ENABLED: process.env.CACHE_ENABLED !== 'false',
    DEFAULT_TTL: 300, // 5 minutes in seconds
    MAX_CACHE_SIZE: 1000, // Maximum number of cached items
  },
  
  // Database performance
  DATABASE: {
    POOL_MIN: 5,
    POOL_MAX: 20,
    POOL_IDLE_TIMEOUT: 30000, // 30 seconds
    QUERY_TIMEOUT: 10000, // 10 seconds
    STATEMENT_TIMEOUT: 30000, // 30 seconds
    
    // Batch operations
    BATCH_SIZE: {
      TRANSACTIONS: 100,
      LEDGER_ENTRIES: 50,
      NOTIFICATIONS: 50,
    },
    
    // Pagination defaults
    PAGINATION: {
      DEFAULT_PAGE_SIZE: 20,
      MAX_PAGE_SIZE: 100,
    },
  },
  
  // Rate limiting for performance
  RATE_LIMIT: {
    GLOBAL: {
      WINDOW_MS: 60000, // 1 minute
      MAX_REQUESTS: 1000,
    },
    PER_USER: {
      WINDOW_MS: 60000,
      MAX_REQUESTS: 100,
    },
  },
  
  // Compression
  COMPRESSION: {
    ENABLED: true,
    LEVEL: 6,
    THRESHOLD: 1024, // Bytes
  },
  
  // Request size limits
  REQUEST: {
    MAX_BODY_SIZE: '10mb',
    MAX_PARAMETER_SIZE: 1000,
  },
  
  // Response size limits
  RESPONSE: {
    MAX_SIZE: '10mb',
  },
  
  // Circuit breaker settings
  CIRCUIT_BREAKER: {
    DATABASE: {
      THRESHOLD: 5,
      RESET_TIMEOUT: 30000, // 30 seconds
    },
    REDIS: {
      THRESHOLD: 3,
      RESET_TIMEOUT: 10000, // 10 seconds
    },
    EXTERNAL: {
      THRESHOLD: 5,
      RESET_TIMEOUT: 60000, // 60 seconds
    },
  },
  
  // Retry settings
  RETRY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY: 100, // ms
    MAX_DELAY: 5000, // ms
    EXPONENTIAL_BACKOFF: true,
  },
  
  // Monitoring
  MONITORING: {
    SLOW_REQUEST_THRESHOLD: 1000, // ms
    ERROR_RATE_THRESHOLD: 0.01, // 1%
    MEMORY_THRESHOLD: 0.8, // 80%
    CPU_THRESHOLD: 0.8, // 80%
  },
  
  // Load testing
  LOAD_TEST: {
    MAX_VIRTUAL_USERS: 1000,
    DURATION: '5m',
    RAMP_UP: '1m',
    RAMP_DOWN: '1m',
  },
}

export type PerformanceConfig = typeof PERFORMANCE

// Performance metrics tracker
export class PerformanceMetrics {
  private requests: number = 0
  private errors: number = 0
  private totalResponseTime: number = 0
  private maxResponseTime: number = 0
  private minResponseTime: number = Infinity
  
  recordRequest(duration: number, error: boolean = false): void {
    this.requests++
    this.totalResponseTime += duration
    this.maxResponseTime = Math.max(this.maxResponseTime, duration)
    this.minResponseTime = Math.min(this.minResponseTime, duration)
    
    if (error) {
      this.errors++
    }
  }
  
  getAverageResponseTime(): number {
    return this.requests > 0 ? this.totalResponseTime / this.requests : 0
  }
  
  getErrorRate(): number {
    return this.requests > 0 ? this.errors / this.requests : 0
  }
  
  getStats(): {
    requests: number
    errors: number
    errorRate: number
    avgResponseTime: number
    maxResponseTime: number
    minResponseTime: number
  } {
    return {
      requests: this.requests,
      errors: this.errors,
      errorRate: this.getErrorRate(),
      avgResponseTime: this.getAverageResponseTime(),
      maxResponseTime: this.maxResponseTime,
      minResponseTime: this.minResponseTime === Infinity ? 0 : this.minResponseTime,
    }
  }
  
  reset(): void {
    this.requests = 0
    this.errors = 0
    this.totalResponseTime = 0
    this.maxResponseTime = 0
    this.minResponseTime = Infinity
  }
}

export const globalMetrics = new PerformanceMetrics()