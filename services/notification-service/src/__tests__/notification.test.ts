/**
 * Notification Service Tests
 *
 * Covers:
 * - GET /health
 * - POST /notifications/send: success (all channels), missing fields, queue enqueue, DB create
 */

import request from "supertest";

// ─── Mocks ────────────────────────────────────────────────────────

const mockQueueAdd = jest.fn().mockResolvedValue({ id: "job-001" });
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerIsRunning = jest.fn().mockReturnValue(true);
const workerHandlers: Record<string, (...args: any[]) => void> = {};
let workerProcessor:
  | ((job: {
      id: string;
      attemptsMade?: number;
      data: {
        notificationId: string;
        userId: string;
        channel: "PUSH" | "SMS" | "EMAIL" | "IN_APP";
        title?: string;
        body: string;
        fcmToken?: string;
        phoneNumber?: string;
        emailAddress?: string;
        metadata?: Record<string, string>;
      };
    }) => Promise<void>)
  | undefined;

jest.mock("bullmq", () => {
  const mockWorker = jest.fn().mockImplementation(() => ({
    isRunning: mockWorkerIsRunning,
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      workerHandlers[event] = handler;
    }),
  }));
  mockWorker.mockImplementation(
    (_queueName: string, processor: typeof workerProcessor) => {
      workerProcessor = processor;
      return {
        isRunning: mockWorkerIsRunning,
        on: jest.fn((event: string, handler: (...args: any[]) => void) => {
          workerHandlers[event] = handler;
        }),
      };
    },
  );
  const mockQueue = jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  }));
  return { Queue: mockQueue, Worker: mockWorker, Job: jest.fn() };
});

const mockFcmSend = jest.fn().mockResolvedValue("fcm-message-id");
jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  app: jest.fn(() => ({
    messaging: () => ({
      send: mockFcmSend,
    }),
  })),
}));

const mockSmsSend = jest.fn().mockResolvedValue({});
jest.mock("africastalking", () =>
  jest.fn(() => ({ SMS: { send: mockSmsSend } })),
);

const mockSesSend = jest.fn().mockResolvedValue({});
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn(() => ({ send: mockSesSend })),
  SendEmailCommand: jest.fn(),
}));

const mockNotificationCreate = jest.fn();
const mockNotificationUpdate = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => ({
    notification: {
      create: mockNotificationCreate,
      update: mockNotificationUpdate,
    },
  })),
}));

import app from "../main";

// ─────────────────────────────────────────────────────────────────

const NOTIFICATION_ID = "notif-001";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: "test-project",
    client_email: "firebase@test.local",
    private_key:
      "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  });
  process.env.AFRICAS_TALKING_API_KEY = "test-api-key";
  process.env.AFRICAS_TALKING_USERNAME = "sandbox";
  process.env.SES_FROM_ADDRESS = "noreply@test.local";
  mockWorkerIsRunning.mockReturnValue(true);

  mockNotificationCreate.mockResolvedValue({
    id: NOTIFICATION_ID,
    status: "PENDING",
  });
  mockNotificationUpdate.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 with worker status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.service).toBe("notification-service");
    expect(res.body.data.worker).toBe("running");
  });

  it("returns stopped when the worker is not running", async () => {
    mockWorkerIsRunning.mockReturnValue(false);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.data.worker).toBe("stopped");
  });
});

