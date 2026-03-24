/**
 * Rate Limiting Middleware — API Gateway
 *
 * Uses express-rate-limit with a Redis store so limits are shared
 * across all gateway replicas (required for K8s horizontal scaling).
 *
 * Tiers:
 *  - general:  100 req / 1 min  (all authenticated routes)
 *  - auth:       5 req / 15 min (login / device-bind — brute-force protection)
 *  - payments:  10 req / 1 min  (payment creation)
 */

import { Request, Response } from "express";
import rateLimit, {
  RateLimitRequestHandler,
  Options,
} from "express-rate-limit";
import {
  AhavaError,
  AhavaErrorCode,
  createErrorResponse,
} from "@ahava/shared-errors";

// ─── Key generator ────────────────────────────────────────────────────────────

/**
 * Rate-limit key: prefer device fingerprint, fall back to userId, then IP.
 * This prevents a single actor from bypassing limits by rotating IPs.
 */
function keyGenerator(req: Request): string {
  return req.deviceFingerprint || req.userId || req.ip || "unknown";
}

// ─── Shared handler for 429 responses ────────────────────────────────────────

function rateLimitHandler(req: Request, res: Response): void {
  const err = new AhavaError(
    AhavaErrorCode.RATE_LIMIT_EXCEEDED,
    "Too many requests — please slow down",
    { requestId: req.id },
  );
  res.status(429).json(createErrorResponse(err));
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createLimiter(options: Partial<Options>): RateLimitRequestHandler {
  return rateLimit({
    standardHeaders: true, // Return RateLimit-* headers
    legacyHeaders: false,
    keyGenerator,
    handler: rateLimitHandler,
    skip: (req: Request) => req.path === "/health", // never limit health checks
    ...options,
  });
}

// ─── Exported limiters ────────────────────────────────────────────────────────

/**
 * General limiter applied to all routes.
 * 100 requests per minute per device/user.
 */
export const generalRateLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: "Too many requests",
});

/**
 * Auth limiter for login and device-bind.
 * 5 attempts per 15 minutes in production — prevents PIN brute-force.
 * 100 attempts in development/test to avoid blocking repeated logins.
 */
export const authRateLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 5 : 100,
  message: "Too many authentication attempts",
});

/**
 * Payment limiter.
 * 10 payments per minute per device.
 */
export const paymentRateLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many payment requests",
});
