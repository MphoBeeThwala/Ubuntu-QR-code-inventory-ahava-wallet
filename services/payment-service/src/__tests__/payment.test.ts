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
import * as nodeCrypto from "crypto";
import * as jwt from "jsonwebtoken";

// ─── Mocks must be declared before any imports that trigger module loading ────

// Real RSA keypair + JWT_PUBLIC_KEY env var: requireAuth's verifyJWT() call
// (packages/shared-crypto) falls back to reading this env var when no
// explicit key is passed, so signing real tokens here exercises the actual
// verification path. Same recipe as services/wallet-service and
// services/agent-service's test suites.
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

// Matches makeSenderWallet()'s default userId unless a test needs a
// different caller.
function customerAuthHeader(userId = "user-001"): string {
  return `Bearer ${signToken({ sub: userId })}`;
}

function agentAuthHeader(): string {
  return `Bearer ${signToken({ sub: "agent-user-1", role: "AGENT" })}`;
}

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
  // Added alongside the P0 fix that reconnects the ledger to the live
  // payment path (see main.ts) — every /payments transaction now writes
  // LedgerEntry rows, so the mock transaction client needs one too.
  ledgerEntry: {
    create: jest.fn(),
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
  user: {
    findUnique: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    // Added for the pre-transaction sanctions-screening lookup (P0
    // follow-up: synchronous AML screening). Defaults to an empty array in
    // beforeEach below, which makes screenSanctionsBlocking a no-op since
    // neither sender nor receiver row is found — existing tests that don't
    // care about screening don't need to configure this.
    findMany: jest.fn(),
    update: jest.fn(),
  },
  paymentQrCode: {
    create: jest.fn(),
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

// Used to be mocked to {} outright — harmless when nothing in main.ts
// called into shared-crypto, but requireAuth (added for the wallet-
// ownership fix) now calls parseBearerToken/verifyJWT for real, and an
// empty mock made those undefined, throwing TypeError on every request.
// jest.requireActual + JWT_PUBLIC_KEY above exercises the real
// verification path instead of stubbing it out.
jest.mock("@ahava/shared-crypto", () =>
  jest.requireActual("@ahava/shared-crypto"),
);

// ─── Import app AFTER mocks are set up ────────────────────────────────────────
import app, { startServer } from "../main";

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
function setupSuccessfulTransaction(
  payload: Record<string, unknown> & { idempotencyKey: string },
) {
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
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.wallet.findMany.mockResolvedValue([]); // sanctions screening skipped by default
  // Sanctions screening makes a real network call otherwise — tests that
  // specifically exercise it (see "POST /payments — sanctions screening"
  // below) opt back in and mock fetch themselves.
  process.env.SANCTIONS_SCREENING_ENABLED = "false";
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
    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(rest);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when receiverWalletId is missing", async () => {
    const { receiverWalletId: _omit, ...rest } = validPayload();
    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when amountCents is missing", async () => {
    const { amountCents: _omit, ...rest } = validPayload();
    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when idempotencyKey is missing", async () => {
    const { idempotencyKey: _omit, ...rest } = validPayload();
    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when amountCents is zero", async () => {
    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAY_INVALID_AMOUNT");
  });

  it("returns 400 when amountCents is negative", async () => {
    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: -500 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAY_INVALID_AMOUNT");
  });

  it("returns 400 when senderWalletId is the wrong type (zod shape check)", async () => {
    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), senderWalletId: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_INPUT");
  });

  it("returns 400 when amountCents is a non-numeric string (zod shape check)", async () => {
    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_INPUT");
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("POST /payments — idempotency", () => {
  it("returns 200 with existing transaction when key is already COMPLETED", async () => {
    const payload = validPayload();
    const existingTxn = makeDebitTxn(payload.idempotencyKey);
    mockPrisma.walletTransaction.findUnique.mockResolvedValue(existingTxn);

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAY_DUPLICATE_IDEMPOTENCY_KEY");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does NOT double-charge: second call with same key returns same data", async () => {
    const payload = validPayload();
    const { debit } = setupSuccessfulTransaction(payload);

    // First call succeeds
    const first = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);
    expect(first.status).toBe(201);

    // Second call: simulate existing completed txn
    mockPrisma.walletTransaction.findUnique.mockResolvedValue(debit);
    const second = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transaction.debit.id).toBe(debit.id);
    expect(res.body.data.transaction.credit.id).toBe(credit.id);
  });

  it("wraps all writes in a single prisma.$transaction call", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("acquires row locks in deterministic UUID order to prevent deadlocks", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

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

    await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("resolves the recipient by receiverWalletNumber when walletId is omitted", async () => {
    const payload = {
      ...validPayload(),
      receiverWalletId: undefined,
      receiverWalletNumber: "AHV-0000-0001",
    };
    mockPrisma.wallet.findFirst.mockResolvedValueOnce({ id: RECEIVER_ID });
    setupSuccessfulTransaction(payload);

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(201);
    expect(mockPrisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletNumber: "AHV-0000-0001", isDeleted: false },
      }),
    );
  });

  it("resolves the recipient by recipientPhone when walletId is omitted", async () => {
    const payload = {
      ...validPayload(),
      receiverWalletId: undefined,
      recipientPhone: "+27821234567",
    };
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-002" });
    mockPrisma.wallet.findFirst
      .mockResolvedValueOnce({ id: RECEIVER_ID })
      .mockResolvedValueOnce(null);
    setupSuccessfulTransaction(payload);

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(201);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phoneNumberHash: expect.any(String) },
      }),
    );
    expect(mockPrisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-002",
          status: "ACTIVE",
          isDeleted: false,
        }),
      }),
    );
  });
});

