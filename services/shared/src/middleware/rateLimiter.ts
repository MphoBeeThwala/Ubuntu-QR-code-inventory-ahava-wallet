import { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import slowDown from 'express-slow-down'

// Rate limiting configuration
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later.',
    retryAfter: '15 minutes',
  },
  keyGenerator: (req: Request) => {
    return req.ip // Use IP address for rate limiting
  },
  skip: (req: Request) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/ready' || req.path === '/live'
  },
})

export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 login attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts, please try again later.',
    retryAfter: '1 hour',
  },
  keyGenerator: (req: Request) => {
    return req.ip
  },
  skip: (req: Request) => {
    return req.path === '/health' || req.path === '/ready' || req.path === '/live'
  },
})

export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each user to 10 payment requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many payment requests, please try again later.',
    retryAfter: '1 minute',
  },
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise IP
    return (req as any).user?.id || req.ip
  },
  skip: (req: Request) => {
    return req.path === '/health' || req.path === '/ready' || req.path === '/live'
  },
})

// Slow down responses when approaching limit
export const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per 15 minutes, then...
  delayMs: 500, // begin adding 500ms of delay per request above 50
  maxDelayMs: 5000, // maximum delay of 5 seconds
  keyGenerator: (req: Request) => req.ip,
  skip: (req: Request) => {
    return req.path === '/health' || req.path === '/ready' || req.path === '/live'
  },
})

// Apply rate limiting based on route
export function applyRateLimiting(req: Request, res: Response, next: NextFunction) {
  if (req.path.includes('/auth/login') || req.path.includes('/auth/register')) {
    return authLimiter(req, res, next)
  } else if (req.path.includes('/payment') || req.path.includes('/transfer')) {
    return paymentLimiter(req, res, next)
  } else {
    return apiLimiter(req, res, next)
  }
}