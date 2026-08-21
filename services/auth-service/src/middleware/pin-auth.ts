import { Request, Response, NextFunction } from 'express';
import { verifyPin, validateSession, invalidateSession } from './pin-service';

/**
 * PIN Authentication Middleware (BATCH 6)
 * 
 * Provides Express middleware for PIN verification with:
 * - Session-based authentication
 * - Rate limiting
 * - Lockout protection
 * - Concurrency control
 */

// ============================================
// Configuration
// ============================================

const PIN_MIDDLEWARE_CONFIG = {
  // Session header name
  SESSION_HEADER: 'x-pin-session',
  
  // IP header name
  IP_HEADER: 'x-forwarded-for',
  
  // Device ID header name (optional)
  DEVICE_HEADER: 'x-device-id',
  
  // Error messages
  ERROR_MISSING_PIN: 'PIN is required',
  ERROR_INVALID_PIN: 'Invalid PIN',
  ERROR_LOCKED_OUT: 'Account locked due to too many failed attempts',
  ERROR_SESSION_EXPIRED: 'Session expired',
  ERROR_SESSION_INVALID: 'Invalid session',
};

// ============================================
// Middleware Functions
// ============================================

/**
 * Middleware to verify PIN and create session
 * Use this for routes that require PIN authentication
 */
export function verifyPinMiddleware(req: Request, res: Response, next: NextFunction) {
  const pin = req.headers['x-pin'] as string || req.body.pin;
  const userId = req.headers['x-user-id'] as string || req.body.userId;
  const walletId = req.headers['x-wallet-id'] as string || req.body.walletId;
  const ipAddress = req.headers[PIN_MIDDLEWARE_CONFIG.IP_HEADER] as string || req.ip;
  const deviceId = req.headers[PIN_MIDDLEWARE_CONFIG.DEVICE_HEADER] as string;

  if (!pin) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: PIN_MIDDLEWARE_CONFIG.ERROR_MISSING_PIN,
    });
  }

  if (!userId || !walletId) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'userId and walletId are required',
    });
  }

  // Verify PIN with rate limiting
  verifyPin({ userId, walletId, pin, ipAddress, deviceId })
    .then((result) => {
      if (!result.success) {
        if (result.isLockout) {
          return res.status(429).json({
            error: 'TOO_MANY_REQUESTS',
            message: PIN_MIDDLEWARE_CONFIG.ERROR_LOCKED_OUT,
            lockedUntil: result.lockedUntil?.toISOString(),
            attemptsRemaining: result.attemptsRemaining,
          });
        }
        
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: PIN_MIDDLEWARE_CONFIG.ERROR_INVALID_PIN,
          attemptsRemaining: result.attemptsRemaining,
        });
      }

      // PIN verified - attach session to request
      (req as any).pinSession = {
        userId,
        walletId,
        sessionToken: result.sessionToken,
      };

      // Attach session token to response header
      res.setHeader(PIN_MIDDLEWARE_CONFIG.SESSION_HEADER, result.sessionToken || '');
      
      next();
    })
    .catch((error) => {
      console.error('PIN verification error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'PIN verification failed',
      });
    });
}

/**
 * Middleware to validate existing session
 * Use this for routes after initial PIN verification
 */
export function validateSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const sessionToken = req.headers[PIN_MIDDLEWARE_CONFIG.SESSION_HEADER] as string;

  if (!sessionToken) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: PIN_MIDDLEWARE_CONFIG.ERROR_SESSION_INVALID,
    });
  }

  // Validate the session
  validateSession(sessionToken)
    .then((session) => {
      if (!session) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: PIN_MIDDLEWARE_CONFIG.ERROR_SESSION_EXPIRED,
        });
      }

      // Session is valid - attach to request
      (req as any).pinSession = {
        userId: session.userId,
        walletId: session.walletId,
        sessionToken: session.sessionToken,
      };

      next();
    })
    .catch((error) => {
      console.error('Session validation error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Session validation failed',
      });
    });
}

/**
 * Middleware to invalidate session on logout
 */
export function invalidateSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const sessionToken = req.headers[PIN_MIDDLEWARE_CONFIG.SESSION_HEADER] as string;

  if (sessionToken) {
    // Invalidate the session
    invalidateSession(sessionToken)
      .then(() => {
        // Clear the session header
        res.removeHeader(PIN_MIDDLEWARE_CONFIG.SESSION_HEADER);
        next();
      })
      .catch((error) => {
        console.error('Session invalidation error:', error);
        next();
      });
  } else {
    next();
  }
}

/**
 * Middleware to require fresh PIN verification
 * Use this for sensitive operations that require recent authentication
 */
export function requireFreshPinMiddleware(maxAgeMinutes: number = 5) {
  return (req: Request, res: Response, next: NextFunction) => {
    const sessionToken = req.headers[PIN_MIDDLEWARE_CONFIG.SESSION_HEADER] as string;

    if (!sessionToken) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Fresh PIN verification required',
      });
    }

    validateSession(sessionToken)
      .then((session) => {
        if (!session) {
          return res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Fresh PIN verification required',
          });
        }

        // Check session age
        const sessionAgeMinutes = (Date.now() - session.createdAt.getTime()) / (60 * 1000);
        
        if (sessionAgeMinutes > maxAgeMinutes) {
          // Session is too old - require fresh PIN
          return res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Fresh PIN verification required (session expired)',
            sessionAgeMinutes,
            maxAgeMinutes,
          });
        }

        // Session is fresh enough
        (req as any).pinSession = {
          userId: session.userId,
          walletId: session.walletId,
          sessionToken: session.sessionToken,
        };

        next();
      })
      .catch((error) => {
        console.error('Fresh PIN check error:', error);
        res.status(500).json({
          error: 'INTERNAL_ERROR',
          message: 'Fresh PIN check failed',
        });
      });
  };
}

/**
 * Middleware to check lockout status before allowing PIN attempts
 */
export function checkLockoutMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = req.headers['x-user-id'] as string || req.body.userId;
  const walletId = req.headers['x-wallet-id'] as string || req.body.walletId;
  const ipAddress = req.headers[PIN_MIDDLEWARE_CONFIG.IP_HEADER] as string || req.ip;

  if (!userId || !walletId) {
    return next(); // Skip if no user/wallet
  }

  // Import the lockout check function
  const { getLockoutInfo } = require('./pin-service');

  getLockoutInfo(userId, walletId)
    .then((info) => {
      if (info.isLocked) {
        return res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: PIN_MIDDLEWARE_CONFIG.ERROR_LOCKED_OUT,
          lockedUntil: info.lockedUntil?.toISOString(),
        });
      }

      next();
    })
    .catch((error) => {
      console.error('Lockout check error:', error);
      next();
    });
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get PIN session from request
 */
export function getPinSession(req: Request): { userId: string; walletId: string; sessionToken: string } | null {
  return (req as any).pinSession || null;
}

/**
 * Check if request has valid PIN session
 */
export function hasValidPinSession(req: Request): boolean {
  return !!(req as any).pinSession;
}

/**
 * Require PIN session - throws if not present
 */
export function requirePinSession(req: Request): { userId: string; walletId: string; sessionToken: string } {
  const session = (req as any).pinSession;
  
  if (!session) {
    throw new Error('PIN session required');
  }
  
  return session;
}

export default {
  verifyPinMiddleware,
  validateSessionMiddleware,
  invalidateSessionMiddleware,
  requireFreshPinMiddleware,
  checkLockoutMiddleware,
  getPinSession,
  hasValidPinSession,
  requirePinSession,
  PIN_MIDDLEWARE_CONFIG,
};
