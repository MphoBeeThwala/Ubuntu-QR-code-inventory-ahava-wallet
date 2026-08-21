import type { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req: Request) => req.path.includes('/health')
})

export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
  skip: (req: Request) => req.path.includes('/health')
})

export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again later.' },
  skip: (req: Request) => req.path.includes('/health')
})

export function applyRateLimiting(req: Request, res: Response, next: NextFunction) {
  if (req.path.includes('/auth/login') || req.path.includes('/auth/register')) {
    return authLimiter(req, res, next)
  } else if (req.path.includes('/payment') || req.path.includes('/transfer')) {
    return paymentLimiter(req, res, next)
  } else {
    return apiLimiter(req, res, next)
  }
}