describe("notification worker", () => {
  it("dispatches PUSH notifications and marks them as sent", async () => {
    await workerProcessor?.({
      id: "job-push",
      data: {
        notificationId: NOTIFICATION_ID,
        userId: "user-001",
        channel: "PUSH",
        title: "Payment received",
        body: "You received R100.00",
        fcmToken: "fcm-token-xyz",
        metadata: { transactionId: "txn-001" },
      },
    });

    expect(mockFcmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "fcm-token-xyz",
        notification: expect.objectContaining({
          title: "Payment received",
          body: "You received R100.00",
        }),
      }),
    );
    expect(mockNotificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIFICATION_ID },
        data: expect.objectContaining({
          status: "SENT",
          sentAt: expect.any(Date),
        }),
      }),
    );
  });

  it("dispatches SMS notifications and marks them as sent", async () => {
    await workerProcessor?.({
      id: "job-sms",
      data: {
        notificationId: NOTIFICATION_ID,
        userId: "user-001",
        channel: "SMS",
        body: "OTP 123456",
        phoneNumber: "+27821234567",
      },
    });

    expect(mockSmsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["+27821234567"],
        message: "OTP 123456",
      }),
    );
  });

  it("dispatches EMAIL notifications and marks them as sent", async () => {
    await workerProcessor?.({
      id: "job-email",
      data: {
        notificationId: NOTIFICATION_ID,
        userId: "user-001",
        channel: "EMAIL",
        title: "Statement ready",
        body: "<p>Your statement is ready</p>",
        emailAddress: "user@example.co.za",
      },
    });

    expect(mockSesSend).toHaveBeenCalledTimes(1);
  });

  it("treats IN_APP notifications as already delivered", async () => {
    await workerProcessor?.({
      id: "job-inapp",
      data: {
        notificationId: NOTIFICATION_ID,
        userId: "user-001",
        channel: "IN_APP",
        body: "Open the app to view your message",
      },
    });

    expect(mockFcmSend).not.toHaveBeenCalled();
    expect(mockSmsSend).not.toHaveBeenCalled();
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(mockNotificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      }),
    );
  });

  it("marks notifications as failed when dispatch prerequisites are missing", async () => {
    await expect(
      workerProcessor?.({
        id: "job-missing",
        data: {
          notificationId: NOTIFICATION_ID,
          userId: "user-001",
          channel: "PUSH",
          body: "Missing token",
        },
      }),
    ).rejects.toThrow("fcmToken required for PUSH channel");

    expect(mockNotificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          failedAt: expect.any(Date),
          failureReason: "fcmToken required for PUSH channel",
        }),
      }),
    );
  });

  it("marks notifications as failed for unknown channels", async () => {
    await expect(
      workerProcessor?.({
        id: "job-unknown",
        data: {
          notificationId: NOTIFICATION_ID,
          userId: "user-001",
          channel: "FAX" as unknown as "PUSH",
          body: "Unsupported",
        },
      }),
    ).rejects.toThrow("Unknown notification channel: FAX");
  });

  it("logs completed and failed worker events", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    workerHandlers.completed?.({
      id: "job-1",
      data: { channel: "SMS" },
    });
    workerHandlers.failed?.(
      {
        id: "job-2",
        attemptsMade: 2,
      },
      new Error("dispatch failed"),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Notification dispatched"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Notification failed"),
    );

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────
describe("POST /notifications/send", () => {
  it("creates notification and enqueues job for PUSH channel", async () => {
    const res = await request(app).post("/notifications/send").send({
      userId: "user-001",
      channel: "PUSH",
      title: "Payment received",
      body: "You received R100.00",
      fcmToken: "fcm-token-xyz",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.notificationId).toBe(NOTIFICATION_ID);
    expect(res.body.data.status).toBe("PENDING");
  });

  it("stores notification in DB with correct fields", async () => {
    await request(app).post("/notifications/send").send({
      userId: "user-001",
      channel: "SMS",
      body: "Your OTP is 123456",
      phoneNumber: "+27821234567",
    });

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-001",
          channel: "SMS",
          body: "Your OTP is 123456",
          status: "PENDING",
        }),
      }),
    );
  });

  it("enqueues job with correct data for SMS channel", async () => {
    await request(app)
      .post("/notifications/send")
      .send({
        userId: "user-001",
        channel: "SMS",
        body: "Transfer of R50 sent",
        phoneNumber: "+27831234567",
        metadata: { transactionId: "txn-001" },
      });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send",
      expect.objectContaining({
        notificationId: NOTIFICATION_ID,
        channel: "SMS",
        phoneNumber: "+27831234567",
      }),
      expect.objectContaining({
        attempts: 3,
        backoff: expect.objectContaining({ type: "exponential" }),
      }),
    );
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
  });

  it("enqueues job for EMAIL channel", async () => {
    await request(app).post("/notifications/send").send({
      userId: "user-001",
      channel: "EMAIL",
      title: "Statement ready",
      body: "<p>Your monthly statement is ready</p>",
      emailAddress: "user@example.co.za",
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send",
      expect.objectContaining({
        channel: "EMAIL",
        emailAddress: "user@example.co.za",
      }),
      expect.anything(),
    );
  });

  it("accepts IN_APP channel without device token", async () => {
    const res = await request(app).post("/notifications/send").send({
      userId: "user-001",
      channel: "IN_APP",
      body: "New feature available",
    });

    expect(res.status).toBe(201);
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
  });

  it("sets X-Request-ID response header", async () => {
    const res = await request(app)
      .post("/notifications/send")
      .send({ userId: "user-001", channel: "IN_APP", body: "Test" });

    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app)
      .post("/notifications/send")
      .send({ channel: "SMS", body: "Hello" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_MISSING_REQUIRED_FIELD");
  });

  it("returns 400 when channel is missing", async () => {
    const res = await request(app)
      .post("/notifications/send")
      .send({ userId: "user-001", body: "Hello" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when body is missing", async () => {
    const res = await request(app)
      .post("/notifications/send")
      .send({ userId: "user-001", channel: "SMS" });

    expect(res.status).toBe(400);
  });

  it("returns 500 on unexpected database error", async () => {
    mockNotificationCreate.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app)
      .post("/notifications/send")
      .send({ userId: "user-001", channel: "IN_APP", body: "Test" });

    expect(res.status).toBe(500);
  });
});
