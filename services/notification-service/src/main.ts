import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { Queue, Worker } from "bullmq";

const app = express();
const prisma = new PrismaClient();
const redisConnection = {
  // BullMQ accepts a connection object; this avoids mismatching ioredis types
  url: process.env.REDIS_URL || "redis://localhost:6379",
};
const PORT = process.env.PORT || 3005;

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "notification-service" }));
});

// POST /notifications/send - Queue notification
app.post("/notifications/send", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, channel, title, body, metadata } = req.body;

    if (!userId || !channel || !body) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields",
        { requestId: req.id }
      );
    }

    const notification = await prisma.notification.create({
      data: {
        userId,
        channel,
        title,
        body,
        status: "PENDING",
        data: metadata ? JSON.stringify(metadata) : null,
      },
    });

    // Queue for dispatch
    const notificationQueue = new Queue("notifications:dispatch", { connection: redisConnection });
    await notificationQueue.add("send", {
      notificationId: notification.id,
      userId,
      channel,
      body,
      title,
    });

    res.status(201).json(createSuccessResponse({ notification }));
  } catch (error) {
    next(error);
  }
});

// TODO: BullMQ Worker - consume notification queue
// const worker = new Worker("notifications:dispatch", async (job) => {
//   const { notificationId, userId, channel, body } = job.data;
//   try {
//     // Send via FCM / SMS / Email based on channel
//     // Update notification.status = "SENT"
//   } catch (error) {
//     throw error;
//   }
// }, { connection: redis });

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

app.listen(PORT, () => {
  console.log(`✅ Notification Service listening on port ${PORT}`);
});

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
