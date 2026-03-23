/**
 * Payment Service Tests
 * Coverage target: 95% lines/functions (SARB requirement)
 *
 * Scenarios covered:
 * - Input validation (missing fields, zero/negative amount)
 * - Idempotency (duplicate key → same result, no double-charge)
 * - Atomic double-entry (debit + credit created together)
 * - Fee calculation (0.5%, R0.25 minimum)
 * - Insufficient balance enforcement
 * - Suspended/inactive sender wallet rejection
 * - Receiver wallet not found
 * - AML event published after commit
 * - Health endpoint
 */

import request from "supertest";

// ─── Mocks must be declared before any imports that trigger module loading ────

const mockTx = {
  $queryRaw: jest.fn(),
  walletTransaction: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockPrisma = {
  walletTransaction: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

const mockQueueAdd = jest.fn().mockResolvedValue({});
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockQueueAdd })),
}));

jest.mock("@ahava/shared-crypto", () => ({}));

// ─── Import app AFTER mocks are set up ────────────────────────────────────────
import app from "../main";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SENDER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const RECEIVER_ID = "bbbbbbbb-0000-0000-0000-000000000002";

const validPayload = () => ({
  senderWalletId: SENDER_ID,
  receiverWalletId: RECEIVER_ID,
  amountCents: 10000, // R100
  description: "Test payment",
  idempotencyKey: `test-key-${Date.now()}`,
  paymentMethod: "UBUNTUPAY_WALLET",
  deviceId: "device-001",
  ipAddress: "127.0.0.1",
});

function makeSenderWallet(
  overrides: Partial<{
    balance: bigint;
    status: string;
    isDeleted: boolean;
  }> = {},
) {
  return {
    id: SENDER_ID,
    userId: "user-001",
    isDeleted: false,
    status: "ACTIVE",
    balance: BigInt(50000), // R500 default
    ...overrides,
  };
}

function makeReceiverWallet(
  overrides: Partial<{ balance: bigint; isDeleted: boolean }> = {},
) {
  return {
    id: RECEIVER_ID,
    userId: "user-002",
    isDeleted: false,
    status: "ACTIVE",
    balance: BigInt(0),
    ...overrides,
  };
}

function makeDebitTxn(idempotencyKey: string) {
  return { id: "txn-debit-001", status: "COMPLETED", idempotencyKey };
}

function makeCreditTxn(idempotencyKey: string) {
  return {
    id: "txn-credit-001",
    status: "COMPLETED",
    idempotencyKey: `${idempotencyKey}-credit`,
  };
}

/**
 * Set up mockTx for a successful payment scenario.
 * The $transaction callback receives mockTx; we wire up its mocks here.
 */
function setupSuccessfulTransaction(payload: ReturnType<typeof validPayload>) {
  const sender = makeSenderWallet();
  const receiver = makeReceiverWallet();
  const debit = makeDebitTxn(payload.idempotencyKey);
  const credit = makeCreditTxn(payload.idempotencyKey);

  // Lock query returns both wallets in UUID order
  mockTx.$queryRaw.mockResolvedValue(
    [SENDER_ID, RECEIVER_ID]
      .sort()
      .map((id) => (id === SENDER_ID ? sender : receiver)),
  );
  mockTx.walletTransaction.create
    .mockResolvedValueOnce(debit) // debit
    .mockResolvedValueOnce(credit); // credit
  mockTx.wallet.update.mockResolvedValue({});
  mockTx.wallet.findFirst.mockResolvedValue(null); // no fee pool
  mockTx.auditLog.create.mockResolvedValue({});

  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  );

  return { sender, receiver, debit, credit };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.walletTransaction.findUnique.mockResolvedValue(null); // no existing txn by default
});

