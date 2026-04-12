import type { AddressInfo } from "net";
import type { Server } from "http";

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  wallet: {
    updateMany: jest.fn(),
  },
  kycDocument: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => prismaMock),
}));

import app from "./main";

describe("kyc-service endpoints", () => {
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

  it("GET /kyc/status returns user kyc status", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      kycTier: "TIER_0",
      kycStatus: "PENDING",
      idVerifiedAt: null,
      idType: null,
      idNumberHash: null,
      pepFlag: false,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/kyc/status?userId=user-1`);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.kyc.kycTier).toBe("TIER_0");
  });

  it("POST /kyc/profile updates user profile and creates document", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", idNumberHash: null });
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      kycTier: "TIER_0",
      kycStatus: "PENDING",
    });
    prismaMock.kycDocument.create.mockResolvedValue({ id: "doc-1" });
    prismaMock.auditLog.create.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/kyc/profile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        fullName: "Test User",
        idType: "SA_ID_CARD",
        idNumber: "8001015009087",
        s3Key: "kyc/user-1/id-card.png",
        documentHash: "hash-1",
      }),
    });
    const body = (await response.json()) as any;

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.document.id).toBe("doc-1");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "KYC_PROFILE_SUBMITTED",
          entityType: "User",
          entityId: "user-1",
          serviceId: "kyc-service",
        }),
      })
    );
  });

  it("POST /kyc/manual-review sets status to UNDER_REVIEW", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      kycTier: "TIER_0",
      kycStatus: "UNDER_REVIEW",
    });
    prismaMock.auditLog.create.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/kyc/manual-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        reason: "Document mismatch",
      }),
    });
    const body = (await response.json()) as any;

    expect(response.status).toBe(202);
    expect(body.success).toBe(true);
    expect(body.data.user.kycStatus).toBe("UNDER_REVIEW");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "KYC_MANUAL_REVIEW_REQUESTED",
          entityType: "User",
          entityId: "user-1",
          serviceId: "kyc-service",
        }),
      })
    );
  });

  it("POST /kyc/tier-upgrade updates tier and wallet limits", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      kycTier: "TIER_1",
      kycStatus: "VERIFIED",
    });
    prismaMock.wallet.updateMany.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/kyc/tier-upgrade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        newTier: "TIER_1",
      }),
    });
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.user.kycTier).toBe("TIER_1");
    expect(prismaMock.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "KYC_TIER_UPGRADED",
          entityType: "User",
          entityId: "user-1",
          serviceId: "kyc-service",
        }),
      })
    );
  });
});
