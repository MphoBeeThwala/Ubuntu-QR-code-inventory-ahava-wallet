import type { AddressInfo } from "net";
import type { Server } from "http";

const prismaMock = {
  wallet: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  walletTransaction: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => prismaMock),
}));

import app from "./main";

describe("wallet-service endpoints", () => {
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

  it("GET /wallets/user/:userId/balance returns personal wallet balance", async () => {
    prismaMock.wallet.findFirst.mockResolvedValue({
      id: "wallet-1",
      balance: BigInt(250000),
      pendingBalance: BigInt(25000),
      reservedBalance: BigInt(5000),
      currency: "ZAR",
    });

    const response = await fetch(`${baseUrl}/wallets/user/user-1/balance`);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.walletId).toBe("wallet-1");
    expect(body.data.balance).toEqual({
      available: 220000,
      pending: 25000,
      reserved: 5000,
      total: 250000,
      currency: "ZAR",
    });
  });

  it("GET /wallets/user/:userId/balance returns 404 when wallet does not exist", async () => {
    prismaMock.wallet.findFirst.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/wallets/user/missing-user/balance`);
    const body = (await response.json()) as any;

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("WAL_NOT_FOUND");
  });

  it("GET /wallets/:walletId/transactions applies sent filter and ascending sort", async () => {
    prismaMock.wallet.findUnique.mockResolvedValue({ id: "wallet-1", isDeleted: false });
    prismaMock.walletTransaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        walletId: "wallet-1",
        transactionType: "DEBIT",
        status: "COMPLETED",
        amount: BigInt(1000),
        feeAmount: BigInt(25),
        netAmount: BigInt(975),
        createdAt: "2026-04-12T10:00:00.000Z",
      },
    ]);

    const response = await fetch(
      `${baseUrl}/wallets/wallet-1/transactions?direction=sent&status=COMPLETED&sortBy=amount&sort=asc&limit=10&offset=0`
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.transactions[0].amount).toBe(1000);
    expect(prismaMock.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          walletId: "wallet-1",
          transactionType: "DEBIT",
          status: "COMPLETED",
        },
        orderBy: { amount: "asc" },
        take: 10,
        skip: 0,
      })
    );
  });

  it("GET /wallets/:walletId/transactions/:transactionId returns transaction detail", async () => {
    prismaMock.wallet.findUnique.mockResolvedValue({ id: "wallet-1", isDeleted: false });
    prismaMock.walletTransaction.findFirst.mockResolvedValue({
      id: "txn-1",
      walletId: "wallet-1",
      transactionType: "CREDIT",
      status: "COMPLETED",
      amount: BigInt(5000),
      createdAt: "2026-04-12T11:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/wallets/wallet-1/transactions/txn-1`);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.transaction.id).toBe("txn-1");
    expect(body.data.transaction.amount).toBe(5000);
  });

  it("GET /wallets/:walletId/transactions returns 404 when wallet does not exist", async () => {
    prismaMock.wallet.findUnique.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/wallets/missing-wallet/transactions`);
    const body = (await response.json()) as any;

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("WAL_NOT_FOUND");
  });
});
