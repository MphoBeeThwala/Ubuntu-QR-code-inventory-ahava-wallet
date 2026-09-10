import { Request, Response, NextFunction } from "express";
import { parseBearerToken, verifyJWT } from "@ahava/shared-crypto";
import {
  AhavaError,
  AhavaErrorCode,
  createErrorResponse,
} from "@ahava/shared-errors";

// This service had no authorization anywhere, and — unlike most other
// services this session's fixes covered — it's genuinely live: /inventory/*
// is in api-gateway's routing table (serviceBaseUrlForPath), so any
// authenticated caller (any registered customer or merchant) could read,
// create, modify, or delete ANY OTHER merchant's product catalog, stock
// levels, and transaction history just by knowing/guessing an id, and
// create products or record sales under any merchantId at all. Same
// requireAuth/assertOwnerOrAgent pattern as wallet-service, payment-service,
// kyc-service, and payment-orchestrator's identical fixes this session.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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
    const payload = await verifyJWT(token);
    req.userId = (payload.userId ?? payload.sub) as string | undefined;
    req.role = payload.role as string | undefined;
    if (!req.userId) {
      throw new Error("token has no subject");
    }
    next();
  } catch {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_INVALID_TOKEN,
      "Invalid or expired access token",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
  }
}

/** Throws unless the caller is an AGENT or the resource's actual owner. */
export function assertOwnerOrAgent(req: Request, resourceUserId: string): void {
  if (req.role === "AGENT") return;
  if (req.userId && req.userId === resourceUserId) return;
  throw new AhavaError(
    AhavaErrorCode.AUTH_UNAUTHORIZED,
    "You do not have access to this resource",
    { requestId: req.id },
  );
}
