import type { Request, Response, NextFunction } from 'express'
import { applyRateLimiting } from './rateLimiter'
import { securityHeaders, additionalSecurityHeaders } from './securityHeaders'
import { corsMiddleware } from '../config/cors'
import { sanitizeInput, validateBigInt } from './validation'

export function securityMiddleware(req: Request, res: Response, next: NextFunction) {
  applyRateLimiting(req, res, (err: any) => {
    if (err) return next(err)
    securityHeaders(req, res, (err: any) => {
      if (err) return next(err)
      corsMiddleware(req, res, (err: any) => {
        if (err) return next(err)
        sanitizeInput(req, res, (err: any) => {
          if (err) return next(err)
          validateBigInt(req, res, next)
        })
      })
    })
  })
}

export { applyRateLimiting } from './rateLimiter'
export { securityHeaders, additionalSecurityHeaders } from './securityHeaders'
export { sanitizeInput, validateBigInt, validateRequest } from './validation'
