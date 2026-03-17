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
import Redis from "ioredis";

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const PORT = process.env.PORT || 3007;

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "aml-service" }));
});

// POST /aml/flag - Raise AML flag
app.post("/aml/flag", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, walletId, flagType, severity, riskScore, description, evidence } = req.body;

    if (!flagType || !severity || riskScore === undefined) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing required fields",
        { requestId: req.id }
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

    // If critical, auto-suspend wallet
    if (severity === "CRITICAL" && walletId) {
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          status: "SUSPENDED",
          suspendedReason: `AML: ${flagType}`,
          suspendedAt: new Date(),
        },
      });

      // TODO: Publish notification to MLRO
    }

    res.status(201).json(createSuccessResponse({ flag }));
  } catch (error) {
    next(error);
  }
});

// GET /aml/flags - Get AML flags
app.get("/aml/flags", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flags = await prisma.amlFlag.findMany({
      where: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.json(createSuccessResponse({ flags }));
  } catch (error) {
    next(error);
  }
});

// POST /aml/str-file - File Suspicious Transaction Report
app.post("/aml/str-file", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { flagId } = req.body;

    const flag = await prisma.amlFlag.update({
      where: { id: flagId },
      data: {
        status: "STR_FILED",
        strFiledAt: new Date(),
        strReference: `STR-${uuidv4()}`,
      },
    });

    // TODO: Submit to South African authorities (SARB)

    res.json(createSuccessResponse({ flag }));
  } catch (error) {
    next(error);
  }
});

// TODO: BullMQ Worker - consume AML queue
// const worker = new Worker("aml:transaction:screened", async (job) => {
//   const { transactionId, amountCents, userId } = job.data;
//   // Screen against sanctions lists, check velocity, detect structuring
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
  console.log(`✅ AML Service listening on port ${PORT}`);
});

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
