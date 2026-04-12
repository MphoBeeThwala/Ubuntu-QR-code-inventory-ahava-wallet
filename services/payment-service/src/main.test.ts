import type { AddressInfo } from "net";
import type { Server } from "http";

const prismaMock = {
  walletTransaction: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => prismaMock),
}));

import app from "./main";

describe("payment-service /payments", () => {
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

  it("creates a payment successfully", async () => {
    prismaMock.walletTransaction.findUnique.mockResolvedValue(null);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "sender-wallet",
        userId: "sender-user",
        isDeleted: false,
        status: "ACTIVE",
        balance: BigInt(20000),
      },
    ]);
    prismaMock.wallet.findUnique.mockResolvedValue({
      id: "receiver-wallet",
      balance: BigInt(1000),
    });
    prismaMock.walletTransaction.create
      .mockResolvedValueOnce({ id: "debit-1", status: "COMPLETED" })
      .mockResolvedValueOnce({ id: "credit-1", status: "COMPLETED" })
      .mockResolvedValueOnce({ id: "fee-1", status: "COMPLETED" });
    prismaMock.wallet.update.mockResolvedValue({});
    prismaMock.wallet.findFirst.mockResolvedValue({
      id: "fee-pool",
      balance: BigInt(5000),
    });
    prismaMock.auditLog.create.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderWalletId: "sender-wallet",
        receiverWalletId: "receiver-wallet",
        amountCents: 10000,
        idempotencyKey: "idem-1",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.transaction.debit.id).toBe("debit-1");
    expect(prismaMock.wallet.update).toHaveBeenCalledTimes(3);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "sender-user",
          action: "PAYMENT_SENT",
          entityType: "wallet_transaction",
          entityId: "debit-1",
          serviceId: "payment-service",
          correlationId: "idem-1",
        }),
      })
    );
  });

  it("returns existing result for completed idempotency key", async () => {
    prismaMock.walletTransaction.findUnique.mockResolvedValue({
      id: "txn-existing",
      idempotencyKey: "idem-existing",
      status: "COMPLETED",
    });

    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderWalletId: "sender-wallet",
        receiverWalletId: "receiver-wallet",
        amountCents: 10000,
        idempotencyKey: "idem-existing",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.transaction.id).toBe("txn-existing");
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("fails with insufficient balance", async () => {
    prismaMock.walletTransaction.findUnique.mockResolvedValue(null);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "sender-wallet",
        userId: "sender-user",
        isDeleted: false,
        status: "ACTIVE",
        balance: BigInt(300),
      },
    ]);

    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderWalletId: "sender-wallet",
        receiverWalletId: "receiver-wallet",
        amountCents: 1000,
        idempotencyKey: "idem-insufficient",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(402);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("WAL_INSUFFICIENT_BALANCE");
  });

  it("fails when counterparty wallet is not found", async () => {
    prismaMock.walletTransaction.findUnique.mockResolvedValue(null);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "sender-wallet",
        userId: "sender-user",
        isDeleted: false,
        status: "ACTIVE",
        balance: BigInt(10000),
      },
    ]);
    prismaMock.wallet.findUnique.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderWalletId: "sender-wallet",
        receiverWalletId: "missing-wallet",
        amountCents: 1000,
        idempotencyKey: "idem-missing-counterparty",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("PAY_COUNTERPARTY_NOT_FOUND");
  });

  it("fails when idempotency key exists with non-completed status", async () => {
    prismaMock.walletTransaction.findUnique.mockResolvedValue({
      id: "txn-pending",
      idempotencyKey: "idem-pending",
      status: "PENDING",
    });

    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderWalletId: "sender-wallet",
        receiverWalletId: "receiver-wallet",
        amountCents: 1000,
        idempotencyKey: "idem-pending",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("PAY_DUPLICATE_IDEMPOTENCY_KEY");
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});
