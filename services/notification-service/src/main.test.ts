import type { AddressInfo } from "net";
import type { Server } from "http";

const prismaMock = {
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

const queueAddMock = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => prismaMock),
}));

jest.mock("bullmq", () => ({
  Queue: jest.fn(() => ({
    add: queueAddMock,
  })),
}));

import app from "./main";

describe("notification-service endpoints", () => {
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

  it("POST /notifications creates a notification and queues dispatch", async () => {
    prismaMock.notification.create.mockResolvedValue({
      id: "not-1",
      userId: "user-1",
      channel: "PUSH",
      title: "Hello",
      body: "Message",
      status: "PENDING",
    });
    queueAddMock.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        channel: "PUSH",
        title: "Hello",
        body: "Message",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.notification.id).toBe("not-1");
    expect(queueAddMock).toHaveBeenCalledWith(
      "send",
      expect.objectContaining({
        notificationId: "not-1",
        userId: "user-1",
        channel: "PUSH",
      })
    );
  });

  it("POST /notifications/transfer-success creates sender and receiver notifications", async () => {
    prismaMock.notification.create
      .mockResolvedValueOnce({ id: "sender-not" })
      .mockResolvedValueOnce({ id: "receiver-not" });
    queueAddMock.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/notifications/transfer-success`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderUserId: "sender-1",
        receiverUserId: "receiver-1",
        amountCents: 1500,
        senderName: "Sender",
        receiverName: "Receiver",
        reference: "ref-1",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.notifications.sender.id).toBe("sender-not");
    expect(body.data.notifications.receiver.id).toBe("receiver-not");
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
  });

  it("POST /notifications/transfer-failure creates failure notification", async () => {
    prismaMock.notification.create.mockResolvedValue({ id: "failed-not" });
    queueAddMock.mockResolvedValue({});

    const response = await fetch(`${baseUrl}/notifications/transfer-failure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        amountCents: 1000,
        reason: "Insufficient balance",
        reference: "ref-2",
      }),
    });

    const body = (await response.json()) as any;
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.notification.id).toBe("failed-not");
  });

  it("GET /notifications lists notifications with filters and paging", async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      { id: "not-1", userId: "user-1", status: "PENDING", channel: "PUSH" },
    ]);

    const response = await fetch(
      `${baseUrl}/notifications?userId=user-1&status=PENDING&channel=PUSH&limit=10&offset=0`
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.notifications).toHaveLength(1);
    expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "PENDING", channel: "PUSH" },
        take: 10,
        skip: 0,
      })
    );
  });
});