// ─── Health ───────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with ok status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.service).toBe("payment-service");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /payments — input validation", () => {
  it("returns 400 when senderWalletId is missing", async () => {
    const payload = validPayload();
    const { senderWalletId: _omit, ...rest } = payload;
    const res = await request(app).post("/payments").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when receiverWalletId is missing", async () => {
    const { receiverWalletId: _omit, ...rest } = validPayload();
    const res = await request(app).post("/payments").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when amountCents is missing", async () => {
    const { amountCents: _omit, ...rest } = validPayload();
    const res = await request(app).post("/payments").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when idempotencyKey is missing", async () => {
    const { idempotencyKey: _omit, ...rest } = validPayload();
    const res = await request(app).post("/payments").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when amountCents is zero", async () => {
    const res = await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAY_INVALID_AMOUNT");
  });

  it("returns 400 when amountCents is negative", async () => {
    const res = await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: -500 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAY_INVALID_AMOUNT");
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("POST /payments — idempotency", () => {
  it("returns 200 with existing transaction when key is already COMPLETED", async () => {
    const payload = validPayload();
    const existingTxn = makeDebitTxn(payload.idempotencyKey);
    mockPrisma.walletTransaction.findUnique.mockResolvedValue(existingTxn);

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transaction).toMatchObject({ id: existingTxn.id });
    // Must NOT open a database transaction for a duplicate
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 409 when idempotency key exists but is NOT completed", async () => {
    const payload = validPayload();
    mockPrisma.walletTransaction.findUnique.mockResolvedValue({
      id: "txn-pending",
      status: "PENDING",
      idempotencyKey: payload.idempotencyKey,
    });

    const res = await request(app).post("/payments").send(payload);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAY_DUPLICATE_IDEMPOTENCY_KEY");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does NOT double-charge: second call with same key returns same data", async () => {
    const payload = validPayload();
    const { debit } = setupSuccessfulTransaction(payload);

    // First call succeeds
    const first = await request(app).post("/payments").send(payload);
    expect(first.status).toBe(201);

    // Second call: simulate existing completed txn
    mockPrisma.walletTransaction.findUnique.mockResolvedValue(debit);
    const second = await request(app).post("/payments").send(payload);

    expect(second.status).toBe(200);
    expect(second.body.data.transaction.id).toBe(debit.id);
    // Transaction was only opened once (on first call)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ─── Successful payment ───────────────────────────────────────────────────────

describe("POST /payments — successful payment", () => {
  it("returns 201 and creates both debit and credit records", async () => {
    const payload = validPayload();
    const { debit, credit } = setupSuccessfulTransaction(payload);

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transaction.debit.id).toBe(debit.id);
    expect(res.body.data.transaction.credit.id).toBe(credit.id);
  });

  it("wraps all writes in a single prisma.$transaction call", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    await request(app).post("/payments").send(payload);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("acquires row locks in deterministic UUID order to prevent deadlocks", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    await request(app).post("/payments").send(payload);

    // The raw query must be called; the WHERE clause must include both IDs
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    const rawCall = mockTx.$queryRaw.mock.calls[0];
    // Template literal produces an array of strings/values
    const queryStrings = rawCall[0].join
      ? rawCall[0].join("")
      : String(rawCall[0]);
    expect(queryStrings).toContain("FOR UPDATE");
    expect(queryStrings).toContain("ORDER BY id");
  });

  it("publishes a PAYMENTS_CREATED event to BullMQ after commit", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    await request(app).post("/payments").send(payload);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      expect.stringContaining("payments_created"),
      expect.objectContaining({
        walletId: SENDER_ID,
        amountCents: payload.amountCents,
        idempotencyKey: payload.idempotencyKey,
      }),
    );
  });

  it("sets X-Request-ID response header", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    const res = await request(app).post("/payments").send(payload);
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});

// ─── Fee calculation ──────────────────────────────────────────────────────────

describe("POST /payments — fee calculation", () => {
  function setupWithAmount(amount: number, idempotencyKey: string) {
    const sender = makeSenderWallet({ balance: BigInt(amount + 10000) });
    const receiver = makeReceiverWallet();
    const debit = makeDebitTxn(idempotencyKey);
    const credit = makeCreditTxn(idempotencyKey);

    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) => (id === SENDER_ID ? sender : receiver)),
    );
    mockTx.walletTransaction.create
      .mockResolvedValueOnce(debit)
      .mockResolvedValueOnce(credit);
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(null);
    mockTx.auditLog.create.mockResolvedValue({});

    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );
  }

  it("charges minimum fee of R0.25 (25 cents) for small amounts", async () => {
    const key = "fee-min-test";
    setupWithAmount(100, key); // R1 payment → 0.5% = 0.5c → rounds up to min 25c

    const res = await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: 100, idempotencyKey: key });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.fee).toBe(25);
  });

  it("charges 0.5% fee for larger amounts", async () => {
    const key = "fee-pct-test";
    const amount = 100000; // R1000 → fee = 500c = R5
    setupWithAmount(amount, key);

    const res = await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.fee).toBe(500);
  });

  it("net amount sent to receiver = amountCents - fee", async () => {
    const key = "fee-net-test";
    const amount = 10000; // R100 → fee = 50c
    setupWithAmount(amount, key);

    await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    // debitTxn created with correct netAmount
    const debitCall = mockTx.walletTransaction.create.mock.calls[0][0];
    expect(debitCall.data.feeAmount).toBe(50);
    expect(debitCall.data.netAmount).toBe(amount - 50);
  });
});

