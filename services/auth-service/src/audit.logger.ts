import { PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@ahava/shared-audit";

export interface AuditLogEntry {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  deviceId?: string;
  serviceId: string;
  correlationId?: string;
}

export class AuditLogger {
  constructor(private readonly prisma: PrismaClient) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await writeAuditLog(this.prisma, {
        userId: entry.userId || "system",
        action: entry.action,
        entityType: entry.entityType || "Unknown",
        entityId: entry.entityId || "0",
        ipAddress: entry.ipAddress,
        deviceId: entry.deviceId,
        serviceId: entry.serviceId,
        correlationId: entry.correlationId,
      });
    } catch (error) {
      console.error("Failed to write audit log:", error);
    }
  }
}
