import request from "supertest";
import crypto from "crypto";
import * as jwt from "jsonwebtoken";

// rate-limit.middleware constructs a real ioredis client (with an
// always-retrying retryStrategy) at import time. Without a Redis server in
// the test environment that client reconnects forever, leaving an open
// handle that keeps the process alive after the test run finishes — jest
// never exits, it just hangs past its process-level timeout. Mocked here,
// before importing main (which pulls in the middleware), so no real socket
// is ever opened.
//
// rate-limit-redis drives this mock through two Lua-script-shaped calls it
// issues on every request: `SCRIPT LOAD <lua>`, which must resolve to a
// string (the script SHA), and `EVALSHA <sha> ...`, which must resolve to a
// 2-element array `[totalHits, ttlMs]` — see loadIncrementScript/get in
// rate-limit-redis/dist/index.cjs. Any other shape throws "unexpected reply
// from redis client" before the request handler ever runs.
//
// `call` is a plain function, not `jest.fn()`, deliberately: this suite's
// `beforeEach` runs `jest.resetAllMocks()`, which (unlike `clearAllMocks`)
// strips implementations set via `jest.fn(impl)` back to a bare stub — that
// silently broke rate limiting on every test after the first.
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

import app from "../main";
import { setPublicKeyForTesting } from "../middleware/auth.middleware";

function mockFetchOnce(opts: {
  status: number;
  bodyText: string;
  contentType?: string;
}) {
  const headers = new Map<string, string>();
  if (opts.contentType) headers.set("content-type", opts.contentType);

  type FetchLike = (
    input: string,
    init?: Record<string, unknown>,
  ) => Promise<{
    status: number;
    headers: { get(name: string): string | null };
    text(): Promise<string>;
  }>;

  const fetchMock: jest.MockedFunction<FetchLike> = jest
    .fn()
    .mockResolvedValue({
      status: opts.status,
      headers: {
        get: (k: string) => headers.get(k.toLowerCase()) ?? null,
      },
      text: async () => opts.bodyText,
    });

  (globalThis as unknown as { fetch: FetchLike }).fetch = fetchMock;
  return fetchMock;
}

describe("API Gateway", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("GET /health returns success envelope and echoes X-Request-ID", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("rejects protected routes without Authorization header", async () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    setPublicKeyForTesting(
      publicKey.export({ type: "pkcs1", format: "pem" }) as string,
    );

    const res = await request(app).get(
      "/wallets/lookup?walletNumber=AHV-0000-0001",
    );
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.requestId).toBe(res.headers["x-request-id"]);
  });

  it("rejects /auth/me without Authorization header", async () => {
    // Regression test: isPublicPath used to prefix-match the whole /auth/*
    // namespace as public, so /auth/me — which requires an authenticated
    // caller — passed through the gateway with no token at all (it happened
    // to be safe only because auth-service re-verifies the JWT itself).
    // Only the exact routes that authenticate some other way (PIN, refresh
    // token, or not yet) should be exempt.
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    setPublicKeyForTesting(
      publicKey.export({ type: "pkcs1", format: "pem" }) as string,
    );

    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("allows /auth/login and /auth/device-bind without Authorization header", async () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    setPublicKeyForTesting(
      publicKey.export({ type: "pkcs1", format: "pem" }) as string,
    );

    mockFetchOnce({
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({ success: true, data: {} }),
    });
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ phoneNumber: "+27821234567", pin: "1234", deviceId: "device-1" });
    expect(loginRes.status).not.toBe(403);

    mockFetchOnce({
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({ success: true, data: {} }),
    });
    const bindRes = await request(app)
      .post("/auth/device-bind")
      .send({ userId: "user-1", pin: "1234", deviceId: "device-2" });
    expect(bindRes.status).not.toBe(403);
  });

  it("proxies requests and forwards X-Request-ID downstream", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    setPublicKeyForTesting(
      publicKey.export({ type: "pkcs1", format: "pem" }) as string,
    );

    const token = jwt.sign(
      { sub: "user-1", deviceId: "device-1" },
      privateKey.export({ type: "pkcs1", format: "pem" }),
      {
        algorithm: "RS256",
        issuer: "ahava-ewallet",
        audience: "ahava-api",
        expiresIn: "5m",
      },
    );

    const fetchMock = mockFetchOnce({
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({
        success: true,
        data: { ok: 1 },
        requestId: "downstream",
        timestamp: new Date().toISOString(),
      }),
    });

    const res = await request(app)
      .get("/wallets/lookup?walletNumber=AHV-0000-0001")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, fetchOpts] = fetchMock.mock.calls[0];
    const headers = (fetchOpts?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Request-ID"]).toBe(res.headers["x-request-id"]);
  });
});
