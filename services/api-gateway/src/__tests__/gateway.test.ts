import request from "supertest";
import crypto from "crypto";
import * as jwt from "jsonwebtoken";
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

  it("proxies requests and forwards X-Request-ID downstream", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    setPublicKeyForTesting(
      publicKey.export({ type: "pkcs1", format: "pem" }) as string,
    );

    const token = jwt.sign(
      { userId: "user-1", deviceId: "device-1" },
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
