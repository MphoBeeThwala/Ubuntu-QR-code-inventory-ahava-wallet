import request from "supertest";
import * as nodeCrypto from "crypto";
import * as jwt from "jsonwebtoken";

// Real RSA keypair + JWT_PUBLIC_KEY env var: requireAuth's verifyJWT() call
// (packages/shared-crypto, not mocked in this file) falls back to reading
// this env var when no explicit key is passed. Same recipe as
// wallet-service/payment-service/kyc-service/reporting-service's suites.
const { publicKey: testPublicKey, privateKey: testPrivateKey } =
  nodeCrypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
process.env.JWT_PUBLIC_KEY = testPublicKey;

function signToken(claims: Record<string, unknown>): string {
  return jwt.sign(claims, testPrivateKey, {
    algorithm: "RS256",
    issuer: "ahava-ewallet",
    expiresIn: "5m",
  });
}

const MERCHANT_ID = "11111111-1111-1111-1111-111111111111";
function ownerAuthHeader(): string {
  return `Bearer ${signToken({ sub: MERCHANT_ID })}`;
}
function otherUserAuthHeader(): string {
  return `Bearer ${signToken({ sub: "a-different-user" })}`;
}
function agentAuthHeader(): string {
  return `Bearer ${signToken({ sub: "agent-user-1", role: "AGENT" })}`;
}

// products.routes.ts, stock.routes.ts, transactions.routes.ts, and
// main.ts each construct their own `new PrismaClient()` — this mock must
// return the SAME object every time so a mockResolvedValue configured in
// a test is actually visible to whichever file's prisma instance the
// route under test calls through (see the identical lesson learned with
// payshap-mock's tests earlier this session).
const mockPrisma = {
  user: { findUnique: jest.fn() },
  inventoryProduct: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  inventoryStock: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  inventoryTransaction: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  walletTransaction: { findUnique: jest.fn() },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

jest.mock("@ahava/shared-audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// ─── Import app AFTER all mocks ───────────────────────────────────
import app from "../main";

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1",
    merchantId: MERCHANT_ID,
    name: "Bread Loaf",
    description: null,
    category: "Groceries",
    priceCents: BigInt(2500),
    costCents: BigInt(1500),
    sku: null,
    barcode: null,
    trackStock: true,
    qrPayload: "{}",
    qrHash: "hash123",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────
// Regression coverage: products.routes.ts / stock.routes.ts /
// transactions.routes.ts were imported only for their side effects and
// never actually mounted with app.use() — every route below returned 404
// regardless of auth, because none of them were reachable via HTTP at all.
describe("route mounting", () => {
  it("GET /inventory/products is reachable (not 404)", async () => {
    mockPrisma.inventoryProduct.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get("/inventory/products")
      .query({ merchantId: MERCHANT_ID })
      .set("Authorization", ownerAuthHeader());
    expect(res.status).not.toBe(404);
  });

  it("GET /inventory/stock/:productId is reachable (not 404)", async () => {
    // A stub with no matching row would itself return the route's own
    // "not found" 404 — indistinguishable from "route isn't mounted" — so
    // this needs real data to assert on a 200 instead.
    mockPrisma.inventoryStock.findUnique.mockResolvedValue({
      id: "stock-1",
      productId: "product-1",
      quantity: 1,
      lowStockAlert: 5,
      product: { merchantId: MERCHANT_ID },
    });
    const res = await request(app)
      .get("/inventory/stock/product-1")
      .set("Authorization", ownerAuthHeader());
    expect(res.status).toBe(200);
  });

  it("GET /inventory/transactions is reachable (not 404)", async () => {
    mockPrisma.inventoryTransaction.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get("/inventory/transactions")
      .query({ merchantId: MERCHANT_ID })
      .set("Authorization", ownerAuthHeader());
    expect(res.status).not.toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /inventory/products", () => {
  it("returns the merchant's products", async () => {
    mockPrisma.inventoryProduct.findMany.mockResolvedValue([makeProduct()]);

    const res = await request(app)
      .get("/inventory/products")
      .query({ merchantId: MERCHANT_ID })
      .set("Authorization", ownerAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].priceCents).toBe("2500");
  });

  it("rejects without an Authorization header", async () => {
    const res = await request(app)
      .get("/inventory/products")
      .query({ merchantId: MERCHANT_ID });
    expect(res.status).toBe(403);
  });

  it("rejects a caller listing a different merchant's products", async () => {
    const res = await request(app)
      .get("/inventory/products")
      .query({ merchantId: MERCHANT_ID })
      .set("Authorization", otherUserAuthHeader());
    expect(res.status).toBe(403);
    expect(mockPrisma.inventoryProduct.findMany).not.toHaveBeenCalled();
  });

  it("allows an agent to list any merchant's products", async () => {
    mockPrisma.inventoryProduct.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get("/inventory/products")
      .query({ merchantId: MERCHANT_ID })
      .set("Authorization", agentAuthHeader());
    expect(res.status).toBe(200);
  });
});

describe("POST /inventory/products", () => {
  const validPayload = {
    merchantId: MERCHANT_ID,
    name: "Bread Loaf",
    priceCents: 2500,
  };

  it("creates a product for the caller's own merchantId", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: MERCHANT_ID });
    mockPrisma.inventoryProduct.create.mockResolvedValue(makeProduct());

    const res = await request(app)
      .post("/inventory/products")
      .set("Authorization", ownerAuthHeader())
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.product.priceCents).toBe("2500");
  });

  it("rejects creating a product under a different merchantId", async () => {
    const res = await request(app)
      .post("/inventory/products")
      .set("Authorization", otherUserAuthHeader())
      .send(validPayload);
    expect(res.status).toBe(403);
    expect(mockPrisma.inventoryProduct.create).not.toHaveBeenCalled();
  });
});

