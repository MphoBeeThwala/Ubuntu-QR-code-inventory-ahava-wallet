import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { AhavaError, AhavaErrorCode, createSuccessResponse, createErrorResponse } from "@ahava/shared-errors";
import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";
import { writeAuditLog } from "@ahava/shared-audit";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6005;
const redisConnection = getRedisConnectionConfig();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

type SagaStatus = "PENDING" | "RESERVING" | "DEBITING" | "CREDITING" | "FEEING" | "NOTIFYING" | "COMPLETED" | "COMPENSATING" | "COMPENSATED" | "FAILED";

interface SagaStep {
  name: string; service: string; endpoint: string; method: "POST" | "PUT" | "PATCH";
  payload: Record<string, unknown>;
  compensation?: { endpoint: string; method: "POST" | "PUT" | "PATCH"; payload: Record<string, unknown> };
}

interface PaymentSaga {
  sagaId: string; idempotencyKey: string; status: SagaStatus;
  steps: SagaStep[]; currentStepIndex: number; results: Record<string, unknown>[];
  errors: string[]; createdAt: Date; updatedAt: Date; completedAt?: Date;
}

const circuitBreakers: Record<string, { failures: number; lastFailure: Date | null; state: "CLOSED" | "OPEN" | "HALF_OPEN" }> = {};
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_TIMEOUT_MS = 30000;

function checkCircuit(service: string): boolean {
  const cb = circuitBreakers[service];
  if (!cb || cb.state === "CLOSED") return true;
  if (cb.state === "OPEN") {
    if (cb.lastFailure && Date.now() - cb.lastFailure.getTime() > CIRCUIT_TIMEOUT_MS) { cb.state = "HALF_OPEN"; cb.failures = 0; return true; }
    return false;
  }
  return true;
}
function recordSuccess(service: string) { circuitBreakers[service] = { failures: 0, lastFailure: null, state: "CLOSED" }; }
function recordFailure(service: string) {
  const cb = circuitBreakers[service] || { failures: 0, lastFailure: null, state: "CLOSED" };
  cb.failures += 1; cb.lastFailure = new Date();
  if (cb.failures >= CIRCUIT_THRESHOLD) { cb.state = "OPEN"; console.error(`[orchestrator] Circuit OPEN for ${service}`); }
  circuitBreakers[service] = cb;
}

const SERVICE_URLS = {
  wallet: process.env.WALLET_SERVICE_URL || "http://localhost:6002",
  payment: process.env.PAYMENT_SERVICE_URL || "http://localhost:6003",
  ledger: process.env.LEDGER_SERVICE_URL || "http://localhost:6004",
  notification: process.env.NOTIFICATION_SERVICE_URL || "http://localhost:6005",
  aml: process.env.AML_SERVICE_URL || "http://localhost:6007",
};

async function callService(service: string, endpoint: string, method: string, payload: Record<string, unknown>, retries = 3): Promise<Record<string, unknown>> {
  if (!checkCircuit(service)) throw new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, `Service ${service} circuit OPEN`);
  const url = `${SERVICE_URLS[service as keyof typeof SERVICE_URLS]}${endpoint}`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-Request-ID": uuidv4() }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json(); recordSuccess(service); return data;
    } catch (err) { lastError = err instanceof Error ? err : new Error(String(err)); if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); }
  }
  recordFailure(service);
  throw new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, `Service ${service} unavailable: ${lastError?.message}`);
}

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get("X-Request-ID");
  req.id = typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
});

app.get("/health", (req, res) => {
  res.json(createSuccessResponse({ status: "ok", service: "payment-orchestrator", circuitBreakers: Object.entries(circuitBreakers).map(([svc, state]) => ({ service: svc, state: state.state, failures: state.failures })) }, req.id));
});

