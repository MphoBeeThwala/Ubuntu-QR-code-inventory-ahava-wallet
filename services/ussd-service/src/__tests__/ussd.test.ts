/**
 * USSD Service Tests
 *
 * Scenarios:
 * - GET /health
 * - POST /ussd — root menu, balance, send money flow, airtime flow, mini statement, exit
 * - Invalid option fallback
 * - Missing required fields
 */

import request from "supertest";

// ─── Mock PrismaClient ────────────────────────────────────────────

const mockUser = {
  id: "user-001",
  phoneNumber: "+27821234567",
  isDeleted: false,
  wallets: [
    {
      id: "wallet-001",
      walletNumber: "AHV-TEST-AAAA-BBBB",
      walletType: "PERSONAL",
      isDeleted: false,
      balance: BigInt(100000), // R1000.00
      pendingBalance: BigInt(0),
      reservedBalance: BigInt(0),
      perTransactionLimit: BigInt(50000),
      createdAt: new Date(),
    },
  ],
};

const mockRecipientWallet = {
  id: "wallet-002",
  walletNumber: "AHV-RECV-CCCC-DDDD",
  isDeleted: false,
  balance: BigInt(50000),
  pendingBalance: BigInt(0),
  reservedBalance: BigInt(0),
  perTransactionLimit: BigInt(50000),
  user: { fullName: "Thabo Nkosi" },
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  walletTransaction: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

// Import after mocks
import app from "../main";

// ─── Helpers ──────────────────────────────────────────────────────

function ussdPost(text: string, phoneNumber = "+27821234567") {
  return request(app).post("/ussd").type("form").send({
    sessionId: "session-test-001",
    serviceCode: "*384#",
    phoneNumber,
    text,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(mockUser);
  mockPrisma.wallet.findUnique.mockResolvedValue(mockRecipientWallet);
  mockPrisma.walletTransaction.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.service).toBe("ussd-service");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /ussd — root menu", () => {
  it("shows main menu on initial empty text", async () => {
    const res = await ussdPost("");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("Check Balance");
    expect(res.text).toContain("Send Money");
    expect(res.text).toContain("Buy Airtime");
    expect(res.text).toContain("Mini Statement");
    expect(res.text).toContain("Exit");
  });

  it("returns 400 when sessionId is missing", async () => {
    const res = await request(app)
      .post("/ussd")
      .type("form")
      .send({ phoneNumber: "+27821234567", text: "" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("END");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /ussd — option 1: Check Balance", () => {
  it("returns END with balance for known user", async () => {
    const res = await ussdPost("1");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("R1000.00");
  });

  it("returns END with account not found when user missing", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await ussdPost("1");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("not found");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /ussd — option 2: Send Money", () => {
  it("step 1: prompts for recipient wallet number", async () => {
    const res = await ussdPost("2");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("recipient wallet number");
  });

  it("step 2: shows recipient name and prompts for amount", async () => {
    const res = await ussdPost("2*AHV-RECV-CCCC-DDDD");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("Thabo Nkosi");
    expect(res.text).toContain("amount");
  });

  it("step 2: shows not found for unknown wallet", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    const res = await ussdPost("2*AHV-XXXX-YYYY-ZZZZ");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("not found");
  });

  it("step 3: shows confirmation screen", async () => {
    const res = await ussdPost("2*AHV-RECV-CCCC-DDDD*50");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("Confirm");
    expect(res.text).toContain("R50.00");
  });

  it("step 3: rejects invalid amount", async () => {
    const res = await ussdPost("2*AHV-RECV-CCCC-DDDD*abc");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("Invalid amount");
  });

  it("step 4: processes transfer on confirm=1", async () => {
    const res = await ussdPost("2*AHV-RECV-CCCC-DDDD*50*1");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("successful");
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("step 4: cancels on confirm=2", async () => {
    const res = await ussdPost("2*AHV-RECV-CCCC-DDDD*50*2");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("cancelled");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("step 1: 0 goes back to main menu", async () => {
    const res = await ussdPost("2*0");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("Check Balance");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /ussd — option 3: Buy Airtime", () => {
  it("step 1: prompts for phone number", async () => {
    const res = await ussdPost("3");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("phone number");
  });

  it("step 2: uses own phone when 0 entered", async () => {
    const res = await ussdPost("3*0");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("+27821234567");
    expect(res.text).toContain("amount");
  });

  it("step 3: shows confirmation for airtime", async () => {
    const res = await ussdPost("3*0721234567*20");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("R20.00");
    expect(res.text).toContain("Confirm");
  });

  it("step 4: processes airtime on confirm=1", async () => {
    const res = await ussdPost("3*0721234567*20*1");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("Airtime sent");
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("step 4: cancels airtime on confirm=2", async () => {
    const res = await ussdPost("3*0721234567*20*2");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("cancelled");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /ussd — option 4: Mini Statement", () => {
  it("returns END with 'No transactions yet' when empty", async () => {
    mockPrisma.walletTransaction.findMany.mockResolvedValue([]);
    const res = await ussdPost("4");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("No transactions");
  });

  it("returns last 5 transactions", async () => {
    mockPrisma.walletTransaction.findMany.mockResolvedValue([
      {
        id: "t1",
        transactionType: "CREDIT",
        amount: BigInt(5000),
        status: "COMPLETED",
        createdAt: new Date("2026-03-20"),
      },
      {
        id: "t2",
        transactionType: "DEBIT",
        amount: BigInt(1000),
        status: "COMPLETED",
        createdAt: new Date("2026-03-19"),
      },
    ]);
    const res = await ussdPost("4");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("Mini Statement");
    expect(res.text).toContain("+R50.00");
    expect(res.text).toContain("-R10.00");
  });

  it("returns not found when user missing", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await ussdPost("4");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("not found");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /ussd — option 5: Exit", () => {
  it("terminates session", async () => {
    const res = await ussdPost("5");
    expect(res.text).toMatch(/^END /);
    expect(res.text).toContain("Thank you");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /ussd — invalid option", () => {
  it("falls back to main menu with CON", async () => {
    const res = await ussdPost("9");
    expect(res.text).toMatch(/^CON /);
    expect(res.text).toContain("Invalid option");
    expect(res.text).toContain("Check Balance");
  });
});
