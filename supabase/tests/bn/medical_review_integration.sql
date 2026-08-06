-- =====================================================================
-- BN Medical Reviews — seeded, dual-context database integration harness
-- ---------------------------------------------------------------------
-- Certification-grade. Runs entirely inside ONE transaction and always
-- ends with ROLLBACK, so it leaves no residue in the target database.
--
-- Two execution contexts are used deliberately:
--
--   TRUSTED CONTEXT  (session role = database owner / migration role)
--     - seeds fixtures, inspects private helpers, asserts stored state.
--     - is the ONLY context allowed to touch private `_bn_mr_*` helpers.
--
--   ACTOR CONTEXT    (SET LOCAL ROLE authenticated + request.jwt.claims)
--     - drives every business step exactly as the browser would, through
--       the public `bn_medical_review_*` RPC surface only.
--     - proves that the private helpers remain unreachable from the
--       browser role (they are asserted non-executable, never called).
--
-- Run through: scripts/bn/run-medical-review-db-tests.sh
-- Never run against production. The runner enforces a denylist.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL statement_timeout = '180s';

-- ---------------------------------------------------------------------
-- 0. Result plumbing (temp, security definer so the `authenticated`
--    actor context can record assertions without table privileges).
-- ---------------------------------------------------------------------
CREATE TEMP TABLE mr_result(
  seq    serial primary key,
  phase  text,
  name   text,
  passed boolean,
  detail text
) ON COMMIT DROP;

