import request from "supertest";
import * as nodeCrypto from "crypto";
import * as jwt from "jsonwebtoken";

// Real RSA keypair + JWT_PUBLIC_KEY env var: requireAgentRole's verifyJWT()
// call (packages/shared-crypto, not mocked in this file) falls back to
// reading this env var when no explicit key is passed. Same recipe as
// wallet-service/payment-service/kyc-service's test suites.
const { publicKey: testPublicKey, privateKey: testPrivateKey } =
  nodeCrypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
process.env.JWT_PUBLIC_KEY = testPublicKey;

function agentAuthHeader(): string {
  const token = jwt.sign(
    { sub: "agent-user-1", role: "AGENT" },
    testPrivateKey,
    { algorithm: "RS256", issuer: "ahava-ewallet", expiresIn: "5m" },
  );
  return `Bearer ${token}`;
}

// ─── Mock PrismaClient ────────────────────────────────────────────
const mockPrisma = {
  walletTransaction: {
    aggregate: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

// ─── Import app AFTER all mocks ───────────────────────────────────
import app from "../main";

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /reports/vat", () => {
  it("returns VAT report with BigInt values as strings", async () => {
    mockPrisma.walletTransaction.aggregate.mockResolvedValue({
      _sum: { amount: BigInt(1000000) },
      _count: { id: 25 },
    });

    const res = await request(app)
      .get("/reports/vat")
      .set("Authorization", agentAuthHeader())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(res.body.data.report.totalAmountCents).toBe("1000000");
    expect(res.body.data.report.vatCollectedCents).toBe("150000");
    expect(res.body.data.report.transactionCount).toBe(25);
    expect(res.body.data.report.currency).toBe("ZAR");
  });

  it("returns zeroes when no transactions in period", async () => {
    mockPrisma.walletTransaction.aggregate.mockResolvedValue({
      _sum: { amount: null },
      _count: { id: 0 },
    });

    const res = await request(app)
      .get("/reports/vat")
      .set("Authorization", agentAuthHeader())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(res.body.data.report.totalAmountCents).toBe("0");
    expect(res.body.data.report.vatCollectedCents).toBe("0");
  });

  it("returns 400 when periodStart is missing", async () => {
    const res = await request(app)
      .get("/reports/vat")
      .set("Authorization", agentAuthHeader())
      .query({ periodEnd: "2026-01-31" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when periodEnd is missing", async () => {
    const res = await request(app)
      .get("/reports/vat")
      .set("Authorization", agentAuthHeader())
      .query({ periodStart: "2026-01-01" });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /reports/reconciliation", () => {
  it("returns balanced reconciliation report", async () => {
    mockPrisma.walletTransaction.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: BigInt(500000) },
        _count: { id: 10 },
      })
      .mockResolvedValueOnce({
        _sum: { amount: BigInt(500000) },
        _count: { id: 10 },
      });

    const res = await request(app).get("/reports/reconciliation")
      .set("Authorization", agentAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.reconciliation.balanced).toBe(true);
    expect(res.body.data.reconciliation.discrepancyCents).toBe("0");
    expect(res.body.data.reconciliation.totalDebitsCents).toBe("500000");
    expect(res.body.data.reconciliation.totalCreditsCents).toBe("500000");
  });

  it("detects imbalance and reports discrepancy", async () => {
    mockPrisma.walletTransaction.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: BigInt(600000) },
        _count: { id: 12 },
      })
      .mockResolvedValueOnce({
        _sum: { amount: BigInt(500000) },
        _count: { id: 10 },
      });

    const res = await request(app).get("/reports/reconciliation")
      .set("Authorization", agentAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.reconciliation.balanced).toBe(false);
    expect(res.body.data.reconciliation.discrepancyCents).toBe("100000");
  });

  it("handles null aggregate sums gracefully", async () => {
    mockPrisma.walletTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null }, _count: { id: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: null }, _count: { id: 0 } });

    const res = await request(app).get("/reports/reconciliation")
      .set("Authorization", agentAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.reconciliation.balanced).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /reports/sarb", () => {
  it("returns SARB monthly report with large transaction list", async () => {
    mockPrisma.walletTransaction.aggregate.mockResolvedValue({
      _sum: { amount: BigInt(10000000) },
      _count: { id: 200 },
    });
    mockPrisma.walletTransaction.findMany
      .mockResolvedValueOnce([
        {
          id: "txn-1",
          amount: BigInt(1000000),
          createdAt: new Date(),
          wallet: { userId: "u1" },
        },
      ])
      .mockResolvedValueOnce([{ walletId: "w1" }, { walletId: "w2" }]);

    const res = await request(app)
      .get("/reports/sarb")
      .set("Authorization", agentAuthHeader())
      .query({ year: "2026", month: "1" });

    expect(res.status).toBe(200);
    expect(res.body.data.report.totalAmountCents).toBe("10000000");
    expect(res.body.data.report.totalTransactions).toBe(200);
    expect(res.body.data.report.uniqueWallets).toBe(2);
    expect(res.body.data.report.largeTransactionCount).toBe(1);
    expect(res.body.data.report.largeTransactions[0].amountCents).toBe(
      "1000000",
    );
    expect(res.body.data.report.currency).toBe("ZAR");
  });

  it("returns 400 when year is missing", async () => {
    const res = await request(app).get("/reports/sarb")
      .set("Authorization", agentAuthHeader()).query({ month: "1" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when month is missing", async () => {
    const res = await request(app).get("/reports/sarb")
      .set("Authorization", agentAuthHeader()).query({ year: "2026" });
    expect(res.status).toBe(400);
  });

  it("includes generatedAt timestamp in response", async () => {
    mockPrisma.walletTransaction.aggregate.mockResolvedValue({
      _sum: { amount: BigInt(0) },
      _count: { id: 0 },
    });
    mockPrisma.walletTransaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/reports/sarb")
      .set("Authorization", agentAuthHeader())
      .query({ year: "2026", month: "3" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.generatedAt).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// Regression coverage: this whole file had no authorization at all — any
// caller (or none) could pull system-wide financial reports, including
// /reports/sarb's individual large-transaction records with userIds.
describe("Authorization", () => {
  it("rejects /reports/vat without an Authorization header", async () => {
    const res = await request(app)
      .get("/reports/vat")
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(res.status).toBe(403);
  });

  it("rejects /reports/reconciliation without an agent role", async () => {
    const token = jwt.sign(
      { sub: "regular-customer-1" },
      testPrivateKey,
      { algorithm: "RS256", issuer: "ahava-ewallet", expiresIn: "5m" },
    );
    const res = await request(app)
      .get("/reports/reconciliation")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("rejects /reports/sarb without an Authorization header", async () => {
    const res = await request(app)
      .get("/reports/sarb")
      .query({ year: "2026", month: "1" });
    expect(res.status).toBe(403);
  });
});
