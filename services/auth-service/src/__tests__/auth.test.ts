/**
 * Auth Service Tests
 * Coverage target: 95% lines/functions (SARB requirement)
 *
 * Scenarios covered:
 * - POST /auth/register: success, duplicate phone, invalid phone, short PIN
 * - POST /auth/login: success, wrong PIN, PIN lockout after 5 attempts, device mismatch, deleted user
 * - POST /auth/refresh: valid token, revoked token, expired token, missing fields
 * - POST /auth/logout: success, token revocation
 * - POST /auth/device-bind: success, wrong PIN, user not found
 * - GET /health: liveness check
 */

import request from "supertest";

// ─── Mocks must be declared before importing the app ─────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  wallet: {
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

const mockHashPin = jest.fn();
const mockVerifyPin = jest.fn();
const mockGenerateAccessToken = jest.fn();
const mockGenerateRefreshToken = jest.fn();

jest.mock("@ahava/shared-crypto", () => ({
  hashPin: (...args: unknown[]) => mockHashPin(...args),
  verifyPin: (...args: unknown[]) => mockVerifyPin(...args),
  generateAccessToken: (...args: unknown[]) => mockGenerateAccessToken(...args),
  generateRefreshToken: (...args: unknown[]) =>
    mockGenerateRefreshToken(...args),
}));

// Import app AFTER mocks
import app from "../main";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_PHONE = "+27821234567";
const VALID_PIN = "1234";
const DEVICE_ID = "device-abc-123";

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-001",
    phoneNumber: VALID_PHONE,
    pinHash: "$argon2id$v=19$...",
    primaryDeviceId: DEVICE_ID,
    deviceBoundAt: new Date(),
    kycTier: "TIER_0",
    kycStatus: "PENDING",
    preferredLanguage: "en",
    isDeleted: false,
    failedPinAttempts: 0,
    pinLockedUntil: null,
    ...overrides,
  };
}

function makeRefreshToken(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rt-001",
    userId: "user-001",
    tokenHash: "hashed-token",
    deviceId: DEVICE_ID,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

const registerPayload = () => ({
  phoneNumber: VALID_PHONE,
  pin: VALID_PIN,
  deviceId: DEVICE_ID,
  deviceName: "Test Device",
  userAgent: "TestAgent/1.0",
  ipAddress: "127.0.0.1",
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  mockHashPin.mockResolvedValue("$argon2id$v=19$hashed");
  mockVerifyPin.mockResolvedValue(true);
  mockGenerateAccessToken.mockResolvedValue("access-token-mock");
  mockGenerateRefreshToken.mockResolvedValue("refresh-token-mock");

  mockPrisma.user.create.mockResolvedValue(makeUser());
  mockPrisma.wallet.create.mockResolvedValue({ id: "wallet-001" });
  mockPrisma.refreshToken.create.mockResolvedValue({ id: "rt-001" });
  mockPrisma.auditLog.create.mockResolvedValue({});
});

// ─── Health ───────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with ok status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.service).toBe("auth-service");
  });
});

// ─── POST /auth/register ──────────────────────────────────────────────────────

