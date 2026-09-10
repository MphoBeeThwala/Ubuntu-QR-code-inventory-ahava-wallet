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
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";
import { writeAuditLog } from "@ahava/shared-audit";
import { parseBearerToken, verifyJWT } from "@ahava/shared-crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6004;

const redisConnection = getRedisConnectionConfig();

// Presigned-upload flow for identity documents: the client asks this
// service for a short-lived, single-object S3 write URL (this endpoint),
// PUTs the file bytes directly to S3 (server never sees them, avoiding a
// multipart-body hop through api-gateway's JSON-only proxying), then calls
// POST /kyc/document/upload with the resulting s3Key + a client-computed
// hash to register the document. Previously there was no way to get a
// document into S3 at all — the PWA posted a raw file as multipart
// form-data straight to /kyc/document/upload, which has only ever accepted
// a JSON manifest referencing a key that nothing generated.
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "af-south-1",
});
const UPLOAD_URL_TTL_SECONDS = 300;
const ALLOWED_UPLOAD_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

// This file had no authorization anywhere — GET /kyc/user/:userId (which
// includes pepFlag, a politically-exposed-person flag) was readable by any
// authenticated caller for any userId, and POST /kyc/tier-upgrade would
// grant ANY userId TIER_2 limits (the highest spending limits in the
// system) with zero identity verification — a customer could self-upgrade
// past actual KYC review entirely. Grepped for callers of tier-upgrade
// across every other service and the frontends: none exist, so this was
// also completely orphaned from any legitimate internal caller. Same
// requireAuth/assertOwnerOrAgent/requireAgentRole pattern as
// wallet-service and payment-service's identical fixes this session.
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

async function requireAgentRole(
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
    if (payload.role !== "AGENT") {
      throw new Error("insufficient role");
    }
    next();
  } catch {
    const err = new AhavaError(
      AhavaErrorCode.AUTH_UNAUTHORIZED,
      "This action requires an authorized agent account",
      { requestId: req.id },
    );
    res.status(err.statusCode).json(createErrorResponse(err));
  }
}

// Type-shape validation layered in FRONT OF, not instead of, the existing
// required-field checks below — see the identical helper in
// payment-service/src/main.ts and auth-service/src/main.ts. This upload
// endpoint accepts identity-document metadata (documentHash, s3Key) tied to
// a userId, so a malformed value here (e.g. documentType outside the
// Prisma enum) is worth rejecting cleanly before it reaches
// prisma.kycDocument.create and surfaces as a raw Prisma error instead.
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

const kycDocumentUploadUrlBodySchema = z.object({
  documentType: z
    .enum([
      "SA_ID_BOOK",
      "SA_ID_CARD",
      "PASSPORT",
      "ASYLUM_DOCUMENT",
      "REFUGEE_DOCUMENT",
      "PROOF_OF_ADDRESS",
      "PROOF_OF_INCOME",
      "BUSINESS_REGISTRATION",
      "SELFIE",
    ])
    .optional(),
  contentType: z.enum(["image/jpeg", "image/png", "application/pdf"]).optional(),
});

const kycDocumentUploadBodySchema = z.object({
  userId: z.string().min(1).optional(),
  documentType: z
    .enum([
      "SA_ID_BOOK",
      "SA_ID_CARD",
      "PASSPORT",
      "ASYLUM_DOCUMENT",
      "REFUGEE_DOCUMENT",
      "PROOF_OF_ADDRESS",
      "PROOF_OF_INCOME",
      "BUSINESS_REGISTRATION",
      "SELFIE",
    ])
    .optional(),
  s3Key: z.string().min(1).max(500).optional(),
  documentHash: z.string().min(1).max(64).optional(),
});

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  const requestId =
    typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});

app.get("/health", (req, res) => {
  res.json(
    createSuccessResponse({ status: "ok", service: "kyc-service" }, req.id),
  );
});

// GET /kyc/user/:userId - Get KYC status
app.get(
  "/kyc/user/:userId",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      assertOwnerOrAgent(req, userId);

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
          { requestId: req.id },
        );
      }

      res.json(createSuccessResponse({ kyc: user }, req.id));
    } catch (error) {
      next(error);
    }
  },
);

