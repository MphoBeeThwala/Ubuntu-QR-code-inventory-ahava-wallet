/**
 * JWT Verification Middleware — API Gateway
 *
 * Verifies RS256 access tokens issued by auth-service.
 * Public key is loaded once at startup from env or AWS Secrets Manager.
 * Auth routes (/auth/*) are excluded from verification.
 */

import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { parseBearerToken } from "@ahava/shared-crypto";
import {
  AhavaError,
  AhavaErrorCode,
  createErrorResponse,
} from "@ahava/shared-errors";

// Only routes that authenticate the caller by a factor OTHER than a Bearer
// JWT (PIN, refresh token, or nothing yet) belong here. Everything else
// under /auth/* and /agents/auth/* (e.g. /auth/me, /auth/logout) requires
// one — both are already called with a valid access token by every client
// (see apps/pwa/lib/api-client.ts's request interceptor and
// apps/mobile/lib/core/repositories/auth_repository.dart's logout(), which
// passes requireAuth: true), so this list used to be a "startsWith" prefix
// match covering the whole /auth/ namespace, which was broader than the
// comment on this file (and the original jwtAuthMiddleware call site)
// claimed and would have silently gone public for any future /auth/*
// route that didn't re-verify identity itself.
const PUBLIC_EXACT_PATHS = new Set([
  "/",
  "/health",
  "/auth/register",
  "/auth/login",
  "/auth/refresh",
  "/auth/device-bind",
  "/agents/auth/login",
]);

function normalizePath(path: string): string {
  if (!path) return "/";
  if (path === "/") return path;
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function isPublicPath(req: Request): boolean {
  if (req.method === "OPTIONS") {
    return true;
  }

  const path = normalizePath(req.path);
  return PUBLIC_EXACT_PATHS.has(path);
}

let cachedPublicKey: string | null = null;

/**
 * Load the JWT public key once at startup.
 * Priority: JWT_PUBLIC_KEY env var → AWS Secrets Manager.
 */
export async function loadPublicKey(): Promise<void> {
  if (process.env.JWT_PUBLIC_KEY) {
    cachedPublicKey = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, "\n");
    console.log("[auth-middleware] JWT public key loaded from environment");
    return;
  }

  // Lazy-import shared-crypto to avoid boot crash when env var is set
  try {
    const { fetchJWTPublicKey } = await import("@ahava/shared-crypto");
    cachedPublicKey = await fetchJWTPublicKey();
    console.log(
      "[auth-middleware] JWT public key loaded from AWS Secrets Manager",
    );
  } catch (err) {
    // In development, fall through without crashing — middleware will reject all requests
    console.error(
      "[auth-middleware] WARNING: Could not load JWT public key:",
      err,
    );
  }
}

/**
 * Expose cached key for testing
 */
export function setPublicKeyForTesting(key: string): void {
  cachedPublicKey = key;
}

/**
 * Express middleware: verify Bearer JWT on every protected route.
 */
export function jwtAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Pass through public paths
  if (isPublicPath(req)) {
    return next();
  }

  if (!cachedPublicKey) {
    const err = new AhavaError(
      AhavaErrorCode.INTERNAL_SERVER_ERROR,
      "Gateway JWT public key not configured",
      { requestId: req.id },
    );
    res.status(503).json(createErrorResponse(err));
    return;
  }

  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_UNAUTHORIZED,
      "Authorization header missing or malformed",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
    return;
  }

  try {
    const payload = jwt.verify(token, cachedPublicKey, {
      algorithms: ["RS256"],
      issuer: "ahava-ewallet",
      audience: "ahava-api",
    }) as Record<string, unknown>;

    req.userId = (payload.userId ?? payload.sub) as string;
    req.deviceId = payload.deviceId as string;
    next();
  } catch (error) {
    const isExpired = error instanceof jwt.TokenExpiredError;
    const err = new AhavaError(
      isExpired
        ? AhavaErrorCode.AUTH_SESSION_EXPIRED
        : AhavaErrorCode.AUTH_INVALID_TOKEN,
      isExpired ? "Access token has expired" : "Invalid access token",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
  }
}
