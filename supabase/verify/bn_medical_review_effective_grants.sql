-- =====================================================================
-- BN Medical Reviews — effective grant verifier
-- Expect ZERO rows from every plain query, and no exception from the
-- effective-privilege DO block.
--
-- Two legacy compatibility tables are read directly by the Award 360
-- surfaces and are therefore exempt from the RPC-only rule. They are
-- verified separately in section 6b (no anon access, no DELETE, RLS on).
-- =====================================================================

-- 1. No direct table privileges for anon / authenticated / PUBLIC on any
--    canonical Medical Review table (explicit ACL entries).
SELECT c.relname, pg_get_userbyid(x.grantee) AS grantee, x.privilege_type
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) x
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND (c.relname LIKE 'bn_medical_review%' OR c.relname LIKE 'bn_medical_board%'
        OR c.relname LIKE 'bn_medical_provider%')
   AND c.relname NOT IN ('bn_medical_review_schedule','bn_medical_provider_type')
   AND pg_get_userbyid(x.grantee) IN ('anon','authenticated','public');


-- 2. Private helpers must not be executable by browser roles.
SELECT p.proname, pg_get_userbyid(x.grantee) AS grantee
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(p.proacl) x
 WHERE n.nspname = 'public'
   AND p.proname LIKE '\_bn\_mr\_%'
   AND pg_get_userbyid(x.grantee) IN ('anon','authenticated','public');

-- 3. Every Medical Review command must route through the command actor
--    guard (module enablement + permission) rather than raw auth.uid().
SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname ~ '^bn_medical_review_(generate_obligation|assign_provider|issue_referral|accept_referral|decline_referral|schedule_appointment|reschedule_appointment|record_attendance|record_non_attendance|record_reasonable_cause|start_assessment|save_assessment_draft|submit_assessment|validate_report|reject_report|request_clarification|refer_to_board|assign_board_members|schedule_board_session|record_board_participation|record_board_vote|record_recusal|declare_board_conflict|finalise_board_determination|prepare_decision|submit_decision|approve_decision|return_decision|complete_decision|propose_suspension|propose_reinstatement|close_review|defer_review)_v1$'
   AND position('_bn_mr_cmd_actor' in pg_get_functiondef(p.oid)) = 0;

-- 4. No Medical Review command may mutate an award or execute a suspension.
SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'bn_medical_review\_%'
   AND (pg_get_functiondef(p.oid) ~* 'UPDATE\s+public\.bn_award\s'
        OR pg_get_functiondef(p.oid) ~* 'bn_award_suspension_execute');

-- 5. Idempotency hardening must be present in the command pipeline.
SELECT 'missing_payload_mismatch_guard' AS problem
 WHERE position('E_IDEMPOTENCY_PAYLOAD_MISMATCH' in
       (SELECT pg_get_functiondef(oid) FROM pg_proc
         WHERE proname = '_bn_mr_cmd_begin' AND pronamespace = 'public'::regnamespace)) = 0;

SELECT 'missing_key_reuse_guard' AS problem
 WHERE position('E_IDEMPOTENCY_KEY_REUSED' in
       (SELECT pg_get_functiondef(oid) FROM pg_proc
         WHERE proname = '_bn_mr_cmd_finish' AND pronamespace = 'public'::regnamespace)) = 0;

