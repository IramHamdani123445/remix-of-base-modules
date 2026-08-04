-- BN Phase 0 security closure (part 2): complete the privileged-function
-- grant remediation. The browser-driven cross-environment table-creation
-- utility has been retired, so these helper functions must no longer be
-- executable by browser-reachable roles.
--
-- Forward-only. Historical migrations are not edited.

-- Creates arbitrary enum types in the public schema (schema mutation).
REVOKE ALL ON FUNCTION public.admin_create_enum_if_not_exists(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_enum_if_not_exists(text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.admin_create_enum_if_not_exists(text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_enum_if_not_exists(text, text[]) TO service_role;

-- Returns unrestricted structural metadata for ANY table name supplied by the
-- caller (columns, defaults, keys, enum definitions). Not harmless: it is a
-- schema-reconnaissance surface. Backend-only from now on.
REVOKE ALL ON FUNCTION public.get_table_ddl_info(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_table_ddl_info(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_table_ddl_info(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_table_ddl_info(text) TO service_role;

-- Re-assert the earlier revocations idempotently so the boundary is provable
-- from a single forward migration.
REVOKE ALL ON FUNCTION public.bn_run_select(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_run_select(text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_execute_ddl(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_execute_ddl(text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_bulk_insert_jsonb(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_insert_jsonb(text, jsonb) TO service_role;