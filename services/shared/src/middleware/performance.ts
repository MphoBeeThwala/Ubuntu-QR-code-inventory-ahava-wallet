import type { Request, Response, NextFunction } from 'express'

// Response time header middleware
export function responseTimeHeader(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint()
  
  res.on('finish', () => {
    const duration = process.hrtime.bigint() - start
    const durationMs = Number(duration) / 1e6
    res.set('X-Response-Time', `${durationMs.toFixed(2)}ms`)
  })
  
  next()
}

// Request size limit middleware
export function requestSizeLimiter(maxSize: number = 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > maxSize) {
      return res.status(413).json({
        error: 'Request too large',
        maxSize: maxSize,
      })
    }
    next()
  }
}

// Compression middleware configuration
export const compressionOptions = {
  level: 6, // Optimal compression level
  threshold: 0, // Compress all responses
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression']) {
      return false
    }
    return true
  },
}

// Slow request detection
export function slowRequestDetector(thresholdMs: number = 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    
    res.on('finish', () => {
      const duration = Date.now() - start
      if (duration > thresholdMs) {
        console.warn(`Slow request: ${req.method} ${req.path} took ${duration}ms`)
      }
    })
    
    next()
  }
}

// Circuit breaker pattern
export class CircuitBreaker {
  private failures: number = 0
  private success: number = 0
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private nextAttempt: number = 0
  
  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeout: number = 30000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.nextAttempt <= Date.now()) {
        this.state = 'HALF_OPEN'
      } else {
        throw new Error('Circuit breaker is open')
      }
    }
    
    try {
      const result = await fn()
      this.success++
      this.failures = 0
      this.state = 'CLOSED'
      return result
    } catch (err) {
      this.failures++
      if (this.failures >= this.threshold) {
        this.state = 'OPEN'
        this.nextAttempt = Date.now() + this.resetTimeout
      }
      throw err
    }
  }
  
  reset(): void {
    this.failures = 0
    this.success = 0
    this.state = 'CLOSED'
    this.nextAttempt = 0
  }
  
  getStatus(): { state: string; failures: number; nextAttempt: number } {
    return {
      state: this.state,
      failures: this.failures,
      nextAttempt: this.nextAttempt,
    }
  }
}

// Create circuit breakers for different services
export const circuitBreakers = {
  database: new CircuitBreaker(5, 30000),
  redis: new CircuitBreaker(3, 10000),
  external: new CircuitBreaker(5, 60000),
}

// Retry with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number; maxDelay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 100, maxDelay = 5000 } = options
  let lastError: any
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError
}
