export interface RedisConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest?: null;
  enableReadyCheck?: boolean;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getRedisConnectionConfig(): RedisConnectionConfig {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    const parsed = new URL(redisUrl);
    const isTls = parsed.protocol === "rediss:";

    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw new Error(
        `Unsupported REDIS_URL protocol "${parsed.protocol}". Use redis:// or rediss://.`,
      );
    }

    return {
      host: parsed.hostname,
      port: parsePort(parsed.port, 6379),
      username: parsed.username
        ? decodeURIComponent(parsed.username)
        : undefined,
      password: parsed.password
        ? decodeURIComponent(parsed.password)
        : undefined,
      tls: isTls ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "REDIS_URL must be set in production. Localhost Redis is not supported.",
    );
  }

  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parsePort(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