// ─── Balance enforcement ──────────────────────────────────────────────────────

describe("POST /payments — balance enforcement", () => {
  it("returns 402 when sender has insufficient balance", async () => {
    const payload = { ...validPayload(), amountCents: 60000 }; // R600
    const senderWithLowBalance = makeSenderWallet({ balance: BigInt(50000) }); // only R500

    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) =>
          id === SENDER_ID ? senderWithLowBalance : makeReceiverWallet(),
        ),
    );
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("WAL_INSUFFICIENT_BALANCE");
    // No wallet updates must have been attempted
    expect(mockTx.wallet.update).not.toHaveBeenCalled();
    expect(mockTx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it("allows payment when balance exactly equals amount", async () => {
    const amount = 10000;
    const key = "exact-balance-test";
    const sender = makeSenderWallet({ balance: BigInt(amount) });
    const receiver = makeReceiverWallet();
    const debit = makeDebitTxn(key);
    const credit = makeCreditTxn(key);

    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) => (id === SENDER_ID ? sender : receiver)),
    );
    mockTx.walletTransaction.create
      .mockResolvedValueOnce(debit)
      .mockResolvedValueOnce(credit);
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(null);
    mockTx.auditLog.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    const res = await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    expect(res.status).toBe(201);
  });
});

// ─── Wallet status validation ─────────────────────────────────────────────────

describe("POST /payments — wallet status validation", () => {
  it("returns 403 when sender wallet is SUSPENDED", async () => {
    const payload = validPayload();
    const suspendedSender = makeSenderWallet({ status: "SUSPENDED" });

    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) =>
          id === SENDER_ID ? suspendedSender : makeReceiverWallet(),
        ),
    );
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("WAL_WALLET_SUSPENDED");
    expect(mockTx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it("returns 403 when sender wallet is FROZEN", async () => {
    const payload = validPayload();
    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) =>
          id === SENDER_ID
            ? makeSenderWallet({ status: "FROZEN" })
            : makeReceiverWallet(),
        ),
    );
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("WAL_WALLET_SUSPENDED");
  });

  it("returns 404 when sender wallet is deleted", async () => {
    const payload = validPayload();
    mockTx.$queryRaw.mockResolvedValue([
      { ...makeReceiverWallet() }, // only receiver returned — sender not found
    ]);
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("WAL_NOT_FOUND");
  });

  it("returns 404 when receiver wallet is not found", async () => {
    const payload = validPayload();
    mockTx.$queryRaw.mockResolvedValue([
      makeSenderWallet(), // only sender returned — receiver missing
    ]);
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAY_COUNTERPARTY_NOT_FOUND");
  });
});