app.post("/orchestrate/payment", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { senderWalletId, recipientWalletId, recipientPhone, amountCents, description, idempotencyKey, deviceId, ipAddress } = req.body;
    if (!senderWalletId || amountCents == null || !idempotencyKey) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing senderWalletId, amountCents, or idempotencyKey", { requestId: req.id });
    if (!recipientWalletId && !recipientPhone) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Provide recipientWalletId or recipientPhone", { requestId: req.id });
    const cached = await redis.get(`saga:${idempotencyKey}`);
    if (cached) { const result = JSON.parse(cached); if (result.status === "COMPLETED") return res.json(createSuccessResponse(result, req.id)); }
    const sagaId = uuidv4();
    const saga: PaymentSaga = { sagaId, idempotencyKey, status: "PENDING", steps: [], currentStepIndex: 0, results: [], errors: [], createdAt: new Date(), updatedAt: new Date() };
    let resolvedRecipientId = recipientWalletId;
    if (!resolvedRecipientId && recipientPhone) {
      const lookup = await callService("wallet", "/wallets/lookup", "GET", { walletNumber: recipientPhone });
      resolvedRecipientId = (lookup.data?.wallet?.id as string) || null;
    }
    if (!resolvedRecipientId) throw new AhavaError(AhavaErrorCode.PAY_COUNTERPARTY_NOT_FOUND, "Recipient wallet not found", { requestId: req.id });
    saga.steps = [
      { name: "debit_sender", service: "payment", endpoint: "/payments", method: "POST", payload: { senderWalletId, receiverWalletId: resolvedRecipientId, amountCents, description, idempotencyKey, paymentMethod: "UBUNTUPAY_WALLET", deviceId, ipAddress }, compensation: { endpoint: "/payments/reverse", method: "POST", payload: { idempotencyKey, reason: "Saga compensation" } } },
      { name: "ledger_entry", service: "ledger", endpoint: "/ledger/batch", method: "POST", payload: { entries: [{ transactionId: idempotencyKey, walletId: senderWalletId, userId: "system", entryType: "DEBIT", accountCode: "1100", amountCents: BigInt(amountCents), description: `Payment to ${resolvedRecipientId}`, reference: idempotencyKey }, { transactionId: idempotencyKey, walletId: resolvedRecipientId, userId: "system", entryType: "CREDIT", accountCode: "1100", amountCents: BigInt(amountCents), description: `Payment from ${senderWalletId}`, reference: idempotencyKey }] } },
      { name: "notify_recipient", service: "notification", endpoint: "/notifications/send", method: "POST", payload: { userId: resolvedRecipientId, channel: "PUSH", title: "Payment Received", body: `You received R${(amountCents / 100).toFixed(2)}` } },
    ];
    saga.status = "RESERVING";
    for (let i = 0; i < saga.steps.length; i++) {
      const step = saga.steps[i]; saga.currentStepIndex = i;
      try {
        const result = await callService(step.service, step.endpoint, step.method, step.payload);
        saga.results.push(result);
      } catch (err) {
        saga.errors.push(`Step ${step.name} failed: ${err instanceof Error ? err.message : String(err)}`); saga.status = "COMPENSATING";
        for (let j = i; j >= 0; j--) {
          const compStep = saga.steps[j];
          if (compStep.compensation) { try { await callService(compStep.service, compStep.compensation.endpoint, compStep.compensation.method, compStep.compensation.payload); } catch (compErr) { saga.errors.push(`Compensation for ${compStep.name} failed: ${compErr instanceof Error ? compErr.message : String(compErr)}`); } }
        }
        saga.status = "COMPENSATED"; saga.updatedAt = new Date();
        await redis.setex(`saga:${idempotencyKey}`, 86400, JSON.stringify({ sagaId, status: saga.status, errors: saga.errors, completedAt: saga.updatedAt.toISOString() }));
        throw new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, `Payment saga failed at "${step.name}". Changes compensated.`, { requestId: req.id, details: saga.errors });
      }
    }
    saga.status = "COMPLETED"; saga.completedAt = new Date(); saga.updatedAt = new Date();
    await redis.setex(`saga:${idempotencyKey}`, 86400, JSON.stringify({ sagaId, status: saga.status, results: saga.results, completedAt: saga.completedAt.toISOString() }));
    await writeAuditLog(prisma, { userId: senderWalletId, action: "PAYMENT_ORCHESTRATED", entityType: "saga", entityId: sagaId, newState: JSON.stringify({ status: saga.status, amountCents, recipient: resolvedRecipientId }), serviceId: "payment-orchestrator", correlationId: idempotencyKey });
    res.status(201).json(createSuccessResponse({ sagaId, status: saga.status, transactionId: idempotencyKey, amountCents, recipientWalletId: resolvedRecipientId, completedAt: saga.completedAt.toISOString() }, req.id));
  } catch (error) { next(error); }
});

