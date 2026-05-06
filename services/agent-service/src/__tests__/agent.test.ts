/**
 * Agent Service Tests
 *
 * Covers:
 * - GET /health
 * - POST /agents/auth/login: success, bad credentials, inactive agent, missing fields
 * - GET /agents/stats: authenticated, unauthorized
 * - GET /agents/transactions: with/without float wallet
 * - POST /agents/cash-in: success, insufficient float, missing fields, invalid wallet
 * - POST /agents/cash-out: success, insufficient customer balance, missing fields
 */

import request from "supertest";
import crypto from "crypto";
import * as jwt from "jsonwebtoken";

// ─── Mocks ────────────────────────────────────────────────────────

const mockVerifyPin = jest.fn();
const mockGenerateAccessToken = jest.fn();
const mockGenerateRefreshToken = jest.fn();

const keyPair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

process.env.JWT_PUBLIC_KEY = keyPair.publicKey;

jest.mock("../../../../packages/shared-crypto/src/index.ts", () => {
  const actual = jest.requireActual(
    "../../../../packages/shared-crypto/src/index.ts",
  );
  return {
    ...actual,
    verifyPin: (...args: unknown[]) => mockVerifyPin(...args),
    generateAccessToken: (...args: unknown[]) =>
      mockGenerateAccessToken(...args),
    generateRefreshToken: (...args: unknown[]) =>
      mockGenerateRefreshToken(...args),
  };
});

const mockAgent = {
  id: "agent-001",
  userId: "user-agent-001",
  agentCode: "AHV-AGT-00001",
  businessName: "Thabo's Spaza Shop",
  businessAddress: "12 Main Rd, Soweto",
  status: "ACTIVE",
  floatWalletId: "float-wallet-001",
  cashInCommissionBps: 80,
  cashOutCommissionBps: 70,
  minFloatCents: BigInt(50000),
  maxFloatCents: BigInt(5000000),
  floatWallet: {
    id: "float-wallet-001",
    balance: BigInt(500000),
    walletNumber: "AHV-AGNT-XXXX-YYYY",
    status: "ACTIVE",
  },
};

const mockUser = {
  id: "user-agent-001",
  email: "thabo@example.co.za",
  pinHash: "$argon2id$hashed",
  isDeleted: false,
  kycTier: "TIER_1",
  agentProfile: mockAgent,
};

