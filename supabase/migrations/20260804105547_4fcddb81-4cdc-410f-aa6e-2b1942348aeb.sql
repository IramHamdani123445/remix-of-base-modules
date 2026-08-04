-- BN Phase 1 security hardening: revoke unrestricted free-form SQL execution
-- from browser-reachable roles. Backend (service_role) retains access so the
-- existing create-missing-table edge function keeps working.

REVOKE ALL ON FUNCTION public.bn_run_select(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_run_select(text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_execute_ddl(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_execute_ddl(text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_bulk_insert_jsonb(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_insert_jsonb(text, jsonb) TO service_role;