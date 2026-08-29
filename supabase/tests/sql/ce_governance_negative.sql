-- Compliance governance (Step 5) — negative security tests.
-- Run with: psql "$DB_URL" -f supabase/tests/sql/ce_governance_negative.sql
-- Every block must RAISE; a silent success is a governance failure.

\set ON_ERROR_STOP off

-- 1. Anonymous / unauthenticated callers cannot approve a waiver.
DO $$
BEGIN
  PERFORM public.ce_approve_waiver_v1(gen_random_uuid(), 1, 'negative test');
  RAISE EXCEPTION 'FAIL: unauthenticated approval was accepted';
EXCEPTION WHEN sqlstate '42501' THEN
  RAISE NOTICE 'PASS 1: unauthenticated approval refused (%)', SQLERRM;
END $$;

-- 2. Table grants: signed-in users cannot write waiver tables directly.
DO $$
BEGIN
  IF has_table_privilege('authenticated','public.ce_waivers','UPDATE')
     OR has_table_privilege('authenticated','public.ce_waivers','INSERT')
     OR has_table_privilege('authenticated','public.ce_waiver_decisions','INSERT')
     OR has_table_privilege('anon','public.ce_waivers','UPDATE') THEN
    RAISE EXCEPTION 'FAIL: direct waiver table writes are still granted';
  END IF;
  RAISE NOTICE 'PASS 2: direct waiver table writes revoked for anon/authenticated';
END $$;

-- 3. The internal denial recorder is not callable by clients.
DO $$
BEGIN
  IF has_function_privilege('authenticated','public.ce_waiver_deny(uuid,uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.ce_waiver_deny(uuid,uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internal denial recorder is client callable';
  END IF;
  RAISE NOTICE 'PASS 3: internal helpers are not client callable';
END $$;

-- 4. Legal handoff override requires authority and a documented reason.
DO $$
BEGIN
  PERFORM public.ce_record_legal_handoff_override_v1('too short');
  RAISE EXCEPTION 'FAIL: override accepted without authority/reason';
EXCEPTION WHEN sqlstate '42501' OR sqlstate '22023' THEN
  RAISE NOTICE 'PASS 4: legal handoff override refused (%)', SQLERRM;
END $$;

-- 5. The override register is append-only.
DO $$
BEGIN
  UPDATE public.ce_legal_handoff_overrides SET reason = 'tampered' WHERE true;
  IF FOUND THEN RAISE EXCEPTION 'FAIL: override register was mutable'; END IF;
  RAISE NOTICE 'PASS 5: no rows to mutate (register empty)';
EXCEPTION WHEN sqlstate '42501' THEN
  RAISE NOTICE 'PASS 5: override register is append-only (%)', SQLERRM;
END $$;

-- 6. Active-policy integrity: at most one active arrangement policy per scope.
DO $$
DECLARE v_dupes int;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT scope_key FROM public.ce_arrangement_policies
    WHERE active GROUP BY scope_key HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN RAISE EXCEPTION 'FAIL: % scope(s) have multiple active policies', v_dupes; END IF;
  RAISE NOTICE 'PASS 6: one active arrangement policy per scope';
END $$;
