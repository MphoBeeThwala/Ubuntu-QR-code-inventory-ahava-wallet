import http from "http";
import type { AddressInfo } from "net";
import type { Server } from "http";

type GatewayResponse = {
  status: number;
  body: any;
  raw: string;
};

function mockJsonResponse(status: number, body: unknown) {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

function requestGateway(
  basePort: number,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: basePort,
        method,
        path,
        headers: {
          ...(payload ? { "content-type": "application/json" } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let parsed: unknown = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode || 500,
            body: parsed,
            raw,
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("api-gateway full flow proxy", () => {
  let server: Server | undefined;
  let port: number;
  let fetchMock: jest.Mock;

  beforeAll((done) => {
    process.env.AUTH_SERVICE_URL = "http://auth-service:3001";
    process.env.WALLET_SERVICE_URL = "http://wallet-service:3002";
    process.env.PAYMENT_SERVICE_URL = "http://payment-service:3003";
    process.env.NOTIFICATION_SERVICE_URL = "http://notification-service:3005";
    process.env.KYC_SERVICE_URL = "http://kyc-service:3004";

    fetchMock = jest.fn(async (url: string, init?: any) => {
      const target = String(url);
      if (target === "http://auth-service:3001/auth/register") {
        return mockJsonResponse(201, {
          success: true,
          data: { userId: "user-1", walletId: "wallet-1" },
        });
      }

      if (target === "http://auth-service:3001/auth/login") {
        return mockJsonResponse(200, {
          success: true,
          data: { userId: "user-1", accessToken: "token-1" },
        });
      }

      if (target === "http://wallet-service:3002/wallets/user/user-1/balance") {
        return mockJsonResponse(200, {
          success: true,
          data: {
            walletId: "wallet-1",
            balance: { available: 100000, pending: 0, reserved: 0, total: 100000, currency: "ZAR" },
          },
        });
      }

      if (target === "http://wallet-service:3002/wallets/wallet-1/transactions?direction=sent&sortBy=createdAt&sort=desc") {
        return mockJsonResponse(200, {
          success: true,
          data: {
            transactions: [{ id: "txn-history-1", transactionType: "DEBIT", status: "COMPLETED" }],
          },
        });
      }

      if (target === "http://wallet-service:3002/wallets/wallet-1/transactions/txn-history-1") {
        return mockJsonResponse(200, {
          success: true,
          data: {
            transaction: { id: "txn-history-1", transactionType: "DEBIT", status: "COMPLETED" },
          },
        });
      }

      if (target === "http://payment-service:3003/payments") {
        if (init?.headers?.Authorization !== "Bearer token-1") {
          return mockJsonResponse(401, {
            success: false,
            error: { code: "AUTH_UNAUTHORIZED", message: "Missing auth" },
          });
        }

        return mockJsonResponse(201, {
          success: true,
          data: { transaction: { debit: { id: "txn-1" } } },
        });
      }

      if (target === "http://notification-service:3005/notifications?userId=user-1&status=PENDING") {
        return mockJsonResponse(200, {
          success: true,
          data: {
            notifications: [{ id: "not-1", status: "PENDING" }],
          },
        });
      }

      if (target === "http://kyc-service:3004/kyc/status?userId=user-1") {
        return mockJsonResponse(200, {
          success: true,
          data: { kyc: { kycTier: "TIER_0", kycStatus: "PENDING" } },
        });
      }

      return mockJsonResponse(404, {
        success: false,
        error: { code: "INTERNAL_NOT_IMPLEMENTED", message: "Route not found" },
      });
    });

    (global as any).fetch = fetchMock;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    try {
      const app = require("./main").default;
      server = app.listen(0, () => {
        const addr = server?.address() as AddressInfo;
        port = addr.port;
        done();
      });
    } catch (error) {
      done(error as Error);
    }
  });

  afterAll((done) => {
    if (server) {
      server.close(done);
      return;
    }
    done();
  });

  beforeEach(() => {
    fetchMock.mockClear();
  });

  it("proxies Register -> Login -> Wallet -> Send Money end-to-end", async () => {
    const register = await requestGateway(port, "POST", "/auth/register", {
      phoneNumber: "0821234567",
      pin: "1234",
      deviceId: "device-1",
    });
    expect(register.status).toBe(201);
    expect(register.body.success).toBe(true);

    const login = await requestGateway(port, "POST", "/auth/login", {
      phoneNumber: "0821234567",
      pin: "1234",
      deviceId: "device-1",
    });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBe("token-1");

    const wallet = await requestGateway(
      port,
      "GET",
      "/wallets/user/user-1/balance",
      undefined,
      { Authorization: "Bearer token-1" }
    );
    expect(wallet.status).toBe(200);
    expect(wallet.body.data.walletId).toBe("wallet-1");

    const payment = await requestGateway(
      port,
      "POST",
      "/payments",
      {
        senderWalletId: "wallet-1",
        receiverWalletId: "wallet-2",
        amountCents: 5000,
        idempotencyKey: "idem-gw-1",
      },
      { Authorization: "Bearer token-1" }
    );
    expect(payment.status).toBe(201);
    expect(payment.body.data.transaction.debit.id).toBe("txn-1");

    const forwardedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(forwardedUrls).toEqual([
      "http://auth-service:3001/auth/register",
      "http://auth-service:3001/auth/login",
      "http://wallet-service:3002/wallets/user/user-1/balance",
      "http://payment-service:3003/payments",
    ]);
  });

  it("proxies transaction history list and detail to wallet-service", async () => {
    const list = await requestGateway(
      port,
      "GET",
      "/wallets/wallet-1/transactions?direction=sent&sortBy=createdAt&sort=desc",
      undefined,
      { Authorization: "Bearer token-1" }
    );
    expect(list.status).toBe(200);
    expect(list.body.data.transactions[0].id).toBe("txn-history-1");

    const detail = await requestGateway(
      port,
      "GET",
      "/wallets/wallet-1/transactions/txn-history-1",
      undefined,
      { Authorization: "Bearer token-1" }
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.transaction.id).toBe("txn-history-1");
  });

  it("proxies notifications list to notification-service", async () => {
    const list = await requestGateway(
      port,
      "GET",
      "/notifications?userId=user-1&status=PENDING",
      undefined,
      { Authorization: "Bearer token-1" }
    );
    expect(list.status).toBe(200);
    expect(list.body.data.notifications[0].id).toBe("not-1");
  });

  it("proxies kyc status to kyc-service", async () => {
    const response = await requestGateway(
      port,
      "GET",
      "/kyc/status?userId=user-1",
      undefined,
      { Authorization: "Bearer token-1" }
    );
    expect(response.status).toBe(200);
    expect(response.body.data.kyc.kycTier).toBe("TIER_0");
  });

  it("enforces authorization on protected routes", async () => {
    const response = await requestGateway(port, "GET", "/wallets/user/user-1/balance");
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("AUTH_UNAUTHORIZED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards request and correlation IDs to downstream services", async () => {
    await requestGateway(
      port,
      "GET",
      "/wallets/user/user-1/balance",
      undefined,
      {
        Authorization: "Bearer token-1",
        "X-Request-ID": "req-123",
        "X-Correlation-ID": "corr-abc",
      }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Request-ID"]).toBe("req-123");
    expect(init.headers["X-Correlation-ID"]).toBe("corr-abc");
  });

  it("maps upstream outages to dependency failure", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("connection reset");
    });

    const response = await requestGateway(
      port,
      "GET",
      "/wallets/user/user-1/balance",
      undefined,
      { Authorization: "Bearer token-1" }
    );

    expect(response.status).toBe(502);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INTERNAL_DEPENDENCY_FAILURE");
  });
});
