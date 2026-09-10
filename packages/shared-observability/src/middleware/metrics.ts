import { Request, Response, NextFunction } from "express";
import client from "prom-client";

export const register = new client.Registry();

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "code", "service"],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route", "code", "service"],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10],
});

export const transactionSuccessTotal = new client.Counter({
  name: "transaction_success_total",
  help: "Successful transactions",
  labelNames: ["type", "service"],
});

export const transactionFailuresTotal = new client.Counter({
  name: "transaction_failures_total",
  help: "Failed transactions",
  labelNames: ["type", "reason", "service"],
});

export const ledgerDebitAmountCents = new client.Gauge({
  name: "ledger_debit_amount_cents",
  help: "Total debit amount in BIGINT cents",
  labelNames: ["service"],
});

export const ledgerCreditAmountCents = new client.Gauge({
  name: "ledger_credit_amount_cents",
  help: "Total credit amount in BIGINT cents",
  labelNames: ["service"],
});

client.collectDefaultMetrics({ register });

export function metricsMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const duration = Number(process.hrtime.bigint() - start) / 1e9;
      const method = req.method;
      const route = req.route?.path || req.path;
      const statusCode = res.statusCode.toString();
      httpRequestsTotal.labels(method, route, statusCode, serviceName).inc();
      httpRequestDurationSeconds.labels(method, route, statusCode, serviceName).observe(duration);
    });
    next();
  };
}

export function metricsEndpoint(req: Request, res: Response) {
  res.set("Content-Type", register.contentType);
  res.end(register.metrics());
}

export function healthCheckEndpoint(serviceName: string) {
  return (req: Request, res: Response) => {
    res.json({
      status: "healthy",
      service: serviceName,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  };
}