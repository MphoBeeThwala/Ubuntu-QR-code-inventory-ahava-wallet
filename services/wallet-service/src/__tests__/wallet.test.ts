import request from "supertest";
import * as nodeCrypto from "crypto";
import * as jwt from "jsonwebtoken";

// Real RSA keypair + JWT_PUBLIC_KEY env var, not a mock: requireAgentRole's
// verifyJWT() call (packages/shared-crypto) falls back to reading this env
// var when no explicit key is passed, so signing real tokens here exercises
// the actual verification path rather than stubbing it out. Same recipe as
// services/agent-service/src/__tests__/agent.test.ts.
const { publicKey: testPublicKey, privateKey: testPrivateKey } =
  nodeCrypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
process.env.JWT_PUBLIC_KEY = testPublicKey;

function signToken(claims: Record<string, unknown>): string {
  return jwt.sign(claims, testPrivateKey, {
    algorithm: "RS256",
    issuer: "ahava-ewallet",
    expiresIn: "5m",
  });
}

function agentAuthHeader(): string {
  return `Bearer ${signToken({ sub: "agent-user-1", role: "AGENT" })}`;
}

// Matches makeWallet()'s default userId unless a test needs a different
// caller (e.g. the sender side of a QR payment, whose wallet is a separate
// mock with its own userId).
function customerAuthHeader(userId = "user-uuid-1"): string {
  return `Bearer ${signToken({ sub: userId })}`;
}

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

