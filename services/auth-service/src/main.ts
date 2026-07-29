// IMPORTANT: Import Sentry instrumentation FIRST
import "./instrument";

import * as Sentry from "@sentry/node";
import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import {
  AhavaError, AhavaErrorCode, createSuccessResponse, createErrorResponse,
} from "@ahava/shared-errors";
import {
  hashPin, verifyPin, generateAccessToken, generateRefreshToken,
  parseBearerToken, decryptPII, fetchPIIEncryptionKey,
} from "@ahava/shared-crypto";
import { sendSms, welcomeMessage, loginAlertMessage } from "./sms";
import { writeAuditLog } from "@ahava/shared-audit";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6001;
const getJwtPrivateKey = () => (process.env.JWT_PRIVATE_KEY || "").replace(/\n/g, "
");

app.use(express.json());

// FIX: SENTRY REQUEST HANDLER MUST BE FIRST
app.use(Sentry.Handlers.requestHandler());

app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  const requestId = typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "auth-service" }, req.id));
});

app.get("/auth/me", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) throw new AhavaError(AhavaErrorCode.AUTH_UNAUTHORIZED, "Authorization header missing", { requestId: req.id });
    const publicKey = (process.env.JWT_PUBLIC_KEY || "").replace(/\n/g, "
");
    if (!publicKey) throw new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, "JWT public key not configured", { requestId: req.id });
    const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"], issuer: "ahava-ewallet", audience: "ahava-api" }) as Record<string, unknown>;
    const userId = (payload.userId ?? payload.sub) as string | undefined;
    if (!userId) throw new AhavaError(AhavaErrorCode.AUTH_INVALID_TOKEN, "Invalid token payload", { requestId: req.id });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, phoneNumber: true, kycTier: true, preferredLanguage: true, isDeleted: true } });
    if (!user || user.isDeleted) throw new AhavaError(AhavaErrorCode.AUTH_UNAUTHORIZED, "User not found", { requestId: req.id });
    res.json(createSuccessResponse({ user: { id: user.id, phoneNumber: user.phoneNumber, kycTier: user.kycTier, preferredLanguage: user.preferredLanguage } }, req.id));
  } catch (error) { next(error); }
});

app.post("/auth/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phoneNumber, pin, deviceId, deviceName, userAgent, ipAddress } = req.body;
    if (!phoneNumber || !pin || !deviceId) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing required fields", { requestId: req.id });
    if (!/^(+27|0)[1-9]d{8}$/.test(phoneNumber.replace(/s/g, ""))) throw new AhavaError(AhavaErrorCode.VAL_INVALID_PHONE, "Invalid phone format", { requestId: req.id });
    if (!/^d{4,6}$/.test(pin)) throw new AhavaError(AhavaErrorCode.VAL_INVALID_INPUT, "PIN must be 4-6 digits", { requestId: req.id });
    const phoneNumberHash = crypto.createHash("sha256").update(phoneNumber.trim().toLowerCase()).digest("hex");
    if (await prisma.user.findUnique({ where: { phoneNumberHash } })) throw new AhavaError(AhavaErrorCode.CONFLICT_PHONE_ALREADY_REGISTERED, "Phone already registered", { requestId: req.id });
    const pinHash = await hashPin(pin);
    const user = await prisma.user.create({ data: { phoneNumber, phoneNumberHash, pinHash, primaryDeviceId: deviceId, deviceBoundAt: new Date(), kycTier: "TIER_0", kycStatus: "PENDING", preferredLanguage: "en" } });
    const walletNumber = `AHV-${user.id.substring(0, 8).toUpperCase()}`;
    const wallet = await prisma.wallet.create({ data: { userId: user.id, walletNumber, walletType: "PERSONAL", status: "ACTIVE", kycTier: "TIER_0", balance: 0, dailyLimit: 50000, monthlyLimit: 200000, maxBalance: 250000, perTransactionLimit: 50000 } });
    const refreshTokenString = await generateRefreshToken(user.id, deviceId, "30d", getJwtPrivateKey());
    const refreshTokenHash = crypto.createHash("sha256").update(refreshTokenString).digest("hex");
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: refreshTokenHash, deviceId, deviceName: deviceName || "Unknown Device", ipAddress, userAgent, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    const accessToken = await generateAccessToken({ userId: user.id, phoneNumber, kycTier: user.kycTier, deviceId }, "15m", getJwtPrivateKey());
    await writeAuditLog(prisma, { userId: user.id, action: "USER_REGISTERED", entityType: "User", entityId: user.id, serviceId: "auth-service", ipAddress, userAgent, deviceId });
    void sendSms(phoneNumber, welcomeMessage(walletNumber));
    res.status(201).json(createSuccessResponse({ userId: user.id, walletId: wallet.id, walletNumber: wallet.walletNumber, accessToken, refreshToken: refreshTokenString, user: { phoneNumber: user.phoneNumber, kycTier: user.kycTier, preferredLanguage: user.preferredLanguage } }, req.id));
  } catch (error) { next(error); }
});

