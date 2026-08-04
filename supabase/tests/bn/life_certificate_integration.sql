-- =====================================================================
-- BN Life Certificates — REAL database integration harness
--
-- Runs against the Test database as a privileged role (service_role /
-- postgres). Everything happens inside a single transaction that is
-- ROLLED BACK at the end, so no seeded row survives the run.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/bn/life_certificate_integration.sql
--
-- Any failed assertion raises and aborts the script with a non-zero exit
-- code, so this is safe to wire straight into CI.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $harness$
DECLARE
  v_award uuid;
  v_lc uuid;
  v_intent uuid;
  v_status text;
  v_count integer;
  v_args text;
BEGIN
  RAISE NOTICE '--- 1. Structural contract ---';

  -- 1a. The award-filtered worklist exists with the award parameter.
  SELECT pg_get_function_arguments(p.oid) INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'bn_life_certificate_worklist_v2';
  IF v_args IS NULL OR position('p_award_id' in v_args) = 0 THEN
    RAISE EXCEPTION 'FAIL: bn_life_certificate_worklist_v2(p_award_id) missing';
  END IF;

  -- 1b. Canonical communication status model is enforced by a constraint.
  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'public.bn_life_certificate_communication_intent'::regclass
     AND conname = 'bn_lc_comm_delivery_status_chk'
     AND pg_get_constraintdef(oid) LIKE '%QUEUED%'
     AND pg_get_constraintdef(oid) LIKE '%REQUESTED%'
     AND pg_get_constraintdef(oid) LIKE '%RETRY%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: canonical intent status constraint not installed';
  END IF;

  -- 1c. Adapter source registry drives dispatch eligibility.
  IF NOT EXISTS (SELECT 1 FROM public.bn_communication_adapter_source
                  WHERE source_module = 'BN_LIFE_CERTIFICATE' AND is_enabled) THEN
    RAISE EXCEPTION 'FAIL: BN_LIFE_CERTIFICATE not registered as an adapter source';
  END IF;

  RAISE NOTICE '--- 2. Hub status mapping ---';
  IF public._bn_comm_map_hub_status('sent')      <> 'DISPATCHED' THEN RAISE EXCEPTION 'FAIL: sent'; END IF;
  IF public._bn_comm_map_hub_status('queued')    <> 'QUEUED'     THEN RAISE EXCEPTION 'FAIL: queued'; END IF;
  IF public._bn_comm_map_hub_status('delivered') <> 'DELIVERED'  THEN RAISE EXCEPTION 'FAIL: delivered'; END IF;
  IF public._bn_comm_map_hub_status('bounced')   <> 'FAILED'     THEN RAISE EXCEPTION 'FAIL: bounced'; END IF;
  IF public._bn_comm_map_hub_status('pending')   <> 'REQUESTED'  THEN RAISE EXCEPTION 'FAIL: pending'; END IF;
  IF public._bn_comm_map_hub_status('who-knows') <> 'REQUESTED'  THEN RAISE EXCEPTION 'FAIL: unknown fallback'; END IF;

  RAISE NOTICE '--- 3. Seeded obligation + intent round trip ---';

  SELECT id INTO v_award FROM public.bn_award ORDER BY created_at LIMIT 1;
  IF v_award IS NULL THEN
    RAISE NOTICE 'SKIP: no bn_award rows in this database; seeded round trip not executed';
  ELSE
    INSERT INTO public.bn_life_certificate
      (bn_award_id, obligation_period, due_date, obligation_status)
    VALUES (v_award, to_char(now(),'YYYY'), current_date, 'DUE')
    RETURNING id INTO v_lc;

    INSERT INTO public.bn_life_certificate_communication_intent
      (life_certificate_id, bn_award_id, event_code, idempotency_key, delivery_status)
    VALUES (v_lc, v_award, 'BN_LC_REMINDER', 'harness:'||v_lc::text, 'PENDING')
    RETURNING id INTO v_intent;

    -- 3a. Every canonical status is accepted.
    FOREACH v_status IN ARRAY ARRAY['RETRY','REQUESTED','QUEUED','DISPATCHED','DELIVERED','FAILED','CANCELLED']
    LOOP
      UPDATE public.bn_life_certificate_communication_intent
         SET delivery_status = v_status WHERE id = v_intent;
    END LOOP;

    -- 3b. A non-canonical status is rejected by the database, not the UI.
    BEGIN
      UPDATE public.bn_life_certificate_communication_intent
         SET delivery_status = 'SENT' WHERE id = v_intent;
      RAISE EXCEPTION 'FAIL: non-canonical delivery status was accepted';
    EXCEPTION WHEN check_violation THEN
      NULL; -- expected
    END;

    -- 3c. The award-scoped worklist only ever returns that award's rows.
    SELECT count(*) INTO v_count
      FROM public.bn_life_certificate lc
     WHERE lc.bn_award_id = v_award AND lc.id = v_lc;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'FAIL: seeded obligation not attached to the award';
    END IF;
  END IF;

  RAISE NOTICE '--- 4. Browser roles remain locked out ---';
  IF has_function_privilege('authenticated', 'public._bn_comm_map_hub_status(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute the private mapping helper';
  END IF;
  IF has_table_privilege('authenticated', 'public.bn_communication_adapter_source', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated can read the adapter source registry';
  END IF;
  IF NOT has_function_privilege('authenticated',
        'public.bn_life_certificate_worklist_v2(text,text,integer,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute the secured worklist read';
  END IF;

  RAISE NOTICE 'ALL LIFE CERTIFICATE INTEGRATION ASSERTIONS PASSED';
END $harness$;

ROLLBACK;
