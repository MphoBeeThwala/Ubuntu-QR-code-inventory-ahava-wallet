import crypto from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";

const prismaMock = {
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
};

const cryptoMock = {
  hashPin: jest.fn(),
  verifyPin: jest.fn(),
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => prismaMock),
}));

jest.mock("@ahava/shared-crypto", () => cryptoMock);

import app from "./main";

describe("auth-service endpoints", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll((done) => {
    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /auth/register creates user and wallet", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user-1",
      phoneNumber: "+27821234567",
      kycTier: "TIER_0",
      preferredLanguage: "en",
    });
    prismaMock.wallet.create.mockResolvedValue({ id: "wallet-1" });
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
    cryptoMock.hashPin.mockResolvedValue("hashed-pin");
    cryptoMock.generateRefreshToken.mockResolvedValue("refresh-token");
    cryptoMock.generateAccessToken.mockResolvedValue("access-token");

    const response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "082 123 4567",
        pin: "1234",
        deviceId: "device-1",
      }),
    });

    const body = (await response.json()) as any;
    const expectedHash = crypto
      .createHash("sha256")
      .update("+27821234567")
      .digest("hex");

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe("user-1");
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { phoneNumberHash: expectedHash },
    });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneNumber: "+27821234567",
          phoneNumberHash: expectedHash,
        }),
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          action: "USER_REGISTERED",
          entityType: "User",
          entityId: "user-1",
          serviceId: "auth-service",
        }),
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          action: "WALLET_CREATED",
          entityType: "Wallet",
          entityId: "wallet-1",
          serviceId: "auth-service",
        }),
      })
    );
  });

  it("POST /auth/login returns tokens for valid credentials", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      phoneNumber: "+27821234567",
      pinHash: "hashed-pin",
      failedPinAttempts: 0,
      pinLockedUntil: null,
      primaryDeviceId: "device-1",
      kycTier: "TIER_0",
      isDeleted: false,
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
    cryptoMock.verifyPin.mockResolvedValue(true);
    cryptoMock.generateRefreshToken.mockResolvedValue("refresh-token");
    cryptoMock.generateAccessToken.mockResolvedValue("access-token");

    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "0821234567",
        pin: "1234",
        deviceId: "device-1",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe("user-1");
    expect(body.data.accessToken).toBe("access-token");
    expect(body.data.refreshToken).toBe("refresh-token");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "USER_LOGIN",
          entityType: "User",
          entityId: "user-1",
          serviceId: "auth-service",
        }),
      })
    );
  });

  it("POST /auth/register fails for duplicate phone number", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "existing-user" });

    const response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "0821234567",
        pin: "1234",
        deviceId: "device-1",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CONFLICT_PHONE_ALREADY_REGISTERED");
  });

  it("POST /auth/login fails for bad PIN and increments attempts", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      phoneNumber: "+27821234567",
      pinHash: "hashed-pin",
      failedPinAttempts: 2,
      pinLockedUntil: null,
      primaryDeviceId: "device-1",
      kycTier: "TIER_0",
      isDeleted: false,
    });
    cryptoMock.verifyPin.mockResolvedValue(false);
    prismaMock.user.update.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "0821234567",
        pin: "9999",
        deviceId: "device-1",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AUTH_PIN_INCORRECT");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ failedPinAttempts: 3 }),
      })
    );
  });

  it("POST /auth/login fails when PIN is locked", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      phoneNumber: "+27821234567",
      pinHash: "hashed-pin",
      failedPinAttempts: 5,
      pinLockedUntil: new Date(Date.now() + 5 * 60 * 1000),
      primaryDeviceId: "device-1",
      kycTier: "TIER_0",
      isDeleted: false,
    });

    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phoneNumber: "0821234567",
        pin: "1234",
        deviceId: "device-1",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AUTH_PIN_LOCKED");
    expect(cryptoMock.verifyPin).not.toHaveBeenCalled();
  });

  it("POST /auth/logout revokes refresh token and writes audit log", async () => {
    prismaMock.refreshToken.update.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        refreshToken: "refresh-token",
      }),
    });

    const body = (await response.json()) as any;
    const expectedRefreshTokenHash = crypto
      .createHash("sha256")
      .update("refresh-token")
      .digest("hex");

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
      where: { tokenHash: expectedRefreshTokenHash },
      data: expect.objectContaining({
        revokedReason: "User logout",
      }),
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "USER_LOGOUT",
          entityType: "User",
          entityId: "user-1",
          serviceId: "auth-service",
        }),
      })
    );
  });
});
