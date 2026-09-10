-- kyc-service sends { channel: "IN_APP" } to POST /notifications/send for
-- KYC status notifications, and notification-service's dispatch worker has
-- a working IN_APP case (no external delivery, just marks the row sent),
-- but "IN_APP" was never actually a value of the NotificationChannel enum
-- these rows are stored with — every such call was failing at
-- prisma.notification.create() with a Postgres enum-validation error.
ALTER TYPE "public"."NotificationChannel" ADD VALUE IF NOT EXISTS 'IN_APP';