// ─── Sanctions screening ────────────────────────────────────────────────────

describe("POST /payments — sanctions screening", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SANCTIONS_SCREENING_ENABLED = "true";
    mockPrisma.wallet.findMany.mockResolvedValue([
      { id: SENDER_ID, userId: "user-001" },
      { id: RECEIVER_ID, userId: "user-002" },
    ]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SANCTIONS_SCREENING_ENABLED = "false";
  });

  it("blocks the payment when aml-service reports a sanctions match", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 403 } as Response);

    const payload = validPayload();
    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AML_SANCTIONS_MATCH");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("fails closed (blocks the payment) when aml-service is unreachable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const payload = validPayload();
    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EXT_COMPLY_ADVANTAGE_ERROR");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("proceeds with the payment when aml-service clears both parties", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/aml/screen-sanctions"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("is skipped when SANCTIONS_SCREENING_ENABLED=false", async () => {
    process.env.SANCTIONS_SCREENING_ENABLED = "false";
    global.fetch = jest.fn();

    const payload = validPayload();
    setupSuccessfulTransaction(payload);

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(201);
    expect(global.fetch).not.toHaveBeenCalled();
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
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: 100, idempotencyKey: key });

    expect(res.status).toBe(201);
    // fee is now a string in the response — result.feeAmount is a BigInt
    // (see the P0 fix for why: res.json() throws on a raw BigInt, and the
    // previous code returned one on every successful payment).
    expect(res.body.data.transaction.fee).toBe("25");
  });

  it("charges 0.5% fee for larger amounts", async () => {
    const key = "fee-pct-test";
    const amount = 100000; // R1000 → fee = 500c = R5
    setupWithAmount(amount, key);

    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.fee).toBe("500");
  });

  it("tracks the fee separately while the transfer amount remains intact", async () => {
    const key = "fee-net-test";
    const amount = 10000; // R100 → fee = 50c
    setupWithAmount(amount, key);

    await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    // debitTxn records the transfer amount while the fee is separate.
    // feeAmount/netAmount are written to the DB as real BigInt (only the
    // HTTP response serializes them to strings), matching the BigInt
    // columns in the schema.
    const debitCall = mockTx.walletTransaction.create.mock.calls[0][0];
    expect(debitCall.data.feeAmount).toBe(50n);
    expect(debitCall.data.netAmount).toBe(BigInt(amount));
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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("WAL_INSUFFICIENT_BALANCE");
    // No wallet updates must have been attempted
    expect(mockTx.wallet.update).not.toHaveBeenCalled();
    expect(mockTx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it("allows payment when balance exactly equals amount plus fee", async () => {
    const amount = 10000;
    const fee = 50;
    const key = "exact-balance-test";
    const sender = makeSenderWallet({ balance: BigInt(amount + fee) });
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
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    expect(res.status).toBe(201);
  });
});

// ─── Authorization ────────────────────────────────────────────────────────────
// CRITICAL regression coverage: senderWalletId used to be trusted straight
// from the request body with no check that the authenticated caller
// actually owned it — any customer could drain funds from ANY wallet just
// by supplying its id as senderWalletId.

describe("POST /payments — authorization", () => {
  it("rejects without an Authorization header", async () => {
    const res = await request(app).post("/payments").send(validPayload());
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects paying from a wallet the caller does not own", async () => {
    setupSuccessfulTransaction(validPayload());
    // The dedicated ownership lookup (prisma.wallet.findUnique, separate
    // from the sanctions-screening wallet.findMany below) needs to resolve
    // the sender's real owner for assertOwnerOrAgent to have anything to
    // compare against.
    mockPrisma.wallet.findUnique.mockResolvedValue({ userId: "user-001" });

    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader("a-completely-different-user"))
      .send(validPayload());

    expect(res.status).toBe(403);
    expect(mockTx.walletTransaction.create).not.toHaveBeenCalled();
    expect(mockTx.wallet.update).not.toHaveBeenCalled();
  });

  it("allows an agent to pay on a customer's behalf", async () => {
    setupSuccessfulTransaction(validPayload());
    mockPrisma.wallet.findUnique.mockResolvedValue({ userId: "user-001" });

    const res = await request(app)
      .post("/payments")
      .set("Authorization", agentAuthHeader())
      .send(validPayload());

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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

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

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAY_COUNTERPARTY_NOT_FOUND");
  });

  it("returns 403 when receiver wallet is not active", async () => {
    const payload = validPayload();
    mockTx.$queryRaw.mockResolvedValue(
      [SENDER_ID, RECEIVER_ID]
        .sort()
        .map((id) =>
          id === SENDER_ID
            ? makeSenderWallet()
            : { ...makeReceiverWallet(), status: "SUSPENDED" },
        ),
    );
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
    );

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("WAL_WALLET_SUSPENDED");
  });

  it("returns 404 when receiverWalletNumber does not resolve to a wallet", async () => {
    mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({
        ...validPayload(),
        receiverWalletId: undefined,
        receiverWalletNumber: "AHV-MISSING",
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAY_COUNTERPARTY_NOT_FOUND");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when recipientPhone does not resolve to an active wallet", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-404" });
    mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({
        ...validPayload(),
        receiverWalletId: undefined,
        recipientPhone: "+27825550000",
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAY_COUNTERPARTY_NOT_FOUND");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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

    await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    // walletTransaction.create called 3 times: debit, credit, fee
    expect(mockTx.walletTransaction.create).toHaveBeenCalledTimes(3);
    const feeTxnCall = mockTx.walletTransaction.create.mock.calls[2][0];
    expect(feeTxnCall.data.transactionType).toBe("FEE");
    expect(feeTxnCall.data.walletId).toBe(feePoolWallet.id);
  });

  it("skips fee transaction when no fee pool wallet exists", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload); // mockTx.wallet.findFirst returns null

    await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    // Only debit + credit = 2 calls, no fee
    expect(mockTx.walletTransaction.create).toHaveBeenCalledTimes(2);
  });
});

// ─── Double-entry accounting ──────────────────────────────────────────────────

describe("POST /payments — double-entry accounting", () => {
  it("debit.balanceBefore - totalDebit === debit.balanceAfter", async () => {
    const amount = 10000;
    const fee = 50;
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
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    const debitCall = mockTx.walletTransaction.create.mock.calls[0][0];
    expect(debitCall.data.balanceBefore).toBe(balance);
    expect(debitCall.data.balanceAfter).toBe(balance - BigInt(amount + fee));
  });

  it("wallet.update decrements sender balance by amount plus fee", async () => {
    const amount = 10000;
    const fee = 50;
    const key = "wallet-decrement-test";
    setupSuccessfulTransaction({
      ...validPayload(),
      amountCents: amount,
      idempotencyKey: key,
    });

    await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    const senderUpdate = mockTx.wallet.update.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === SENDER_ID,
    );
    expect(senderUpdate).toBeDefined();
    // decrement is now BigInt (totalDebitCents), matching the balance
    // column's real type — see the P0 fix for calculateTransferFee.
    expect(senderUpdate![0].data.balance).toEqual({
      decrement: BigInt(amount + fee),
    });
  });

  it("wallet.update increments receiver balance by the purchase amount", async () => {
    const amount = 10000;
    const key = "wallet-increment-test";
    setupSuccessfulTransaction({
      ...validPayload(),
      amountCents: amount,
      idempotencyKey: key,
    });

    await request(app)
      .post("/payments")
      .set("Authorization", customerAuthHeader())
      .send({ ...validPayload(), amountCents: amount, idempotencyKey: key });

    const receiverUpdate = mockTx.wallet.update.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === RECEIVER_ID,
    );
    expect(receiverUpdate).toBeDefined();
    expect(receiverUpdate![0].data.balance).toEqual({
      increment: BigInt(amount),
    });
  });
});

