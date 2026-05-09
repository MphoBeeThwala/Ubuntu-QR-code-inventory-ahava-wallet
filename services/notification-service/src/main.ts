import express, { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { Queue, Worker, Job } from "bullmq";
import * as admin from "firebase-admin";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AfricasTalking = require("africastalking");
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_NAME = "notifications_dispatch";
const PORT = process.env.PORT || 6005;

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS (lazily initialised — only when credentials present)
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD,
};

// FCM — initialise only when service account credentials are available
let fcmInitialised = false;
function getFcmApp(): admin.app.App {
  if (!fcmInitialised) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccount) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON env var not set");
    }
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccount)),
    });
    fcmInitialised = true;
  }
  return admin.app();
}

// Africa's Talking — SMS
let atSmsClient: ReturnType<typeof AfricasTalking>["SMS"] | null = null;
function getAtSms() {
  const apiKey = process.env.AFRICAS_TALKING_API_KEY;
  const username = process.env.AFRICAS_TALKING_USERNAME;
  if (!apiKey || !username) {
    console.warn(
      "[notification] AFRICAS_TALKING_API_KEY / AFRICAS_TALKING_USERNAME not set — SMS dispatch disabled",
    );
    return null;
  }
  if (!atSmsClient) {
    const at = AfricasTalking({ apiKey, username });
    atSmsClient = at.SMS;
  }
  return atSmsClient;
}

// AWS SES — Email
const sesClient = new SESClient({
  region: process.env.AWS_REGION || "af-south-1",
});

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL DISPATCHERS
// ─────────────────────────────────────────────────────────────────────────────

async function sendPush(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  await getFcmApp()
    .messaging()
    .send({
      token: fcmToken,
      notification: { title, body },
      data,
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });
}

async function sendSms(phoneNumber: string, message: string): Promise<void> {
  const sms = getAtSms();
  if (!sms) {
    console.warn("[notification] SMS disabled; skipping SMS to", phoneNumber);
    return;
  }
  await sms.send({
    to: [phoneNumber],
    message,
    from: process.env.AFRICAS_TALKING_SENDER_ID || "AHAVA",
  });
}

async function sendEmail(
  toAddress: string,
  subject: string,
  htmlBody: string,
): Promise<void> {
  const fromAddress = process.env.SES_FROM_ADDRESS || "noreply@ahava.co.za";

  await sesClient.send(
    new SendEmailCommand({
      Source: fromAddress,
      Destination: { ToAddresses: [toAddress] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
      },
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BULLMQ WORKER
// ─────────────────────────────────────────────────────────────────────────────

interface DispatchJobData {
  notificationId: string;
  userId: string;
  channel: "PUSH" | "SMS" | "EMAIL" | "IN_APP";
  title?: string;
  body: string;
  fcmToken?: string;
  phoneNumber?: string;
  emailAddress?: string;
  metadata?: Record<string, string>;
}

async function processNotification(job: Job<DispatchJobData>): Promise<void> {
  const {
    notificationId,
    channel,
    title,
    body,
    fcmToken,
    phoneNumber,
    emailAddress,
    metadata,
  } = job.data;

  try {
    switch (channel) {
      case "PUSH":
        if (!fcmToken) throw new Error("fcmToken required for PUSH channel");
        await sendPush(fcmToken, title || "Ahava", body, metadata);
        break;

      case "SMS":
        if (!phoneNumber)
          throw new Error("phoneNumber required for SMS channel");
        await sendSms(phoneNumber, body);
        break;

      case "EMAIL":
        if (!emailAddress)
          throw new Error("emailAddress required for EMAIL channel");
        await sendEmail(emailAddress, title || "Ahava Notification", body);
        break;

      case "IN_APP":
        // IN_APP notifications are stored in DB and surfaced on next app open — no dispatch needed
        break;

      default:
        throw new Error(`Unknown notification channel: ${channel}`);
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: "SENT",
        sentAt: new Date(),
      },
    });
  } catch (dispatchError) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        failureReason:
          dispatchError instanceof Error
            ? dispatchError.message
            : String(dispatchError),
      },
    });
    // Re-throw so BullMQ can apply retry backoff
    throw dispatchError;
  }
}

const notificationWorker = new Worker<DispatchJobData>(
  QUEUE_NAME,
  processNotification,
  {
    connection: redisConnection,
    concurrency: 10,
    // Exponential backoff: 5s, 10s, 20s
    limiter: { max: 100, duration: 1000 },
  },
);

notificationWorker.on("completed", (job) => {
  console.log(
    `✅ Notification dispatched: job ${job.id} (channel: ${job.data.channel})`,
  );
});

notificationWorker.on("failed", (job, err) => {
  console.error(
    `❌ Notification failed: job ${job?.id} attempt ${job?.attemptsMade} — ${err.message}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS APP
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  req.id =
    typeof incoming === "string" && incoming.length > 0
      ? incoming
      : crypto.randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req: Request, res: Response) => {
  res.json(
    createSuccessResponse(
      {
        status: "ok",
        service: "notification-service",
        worker: notificationWorker.isRunning() ? "running" : "stopped",
      },
      req.id,
    ),
  );
});

app.post(
  "/notifications/send",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        userId,
        channel,
        title,
        body,
        fcmToken,
        phoneNumber,
        emailAddress,
        metadata,
      } = req.body;

      if (!userId || !channel || !body) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "userId, channel, and body are required",
          { requestId: req.id },
        );
      }

      const notification = await prisma.notification.create({
        data: {
          userId,
          channel,
          title: title || null,
          body,
          status: "PENDING",
          data: metadata ? JSON.stringify(metadata) : null,
        },
      });

      const queue = new Queue<DispatchJobData>(QUEUE_NAME, {
        connection: redisConnection,
      });
      await queue.add(
        "send",
        {
          notificationId: notification.id,
          userId,
          channel,
          title,
          body,
          fcmToken,
          phoneNumber,
          emailAddress,
          metadata,
        },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      );
      await queue.close();

      res.status(201).json(
        createSuccessResponse(
          {
            notificationId: notification.id,
            status: "PENDING",
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  console.error("Unhandled error:", err);
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(genericError));
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Notification Service listening on port ${PORT}`);
    console.log(`🔔 Dispatch worker running — concurrency: 10`);
  });
}

export default app;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