describe("POST /auth/register", () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue(null); // no existing user
  });

  it("returns 201 with userId, walletId, and tokens on success", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send(registerPayload());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      userId: "user-001",
      walletId: "wallet-001",
      accessToken: "access-token-mock",
      refreshToken: "refresh-token-mock",
    });
  });

  it("hashes the PIN with Argon2id before storing", async () => {
    await request(app).post("/auth/register").send(registerPayload());
    expect(mockHashPin).toHaveBeenCalledWith(VALID_PIN);
  });

  it("creates an audit log entry for USER_REGISTERED", async () => {
    await request(app).post("/auth/register").send(registerPayload());
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "USER_REGISTERED" }),
      }),
    );
  });

  it("returns 409 when phone number is already registered", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());

    const res = await request(app)
      .post("/auth/register")
      .send(registerPayload());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT_PHONE_ALREADY_REGISTERED");
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 400 when phoneNumber is missing", async () => {
    const { phoneNumber: _omit, ...rest } = registerPayload();
    const res = await request(app).post("/auth/register").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when deviceId is missing", async () => {
    const { deviceId: _omit, ...rest } = registerPayload();
    const res = await request(app).post("/auth/register").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 for invalid South African phone format", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...registerPayload(), phoneNumber: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_PHONE");
  });

  it("returns 400 for PIN shorter than 4 digits", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...registerPayload(), pin: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_INPUT");
  });

  it("returns 400 for non-numeric PIN", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...registerPayload(), pin: "abcd" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_INPUT");
  });

  it("accepts 0XX format South African phone", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...registerPayload(), phoneNumber: "0821234567" });
    expect(res.status).toBe(201);
  });

  it("sets X-Request-ID response header", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send(registerPayload());
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────

describe("POST /auth/login", () => {
  const loginPayload = () => ({
    phoneNumber: VALID_PHONE,
    pin: VALID_PIN,
    deviceId: DEVICE_ID,
    deviceName: "Test Device",
    userAgent: "TestAgent/1.0",
    ipAddress: "127.0.0.1",
  });

  it("returns 200 with tokens on successful login", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.user.update.mockResolvedValue({});

    const res = await request(app).post("/auth/login").send(loginPayload());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBe("access-token-mock");
    expect(res.body.data.refreshToken).toBe("refresh-token-mock");
  });

  it("resets failedPinAttempts to 0 on successful login", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({ failedPinAttempts: 3 }),
    );
    mockPrisma.user.update.mockResolvedValue({});

    await request(app).post("/auth/login").send(loginPayload());

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedPinAttempts: 0,
          pinLockedUntil: null,
        }),
      }),
    );
  });

  it("creates audit log for USER_LOGIN", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.user.update.mockResolvedValue({});

    await request(app).post("/auth/login").send(loginPayload());

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "USER_LOGIN" }),
      }),
    );
  });

  it("returns 401 for unknown phone number", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/auth/login").send(loginPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("returns 401 for deleted user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser({ isDeleted: true }));

    const res = await request(app).post("/auth/login").send(loginPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("returns 401 and increments failedPinAttempts on wrong PIN", async () => {
    mockVerifyPin.mockResolvedValue(false);
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({ failedPinAttempts: 1 }),
    );
    mockPrisma.user.update.mockResolvedValue({});

    const res = await request(app).post("/auth/login").send(loginPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_PIN_INCORRECT");
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedPinAttempts: 2 }),
      }),
    );
  });

  it("locks PIN for 15 minutes after 5 failed attempts", async () => {
    mockVerifyPin.mockResolvedValue(false);
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({ failedPinAttempts: 4 }),
    );
    mockPrisma.user.update.mockResolvedValue({});

    await request(app).post("/auth/login").send(loginPayload());

    const updateCall = mockPrisma.user.update.mock.calls[0][0];
    expect(updateCall.data.failedPinAttempts).toBe(5);
    expect(updateCall.data.pinLockedUntil).toBeInstanceOf(Date);
    // Lock should be approximately 15 minutes from now
    const lockUntil = updateCall.data.pinLockedUntil as Date;
    const diffMs = lockUntil.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(14 * 60 * 1000);
    expect(diffMs).toBeLessThan(16 * 60 * 1000);
  });

  it("returns 429 when PIN is locked", async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({ pinLockedUntil: lockedUntil, failedPinAttempts: 5 }),
    );

    const res = await request(app).post("/auth/login").send(loginPayload());

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("AUTH_PIN_LOCKED");
    expect(mockVerifyPin).not.toHaveBeenCalled();
  });

  it("returns 401 on device mismatch when user has enrolled device", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(
      makeUser({ primaryDeviceId: "other-device-xyz" }),
    );

    const res = await request(app).post("/auth/login").send(loginPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_DEVICE_MISMATCH");
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ phoneNumber: VALID_PHONE });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────