// ─── QR Code Endpoints ────────────────────────────────────────────────────────
describe("POST /payments/qr — QR code generation", () => {
  it("returns 400 when walletId is missing", async () => {
    const res = await request(app).post("/payments/qr")
      .set("Authorization", customerAuthHeader()).send({
      amountCents: 1000,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when amountCents is missing for DYNAMIC QR", async () => {
    const res = await request(app).post("/payments/qr")
      .set("Authorization", customerAuthHeader()).send({
      walletId: SENDER_ID,
      qrType: "DYNAMIC",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAY_INVALID_AMOUNT");
  });

  it("returns 404 when wallet is deleted", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      ...makeSenderWallet(),
      isDeleted: true,
    });
    const res = await request(app).post("/payments/qr")
      .set("Authorization", customerAuthHeader()).send({
      walletId: SENDER_ID,
      amountCents: 1000,
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when wallet is suspended", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      ...makeSenderWallet(),
      status: "SUSPENDED",
    });
    const res = await request(app).post("/payments/qr")
      .set("Authorization", customerAuthHeader()).send({
      walletId: SENDER_ID,
      amountCents: 1000,
    });
    expect(res.status).toBe(403);
  });

  it("successfully creates a dynamic QR code", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeSenderWallet());
    mockPrisma.paymentQrCode.create.mockResolvedValue({
      id: "qr-123",
      qrType: "DYNAMIC",
      qrPayload: "{}",
      qrHash: "hash",
      amountCents: BigInt(1000),
      expiresAt: new Date(),
      isActive: true,
    });

    const res = await request(app).post("/payments/qr")
      .set("Authorization", customerAuthHeader()).send({
      walletId: SENDER_ID,
      amountCents: 1000,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.qrCode.id).toBe("qr-123");
  });

  it("successfully creates a static QR code without expiry or fixed amount", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeSenderWallet());
    mockPrisma.paymentQrCode.create.mockResolvedValue({
      id: "qr-static-123",
      qrType: "STATIC",
      qrPayload: "{}",
      qrHash: "hash-static",
      amountCents: null,
      expiresAt: null,
      isActive: true,
    });

    const res = await request(app).post("/payments/qr")
      .set("Authorization", customerAuthHeader()).send({
      walletId: SENDER_ID,
      qrType: "STATIC",
      description: "Pay me",
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.paymentQrCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qrType: "STATIC",
          amountCents: null,
          expiresAt: null,
          maxUsage: null,
        }),
      }),
    );
  });

  it("rejects generating a QR for a wallet the caller does not own", async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(makeSenderWallet());

    const res = await request(app)
      .post("/payments/qr")
      .set("Authorization", customerAuthHeader("a-different-user"))
      .send({ walletId: SENDER_ID, amountCents: 1000 });

    expect(res.status).toBe(403);
    expect(mockPrisma.paymentQrCode.create).not.toHaveBeenCalled();
  });
});

describe("POST /payments — error handling", () => {
  it("returns 500 on unexpected database error", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(validPayload());

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("does NOT publish AML event if transaction throws", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("TX failed"));

    await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(validPayload());

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("still returns 201 even if AML queue publish fails (fire-and-forget)", async () => {
    const payload = validPayload();
    setupSuccessfulTransaction(payload);
    mockQueueAdd.mockRejectedValue(new Error("Redis unavailable"));

    const res = await request(app).post("/payments")
      .set("Authorization", customerAuthHeader()).send(payload);

    expect(res.status).toBe(201);
  });
});

describe("Server startup", () => {
  it("starts the server without errors", () => {
    const listenSpy = jest
      .spyOn(app, "listen")
      .mockImplementation((port, cb) => {
        if (cb) cb();
        return {} as any;
      });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    startServer();

    expect(listenSpy).toHaveBeenCalledWith(6003, expect.any(Function));
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    listenSpy.mockRestore();
  });
});
