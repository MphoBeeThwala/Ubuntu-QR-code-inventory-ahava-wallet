import { Request, Response } from "express";
import rateLimit, { RateLimitRequestHandler, Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import Redis from "ioredis";
import { AhavaError, AhavaErrorCode, createErrorResponse } from "@ahava/shared-errors";

const redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
});
redisClient.on("error", (err) => { console.error("[rate-limit] Redis error:", err.message); });

// req.deviceFingerprint comes straight from the client-supplied
// `X-Device-Id` header (see main.ts's device-fingerprinting middleware) —
// nothing verifies it, so keying on it alone let an attacker get a fresh
// rate-limit bucket on every request just by sending a different header
// value, defeating generalRateLimiter, authRateLimiter (brute-force
// protection on /auth/login), and paymentRateLimiter entirely. req.userId
// is dead weight in this fallback chain: jwtAuthMiddleware, which sets it,
// runs AFTER these limiters in main.ts's app.use() order (rate limiting
// has to cover login attempts, which by definition have no valid JWT yet),
// so it is never populated when keyGenerator runs.
//
// Keying on IP + device fingerprint together closes the free-bypass gap —
// spoofing the header no longer buys a new bucket unless the request also
// comes from a new source IP, which is a meaningfully harder resource to
// rotate at volume than an HTTP header — while still giving distinct
// buckets to different real devices sharing one IP (mobile carrier CGNAT,
// office/home NAT), which a pure-IP key would have lumped together.
export function keyGenerator(req: Request): string {
  const ip = req.ip || "unknown-ip";
  const device = req.deviceFingerprint || "unknown-device";
  return `${ip}:${device}`;
}

function rateLimitHandler(req: Request, res: Response): void {
  const err = new AhavaError(AhavaErrorCode.RATE_LIMIT_EXCEEDED, "Too many requests", { requestId: req.id });
  res.status(429).json(createErrorResponse(err));
}

function createLimiter(options: Partial<Options>): RateLimitRequestHandler {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({ sendCommand: (...args: [string, ...string[]]) => redisClient.call(...args) as Promise<any> }),
    keyGenerator,
    handler: rateLimitHandler,
    skip: (req: Request) => req.path === "/health",
    ...options,
  });
}

export const generalRateLimiter = createLimiter({ windowMs: 60 * 1000, max: 100, message: "Too many requests" });
export const authRateLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "production" ? 5 : 100, message: "Too many auth attempts" });
export const paymentRateLimiter = createLimiter({ windowMs: 60 * 1000, max: 10, message: "Too many payment requests" });

export function httpsEnforcement(req: Request, res: Response, next: Function): void {
  if (process.env.NODE_ENV !== "production") return next();
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  if (proto !== "https") return res.redirect(301, `https://${req.headers.host}${req.url}`);
  next();
}