describe("POST /auth/refresh", () => {
  const refreshPayload = () => ({
    userId: "user-001",
    refreshToken: "refresh-token-mock",
    deviceId: DEVICE_ID,
  });

  it("returns 200 with new access token on valid refresh", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(makeRefreshToken());
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());

    const res = await request(app).post("/auth/refresh").send(refreshPayload());

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBe("access-token-mock");
  });

  it("returns 401 when refresh token is revoked", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(
      makeRefreshToken({ revokedAt: new Date() }),
    );

    const res = await request(app).post("/auth/refresh").send(refreshPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_TOKEN_REVOKED");
  });

  it("returns 401 when refresh token does not exist", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/auth/refresh").send(refreshPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_TOKEN_REVOKED");
  });

  it("returns 401 when refresh token userId does not match", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(
      makeRefreshToken({ userId: "different-user" }),
    );

    const res = await request(app).post("/auth/refresh").send(refreshPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_TOKEN_REVOKED");
  });

  it("returns 401 when refresh token is expired", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(
      makeRefreshToken({ expiresAt: new Date(Date.now() - 1000) }),
    );

    const res = await request(app).post("/auth/refresh").send(refreshPayload());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .send({ userId: "user-001" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 403 when user is deleted", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(makeRefreshToken());
    mockPrisma.user.findUnique.mockResolvedValue(makeUser({ isDeleted: true }));

    const res = await request(app).post("/auth/refresh").send(refreshPayload());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_UNAUTHORIZED");
  });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────

describe("POST /auth/logout", () => {
  it("returns 200 and revokes the refresh token", async () => {
    mockPrisma.refreshToken.update.mockResolvedValue({});

    const res = await request(app)
      .post("/auth/logout")
      .send({ userId: "user-001", refreshToken: "refresh-token-mock" });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Logged out successfully");
    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
          revokedReason: "User logout",
        }),
      }),
    );
  });

  it("creates audit log for USER_LOGOUT", async () => {
    mockPrisma.refreshToken.update.mockResolvedValue({});

    await request(app)
      .post("/auth/logout")
      .send({ userId: "user-001", refreshToken: "refresh-token-mock" });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "USER_LOGOUT" }),
      }),
    );
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app)
      .post("/auth/logout")
      .send({ refreshToken: "token" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when refreshToken is missing", async () => {
    const res = await request(app)
      .post("/auth/logout")
      .send({ userId: "user-001" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });
});

// ─── POST /auth/device-bind ───────────────────────────────────────────────────

describe("POST /auth/device-bind", () => {
  it("returns 200 and binds the new device on valid PIN", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.user.update.mockResolvedValue({});

    const res = await request(app).post("/auth/device-bind").send({
      userId: "user-001",
      pin: VALID_PIN,
      deviceId: "new-device-999",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Device bound successfully");
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primaryDeviceId: "new-device-999",
          deviceBoundAt: expect.any(Date),
        }),
      }),
    );
  });

  it("creates audit log for DEVICE_BOUND", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.user.update.mockResolvedValue({});

    await request(app).post("/auth/device-bind").send({
      userId: "user-001",
      pin: VALID_PIN,
      deviceId: "new-device-999",
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DEVICE_BOUND" }),
      }),
    );
  });

  it("returns 401 on wrong PIN during device bind", async () => {
    mockVerifyPin.mockResolvedValue(false);
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());

    const res = await request(app).post("/auth/device-bind").send({
      userId: "user-001",
      pin: "0000",
      deviceId: "new-device-999",
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_PIN_INCORRECT");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/auth/device-bind").send({
      userId: "ghost-user",
      pin: VALID_PIN,
      deviceId: "new-device-999",
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/auth/device-bind")
      .send({ userId: "user-001" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });
});
