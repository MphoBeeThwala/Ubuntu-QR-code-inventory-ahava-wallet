// Simple secrets manager stub for local development.
// In production, this would fetch secrets from AWS Secrets Manager.

export class SecretsManager {
  constructor(private readonly envPrefix = 'AHAVA_') {}

  async get(key: string): Promise<string> {
    // Map expected secret keys to environment variables for local development.
    // Example: /ahava/payshap/api-key -> AHAVA_PAYSHAP_API_KEY
    const normalized = key
      .replace(/^\//, '')
      .replace(/\//g, '_')
      .replace(/-/g, '_')
      .toUpperCase();

    const envKey = `${this.envPrefix}${normalized}`;
    const value = process.env[envKey];
    if (!value) {
      throw new Error(`Secret not configured: ${key} (env ${envKey})`);
    }
    return value;
  }
}
