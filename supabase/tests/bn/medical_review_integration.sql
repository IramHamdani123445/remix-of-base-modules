-- =====================================================================
-- BN Medical Reviews — backend integration harness (transaction/rollback)
--
-- Usage (CI / trusted DB session, service_role or owner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bn/medical_review_integration.sql
--
-- The whole harness runs inside a single transaction and ends with
-- ROLLBACK, so it leaves no rows behind. It seeds its own fixtures and
-- never touches production data or the legacy bn_medical_review_schedule.
--
-- STATUS: CREATED — EXECUTION PENDING in the Lovable sandbox. The sandbox
-- psql role cannot EXECUTE database functions, so the command/query RPCs
-- must be exercised from CI (trusted role) or from the app runtime.
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

SET LOCAL search_path = public;

CREATE TEMP TABLE mr_results(check_name text, passed boolean, detail text) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.mr_assert(p_name text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO mr_results VALUES (p_name, COALESCE(p_ok,false), p_detail);
  IF NOT COALESCE(p_ok,false) THEN
    RAISE EXCEPTION 'HARNESS FAILURE: % (%)', p_name, COALESCE(p_detail,'');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Transition matrix / terminal-state protection (pure functions)
-- ---------------------------------------------------------------------
SELECT pg_temp.mr_assert('obligation_terminal_not_reopenable',
  NOT public._bn_mr_transition_allowed('OBLIGATION','COMPLETED','IN_PROGRESS'));
SELECT pg_temp.mr_assert('assessment_locked_is_terminal',
  public._bn_mr_terminal('ASSESSMENT','LOCKED'));
SELECT pg_temp.mr_assert('board_case_determined_is_terminal',
  public._bn_mr_terminal('BOARD_CASE','DETERMINED'));
SELECT pg_temp.mr_assert('decision_requires_approval_step',
  NOT public._bn_mr_transition_allowed('DECISION','READY','APPROVED'));
SELECT pg_temp.mr_assert('proposal_cannot_skip_acceptance',
  NOT public._bn_mr_transition_allowed('PROPOSAL','PROPOSED','EXECUTED'));
SELECT pg_temp.mr_assert('communication_delivered_is_terminal',
  public._bn_mr_terminal('COMMUNICATION','DELIVERED'));

-- ---------------------------------------------------------------------
-- 2. Communication allowlist / clinical-data exclusion
-- ---------------------------------------------------------------------
SELECT pg_temp.mr_assert('comm_allowlist_keeps_operational_fields',
  public._bn_mr_safe_comm_context(
    '{"review_reference":"MR-1","appointment_date":"2026-09-01"}'::jsonb)
  ? 'review_reference');
SELECT pg_temp.mr_assert('comm_allowlist_drops_clinical_fields',
  NOT (public._bn_mr_safe_comm_context(
    '{"diagnosis":"x","clinical_narrative":"y","impairment_percentage":40,"medical_outcome":"z","review_reference":"MR-1"}'::jsonb)
    ?| ARRAY['diagnosis','clinical_narrative','impairment_percentage','medical_outcome']));
SELECT pg_temp.mr_assert('comm_allowlist_drops_unknown_fields',
  NOT (public._bn_mr_safe_comm_context('{"totally_unknown":"v"}'::jsonb) ? 'totally_unknown'));
SELECT pg_temp.mr_assert('event_detail_allowlist_drops_narrative',
  NOT (public._bn_mr_safe_detail('{"clinical_narrative":"x","reason_code":"R1"}'::jsonb) ? 'clinical_narrative'));

-- ---------------------------------------------------------------------
-- 3. Timezone / business-day handling (no hard-coded jurisdiction)
-- ---------------------------------------------------------------------
SELECT pg_temp.mr_assert('product_timezone_used',
  public._bn_mr_today('Pacific/Kiritimati') >= public._bn_mr_today('Pacific/Niue'));
SELECT pg_temp.mr_assert('business_day_offset_skips_weekend',
  public._bn_mr_add_days(DATE '2026-08-07', 1, true) = DATE '2026-08-10');

-- ---------------------------------------------------------------------
-- 4. Masking and search hardening
-- ---------------------------------------------------------------------
SELECT pg_temp.mr_assert('ssn_masked', public._bn_mr_mask_ssn('123456789') = '****6789');
SELECT pg_temp.mr_assert('search_wildcards_escaped',
  public._bn_mr_search_term('a%b_c') = '%a\%b\_c%');
DO $$ BEGIN
  BEGIN
    PERFORM public._bn_mr_search_term('ab');
    PERFORM pg_temp.mr_assert('search_min_length_enforced', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.mr_assert('search_min_length_enforced', SQLERRM LIKE '%E_SEARCH_TERM_TOO_SHORT%', SQLERRM);
  END;
END $$;
SELECT pg_temp.mr_assert('page_size_capped', public._bn_mr_page(10000, 100) = 100);

-- ---------------------------------------------------------------------
-- 5. Fixtures — policy, trigger rules, board, providers
-- ---------------------------------------------------------------------
DO $fixtures$
DECLARE
  v_product uuid; v_policy uuid; v_board uuid; v_provider uuid;
BEGIN
  SELECT id INTO v_product FROM public.bn_product LIMIT 1;
  IF v_product IS NULL THEN
    RAISE EXCEPTION 'HARNESS PRECONDITION: no bn_product rows available';
  END IF;

  INSERT INTO public.bn_medical_board
    (board_code, board_name, review_mode, meeting_mode, minimum_quorum, voting_rule,
     determination_binding, required_specialties, is_active, effective_from)
  VALUES ('HARNESS_BOARD','Harness Board','PANEL','IN_PERSON', 2, 'MAJORITY',
          true, ARRAY['ORTHOPAEDICS'], true, current_date - 1)
  RETURNING id INTO v_board;

  INSERT INTO public.bn_medical_review_policy
    (policy_code, policy_name, bn_product_id, review_type, version_no, lifecycle_state,
     effective_from, assessment_model, provider_selection_model, board_mode,
     board_determination_binding, final_decision_authority, appointment_responsibility,
     provider_fee_responsibility, required_specialties, treating_doctor_permitted,
     independent_assessment_required, second_opinion_mode, required_evidence_types,
     initial_review_offset_days, notice_period_days, referral_acceptance_deadline_days,
     report_deadline_days, grace_period_days, max_deferral_days, timezone_code,
     business_days_only, non_attendance_handling, next_review_authority,
     medical_determination_authority, administrative_decision_authority,
     maker_checker_required, board_id)
  VALUES ('HARNESS_POLICY','Harness Policy', v_product, 'PERIODIC_REVIEW', 1, 'DRAFT',
          current_date - 1, 'EXTERNAL_APPROVED_PROVIDER','SOCIAL_SECURITY_ASSIGNS','CONDITIONAL',
          true, 'BENEFITS_DECISION_OFFICER','SOCIAL_SECURITY','SOCIAL_SECURITY',
          ARRAY['ORTHOPAEDICS'], false, true, 'PERMITTED', ARRAY['MEDICAL_REPORT'],
          30, 14, 7, 30, 7, 30, 'America/St_Kitts', true,
          'REASONABLE_CAUSE_REVIEW','BENEFITS_DECISION_OFFICER',
          'MEDICAL_BOARD_BINDING','BENEFITS_SUPERVISOR', true, v_board)
  RETURNING id INTO v_policy;

  INSERT INTO public.bn_medical_review_board_trigger_rule
    (policy_id, rule_code, rule_name, evaluation_order, is_active, condition, board_type,
     required_specialties, required_quorum, determination_binding, completion_offset_days)
  VALUES
    (v_policy,'PERMANENT_INCAPACITY','Permanent incapacity',10,true,'{}'::jsonb,'PANEL',
     ARRAY['ORTHOPAEDICS'], 2, true, 21),
    (v_policy,'SECOND_OPINION_RECEIVED','Second opinion received',20,true,'{}'::jsonb,'PANEL',
     ARRAY['ORTHOPAEDICS'], 2, true, 21),
    (v_policy,'CONFLICTING_MEDICAL_OPINIONS','Conflicting opinions',30,true,'{}'::jsonb,'PANEL',
     ARRAY['ORTHOPAEDICS'], 3, true, 21),
    (v_policy,'MANUAL_REFERRAL_BY_AUTHORISED_OFFICER','Manual referral',40,true,'{}'::jsonb,'PANEL',
     ARRAY['ORTHOPAEDICS'], 2, false, 21);

  -- 5a. Policy validation accepts the valid draft.
  PERFORM public._bn_mr_validate_policy(v_policy);
  PERFORM pg_temp.mr_assert('valid_policy_accepted', true);

  -- 5b. Board-direct without a Board is rejected.
  UPDATE public.bn_medical_review_policy
     SET assessment_model = 'MEDICAL_BOARD_DIRECT', board_mode = 'NONE' WHERE id = v_policy;
  BEGIN
    PERFORM public._bn_mr_validate_policy(v_policy);
    PERFORM pg_temp.mr_assert('board_direct_without_board_rejected', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.mr_assert('board_direct_without_board_rejected',
      SQLERRM LIKE '%BOARD_DIRECT_WITHOUT_BOARD%', SQLERRM);
  END;

  -- 5c. Quorum below one is rejected.
  UPDATE public.bn_medical_review_policy
     SET assessment_model = 'EXTERNAL_APPROVED_PROVIDER', board_mode = 'CONDITIONAL' WHERE id = v_policy;
  UPDATE public.bn_medical_review_board_trigger_rule SET required_quorum = 0
   WHERE policy_id = v_policy AND rule_code = 'PERMANENT_INCAPACITY';
  BEGIN
    PERFORM public._bn_mr_validate_policy(v_policy);
    PERFORM pg_temp.mr_assert('quorum_below_one_rejected', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.mr_assert('quorum_below_one_rejected', SQLERRM LIKE '%QUORUM_BELOW_ONE%', SQLERRM);
  END;
  UPDATE public.bn_medical_review_board_trigger_rule SET required_quorum = 2
   WHERE policy_id = v_policy AND rule_code = 'PERMANENT_INCAPACITY';

  -- 5d. Second opinion disabled while a second-opinion trigger is active.
  UPDATE public.bn_medical_review_policy SET second_opinion_mode = 'NOT_PERMITTED' WHERE id = v_policy;
  BEGIN
    PERFORM public._bn_mr_validate_policy(v_policy);
    PERFORM pg_temp.mr_assert('second_opinion_conflict_rejected', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.mr_assert('second_opinion_conflict_rejected',
      SQLERRM LIKE '%SECOND_OPINION_DISABLED%', SQLERRM);
  END;
  UPDATE public.bn_medical_review_policy SET second_opinion_mode = 'PERMITTED' WHERE id = v_policy;

  -- 5e. Binding Board authority without a configured Board.
  UPDATE public.bn_medical_review_policy SET board_id = NULL WHERE id = v_policy;
  BEGIN
    PERFORM public._bn_mr_validate_policy(v_policy);
    PERFORM pg_temp.mr_assert('binding_board_not_configured_rejected', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.mr_assert('binding_board_not_configured_rejected',
      SQLERRM LIKE '%BINDING_BOARD_NOT_CONFIGURED%', SQLERRM);
  END;
  UPDATE public.bn_medical_review_policy SET board_id = v_board WHERE id = v_policy;

  -- 5f. Snapshot completeness: rules, board, timezone travel with the obligation.
  PERFORM pg_temp.mr_assert('snapshot_contains_trigger_rules',
    jsonb_array_length(public._bn_mr_policy_snapshot(v_policy) -> 'board_trigger_rules') = 4);
  PERFORM pg_temp.mr_assert('snapshot_contains_board',
    (public._bn_mr_policy_snapshot(v_policy) #>> '{board,minimum_quorum}') = '2');
  PERFORM pg_temp.mr_assert('snapshot_contains_timezone',
    (public._bn_mr_policy_snapshot(v_policy) ->> 'timezone_code') = 'America/St_Kitts');
  PERFORM pg_temp.mr_assert('snapshot_contains_authority_split',
    (public._bn_mr_policy_snapshot(v_policy) ->> 'medical_determination_authority') = 'MEDICAL_BOARD_BINDING'
    AND (public._bn_mr_policy_snapshot(v_policy) ->> 'administrative_decision_authority') = 'BENEFITS_SUPERVISOR');

  -- 5g. Snapshot stability: amending the live rules must not change a taken snapshot.
  CREATE TEMP TABLE mr_snapshot ON COMMIT DROP AS
    SELECT public._bn_mr_policy_snapshot(v_policy) AS snap;
  UPDATE public.bn_medical_review_board_trigger_rule SET is_active = false
   WHERE policy_id = v_policy AND rule_code = 'PERMANENT_INCAPACITY';
  PERFORM pg_temp.mr_assert('snapshot_stable_after_live_amendment',
    (SELECT jsonb_array_length(snap -> 'board_trigger_rules') FROM mr_snapshot) = 4
    AND jsonb_array_length(public._bn_mr_policy_snapshot(v_policy) -> 'board_trigger_rules') = 3);
  UPDATE public.bn_medical_review_board_trigger_rule SET is_active = true
   WHERE policy_id = v_policy AND rule_code = 'PERMANENT_INCAPACITY';

  -- ---------------------------------------------------------------
  -- 6. Provider registry: wildcard approvals, conflicts, accountability
  -- ---------------------------------------------------------------
  INSERT INTO public.bn_medical_provider
    (provider_code, classification, provider_type, practitioner_name, specialties,
     provider_status, effective_from, contract_status, fee_arrangement,
     conflict_restrictions, verification_status, is_individual_practitioner)
  VALUES ('HARNESS_DR1','EXTERNAL','EXTERNAL_INDIVIDUAL_DOCTOR','Harness Doctor One',
          ARRAY['ORTHOPAEDICS'], 'ACTIVE', current_date - 30, 'PANEL_MEMBER','PER_ASSESSMENT_FEE',
          jsonb_build_object('excluded_person_ids', jsonb_build_array('999-99-9999')),
          'VERIFIED', true)
  RETURNING id INTO v_provider;

  INSERT INTO public.bn_medical_provider_approval
    (provider_id, bn_product_id, review_type, is_active, effective_from)
  VALUES (v_provider, NULL, NULL, true, current_date - 30);

  BEGIN
    INSERT INTO public.bn_medical_provider_approval
      (provider_id, bn_product_id, review_type, is_active, effective_from)
    VALUES (v_provider, NULL, NULL, true, current_date - 10);
    PERFORM pg_temp.mr_assert('wildcard_approval_uniqueness', false, 'duplicate wildcard accepted');
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.mr_assert('wildcard_approval_uniqueness', true);
  END;

  PERFORM pg_temp.mr_assert('provider_conflict_detected',
    (public._bn_mr_conflict_check(v_provider, NULL, NULL, '999-99-9999', NULL) ->> 'conflict')::boolean);
  PERFORM pg_temp.mr_assert('provider_conflict_rule_reported',
    (public._bn_mr_conflict_check(v_provider, NULL, NULL, '999-99-9999', NULL) ->> 'rule') = 'EXCLUDED_PERSON');
  PERFORM pg_temp.mr_assert('provider_no_false_conflict',
    NOT (public._bn_mr_conflict_check(v_provider, NULL, NULL, '111-11-1111', NULL) ->> 'conflict')::boolean);

  PERFORM pg_temp.mr_assert('individual_practitioner_is_accountable',
    public._bn_mr_accountable_practitioner(v_provider) = v_provider);

  INSERT INTO public.bn_medical_provider
    (provider_code, classification, provider_type, practitioner_name, specialties,
     provider_status, effective_from, contract_status, fee_arrangement, verification_status,
     is_individual_practitioner, accountable_practitioner_id)
  VALUES ('HARNESS_CLINIC','EXTERNAL','CLINIC','Harness Clinic', ARRAY['ORTHOPAEDICS'],
          'ACTIVE', current_date - 30, 'CONTRACTED','SCHEDULE_OF_FEES','VERIFIED', false, v_provider);
  PERFORM pg_temp.mr_assert('facility_requires_accountable_practitioner',
    public._bn_mr_accountable_practitioner(
      (SELECT id FROM public.bn_medical_provider WHERE provider_code='HARNESS_CLINIC')) = v_provider);

  BEGIN
    INSERT INTO public.bn_medical_provider
      (provider_code, classification, provider_type, practitioner_name, specialties,
       provider_status, effective_from, contract_status, fee_arrangement, verification_status,
       is_individual_practitioner)
    VALUES ('HARNESS_HOSP','EXTERNAL','HOSPITAL','Harness Hospital', ARRAY['ORTHOPAEDICS'],
            'ACTIVE', current_date, 'CONTRACTED','SCHEDULE_OF_FEES','VERIFIED', false);
    PERFORM pg_temp.mr_assert('facility_without_actor_rejected', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.mr_assert('facility_without_actor_rejected', true);
  END;
END
$fixtures$;

-- ---------------------------------------------------------------------
-- 7. Board routing resolution over the snapshot (fact-driven)
-- ---------------------------------------------------------------------
DO $routing$
DECLARE snap jsonb; v_policy uuid;
BEGIN
  SELECT id INTO v_policy FROM public.bn_medical_review_policy WHERE policy_code='HARNESS_POLICY';
  snap := public._bn_mr_policy_snapshot(v_policy);

  PERFORM pg_temp.mr_assert('trigger_second_opinion_received_distinct',
    public._bn_mr_trigger_matches('SECOND_OPINION_RECEIVED','{}'::jsonb,
      '{"second_opinion_received":true}'::jsonb)
    AND NOT public._bn_mr_trigger_matches('SECOND_OPINION_RECEIVED','{}'::jsonb,
      '{"second_opinion_recommended":true}'::jsonb));
  PERFORM pg_temp.mr_assert('trigger_conflicting_opinions',
    public._bn_mr_trigger_matches('CONFLICTING_MEDICAL_OPINIONS','{}'::jsonb,
      '{"conflicting_opinions":true}'::jsonb));
  PERFORM pg_temp.mr_assert('trigger_manual_referral',
    public._bn_mr_trigger_matches('MANUAL_REFERRAL_BY_AUTHORISED_OFFICER','{}'::jsonb,
      '{"manual_referral":true}'::jsonb));
  PERFORM pg_temp.mr_assert('trigger_no_match_on_empty_facts',
    NOT public._bn_mr_trigger_matches('PERMANENT_INCAPACITY','{}'::jsonb, '{}'::jsonb));
END
$routing$;

-- ---------------------------------------------------------------------
-- 8. Structural guarantees
-- ---------------------------------------------------------------------
SELECT pg_temp.mr_assert('no_browser_grants_on_mr_tables',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
               WHERE table_schema='public' AND table_name LIKE 'bn_medical%'
                 AND grantee IN ('anon','authenticated','PUBLIC')));
SELECT pg_temp.mr_assert('private_helpers_not_executable_by_browser',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname LIKE '\_bn\_mr\_%'
                 AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));
SELECT pg_temp.mr_assert('module_dark_launched',
  (SELECT NOT actions_enabled FROM public.app_modules WHERE name='bn_medical_review'));
SELECT pg_temp.mr_assert('legacy_schedule_untouched',
  EXISTS (SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name='bn_medical_review_schedule'));
SELECT pg_temp.mr_assert('adapter_registered',
  EXISTS (SELECT 1 FROM public.bn_communication_adapter_source
           WHERE source_module='BN_MEDICAL_REVIEW'
             AND source_table='bn_medical_review_communication_intent'));
SELECT pg_temp.mr_assert('no_direct_award_mutation_in_mr_commands',
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND (p.proname LIKE 'bn\_medical\_review\_%' OR p.proname LIKE '\_bn\_mr\_%')
       AND (p.prosrc ~* 'update[[:space:]]+public\.bn_award[[:space:]]'
            OR p.prosrc ~* 'update[[:space:]]+public\.bn_award_suspension_event'
            OR p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+public\.bn_award_suspension_event'
            OR p.prosrc ~* 'bn_award_suspension_execute')));
SELECT pg_temp.mr_assert('all_30_permissions_registered',
  (SELECT count(*) FROM public.core_permission_registry
    WHERE module_code='bn_medical_review' AND is_active) = 30);

-- ---------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------
SELECT check_name, passed, COALESCE(detail,'') AS detail FROM mr_results ORDER BY check_name;
SELECT count(*) FILTER (WHERE passed) AS passed,
       count(*) FILTER (WHERE NOT passed) AS failed,
       count(*) AS total
  FROM mr_results;

ROLLBACK;
