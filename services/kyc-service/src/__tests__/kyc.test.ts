import request from "supertest";
import { Queue as MockedQueue } from "bullmq";

// ─── Mock PrismaClient ────────────────────────────────────────────
const mockPrisma = {
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
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

// ─── Mock BullMQ ─────────────────────────────────────────────────
const mockQueueAdd = jest.fn().mockResolvedValue(undefined);
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const queueInstances: Array<{
  add: jest.Mock;
  close: jest.Mock;
}> = [];

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => {
    const instance = {
      add: jest.fn((...args: unknown[]) => mockQueueAdd(...args)),
      close: jest.fn((...args: unknown[]) => mockQueueClose(...args)),
    };
    queueInstances.push(instance);
    return instance;
  }),
}));

jest.mock("@ahava/shared-events", () => ({
  QUEUE_NAMES: {
    KYC_DOCUMENT_UPLOADED: "kyc:document:uploaded",
    NOTIFICATION_QUEUED: "notifications:dispatch",
  },
}));

// ─── Import app AFTER all mocks ───────────────────────────────────
import app from "../main";

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  queueInstances.length = 0;
  mockQueueAdd.mockResolvedValue(undefined);
  mockQueueClose.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /kyc/user/:userId", () => {
  it("returns KYC status for existing user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      kycTier: "TIER_0",
      kycStatus: "PENDING",
      idVerifiedAt: null,
      pepFlag: false,
    });

    const res = await request(app).get("/kyc/user/user-uuid-1");
    expect(res.status).toBe(200);
    expect(res.body.data.kyc.kycTier).toBe("TIER_0");
    expect(res.body.data.kyc.pepFlag).toBe(false);
  });

  it("returns 403 when user not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/kyc/user/nonexistent");
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /kyc/document/upload", () => {
  const validPayload = {
    userId: "user-uuid-1",
    documentType: "SOUTH_AFRICAN_ID",
    s3Key: "kyc/user-uuid-1/sa-id.jpg",
    documentHash: "abc123hash",
  };

  it("creates KYC document with PENDING status and returns 201", async () => {
    const doc = {
      id: "doc-uuid-1",
      userId: "user-uuid-1",
      documentType: "SOUTH_AFRICAN_ID",
      s3Key: "kyc/user-uuid-1/sa-id.jpg",
      documentHash: "abc123hash",
      verificationStatus: "PENDING",
      createdAt: new Date(),
    };
    mockPrisma.kycDocument.create.mockResolvedValue(doc);

    const res = await request(app)
      .post("/kyc/document/upload")
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.document.verificationStatus).toBe("PENDING");
    expect(mockPrisma.kycDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verificationStatus: "PENDING" }),
      }),
    );
  });

  it("publishes KYC_DOCUMENT_UPLOADED event (fire-and-forget)", async () => {
    const doc = { id: "doc-1", createdAt: new Date() };
    mockPrisma.kycDocument.create.mockResolvedValue(doc);

    await request(app).post("/kyc/document/upload").send(validPayload);

    expect(MockedQueue).toHaveBeenCalledWith(
      "kyc:document:uploaded",
      expect.anything(),
    );
  });

  it("closes both queues after successful event publication", async () => {
    const doc = { id: "doc-2", createdAt: new Date() };
    mockPrisma.kycDocument.create.mockResolvedValue(doc);

    await request(app).post("/kyc/document/upload").send(validPayload);
    await flushPromises();

    expect(queueInstances).toHaveLength(2);
    expect(queueInstances[0].close).toHaveBeenCalledTimes(1);
    expect(queueInstances[1].close).toHaveBeenCalledTimes(1);
  });

  it("logs queue publish failures without failing the request", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const doc = { id: "doc-3", createdAt: new Date() };
    mockPrisma.kycDocument.create.mockResolvedValue(doc);
    mockQueueAdd
      .mockRejectedValueOnce(new Error("kyc queue down"))
      .mockRejectedValueOnce(new Error("notif queue down"));

    const res = await request(app)
      .post("/kyc/document/upload")
      .send(validPayload);
    await flushPromises();

    expect(res.status).toBe(201);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[kyc-service] event publish failed:",
      expect.any(Error),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "[kyc-service] notification publish failed:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/kyc/document/upload")
      .send({ userId: "user-uuid-1" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app)
      .post("/kyc/document/upload")
      .send({ documentType: "PASSPORT", s3Key: "x", documentHash: "y" });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /kyc/tier-upgrade", () => {
  it("upgrades user to TIER_1 and updates all wallets", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_0",
    });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_1",
      kycStatus: "VERIFIED",
    });
    mockPrisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post("/kyc/tier-upgrade")
      .send({ userId: "user-uuid-1", newTier: "TIER_1" });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kycTier: "TIER_1",
          kycStatus: "VERIFIED",
        }),
      }),
    );
    expect(mockPrisma.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dailyLimit: 200000 }),
      }),
    );
  });

  it("upgrades to TIER_2 with correct limits", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_1",
    });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_2",
    });
    mockPrisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    await request(app)
      .post("/kyc/tier-upgrade")
      .send({ userId: "user-uuid-1", newTier: "TIER_2" });

    expect(mockPrisma.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dailyLimit: 500000,
          maxBalance: 25000000,
        }),
      }),
    );
  });

  it("creates an audit log entry for tier upgrade", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_0",
    });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_1",
    });
    mockPrisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    await request(app)
      .post("/kyc/tier-upgrade")
      .send({ userId: "user-uuid-1", newTier: "TIER_1" });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "KYC_TIER_UPGRADED" }),
      }),
    );
  });

  it("falls back to TIER_0 limits for unknown tiers", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_0",
    });
    mockPrisma.user.update.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_X",
    });
    mockPrisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    await request(app)
      .post("/kyc/tier-upgrade")
      .send({ userId: "user-uuid-1", newTier: "TIER_X" });

    expect(mockPrisma.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dailyLimit: 50000,
          monthlyLimit: 200000,
          maxBalance: 250000,
        }),
      }),
    );
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app)
      .post("/kyc/tier-upgrade")
      .send({ newTier: "TIER_1" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when newTier is missing", async () => {
    const res = await request(app)
      .post("/kyc/tier-upgrade")
      .send({ userId: "user-uuid-1" });
    expect(res.status).toBe(400);
  });

  it("returns 403 when user not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/kyc/tier-upgrade")
      .send({ userId: "nonexistent", newTier: "TIER_1" });
    expect(res.status).toBe(403);
  });

  it("returns 500 on unexpected tier lookup errors", async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error("db down"));

    const res = await request(app)
      .post("/kyc/tier-upgrade")
      .send({ userId: "user-uuid-1", newTier: "TIER_1" });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
