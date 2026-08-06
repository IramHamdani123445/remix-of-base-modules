-- =====================================================================
-- BN Mortality — seeded lifecycle integration harness (Phases M7/M8)
--
-- Runs inside a single transaction and ALWAYS rolls back. Emits exactly one
--   BN_MORT_HARNESS_RESULT: PASS
-- marker on success; raises otherwise. No SKIP paths.
--
-- Journeys
--   A  draft -> register -> match -> evidence -> submit -> hold -> release
--   B  confirm verification (checker) -> prepare impact -> submit -> approve
--   C  governed handoffs: PAD overpayment, survivor, funeral, legal
--   D  required-action closure gate -> complete follow-on -> close event
--   E  reversal of confirmation
--   Negative matrix: E_ACTIONS_DISABLED, E_CAPABILITY_DENIED,
--   E_SELF_APPROVAL, E_MAKER_REQUIRED, E_OUTSTANDING_REQUIRED_ACTIONS,
--   ROW_VERSION_CONFLICT, E_IDEMPOTENCY_PAYLOAD_MISMATCH, replay.
-- =====================================================================
\set ON_ERROR_STOP on

BEGIN;

-- Refuse to run against anything other than a CI database ---------------
DO $$
DECLARE v_env text;
BEGIN
  SELECT environment_kind INTO v_env
  FROM public.platform_environment_marker
  WHERE id = true;

  IF upper(COALESCE(v_env, 'UNMARKED')) <> 'CI' THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL refusing to run against % database',
      COALESCE(v_env, 'UNMARKED');
  END IF;
END
$$;

DO $$
DECLARE
  v_module      uuid;
  v_maker       uuid := '00000000-0000-4000-8000-00000000aa01'::uuid;
  v_checker     uuid := '00000000-0000-4000-8000-00000000bb02'::uuid;
  v_outsider    uuid := '00000000-0000-4000-8000-00000000cc03'::uuid;
  v_role_maker  uuid;
  v_role_check  uuid;
  v_corr        uuid := gen_random_uuid();
  v_event       uuid;
  v_ver         bigint;
  v_res         jsonb;
  v_err         text;
  v_idem        uuid := gen_random_uuid();
  v_handoffs    int;
