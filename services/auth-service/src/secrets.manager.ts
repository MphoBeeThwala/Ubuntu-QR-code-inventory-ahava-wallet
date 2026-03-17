// Minimal stub for Secrets Manager access. In production, this should resolve
// values from AWS Secrets Manager or another secure vault.

export class SecretsManager {
  async get(key: string): Promise<string> {
    // TODO: Implement real secrets retrieval.
    // For now, return a placeholder (must be overridden in tests / runtime).
    return `secret-for:${key}`;
  }
}
