// Minimal audit logger for payment-service.
// In production, this should write structured audit entries to the database.

export class AuditLogger {
  async log(_entry: unknown): Promise<void> {
    // No-op stub for local development
    return;
  }
}
