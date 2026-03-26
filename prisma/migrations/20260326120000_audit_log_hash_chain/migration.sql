ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "prev_hash" CHAR(64),
  ADD COLUMN IF NOT EXISTS "record_hash" CHAR(64),
  ADD COLUMN IF NOT EXISTS "hash_version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "audit_logs_record_hash_idx" ON "audit_logs" ("record_hash");
