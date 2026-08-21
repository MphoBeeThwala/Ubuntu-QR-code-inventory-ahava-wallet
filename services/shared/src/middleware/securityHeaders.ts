import type { Request, Response, NextFunction } from 'express'
import helmet from 'helmet'

export const securityHeaders = helmet()

export function additionalSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  
  if (req.path.includes('/auth') || req.path.includes('/wallet') || req.path.includes('/payment')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  
  next()
}

export function securityMiddleware(req: Request, res: Response, next: NextFunction) {
  securityHeaders(req, res, () => additionalSecurityHeaders(req, res, next))
}
