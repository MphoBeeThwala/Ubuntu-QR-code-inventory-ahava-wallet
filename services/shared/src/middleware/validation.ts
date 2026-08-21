import type { Request, Response, NextFunction } from 'express'
import { validationResult } from 'express-validator'

export function validateRequest(schemas: any[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      })
    }
    next()
  }
}

export function sanitizeInput(req: Request, res: Response, next: NextFunction) {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim()
      }
    }
  }
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key].trim()
      }
    }
  }
  next()
}

export function validateBigInt(req: Request, res: Response, next: NextFunction) {
  const bigIntFields = ['amount', 'amountCents', 'balance', 'limit', 'fee']
  for (const field of bigIntFields) {
    if (req.body[field] !== undefined && req.body[field] !== null) {
      const value = req.body[field]
      if (typeof value === 'number') {
        req.body[field] = BigInt(value)
      } else if (typeof value === 'string') {
        try {
          req.body[field] = BigInt(value)
        } catch (e) {
          return res.status(400).json({ error: 'Invalid BIGINT value', field })
        }
      }
    }
  }
  next()
}
