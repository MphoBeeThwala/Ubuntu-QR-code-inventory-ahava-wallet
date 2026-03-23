import request from "supertest";

// ─── Mock BullMQ Worker BEFORE importing app ──────────────────────
const mockWorkerOn = jest.fn();
const mockWorkerIsRunning = jest.fn().mockReturnValue(true);

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: mockWorkerOn,
    isRunning: mockWorkerIsRunning,
  })),
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Job: jest.fn(),
}));

jest.mock("@ahava/shared-events", () => ({
  QUEUE_NAMES: { PAYMENTS_CREATED: "payments:created" },
}));

// ─── Mock winston ─────────────────────────────────────────────────
jest.mock("winston", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  transports: { Console: jest.fn() },
  format: {
    combine: jest.fn().mockReturnValue({}),
    timestamp: jest.fn().mockReturnValue({}),
    json: jest.fn().mockReturnValue({}),
  },
}));

// ─── Mock AML Engine + deps ───────────────────────────────────────
jest.mock("../aml.engine", () => ({
  AmlEngine: jest.fn().mockImplementation(() => ({
    runPostPaymentChecks: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../comply-advantage.client", () => ({
  ComplyAdvantageClient: jest.fn().mockImplementation(() => ({
    screen: jest.fn().mockResolvedValue({ status: "CLEAR" }),
  })),
}));

jest.mock("../mlro.notifier", () => ({
  MlroNotifier: jest.fn().mockImplementation(() => ({
    notifyFlag: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Mock PrismaClient ────────────────────────────────────────────
const mockPrisma = {
  amlFlag: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  wallet: {
    update: jest.fn(),
  },
  walletTransaction: {
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

// ─── Import app AFTER all mocks are set ──────────────────────────
import app from "../main";

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 with worker status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.worker).toBe("running");
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /aml/flag", () => {
  const validFlag = {
    flagType: "VELOCITY",
    severity: "HIGH",
    riskScore: 75,
    description: "20 transactions in 1 hour",
    userId: "user-uuid-1",
    walletId: "wallet-uuid-1",
  };

  it("creates an AML flag and returns 201", async () => {
    const flag = { id: "flag-uuid-1", ...validFlag, status: "OPEN" };
    mockPrisma.amlFlag.create.mockResolvedValue(flag);

    const res = await request(app).post("/aml/flag").send(validFlag);

    expect(res.status).toBe(201);
    expect(res.body.data.flag.id).toBe("flag-uuid-1");
    expect(mockPrisma.amlFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flagType: "VELOCITY",
          severity: "HIGH",
          status: "OPEN",
        }),
      }),
    );
  });

  it("auto-suspends wallet and notifies MLRO on CRITICAL severity", async () => {
    const flag = {
      id: "flag-uuid-2",
      ...validFlag,
      severity: "CRITICAL",
      status: "OPEN",
      userId: "user-uuid-1",
    };
    mockPrisma.amlFlag.create.mockResolvedValue(flag);
    mockPrisma.wallet.update.mockResolvedValue({
      id: "wallet-uuid-1",
      status: "SUSPENDED",
    });

    const res = await request(app)
      .post("/aml/flag")
      .send({ ...validFlag, severity: "CRITICAL" });

    expect(res.status).toBe(201);
    expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUSPENDED" }),
      }),
    );
  });

  it("does NOT auto-suspend when severity is HIGH (only CRITICAL)", async () => {
    const flag = { id: "flag-uuid-3", ...validFlag, status: "OPEN" };
    mockPrisma.amlFlag.create.mockResolvedValue(flag);

    const res = await request(app).post("/aml/flag").send(validFlag);
    expect(res.status).toBe(201);
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  });

  it("returns 400 when flagType is missing", async () => {
    const res = await request(app)
      .post("/aml/flag")
      .send({ severity: "HIGH", riskScore: 75 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when riskScore is missing", async () => {
    const res = await request(app)
      .post("/aml/flag")
      .send({ flagType: "VELOCITY", severity: "HIGH" });
    expect(res.status).toBe(400);
  });

  it("sets X-Request-ID response header", async () => {
    mockPrisma.amlFlag.create.mockResolvedValue({ id: "f1", status: "OPEN" });
    const res = await request(app).post("/aml/flag").send(validFlag);
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /aml/flags", () => {
  it("returns open and under-review flags", async () => {
    mockPrisma.amlFlag.findMany.mockResolvedValue([
      { id: "flag-1", flagType: "VELOCITY", severity: "HIGH", status: "OPEN" },
      {
        id: "flag-2",
        flagType: "STRUCTURING",
        severity: "MEDIUM",
        status: "UNDER_REVIEW",
      },
    ]);

    const res = await request(app).get("/aml/flags");
    expect(res.status).toBe(200);
    expect(res.body.data.flags).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });

  it("filters by severity when ?severity= provided", async () => {
    mockPrisma.amlFlag.findMany.mockResolvedValue([]);
    await request(app).get("/aml/flags?severity=CRITICAL");
    expect(mockPrisma.amlFlag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ severity: "CRITICAL" }),
      }),
    );
  });

  it("returns empty array when no open flags", async () => {
    mockPrisma.amlFlag.findMany.mockResolvedValue([]);
    const res = await request(app).get("/aml/flags");
    expect(res.status).toBe(200);
    expect(res.body.data.flags).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /aml/str-file", () => {
  it("files an STR and returns STR reference", async () => {
    const flag = {
      id: "flag-uuid-1",
      userId: "user-uuid-1",
      status: "STR_FILED",
      strReference: "STR-ZA-2026-ABCD1234",
      strFiledAt: new Date(),
    };
    mockPrisma.amlFlag.update.mockResolvedValue(flag);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post("/aml/str-file")
      .send({ flagId: "flag-uuid-1" });

    expect(res.status).toBe(200);
    expect(res.body.data.strReference).toMatch(/^STR-ZA-/);
    expect(mockPrisma.amlFlag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "STR_FILED" }),
      }),
    );
  });

  it("creates audit log when STR is filed", async () => {
    mockPrisma.amlFlag.update.mockResolvedValue({
      id: "f1",
      userId: "u1",
      status: "STR_FILED",
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    await request(app).post("/aml/str-file").send({ flagId: "flag-uuid-1" });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "AML_STR_FILED" }),
      }),
    );
  });

  it("returns 400 when flagId is missing", async () => {
    const res = await request(app).post("/aml/str-file").send({});
    expect(res.status).toBe(400);
  });
});
