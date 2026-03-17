import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3004;

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "kyc-service" }));
});

// GET /kyc/user/:userId - Get KYC status
app.get("/kyc/user/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycTier: true,
        kycStatus: true,
        idVerifiedAt: true,
        pepFlag: true,
      },
    });

    if (!user) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "User not found",
        { requestId: req.id }
      );
    }

    res.json(createSuccessResponse({ kyc: user }));
  } catch (error) {
    next(error);
  }
});

// POST /kyc/document/upload - Upload KYC document
app.post(
  "/kyc/document/upload",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, documentType, s3Key, documentHash } = req.body;

      if (!userId || !documentType || !s3Key || !documentHash) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing required fields",
          { requestId: req.id }
        );
      }

      const doc = await prisma.kycDocument.create({
        data: {
          userId,
          documentType,
          s3Key,
          documentHash,
          verificationStatus: "PENDING",
        },
      });

      // TODO: Queue document for verification (ML pipeline)
      // TODO: Send notification to user

      res.status(201).json(createSuccessResponse({ document: doc }));
    } catch (error) {
      next(error);
    }
  }
);

// POST /kyc/tier-upgrade - Upgrade KYC tier
app.post("/kyc/tier-upgrade", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, newTier } = req.body;

    if (!userId || !newTier) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        "Missing userId or newTier",
        { requestId: req.id }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "User not found",
        { requestId: req.id }
      );
    }

    // Define tier limits
    const tierLimits = {
      TIER_0: { daily: 50000, monthly: 200000, maxBalance: 250000 },
      TIER_1: { daily: 200000, monthly: 1000000, maxBalance: 1000000 },
      TIER_2: { daily: 500000, monthly: 5000000, maxBalance: 25000000 },
    } as const;

    const limits = tierLimits[newTier as keyof typeof tierLimits] || tierLimits.TIER_0;

    // Update user tier
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        kycTier: newTier,
        kycStatus: "VERIFIED",
      },
    });

    // Update all wallets for this user
    await prisma.wallet.updateMany({
      where: { userId },
      data: {
        kycTier: newTier,
        dailyLimit: limits.daily,
        monthlyLimit: limits.monthly,
        maxBalance: limits.maxBalance,
      },
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        userId,
        action: "KYC_TIER_UPGRADED",
        entityType: "User",
        entityId: userId,
        newState: JSON.stringify({ newTier }),
        serviceId: "kyc-service",
      },
    });

    res.json(createSuccessResponse({ user: updated }));
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

app.listen(PORT, () => {
  console.log(`✅ KYC Service listening on port ${PORT}`);
});

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
