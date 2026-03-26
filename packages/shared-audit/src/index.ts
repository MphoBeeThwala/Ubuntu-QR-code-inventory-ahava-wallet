import type { Prisma, PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

export type AuditLogWriteInput = {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  previousState?: string;
  newState?: string;
  ipAddress?: string;
  deviceId?: string;
  userAgent?: string;
  serviceId: string;
  correlationId?: string;
};

type AuditClient = PrismaClient | Prisma.TransactionClient;

export async function writeAuditLog(
  client: AuditClient,
  input: AuditLogWriteInput,
) {
  const id = uuidv4();
  const createdAt = new Date();
  const secret = process.env.AUDIT_LOG_HMAC_KEY || process.env.HASH_SALT || "";
  const lockId = 913_502_771;

  const run = async (tx: AuditClient) => {
    if (typeof (tx as any).$executeRaw === "function") {
      await (tx as any).$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;
    }

    const last =
      typeof (tx as any).auditLog?.findFirst === "function"
        ? await (tx as any).auditLog.findFirst({
            where: { recordHash: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { recordHash: true },
          })
        : null;

    const prevHash: string | null = last?.recordHash ?? null;
    const recordHash = hmacHex(
      stableStringify({
        id,
        createdAt: createdAt.toISOString(),
        prevHash,
        ...input,
      }),
      secret,
    );

    return (tx as any).auditLog.create({
      data: {
        id,
        createdAt,
        prevHash,
        recordHash,
        hashVersion: 1,
        ...input,
      },
    });
  };

  if (
    typeof (client as any).$transaction === "function" &&
    typeof (client as any).$executeRaw === "function"
  ) {
    return (client as any).$transaction((tx: AuditClient) => run(tx), {
      timeout: 10_000,
    });
  }

  return run(client);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortDeep);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortDeep(obj[key]);
  }
  return out;
}

function hmacHex(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
