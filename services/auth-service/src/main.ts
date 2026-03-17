/**
 * Auth Service — User Authentication & Device Management
 * Port: 3001
 * Responsibilities:
 * - User registration & login
 * - PIN management & verification (Argon2id)
 * - JWT token generation & refresh
 * - Device binding & biometric enrollment
 * - Sessions & token revocation
 */

import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { hashPin, verifyPin, generateAccessToken, generateRefreshToken } from "@ahava/shared-crypto";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────

// Health check
app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "auth-service" }));
});

// POST /auth/register
app.post("/auth/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phoneNumber, pin, deviceId, deviceName, userAgent, ipAddress } = req.body;

    // Validate input
    if (!phoneNumber || !pin || !deviceId) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields: phoneNumber, pin, deviceId",
        { requestId: req.id }
      );
    }

    // Validate phone format (South African)
    const phoneRegex = /^(\+27|0)[1-9]\d{8}$/;
    if (!phoneRegex.test(phoneNumber.replace(/\s/g, ""))) {
      throw new AhavaError(
        AhavaErrorCode.VAL_INVALID_PHONE,
        "Invalid phone number format",
        { requestId: req.id }
      );
    }

    // Validate PIN (4-6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      throw new AhavaError(
        AhavaErrorCode.VAL_INVALID_INPUT,
        "PIN must be 4-6 digits",
        { requestId: req.id }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (existingUser) {
      throw new AhavaError(
        AhavaErrorCode.CONFLICT_PHONE_ALREADY_REGISTERED,
        "Phone number already registered",
        { requestId: req.id }
      );
    }

    // Hash PIN using Argon2id
    const pinHash = await hashPin(pin);

    // Generate phone number hash for lookups (SHA-256)
    const phoneNumberHash = crypto
      .createHash("sha256")
      .update(phoneNumber)
      .digest("hex");

    // Create user
    const user = await prisma.user.create({
      data: {
        phoneNumber,
        phoneNumberHash,
        pinHash,
        primaryDeviceId: deviceId,
        deviceBoundAt: new Date(),
        kycTier: "TIER_0",
        kycStatus: "PENDING",
        preferredLanguage: "en",
      },
    });

    // Create default personal wallet for Tier 0
    const walletNumber = `AHV-${user.id.substring(0, 8).toUpperCase()}`;
    const wallet = await prisma.wallet.create({
      data: {
        userId: user.id,
        walletNumber,
        walletType: "PERSONAL",
        status: "ACTIVE",
        kycTier: "TIER_0",
        balance: 0,
        dailyLimit: 50000, // R500
        monthlyLimit: 200000, // R2000
        maxBalance: 250000, // R2500
        perTransactionLimit: 50000, // R500
      },
    });

    // Store device info in refresh token table (for future validation)
    const refreshTokenString = await generateRefreshToken(
      user.id,
      deviceId,
      "30d",
      process.env.JWT_PRIVATE_KEY || ""
    );

    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshTokenString)
      .digest("hex");

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        deviceId,
        deviceName: deviceName || "Unknown Device",
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    // Generate access token
    const accessToken = await generateAccessToken(
      {
        userId: user.id,
        phoneNumber,
        kycTier: user.kycTier,
        deviceId,
      },
      "15m",
      process.env.JWT_PRIVATE_KEY || ""
    );

    // Log to audit trail
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "USER_REGISTERED",
        entityType: "User",
        entityId: user.id,
        serviceId: "auth-service",
        ipAddress,
        userAgent,
        deviceId,
      },
    });

    // TODO: Publish USER_REGISTERED event to BullMQ
    // const userRegisteredQueue = new Queue(QUEUE_NAMES.USER_REGISTERED, { connection: redis });
    // await userRegisteredQueue.add("user-registered", { userId: user.id, phoneNumber });

    // TODO: Send welcome SMS notification via NotificationService
    // await fetch(`http://notification-service:3006/sms/send`, {
    //   method: "POST",
    //   body: JSON.stringify({
    //     phoneNumber,
    //     message: "Welcome to Ahava eWallet! Your account is ready. Please set up biometric for security.",
    //   }),
    // });

    res.status(201).json(
      createSuccessResponse({
        userId: user.id,
        walletId: wallet.id,
        accessToken,
        refreshToken: refreshTokenString,
        user: {
          phoneNumber: user.phoneNumber,
          kycTier: user.kycTier,
          preferredLanguage: user.preferredLanguage,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

// POST /auth/login
app.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phoneNumber, pin, deviceId, deviceName, userAgent, ipAddress } = req.body;

    // Validate input
    if (!phoneNumber || !pin || !deviceId) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields",
        { requestId: req.id }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!user || user.isDeleted) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_INVALID_CREDENTIALS,
        "Invalid credentials",
        { requestId: req.id }
      );
    }

    // Check if PIN is locked (too many attempts)
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_PIN_LOCKED,
        "PIN is locked. Try again later.",
        { requestId: req.id, statusCode: 429 }
      );
    }

    // Verify PIN
    if (!user.pinHash || !(await verifyPin(pin, user.pinHash))) {
      // Increment failed attempts
      const newFailedAttempts = (user.failedPinAttempts || 0) + 1;
      const lockUntil = newFailedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null; // Lock for 15min after 5 attempts

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedPinAttempts: newFailedAttempts,
          pinLockedUntil: lockUntil,
        },
      });

      throw new AhavaError(
        AhavaErrorCode.AUTH_PIN_INCORRECT,
        `Invalid PIN. Attempts: ${newFailedAttempts}/5`,
        { requestId: req.id }
      );
    }

    // Verify device binding
    if (user.primaryDeviceId && user.primaryDeviceId !== deviceId) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_DEVICE_MISMATCH,
        "Device not recognized. Please use your enrolled device or contact support.",
        { requestId: req.id }
      );
    }

    // Reset failed attempts on successful login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedPinAttempts: 0,
        pinLockedUntil: null,
      },
    });

    // Generate tokens
    const refreshTokenString = await generateRefreshToken(
      user.id,
      deviceId,
      "30d",
      process.env.JWT_PRIVATE_KEY || ""
    );

    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshTokenString)
      .digest("hex");

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        deviceId,
        deviceName: deviceName || "Unknown Device",
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const accessToken = await generateAccessToken(
      {
        userId: user.id,
        phoneNumber,
        kycTier: user.kycTier,
        deviceId,
      },
      "15m",
      process.env.JWT_PRIVATE_KEY || ""
    );

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "USER_LOGIN",
        entityType: "User",
        entityId: user.id,
        serviceId: "auth-service",
        ipAddress,
        userAgent,
        deviceId,
      },
    });

    res.json(
      createSuccessResponse({
        userId: user.id,
        accessToken,
        refreshToken: refreshTokenString,
        user: {
          phoneNumber: user.phoneNumber,
          kycTier: user.kycTier,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

// POST /auth/refresh
app.post("/auth/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, refreshToken, deviceId } = req.body;

    if (!userId || !refreshToken || !deviceId) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields",
        { requestId: req.id }
      );
    }

    // Verify refresh token
    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash: refreshTokenHash },
    });

    if (!storedToken || storedToken.userId !== userId || storedToken.revokedAt) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_TOKEN_REVOKED,
        "Invalid or revoked refresh token",
        { requestId: req.id }
      );
    }

    if (storedToken.expiresAt < new Date()) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_SESSION_EXPIRED,
        "Refresh token expired",
        { requestId: req.id }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.isDeleted) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "User not found or deleted",
        { requestId: req.id }
      );
    }

    // Generate new access token
    const newAccessToken = await generateAccessToken(
      {
        userId: user.id,
        phoneNumber: user.phoneNumber,
        kycTier: user.kycTier,
        deviceId,
      },
      "15m",
      process.env.JWT_PRIVATE_KEY || ""
    );

    res.json(
      createSuccessResponse({
        accessToken: newAccessToken,
      })
    );
  } catch (error) {
    next(error);
  }
});

