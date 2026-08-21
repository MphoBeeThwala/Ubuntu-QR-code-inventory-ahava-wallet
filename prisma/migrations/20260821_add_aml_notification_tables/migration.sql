-- Migration for BATCH 8: AML/Notification Queues
-- Generated on 2026-08-21

-- ============================================================================
-- AML TABLES
-- ============================================================================

CREATE TABLE "AmlCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checksPerformed" JSONB NOT NULL,
    "flags" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE INDEX "AmlCheck_userId_idx" ON "AmlCheck"("userId");
CREATE INDEX "AmlCheck_transactionId_idx" ON "AmlCheck"("transactionId");
CREATE INDEX "AmlCheck_riskLevel_idx" ON "AmlCheck"("riskLevel");
CREATE INDEX "AmlCheck_status_idx" ON "AmlCheck"("status");
CREATE INDEX "AmlCheck_createdAt_idx" ON "AmlCheck"("createdAt");

CREATE TABLE "AmlCheckStep" (
    "id" TEXT NOT NULL,
    "amlCheckId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "details" JSONB,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE INDEX "AmlCheckStep_amlCheckId_idx" ON "AmlCheckStep"("amlCheckId");
CREATE INDEX "AmlCheckStep_checkType_idx" ON "AmlCheckStep"("checkType");
CREATE INDEX "AmlCheckStep_severity_idx" ON "AmlCheckStep"("severity");
ALTER TABLE "AmlCheckStep" ADD CONSTRAINT "AmlCheckStep_amlCheckId_fkey" FOREIGN KEY ("amlCheckId") REFERENCES "AmlCheck"("id") ON DELETE CASCADE;

CREATE TABLE "AmlWatchlist" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "details" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmlWatchlist_entityType_entityId_key" ON "AmlWatchlist"("entityType", "entityId");
CREATE INDEX "AmlWatchlist_entityType_idx" ON "AmlWatchlist"("entityType");
CREATE INDEX "AmlWatchlist_type_idx" ON "AmlWatchlist"("type");
CREATE INDEX "AmlWatchlist_isActive_idx" ON "AmlWatchlist"("isActive");

CREATE TABLE "AmlWatchlistMatch" (
    "id" TEXT NOT NULL,
    "amlCheckId" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE INDEX "AmlWatchlistMatch_amlCheckId_idx" ON "AmlWatchlistMatch"("amlCheckId");
CREATE INDEX "AmlWatchlistMatch_watchlistId_idx" ON "AmlWatchlistMatch"("watchlistId");
CREATE INDEX "AmlWatchlistMatch_entityType_entityId_idx" ON "AmlWatchlistMatch"("entityType", "entityId");
ALTER TABLE "AmlWatchlistMatch" ADD CONSTRAINT "AmlWatchlistMatch_amlCheckId_fkey" FOREIGN KEY ("amlCheckId") REFERENCES "AmlCheck"("id") ON DELETE CASCADE;
ALTER TABLE "AmlWatchlistMatch" ADD CONSTRAINT "AmlWatchlistMatch_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "AmlWatchlist"("id");

-- ============================================================================
-- NOTIFICATION TABLES
-- ============================================================================

CREATE TABLE "NotificationQueue" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ,
    "scheduledAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationQueue_notificationId_key" ON "NotificationQueue"("notificationId");
CREATE INDEX "NotificationQueue_userId_idx" ON "NotificationQueue"("userId");
CREATE INDEX "NotificationQueue_type_idx" ON "NotificationQueue"("type");
CREATE INDEX "NotificationQueue_priority_idx" ON "NotificationQueue"("priority");
CREATE INDEX "NotificationQueue_status_idx" ON "NotificationQueue"("status");
CREATE INDEX "NotificationQueue_channel_idx" ON "NotificationQueue"("channel");
CREATE INDEX "NotificationQueue_scheduledAt_idx" ON "NotificationQueue"("scheduledAt");
CREATE INDEX "NotificationQueue_createdAt_idx" ON "NotificationQueue"("createdAt");

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX "Notification_type_idx" ON "Notification"("type");
CREATE INDEX "Notification_channel_idx" ON "Notification"("channel");
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
ALTER TABLE "NotificationQueue" ADD CONSTRAINT "NotificationQueue_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id");

CREATE TABLE "NotificationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "queueId" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "responseCode" INTEGER,
    "responseMessage" TEXT,
    "errorDetails" JSONB,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,
    PRIMARY KEY ("id")
);

CREATE INDEX "NotificationDeliveryAttempt_notificationId_idx" ON "NotificationDeliveryAttempt"("notificationId");
CREATE INDEX "NotificationDeliveryAttempt_queueId_idx" ON "NotificationDeliveryAttempt"("queueId");
CREATE INDEX "NotificationDeliveryAttempt_status_idx" ON "NotificationDeliveryAttempt"("status");
CREATE INDEX "NotificationDeliveryAttempt_startedAt_idx" ON "NotificationDeliveryAttempt"("startedAt");
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE;
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "NotificationQueue"("id") ON DELETE CASCADE;
