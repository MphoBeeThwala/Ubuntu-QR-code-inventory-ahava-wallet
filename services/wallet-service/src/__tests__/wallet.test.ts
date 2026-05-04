import request from "supertest";

// ─── Mock PrismaClient ────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  wallet: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  walletTransaction: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  paymentQrCode: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

// ─── Mock BullMQ ─────────────────────────────────────────────────
const mockQueueAdd = jest.fn().mockResolvedValue(undefined);
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd.mockReturnValue(
      Promise.resolve().then(() => mockQueueClose()),
    ),
    close: mockQueueClose,
  })),
}));

jest.mock("@ahava/shared-events", () => ({
  QUEUE_NAMES: {
    WALLET_CREATED: "wallet:created",
  },
}));

// ─── Import app AFTER all mocks ───────────────────────────────────
import app from "../main";

// ─── Helpers ──────────────────────────────────────────────────────
function makeWallet(overrides = {}) {
  return {
    id: "wallet-uuid-1",
    userId: "user-uuid-1",
    walletNumber: "AHV-ABC1-DEF2-GHI3",
    walletType: "PERSONAL",
    status: "ACTIVE",
    kycTier: "TIER_0",
    balance: BigInt(100000),
    pendingBalance: BigInt(0),
    reservedBalance: BigInt(0),
    dailyLimit: BigInt(50000),
    monthlyLimit: BigInt(200000),
    maxBalance: BigInt(250000),
    perTransactionLimit: BigInt(50000),
    dailySpent: BigInt(0),
    monthlySpent: BigInt(0),
    dailyReceived: BigInt(0),
    currency: "ZAR",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
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
describe("POST /wallets", () => {
  it("creates a wallet for a valid user and returns 201", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_0",
    });
    const wallet = makeWallet();
    mockPrisma.wallet.create.mockResolvedValue(wallet);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post("/wallets")
      .send({ userId: "user-uuid-1" });

    expect(res.status).toBe(201);
    expect(res.body.data.wallet.id).toBe("wallet-uuid-1");
    expect(res.body.data.wallet.balance).toBe("100000");
  });

  it("applies TIER_1 limits when user is TIER_1", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-uuid-1",
      kycTier: "TIER_1",
    });
    const wallet = makeWallet({ dailyLimit: BigInt(200000) });
    mockPrisma.wallet.create.mockResolvedValue(wallet);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post("/wallets")
      .send({ userId: "user-uuid-1" });
    expect(res.status).toBe(201);
    expect(mockPrisma.wallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dailyLimit: 200000,
          monthlyLimit: 1000000,
        }),
      }),
    );
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app).post("/wallets").send({});
    expect(res.status).toBe(400);
  });

  it("returns 401 when user not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/wallets")
      .send({ userId: "nonexistent" });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /wallets/:walletId", () => {
  it("returns 200 with wallet details and serialised BigInts", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());

    const res = await request(app).get("/wallets/wallet-uuid-1");
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.balance).toBe("100000");
    expect(res.body.data.wallet.dailyLimit).toBe("50000");
  });

  it("returns 404 when wallet is not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/wallets/nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 404 when wallet is soft-deleted", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(
      makeWallet({ isDeleted: true }),
    );
    const res = await request(app).get("/wallets/wallet-uuid-1");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /wallets/lookup", () => {
  it("returns wallet by walletNumber", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      ...makeWallet(),
      user: { fullName: "Thabo Nkosi" },
    });

    const res = await request(app).get(
      "/wallets/lookup?walletNumber=AHV-ABC1-DEF2-GHI3",
    );
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.holderName).toBe("Thabo Nkosi");
  });

  it("returns 400 when walletNumber query param is missing", async () => {
    const res = await request(app).get("/wallets/lookup");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown walletNumber", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/wallets/lookup?walletNumber=AHV-XXXX");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /wallets/:walletId/transactions", () => {
  it("returns transactions list", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    mockPrisma.walletTransaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        transactionType: "DEBIT",
        amount: BigInt(5000),
        status: "COMPLETED",
      },
    ]);

    const res = await request(app).get("/wallets/wallet-uuid-1/transactions");
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/wallets/nonexistent/transactions");
    expect(res.status).toBe(404);
  });

  it("caps limit at 250", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    mockPrisma.walletTransaction.findMany.mockResolvedValue([]);
    await request(app).get("/wallets/wallet-uuid-1/transactions?limit=9999");
    expect(mockPrisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 250 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /wallets/:walletId/balance", () => {
  it("returns computed available balance", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      id: "w1",
      balance: BigInt(100000),
      pendingBalance: BigInt(10000),
      reservedBalance: BigInt(5000),
      currency: "ZAR",
    });

    const res = await request(app).get("/wallets/wallet-uuid-1/balance");
    expect(res.status).toBe(200);
    expect(res.body.data.balance.available).toBe("85000");
    expect(res.body.data.balance.total).toBe("100000");
    expect(res.body.data.balance.currency).toBe("ZAR");
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/wallets/nonexistent/balance");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /wallets/:walletId/limits", () => {
  it("updates wallet limits", async () => {
    const wallet = makeWallet();
    mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
    mockPrisma.wallet.update.mockResolvedValue({
      ...wallet,
      dailyLimit: BigInt(100000),
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post("/wallets/wallet-uuid-1/limits")
      .send({ dailyLimit: 100000 });
    expect(res.status).toBe(200);
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/wallets/nonexistent/limits")
      .send({ dailyLimit: 100000 });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /wallets/:walletId/suspend", () => {
  it("suspends a wallet and creates audit log", async () => {
    const wallet = makeWallet({ status: "SUSPENDED" });
    mockPrisma.wallet.update.mockResolvedValue(wallet);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post("/wallets/wallet-uuid-1/suspend")
      .send({ reason: "AML Review" });
    expect(res.status).toBe(200);
    expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUSPENDED" }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /wallets/:walletId/freeze", () => {
  it("freezes a wallet", async () => {
    mockPrisma.wallet.update.mockResolvedValue(
      makeWallet({ status: "FROZEN" }),
    );

    const res = await request(app)
      .post("/wallets/wallet-uuid-1/freeze")
      .send({ reason: "Court Order" });
    expect(res.status).toBe(200);
    expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FROZEN" }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
const WALLET_ID = "wallet-uuid-1";
const QR_HASH = "abc123def456";

function makeQr(overrides = {}) {
  return {
    id: "qr-001",
    walletId: WALLET_ID,
    qrType: "STATIC",
    qrPayload: '{"walletId":"wallet-uuid-1"}',
    qrHash: QR_HASH,
    amountCents: null,
    currency: "ZAR",
    description: null,
    expiresAt: null,
    usedAt: null,
    usageCount: 0,
    maxUsage: null,
    isActive: true,
    createdAt: new Date(),
    wallet: makeWallet(),
    ...overrides,
  };
}

describe("POST /wallets/:walletId/qr", () => {
  it("generates a static QR code and returns 201", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    const qr = makeQr();
    mockPrisma.paymentQrCode.create.mockResolvedValue(qr);

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .send({ qrType: "STATIC" });

    expect(res.status).toBe(201);
    expect(res.body.data.qrId).toBe("qr-001");
    expect(res.body.data.qrType).toBe("STATIC");
    expect(res.body.data.deepLink).toContain("ubuntu://pay?qr=");
  });

  it("generates a dynamic QR code with locked amount", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    const qr = makeQr({
      qrType: "DYNAMIC",
      amountCents: BigInt(5000),
      expiresAt: new Date(Date.now() + 600000),
      maxUsage: 1,
    });
    mockPrisma.paymentQrCode.create.mockResolvedValue(qr);

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .send({ qrType: "DYNAMIC", amountCents: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.amountCents).toBe(5000);
    expect(res.body.data.expiresAt).not.toBeNull();
  });

  it("returns 400 when DYNAMIC QR has no amountCents", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .send({ qrType: "DYNAMIC" });

    expect(res.status).toBe(400);
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .send({ qrType: "STATIC" });

    expect(res.status).toBe(404);
  });

  it("returns 403 when wallet is suspended", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(
      makeWallet({ status: "SUSPENDED" }),
    );

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .send({ qrType: "STATIC" });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /qr/:qrHash", () => {
  it("returns QR details for a valid static QR", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({
        wallet: {
          walletNumber: "AHV-ABC1-DEF2-GHI3",
          status: "ACTIVE",
          walletType: "MERCHANT",
          user: {
            preferredName: "Mama Thandi",
            fullName: "Thandi Zulu",
          },
        },
      }),
    );

    const res = await request(app).get(`/qr/${QR_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.data.qrType).toBe("STATIC");
    expect(res.body.data.walletNumber).toBe("AHV-ABC1-DEF2-GHI3");
    expect(res.body.data.recipientName).toBe("Mama Thandi");
    expect(res.body.data.walletType).toBe("MERCHANT");
    expect(res.body.data.amountCents).toBeNull();
  });

  it("returns 404 when QR not found", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(null);
    const res = await request(app).get("/qr/nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 410 when QR is expired", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await request(app).get(`/qr/${QR_HASH}`);
    expect(res.status).toBe(410);
  });

  it("returns 400 when dynamic QR already used", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ maxUsage: 1, usageCount: 1 }),
    );
    const res = await request(app).get(`/qr/${QR_HASH}`);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /qr/:qrHash/pay", () => {
  const SENDER_ID = "sender-wallet-001";
  const senderWallet = {
    ...makeWallet({ id: SENDER_ID, balance: BigInt(100000) }),
  };
  const debitTxn = { id: "debit-txn-001" };

  beforeEach(() => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ wallet: makeWallet() }),
    );
    mockPrisma.wallet.findUnique.mockResolvedValue(senderWallet);
    mockPrisma.$transaction.mockResolvedValue([{}, {}, debitTxn, {}, {}]);
  });

  it("debits sender and credits QR wallet on success", async () => {
    const res = await request(app).post(`/qr/${QR_HASH}/pay`).send({
      senderWalletId: SENDER_ID,
      amountCents: 5000,
      idempotencyKey: "idem-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.transactionId).toBe("debit-txn-001");
    expect(res.body.data.amountCents).toBe(5000);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .send({ senderWalletId: SENDER_ID });
    expect(res.status).toBe(400);
  });

  it("returns 404 when QR not found", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(null);
    const res = await request(app).post(`/qr/${QR_HASH}/pay`).send({
      senderWalletId: SENDER_ID,
      amountCents: 5000,
      idempotencyKey: "ik-1",
    });
    expect(res.status).toBe(404);
  });

  it("returns 410 when QR expired", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ expiresAt: new Date(Date.now() - 1000), wallet: makeWallet() }),
    );
    const res = await request(app).post(`/qr/${QR_HASH}/pay`).send({
      senderWalletId: SENDER_ID,
      amountCents: 5000,
      idempotencyKey: "ik-1",
    });
    expect(res.status).toBe(410);
  });

  it("returns 402 when sender has insufficient balance", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(
      makeWallet({ id: SENDER_ID, balance: BigInt(100) }),
    );
    const res = await request(app).post(`/qr/${QR_HASH}/pay`).send({
      senderWalletId: SENDER_ID,
      amountCents: 5000,
      idempotencyKey: "ik-1",
    });
    expect(res.status).toBe(402);
  });

  it("returns 400 for self-payment", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ walletId: SENDER_ID, wallet: makeWallet({ id: SENDER_ID }) }),
    );
    const res = await request(app).post(`/qr/${QR_HASH}/pay`).send({
      senderWalletId: SENDER_ID,
      amountCents: 5000,
      idempotencyKey: "ik-1",
    });
    expect(res.status).toBe(400);
  });

  it("enforces dynamic QR locked amount", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({
        qrType: "DYNAMIC",
        amountCents: BigInt(3000),
        wallet: makeWallet(),
      }),
    );
    const res = await request(app).post(`/qr/${QR_HASH}/pay`).send({
      senderWalletId: SENDER_ID,
      amountCents: 9999,
      idempotencyKey: "ik-1",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAY_INVALID_AMOUNT");
  });
});