describe("GET /inventory/products/:id", () => {
  it("returns the product to its owner", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue(makeProduct());
    const res = await request(app)
      .get("/inventory/products/product-1")
      .set("Authorization", ownerAuthHeader());
    expect(res.status).toBe(200);
  });

  it("rejects a non-owner, non-agent caller", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue(makeProduct());
    const res = await request(app)
      .get("/inventory/products/product-1")
      .set("Authorization", otherUserAuthHeader());
    expect(res.status).toBe(403);
  });
});

describe("PATCH /inventory/products/:id", () => {
  it("rejects a non-owner updating the product", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue(makeProduct());
    const res = await request(app)
      .patch("/inventory/products/product-1")
      .set("Authorization", otherUserAuthHeader())
      .send({ name: "Vandalised" });
    expect(res.status).toBe(403);
    expect(mockPrisma.inventoryProduct.update).not.toHaveBeenCalled();
  });

  it("allows the owner to update the product", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue(makeProduct());
    mockPrisma.inventoryProduct.update.mockResolvedValue(
      makeProduct({ name: "Updated Bread" }),
    );
    const res = await request(app)
      .patch("/inventory/products/product-1")
      .set("Authorization", ownerAuthHeader())
      .send({ name: "Updated Bread" });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /inventory/products/:id", () => {
  it("rejects a non-owner deleting the product", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue(makeProduct());
    const res = await request(app)
      .delete("/inventory/products/product-1")
      .set("Authorization", otherUserAuthHeader());
    expect(res.status).toBe(403);
    expect(mockPrisma.inventoryProduct.update).not.toHaveBeenCalled();
  });

  it("allows the owner to delete the product", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue(makeProduct());
    mockPrisma.inventoryProduct.update.mockResolvedValue(
      makeProduct({ isActive: false }),
    );
    const res = await request(app)
      .delete("/inventory/products/product-1")
      .set("Authorization", ownerAuthHeader());
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /inventory/stock/:productId", () => {
  it("returns stock to the product's owner", async () => {
    mockPrisma.inventoryStock.findUnique.mockResolvedValue({
      id: "stock-1",
      productId: "product-1",
      quantity: 10,
      lowStockAlert: 5,
      lastRestocked: null,
      location: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      product: { merchantId: MERCHANT_ID },
    });
    const res = await request(app)
      .get("/inventory/stock/product-1")
      .set("Authorization", ownerAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.stock.quantity).toBe(10);
    // The product relation used for the ownership check shouldn't leak
    // into the response shape.
    expect(res.body.data.stock.product).toBeUndefined();
  });

  it("rejects a non-owner, non-agent caller", async () => {
    mockPrisma.inventoryStock.findUnique.mockResolvedValue({
      id: "stock-1",
      productId: "product-1",
      quantity: 10,
      lowStockAlert: 5,
      product: { merchantId: MERCHANT_ID },
    });
    const res = await request(app)
      .get("/inventory/stock/product-1")
      .set("Authorization", otherUserAuthHeader());
    expect(res.status).toBe(403);
  });
});

