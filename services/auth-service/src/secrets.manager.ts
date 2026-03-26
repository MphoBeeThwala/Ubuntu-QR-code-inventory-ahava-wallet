// Minimal stub for Secrets Manager access. In production, this should resolve
// values from AWS Secrets Manager or another secure vault.
// We are resolving via environment variables for now to allow docker-compose/K8s configmaps
// to inject the secrets directly.

export class SecretsManager {
  async get(key: string): Promise<string> {
    // Map /ahava/dev/xxx to env var XXX
    const envKey = key.split("/").pop()?.toUpperCase().replace(/-/g, "_");
    if (envKey && process.env[envKey]) {
      return process.env[envKey]!;
    }

    // Fallback for local development
    return `secret-for:${key}`;
  }
}
