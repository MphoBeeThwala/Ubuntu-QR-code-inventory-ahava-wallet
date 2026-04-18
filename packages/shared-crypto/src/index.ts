/**
 * Crypto utilities for Ahava eWallet
 * - PIN hashing (Argon2id)
 * - JWT signing/verification (RS256)
 * - PII encryption/decryption (AES-256)
 * - AWS Secrets Manager integration
 */

import * as argon2 from "argon2";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { SecretsManager } from "@aws-sdk/client-secrets-manager";

// ─────────────────────────────────────────────────────────────────
// PIN HASHING
// ─────────────────────────────────────────────────────────────────

/**
 * Hash a user PIN using Argon2id (memory-hard, timing-resistant)
 * Used for secure PIN storage in database
 */
export async function hashPin(pin: string): Promise<string> {
  // TODO: You'll configure these parameters based on your security requirements
  // Typical: memory: 64 MB, time: 3 iterations, parallelism: 4
  try {
    return await argon2.hash(pin, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
      saltLength: 16,
    });
  } catch (error) {
    throw new Error(
      `PIN hashing failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify a user PIN against stored hash
 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch (error) {
    throw new Error(
      `PIN verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

// ─────────────────────────────────────────────────────────────────
// JWT SIGNING/VERIFICATION
// ─────────────────────────────────────────────────────────────────

/**
 * Generate a new JWT access token
 * Uses RS256 (asymmetric RSA signing)
 *
 * TODO: Implement AWS Secrets Manager integration
 * - Fetch private key from AWS Secrets Manager (path: /ahava/prod/jwt-private-key)
 * - Cache public key for verification in API Gateway
 */
export async function generateAccessToken(
  payload: Record<string, unknown>,
  expiresIn: string | number = "15m",
  privateKey?: string,
): Promise<string> {
  const key = privateKey ?? (await fetchJWTPrivateKey());

  try {
    const options = {
      algorithm: "RS256",
      expiresIn,
      issuer: "ahava-ewallet",
      audience: "ahava-api",
    } as any;
    return jwt.sign(payload, key, options);
  } catch (error) {
    throw new Error(
      `JWT generation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Generate a refresh token (longer-lived, stores in DB with hash)
 */
export async function generateRefreshToken(
  userId: string,
  deviceId: string,
  expiresIn: string | number = "30d",
  privateKey?: string,
): Promise<string> {
  const key = privateKey ?? (await fetchJWTPrivateKey());

  try {
    const options = {
      algorithm: "RS256",
      expiresIn,
      issuer: "ahava-ewallet",
    } as any;
    return jwt.sign({ userId, deviceId, type: "refresh" }, key, options);
  } catch (error) {
    throw new Error(
      `Refresh token generation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify JWT token
 * TODO: Fetch public key from AWS Secrets Manager / cache
 */
export async function verifyJWT(
  token: string,
  publicKey?: string,
): Promise<Record<string, unknown>> {
  const key = publicKey ?? (await fetchJWTPublicKey());

  try {
    return jwt.verify(token, key, {
      algorithms: ["RS256"],
      issuer: "ahava-ewallet",
    }) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// PII ENCRYPTION / DECRYPTION
// ─────────────────────────────────────────────────────────────────

/**
 * Encrypt PII fields (phone, ID number, etc) using AES-256-GCM
 * Follows pgcrypto encryption standard
 *
 * TODO: Synchronize with database pgcrypto settings
 * - Use 256-bit key from AWS Secrets Manager
 * - IV should be randomly generated per encryption
 */
export function encryptPII(
  plaintext: string,
  encryptionKey: string = process.env.PII_ENCRYPTION_KEY || "",
): string {
  if (!encryptionKey) {
    throw new Error("PII_ENCRYPTION_KEY environment variable not set");
  }

  // TODO: Ensure key is 32 bytes (256 bits)
  const key = Buffer.from(encryptionKey, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt PII fields
 */
export function decryptPII(
  ciphertext: string,
  encryptionKey: string = process.env.PII_ENCRYPTION_KEY || "",
): string {
  if (!encryptionKey) {
    throw new Error("PII_ENCRYPTION_KEY environment variable not set");
  }

  const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
  const key = Buffer.from(encryptionKey, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// ─────────────────────────────────────────────────────────────────
// HASHING UTILITIES
// ─────────────────────────────────────────────────────────────────

/**
 * Generate SHA-256 hash for lookup (phone, ID number)
 * Cannot be reversed — used for database unique lookups
 */
export function hashForLookup(value: string, salt: string = ""): string {
  const input = salt ? `${value}:${salt}` : value;
  return crypto
    .createHash("sha256")
    .update(input)
    .update(process.env.HASH_SALT || "")
    .digest("hex");
}

/**
 * Generate SHA-256 hash for document/file verification
 */
export function hashDocument(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ─────────────────────────────────────────────────────────────────
// AWS SECRETS MANAGER
// ─────────────────────────────────────────────────────────────────

const secretsClient = new SecretsManager({
  region: process.env.AWS_REGION || "af-south-1",
});

/** In-memory cache: secretName → value. Populated once per process lifecycle. */
const secretCache = new Map<string, string>();

/**
 * Fetch secret from AWS Secrets Manager with in-memory cache.
 * Falls back to environment variables when AWS is unreachable (local dev).
 *
 * Fallback env-var convention:  /ahava/jwt-private-key  →  JWT_PRIVATE_KEY
 *                                /ahava/jwt-public-key   →  JWT_PUBLIC_KEY
 *                                /ahava/pii-encryption-key → PII_ENCRYPTION_KEY
 */
export async function fetchSecret(
  secretName: string,
  envFallback?: string,
): Promise<string> {
  if (secretCache.has(secretName)) {
    return secretCache.get(secretName)!;
  }

  try {
    const response = await secretsClient.getSecretValue({
      SecretId: secretName,
    });
    const value = response.SecretString
      ? response.SecretString
      : response.SecretBinary
        ? Buffer.from(
            response.SecretBinary as unknown as string,
            "base64",
          ).toString("utf-8")
        : null;

    if (!value) throw new Error("Empty secret value");
    const normalized = value.includes("\\n")
      ? value.replace(/\\n/g, "\n")
      : value;
    secretCache.set(secretName, normalized);
    return normalized;
  } catch (awsError) {
    // In local/test environments AWS won't be reachable — fall back to env var
    const fallbackValue = envFallback ? process.env[envFallback] : undefined;
    if (fallbackValue) {
      const normalized = fallbackValue.includes("\\n")
        ? fallbackValue.replace(/\\n/g, "\n")
        : fallbackValue;
      secretCache.set(secretName, normalized);
      return normalized;
    }
    throw new Error(
      `Failed to fetch secret '${secretName}' and no env fallback (${envFallback}) found: ` +
        (awsError instanceof Error ? awsError.message : String(awsError)),
    );
  }
}

/** Clear the secret cache (useful for key rotation or in tests). */
export function clearSecretCache(): void {
  secretCache.clear();
}

/**
 * Fetch JWT private key.
 * AWS path: `<env>/ahava/jwt-private-key` | env fallback: JWT_PRIVATE_KEY
 */
export async function fetchJWTPrivateKey(): Promise<string> {
  return fetchSecret(
    `/ahava/${process.env.NODE_ENV || "dev"}/jwt-private-key`,
    "JWT_PRIVATE_KEY",
  );
}

/**
 * Fetch JWT public key.
 * AWS path: `<env>/ahava/jwt-public-key` | env fallback: JWT_PUBLIC_KEY
 */
export async function fetchJWTPublicKey(): Promise<string> {
  return fetchSecret(
    `/ahava/${process.env.NODE_ENV || "dev"}/jwt-public-key`,
    "JWT_PUBLIC_KEY",
  );
}

/**
 * Fetch PII encryption key.
 * AWS path: `<env>/ahava/pii-encryption-key` | env fallback: PII_ENCRYPTION_KEY
 */
export async function fetchPIIEncryptionKey(): Promise<string> {
  return fetchSecret(
    `/ahava/${process.env.NODE_ENV || "dev"}/pii-encryption-key`,
    "PII_ENCRYPTION_KEY",
  );
}

/**
 * Generate random UUID (for idempotency keys, device IDs)
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate device fingerprint hash
 * Combines: user agent, IP address, device ID
 */
export function generateDeviceFingerprint(
  userAgent: string,
  ipAddress: string,
  deviceId: string,
): string {
  const fingerprint = `${userAgent}:${ipAddress}:${deviceId}`;
  return hashForLookup(fingerprint);
}

export default {
  hashPin,
  verifyPin,
  parseBearerToken,
  generateAccessToken,
  generateRefreshToken,
  verifyJWT,
  encryptPII,
  decryptPII,
  hashForLookup,
  hashDocument,
  fetchSecret,
  clearSecretCache,
  fetchJWTPrivateKey,
  fetchJWTPublicKey,
  fetchPIIEncryptionKey,
  generateUUID,
  generateDeviceFingerprint,
};