// The transaction client passed into prisma.$transaction(async (tx) => ...)
// callbacks — added alongside the P0 fix that moved /qr/:qrHash/pay's
// balance check and writes inside one FOR UPDATE-locked transaction
// (previously: an outside-the-lock findUnique + a bare array-form
// $transaction([...]), which is what left it exposed to the overdraft
// race the fix addresses) and reconnected it to the ledger.
const mockTx = {
  $queryRaw: jest.fn(),
  walletTransaction: {
    create: jest.fn(),
  },
  wallet: {
    update: jest.fn(),
  },
  paymentQrCode: {
    update: jest.fn(),
  },
  ledgerEntry: {
    create: jest.fn(),
  },
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
  // Pre-existing gap: main.ts calls this at module load time to configure
  // BullMQ, but this mock never provided it, so the whole suite failed to
  // load ("getRedisConnectionConfig is not a function") before a single
  // test ran — independent of the P0 fixes in this changeset.
  getRedisConnectionConfig: jest.fn(() => ({})),
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
      .set("Authorization", customerAuthHeader("user-uuid-1"))
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
      .set("Authorization", customerAuthHeader("user-uuid-1"))
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
    const res = await request(app)
      .post("/wallets")
      .set("Authorization", customerAuthHeader())
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 401 when user not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/wallets")
      .set("Authorization", customerAuthHeader("nonexistent"))
      .send({ userId: "nonexistent" });
    expect(res.status).toBe(403);
  });

  it("rejects creating a wallet for a different userId", async () => {
    const res = await request(app)
      .post("/wallets")
      .set("Authorization", customerAuthHeader("user-uuid-1"))
      .send({ userId: "someone-elses-user-id" });
    expect(res.status).toBe(403);
    expect(mockPrisma.wallet.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /wallets/:walletId", () => {
  it("returns 200 with wallet details and serialised BigInts", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());

    const res = await request(app)
      .get("/wallets/wallet-uuid-1")
      .set("Authorization", customerAuthHeader("user-uuid-1"));
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.balance).toBe("100000");
    expect(res.body.data.wallet.dailyLimit).toBe("50000");
  });

  it("returns 404 when wallet is not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get("/wallets/nonexistent")
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(404);
  });

  it("returns 404 when wallet is soft-deleted", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(
      makeWallet({ isDeleted: true }),
    );
    const res = await request(app)
      .get("/wallets/wallet-uuid-1")
      .set("Authorization", customerAuthHeader("user-uuid-1"));
    expect(res.status).toBe(404);
  });

  it("rejects a non-owner, non-agent caller", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    const res = await request(app)
      .get("/wallets/wallet-uuid-1")
      .set("Authorization", customerAuthHeader("a-different-user"));
    expect(res.status).toBe(403);
  });

  it("allows an agent to view any wallet's details", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    const res = await request(app)
      .get("/wallets/wallet-uuid-1")
      .set("Authorization", agentAuthHeader());
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /wallets/lookup", () => {
  it("returns wallet by walletNumber", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      ...makeWallet(),
      user: { fullName: "Thabo Nkosi" },
    });

    const res = await request(app)
      .get("/wallets/lookup?walletNumber=AHV-ABC1-DEF2-GHI3")
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.holderName).toBe("Thabo Nkosi");
    // Regression coverage: this response used to include the recipient's
    // raw balance, leaking it to any sender who merely looked up their
    // wallet number before paying.
    expect(res.body.data.wallet.balance).toBeUndefined();
  });

  it("returns 400 when walletNumber query param is missing", async () => {
    const res = await request(app)
      .get("/wallets/lookup")
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown walletNumber", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get("/wallets/lookup?walletNumber=AHV-XXXX")
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(404);
  });

  it("rejects without an Authorization header", async () => {
    const res = await request(app).get(
      "/wallets/lookup?walletNumber=AHV-ABC1-DEF2-GHI3",
    );
    expect(res.status).toBe(403);
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

    const res = await request(app)
      .get("/wallets/wallet-uuid-1/transactions")
      .set("Authorization", customerAuthHeader("user-uuid-1"));
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get("/wallets/nonexistent/transactions")
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(404);
  });

  it("caps limit at 250", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    mockPrisma.walletTransaction.findMany.mockResolvedValue([]);
    await request(app)
      .get("/wallets/wallet-uuid-1/transactions?limit=9999")
      .set("Authorization", customerAuthHeader("user-uuid-1"));
    expect(mockPrisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 250 }),
    );
  });

  // Regression coverage: any authenticated user could previously read any
  // other user's transaction history just by knowing/guessing a walletId.
  it("rejects a non-owner, non-agent caller", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
    const res = await request(app)
      .get("/wallets/wallet-uuid-1/transactions")
      .set("Authorization", customerAuthHeader("a-different-user"));
    expect(res.status).toBe(403);
    expect(mockPrisma.walletTransaction.findMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /wallets/:walletId/balance", () => {
  it("returns computed available balance", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      id: "w1",
      userId: "user-uuid-1",
      balance: BigInt(100000),
      pendingBalance: BigInt(10000),
      reservedBalance: BigInt(5000),
      currency: "ZAR",
    });

    const res = await request(app)
      .get("/wallets/wallet-uuid-1/balance")
      .set("Authorization", customerAuthHeader("user-uuid-1"));
    expect(res.status).toBe(200);
    expect(res.body.data.balance.available).toBe("85000");
    expect(res.body.data.balance.total).toBe("100000");
    expect(res.body.data.balance.currency).toBe("ZAR");
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get("/wallets/nonexistent/balance")
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(404);
  });

  // Regression coverage: any authenticated user could previously read any
  // other user's balance just by knowing/guessing a walletId.
  it("rejects a non-owner, non-agent caller", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      id: "w1",
      userId: "user-uuid-1",
      balance: BigInt(100000),
      pendingBalance: BigInt(0),
      reservedBalance: BigInt(0),
      currency: "ZAR",
    });
    const res = await request(app)
      .get("/wallets/wallet-uuid-1/balance")
      .set("Authorization", customerAuthHeader("a-different-user"));
    expect(res.status).toBe(403);
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
      .set("Authorization", agentAuthHeader())
      .send({ dailyLimit: 100000 });
    expect(res.status).toBe(200);
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/wallets/nonexistent/limits")
      .set("Authorization", agentAuthHeader())
      .send({ dailyLimit: 100000 });
    expect(res.status).toBe(404);
  });

  it("rejects without an agent role", async () => {
    const res = await request(app)
      .post("/wallets/wallet-uuid-1/limits")
      .set("Authorization", customerAuthHeader("user-uuid-1"))
      .send({ dailyLimit: 100000 });
    expect(res.status).toBe(403);
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
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
      .set("Authorization", agentAuthHeader())
      .send({ reason: "AML Review" });
    expect(res.status).toBe(200);
    expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUSPENDED" }),
      }),
    );
  });

  // Regression coverage: this route used to have no authorization check at
  // all — any authenticated customer (not just agents) could freeze or
  // suspend any other user's wallet by walletId, with no ownership or role
  // check whatsoever.
  it("rejects without an Authorization header", async () => {
    const res = await request(app)
      .post("/wallets/wallet-uuid-1/suspend")
      .send({ reason: "AML Review" });
    expect(res.status).toBe(403);
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  });

  it("rejects a valid token that lacks the AGENT role", async () => {
    const res = await request(app)
      .post("/wallets/wallet-uuid-1/suspend")
      .set(
        "Authorization",
        `Bearer ${signToken({ sub: "regular-customer-1" })}`,
      )
      .send({ reason: "AML Review" });
    expect(res.status).toBe(403);
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
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
      .set("Authorization", agentAuthHeader())
      .send({ reason: "Court Order" });
    expect(res.status).toBe(200);
    expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FROZEN" }),
      }),
    );
  });

  it("rejects without an Authorization header", async () => {
    const res = await request(app)
      .post("/wallets/wallet-uuid-1/freeze")
      .send({ reason: "Court Order" });
    expect(res.status).toBe(403);
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
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
      .set("Authorization", customerAuthHeader("user-uuid-1"))
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
      .set("Authorization", customerAuthHeader("user-uuid-1"))
      .send({ qrType: "DYNAMIC", amountCents: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.amountCents).toBe(5000);
    expect(res.body.data.expiresAt).not.toBeNull();
  });

  it("returns 400 when DYNAMIC QR has no amountCents", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .set("Authorization", customerAuthHeader("user-uuid-1"))
      .send({ qrType: "DYNAMIC" });

    expect(res.status).toBe(400);
  });

  it("returns 404 when wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .set("Authorization", customerAuthHeader())
      .send({ qrType: "STATIC" });

    expect(res.status).toBe(404);
  });

  it("returns 403 when wallet is suspended", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(
      makeWallet({ status: "SUSPENDED" }),
    );

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .set("Authorization", customerAuthHeader("user-uuid-1"))
      .send({ qrType: "STATIC" });

    expect(res.status).toBe(403);
  });

  it("rejects generating a QR for a wallet the caller does not own", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/qr`)
      .set("Authorization", customerAuthHeader("a-different-user"))
      .send({ qrType: "STATIC" });

    expect(res.status).toBe(403);
    expect(mockPrisma.paymentQrCode.create).not.toHaveBeenCalled();
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

    const res = await request(app)
      .get(`/qr/${QR_HASH}`)
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.qrType).toBe("STATIC");
    expect(res.body.data.walletNumber).toBe("AHV-ABC1-DEF2-GHI3");
    expect(res.body.data.recipientName).toBe("Mama Thandi");
    expect(res.body.data.walletType).toBe("MERCHANT");
    expect(res.body.data.amountCents).toBeNull();
  });

  it("returns 404 when QR not found", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get("/qr/nonexistent")
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(404);
  });

  it("returns 410 when QR is expired", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await request(app)
      .get(`/qr/${QR_HASH}`)
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(410);
  });

  it("returns 400 when dynamic QR already used", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ maxUsage: 1, usageCount: 1 }),
    );
    const res = await request(app)
      .get(`/qr/${QR_HASH}`)
      .set("Authorization", customerAuthHeader());
    expect(res.status).toBe(400);
  });

  it("rejects without an Authorization header", async () => {
    const res = await request(app).get(`/qr/${QR_HASH}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /qr/:qrHash/pay", () => {
  const SENDER_ID = "sender-wallet-001";
  const debitTxn = { id: "debit-txn-001" };
  const creditTxn = { id: "credit-txn-001" };

  function lockedSenderRow(overrides: Record<string, unknown> = {}) {
    return {
      id: SENDER_ID,
      userId: "user-uuid-sender",
      isDeleted: false,
      status: "ACTIVE",
      balance: BigInt(100000),
      walletNumber: "AHV-SEND-0001",
      ...overrides,
    };
  }

  function lockedReceiverRow(overrides: Record<string, unknown> = {}) {
    return {
      id: WALLET_ID,
      userId: "user-uuid-1",
      isDeleted: false,
      status: "ACTIVE",
      balance: BigInt(0),
      walletNumber: "AHV-ABC1-DEF2-GHI3",
      ...overrides,
    };
  }

  // Configures the mocked $transaction to invoke the real callback (as
  // Prisma does) against mockTx, and mockTx.$queryRaw to answer the two
  // FOR UPDATE lock queries the route now issues — one for the wallet
  // pair, one for the QR row — by sniffing which table the raw SQL
  // targets, since a single mockResolvedValue can't tell them apart.
  function setupLockedTransaction(opts: {
    sender?: ReturnType<typeof lockedSenderRow>;
    receiver?: ReturnType<typeof lockedReceiverRow>;
    qrRow?: {
      usageCount: number;
      maxUsage: number | null;
      isActive: boolean;
      expiresAt: Date | null;
    };
  } = {}) {
    const sender = opts.sender ?? lockedSenderRow();
    const receiver = opts.receiver ?? lockedReceiverRow();
    const qrRow =
      opts.qrRow ?? { usageCount: 0, maxUsage: null, isActive: true, expiresAt: null };

    mockTx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("FROM wallets")) return Promise.resolve([sender, receiver]);
      if (sql.includes("FROM payment_qr_codes")) return Promise.resolve([qrRow]);
      return Promise.resolve([]);
    });
    mockTx.walletTransaction.create
      .mockResolvedValueOnce(debitTxn)
      .mockResolvedValueOnce(creditTxn);
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.paymentQrCode.update.mockResolvedValue({});
    mockTx.ledgerEntry.create.mockResolvedValue({});

    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    return { sender, receiver };
  }

  beforeEach(() => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(
      makeQr({ wallet: makeWallet() }),
    );
    setupLockedTransaction();
  });

  it("debits sender and credits QR wallet on success", async () => {
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({
        senderWalletId: SENDER_ID,
        amountCents: 5000,
        idempotencyKey: "idem-001",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.transactionId).toBe("debit-txn-001");
    expect(res.body.data.amountCents).toBe(5000);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.ledgerEntry.create).toHaveBeenCalledTimes(2);
  });

  // CRITICAL regression coverage: senderWalletId used to be trusted
  // straight from the request body with no check that the authenticated
  // caller actually owned it — any customer could drain funds from ANY
  // wallet just by supplying its id here.
  it("rejects paying from a wallet the caller does not own", async () => {
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("a-completely-different-user"))
      .send({
        senderWalletId: SENDER_ID,
        amountCents: 5000,
        idempotencyKey: "idem-theft-attempt",
      });

    expect(res.status).toBe(403);
    expect(mockTx.walletTransaction.create).not.toHaveBeenCalled();
    expect(mockTx.wallet.update).not.toHaveBeenCalled();
  });

  it("allows an agent to pay on a customer's behalf", async () => {
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", agentAuthHeader())
      .send({
        senderWalletId: SENDER_ID,
        amountCents: 5000,
        idempotencyKey: "idem-agent-assisted",
      });

    expect(res.status).toBe(201);
  });

  it("rejects without an Authorization header", async () => {
    const res = await request(app).post(`/qr/${QR_HASH}/pay`).send({
      senderWalletId: SENDER_ID,
      amountCents: 5000,
      idempotencyKey: "idem-no-auth",
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({ senderWalletId: SENDER_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 when senderWalletId is the wrong type (zod shape check)", async () => {
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({
        senderWalletId: 12345,
        amountCents: 5000,
        idempotencyKey: "idem-002",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_INPUT");
  });

  it("returns 404 when QR not found", async () => {
    mockPrisma.paymentQrCode.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({
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
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({
        senderWalletId: SENDER_ID,
        amountCents: 5000,
        idempotencyKey: "ik-1",
      });
    expect(res.status).toBe(410);
  });

  it("returns 402 when sender has insufficient balance", async () => {
    // Balance is now checked inside the FOR UPDATE-locked transaction, so
    // it's the locked row (mockTx.$queryRaw) that needs the low balance —
    // the old pre-transaction mockPrisma.wallet.findUnique is no longer
    // read by the route at all.
    setupLockedTransaction({ sender: lockedSenderRow({ balance: BigInt(100) }) });
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({
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
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({
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
    const res = await request(app)
      .post(`/qr/${QR_HASH}/pay`)
      .set("Authorization", customerAuthHeader("user-uuid-sender"))
      .send({
        senderWalletId: SENDER_ID,
        amountCents: 9999,
        idempotencyKey: "ik-1",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAY_INVALID_AMOUNT");
  });
});
