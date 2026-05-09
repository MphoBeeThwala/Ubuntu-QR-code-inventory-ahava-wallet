import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";
import { Worker, Job } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";
import { createLogger, transports, format } from "winston";
import { AmlFlagSeverity } from "@ahava/shared-types";
import { AmlEngine } from "./aml.engine";
import { ComplyAdvantageClient } from "./comply-advantage.client";
import { MlroNotifier } from "./mlro.notifier";
import { writeAuditLog } from "@ahava/shared-audit";

// ─────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6007;

const redisConnection = getRedisConnectionConfig();

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const complyAdvantageApiKey =
  process.env.COMPLYADVANTAGE_API_KEY || process.env.COMPLY_ADVANTAGE_API_KEY;
const complyAdvantage = new ComplyAdvantageClient(complyAdvantageApiKey);
const mlroNotifier = new MlroNotifier();
const amlEngine = new AmlEngine(
  prisma,
  logger as any,
  complyAdvantage,
  mlroNotifier,
);

// ─────────────────────────────────────────────────────────────────
// BULLMQ WORKER — consume payments:created → run post-payment AML checks
// ─────────────────────────────────────────────────────────────────

interface PaymentCreatedJobData {
  transactionId: string;
  walletId: string;
  userId: string;
  amountCents: number;
  counterpartyWalletId: string;
  deviceId?: string;
  ipAddress?: string;
}

async function processPaymentAml(
  job: Job<PaymentCreatedJobData>,
): Promise<void> {
  const {
    transactionId,
    walletId,
    counterpartyWalletId,
    amountCents,
    deviceId,
  } = job.data;

  logger.info("AML screening started", { transactionId, jobId: job.id });

  await amlEngine.runPostPaymentChecks({
    transactionId,
    senderWalletId: walletId,
    recipientWalletId: counterpartyWalletId,
    amountCents,
    deviceId: deviceId || "",
  });

  // Mark the wallet transaction as AML screened
  await prisma.walletTransaction.update({
    where: { id: transactionId },
    data: { amlScreened: true, amlScreenedAt: new Date() },
  });

  logger.info("AML screening completed", { transactionId });
}

const amlWorker = new Worker<PaymentCreatedJobData>(
  QUEUE_NAMES.PAYMENTS_CREATED,
  processPaymentAml,
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

amlWorker.on("completed", (job) => {
  logger.info("AML job completed", {
    jobId: job.id,
    transactionId: job.data.transactionId,
  });
});

amlWorker.on("failed", (job, err) => {
  logger.error("AML job failed", {
    jobId: job?.id,
    transactionId: job?.data?.transactionId,
    error: err.message,
    attempt: job?.attemptsMade,
  });
});

// ─────────────────────────────────────────────────────────────────
// EXPRESS ROUTES
// ─────────────────────────────────────────────────────────────────

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  req.id =
    typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(
    createSuccessResponse(
      {
        status: "ok",
        service: "aml-service",
        worker: amlWorker.isRunning() ? "running" : "stopped",
        sanctionsProvider: complyAdvantageApiKey ? "configured" : "degraded",
      },
      req.id,
    ),
  );
});

// POST /aml/flag - Raise AML flag manually (MLRO tool)
app.post(
  "/aml/flag",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        userId,
        walletId,
        flagType,
        severity,
        riskScore,
        description,
        evidence,
      } = req.body;

      if (!flagType || !severity || riskScore === undefined) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing required fields: flagType, severity, riskScore",
          { requestId: req.id },
        );
      }

      const flag = await prisma.amlFlag.create({
        data: {
          userId: userId || null,
          walletId: walletId || null,
          flagType,
          severity,
          status: "OPEN",
          riskScore,
          description,
          evidenceJson: evidence ? JSON.stringify(evidence) : null,
        },
      });

      // Critical flag: auto-suspend wallet and notify MLRO immediately
      if (severity === "CRITICAL" && walletId) {
        await prisma.wallet.update({
          where: { id: walletId },
          data: {
            status: "SUSPENDED",
            suspendedReason: `AML: ${flagType}`,
            suspendedAt: new Date(),
          },
        });

        await mlroNotifier.notifyFlag(flag);
        logger.warn("CRITICAL AML flag — wallet suspended and MLRO notified", {
          flagId: flag.id,
          walletId,
          flagType,
        });
      }

      res.status(201).json(createSuccessResponse({ flag }, req.id));
    } catch (error) {
      next(error);
    }
  },
);

// GET /aml/flags - List open flags (MLRO dashboard)
app.get(
  "/aml/flags",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const severity = req.query.severity as AmlFlagSeverity | undefined;
      const flags = await prisma.amlFlag.findMany({
        where: {
          status: { in: ["OPEN", "UNDER_REVIEW"] },
          ...(severity ? { severity } : {}),
        },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 100,
      });

      res.json(createSuccessResponse({ flags, total: flags.length }, req.id));
    } catch (error) {
      next(error);
    }
  },
);

// POST /aml/str-file - File Suspicious Transaction Report with SARB
app.post(
  "/aml/str-file",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { flagId } = req.body;

      if (!flagId) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "flagId is required",
          { requestId: req.id },
        );
      }

      const strReference = `STR-ZA-${new Date().getFullYear()}-${uuidv4().slice(0, 8).toUpperCase()}`;

      const flag = await prisma.amlFlag.update({
        where: { id: flagId },
        data: {
          status: "STR_FILED",
          strFiledAt: new Date(),
          strReference,
        },
      });

      await writeAuditLog(prisma, {
        userId: flag.userId || "system",
        action: "AML_STR_FILED",
        entityType: "AmlFlag",
        entityId: flagId,
        newState: JSON.stringify({
          strReference,
          filedAt: new Date().toISOString(),
        }),
        serviceId: "aml-service",
      });

      logger.warn("STR filed", { flagId, strReference });

      res.json(createSuccessResponse({ flag, strReference }, req.id));
    } catch (error) {
      next(error);
    }
  },
);

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  logger.error("Unhandled error", { error: err.message, requestId: req.id });
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(genericError));
});

// ─────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`AML Service listening on port ${PORT}`);
    logger.info(`AML worker consuming queue: ${QUEUE_NAMES.PAYMENTS_CREATED}`);
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
