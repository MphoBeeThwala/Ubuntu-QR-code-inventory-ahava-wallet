import express, { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";
import { Queue, Worker, Job } from "bullmq";
import * as admin from "firebase-admin";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AfricasTalking = require("africastalking");
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { parseBearerToken, verifyJWT } from "@ahava/shared-crypto";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Must match QUEUE_NAMES.NOTIFICATION_QUEUED ("notifications_queued") —
// this used to be a hardcoded local string ("notifications_dispatch") that
// didn't match what any other producer actually pushes to. kyc-service
// (KYC document-received notices) and aml-service's MlroNotifier (AML flag
// alerts) both enqueue via the shared QUEUE_NAMES constant; with the names
// mismatched, every job they sent landed in a queue this worker never
// listened on and was silently never delivered.
const QUEUE_NAME = QUEUE_NAMES.NOTIFICATION_QUEUED;
const PORT = process.env.PORT || 6005;

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS (lazily initialised — only when credentials present)
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const redisConnection = getRedisConnectionConfig();

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
  const requestId =
    typeof incoming === "string" && incoming.length > 0
      ? incoming
      : crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
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

// Type-shape validation layered in FRONT OF, not instead of, the existing
// required-field checks below — see the identical helper in
// payment-service/src/main.ts and auth-service/src/main.ts. `channel` is
// constrained to the actual NotificationChannel enum values this service's
// dispatch worker (processNotification, above) and the Prisma schema both
// recognize, so an unsupported value is rejected here with a clear message
// instead of failing later at prisma.notification.create() or silently
// hitting the worker's `default: throw new Error("Unknown ... channel")`.
function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  requestId?: string,
): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AhavaError(
      AhavaErrorCode.VAL_INVALID_INPUT,
      issue
        ? `${issue.path.join(".") || "body"}: ${issue.message}`
        : "Invalid request body",
      { requestId },
    );
  }
  return result.data;
}

// WHATSAPP is a valid NotificationChannel enum value at the database level
// (kept for a future integration) but processNotification() below has no
// case for it — an accepted request would just fail at dispatch time with
// "Unknown notification channel: WHATSAPP". Restricted to the channels the
// worker can actually deliver until that's implemented.
const notificationSendBodySchema = z.object({
  userId: z.string().min(1).optional(),
  channel: z.enum(["PUSH", "SMS", "EMAIL", "IN_APP"]).optional(),
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(1000).optional(),
  fcmToken: z.string().optional(),
  phoneNumber: z.string().optional(),
  emailAddress: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

// This route is gateway-routed (api-gateway forwards /notifications/* here)
// and had no authorization at all — unlike aml-service's /aml/screen-sanctions
// or ledger-service's /ledger/batch (deliberately left open this session
// because they're ClusterIP-only, missing from the gateway's routing
// table, and have a real service-to-service caller today), this endpoint
// is genuinely reachable from the public internet right now, so leaving
// it open is a live spam/abuse vector (arbitrary push/SMS/email sends —
// SMS and email cost real money per send — to any userId). Its one
// intended caller, payment-orchestrator's "notify_recipient" saga step,
// isn't reachable/wired today either (same as the aml/ledger cases), so
// gating this breaks nothing real currently — but whoever wires that saga
// step up for real will need to decide how it authenticates (a service
// token, or something else), since it currently sends no Authorization
// header at all.
async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_UNAUTHORIZED,
      "Authorization header missing or malformed",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
    return;
  }

  try {
    const payload = await verifyJWT(token);
    req.userId = (payload.userId ?? payload.sub) as string | undefined;
    req.role = payload.role as string | undefined;
    if (!req.userId) {
      throw new Error("token has no subject");
    }
    next();
  } catch {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_INVALID_TOKEN,
      "Invalid or expired access token",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
  }
}

/** Throws unless the caller is an AGENT or the resource's actual owner. */
function assertOwnerOrAgent(req: Request, resourceUserId: string): void {
  if (req.role === "AGENT") return;
  if (req.userId && req.userId === resourceUserId) return;
  throw new AhavaError(
    AhavaErrorCode.AUTH_UNAUTHORIZED,
    "You do not have access to this resource",
    { requestId: req.id },
  );
}

app.post(
  "/notifications/send",
  requireAuth,
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
      } = validateBody(notificationSendBodySchema, req.body, req.id);

      if (!userId || !channel || !title || !body) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "userId, channel, title, and body are required",
          { requestId: req.id },
        );
      }

      assertOwnerOrAgent(req, userId);

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
      userId?: string;
      role?: string;
    }
  }
}
