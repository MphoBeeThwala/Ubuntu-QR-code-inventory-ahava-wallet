import request from "supertest";

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
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(res.body.data.report.totalAmountCents).toBe("0");
    expect(res.body.data.report.vatCollectedCents).toBe("0");
  });

  it("returns 400 when periodStart is missing", async () => {
    const res = await request(app)
      .get("/reports/vat")
      .query({ periodEnd: "2026-01-31" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when periodEnd is missing", async () => {
    const res = await request(app)
      .get("/reports/vat")
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

    const res = await request(app).get("/reports/reconciliation");

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

    const res = await request(app).get("/reports/reconciliation");

    expect(res.status).toBe(200);
    expect(res.body.data.reconciliation.balanced).toBe(false);
    expect(res.body.data.reconciliation.discrepancyCents).toBe("100000");
  });

  it("handles null aggregate sums gracefully", async () => {
    mockPrisma.walletTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null }, _count: { id: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: null }, _count: { id: 0 } });

    const res = await request(app).get("/reports/reconciliation");
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
    const res = await request(app).get("/reports/sarb").query({ month: "1" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when month is missing", async () => {
    const res = await request(app).get("/reports/sarb").query({ year: "2026" });
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
      .query({ year: "2026", month: "3" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.generatedAt).toBeDefined();
  });
});
