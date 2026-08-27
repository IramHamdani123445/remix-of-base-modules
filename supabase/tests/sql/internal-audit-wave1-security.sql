-- ============================================================================
-- Internal Audit — Wave 1 Trust & Security Regression Suite
-- ----------------------------------------------------------------------------
-- Repeatable assertions that protect the Wave 1 security foundation.
-- Run with a privileged (service_role / owner) connection:
--     psql "$SUPABASE_DB_URL" -f supabase/tests/sql/internal-audit-wave1-security.sql
--
-- Every assertion RAISES EXCEPTION on failure, so a non-zero psql exit code
-- means the Internal Audit security posture has regressed.
--
-- Companion runtime test (unauthenticated Data API): 
--     scripts/internal-audit/wave1-anon-pentest.sh
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_count integer;
  v_detail text;
BEGIN
  -- --------------------------------------------------------------------------
  -- ASSERTION 1 — GAP-21: no anon / PUBLIC table grants anywhere in ia_*
  -- --------------------------------------------------------------------------
  SELECT count(*), coalesce(string_agg(DISTINCT table_name || ':' || grantee, ', '), '')
    INTO v_count, v_detail
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name LIKE 'ia\_%'
    AND grantee IN ('anon', 'PUBLIC');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'WAVE1-A1 FAILED: % anonymous/PUBLIC table grants remain on ia_* (%)', v_count, v_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 2 — RLS enabled on every ia_* table
  -- --------------------------------------------------------------------------
  SELECT count(*), coalesce(string_agg(c.relname, ', '), '')
    INTO v_count, v_detail
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname LIKE 'ia\_%'
    AND c.relrowsecurity = false;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'WAVE1-A2 FAILED: RLS disabled on % ia_* table(s): %', v_count, v_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 3 — every RLS-enabled ia_* table carries at least one policy
  --               (RLS with zero policies silently denies everything)
  -- --------------------------------------------------------------------------
  SELECT count(*), coalesce(string_agg(c.relname, ', '), '')
    INTO v_count, v_detail
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname LIKE 'ia\_%'
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'WAVE1-A3 FAILED: % ia_* table(s) have RLS but no policy: %', v_count, v_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 4 — no ia_* routine is executable by anon or PUBLIC
  -- --------------------------------------------------------------------------
  SELECT count(*), coalesce(string_agg(DISTINCT routine_name || ':' || grantee, ', '), '')
    INTO v_count, v_detail
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name LIKE 'ia\_%'
    AND grantee IN ('anon', 'PUBLIC');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'WAVE1-A4 FAILED: % anonymous/PUBLIC execute grant(s) remain on ia_* routines (%)', v_count, v_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 5 — every SECURITY DEFINER ia_* routine pins search_path
  -- --------------------------------------------------------------------------
  SELECT count(*), coalesce(string_agg(p.proname, ', '), '')
    INTO v_count, v_detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'ia\_%'
    AND p.prosecdef
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
      WHERE cfg LIKE 'search_path=%'
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'WAVE1-A5 FAILED: % SECURITY DEFINER ia_* routine(s) without a pinned search_path: %', v_count, v_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 6 — evidence/artifact storage buckets are private
  -- --------------------------------------------------------------------------
  SELECT count(*), coalesce(string_agg(id, ', '), '')
    INTO v_count, v_detail
  FROM storage.buckets
  WHERE id IN ('ia-artifacts', 'ia-evidence', 'audit-attachments')
    AND public = true;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'WAVE1-A6 FAILED: audit storage bucket(s) are public: %', v_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 7 — immutable audit event store exists and is protected
  -- --------------------------------------------------------------------------
  IF to_regclass('public.ia_audit_event') IS NULL THEN
    RAISE EXCEPTION 'WAVE1-A7 FAILED: ia_audit_event (immutable event store) is missing';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.ia_audit_event'::regclass
    AND NOT t.tgisinternal;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'WAVE1-A7 FAILED: ia_audit_event has no immutability trigger';
  END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'ia_audit_event'
    AND grantee = 'authenticated'
    AND privilege_type IN ('UPDATE', 'DELETE');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'WAVE1-A7 FAILED: ia_audit_event is mutable by authenticated users';
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 8 — ADR-01: the legacy spine rejects new writes
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.ia_department_audits'::regclass
    AND NOT t.tgisinternal;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'WAVE1-A8 FAILED: legacy ia_department_audits accepts new writes (ADR-01 breach)';
  END IF;

  -- --------------------------------------------------------------------------
  -- ASSERTION 9 — canonical identity/scope helpers exist
  -- --------------------------------------------------------------------------
  FOREACH v_detail IN ARRAY ARRAY[
    'ia_current_profile_id', 'ia_is_ia_user', 'ia_can_read_all', 'ia_can_access_engagement'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_detail
    ) THEN
      RAISE EXCEPTION 'WAVE1-A9 FAILED: canonical helper public.%() is missing', v_detail;
    END IF;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- ASSERTION 10 — the explicit full-read capability is registered
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_modules m
    JOIN public.module_actions a ON a.module_id = m.id
    WHERE m.name = 'internal_audit' AND a.action_name = 'view_all'
  ) THEN
    RAISE EXCEPTION 'WAVE1-A10 FAILED: internal_audit:view_all capability is not registered';
  END IF;

  RAISE NOTICE 'INTERNAL AUDIT WAVE 1 SECURITY SUITE: ALL 10 ASSERTIONS PASSED';
END;
$$;
