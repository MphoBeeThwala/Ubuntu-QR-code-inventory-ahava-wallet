// Minimal audit logger stub. In production, this should write to a dedicated audit log store.

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
  async log(entry: AuditLogEntry): Promise<void> {
    // TODO: Persist audit log to DB or external system
    console.log('Audit log:', entry);
  }
}
