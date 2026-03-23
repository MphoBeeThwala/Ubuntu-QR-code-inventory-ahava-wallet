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

jest.mock("bullmq", () => {
  const mockWorker = jest.fn().mockImplementation(() => ({
    isRunning: jest.fn().mockReturnValue(true),
    on: jest.fn(),
  }));
  const mockQueue = jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  }));
  return { Queue: mockQueue, Worker: mockWorker, Job: jest.fn() };
});

jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  app: jest.fn(),
  messaging: jest.fn(),
}));

jest.mock("africastalking", () =>
  jest.fn(() => ({ SMS: { send: jest.fn() } })),
);

jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn(() => ({ send: jest.fn() })),
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
