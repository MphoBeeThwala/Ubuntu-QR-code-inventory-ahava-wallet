import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from "@ahava/shared-errors";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3004;

const TIER_LIMITS = {
  TIER_0: { daily: 50000, monthly: 200000, maxBalance: 250000, perTransaction: 50000 },
  TIER_1: { daily: 200000, monthly: 1000000, maxBalance: 1000000, perTransaction: 200000 },
  TIER_2: { daily: 500000, monthly: 5000000, maxBalance: 25000000, perTransaction: 500000 },
  MERCHANT: { daily: 999999999, monthly: 9999999999, maxBalance: 9999999999, perTransaction: 999999999 },
} as const;

function hashForLookup(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function requireUserId(userId: string | undefined, requestId?: string) {
  if (!userId) {
    throw new AhavaError(
      AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
      "Missing userId",
      { requestId }
    );
  }
}

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "kyc-service" }));
});

const getKycStatusHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.query.userId as string | undefined;
    requireUserId(userId, req.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kycTier: true,
        kycStatus: true,
        idVerifiedAt: true,
        idType: true,
        idNumberHash: true,
        pepFlag: true,
        createdAt: true,
        updatedAt: true,
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
};

// GET /kyc/status?userId=... - KYC status endpoint
app.get("/kyc/status", getKycStatusHandler);

// Backward-compatible alias
app.get("/kyc/user/:userId", async (req: Request, res: Response, next: NextFunction) => {
  req.query.userId = req.params.userId;
  return getKycStatusHandler(req, res, next);
});

// GET /kyc/tier/:userId - KYC tier tracking + limits
app.get("/kyc/tier/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kycTier: true,
        kycStatus: true,
      },
    });

    if (!user) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "User not found",
        { requestId: req.id }
      );
    }

    const limits = TIER_LIMITS[user.kycTier as keyof typeof TIER_LIMITS] || TIER_LIMITS.TIER_0;

    res.json(
      createSuccessResponse({
        userId,
        tier: {
          kycTier: user.kycTier,
          kycStatus: user.kycStatus,
          limits,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

// POST /kyc/profile - KYC profile creation/update
app.post("/kyc/profile", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, fullName, preferredName, dateOfBirth, idType, idNumber, s3Key, documentHash } = req.body;

    requireUserId(userId, req.id);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "User not found",
        { requestId: req.id }
      );
    }

    const idNumberHash = idNumber ? hashForLookup(idNumber) : user.idNumberHash;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName ? { fullName } : {}),
        ...(preferredName ? { preferredName } : {}),
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
        ...(idType ? { idType } : {}),
        ...(idNumber ? { idNumber } : {}),
        ...(idNumberHash ? { idNumberHash } : {}),
        kycStatus: "PENDING",
      },
    });

    let kycDocument = null;
    if (s3Key && documentHash && idType) {
      kycDocument = await prisma.kycDocument.create({
        data: {
          userId,
          documentType: idType,
          s3Key,
          documentHash,
          verificationStatus: "PENDING",
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: "KYC_PROFILE_SUBMITTED",
        entityType: "User",
        entityId: userId,
        newState: JSON.stringify({ idType, hasDocument: Boolean(kycDocument) }),
        serviceId: "kyc-service",
      },
    });

    res.status(201).json(
      createSuccessResponse({
        user: {
          id: updatedUser.id,
          kycTier: updatedUser.kycTier,
          kycStatus: updatedUser.kycStatus,
        },
        document: kycDocument,
      })
    );
  } catch (error) {
    next(error);
  }
});

// POST /kyc/manual-review - manual review placeholder
app.post("/kyc/manual-review", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, reason } = req.body;
    requireUserId(userId, req.id);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AhavaError(
        AhavaErrorCode.AUTH_UNAUTHORIZED,
        "User not found",
        { requestId: req.id }
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: "UNDER_REVIEW",
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: "KYC_MANUAL_REVIEW_REQUESTED",
        entityType: "User",
        entityId: userId,
        newState: JSON.stringify({ reason: reason || "Manual review requested" }),
        serviceId: "kyc-service",
      },
    });

    res.status(202).json(
      createSuccessResponse({
        user: {
          id: updated.id,
          kycTier: updated.kycTier,
          kycStatus: updated.kycStatus,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

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

    if (!(newTier in TIER_LIMITS)) {
      throw new AhavaError(
        AhavaErrorCode.VAL_INVALID_ENUM_VALUE,
        "Invalid tier",
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

    const limits = TIER_LIMITS[newTier as keyof typeof TIER_LIMITS];

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        kycTier: newTier,
        kycStatus: "VERIFIED",
      },
    });

    await prisma.wallet.updateMany({
      where: { userId },
      data: {
        kycTier: newTier,
        dailyLimit: limits.daily,
        monthlyLimit: limits.monthly,
        maxBalance: limits.maxBalance,
        perTransactionLimit: limits.perTransaction,
      },
    });

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

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
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
    console.log(`KYC Service listening on port ${PORT}`);
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