describe("POST /inventory/stock/:productId/adjust", () => {
  it("rejects a non-owner adjusting stock", async () => {
    mockPrisma.inventoryStock.findUnique.mockResolvedValue({
      id: "stock-1",
      productId: "product-1",
      quantity: 10,
      lowStockAlert: 5,
      product: { merchantId: MERCHANT_ID },
    });
    const res = await request(app)
      .post("/inventory/stock/product-1/adjust")
      .set("Authorization", otherUserAuthHeader())
      .send({ quantityChange: 5 });
    expect(res.status).toBe(403);
    expect(mockPrisma.inventoryStock.update).not.toHaveBeenCalled();
  });

  it("allows the owner to adjust stock", async () => {
    mockPrisma.inventoryStock.findUnique.mockResolvedValue({
      id: "stock-1",
      productId: "product-1",
      quantity: 10,
      lowStockAlert: 5,
      lastRestocked: null,
      location: null,
      product: { merchantId: MERCHANT_ID },
    });
    mockPrisma.inventoryStock.update.mockResolvedValue({
      id: "stock-1",
      productId: "product-1",
      quantity: 15,
      lowStockAlert: 5,
    });
    mockPrisma.inventoryTransaction.create.mockResolvedValue({});
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue(makeProduct());

    const res = await request(app)
      .post("/inventory/stock/product-1/adjust")
      .set("Authorization", ownerAuthHeader())
      .send({ quantityChange: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.stock.quantity).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────
describe("GET /inventory/transactions", () => {
  it("requires merchantId", async () => {
    const res = await request(app)
      .get("/inventory/transactions")
      .set("Authorization", ownerAuthHeader());
    expect(res.status).toBe(400);
  });

  it("rejects listing a different merchant's transactions", async () => {
    const res = await request(app)
      .get("/inventory/transactions")
      .query({ merchantId: MERCHANT_ID })
      .set("Authorization", otherUserAuthHeader());
    expect(res.status).toBe(403);
    expect(mockPrisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
  });

  it("returns the owner's transactions", async () => {
    mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        productId: "product-1",
        type: "SALE",
        quantity: 1,
        unitPriceCents: BigInt(2500),
        totalCents: BigInt(2500),
        walletTransactionId: null,
        notes: null,
        createdAt: new Date(),
        product: { id: "product-1", name: "Bread Loaf", priceCents: BigInt(2500) },
      },
    ]);
    const res = await request(app)
      .get("/inventory/transactions")
      .query({ merchantId: MERCHANT_ID })
      .set("Authorization", ownerAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
  });
});

describe("POST /inventory/transactions/sale", () => {
  it("rejects a non-owner recording a sale against the product", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue({
      ...makeProduct(),
      stock: { quantity: 10 },
    });
    const res = await request(app)
      .post("/inventory/transactions/sale")
      .set("Authorization", otherUserAuthHeader())
      .send({ walletTransactionId: "wtx-1", productId: "product-1" });
    expect(res.status).toBe(403);
    expect(mockPrisma.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it("allows the owner to record a sale", async () => {
    mockPrisma.inventoryProduct.findUnique.mockResolvedValue({
      ...makeProduct(),
      stock: { quantity: 10 },
    });
    mockPrisma.walletTransaction.findUnique.mockResolvedValue({ id: "wtx-1" });
    mockPrisma.inventoryTransaction.create.mockResolvedValue({
      id: "itx-1",
      productId: "product-1",
      type: "SALE",
      quantity: 1,
      unitPriceCents: BigInt(2500),
      totalCents: BigInt(2500),
      walletTransactionId: "wtx-1",
      notes: null,
      createdAt: new Date(),
    });
    mockPrisma.inventoryStock.update.mockResolvedValue({});

    const res = await request(app)
      .post("/inventory/transactions/sale")
      .set("Authorization", ownerAuthHeader())
      .send({ walletTransactionId: "wtx-1", productId: "product-1" });
    expect(res.status).toBe(201);
  });
});
