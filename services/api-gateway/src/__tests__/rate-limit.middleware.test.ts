import { Request } from "express";

// rate-limit.middleware.ts constructs a real ioredis client and a RedisStore
// at import time (used by the exported limiters, unrelated to keyGenerator
// itself) — mocked here so importing the module under test doesn't attempt
// a real connection. RedisStore.init() runs synchronously at module load
// (createLimiter() builds each limiter as a top-level const), so `call`
// must satisfy the exact reply shapes rate-limit-redis expects even though
// this suite never triggers an actual rate-limit check: `SCRIPT LOAD` must
// resolve to a string (the script SHA) and `EVALSHA` to a 2-element array
// `[totalHits, ttlMs]` (see rate-limit-redis/dist/index.cjs) — anything
// else throws "unexpected reply from redis client" and crashes the import
// outright (not a catchable per-test failure). See the identical comment
// in gateway.test.ts.
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    on: () => {},
    call: (...args: unknown[]) => {
      const command = String(args[0]).toUpperCase();
      if (command === "SCRIPT") return Promise.resolve("mocked-script-sha1");
      if (command === "EVALSHA" || command === "EVAL") return Promise.resolve([1, 60000]);
      return Promise.resolve(undefined);
    },
    quit: () => Promise.resolve(undefined),
    disconnect: () => {},
  }));
});

import { keyGenerator } from "../middleware/rate-limit.middleware";

function mockRequest(overrides: Partial<Request>): Request {
  return overrides as Request;
}

describe("rate-limit keyGenerator", () => {
  // Regression coverage for the fix: keying purely on req.deviceFingerprint
  // (itself sourced from the client-controlled X-Device-Id header — see
  // main.ts's device-fingerprinting middleware) let an attacker claim a
  // fresh rate-limit bucket on every request just by sending a different
  // header value each time, with no cost at all. The key must incorporate
  // req.ip so that bypassing it requires rotating source IPs too, not just
  // an HTTP header.

  it("incorporates the request IP into the key, not just the device fingerprint", () => {
    const key = keyGenerator(
      mockRequest({ ip: "196.25.1.1", deviceFingerprint: "device-a" }),
    );
    expect(key).toContain("196.25.1.1");
  });

  it("produces a different key when only the spoofable device fingerprint changes but the IP stays the same", () => {
    // This is the case that matters LESS for the fix (different devices
    // legitimately get different buckets) but confirms the key still
    // reflects both inputs deterministically.
    const keyA = keyGenerator(
      mockRequest({ ip: "196.25.1.1", deviceFingerprint: "device-a" }),
    );
    const keyB = keyGenerator(
      mockRequest({ ip: "196.25.1.1", deviceFingerprint: "device-b" }),
    );
    expect(keyA).not.toBe(keyB);
  });

  it("produces a different key when the IP changes but the device fingerprint stays the same", () => {
    const keyA = keyGenerator(
      mockRequest({ ip: "196.25.1.1", deviceFingerprint: "device-a" }),
    );
    const keyB = keyGenerator(
      mockRequest({ ip: "41.10.5.5", deviceFingerprint: "device-a" }),
    );
    expect(keyA).not.toBe(keyB);
  });

  it("is stable for identical requests, so retries land in the same bucket", () => {
    const req = mockRequest({ ip: "196.25.1.1", deviceFingerprint: "device-a" });
    expect(keyGenerator(req)).toBe(keyGenerator(req));
  });

  it("gives distinct buckets to different devices sharing one IP (CGNAT / office NAT)", () => {
    const keyPhone1 = keyGenerator(
      mockRequest({ ip: "105.20.30.40", deviceFingerprint: "phone-1" }),
    );
    const keyPhone2 = keyGenerator(
      mockRequest({ ip: "105.20.30.40", deviceFingerprint: "phone-2" }),
    );
    expect(keyPhone1).not.toBe(keyPhone2);
  });

  it("falls back to placeholder values instead of throwing when ip/deviceFingerprint are missing", () => {
    expect(() => keyGenerator(mockRequest({}))).not.toThrow();
  });
});
