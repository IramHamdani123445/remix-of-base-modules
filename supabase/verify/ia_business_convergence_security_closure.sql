-- Internal Audit — Business Convergence Security Closure
-- Executable regression against the live catalogue.
--   1. ia_prior_action_reference is unreachable by anon/authenticated (governed RPCs only).
--   2. All three portfolio read models are capability-gated on ia_can_view_annual_plan.
--   3. The portfolio logic lives in private *_core helpers not callable by clients.
--   4. Permission reconciliation classifies OVER-BROAD grants from an explicit policy.
DO $$
DECLARE
  v_acl text;
  v_src text;
  r record;
BEGIN
  SELECT coalesce(array_to_string(c.relacl, ' '), '') INTO v_acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'ia_prior_action_reference';

  IF v_acl ~ '(^|\s)(authenticated|anon)=' THEN
    RAISE EXCEPTION 'ia_prior_action_reference is directly reachable by clients: %', v_acl;
  END IF;

  FOR r IN
    SELECT p.proname, p.prosrc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('ia_annual_plan_portfolio_summary',
                        'ia_annual_plan_coverage',
                        'ia_annual_plan_version_diff')
  LOOP
    IF position('ia_can_view_annual_plan' in r.prosrc) = 0 THEN
      RAISE EXCEPTION '% is not capability-gated', r.proname;
    END IF;
    IF position('_core(' in r.prosrc) = 0 THEN
      RAISE EXCEPTION '% does not delegate to its governed core', r.proname;
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.proname, coalesce(array_to_string(p.proacl, ' '), '') acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('ia_annual_plan_portfolio_summary_core',
                        'ia_annual_plan_coverage_core',
                        'ia_annual_plan_version_diff_core',
                        'ia_sensitive_capability_policy')
  LOOP
    IF r.acl ~ '(^|\s)(authenticated|anon)=' OR r.acl = '' THEN
      RAISE EXCEPTION 'private helper % is client-executable: %', r.proname, r.acl;
    END IF;
  END LOOP;

  SELECT prosrc INTO v_src FROM pg_proc
  WHERE proname = 'ia_permission_reconciliation';
  IF v_src IS NULL OR position('OVER-BROAD' in v_src) = 0
     OR position('ia_sensitive_capability_policy' in v_src) = 0 THEN
    RAISE EXCEPTION 'permission reconciliation does not classify OVER-BROAD from the policy';
  END IF;

  RAISE NOTICE 'ia_business_convergence_security_closure: PASSED';
END $$;
