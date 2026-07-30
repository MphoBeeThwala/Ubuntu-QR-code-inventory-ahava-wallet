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

function keyGenerator(req: Request): string {
  return req.deviceFingerprint || req.userId || req.ip || "unknown";
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