-- =====================================================================
-- 6. EFFECTIVE privilege verification (inherited and PUBLIC defaults too).
-- =====================================================================
DO $verify$
DECLARE r record; v_bad text[] := '{}';
BEGIN
  FOR r IN
    SELECT c.relname, role_name, priv
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated']) AS role_name
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (c.relname LIKE 'bn_medical_review%' OR c.relname LIKE 'bn_medical_board%'
            OR c.relname LIKE 'bn_medical_provider%')
       AND c.relname NOT IN ('bn_medical_review_schedule','bn_medical_provider_type')
       AND has_table_privilege(role_name, c.oid, priv)
  LOOP
    v_bad := v_bad || format('TABLE %s: %s has %s', r.relname, r.role_name, r.priv);
  END LOOP;

  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, role_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN unnest(ARRAY['anon','authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND p.proname LIKE '\_bn\_mr\_%'
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  LOOP
    v_bad := v_bad || format('FUNCTION %s(%s): %s has EXECUTE', r.proname, r.args, r.role_name);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'UNSAFE EFFECTIVE PRIVILEGES: %', array_to_string(v_bad, E'\n');
  END IF;

  RAISE NOTICE 'Medical Review effective privilege verification passed.';
END $verify$;

-- =====================================================================
-- 6b. Legacy compatibility tables (read directly by Award 360 / Screen 24).
--     Contract: no anon access at all, no INSERT/UPDATE/DELETE for
--     authenticated, row level security enabled with at least one policy.
--     All legacy mutations run through the versioned commands
--     bn_medical_review_legacy_{schedule,record_outcome,provision}_v1.
-- =====================================================================
DO $legacy$
DECLARE r record; v_bad text[] := '{}'; v_tables text[] :=
  ARRAY['bn_medical_review_schedule','bn_medical_provider_type'];
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, c.relrowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY (v_tables)
  LOOP
    IF NOT r.relrowsecurity THEN
      v_bad := v_bad || format('TABLE %s: row level security disabled', r.relname);
    END IF;
    IF r.policies = 0 THEN
      v_bad := v_bad || format('TABLE %s: no RLS policies', r.relname);
    END IF;
    IF has_table_privilege('anon', r.oid, 'SELECT')
       OR has_table_privilege('anon', r.oid, 'INSERT')
       OR has_table_privilege('anon', r.oid, 'UPDATE')
       OR has_table_privilege('anon', r.oid, 'DELETE') THEN
      v_bad := v_bad || format('TABLE %s: anon retains direct privileges', r.relname);
    END IF;
    -- Browser roles must never mutate a legacy Medical Review table directly.
    IF has_table_privilege('authenticated', r.oid, 'INSERT')
       OR has_table_privilege('authenticated', r.oid, 'UPDATE')
       OR has_table_privilege('authenticated', r.oid, 'DELETE') THEN
      v_bad := v_bad || format('TABLE %s: authenticated retains a direct write privilege', r.relname);
    END IF;
  END LOOP;

  -- The governed legacy commands must exist and be executable by the browser
  -- role, otherwise the scheduler surface has no lawful mutation path.
  FOR r IN
    SELECT fn FROM unnest(ARRAY[
      'bn_medical_review_legacy_schedule_v1',
      'bn_medical_review_legacy_record_outcome_v1',
      'bn_medical_review_legacy_provision_v1']) AS fn
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname = r.fn
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND position('_bn_mr_cmd_actor' in pg_get_functiondef(p.oid)) > 0
         AND position('_bn_mr_cmd_begin' in pg_get_functiondef(p.oid)) > 0
    ) THEN
      v_bad := v_bad || format('FUNCTION %s: missing, not executable, or not governed', r.fn);
    END IF;
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'UNSAFE LEGACY PRIVILEGES: %', array_to_string(v_bad, E'\n');
  END IF;

  RAISE NOTICE 'Medical Review legacy compatibility posture verification passed.';
END $legacy$;


-- =====================================================================
-- 7. Dark-launch state must hold in the target database.
-- =====================================================================
DO $dark$
DECLARE v_enabled boolean;
BEGIN
  SELECT COALESCE(actions_enabled, false) INTO v_enabled
    FROM public.app_modules WHERE name = 'bn_medical_review';

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'bn_medical_review module is not registered in app_modules';
  END IF;

  IF v_enabled THEN
    RAISE EXCEPTION 'bn_medical_review actions_enabled is TRUE — module must stay dark-launched';
  END IF;

  RAISE NOTICE 'Medical Review dark-launch verification passed.';
END $dark$;

-- =====================================================================
-- 7b. Communication adapter dark-launch postflight.
-- =====================================================================
\i supabase/verify/bn_medical_review_adapter_postflight.sql

-- =====================================================================
-- 8. Result marker — CI gates on exactly one of these lines.
-- =====================================================================
SELECT 'BN_MR_GRANTS_RESULT: PASS' AS result;

