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

import express, {
  Express,
  Request,
  Response,
  NextFunction,
} from "express";
import { v4 as uuidv4 } from "uuid";
import { AhavaError, AhavaErrorCode, createErrorResponse, createSuccessResponse } from "@ahava/shared-errors";

const app: Express = express();
const PORT = process.env.PORT || 6000;

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE SETUP
// ─────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID tracking
app.use((req: Request, res: Response, next: NextFunction) => {
  const incomingRequestId = req.header("x-request-id");
  const incomingCorrelationId = req.header("x-correlation-id");
  req.id = incomingRequestId || uuidv4();
  req.correlationId = incomingCorrelationId || req.id;
  res.setHeader("X-Request-ID", req.id);
  res.setHeader("X-Correlation-ID", req.correlationId);
  next();
});

// TODO: Initialize Sentry error tracking
// Sentry.init({
//   dsn: process.env.SENTRY_DSN,
//   environment: process.env.NODE_ENV,
// });
// app.use(Sentry.Handlers.requestHandler());

// TODO: Initialize Datadog APM
// const tracer = require('dd-trace').init();

// TODO: Add device fingerprinting middleware
// app.use((req, res, next) => {
//   const deviceId = req.headers['x-device-id'] as string;
//   const userAgent = req.headers['user-agent'] || '';
//   const ipAddress = req.ip || '';
//   req.deviceFingerprint = generateDeviceFingerprint(userAgent, ipAddress, deviceId);
//   next();
// });

// TODO: Add rate limiting middleware
// const rateLimiter = createRateLimiter({
//   max: 100, // 100 requests per windowMs
//   windowMs: 60 * 1000, // 1 minute
//   keyGenerator: (req) => req.deviceFingerprint || req.ip,
// });
// app.use(rateLimiter);

// Stricter rate limit for auth endpoints
// TODO: app.post('/auth/login', createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 }), ...);
// TODO: app.post('/payments', createRateLimiter({ max: 10, windowMs: 60 * 1000 }), ...);

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
    })
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
  notifications: process.env.NOTIFICATION_SERVICE_URL || "http://notification-service:6005",
};

function serviceBaseUrlForPath(path: string): string | null {
  if (path.startsWith("/wallets")) return SERVICE_URLS.wallets;
  if (path.startsWith("/payments")) return SERVICE_URLS.payments;
  if (path.startsWith("/auth")) return SERVICE_URLS.auth;
  if (path.startsWith("/kyc")) return SERVICE_URLS.kyc;
  if (path.startsWith("/notifications")) return SERVICE_URLS.notifications;
  return null;
}

function isProtectedRoute(path: string): boolean {
  return !path.startsWith("/health") && !path.startsWith("/auth");
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractUpstreamError(payload: unknown) {
  const obj = toRecord(payload);
  const errorObj = obj ? toRecord(obj.error) : null;
  if (!obj || obj.success !== false || !errorObj) {
    return null;
  }

  const code = errorObj.code;
  const message = errorObj.message;
  const statusCode = errorObj.statusCode;
  if (typeof code !== "string" || typeof message !== "string") {
    return null;
  }

  return {
    code,
    message,
    statusCode: typeof statusCode === "number" ? statusCode : undefined,
    details: toRecord(errorObj.details) ?? undefined,
  };
}

function requireBearerAuth(req: Request, _res: Response, next: NextFunction) {
  if (!isProtectedRoute(req.path)) {
    return next();
  }

  const authorization = req.header("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return next(
      new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "Missing or invalid Authorization header",
        { requestId: req.id, statusCode: 401 }
      )
    );
  }

  return next();
}

app.use(requireBearerAuth);

async function proxyRequest(serviceBaseUrl: string, req: Request, res: Response) {
  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const forwardUrl = `${serviceBaseUrl}${req.path}${query}`;

  let response: globalThis.Response;
  try {
    response = await fetch(forwardUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        ...(req.id && { "X-Request-ID": req.id }),
        ...(req.correlationId && { "X-Correlation-ID": req.correlationId }),
        "X-Forwarded-For": req.ip || "",
        ...(req.headers.authorization && { Authorization: req.headers.authorization }),
        ...(req.headers["x-device-id"] ? { "X-Device-Id": req.headers["x-device-id"] as string } : {}),
      } as Record<string, string>,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });
  } catch (error) {
    throw new AhavaError(
      AhavaErrorCode.INTERNAL_DEPENDENCY_FAILURE,
      "Upstream service unavailable",
      {
        requestId: req.id,
        statusCode: 502,
        details: {
          forwardUrl,
          reason: error instanceof Error ? error.message : "unknown",
        },
      }
    );
  }

  const bodyText = await response.text();
  const parsed = parseJsonSafely(bodyText);
  const upstreamError = extractUpstreamError(parsed);

  if (upstreamError) {
    throw new AhavaError(
      upstreamError.code as AhavaErrorCode,
      upstreamError.message,
      {
        requestId: req.id,
        statusCode: upstreamError.statusCode ?? response.status,
        details: upstreamError.details,
      }
    );
  }

  if (response.status >= 400) {
    throw new AhavaError(
      AhavaErrorCode.INTERNAL_DEPENDENCY_FAILURE,
      "Upstream service error",
      {
        requestId: req.id,
        statusCode: response.status,
        details: {
          forwardUrl,
          upstreamStatus: response.status,
          upstreamBody: parsed ?? bodyText,
        },
      }
    );
  }

  if (parsed !== null) {
    return res.status(response.status).json(parsed);
  }

  return res.status(response.status).send(bodyText);
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
    { requestId: req.id }
  );
  res.status(error.statusCode).json(createErrorResponse(error));
});

// TODO: Global error handler
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  // If it's already AhavaError, use it directly
  if (err instanceof AhavaError) {
    const mappedError = new AhavaError(err.code, err.message, {
      requestId: req.id,
      statusCode: err.statusCode,
      details: err.details,
    });
    return res.status(mappedError.statusCode).json(createErrorResponse(mappedError));
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
    }
  );

  res.status(500).json(createErrorResponse(error));
});

// ─────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API Gateway listening on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "dev"}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
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
      correlationId?: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