app.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phoneNumber, pin, deviceId, deviceName, userAgent, ipAddress } = req.body;
    if (!phoneNumber || !pin || !deviceId) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing required fields", { requestId: req.id });
    const phoneNumberHash = crypto.createHash("sha256").update(phoneNumber.trim().toLowerCase()).digest("hex");
    const user = await prisma.user.findUnique({ where: { phoneNumberHash } });
    if (!user || user.isDeleted) throw new AhavaError(AhavaErrorCode.AUTH_INVALID_CREDENTIALS, "Invalid credentials", { requestId: req.id });
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) throw new AhavaError(AhavaErrorCode.AUTH_PIN_LOCKED, "PIN locked", { requestId: req.id, statusCode: 429 });
    if (!user.pinHash || !(await verifyPin(pin, user.pinHash))) {
      const newFailedAttempts = (user.failedPinAttempts || 0) + 1;
      const lockUntil = newFailedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: newFailedAttempts, pinLockedUntil: lockUntil } });
      throw new AhavaError(AhavaErrorCode.AUTH_PIN_INCORRECT, `Invalid PIN. Attempts: ${newFailedAttempts}/5`, { requestId: req.id });
    }
    if (user.primaryDeviceId && user.primaryDeviceId !== deviceId) throw new AhavaError(AhavaErrorCode.AUTH_DEVICE_MISMATCH, "Device not recognized", { requestId: req.id });
    await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
    const refreshTokenString = await generateRefreshToken(user.id, deviceId, "30d", getJwtPrivateKey());
    const refreshTokenHash = crypto.createHash("sha256").update(refreshTokenString).digest("hex");
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: refreshTokenHash, deviceId, deviceName: deviceName || "Unknown Device", ipAddress, userAgent, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    const accessToken = await generateAccessToken({ userId: user.id, phoneNumber, kycTier: user.kycTier, deviceId }, "15m", getJwtPrivateKey());
    await writeAuditLog(prisma, { userId: user.id, action: "USER_LOGIN", entityType: "User", entityId: user.id, serviceId: "auth-service", ipAddress, userAgent, deviceId });
    let loginPhone = phoneNumber;
    try { const encKey = await fetchPIIEncryptionKey(); if (user.phoneNumber && user.phoneNumber.includes(":")) loginPhone = decryptPII(user.phoneNumber, encKey); } catch {}
    void sendSms(loginPhone, loginAlertMessage(new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })));
    const wallet = await prisma.wallet.findFirst({ where: { userId: user.id, status: "ACTIVE", isDeleted: false }, select: { id: true, walletNumber: true }, orderBy: { createdAt: "asc" } });
    res.json(createSuccessResponse({ userId: user.id, accessToken, refreshToken: refreshTokenString, user: { phoneNumber: user.phoneNumber, kycTier: user.kycTier }, ...(wallet && { walletId: wallet.id, walletNumber: wallet.walletNumber }) }, req.id));
  } catch (error) { next(error); }
});

app.post("/auth/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, refreshToken, deviceId } = req.body;
    if (!userId || !refreshToken || !deviceId) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing required fields", { requestId: req.id });
    const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash: refreshTokenHash } });
    if (!storedToken || storedToken.userId !== userId || storedToken.revokedAt) throw new AhavaError(AhavaErrorCode.AUTH_TOKEN_REVOKED, "Invalid or revoked refresh token", { requestId: req.id });
    if (storedToken.expiresAt < new Date()) throw new AhavaError(AhavaErrorCode.AUTH_SESSION_EXPIRED, "Refresh token expired", { requestId: req.id });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isDeleted) throw new AhavaError(AhavaErrorCode.AUTH_UNAUTHORIZED, "User not found", { requestId: req.id });
    const newAccessToken = await generateAccessToken({ userId: user.id, phoneNumber: user.phoneNumber, kycTier: user.kycTier, deviceId }, "15m", getJwtPrivateKey());
    res.json(createSuccessResponse({ accessToken: newAccessToken }, req.id));
  } catch (error) { next(error); }
});

app.post("/auth/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, refreshToken } = req.body;
    if (!userId || !refreshToken) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing fields", { requestId: req.id });
    const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await prisma.refreshToken.update({ where: { tokenHash: refreshTokenHash }, data: { revokedAt: new Date(), revokedReason: "User logout" } });
    await writeAuditLog(prisma, { userId, action: "USER_LOGOUT", entityType: "User", entityId: userId, serviceId: "auth-service" });
    res.json(createSuccessResponse({ message: "Logged out successfully" }, req.id));
  } catch (error) { next(error); }
});

app.post("/auth/device-bind", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, pin, deviceId } = req.body;
    if (!userId || !pin || !deviceId) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing fields", { requestId: req.id });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AhavaError(AhavaErrorCode.AUTH_UNAUTHORIZED, "User not found", { requestId: req.id });
    if (!user.pinHash || !(await verifyPin(pin, user.pinHash))) throw new AhavaError(AhavaErrorCode.AUTH_PIN_INCORRECT, "Invalid PIN", { requestId: req.id });
    await prisma.user.update({ where: { id: userId }, data: { primaryDeviceId: deviceId, deviceBoundAt: new Date() } });
    await writeAuditLog(prisma, { userId, action: "DEVICE_BOUND", entityType: "User", entityId: userId, serviceId: "auth-service", deviceId });
    res.json(createSuccessResponse({ message: "Device bound successfully" }, req.id));
  } catch (error) { next(error); }
});

app.get("/debug-sentry", function mainHandler(_req, _res) { throw new Error("My first Sentry error!"); });

// FIX: Sentry error handler AFTER all routes
app.use(Sentry.Handlers.errorHandler());

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) return res.status(err.statusCode).json(createErrorResponse(err));
  console.error("Unhandled error:", err);
  res.status(500).json(createErrorResponse(new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, "Internal server error", { requestId: req.id })));
});

export function startServer() {
  app.listen(PORT, () => { console.log(`✅ Auth Service on port ${PORT}`); console.log(`🏥 Health: http://localhost:${PORT}/health`); });
}
if (require.main === module) startServer();
export default app;

declare global { namespace Express { interface Request { id?: string; } } }