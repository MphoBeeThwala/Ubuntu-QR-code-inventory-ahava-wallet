/**
 * API Gateway — Ahava eWallet
 * Central ingress for all client requests
 *
 * Responsibilities:
 * - JWT verification
 * - Rate limiting (100 req/min per device)
 * - Request ID generation (tracing)
 * - Proxy to internal services
 * - Error handling + unified responses
 * - Request/response logging (Datadog)
 * - Device fingerprinting + certificate pinning validation
 */

import express, { Express, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  AhavaError,
  AhavaErrorCode,
  createErrorResponse,
  createSuccessResponse,
} from "@ahava/shared-errors";
import { jwtAuthMiddleware, loadPublicKey } from "./middleware/auth.middleware";
import {
  generalRateLimiter,
  authRateLimiter,
  paymentRateLimiter,
} from "./middleware/rate-limit.middleware";

const app: Express = express();
const PORT = process.env.PORT || 6000;

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE SETUP
// ─────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID tracking (must be first)
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

// Device fingerprinting — populate req.deviceFingerprint for rate-limit key
app.use((req: Request, _res: Response, next: NextFunction) => {
  const deviceId = (req.headers["x-device-id"] as string) || "";
  req.deviceId = deviceId;
  req.deviceFingerprint = deviceId || req.ip || "unknown";
  next();
});

// General rate limiter — 100 req/min per device (all routes)
app.use(generalRateLimiter);

// Stricter limiters on specific paths
app.use("/auth/login", authRateLimiter);
app.use("/auth/device-bind", authRateLimiter);
app.use("/payments", paymentRateLimiter);

// JWT verification — rejects requests without a valid Bearer token
// (public paths /health, /auth/register, /auth/login, /auth/refresh are exempt)
app.use(jwtAuthMiddleware);

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────

// Health check — no auth required
app.get("/health", (req: Request, res: Response) => {
  res.json(
    createSuccessResponse({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      service: "api-gateway",
    }),
  );
});

// TODO: Import and mount route handlers
// import authRoutes from './routes/auth.routes';
// import walletRoutes from './routes/wallet.routes';
// import paymentRoutes from './routes/payment.routes';
// import kycRoutes from './routes/kyc.routes';
// app.use('/auth', authRoutes);
// app.use('/wallets', walletRoutes);
// app.use('/payments', paymentRoutes);
// app.use('/kyc', kycRoutes);

// Proxy routes to internal services
const SERVICE_URLS = {
  auth: process.env.AUTH_SERVICE_URL || "http://auth-service:6001",
  wallets: process.env.WALLET_SERVICE_URL || "http://wallet-service:6002",
  payments: process.env.PAYMENT_SERVICE_URL || "http://payment-service:3003",
  kyc: process.env.KYC_SERVICE_URL || "http://kyc-service:6004",
  notifications:
    process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:6005",
};

function serviceBaseUrlForPath(path: string): string | null {
  if (path.startsWith("/wallets")) return SERVICE_URLS.wallets;
  if (path.startsWith("/payments")) return SERVICE_URLS.payments;
  if (path.startsWith("/auth")) return SERVICE_URLS.auth;
  if (path.startsWith("/kyc")) return SERVICE_URLS.kyc;
  if (path.startsWith("/notifications")) return SERVICE_URLS.notifications;
  return null;
}

async function proxyRequest(
  serviceBaseUrl: string,
  req: Request,
  res: Response,
) {
  const query = req.url.includes("?")
    ? req.url.substring(req.url.indexOf("?"))
    : "";
  const forwardUrl = `${serviceBaseUrl}${req.path}${query}`;

  const response = await fetch(forwardUrl, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      ...(req.id && { "X-Request-ID": req.id }),
      "X-Forwarded-For": req.ip || "",
      ...(req.headers.authorization && {
        Authorization: req.headers.authorization,
      }),
      ...(req.headers["x-device-id"]
        ? { "X-Device-Id": req.headers["x-device-id"] as string }
        : {}),
    } as Record<string, string>,
    body:
      req.method !== "GET" && req.method !== "HEAD"
        ? JSON.stringify(req.body)
        : undefined,
  });

  const bodyText = await response.text();
  res.status(response.status).send(bodyText);
}

app.all("*", async (req: Request, res: Response, next: NextFunction) => {
  const baseUrl = serviceBaseUrlForPath(req.path);
  if (!baseUrl) return next();

  try {
    await proxyRequest(baseUrl, req, res);
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// ERROR HANDLING MIDDLEWARE
// ─────────────────────────────────────────────────────────────────

// TODO: Catch 404
app.use((req: Request, res: Response) => {
  const error = new AhavaError(
    AhavaErrorCode.INTERNAL_NOT_IMPLEMENTED,
    `Route not found: ${req.method} ${req.path}`,
    { requestId: req.id },
  );
  res.status(error.statusCode).json(createErrorResponse(error));
});

// TODO: Global error handler
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  // If it's already AhavaError, use it directly
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }

  // TODO: Log unknown errors to Sentry + Datadog
  console.error("Unhandled error:", err);

  // TODO: Return generic error to client (don't expose internals)
  const error = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    {
      requestId: req.id,
      statusCode: 500,
    },
  );

  res.status(500).json(createErrorResponse(error));
});

// ─────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  loadPublicKey()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`✅ API Gateway listening on port ${PORT}`);
        console.log(`📍 Environment: ${process.env.NODE_ENV || "dev"}`);
        console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      });
    })
    .catch((err) => {
      console.error("Failed to start API Gateway:", err);
      process.exit(1);
    });
}

export default app;

// ─────────────────────────────────────────────────────────────────
// EXTEND EXPRESS REQUEST TYPE
// ─────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      id?: string;
      userId?: string;
      deviceFingerprint?: string;
      deviceId?: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */
