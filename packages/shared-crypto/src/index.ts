/**
 * Crypto utilities for Ahava eWallet
 * - PIN hashing (Argon2id)
 * - JWT signing/verification (RS256)
 * - PII encryption/decryption (AES-256)
 * - AWS Secrets Manager integration
 */

import * as argon2 from "argon2";
import * as jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
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
    throw new Error(`PIN hashing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify a user PIN against stored hash
 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch (error) {
    throw new Error(`PIN verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  privateKey?: string
): Promise<string> {
  if (!privateKey) {
    // TODO: Fetch from AWS Secrets Manager when not provided
    throw new Error("Private key not provided and AWS Secrets Manager not configured");
  }

  try {
    const options = {
      algorithm: "RS256",
      expiresIn,
      issuer: "ahava-ewallet",
      audience: "ahava-api",
    } as any;
    return jwt.sign(payload, privateKey, options);
  } catch (error) {
    throw new Error(`JWT generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate a refresh token (longer-lived, stores in DB with hash)
 */
export async function generateRefreshToken(
  userId: string,
  deviceId: string,
  expiresIn: string | number = "30d",
  privateKey?: string
): Promise<string> {
  if (!privateKey) {
    throw new Error("Private key not provided");
  }

  try {
    const options = {
      algorithm: "RS256",
      expiresIn,
      issuer: "ahava-ewallet",
    } as any;
    return jwt.sign(
      {
        userId,
        deviceId,
        type: "refresh",
      },
      privateKey,
      options
    );
  } catch (error) {
    throw new Error(`Refresh token generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify JWT token
 * TODO: Fetch public key from AWS Secrets Manager / cache
 */
export async function verifyJWT(
  token: string,
  publicKey?: string
): Promise<Record<string, unknown>> {
  if (!publicKey) {
    throw new Error("Public key not provided");
  }

  try {
    return jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: "ahava-ewallet",
    }) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`JWT verification failed: ${error instanceof Error ? error.message : String(error)}`);
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
  encryptionKey: string = process.env.PII_ENCRYPTION_KEY || ""
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
  encryptionKey: string = process.env.PII_ENCRYPTION_KEY || ""
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
  return crypto.createHash("sha256").update(input).update(process.env.HASH_SALT || "").digest("hex");
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

/**
 * Fetch secret from AWS Secrets Manager
 * TODO: Implement caching (Redis) for secrets to reduce API calls
 */
export async function fetchSecret(secretName: string): Promise<string> {
  try {
    const response = await secretsClient.getSecretValue({
      SecretId: secretName,
    });

    if (response.SecretString) {
      return response.SecretString;
    } else if (response.SecretBinary) {
      return Buffer.from(response.SecretBinary as unknown as string, "base64").toString("utf-8");
    }

    throw new Error("No secret value found");
  } catch (error) {
    throw new Error(
      `Failed to fetch secret ${secretName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Fetch JWT private key from AWS Secrets Manager
 * Used by auth service to sign tokens
 */
export async function fetchJWTPrivateKey(): Promise<string> {
  return fetchSecret(
    `${process.env.NODE_ENV || "dev"}/ahava/jwt-private-key`
  );
}

/**
 * Fetch JWT public key from AWS Secrets Manager
 * Used by API Gateway to verify tokens
 */
export async function fetchJWTPublicKey(): Promise<string> {
  return fetchSecret(
    `${process.env.NODE_ENV || "dev"}/ahava/jwt-public-key`
  );
}

/**
 * Fetch PII encryption key from AWS Secrets Manager
 */
export async function fetchPIIEncryptionKey(): Promise<string> {
  return fetchSecret(
    `${process.env.NODE_ENV || "dev"}/ahava/pii-encryption-key`
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
  deviceId: string
): string {
  const fingerprint = `${userAgent}:${ipAddress}:${deviceId}`;
  return hashForLookup(fingerprint);
}

export default {
  hashPin,
  verifyPin,
  generateAccessToken,
  generateRefreshToken,
  verifyJWT,
  encryptPII,
  decryptPII,
  hashForLookup,
  hashDocument,
  fetchSecret,
  fetchJWTPrivateKey,
  fetchJWTPublicKey,
  fetchPIIEncryptionKey,
  generateUUID,
  generateDeviceFingerprint,
};