// POST /auth/logout (revoke token)
app.post("/auth/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, refreshToken } = req.body;

    if (!userId || !refreshToken) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing userId or refreshToken",
        { requestId: req.id }
      );
    }

    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    await prisma.refreshToken.update({
      where: { tokenHash: refreshTokenHash },
      data: {
        revokedAt: new Date(),
        revokedReason: "User logout",
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: "USER_LOGOUT",
        entityType: "User",
        entityId: userId,
        serviceId: "auth-service",
      },
    });

    res.json(createSuccessResponse({ message: "Logged out successfully" }));
  } catch (error) {
    next(error);
  }
});

// POST /auth/device-bind (enroll new device)
app.post("/auth/device-bind", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, pin, deviceId } = req.body;

    if (!userId || !pin || !deviceId) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields",
        { requestId: req.id }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "User not found",
        { requestId: req.id }
      );
    }

    // Verify PIN
    if (!user.pinHash || !(await verifyPin(pin, user.pinHash))) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_PIN_INCORRECT,
        "Invalid PIN",
        { requestId: req.id }
      );
    }

    // Bind new device as primary
    await prisma.user.update({
      where: { id: userId },
      data: {
        primaryDeviceId: deviceId,
        deviceBoundAt: new Date(),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: "DEVICE_BOUND",
        entityType: "User",
        entityId: userId,
        serviceId: "auth-service",
        deviceId,
      },
    });

    res.json(createSuccessResponse({ message: "Device bound successfully" }));
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────────────────────────

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }

  console.error("Unhandled error:", err);
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id }
  );
  res.status(500).json(createErrorResponse(genericError));
});

// ─────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Auth Service listening on port ${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
});

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