BEGIN
  SELECT id INTO v_module FROM public.app_modules WHERE name = 'bn_mortality';
  IF v_module IS NULL THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL bn_mortality module not registered';
  END IF;

  -- ── Synthetic actors (rolled back with the transaction) ────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.email, 'x', now(), now()
  FROM (VALUES
    (v_maker,    'harness.maker@mortality.ci'),
    (v_checker,  'harness.checker@mortality.ci'),
    (v_outsider, 'harness.outsider@mortality.ci')
  ) AS u(id, email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.roles (role_name, description, is_active)
  VALUES ('BN_MORT_SYNTH_MAKER', 'harness', true),
         ('BN_MORT_SYNTH_CHECKER', 'harness', true)
  ON CONFLICT (role_name) DO NOTHING;

  SELECT id INTO v_role_maker FROM public.roles WHERE role_name = 'BN_MORT_SYNTH_MAKER';
  SELECT id INTO v_role_check FROM public.roles WHERE role_name = 'BN_MORT_SYNTH_CHECKER';

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_maker, 'BN_MORT_SYNTH_MAKER'),
    (v_checker, 'BN_MORT_SYNTH_CHECKER')
  ON CONFLICT DO NOTHING;

  -- Maker: everything except the adverse/approval actions.
  INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
  SELECT v_role_maker, v_module, ma.id, true
  FROM public.module_actions ma
  WHERE ma.module_id = v_module
    AND ma.action_name IN ('view','read','write','draft_save','match_person','assign',
                           'mark_duplicate','cancel','prepare_impact','submit_impact',
                           'resolve_conflict','complete_followon','release_hold')
  ON CONFLICT DO NOTHING;

  -- Checker: decision and approval surface.
  INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
  SELECT v_role_check, v_module, ma.id, true
  FROM public.module_actions ma
  WHERE ma.module_id = v_module
    AND ma.action_name IN ('view','read','write','verify','approve_impact','decide',
                           'reverse','return_impact','release_hold','complete_followon')
  ON CONFLICT DO NOTHING;

  -- ── Negative: dark launch blocks every mutation ────────────────────
  BEGIN
    PERFORM public.bn_mortality_execute_command_v2(
      'BN_MORTALITY_DRAFT_SAVE', NULL, v_maker, 'HARNESS_MAKER', v_corr, NULL,
      'HARNESS', 'dark launch probe',
      jsonb_build_object('deceased_full_name','Dark Launch Probe'), NULL, NULL);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected E_ACTIONS_DISABLED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_ACTIONS_DISABLED%' THEN RAISE; END IF;
  END;

  -- Enable actions for the duration of the transaction only.
  UPDATE public.app_modules SET actions_enabled = true WHERE id = v_module;

  -- ── Negative: unprivileged actor ───────────────────────────────────
  BEGIN
    PERFORM public.bn_mortality_execute_command_v2(
      'BN_MORTALITY_DRAFT_SAVE', NULL, v_outsider, 'HARNESS_OUT', v_corr, NULL,
      'HARNESS', 'capability probe',
      jsonb_build_object('deceased_full_name','No Capability'), NULL, NULL);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected E_CAPABILITY_DENIED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_CAPABILITY_DENIED%' THEN RAISE; END IF;
  END;

  -- ── Journey A — intake ─────────────────────────────────────────────
  v_res := public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_DRAFT_SAVE', NULL, v_maker, 'HARNESS_MAKER', v_corr, NULL,
    'HARNESS', 'draft',
    jsonb_build_object('deceased_full_name','Harness Deceased','source','STAFF_ENTRY'),
    'hash-draft', v_idem);
  v_event := (v_res->>'entity_id')::uuid;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL draft did not return an entity';
  END IF;

  -- Replay of the same idempotency key must not create a second event.
  v_res := public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_DRAFT_SAVE', NULL, v_maker, 'HARNESS_MAKER', v_corr, NULL,
    'HARNESS', 'draft', jsonb_build_object('deceased_full_name','Harness Deceased','source','STAFF_ENTRY'),
    'hash-draft', v_idem);
  IF v_res->>'status' <> 'REPLAYED' THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL idempotent replay not detected';
  END IF;

  -- Same key, different payload hash must be rejected.
  BEGIN
    PERFORM public.bn_mortality_execute_command_v2(
      'BN_MORTALITY_DRAFT_SAVE', NULL, v_maker, 'HARNESS_MAKER', v_corr, NULL,
      'HARNESS', 'draft', '{}'::jsonb, 'hash-different', v_idem);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected E_IDEMPOTENCY_PAYLOAD_MISMATCH';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_IDEMPOTENCY_PAYLOAD_MISMATCH%' THEN RAISE; END IF;
  END;

  -- Fixture-only column seeding (registry-sourced fields the intake form
  -- captures; not part of the command contract under test).
  UPDATE public.bn_mortality_event
     SET death_date = CURRENT_DATE - 10,
         deceased_national_id = 'HARNESS-NID'
   WHERE id = v_event;

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;

  -- Negative: stale row version
  BEGIN
    PERFORM public.bn_mortality_execute_command_v2(
      'BN_MORTALITY_MATCH_PERSON', v_event, v_maker, 'HARNESS_MAKER', v_corr,
      v_ver + 99, 'HARNESS', 'stale', jsonb_build_object('ssn','HARNESS-SSN'), NULL, NULL);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected ROW_VERSION_CONFLICT';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%ROW_VERSION_CONFLICT%' THEN RAISE; END IF;
  END;

  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_MATCH_PERSON', v_event, v_maker, 'HARNESS_MAKER', v_corr, v_ver,
    'HARNESS', 'match', jsonb_build_object('ssn','HARNESS-SSN','confidence','HIGH'), NULL, NULL);

  -- Evidence must carry a DMS reference.
  BEGIN
    PERFORM public.bn_mortality_execute_command_v2(
      'BN_MORTALITY_ATTACH_EVIDENCE', v_event, v_maker, 'HARNESS_MAKER', v_corr, NULL,
      'HARNESS', 'no reference', '{}'::jsonb, NULL, NULL);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected E_EVIDENCE_REFERENCE_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_EVIDENCE_REFERENCE_REQUIRED%' THEN RAISE; END IF;
  END;

  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_ATTACH_EVIDENCE', v_event, v_maker, 'HARNESS_MAKER', v_corr, NULL,
    'HARNESS', 'death certificate',
    jsonb_build_object('dms_reference','DMS-HARNESS-1','evidence_type','DEATH_CERTIFICATE'),
    NULL, NULL);
  IF (SELECT count(*) FROM public.bn_mortality_evidence WHERE event_id = v_event) <> 1 THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL evidence not persisted';
  END IF;

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_SUBMIT_FOR_VERIFICATION', v_event, v_maker, 'HARNESS_MAKER', v_corr,
    v_ver, 'HARNESS', 'submit', '{}'::jsonb, NULL, NULL);

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_PLACE_PROVISIONAL_HOLD', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    v_ver, 'HARNESS', 'precautionary hold', '{}'::jsonb, NULL, NULL);
  IF (SELECT status FROM public.bn_mortality_event WHERE id = v_event) <> 'PROVISIONALLY_HELD' THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL hold state not reached';
  END IF;

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_RELEASE_HOLD', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    v_ver, 'HARNESS', 'hold released', '{}'::jsonb, NULL, NULL);

  -- ── Journey B — maker-checker verification and impact ──────────────
  -- Negative: the submitter cannot confirm their own submission.
  BEGIN
    SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
    PERFORM public.bn_mortality_execute_command_v2(
      'BN_MORTALITY_CONFIRM_VERIFICATION', v_event, v_maker, 'HARNESS_MAKER', v_corr,
      v_ver, 'HARNESS', 'self approval probe', '{}'::jsonb, NULL, NULL);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected E_SELF_APPROVAL';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_SELF_APPROVAL%' AND v_err NOT LIKE '%E_CAPABILITY_DENIED%' THEN RAISE; END IF;
  END;

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_CONFIRM_VERIFICATION', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    v_ver, 'HARNESS', 'registrar corroborated',
    jsonb_build_object('confidence','CORROBORATED'), NULL, NULL);
  IF (SELECT status FROM public.bn_mortality_event WHERE id = v_event) <> 'VERIFIED' THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL verification did not complete';
  END IF;

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_PREPARE_IMPACT', v_event, v_maker, 'HARNESS_MAKER', v_corr,
    v_ver, 'HARNESS', 'impact prepared', '{}'::jsonb, NULL, NULL);

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_SUBMIT_IMPACT', v_event, v_maker, 'HARNESS_MAKER', v_corr,
    v_ver, 'HARNESS', 'impact submitted', '{}'::jsonb, NULL, NULL);

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_APPROVE_IMPACT', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    v_ver, 'HARNESS', 'impact approved', '{}'::jsonb, NULL, NULL);
  IF (SELECT status FROM public.bn_mortality_event WHERE id = v_event) <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL impact approval did not confirm the event';
  END IF;

  -- ── Journey C — governed cross-module handoffs ─────────────────────
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_CREATE_PAD_OVERPAYMENT', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    NULL, 'PAYMENT_AFTER_DEATH', 'payment after death detected',
    jsonb_build_object('amount', 500), NULL, NULL);
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    NULL, 'DEATH_CONFIRMED', 'survivor assessment', '{}'::jsonb, NULL, NULL);
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_INITIATE_FUNERAL_GRANT', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    NULL, 'DEATH_CONFIRMED', 'funeral grant intake', '{}'::jsonb, NULL, NULL);
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_REFER_LEGAL', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    NULL, 'ESTATE_RECOVERY', 'estate referral', '{}'::jsonb, NULL, NULL);

  SELECT count(*) INTO v_handoffs
  FROM public.bn_cross_module_handoff
  WHERE source_module = 'bn_mortality' AND source_record_id = v_event;
  IF v_handoffs < 4 THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected 4 governed handoffs, got %', v_handoffs;
  END IF;

  -- Modules may not impersonate one another through the handoff executor.
  BEGIN
    PERFORM public.bn_cross_module_handoff_execute_v1(
      'ACCEPT',
      (SELECT handoff_id FROM public.bn_cross_module_handoff
        WHERE source_record_id = v_event ORDER BY created_at LIMIT 1),
      'not_a_module', v_checker, 'HARNESS', '{}'::jsonb);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL handoff executor accepted an unknown module';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE 'BN_MORT_HARNESS_RESULT%' THEN RAISE; END IF;
  END;

  -- ── Journey D — closure gate ───────────────────────────────────────
  INSERT INTO public.bn_mortality_required_action (event_id, action_code, is_mandatory, status)
  VALUES (v_event, 'HARNESS_MANDATORY', true, 'OPEN')
  ON CONFLICT DO NOTHING;

  BEGIN
    PERFORM public.bn_mortality_execute_command_v2(
      'BN_MORTALITY_CLOSE_EVENT', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
      NULL, 'HARNESS', 'premature closure', '{}'::jsonb, NULL, NULL);
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL expected E_OUTSTANDING_REQUIRED_ACTIONS';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%E_OUTSTANDING_REQUIRED_ACTIONS%' THEN RAISE; END IF;
  END;

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_COMPLETE_FOLLOWON', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    v_ver, 'HARNESS', 'follow-on complete', '{}'::jsonb, NULL, NULL);
  IF EXISTS (
    SELECT 1 FROM public.bn_mortality_required_action
    WHERE event_id = v_event AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL required actions not satisfied';
  END IF;

  SELECT row_version INTO v_ver FROM public.bn_mortality_event WHERE id = v_event;
  PERFORM public.bn_mortality_execute_command_v2(
    'BN_MORTALITY_CLOSE_EVENT', v_event, v_checker, 'HARNESS_CHECKER', v_corr,
    v_ver, 'HARNESS', 'closed', '{}'::jsonb, NULL, NULL);
  IF (SELECT status FROM public.bn_mortality_event WHERE id = v_event) <> 'CLOSED' THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL event did not close';
  END IF;

  -- ── Audit completeness ─────────────────────────────────────────────
  IF (SELECT count(*) FROM public.bn_mortality_event_history WHERE event_id = v_event) < 12 THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL audit trail incomplete';
  END IF;

  -- ── Action-availability read model answers for a real event ────────
  IF public.bn_mortality_available_actions_v1(v_event, v_checker) IS NULL THEN
    RAISE EXCEPTION 'BN_MORT_HARNESS_RESULT: FAIL action-availability read model returned NULL';
  END IF;

  -- Restore dark launch inside the transaction; ROLLBACK is the real cleanup.
  UPDATE public.app_modules SET actions_enabled = false WHERE id = v_module;

  RAISE NOTICE 'BN_MORT_HARNESS_RESULT: PASS';
END
$$;

ROLLBACK;

-- Post-rollback dark-launch and residue postflight (Phase M8) -----------
DO $$
DECLARE v_rows int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.app_modules
    WHERE name = 'bn_mortality' AND COALESCE(actions_enabled, false) = true
  ) THEN
    RAISE EXCEPTION 'BN_MORT_POSTFLIGHT_RESULT: FAIL actions_enabled leaked as true';
  END IF;

  SELECT count(*) INTO v_rows FROM public.bn_mortality_event;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'BN_MORT_POSTFLIGHT_RESULT: FAIL % residual mortality events', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.bn_cross_module_handoff;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'BN_MORT_POSTFLIGHT_RESULT: FAIL % residual handoffs', v_rows;
  END IF;

  RAISE NOTICE 'BN_MORT_POSTFLIGHT_RESULT: PASS';
END
$$;
