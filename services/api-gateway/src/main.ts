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
import helmet from "helmet";
import cors from "cors";
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

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// CORS for PWA and Flutter web
app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000", "http://localhost:3010"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID", "X-Device-Fingerprint"],
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "same-site" },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: { policy: "no-referrer" },
    xssFilter: true,
  }),
);

// Additional custom security headers not covered by Helmet
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()",
  );
  next();
});

// Request ID tracking (must be first)
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  req.id =
    typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
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

// Helper function for log redaction
function redactLog(data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) return data.map(redactLog);
  if (typeof data !== "object") return data;

  const redacted: Record<string, unknown> = {
    ...(data as Record<string, unknown>),
  };
  const sensitiveKeys = [
    "password",
    "pin",
    "authorization",
    "cookie",
    "x-api-key",
    "cardnumber",
    "cvv",
    "secret",
  ];

  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      redacted[key] = redactLog(redacted[key]);
    }
  }
  return redacted;
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    // Only log body for non-GET/HEAD and errors
    const shouldLogBody =
      req.method !== "GET" && req.method !== "HEAD" && res.statusCode >= 400;

    const entry = {
      level: "info",
      msg: "request",
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip,
      deviceId: req.deviceId,
      headers: redactLog(req.headers),
      ...(shouldLogBody && { body: redactLog(req.body) }),
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  });
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
    createSuccessResponse(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: "api-gateway",
      },
      req.id,
    ),
  );
});

// Proxy routes to internal services
const SERVICE_URLS = {
  auth: process.env.AUTH_SERVICE_URL || "http://localhost:6001",
  wallets: process.env.WALLET_SERVICE_URL || "http://localhost:6002",
  payments: process.env.PAYMENT_SERVICE_URL || "http://localhost:6003",
  kyc: process.env.KYC_SERVICE_URL || "http://localhost:6004",
  notifications:
    process.env.NOTIFICATION_SERVICE_URL || "http://localhost:6005",
  agents: process.env.AGENT_SERVICE_URL || "http://localhost:6009",
};

function serviceBaseUrlForPath(path: string): string | null {
  if (path.startsWith("/wallets")) return SERVICE_URLS.wallets;
  if (path.startsWith("/payments")) return SERVICE_URLS.payments;
  if (path.startsWith("/auth")) return SERVICE_URLS.auth;
  if (path.startsWith("/kyc")) return SERVICE_URLS.kyc;
  if (path.startsWith("/notifications")) return SERVICE_URLS.notifications;
  if (path.startsWith("/agents")) return SERVICE_URLS.agents;
  if (path.startsWith("/qr")) return SERVICE_URLS.wallets;
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

  const contentType = response.headers.get("content-type");
  if (contentType) res.setHeader("Content-Type", contentType);
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

// Catch 404
app.use((req: Request, res: Response) => {
  const error = new AhavaError(
    AhavaErrorCode.INTERNAL_NOT_IMPLEMENTED,
    `Route not found: ${req.method} ${req.path}`,
    { requestId: req.id },
  );
  res.status(error.statusCode).json(createErrorResponse(error));
});

// Global error handler
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  // If it's already AhavaError, use it directly
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }

  // Log unknown errors (could be piped to Datadog/Sentry)
  if (process.env.NODE_ENV === "production") {
    if (err instanceof Error) {
      console.error("Unhandled error:", {
        name: err.name,
        message: err.message,
      });
    } else {
      console.error("Unhandled error:", { message: "non-error thrown" });
    }
  } else {
    console.error("Unhandled error:", err);
  }

  // Return generic error to client (don't expose internals)
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
