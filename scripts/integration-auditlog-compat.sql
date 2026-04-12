ALTER TABLE "public"."audit_logs"
  ADD COLUMN IF NOT EXISTS "entityType" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "entityId" UUID,
  ADD COLUMN IF NOT EXISTS "previousState" TEXT,
  ADD COLUMN IF NOT EXISTS "newState" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceId" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "correlationId" VARCHAR(36);

ALTER TABLE "public"."audit_logs"
  ALTER COLUMN "resource" DROP NOT NULL,
  ALTER COLUMN "outcome" DROP NOT NULL,
  ALTER COLUMN "serviceId" SET DEFAULT 'integration-service',
  ALTER COLUMN "serviceId" SET NOT NULL;