// POST /kyc/document/upload-url - Get a presigned S3 URL to upload a
// document to, before calling POST /kyc/document/upload to register it.
app.post(
  "/kyc/document/upload-url",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentType, contentType } = validateBody(
        kycDocumentUploadUrlBodySchema,
        req.body,
        req.id,
      );

      if (!documentType) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "documentType is required",
          { requestId: req.id },
        );
      }

      // Read fresh on every call, not cached into a module-level constant,
      // so tests can toggle this per-suite regardless of when the env var
      // is set relative to module load — same reasoning as
      // SANCTIONS_SCREENING_ENABLED in payment-service/src/main.ts.
      const kycDocumentsBucket = process.env.KYC_DOCUMENTS_BUCKET || "";
      if (!kycDocumentsBucket) {
        throw new AhavaError(
          AhavaErrorCode.INTERNAL_SERVICE_UNAVAILABLE,
          "Document uploads are not configured (KYC_DOCUMENTS_BUCKET unset)",
          { requestId: req.id },
        );
      }

      const resolvedContentType = contentType || "application/pdf";
      const extension = ALLOWED_UPLOAD_CONTENT_TYPES[resolvedContentType];
      if (!extension) {
        throw new AhavaError(
          AhavaErrorCode.VAL_INVALID_INPUT,
          "contentType must be one of: " +
            Object.keys(ALLOWED_UPLOAD_CONTENT_TYPES).join(", "),
          { requestId: req.id },
        );
      }

      // req.userId, not a body field — a caller can only ever request an
      // upload URL for their own document, same as the ownership check on
      // POST /kyc/document/upload below (agents aren't expected to upload
      // documents on a customer's behalf, unlike wallet actions, so no
      // AGENT bypass here).
      const s3Key = `kyc-documents/${req.userId}/${documentType}/${uuidv4()}.${extension}`;

      const command = new PutObjectCommand({
        Bucket: kycDocumentsBucket,
        Key: s3Key,
        ContentType: resolvedContentType,
      });
      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      });

      res.json(
        createSuccessResponse(
          { uploadUrl, s3Key, expiresIn: UPLOAD_URL_TTL_SECONDS },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST /kyc/document/upload - Upload KYC document
app.post(
  "/kyc/document/upload",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, documentType, s3Key, documentHash } = validateBody(
        kycDocumentUploadBodySchema,
        req.body,
        req.id,
      );

      if (!userId || !documentType || !s3Key || !documentHash) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing required fields",
          { requestId: req.id },
        );
      }

      assertOwnerOrAgent(req, userId);

      const doc = await prisma.kycDocument.create({
        data: {
          userId,
          documentType,
          s3Key,
          documentHash,
          verificationStatus: "PENDING",
        },
      });

      // Publish KYC_DOCUMENT_UPLOADED event for ML verification pipeline
      const kycQueue = new Queue(QUEUE_NAMES.KYC_DOCUMENT_UPLOADED, {
        connection: redisConnection,
      });
      kycQueue
        .add("kyc-doc-uploaded", {
          documentId: doc.id,
          userId,
          documentType,
          s3Key,
          uploadedAt: doc.createdAt.toISOString(),
        })
        .then(() => kycQueue.close())
        .catch((e) => console.error("[kyc-service] event publish failed:", e));

      // Enqueue notification to user
      const notifQueue = new Queue(QUEUE_NAMES.NOTIFICATION_QUEUED, {
        connection: redisConnection,
      });
      notifQueue
        .add("notify", {
          userId,
          channel: "IN_APP",
          title: "Document Received",
          body: `Your ${documentType} document has been received and is under review.`,
        })
        .then(() => notifQueue.close())
        .catch((e) =>
          console.error("[kyc-service] notification publish failed:", e),
        );

      res.status(201).json(createSuccessResponse({ document: doc }, req.id));
    } catch (error) {
      next(error);
    }
  },
);

// POST /kyc/tier-upgrade - Upgrade KYC tier
// Grants higher spending limits (up to TIER_2 = R25,000 max balance) — this
// must follow real document review, not be self-service. Orphaned from any
// legitimate caller today (grepped every service and frontend); agent role
// required as an immediate stopgap, same bar as wallet-service's
// suspend/freeze/limits routes.
app.post(
  "/kyc/tier-upgrade",
  requireAgentRole,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, newTier } = req.body;

      if (!userId || !newTier) {
        throw new AhavaError(
          AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
          "Missing userId or newTier",
          { requestId: req.id },
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AhavaError(
          AhavaErrorCode.AUTH_UNAUTHORIZED,
          "User not found",
          { requestId: req.id },
        );
      }

      // Define tier limits
      const tierLimits = {
        TIER_0: { daily: 50000, monthly: 200000, maxBalance: 250000 },
        TIER_1: { daily: 200000, monthly: 1000000, maxBalance: 1000000 },
        TIER_2: { daily: 500000, monthly: 5000000, maxBalance: 25000000 },
      } as const;

      const limits =
        tierLimits[newTier as keyof typeof tierLimits] || tierLimits.TIER_0;

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

      await writeAuditLog(prisma, {
        userId,
        action: "KYC_TIER_UPGRADED",
        entityType: "User",
        entityId: userId,
        newState: JSON.stringify({ newTier }),
        serviceId: "kyc-service",
      });

      res.json(createSuccessResponse({ user: updated }, req.id));
    } catch (error) {
      next(error);
    }
  },
);

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    "Internal server error",
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(genericError));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ KYC Service listening on port ${PORT}`);
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
