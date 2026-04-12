import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { Queue } from "bullmq";

const app = express();
const prisma = new PrismaClient();
const redisConnection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};
const notificationQueue = new Queue("notifications:dispatch", { connection: redisConnection });
const PORT = process.env.PORT || 3005;

const VALID_CHANNELS = ["PUSH", "SMS", "EMAIL", "WHATSAPP"] as const;
const VALID_STATUSES = ["PENDING", "SENT", "DELIVERED", "FAILED", "READ"] as const;

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

function validateChannel(channel: string, requestId?: string) {
  if (!VALID_CHANNELS.includes(channel as (typeof VALID_CHANNELS)[number])) {
    throw new AhavaError(
      AhavaErrorCode.VAL_INVALID_ENUM_VALUE,
      "Invalid channel. Use one of: PUSH, SMS, EMAIL, WHATSAPP",
      { requestId }
    );
  }
}

function validateStatus(status: string, requestId?: string) {
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new AhavaError(
      AhavaErrorCode.VAL_INVALID_ENUM_VALUE,
      "Invalid status filter",
      { requestId }
    );
  }
}

async function createNotificationRecord(params: {
  userId: string;
  channel: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  templateId?: string;
}) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      channel: params.channel as "PUSH" | "SMS" | "EMAIL" | "WHATSAPP",
      title: params.title,
      body: params.body,
      status: "PENDING",
      data: params.metadata ? JSON.stringify(params.metadata) : null,
      templateId: params.templateId ?? null,
    },
  });

  await notificationQueue.add("send", {
    notificationId: notification.id,
    userId: params.userId,
    channel: params.channel,
    body: params.body,
    title: params.title,
  });

  return notification;
}

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "notification-service" }));
});

const createNotificationHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, channel, title, body, metadata, templateId } = req.body;

    if (!userId || !channel || !body) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields: userId, channel, body",
        { requestId: req.id }
      );
    }

    validateChannel(channel, req.id);

    const notification = await createNotificationRecord({
      userId,
      channel,
      title: title || "Notification",
      body,
      metadata,
      templateId,
    });

    res.status(201).json(createSuccessResponse({ notification }));
  } catch (error) {
    next(error);
  }
};

// POST /notifications - Create notification record + queue dispatch
app.post("/notifications", createNotificationHandler);

// Backward-compatible alias
app.post("/notifications/send", createNotificationHandler);

// POST /notifications/transfer-success - Generate transfer success notifications
app.post("/notifications/transfer-success", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { senderUserId, receiverUserId, amountCents, senderName, receiverName, reference } = req.body;

    if (!senderUserId || !receiverUserId || !amountCents) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields: senderUserId, receiverUserId, amountCents",
        { requestId: req.id }
      );
    }

    const amount = (Number(amountCents) / 100).toFixed(2);

    const senderNotification = await createNotificationRecord({
      userId: senderUserId,
      channel: "PUSH",
      title: "Transfer Sent",
      body: `You sent R${amount} to ${receiverName || "recipient"}`,
      metadata: { amountCents, receiverName, reference, type: "TRANSFER_SUCCESS_SENT" },
      templateId: "transfer_success_sender",
    });

    const receiverNotification = await createNotificationRecord({
      userId: receiverUserId,
      channel: "PUSH",
      title: "Transfer Received",
      body: `You received R${amount} from ${senderName || "sender"}`,
      metadata: { amountCents, senderName, reference, type: "TRANSFER_SUCCESS_RECEIVED" },
      templateId: "transfer_success_receiver",
    });

    res.status(201).json(
      createSuccessResponse({
        notifications: {
          sender: senderNotification,
          receiver: receiverNotification,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

// POST /notifications/transfer-failure - Generate transfer failure notification
app.post("/notifications/transfer-failure", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, amountCents, reason, reference } = req.body;

    if (!userId || !amountCents || !reason) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields: userId, amountCents, reason",
        { requestId: req.id }
      );
    }

    const amount = (Number(amountCents) / 100).toFixed(2);
    const notification = await createNotificationRecord({
      userId,
      channel: "PUSH",
      title: "Transfer Failed",
      body: `Transfer of R${amount} failed: ${reason}`,
      metadata: { amountCents, reason, reference, type: "TRANSFER_FAILURE" },
      templateId: "transfer_failure",
    });

    res.status(201).json(createSuccessResponse({ notification }));
  } catch (error) {
    next(error);
  }
});

// GET /notifications - List notifications for a user
app.get("/notifications", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.query.userId as string | undefined;
    const status = (req.query.status as string | undefined)?.toUpperCase();
    const channel = (req.query.channel as string | undefined)?.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 250);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!userId) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required query parameter: userId",
        { requestId: req.id }
      );
    }

    if (status) validateStatus(status, req.id);
    if (channel) validateChannel(channel, req.id);

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;
    if (channel) where.channel = channel;

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    res.json(
      createSuccessResponse({
        notifications,
        paging: {
          limit,
          offset,
          count: notifications.length,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id }
  );
  res.status(500).json(createErrorResponse(genericError));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Notification Service listening on port ${PORT}`);
  });
}

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