const mockCustomerWallet = {
  id: "cust-wallet-001",
  balance: BigInt(200000),
  pendingBalance: BigInt(0),
  reservedBalance: BigInt(0),
  isDeleted: false,
  status: "ACTIVE",
};

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  agent: {
    findUnique: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  walletTransaction: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  kycDocument: {
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import app from "../main";

// ─── Helpers ──────────────────────────────────────────────────────

function authHeader() {
  const token = jwt.sign({ sub: "user-agent-001" }, keyPair.privateKey, {
    algorithm: "RS256",
    issuer: "ahava-ewallet",
    expiresIn: "5m",
  });
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockVerifyPin.mockResolvedValue(true);
  mockGenerateAccessToken.mockResolvedValue("agent-access-token");
  mockGenerateRefreshToken.mockResolvedValue("agent-refresh-token");

  mockPrisma.user.findFirst.mockResolvedValue(mockUser);
  mockPrisma.user.findUnique.mockResolvedValue(mockUser);
  mockPrisma.refreshToken.create.mockResolvedValue({});
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.agent.findUnique.mockResolvedValue(mockAgent);
  mockPrisma.wallet.findUnique.mockResolvedValue(mockCustomerWallet);
  mockPrisma.walletTransaction.findMany.mockResolvedValue([]);
  mockPrisma.walletTransaction.count.mockResolvedValue(0);
  mockPrisma.kycDocument.count.mockResolvedValue(2);

  const debitTxn = { id: "debit-txn-001" };
  const creditTxn = { id: "credit-txn-001" };
  mockPrisma.$transaction.mockResolvedValue([{}, {}, debitTxn, creditTxn]);
});

// ─────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.service).toBe("agent-service");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /agents/auth/login", () => {
  it("returns 200 with tokens on valid credentials", async () => {
    const res = await request(app)
      .post("/agents/auth/login")
      .send({ email: "thabo@example.co.za", password: "1234" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBe("agent-access-token");
    expect(res.body.data.agentCode).toBe("AHV-AGT-00001");
  });

  it("creates a refresh token and audit log", async () => {
    await request(app)
      .post("/agents/auth/login")
      .send({ email: "thabo@example.co.za", password: "1234" });

    expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "AGENT_LOGIN" }),
      }),
    );
  });

  it("returns 401 for unknown email", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/agents/auth/login")
      .send({ email: "unknown@example.co.za", password: "1234" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("returns 401 for wrong password", async () => {
    mockVerifyPin.mockResolvedValue(false);

    const res = await request(app)
      .post("/agents/auth/login")
      .send({ email: "thabo@example.co.za", password: "0000" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("returns 401 when user has no agent profile", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      ...mockUser,
      agentProfile: null,
    });

    const res = await request(app)
      .post("/agents/auth/login")
      .send({ email: "thabo@example.co.za", password: "1234" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when agent status is SUSPENDED", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      ...mockUser,
      agentProfile: { ...mockAgent, status: "SUSPENDED" },
    });

    const res = await request(app)
      .post("/agents/auth/login")
      .send({ email: "thabo@example.co.za", password: "1234" });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("suspended");
  });

  it("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/agents/auth/login")
      .send({ password: "1234" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/agents/auth/login")
      .send({ email: "thabo@example.co.za" });

    expect(res.status).toBe(400);
  });
});

describe("GET /agents/me", () => {
  it("returns the authenticated agent profile", async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...mockAgent,
      user: {
        email: "thabo@example.co.za",
        fullName: "Thabo Dlamini",
        phoneNumber: "+27821234567",
      },
    });

    const res = await request(app).get("/agents/me").set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.agent.id).toBe("agent-001");
    expect(res.body.data.agent.floatWallet.balance).toBe("500000");
  });

  it("returns 403 when the authenticated agent profile is missing", async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/agents/me").set(authHeader());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_UNAUTHORIZED");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /agents/stats", () => {
  it("returns stats for authenticated agent", async () => {
    const res = await request(app).get("/agents/stats").set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("totalTransactionsCents");
    expect(res.body.data).toHaveProperty("pendingKyc", 2);
    expect(res.body.data).toHaveProperty("successRate", 100);
  });

  it("returns 403 without auth header", async () => {
    const res = await request(app).get("/agents/stats");
    expect(res.status).toBe(403);
  });

  it("returns 403 when JWT is invalid", async () => {
    const res = await request(app)
      .get("/agents/stats")
      .set({ Authorization: "Bearer invalid.jwt.token" });
    expect(res.status).toBe(403);
  });

  it("returns empty stats when agent has no float wallet", async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...mockAgent,
      floatWalletId: null,
    });

    const res = await request(app).get("/agents/stats").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.totalTransactionsCents).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /agents/transactions", () => {
  it("returns transaction list", async () => {
    mockPrisma.walletTransaction.findMany.mockResolvedValue([
      {
        id: "txn-001",
        transactionType: "CREDIT",
        amount: BigInt(50000),
        status: "COMPLETED",
        description: "Cash-in",
        createdAt: new Date(),
        counterpartyWallet: {
          user: { phoneNumber: "+27821234567" },
        },
      },
    ]);
    mockPrisma.walletTransaction.count.mockResolvedValue(1);

    const res = await request(app)
      .get("/agents/transactions")
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].customerPhone).toBeDefined();
  });

  it("returns empty list when no float wallet", async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...mockAgent,
      floatWalletId: null,
    });

    const res = await request(app)
      .get("/agents/transactions")
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /agents/cash-in", () => {
  const payload = () => ({
    customerWalletId: "cust-wallet-001",
    amountCents: 10000,
    idempotencyKey: "ci-test-key-001",
  });

  it("credits customer wallet and debits float on success", async () => {
    const res = await request(app)
      .post("/agents/cash-in")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(201);
    expect(res.body.data.transactionId).toBe("debit-txn-001");
    expect(res.body.data.amountCents).toBe(10000);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 402 when float balance is insufficient", async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...mockAgent,
      floatWallet: { ...mockAgent.floatWallet, balance: BigInt(5000) },
    });

    const res = await request(app)
      .post("/agents/cash-in")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("WAL_INSUFFICIENT_BALANCE");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when customer wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/agents/cash-in")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("WAL_NOT_FOUND");
  });

  it("returns 404 when agent float wallet is missing", async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...mockAgent,
      floatWallet: null,
    });

    const res = await request(app)
      .post("/agents/cash-in")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("WAL_NOT_FOUND");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/agents/cash-in")
      .set(authHeader())
      .send({ amountCents: 10000 });

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-positive amountCents", async () => {
    const res = await request(app)
      .post("/agents/cash-in")
      .set(authHeader())
      .send({ ...payload(), amountCents: -100 });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /agents/cash-out", () => {
  const payload = () => ({
    customerWalletId: "cust-wallet-001",
    amountCents: 5000,
    idempotencyKey: "co-test-key-001",
  });

  it("debits customer wallet and credits float on success", async () => {
    const res = await request(app)
      .post("/agents/cash-out")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(201);
    expect(res.body.data.transactionId).toBe("debit-txn-001");
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 402 when customer has insufficient balance", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      ...mockCustomerWallet,
      balance: BigInt(1000),
    });

    const res = await request(app)
      .post("/agents/cash-out")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("WAL_INSUFFICIENT_BALANCE");
  });

  it("returns 404 when customer wallet not found", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/agents/cash-out")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(404);
  });

  it("returns 404 when agent float wallet is missing", async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...mockAgent,
      floatWallet: null,
    });

    const res = await request(app)
      .post("/agents/cash-out")
      .set(authHeader())
      .send(payload());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("WAL_NOT_FOUND");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/agents/cash-out")
      .set(authHeader())
      .send({ customerWalletId: "cust-wallet-001" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-positive amountCents", async () => {
    const res = await request(app)
      .post("/agents/cash-out")
      .set(authHeader())
      .send({ ...payload(), amountCents: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_INPUT");
  });
});
