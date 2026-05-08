// Sentry instrumentation - MUST be imported first in main.ts
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  // Setting this option to true will send default PII data to Sentry.
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
  // Optional: Filter out sensitive data
  beforeSend(event: Sentry.ErrorEvent) {
    // Remove sensitive headers if present
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }
    return event;
  },
});

console.log("[Sentry] Initialized for auth-service");