app.post("/orchestrate/payshap", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { senderWalletId, creditorAccountRef, creditorName, amountCents, remittanceInfo, idempotencyKey } = req.body;
    if (!senderWalletId || !creditorAccountRef || amountCents == null || !idempotencyKey) throw new AhavaError(AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD, "Missing required fields", { requestId: req.id });
    const sagaId = uuidv4();
    const debitResult = await callService("payment", "/payments", "POST", { senderWalletId, receiverWalletId: "PAYSHAP_ESCROW", amountCents, description: `PayShap to ${creditorName}`, idempotencyKey: `payshap-${idempotencyKey}`, paymentMethod: "PAYSHAP" });
    const payshapRef = `PAYSHAP-${new Date().getFullYear()}-${uuidv4().slice(0, 8).toUpperCase()}`;
    await prisma.payshapTransaction.create({ data: { ahavaTransactionId: (debitResult.data?.transaction?.debit?.id as string) || uuidv4(), payshapMsgId: payshapRef, payshapEndToEndId: idempotencyKey, amountCents: BigInt(amountCents), currency: "ZAR", debtorName: "Ahava User", debtorAccountRef: senderWalletId, creditorName, creditorAccountRef, remittanceInfo: remittanceInfo || "", status: "PENDING", submittedAt: new Date(), rawRequest: JSON.stringify(req.body) } });
    const q = new Queue(QUEUE_NAMES.PAYSHAP_SETTLEMENT, { connection: redisConnection });
    await q.add("settle", { sagaId, payshapRef, creditorAccountRef, creditorName, amountCents, remittanceInfo, idempotencyKey }, { attempts: 5, backoff: { type: "exponential", delay: 10000 } });
    await q.close();
    res.status(202).json(createSuccessResponse({ sagaId, status: "PENDING", payshapRef, message: "PayShap payment submitted. Settlement in progress." }, req.id));
  } catch (error) { next(error); }
});

app.get("/orchestrate/saga/:sagaId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sagaId } = req.params;
    const keys = await redis.keys("saga:*");
    for (const key of keys) { const data = await redis.get(key); if (data) { const parsed = JSON.parse(data); if (parsed.sagaId === sagaId) return res.json(createSuccessResponse(parsed, req.id)); } }
    throw new AhavaError(AhavaErrorCode.INTERNAL_NOT_IMPLEMENTED, "Saga not found", { requestId: req.id });
  } catch (error) { next(error); }
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) return res.status(err.statusCode).json(createErrorResponse(err));
  console.error("Unhandled error:", err);
  res.status(500).json(createErrorResponse(new AhavaError(AhavaErrorCode.INTERNAL_SERVER_ERROR, "Internal server error", { requestId: req.id })));
});

export function startServer() {
  app.listen(PORT, () => { console.log(`✅ Payment Orchestrator on port ${PORT}`); console.log(`🎛️  Saga: http://localhost:${PORT}/orchestrate/payment`); console.log(`💳 PayShap: http://localhost:${PORT}/orchestrate/payshap`); });
}
if (require.main === module) startServer();
export default app;

declare global { namespace Express { interface Request { id?: string; } } }