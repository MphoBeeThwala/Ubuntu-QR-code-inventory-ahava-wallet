CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; % is not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_block_update_delete ON public.audit_logs;

CREATE TRIGGER audit_logs_block_update_delete
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_log_mutation();