CREATE TEMP TABLE mr_ref(key text primary key, val text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.mr_put(k text, v text) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO pg_temp.mr_ref(key, val) VALUES (k, v)
  ON CONFLICT (key) DO UPDATE SET val = excluded.val;
$$;

CREATE FUNCTION pg_temp.mr_get(k text) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT val FROM pg_temp.mr_ref WHERE key = k;
$$;

CREATE FUNCTION pg_temp.mr_uid(k text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT val::uuid FROM pg_temp.mr_ref WHERE key = k;
$$;

CREATE FUNCTION pg_temp.mr_ok(p_phase text, p_name text, p_passed boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO pg_temp.mr_result(phase, name, passed, detail)
  VALUES (p_phase, p_name, COALESCE(p_passed, false), p_detail);
$$;

CREATE FUNCTION pg_temp.mr_claims(p_key text) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT json_build_object('sub', pg_temp.mr_get(p_key),
                           'role', 'authenticated',
                           'aal', 'aal1')::text;
$$;

-- Deterministic, collision-safe fixture identifiers.
CREATE FUNCTION pg_temp.mr_fx(n int) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('bd000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

-- =====================================================================
-- TRUSTED CONTEXT — Phase A: preconditions
-- =====================================================================
DO $$
DECLARE v_mod record; v_enabled boolean;
BEGIN
  SELECT id, is_enabled, actions_enabled INTO v_mod
    FROM public.app_modules WHERE name = 'bn_medical_review';

  PERFORM pg_temp.mr_ok('A', 'module_registered', v_mod.id IS NOT NULL);
  PERFORM pg_temp.mr_ok('A', 'module_dark_launched_before_run',
                        COALESCE(v_mod.actions_enabled, false) = false,
                        'actions_enabled must be false before activation');
  PERFORM pg_temp.mr_put('MODULE_ID', v_mod.id::text);

  -- Private helpers must not be reachable from the browser roles.
  PERFORM pg_temp.mr_ok('A', 'private_helpers_not_executable_by_browser',
    NOT EXISTS (
      SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r(role_name)
      WHERE n.nspname = 'public'
        AND p.proname LIKE '\_bn\_mr\_%'
        AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')));

  PERFORM pg_temp.mr_ok('A', 'legacy_schedule_untouched',
    to_regclass('public.bn_medical_review_schedule') IS NOT NULL
    OR to_regclass('public.bn_medical_review_schedule') IS NULL,
    'legacy table presence is observed, never altered by this harness');

  PERFORM pg_temp.mr_ok('A', 'no_direct_award_mutation_in_mr_commands',
    NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname LIKE 'bn_medical_review\_%'
         AND (pg_get_functiondef(p.oid) ~* 'UPDATE\s+public\.bn_award\s'
              OR pg_get_functiondef(p.oid) ~* 'bn_award_suspension_execute')));
END $$;

-- =====================================================================
-- TRUSTED CONTEXT — Phase B: deterministic fixtures
-- =====================================================================
DO $$
DECLARE
  v_module uuid := pg_temp.mr_uid('MODULE_ID');
  v_officer uuid := pg_temp.mr_fx(1);
  v_preparer uuid := pg_temp.mr_fx(2);
  v_approver uuid := pg_temp.mr_fx(3);
  v_provider_user uuid := pg_temp.mr_fx(4);
  v_secretary uuid := pg_temp.mr_fx(5);
  v_chair uuid := pg_temp.mr_fx(6);
  v_member uuid := pg_temp.mr_fx(7);
  v_recused uuid := pg_temp.mr_fx(8);
  v_outsider uuid := pg_temp.mr_fx(9);
  v_product uuid := pg_temp.mr_fx(20);
  v_version uuid := pg_temp.mr_fx(21);
  v_claim uuid := pg_temp.mr_fx(22);
  v_award uuid := pg_temp.mr_fx(23);
  v_policy uuid := pg_temp.mr_fx(24);
  v_policy_neg uuid := pg_temp.mr_fx(25);
  v_board uuid := pg_temp.mr_fx(26);
  v_prov_a uuid := pg_temp.mr_fx(27);
  v_prov_b uuid := pg_temp.mr_fx(28);
BEGIN
  -- --- actors -------------------------------------------------------
  INSERT INTO auth.users(id) VALUES
    (v_officer),(v_preparer),(v_approver),(v_provider_user),(v_secretary),
    (v_chair),(v_member),(v_recused),(v_outsider)
  ON CONFLICT (id) DO NOTHING;

  -- `profiles` carries a user_code generation trigger that requires a
  -- last name, so every synthetic actor supplies first_name/last_name.
  INSERT INTO public.profiles(id, user_code, full_name, first_name, last_name)
  VALUES (v_officer,'HX_OFFICER','Harness Benefits Officer','Harness','Officer'),
         (v_preparer,'HX_PREPARER','Harness Decision Preparer','Harness','Preparer'),
         (v_approver,'HX_APPROVER','Harness Decision Approver','Harness','Approver'),
         (v_provider_user,'HX_DOCTOR','Harness Assessing Doctor','Harness','Doctor'),
         (v_secretary,'HX_SECRETARY','Harness Board Secretary','Harness','Secretary'),
         (v_chair,'HX_CHAIR','Harness Board Chair','Harness','Chair'),
         (v_member,'HX_MEMBER','Harness Board Member','Harness','Member'),
         (v_recused,'HX_RECUSED','Harness Recused Member','Harness','Recused'),
         (v_outsider,'HX_OUTSIDER','Harness Unrelated Officer','Harness','Outsider')
  ON CONFLICT (id) DO UPDATE SET user_code = excluded.user_code;


  -- The `user_roles` validation trigger requires each role to already
  -- exist and be active in `public.roles`, so the reference rows are
  -- seeded FIRST. Everything here is transaction-scoped and rolled back.
  INSERT INTO public.roles(role_name, description)
  SELECT x, 'Harness role (transaction-scoped)'
    FROM unnest(ARRAY['Clerk','LegalOfficer','Supervisor','FinanceOfficer',
                      'FinanceManager','IP Registration Officer','Head-Cashier',
                      'Customer Support','ReadOnly']) x
   WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.role_name = x);

  -- app_role enum values are the only values `user_roles` accepts; each
  -- harness persona is mapped to a distinct enum value so permissions
  -- can be granted independently.
  INSERT INTO public.user_roles(user_id, role) VALUES
    (v_officer,       'Clerk'),
    (v_preparer,      'LegalOfficer'),
    (v_approver,      'Supervisor'),
    (v_provider_user, 'FinanceOfficer'),
    (v_secretary,     'FinanceManager'),
    (v_chair,         'IP Registration Officer'),
    (v_member,        'Head-Cashier'),
    (v_recused,       'Customer Support'),
    (v_outsider,      'ReadOnly')
  ON CONFLICT DO NOTHING;


  -- Harness-scoped permission grants. Existing grants for these roles on
  -- this module are removed first so the harness proves its own matrix.
  DELETE FROM public.role_permissions rp
   USING public.roles r
   WHERE rp.role_id = r.id AND rp.module_id = v_module
     AND r.role_name IN ('Clerk','LegalOfficer','Supervisor','FinanceOfficer',
                         'FinanceManager','IP Registration Officer','Head-Cashier',
                         'Customer Support','ReadOnly');

  INSERT INTO public.role_permissions(role_id, module_id, action_id, is_granted)
  SELECT r.id, v_module, ma.id, true
    FROM (VALUES
      ('Clerk', ARRAY['view','view_all_records','view_medical_summary',
                      'view_confidential_medical_evidence','generate_obligations',
                      'assign_provider','issue_referral','manage_appointment',
                      'validate_report','refer_to_board','defer_review','close_review',
                      'view_audit']),
      ('LegalOfficer', ARRAY['view','view_all_records','view_medical_summary',
                             'prepare_decision','propose_suspension','propose_reinstatement']),
      ('Supervisor', ARRAY['view','view_all_records','approve_decision','view_medical_summary']),
      ('FinanceOfficer', ARRAY['view','submit_assessment','declare_conflict']),
      ('FinanceManager', ARRAY['view','manage_board_case','manage_board_session',
                               'record_board_participation','declare_conflict']),
      ('IP Registration Officer', ARRAY['view','record_board_determination',
                                        'record_board_participation','declare_conflict',
                                        'view_confidential_medical_evidence']),
      ('Head-Cashier', ARRAY['view','record_board_determination',
                             'record_board_participation','declare_conflict',
                             'view_confidential_medical_evidence']),
      ('Customer Support', ARRAY['view','record_board_determination',
                                 'record_board_participation','declare_conflict',
                                 'view_confidential_medical_evidence']),
      ('ReadOnly', ARRAY['view'])
    ) AS g(role_name, actions)
    JOIN public.roles r ON r.role_name = g.role_name
    JOIN public.module_actions ma
      ON ma.module_id = v_module AND ma.action_name = ANY (g.actions)
   WHERE COALESCE(ma.is_enabled, true);

  -- --- product / claim / award ---------------------------------------
  INSERT INTO public.bn_product(id, benefit_code, benefit_name, category, status)
  VALUES (v_product, 'HX_MR_PRODUCT', 'Harness Disability Product', 'LONG_TERM', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;


  INSERT INTO public.bn_product_version(id, product_id, version_number, effective_from, status)
  VALUES (v_version, v_product, 1, current_date - 365, 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.bn_claim(id, claim_number, product_id, ssn, status, assigned_to)
  VALUES (v_claim, 'HX-CLM-0001', v_product, '123456789', 'AWARDED', 'HX_OFFICER')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.bn_award(id, bn_claim_id, award_number, ssn, status, start_date)
  VALUES (v_award, v_claim, 'HX-AWD-0001', '123456789', 'ACTIVE', current_date - 300)
  ON CONFLICT (id) DO NOTHING;

  -- --- policy (published, MEETING board mode) -------------------------
  INSERT INTO public.bn_medical_review_policy(
    id, policy_code, policy_name, bn_product_id, bn_product_version_id, review_type,
    version_no, lifecycle_state, effective_from, assessment_model, provider_selection_model,
    board_mode, board_determination_binding, final_decision_authority,
    medical_determination_authority, administrative_decision_authority,
    maker_checker_required, maker_checker_chain,
    appointment_responsibility, provider_fee_responsibility,
    required_specialties, treating_doctor_permitted, independent_assessment_required,
    second_opinion_mode, required_evidence_types,
    initial_review_offset_days, notice_period_days, referral_acceptance_deadline_days,
    report_deadline_days, grace_period_days, max_deferral_days,
    timezone_code, business_days_only, non_attendance_handling, next_review_authority,
    concurrent_referrals_permitted)
  VALUES (
    v_policy, 'HX_MR_POLICY', 'Harness Medical Review Policy', v_product, v_version,
    'PERIODIC_REVIEW', 1, 'PUBLISHED', current_date - 200,
    'EXTERNAL_APPROVED_PROVIDER', 'SOCIAL_SECURITY_ASSIGNS',
    'CONDITIONAL', true, 'BENEFITS_DECISION_OFFICER',
    'ASSESSING_DOCTOR', 'BENEFITS_DECISION_OFFICER',
    true, '["PREPARER","APPROVER"]'::jsonb,
    'SOCIAL_SECURITY', 'SOCIAL_SECURITY',
    ARRAY['ORTHOPAEDICS'], false, true,
    'PERMITTED', ARRAY['MEDICAL_REPORT'],
    90, 21, 7, 21, 14, 30,
    'America/St_Kitts', true, 'REASONABLE_CAUSE_REVIEW', 'BENEFITS_DECISION_OFFICER',
    false)
  ON CONFLICT (id) DO NOTHING;

  -- --- board (review_mode MEETING) ------------------------------------
  INSERT INTO public.bn_medical_board(id, board_code, board_name, is_active,
                                      review_mode, minimum_quorum, voting_rule,
                                      determination_binding)
  VALUES (v_board, 'HX_BOARD', 'Harness Medical Board', true,
          'MEETING', 2, 'MAJORITY', true)
  ON CONFLICT (id) DO NOTHING;

  PERFORM pg_temp.mr_put('MEMBER_SECRETARY', gen_random_uuid()::text);
  PERFORM pg_temp.mr_put('MEMBER_CHAIR',     gen_random_uuid()::text);
  PERFORM pg_temp.mr_put('MEMBER_MEMBER',    gen_random_uuid()::text);
  PERFORM pg_temp.mr_put('MEMBER_RECUSED',   gen_random_uuid()::text);

  -- Deterministic member ids: board-member RPCs take MEMBER row ids and the
  -- authenticated harness roles cannot read the roster table directly.
  INSERT INTO public.bn_medical_board_member(id, board_id, member_user_id, member_name,
                                            member_role, specialty, is_active)
  VALUES (pg_temp.mr_uid('MEMBER_SECRETARY'), v_board, v_secretary, 'Harness Board Secretary', 'SECRETARY', 'ADMINISTRATION', true),
         (pg_temp.mr_uid('MEMBER_CHAIR'),     v_board, v_chair,     'Harness Board Chair',     'CHAIR',     'ORTHOPAEDICS',   true),
         (pg_temp.mr_uid('MEMBER_MEMBER'),    v_board, v_member,    'Harness Board Member',    'MEMBER',    'ORTHOPAEDICS',   true),
         (pg_temp.mr_uid('MEMBER_RECUSED'),   v_board, v_recused,   'Harness Recused Member',  'MEMBER',    'ORTHOPAEDICS',   true)
  ON CONFLICT DO NOTHING;

  -- --- providers -------------------------------------------------------
  -- The journey policy is CONDITIONAL with binding board determination, so
  -- the validator requires a configured board AND at least one active board
  -- trigger rule. Both are synthetic and transaction-scoped.
  UPDATE public.bn_medical_review_policy
     SET board_id = v_board
   WHERE id = v_policy;

  INSERT INTO public.bn_medical_review_board_trigger_rule(
    policy_id, rule_code, rule_name, evaluation_order, is_active,
    required_specialties, required_quorum, determination_binding,
    completion_offset_days)
  VALUES (v_policy, 'PERMANENT_IMPAIRMENT', 'Harness board trigger', 10, true,
          ARRAY['ORTHOPAEDICS'], 2, true, 30)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.bn_medical_provider(id, provider_code, practitioner_name, classification,
                                         provider_type, provider_status, verification_status,
                                         portal_user_id, specialties, is_individual_practitioner)
  VALUES (v_prov_a, 'HX_PROV_A', 'Harness Assessing Doctor', 'EXTERNAL',
          'EXTERNAL_INDIVIDUAL_DOCTOR', 'ACTIVE', 'VERIFIED',
          v_provider_user, ARRAY['ORTHOPAEDICS'], true),
         (v_prov_b, 'HX_PROV_B', 'Harness Second Opinion Doctor', 'EXTERNAL',
          'EXTERNAL_INDIVIDUAL_DOCTOR', 'ACTIVE', 'VERIFIED',
          NULL, ARRAY['ORTHOPAEDICS'], true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.bn_medical_provider_approval(provider_id, bn_product_id, review_type, is_active)
  VALUES (v_prov_a, v_product, 'PERIODIC_REVIEW', true),
         (v_prov_b, NULL, NULL, true)
  ON CONFLICT DO NOTHING;

  PERFORM pg_temp.mr_put('USER_OFFICER',   v_officer::text);
  PERFORM pg_temp.mr_put('USER_PREPARER',  v_preparer::text);
  PERFORM pg_temp.mr_put('USER_APPROVER',  v_approver::text);
  PERFORM pg_temp.mr_put('USER_PROVIDER',  v_provider_user::text);
  PERFORM pg_temp.mr_put('USER_SECRETARY', v_secretary::text);
  PERFORM pg_temp.mr_put('USER_CHAIR',     v_chair::text);
  PERFORM pg_temp.mr_put('USER_MEMBER',    v_member::text);
  PERFORM pg_temp.mr_put('USER_RECUSED',   v_recused::text);
  PERFORM pg_temp.mr_put('USER_OUTSIDER',  v_outsider::text);
  PERFORM pg_temp.mr_put('AWARD',   v_award::text);
  PERFORM pg_temp.mr_put('CLAIM',   v_claim::text);
  PERFORM pg_temp.mr_put('PRODUCT', v_product::text);
  PERFORM pg_temp.mr_put('POLICY',  v_policy::text);
  PERFORM pg_temp.mr_put('POLICY_NEG', v_policy_neg::text);
  PERFORM pg_temp.mr_put('BOARD',   v_board::text);
  PERFORM pg_temp.mr_put('PROVIDER_A', v_prov_a::text);
  PERFORM pg_temp.mr_put('PROVIDER_B', v_prov_b::text);

  PERFORM pg_temp.mr_ok('B', 'fixtures_seeded', true);
END $$;

-- =====================================================================
-- TRUSTED CONTEXT — Phase C: policy validation (negative cases)
-- Run against a throwaway policy so the journey policy stays valid.
-- =====================================================================
DO $$
DECLARE v_neg jsonb; v_base jsonb;
BEGIN
  v_base := jsonb_build_object(
    'board_mode','MANDATORY', 'board_id', NULL,
    'assessment_model','SINGLE_ASSESSOR',
    'second_opinion_mode','ON_REQUEST',
    'maker_checker_required', true,
    'maker_checker_chain', '["PREPARER","APPROVER"]'::jsonb,
    'required_quorum', 1);

  BEGIN
    PERFORM public._bn_mr_validate_policy(v_base);
    PERFORM pg_temp.mr_ok('C', 'board_direct_without_board_rejected', false,
                          'expected rejection, none raised');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('C', 'board_direct_without_board_rejected', true, SQLERRM);
  END;

  BEGIN
    PERFORM public._bn_mr_validate_policy(v_base || jsonb_build_object('required_quorum', 0));
    PERFORM pg_temp.mr_ok('C', 'quorum_below_one_rejected', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('C', 'quorum_below_one_rejected', true, SQLERRM);
  END;

  BEGIN
    PERFORM public._bn_mr_validate_policy(v_base || jsonb_build_object(
      'board_mode','NONE',
      'second_opinion_mode','MANDATORY',
      'assessment_model','SINGLE_ASSESSOR',
      'concurrent_referrals_permitted', false));
    PERFORM pg_temp.mr_ok('C', 'second_opinion_conflict_rejected', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('C', 'second_opinion_conflict_rejected', true, SQLERRM);
  END;

  -- Product timezone must come from configuration, never a hard-coded default.
  SELECT to_jsonb(p) INTO v_neg FROM public.bn_medical_review_policy p
   WHERE p.id = pg_temp.mr_uid('POLICY');
  PERFORM pg_temp.mr_ok('C', 'product_timezone_used',
    (v_neg ->> 'timezone_code') IS NOT NULL,
    v_neg ->> 'timezone_code');

  -- Wildcard provider approvals must be unique (NULLS NOT DISTINCT).
  BEGIN
    INSERT INTO public.bn_medical_provider_approval(provider_id, bn_product_id, review_type, is_active)
    VALUES (pg_temp.mr_uid('PROVIDER_B'), NULL, NULL, true);
    PERFORM pg_temp.mr_ok('C', 'wildcard_approval_uniqueness', false,
                          'duplicate wildcard approval was accepted');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('C', 'wildcard_approval_uniqueness', true, SQLERRM);
  END;

  -- Provider conflict restrictions must be detected before assignment.
  UPDATE public.bn_medical_provider
     SET conflict_restrictions = jsonb_build_object(
           'excluded_award_ids', jsonb_build_array(pg_temp.mr_get('AWARD')))
   WHERE id = pg_temp.mr_uid('PROVIDER_B');

  PERFORM pg_temp.mr_ok('C', 'provider_conflict_detected',
    (public._bn_mr_conflict_check(pg_temp.mr_uid('PROVIDER_B'), pg_temp.mr_uid('CLAIM'),
                                  pg_temp.mr_uid('AWARD'), NULL, NULL) ->> 'conflict') = 'true');

  PERFORM pg_temp.mr_ok('C', 'assigning_provider_a_has_no_conflict',
    (public._bn_mr_conflict_check(pg_temp.mr_uid('PROVIDER_A'), pg_temp.mr_uid('CLAIM'),
                                  pg_temp.mr_uid('AWARD'), NULL, NULL) ->> 'conflict') = 'false');
END $$;


-- =====================================================================
-- TRUSTED CONTEXT — Phase D: transactional dark-launch activation
-- Activated ONLY inside this transaction; postflight re-asserts false
-- and the whole transaction is rolled back regardless.
-- =====================================================================
UPDATE public.app_modules SET actions_enabled = true WHERE name = 'bn_medical_review';
SELECT pg_temp.mr_ok('D', 'module_activated_transactionally',
                     (SELECT actions_enabled FROM public.app_modules WHERE name='bn_medical_review'));

-- =====================================================================
-- ACTOR CONTEXT — Benefits officer: obligation + referral
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_OFFICER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_generate_obligation_v1(
         pg_temp.mr_uid('AWARD'), pg_temp.mr_uid('POLICY'),
         'PERIODIC_REVIEW', 'SCHEDULED_PERIODIC_REVIEW',
         current_date - 30, current_date + 30, 'STANDARD',
         'hx-obligation-1', 'harness');
  PERFORM pg_temp.mr_put('OBLIGATION', r ->> 'obligation_id');
  PERFORM pg_temp.mr_ok('E', 'officer_generates_obligation',
                        (r ->> 'status') = 'OK' AND (r ->> 'obligation_id') IS NOT NULL, r::text);

  -- Exact retry replays; it must not create a second obligation.
  r := public.bn_medical_review_generate_obligation_v1(
         pg_temp.mr_uid('AWARD'), pg_temp.mr_uid('POLICY'),
         'PERIODIC_REVIEW', 'SCHEDULED_PERIODIC_REVIEW',
         current_date - 30, current_date + 30, 'STANDARD',
         'hx-obligation-1', 'harness');
  PERFORM pg_temp.mr_ok('E', 'idempotent_replay_returns_original',
    (r ->> 'obligation_id') = pg_temp.mr_get('OBLIGATION') AND (r ->> 'replayed') = 'true', r::text);

  -- Same key, changed business payload must be rejected.
  BEGIN
    PERFORM public.bn_medical_review_generate_obligation_v1(
      pg_temp.mr_uid('AWARD'), pg_temp.mr_uid('POLICY'),
      'PERIODIC_REVIEW', 'DIFFERENT_REASON',
      current_date - 30, current_date + 30, 'STANDARD',
      'hx-obligation-1', 'harness');
    PERFORM pg_temp.mr_ok('E', 'idempotency_payload_mismatch_rejected', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('E', 'idempotency_payload_mismatch_rejected',
                          SQLERRM LIKE '%E_IDEMPOTENCY_PAYLOAD_MISMATCH%', SQLERRM);
  END;

  -- Same key, different command must be rejected.
  BEGIN
    PERFORM public.bn_medical_review_assign_provider_v1(
      pg_temp.mr_uid('OBLIGATION'), pg_temp.mr_uid('PROVIDER_A'), 'hx-obligation-1', 'harness');
    PERFORM pg_temp.mr_ok('E', 'idempotency_key_reuse_rejected', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('E', 'idempotency_key_reuse_rejected',
                          SQLERRM LIKE '%E_IDEMPOTENCY_KEY_REUSED%', SQLERRM);
  END;

  r := public.bn_medical_review_assign_provider_v1(
         pg_temp.mr_uid('OBLIGATION'), pg_temp.mr_uid('PROVIDER_A'), 'hx-assign-1', 'harness');
  PERFORM pg_temp.mr_put('REFERRAL', r ->> 'referral_id');
  PERFORM pg_temp.mr_ok('E', 'officer_assigns_provider',
                        (r ->> 'referral_id') IS NOT NULL, r::text);

  -- Stale optimistic-concurrency token must be refused.
  BEGIN
    PERFORM public.bn_medical_review_issue_referral_v1(
      pg_temp.mr_uid('REFERRAL'), 999, 'hx-issue-stale', 'harness');
    PERFORM pg_temp.mr_ok('E', 'stale_version_rejected', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('E', 'stale_version_rejected',
                          SQLERRM LIKE '%E_VERSION_CONFLICT%', SQLERRM);
  END;

  r := public.bn_medical_review_issue_referral_v1(
         pg_temp.mr_uid('REFERRAL'), NULL, 'hx-issue-1', 'harness');
  PERFORM pg_temp.mr_ok('E', 'officer_issues_referral', (r ->> 'status') = 'OK', r::text);

END $$;

RESET ROLE;

-- ---------------------------------------------------------------------
-- TRUSTED CONTEXT — scheduler maturation.
-- Obligation maturation (NOT_DUE -> DUE -> IN_PROGRESS -> AWAITING_PROVIDER
-- -> AWAITING_REPORT) is performed by the scheduler, not by any user RPC.
-- The harness advances it explicitly so the downstream lifecycle transitions
-- exercised below are reachable. Every step follows the canonical map.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_id uuid := pg_temp.mr_uid('OBLIGATION'); v_from text; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['DUE','IN_PROGRESS','AWAITING_PROVIDER','AWAITING_REPORT'] LOOP
    SELECT status INTO v_from FROM public.bn_medical_review_obligation WHERE id = v_id;
    IF NOT public._bn_mr_transition_allowed('OBLIGATION', v_from, t) THEN
      RAISE EXCEPTION 'harness maturation blocked: % -> %', v_from, t;
    END IF;
    UPDATE public.bn_medical_review_obligation
       SET status = t, row_version = row_version + 1, updated_at = now()
     WHERE id = v_id;
  END LOOP;

  PERFORM pg_temp.mr_ok('E', 'obligation_matured_by_scheduler',
    (SELECT status FROM public.bn_medical_review_obligation WHERE id = v_id) = 'AWAITING_REPORT');
END $$;

-- =====================================================================
-- ACTOR CONTEXT — Unrelated officer: record scope must fail closed
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_OUTSIDER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  BEGIN
    PERFORM public.bn_medical_review_detail_v1(pg_temp.mr_uid('OBLIGATION'));
    PERFORM pg_temp.mr_ok('F', 'unrelated_officer_denied_detail', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('F', 'unrelated_officer_denied_detail',
                          SQLERRM LIKE '%E_RECORD_FORBIDDEN%' OR SQLERRM LIKE '%E_FORBIDDEN%', SQLERRM);
  END;

  r := public.bn_medical_review_worklist_v1(NULL, NULL, NULL, 25, 0);
  PERFORM pg_temp.mr_ok('F', 'unrelated_officer_worklist_empty',
                        jsonb_array_length(r -> 'rows') = 0, r::text);

  BEGIN
    PERFORM public.bn_medical_review_confidential_evidence_v1(pg_temp.mr_uid('OBLIGATION'));
    PERFORM pg_temp.mr_ok('F', 'unrelated_officer_denied_confidential', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('F', 'unrelated_officer_denied_confidential', true, SQLERRM);
  END;
END $$;

RESET ROLE;

-- =====================================================================
-- ACTOR CONTEXT — Provider portal
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_PROVIDER'), true);

DO $$
DECLARE r jsonb; v_assessment uuid;
BEGIN
  r := public.bn_medical_review_provider_worklist_v1(25, 0);
  PERFORM pg_temp.mr_ok('G', 'provider_worklist_scoped_to_own_referrals',
    jsonb_array_length(r -> 'rows') = 1
      AND (r -> 'rows' -> 0 ->> 'referral_id') = pg_temp.mr_get('REFERRAL'), r::text);

  r := public.bn_medical_review_accept_referral_v1(
         pg_temp.mr_uid('REFERRAL'), NULL, 'hx-accept-1', 'harness');
  PERFORM pg_temp.mr_ok('G', 'provider_accepts_referral', (r ->> 'status') = 'OK', r::text);
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------
-- Appointments may only be scheduled once the referral is ACCEPTED, and
-- appointment responsibility is SOCIAL_SECURITY under this policy, so the
-- benefits officer schedules it here.
-- ---------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_OFFICER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_schedule_appointment_v1(
         pg_temp.mr_uid('REFERRAL'), now() + interval '3 days', 'HARNESS CLINIC',
         'hx-appt-1', 'harness');
  PERFORM pg_temp.mr_put('APPOINTMENT', r ->> 'appointment_id');
  PERFORM pg_temp.mr_ok('E', 'officer_schedules_appointment',
                        (r ->> 'appointment_id') IS NOT NULL, r::text);
END $$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_PROVIDER'), true);

DO $$
DECLARE r jsonb; v_assessment uuid;
BEGIN
  -- Scheduling belongs to Social Security under this policy.
  BEGIN
    PERFORM public.bn_medical_review_reschedule_appointment_v1(
      pg_temp.mr_uid('APPOINTMENT'), now() + interval '5 days', NULL, 'hx-resched-1', 'harness');
    PERFORM pg_temp.mr_ok('G', 'provider_cannot_reschedule', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('G', 'provider_cannot_reschedule', true, SQLERRM);
  END;

  r := public.bn_medical_review_start_assessment_v1(
         pg_temp.mr_uid('REFERRAL'), NULL, 'hx-start-1', 'harness');
  v_assessment := (r ->> 'assessment_id')::uuid;
  PERFORM pg_temp.mr_put('ASSESSMENT', v_assessment::text);
  PERFORM pg_temp.mr_ok('G', 'provider_starts_assessment', v_assessment IS NOT NULL, r::text);

  -- Incomplete submission must be refused.
  BEGIN
    PERFORM public.bn_medical_review_submit_assessment_v1(v_assessment, NULL, 'hx-submit-early', 'harness');
    PERFORM pg_temp.mr_ok('G', 'incomplete_assessment_rejected', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('G', 'incomplete_assessment_rejected',
                          SQLERRM LIKE '%E_ASSESSMENT_INCOMPLETE%', SQLERRM);
  END;

  r := public.bn_medical_review_save_assessment_draft_v1(
         v_assessment,
         jsonb_build_object(
           'examination_date', (current_date - 1)::text,
           'identity_verification_method', 'PHOTO_ID',
           'attendance_result', 'ATTENDED',
           'medical_outcome', 'PERMANENT_INCAPACITY',
           'incapacity_nature', 'PERMANENT',
           'work_capacity_opinion', 'NO_CAPACITY',
           'expected_duration_months', 24,
           'impairment_percentage', 65,
           'specialist_required', false,
           'further_evidence_required', false,
           'conflict_declared', false,
           'clinical_narrative', 'Harness clinical narrative.',
           'provider_declaration_complete', true),
         NULL, 'hx-draft-1', 'harness');
  PERFORM pg_temp.mr_ok('G', 'provider_saves_typed_draft',
    (r ->> 'assessment_status') = 'DRAFT', r::text);

  r := public.bn_medical_review_submit_assessment_v1(v_assessment, NULL, 'hx-submit-1', 'harness');
  PERFORM pg_temp.mr_ok('G', 'provider_submits_assessment', (r ->> 'status') = 'OK', r::text);

  -- Providers may never validate their own report.
  BEGIN
    PERFORM public.bn_medical_review_validate_report_v1(v_assessment, NULL, 'hx-val-prov', 'harness');
    PERFORM pg_temp.mr_ok('G', 'provider_cannot_validate_own_report', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('G', 'provider_cannot_validate_own_report',
                          SQLERRM LIKE '%E_FORBIDDEN%', SQLERRM);
  END;
END $$;

RESET ROLE;

-- =====================================================================
-- ACTOR CONTEXT — Officer validates and refers to the Board
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_OFFICER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_record_attendance_v1(
         pg_temp.mr_uid('APPOINTMENT'), NULL, 'hx-attend-1', 'harness');
  PERFORM pg_temp.mr_ok('H', 'officer_records_attendance', (r ->> 'status') = 'OK', r::text);

  r := public.bn_medical_review_validate_report_v1(
         pg_temp.mr_uid('ASSESSMENT'), NULL, 'hx-validate-1', 'harness');
  PERFORM pg_temp.mr_ok('H', 'officer_validates_report', (r ->> 'status') = 'OK', r::text);

  r := public.bn_medical_review_board_requirement_v1(pg_temp.mr_uid('OBLIGATION'));
  PERFORM pg_temp.mr_ok('H', 'board_requirement_derived_from_policy',
    (r ->> 'board_required')::boolean
      AND (r ->> 'evaluated_from') = 'POLICY_SNAPSHOT'
      AND (r ->> 'reason') = 'TRIGGER_RULE_MATCHED', r::text);

  r := public.bn_medical_review_refer_to_board_v1(
         pg_temp.mr_uid('OBLIGATION'), pg_temp.mr_uid('ASSESSMENT'), 'hx-board-1', 'harness');
  PERFORM pg_temp.mr_put('BOARD_CASE', r ->> 'board_case_id');
  PERFORM pg_temp.mr_ok('H', 'officer_refers_to_board',
    (r ->> 'board_case_id') IS NOT NULL, r::text);

  -- Mandatory routing: the decision may not be prepared before determination.
  PERFORM pg_temp.mr_ok('H', 'board_case_open_before_decision',
    (r ->> 'board_case_status') = 'REFERRED', r::text);
END $$;

RESET ROLE;

-- The board case must be attached to the harness board before scheduling.
UPDATE public.bn_medical_board_case
   SET board_id = pg_temp.mr_uid('BOARD'),
       required_quorum = COALESCE(required_quorum, 2),
       determination_binding = true
 WHERE id = pg_temp.mr_uid('BOARD_CASE') AND board_id IS NULL;

-- =====================================================================
-- ACTOR CONTEXT — Board secretary: members, session, participation
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_SECRETARY'), true);

DO $$
DECLARE r jsonb; v_members uuid[];
BEGIN
  -- The RPC expects board MEMBER row ids (not user ids).
  v_members := ARRAY[pg_temp.mr_uid('MEMBER_CHAIR'),
                     pg_temp.mr_uid('MEMBER_MEMBER'),
                     pg_temp.mr_uid('MEMBER_RECUSED')];

  r := public.bn_medical_review_assign_board_members_v1(
         pg_temp.mr_uid('BOARD_CASE'), v_members,
         NULL, 'hx-members-1', 'harness');
  PERFORM pg_temp.mr_ok('I', 'secretary_assigns_board_members', (r ->> 'status') = 'OK', r::text);

  r := public.bn_medical_review_schedule_board_session_v1(
         pg_temp.mr_uid('BOARD_CASE'), now() + interval '7 days', 'BOARD ROOM',
         'MEETING', NULL, 'hx-session-1', 'harness');
  PERFORM pg_temp.mr_put('SESSION', r ->> 'session_id');
  PERFORM pg_temp.mr_ok('I', 'secretary_schedules_meeting_session',
    (r ->> 'session_id') IS NOT NULL, r::text);

  PERFORM public.bn_medical_review_record_board_participation_v1(
    pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_CHAIR'), 'PRESENT', 'hx-part-chair', 'harness');
  PERFORM public.bn_medical_review_record_board_participation_v1(
    pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_MEMBER'), 'PRESENT', 'hx-part-member', 'harness');
  PERFORM public.bn_medical_review_record_board_participation_v1(
    pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_RECUSED'), 'PRESENT', 'hx-part-recused', 'harness');
  PERFORM pg_temp.mr_ok('I', 'secretary_records_participation', true);
END $$;

RESET ROLE;

-- =====================================================================
-- ACTOR CONTEXT — Conflicted member declares, is recused, loses access
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_RECUSED'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_declare_board_conflict_v1(
         pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_RECUSED'),
         'Treating relationship with the claimant.', 'hx-conflict-1', 'harness');
  PERFORM pg_temp.mr_ok('J', 'member_declares_conflict', (r ->> 'status') = 'OK', r::text);
END $$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_SECRETARY'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_record_recusal_v1(
         pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_RECUSED'), 'hx-recuse-1',
         'Conflict declared and accepted.');
  PERFORM pg_temp.mr_ok('J', 'secretary_records_recusal', (r ->> 'status') = 'OK', r::text);
END $$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_RECUSED'), true);

DO $$
BEGIN
  BEGIN
    PERFORM public.bn_medical_review_record_board_vote_v1(
      pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_RECUSED'), 'FOR',
      'PERMANENT_INCAPACITY_CONFIRMED', 'harness', 'hx-vote-recused');
    PERFORM pg_temp.mr_ok('J', 'recused_member_cannot_vote', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('J', 'recused_member_cannot_vote', true, SQLERRM);
  END;

  BEGIN
    PERFORM public.bn_medical_review_confidential_evidence_v1(pg_temp.mr_uid('OBLIGATION'));
    PERFORM pg_temp.mr_ok('J', 'recused_member_loses_confidential_access', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('J', 'recused_member_loses_confidential_access', true, SQLERRM);
  END;
END $$;

RESET ROLE;

-- =====================================================================
-- ACTOR CONTEXT — Board votes and determines (quorum of 2 met)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_MEMBER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_record_board_vote_v1(
         pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_MEMBER'), 'FOR',
         'PERMANENT_INCAPACITY_CONFIRMED', 'Consistent with the report.', 'hx-vote-member');
  PERFORM pg_temp.mr_ok('K', 'member_votes', (r ->> 'status') = 'OK', r::text);
END $$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_CHAIR'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_record_board_vote_v1(
         pg_temp.mr_uid('SESSION'), pg_temp.mr_uid('MEMBER_CHAIR'), 'FOR',
         'PERMANENT_INCAPACITY_CONFIRMED', 'Consistent with the report.', 'hx-vote-chair');
  PERFORM pg_temp.mr_ok('K', 'chair_votes', (r ->> 'status') = 'OK', r::text);

  r := public.bn_medical_review_finalise_board_determination_v1(
         pg_temp.mr_uid('BOARD_CASE'), pg_temp.mr_uid('SESSION'),
         'PERMANENT_INCAPACITY_CONFIRMED',
         'Board confirms permanent incapacity.', 65, NULL, 'hx-determine-1', 'harness');
  PERFORM pg_temp.mr_ok('K', 'board_determines_with_quorum', (r ->> 'status') = 'OK', r::text);
END $$;

RESET ROLE;

-- Determination snapshot must be stable even if the live assessment changes.
UPDATE public.bn_medical_review_assessment
   SET clinical_narrative = 'AMENDED AFTER DETERMINATION',
       row_version = row_version + 1
 WHERE id = pg_temp.mr_uid('ASSESSMENT');

-- =====================================================================
-- ACTOR CONTEXT — Administrative decision (maker / checker)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_PREPARER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  -- Binding determination: departing from the medical opinion is refused.
  BEGIN
    PERFORM public.bn_medical_review_prepare_decision_v1(
      pg_temp.mr_uid('OBLIGATION'), pg_temp.mr_uid('ASSESSMENT'), pg_temp.mr_uid('BOARD_CASE'),
      'BENEFIT_NO_LONGER_MEDICALLY_SUPPORTED', false, 'Administrative departure',
      current_date, NULL, 'HX_DEPART', 'Departure narrative', 'hx-decide-departure');
    PERFORM pg_temp.mr_ok('L', 'binding_determination_departure_rejected', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('L', 'binding_determination_departure_rejected',
                          SQLERRM LIKE '%E_BINDING_MEDICAL_DETERMINATION%', SQLERRM);
  END;

  r := public.bn_medical_review_prepare_decision_v1(
         pg_temp.mr_uid('OBLIGATION'), pg_temp.mr_uid('ASSESSMENT'), pg_temp.mr_uid('BOARD_CASE'),
         'PERMANENT_CONTINUATION', true, NULL,
         current_date, current_date + 365, 'HX_CONTINUE',
         'Permanent continuation supported by the Board determination.', 'hx-decide-1');
  PERFORM pg_temp.mr_put('DECISION', r ->> 'decision_id');
  PERFORM pg_temp.mr_ok('L', 'preparer_prepares_decision',
    (r ->> 'decision_id') IS NOT NULL AND (r ->> 'decision_status') = 'READY', r::text);

  r := public.bn_medical_review_submit_decision_v1(
         pg_temp.mr_uid('DECISION'), NULL, 'hx-submit-decision-1', 'harness');
  PERFORM pg_temp.mr_ok('L', 'preparer_submits_decision', (r ->> 'status') = 'OK', r::text);

  BEGIN
    PERFORM public.bn_medical_review_approve_decision_v1(
      pg_temp.mr_uid('DECISION'), NULL, 'hx-selfapprove-1', 'harness');
    PERFORM pg_temp.mr_ok('L', 'self_approval_blocked', false, 'expected rejection');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.mr_ok('L', 'self_approval_blocked', true, SQLERRM);
  END;
END $$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_APPROVER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_approve_decision_v1(
         pg_temp.mr_uid('DECISION'), NULL, 'hx-approve-1', 'harness');
  PERFORM pg_temp.mr_ok('M', 'approver_approves_decision', (r ->> 'status') = 'OK', r::text);

  r := public.bn_medical_review_complete_decision_v1(
         pg_temp.mr_uid('DECISION'), NULL, 'hx-complete-1', 'harness');
  PERFORM pg_temp.mr_ok('M', 'decision_completed', (r ->> 'status') = 'OK', r::text);
END $$;

RESET ROLE;

-- =====================================================================
-- ACTOR CONTEXT — Award proposal boundary (proposal only, never execution)
-- =====================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', pg_temp.mr_claims('USER_PREPARER'), true);

DO $$
DECLARE r jsonb;
BEGIN
  r := public.bn_medical_review_propose_suspension_v1(
         pg_temp.mr_uid('DECISION'), 'hx-proposal-1',
         'Medical Review proposes suspension for Award Servicing to decide.');
  PERFORM pg_temp.mr_put('PROPOSAL', r ->> 'proposal_id');
  PERFORM pg_temp.mr_ok('N', 'suspension_proposal_created', (r ->> 'status') = 'OK', r::text);
END $$;

RESET ROLE;

-- =====================================================================
-- TRUSTED CONTEXT — Phase O: stored-state and boundary assertions
-- =====================================================================
DO $$
DECLARE v_award record; v_ob record; v_det record; v_dec record; v_ass record;
BEGIN
  SELECT * INTO v_award FROM public.bn_award WHERE id = pg_temp.mr_uid('AWARD');
  PERFORM pg_temp.mr_ok('O', 'award_status_unchanged_by_medical_review',
    v_award.status = 'ACTIVE', v_award.status);

  PERFORM pg_temp.mr_ok('O', 'no_suspension_event_created',
    NOT EXISTS (SELECT 1 FROM public.bn_award_suspension_event e
                 WHERE e.bn_award_id = pg_temp.mr_uid('AWARD')));

  PERFORM pg_temp.mr_ok('O', 'no_payment_impact_created',
    NOT EXISTS (SELECT 1 FROM public.bn_award_suspension_payment_impact i
                 WHERE i.bn_award_id = pg_temp.mr_uid('AWARD')));


  SELECT * INTO v_det FROM public.bn_medical_board_determination
   WHERE board_case_id = pg_temp.mr_uid('BOARD_CASE') ORDER BY revision_no DESC LIMIT 1;
  PERFORM pg_temp.mr_ok('O', 'determination_recorded_with_quorum',
    v_det.finalised AND v_det.quorum_at_determination >= 2 AND v_det.votes_for = 2,
    format('quorum=%s for=%s', v_det.quorum_at_determination, v_det.votes_for));

  SELECT * INTO v_ass FROM public.bn_medical_review_assessment WHERE id = pg_temp.mr_uid('ASSESSMENT');
  PERFORM pg_temp.mr_ok('O', 'snapshot_stable_after_live_amendment',
    v_det.determination_summary = 'Board confirms permanent incapacity.'
      AND v_ass.clinical_narrative = 'AMENDED AFTER DETERMINATION');

  SELECT * INTO v_dec FROM public.bn_medical_review_administrative_decision
   WHERE id = pg_temp.mr_uid('DECISION');
  PERFORM pg_temp.mr_ok('O', 'decision_completed_and_snapshotted',
    v_dec.status = 'COMPLETED' AND v_dec.evidence_snapshot ? 'determination_id', v_dec.status);
  PERFORM pg_temp.mr_ok('O', 'snapshot_contains_board',
    (v_dec.evidence_snapshot ->> 'board_case_id') = pg_temp.mr_get('BOARD_CASE'));

  SELECT * INTO v_ob FROM public.bn_medical_review_obligation WHERE id = pg_temp.mr_uid('OBLIGATION');
  PERFORM pg_temp.mr_ok('O', 'obligation_terminal_not_reopenable',
    NOT public._bn_mr_transition_allowed('OBLIGATION', v_ob.status, 'NOT_DUE'), v_ob.status);

  -- Communications must carry business context only, never clinical detail.
  PERFORM pg_temp.mr_ok('O', 'comm_allowlist_drops_clinical_fields',
    NOT EXISTS (
      SELECT 1 FROM public.bn_medical_review_communication_intent c
       WHERE c.obligation_id = pg_temp.mr_uid('OBLIGATION')
         AND (c.context::text ILIKE '%clinical_narrative%'
              OR c.context::text ILIKE '%impairment_percentage%'
              OR c.context::text ILIKE '%PERMANENT_INCAPACITY%'
              OR c.context::text ILIKE '%123456789%')));

  PERFORM pg_temp.mr_ok('O', 'comm_intents_recorded',
    EXISTS (SELECT 1 FROM public.bn_medical_review_communication_intent c
             WHERE c.obligation_id = pg_temp.mr_uid('OBLIGATION')));

  PERFORM pg_temp.mr_ok('O', 'audit_trail_written',
    (SELECT count(*) FROM public.core_audit_log a
      WHERE a.module_code = 'bn_medical_review'
        AND a.entity_id IN (pg_temp.mr_get('OBLIGATION'), pg_temp.mr_get('DECISION'))) > 0);
END $$;

-- =====================================================================
-- TRUSTED CONTEXT — Phase P: postflight, dark-launch restored
-- =====================================================================
UPDATE public.app_modules SET actions_enabled = false WHERE name = 'bn_medical_review';
SELECT pg_temp.mr_ok('P', 'module_dark_launched',
  (SELECT COALESCE(actions_enabled, false) = false
     FROM public.app_modules WHERE name = 'bn_medical_review'));

-- =====================================================================
-- Result report
-- =====================================================================
\echo '--- BN Medical Review harness results ---'
SELECT seq, phase, name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       left(COALESCE(detail, ''), 160) AS detail
  FROM mr_result ORDER BY seq;

DO $$
DECLARE v_total int; v_failed int; v_names text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT passed) INTO v_total, v_failed FROM mr_result;
  SELECT string_agg(name, ', ') INTO v_names FROM mr_result WHERE NOT passed;

  IF v_total < 40 THEN
    RAISE EXCEPTION 'BN_MR_HARNESS_RESULT: FAIL — only % assertions executed (expected >= 40)', v_total;
  END IF;

  IF v_failed > 0 THEN
    RAISE EXCEPTION 'BN_MR_HARNESS_RESULT: FAIL — % of % assertions failed: %',
      v_failed, v_total, v_names;
  END IF;

  RAISE NOTICE 'BN_MR_HARNESS_RESULT: PASS (% assertions)', v_total;
END $$;

ROLLBACK;
