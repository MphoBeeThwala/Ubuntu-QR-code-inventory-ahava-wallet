import type { AmlFlag } from "@prisma/client";

// ─── Mock BullMQ BEFORE importing the module under test ───────────
const mockQueueAdd = jest.fn().mockResolvedValue(undefined);

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
  })),
}));

jest.mock("@ahava/shared-events", () => ({
  QUEUE_NAMES: { NOTIFICATION_QUEUED: "notifications_queued" },
  getRedisConnectionConfig: jest.fn().mockReturnValue({
    host: "127.0.0.1",
    port: 6379,
  }),
}));

import { MlroNotifier } from "../mlro.notifier";

function makeFlag(overrides: Partial<AmlFlag> = {}): AmlFlag {
  return {
    id: "flag-001",
    userId: "user-001",
    walletId: "wallet-001",
    transactionId: "txn-001",
    flagType: "SANCTIONS_MATCH",
    severity: "CRITICAL",
    status: "OPEN",
    description: "Sanctions match detected",
    riskScore: 95,
    evidenceJson: null,
    assignedTo: null,
    assignedAt: null,
    autoResolved: false,
    resolvedAt: null,
    reviewNote: null,
    strReference: null,
    strFiledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AmlFlag;
}

describe("MlroNotifier", () => {
  const originalEnv = process.env.MLRO_ALERT_EMAIL;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockQueueAdd.mockClear();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.MLRO_ALERT_EMAIL = originalEnv;
    consoleErrorSpy.mockRestore();
  });

  // Regression coverage: MlroNotifier used to enqueue AML flag alerts with
  // userId: "MLRO_TEAM" as a routing label and no emailAddress at all.
  // notification-service's EMAIL dispatch case has no lookup for
  // "MLRO_TEAM" and requires emailAddress to be present — every such alert
  // was queued successfully but then failed at dispatch time, so the
  // compliance team never actually received AML flag notifications.

  it("attaches MLRO_ALERT_EMAIL as the job's emailAddress when configured", async () => {
    process.env.MLRO_ALERT_EMAIL = "compliance@example.co.za";
    const notifier = new MlroNotifier();

    await notifier.notifyFlag(makeFlag());

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [, payload] = mockQueueAdd.mock.calls[0];
    expect(payload.emailAddress).toBe("compliance@example.co.za");
    expect(payload.channel).toBe("EMAIL");
    expect(payload.userId).toBe("MLRO_TEAM");
  });

  it("still enqueues the alert (rather than dropping it) when MLRO_ALERT_EMAIL is unset, but logs an error", async () => {
    delete process.env.MLRO_ALERT_EMAIL;
    const notifier = new MlroNotifier();

    await notifier.notifyFlag(makeFlag());

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [, payload] = mockQueueAdd.mock.calls[0];
    expect(payload.emailAddress).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("MLRO_ALERT_EMAIL is not set"),
      "flag-001",
      expect.any(String),
    );
  });

  it("includes flag details in the alert body", async () => {
    process.env.MLRO_ALERT_EMAIL = "compliance@example.co.za";
    const notifier = new MlroNotifier();

    await notifier.notifyFlag(
      makeFlag({
        id: "flag-002",
        severity: "HIGH" as AmlFlag["severity"],
        flagType: "VELOCITY",
        riskScore: 80,
      }),
    );

    const [, payload] = mockQueueAdd.mock.calls[0];
    expect(payload.title).toContain("HIGH");
    expect(payload.title).toContain("VELOCITY");
    expect(payload.metadata.flagId).toBe("flag-002");
  });
});
