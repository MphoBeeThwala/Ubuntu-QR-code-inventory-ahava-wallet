-- Enforce audit_logs immutability at the database level.
--
-- audit_logs is a tamper-evident, hash-chained ledger (see the
-- 20260326120000_audit_log_hash_chain migration and writeAuditLog() in
-- packages/shared-audit/src/index.ts): every row's record_hash covers its
-- own fields plus the previous row's record_hash, so altering or removing
-- a row breaks the chain for every row after it. That only makes tampering
-- *detectable* after the fact, though — nothing previously stopped a bug,
-- a future migration, or a compromised credential from directly mutating
-- or deleting rows in the table (20260412012000_audit_logs_append_only was
-- a placeholder that never actually added this). Application code only
-- ever INSERTs into audit_logs (confirmed: no .update(), .upsert(), or
-- .delete() call against auditLog anywhere in the codebase), so blocking
-- UPDATE and DELETE outright costs nothing at the application layer.

CREATE OR REPLACE FUNCTION audit_logs_prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted (id = %)', TG_OP, OLD.id
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs";
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_prevent_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON "audit_logs";
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_prevent_mutation();