// ─── Fee pool ─────────────────────────────────────────────────────────────────

describe("POST /payments — fee pool", () => {
  it("creates a FEE transaction and updates fee pool when one exists", async () => {
    const payload = validPayload();
    const feePoolWallet = {
      id: "fee-pool-wallet-001",
      walletType: "FEE_POOL",
      balance: BigInt(0),
    };

    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) =>
          id === SENDER_ID ? makeSenderWallet() : makeReceiverWallet(),
        ),
    );
    mockTx.walletTransaction.create.mockResolvedValue({ id: "txn-any" });
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(feePoolWallet);
    mockTx.auditLog.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    await request(app).post("/payments").send(payload);

    // walletTransaction.create called 3 times: debit, credit, fee
    expect(mockTx.walletTransaction.create).toHaveBeenCalledTimes(3);
    const feeTxnCall = mockTx.walletTransaction.create.mock.calls[2][0];
    expect(feeTxnCall.data.transactionType).toBe("FEE");
    expect(feeTxnCall.data.walletId).toBe(feePoolWallet.id);
  });

  it("skips fee transaction when no fee pool wallet exists", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload); // mockTx.wallet.findFirst returns null

    await request(app).post("/payments").send(payload);

    // Only debit + credit = 2 calls, no fee
    expect(mockTx.walletTransaction.create).toHaveBeenCalledTimes(2);
  });
});

// ─── Double-entry accounting ──────────────────────────────────────────────────

describe("POST /payments — double-entry accounting", () => {
  it("debit.balanceBefore - amount === debit.balanceAfter", async () => {
    const amount = 10000;
    const key = "double-entry-test";
    const balance = BigInt(50000);
    const sender = makeSenderWallet({ balance });
    const receiver = makeReceiverWallet();

    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) => (id === SENDER_ID ? sender : receiver)),
    );
    mockTx.walletTransaction.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: `txn-${data.transactionType}`,
        ...data,
      }),
    );
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(null);
    mockTx.auditLog.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    const debitCall = mockTx.walletTransaction.create.mock.calls[0][0];
    expect(debitCall.data.balanceBefore).toBe(balance);
    expect(debitCall.data.balanceAfter).toBe(balance - BigInt(amount));
  });

  it("wallet.update decrements sender balance by full amountCents", async () => {
    const amount = 10000;
    const key = "wallet-decrement-test";
    setupSuccessfulTransaction({
      ...validPayload(),
      amountCents: amount,
      idempotencyKey: key,
    });

    await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    const senderUpdate = mockTx.wallet.update.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === SENDER_ID,
    );
    expect(senderUpdate).toBeDefined();
    expect(senderUpdate![0].data.balance).toEqual({ decrement: amount });
  });

  it("wallet.update increments receiver balance by netAmount (amount - fee)", async () => {
    const amount = 10000;
    const fee = 50; // 0.5% of 10000
    const net = amount - fee;
    const key = "wallet-increment-test";
    setupSuccessfulTransaction({
      ...validPayload(),
      amountCents: amount,
      idempotencyKey: key,
    });

    await request(app)
      .post("/payments")
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    const receiverUpdate = mockTx.wallet.update.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === RECEIVER_ID,
    );
    expect(receiverUpdate).toBeDefined();
    expect(receiverUpdate![0].data.balance).toEqual({ increment: net });
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("POST /payments — error handling", () => {
  it("returns 500 on unexpected database error", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).post("/payments").send(validPayload());

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("does NOT publish AML event if transaction throws", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("TX failed"));

    await request(app).post("/payments").send(validPayload());

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("still returns 201 even if AML queue publish fails (fire-and-forget)", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);
    mockQueueAdd.mockRejectedValue(new Error("Redis unavailable"));

    const res = await request(app).post("/payments").send(payload);

    expect(res.status).toBe(201);
  });
});
