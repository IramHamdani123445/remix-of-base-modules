-- =====================================================================
-- BN Award Suspension — SEEDED database integration harness
--
-- Everything the scenario needs is created inside ONE transaction that is
-- ROLLED BACK at the end. The harness NEVER depends on pre-existing
-- business rows and NEVER skips a scenario: a missing precondition raises
-- and fails the run.
--
--   scripts/bn/run-award-suspension-db-tests.sh
--   (or: psql "$BN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/bn/award_suspension_integration.sql)
--
-- ACTIVATION SAFETY
--   The module gate (app_modules.actions_enabled) is flipped ON *inside the
--   rolled-back transaction only*. No environment is ever activated by this
--   harness: the ROLLBACK at the end restores the dark-launch posture, and
--   the harness asserts that posture on entry.
--
-- Execution contexts
--   * Every lifecycle RPC runs under role `authenticated` with
--     request.jwt.claims set, so auth.uid(), permission checks, approval
--     policy and workbasket routing all execute normally.
-- =====================================================================
\set ON_ERROR_STOP on
\timing off
BEGIN;

SET LOCAL client_min_messages = notice;

-- Deterministic identifiers -------------------------------------------------
\set u_prop   '''a5a5a5a5-0000-4000-8000-000000000001'''
\set u_appr   '''a5a5a5a5-0000-4000-8000-000000000002'''
\set u_exec   '''a5a5a5a5-0000-4000-8000-000000000003'''
\set u_none   '''a5a5a5a5-0000-4000-8000-000000000004'''
\set product  '''b5b5b5b5-0000-4000-8000-000000000001'''
\set pversion '''b5b5b5b5-0000-4000-8000-000000000002'''
\set claim_id '''c5c5c5c5-0000-4000-8000-000000000001'''
\set award_id '''d5d5d5d5-0000-4000-8000-000000000001'''
\set award_2  '''d5d5d5d5-0000-4000-8000-000000000002'''
\set basket   '''e5e5e5e5-0000-4000-8000-000000000001'''
\set policy   '''f5f5f5f5-0000-4000-8000-000000000001'''

-- =====================================================================
-- 0. Structural preconditions (hard failures, never skips)
-- =====================================================================
DO $pre$
DECLARE
  v_missing text;
BEGIN
  FOREACH v_missing IN ARRAY ARRAY[
    'public.bn_award_suspension_propose_v1(uuid,text,date,text,text,text)',
    'public.bn_award_suspension_approve_v1(uuid,uuid,text,integer,text,text)',
    'public.bn_award_suspension_reject_v1(uuid,uuid,text,text,integer,text,text)',
    'public.bn_award_suspension_withdraw_v1(uuid,text,integer,text,text)',
    'public.bn_award_suspension_execute_v1(uuid,integer,text,text,text)',
    'public.bn_award_reinstatement_propose_v1(uuid,text,date,text,text,text)',
    'public.bn_award_reinstatement_approve_v1(uuid,uuid,text,integer,text,text)',
    'public.bn_award_reinstatement_execute_v1(uuid,integer,text,text,text)'
  ] LOOP
    IF to_regprocedure(v_missing) IS NULL THEN
      RAISE EXCEPTION 'FAIL: RPC % is missing', v_missing;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name = 'bn_award_suspension') THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension module not registered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.core_workflow_definition
                  WHERE workflow_code = 'BN_AWARD_SUSPENSION' AND is_active) THEN
    RAISE EXCEPTION 'FAIL: BN_AWARD_SUSPENSION workflow definition missing';
  END IF;
  IF (SELECT count(*) FROM public.core_workflow_step s
        JOIN public.core_workflow_definition d ON d.id = s.workflow_definition_id
       WHERE d.workflow_code = 'BN_AWARD_SUSPENSION') < 5 THEN
    RAISE EXCEPTION 'FAIL: BN_AWARD_SUSPENSION workflow steps missing';
  END IF;
  IF (SELECT count(*) FROM public.module_actions ma
        JOIN public.app_modules m ON m.id = ma.module_id
       WHERE m.name = 'bn_award_suspension') < 11 THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension action catalogue incomplete';
  END IF;

  -- Dark-launch posture must hold BEFORE the harness enables the gate
  -- inside this transaction. A database that is already activated is not a
  -- valid harness target.
  IF (SELECT actions_enabled FROM public.app_modules WHERE name = 'bn_award_suspension') THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension is already activated on this database';
  END IF;
END $pre$;

-- =====================================================================
-- 1. Identity, roles, permissions, workbasket routing
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
VALUES (:u_prop::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'bn-susp-proposer@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
       (:u_appr::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'bn-susp-approver@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
       (:u_exec::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'bn-susp-executor@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
       (:u_none::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'bn-susp-nopriv@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.profiles (id, first_name, last_name, full_name, email, user_code, is_active)
VALUES (:u_prop::uuid, 'BN', 'Proposer', 'BN Susp Proposer', 'bn-susp-proposer@test.local', 'BNSPROP', true),
       (:u_appr::uuid, 'BN', 'Approver', 'BN Susp Approver', 'bn-susp-approver@test.local', 'BNSAPPR', true),
       (:u_exec::uuid, 'BN', 'Executor', 'BN Susp Executor', 'bn-susp-executor@test.local', 'BNSEXEC', true),
       (:u_none::uuid, 'BN', 'Nopriv',   'BN Susp Nopriv',   'bn-susp-nopriv@test.local',   'BNSNONE', true);

INSERT INTO public.roles (id, role_name, description, is_active, is_system_role, mfa_required)
SELECT gen_random_uuid(), v.role_name, 'award suspension harness', true, false, false
  FROM (VALUES ('SUSP_PROPOSER'), ('SUSP_APPROVER'), ('SUSP_EXECUTOR'), ('SUSP_VIEWER')) AS v(role_name)
 WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.role_name = v.role_name);

INSERT INTO public.user_roles (user_id, role) VALUES
  (:u_prop::uuid, 'SUSP_PROPOSER'),
  (:u_appr::uuid, 'SUSP_APPROVER'),
  (:u_exec::uuid, 'SUSP_EXECUTOR'),
  (:u_none::uuid, 'SUSP_VIEWER')
ON CONFLICT DO NOTHING;

-- Least-privilege matrix: each actor holds ONLY the actions its journey needs.
INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, m.id, ma.id, true
  FROM public.roles r
  JOIN public.app_modules m ON m.name = 'bn_award_suspension'
  JOIN public.module_actions ma ON ma.module_id = m.id
  JOIN (VALUES
    ('SUSP_PROPOSER', 'view'),  ('SUSP_PROPOSER', 'propose'), ('SUSP_PROPOSER', 'resume_propose'),
    ('SUSP_APPROVER', 'view'),  ('SUSP_APPROVER', 'approve'), ('SUSP_APPROVER', 'resume_approve'),
    ('SUSP_EXECUTOR', 'view'),  ('SUSP_EXECUTOR', 'execute'), ('SUSP_EXECUTOR', 'resume_execute'),
    ('SUSP_EXECUTOR', 'view_payment_impact'),
    ('SUSP_VIEWER',   'view')
  ) AS g(role_name, action_name)
    ON g.role_name = r.role_name AND g.action_name = ma.action_name
ON CONFLICT DO NOTHING;

UPDATE public.role_permissions rp SET is_granted = true
  FROM public.roles r, public.app_modules m, public.module_actions ma
 WHERE rp.role_id = r.id AND rp.module_id = m.id AND rp.action_id = ma.id
   AND m.name = 'bn_award_suspension'
   AND r.role_name IN ('SUSP_PROPOSER','SUSP_APPROVER','SUSP_EXECUTOR','SUSP_VIEWER');

-- Workbasket routing for the approval policy.
INSERT INTO public.bn_workbasket (id, basket_code, basket_name, assigned_role, is_active)
VALUES (:basket::uuid, 'SUSP_L1', 'Suspension approvals (level 1)', 'SUSP_APPROVER', true);

INSERT INTO public.bn_workbasket_role (workbasket_id, role_name, is_primary)
VALUES (:basket::uuid, 'SUSP_APPROVER', true);

DO $chk$
BEGIN
  IF NOT public.has_permission('a5a5a5a5-0000-4000-8000-000000000001'::uuid,'bn_award_suspension','propose') THEN
    RAISE EXCEPTION 'FAIL: proposer grant did not take effect';
  END IF;
  IF public.has_permission('a5a5a5a5-0000-4000-8000-000000000001'::uuid,'bn_award_suspension','approve') THEN
    RAISE EXCEPTION 'FAIL: proposer must not hold approve';
  END IF;
  IF public.has_permission('a5a5a5a5-0000-4000-8000-000000000004'::uuid,'bn_award_suspension','propose') THEN
    RAISE EXCEPTION 'FAIL: viewer must not hold propose';
  END IF;
  IF public.is_admin('a5a5a5a5-0000-4000-8000-000000000001'::uuid) THEN
    RAISE EXCEPTION 'FAIL: harness actors must not be admins (permission checks would be bypassed)';
  END IF;
END $chk$;

-- =====================================================================
-- 2. Product, approval policy, reason codes, award
-- =====================================================================
INSERT INTO public.bn_product (id, benefit_code, benefit_name, category, branch, payment_type, country_code, status)
VALUES (:product::uuid, 'SUSPT', 'Suspension Harness Product', 'LONG_TERM', 'LT', 'PERIODIC', 'SKN', 'ACTIVE');

INSERT INTO public.bn_product_version (id, product_id, version_number, effective_from, status)
VALUES (:pversion::uuid, :product::uuid, 1, CURRENT_DATE - 1000, 'ACTIVE');

-- Exactly ONE enabled level-1 policy: the resolver rejects gaps, duplicates
-- and incomplete routing, so this row is part of the contract under test.
INSERT INTO public.bn_approval_policy
  (id, product_version_id, policy_area, action_code, level, is_enabled,
   approval_role, approval_workbasket_id, self_approval_allowed, restricted_action)
VALUES (:policy::uuid, :pversion::uuid, 'award_suspension', 'approve', 1, true,
        'SUSP_APPROVER', :basket::uuid, false, true);

INSERT INTO public.bn_reason_code (reason_code, reason_label, reason_category, applicable_actions, is_active)
VALUES ('SUSP_HARNESS', 'Harness suspension reason', 'SUSPENSION', ARRAY['suspend'], true),
       ('RESUME_HARNESS', 'Harness reinstatement reason', 'REINSTATEMENT', ARRAY['resume'], true);

INSERT INTO public.bn_claim (id, claim_number, ssn, product_id, status, assigned_to)
VALUES (:claim_id::uuid, 'SUSP-CLM-0001', '223456789', :product::uuid, 'APPROVED', 'BNSPROP');

-- frequency / base_amount / currency are required for the reinstatement
-- arrears calculation to resolve a rate instead of REVIEW_REQUIRED.
INSERT INTO public.bn_award (id, award_number, bn_claim_id, ssn, benefit_code, award_type, status, start_date, frequency, base_amount, currency)
VALUES (:award_id::uuid, 'SUSP-AWD-0001', :claim_id::uuid, '223456789', 'SUSPT', 'PENSION', 'ACTIVE', CURRENT_DATE - 500, 'MONTHLY', 1000.00, 'XCD'),
       (:award_2::uuid,  'SUSP-AWD-0002', :claim_id::uuid, '223456780', 'SUSPT', 'PENSION', 'ACTIVE', CURRENT_DATE - 500, 'MONTHLY', 1000.00, 'XCD');

-- =====================================================================
-- 3. Module gate: closed by default, opened for this transaction only
-- =====================================================================
DO $gate$
DECLARE v_err text;
BEGIN
  RAISE NOTICE '--- module gate ---';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a5a5a5a5-0000-4000-8000-000000000001","role":"authenticated"}', true);
  BEGIN
    PERFORM public.bn_award_suspension_propose_v1(
      'd5d5d5d5-0000-4000-8000-000000000001'::uuid, 'SUSP_HARNESS',
      CURRENT_DATE - 10, 'gate check', NULL, 'harness-gate');
    RAISE EXCEPTION 'FAIL: propose succeeded while the module was dark-launched';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_FEATURE_DISABLED' THEN
      RAISE EXCEPTION 'FAIL: expected E_FEATURE_DISABLED, got %', v_err;
    END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
END $gate$;

-- Transaction-scoped activation. Rolled back with everything else.
UPDATE public.app_modules SET actions_enabled = true WHERE name = 'bn_award_suspension';

-- =====================================================================
-- 4. Journey A — propose → approve → execute, under authenticated sessions
-- =====================================================================
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE bn_susp_harness_state (k text PRIMARY KEY, v text) ON COMMIT DROP;

SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000001","role":"authenticated"}';

DO $propose$
DECLARE v jsonb; v_err text;
BEGIN
  RAISE NOTICE '--- journey A: propose ---';

  -- Unknown reason code fails closed.
  BEGIN
    v := public.bn_award_suspension_propose_v1(
      'd5d5d5d5-0000-4000-8000-000000000001'::uuid, 'NOT_A_REASON',
      CURRENT_DATE - 10, 'bad reason', NULL, 'harness-a');
    RAISE EXCEPTION 'FAIL: invalid reason code accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_INVALID_REASON_CODE' THEN
      RAISE EXCEPTION 'FAIL: expected E_INVALID_REASON_CODE, got %', v_err; END IF;
  END;

  -- Effective date before award start fails closed.
  BEGIN
    v := public.bn_award_suspension_propose_v1(
      'd5d5d5d5-0000-4000-8000-000000000001'::uuid, 'SUSP_HARNESS',
      CURRENT_DATE - 5000, 'too early', NULL, 'harness-a');
    RAISE EXCEPTION 'FAIL: invalid effective date accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_INVALID_EFFECTIVE_DATE' THEN
      RAISE EXCEPTION 'FAIL: expected E_INVALID_EFFECTIVE_DATE, got %', v_err; END IF;
  END;

  v := public.bn_award_suspension_propose_v1(
    'd5d5d5d5-0000-4000-8000-000000000001'::uuid, 'SUSP_HARNESS',
    CURRENT_DATE - 10, 'harness proposal', 'idem-propose-a', 'harness-a');

  IF v->>'status' <> 'PROPOSED' THEN
    RAISE EXCEPTION 'FAIL: expected PROPOSED, got %', v->>'status'; END IF;
  IF v->>'suspension_id' IS NULL THEN
    RAISE EXCEPTION 'FAIL: propose returned no suspension_id'; END IF;

  INSERT INTO bn_susp_harness_state VALUES
    ('suspension_id', v->>'suspension_id'),
    ('task_id', v->>'task_id');

  -- Idempotent replay returns the same receipt, creates no second case.
  IF public.bn_award_suspension_propose_v1(
       'd5d5d5d5-0000-4000-8000-000000000001'::uuid, 'SUSP_HARNESS',
       CURRENT_DATE - 10, 'harness proposal', 'idem-propose-a', 'harness-a'
     )->>'suspension_id' <> v->>'suspension_id' THEN
    RAISE EXCEPTION 'FAIL: idempotent replay produced a different case';
  END IF;
  IF (SELECT count(*) FROM public.bn_award_suspension_event
       WHERE bn_award_id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid
         AND case_kind = 'SUSPENSION') <> 1 THEN
    RAISE EXCEPTION 'FAIL: idempotent replay created a duplicate case';
  END IF;

  -- A second open case on the same award is refused.
  BEGIN
    v := public.bn_award_suspension_propose_v1(
      'd5d5d5d5-0000-4000-8000-000000000001'::uuid, 'SUSP_HARNESS',
      CURRENT_DATE - 9, 'second case', NULL, 'harness-a');
    RAISE EXCEPTION 'FAIL: conflicting open case accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_CONFLICTING_OPEN_CASE' THEN
      RAISE EXCEPTION 'FAIL: expected E_CONFLICTING_OPEN_CASE, got %', v_err; END IF;
  END;

  -- Workflow spine exists and is routed to the approval step.
  IF NOT EXISTS (
    SELECT 1 FROM public.core_workflow_task t
      JOIN public.core_workflow_instance i ON i.id = t.workflow_instance_id
     WHERE t.id = (v->>'task_id')::uuid
       AND t.task_status = 'OPEN'
       AND t.step_code = 'PENDING_APPROVAL'
       AND i.entity_id = v->>'suspension_id') THEN
    RAISE EXCEPTION 'FAIL: approval task was not routed';
  END IF;
END $propose$;

-- Self-approval is refused even though the proposer would otherwise pass.
DO $selfapprove$
DECLARE v_err text; v_s uuid; v_t uuid;
BEGIN
  SELECT s.v::uuid INTO v_s FROM bn_susp_harness_state s WHERE s.k = 'suspension_id';
  SELECT s.v::uuid INTO v_t FROM bn_susp_harness_state s WHERE s.k = 'task_id';
  BEGIN
    PERFORM public.bn_award_suspension_approve_v1(v_s, v_t, 'self approval', 1, NULL, 'harness-a');
    RAISE EXCEPTION 'FAIL: proposer approved its own case';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT IN ('E_SELF_APPROVAL_FORBIDDEN','E_FORBIDDEN') THEN
      RAISE EXCEPTION 'FAIL: expected self-approval refusal, got %', v_err; END IF;
  END;
END $selfapprove$;

SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000002","role":"authenticated"}';

DO $approve$
DECLARE v jsonb; v_err text; v_s uuid; v_t uuid;
BEGIN
  RAISE NOTICE '--- journey A: approve ---';
  SELECT s.v::uuid INTO v_s FROM bn_susp_harness_state s WHERE s.k = 'suspension_id';
  SELECT s.v::uuid INTO v_t FROM bn_susp_harness_state s WHERE s.k = 'task_id';

  -- Stale row version is refused before any state change.
  BEGIN
    PERFORM public.bn_award_suspension_approve_v1(v_s, v_t, 'stale', 99, NULL, 'harness-a');
    RAISE EXCEPTION 'FAIL: stale row version accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_STALE_ROW_VERSION' THEN
      RAISE EXCEPTION 'FAIL: expected E_STALE_ROW_VERSION, got %', v_err; END IF;
  END;

  v := public.bn_award_suspension_approve_v1(v_s, v_t, 'approved by harness', 1,
                                             'idem-approve-a', 'harness-a');
  IF v->>'status' <> 'APPROVED' THEN
    RAISE EXCEPTION 'FAIL: expected APPROVED, got %', v->>'status'; END IF;

  IF (SELECT status FROM public.bn_award_suspension_event WHERE id = v_s) <> 'APPROVED' THEN
    RAISE EXCEPTION 'FAIL: case row not APPROVED'; END IF;
  IF (SELECT task_status FROM public.core_workflow_task WHERE id = v_t) <> 'COMPLETED' THEN
    RAISE EXCEPTION 'FAIL: approval task not completed'; END IF;

  -- The award must NOT move on approval: only execution applies the change.
  IF (SELECT status FROM public.bn_award WHERE id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FAIL: approval applied the suspension to the award';
  END IF;
END $approve$;

SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000004","role":"authenticated"}';

DO $forbidden$
DECLARE v_err text; v_s uuid;
BEGIN
  RAISE NOTICE '--- least privilege ---';
  SELECT s.v::uuid INTO v_s FROM bn_susp_harness_state s WHERE s.k = 'suspension_id';
  BEGIN
    PERFORM public.bn_award_suspension_execute_v1(v_s, 2, 'no privilege', NULL, 'harness-a');
    RAISE EXCEPTION 'FAIL: view-only user executed a suspension';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_FORBIDDEN' THEN
      RAISE EXCEPTION 'FAIL: expected E_FORBIDDEN, got %', v_err; END IF;
  END;
END $forbidden$;

SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000003","role":"authenticated"}';

DO $execute$
DECLARE v jsonb; v_s uuid; v_rv int;
BEGIN
  RAISE NOTICE '--- journey A: execute ---';
  SELECT s.v::uuid INTO v_s FROM bn_susp_harness_state s WHERE s.k = 'suspension_id';
  SELECT row_version INTO v_rv FROM public.bn_award_suspension_event WHERE id = v_s;

  v := public.bn_award_suspension_execute_v1(v_s, v_rv, 'executed by harness',
                                             'idem-execute-a', 'harness-a');
  IF v->>'status' <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FAIL: expected suspension ACTIVE after execution, got % (error_code=%)',
      v->>'status', v->>'error_code';
  END IF;
  IF (SELECT status FROM public.bn_award WHERE id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid) <> 'SUSPENDED' THEN
    RAISE EXCEPTION 'FAIL: award was not suspended by execution'; END IF;
  IF (SELECT execution_status FROM public.bn_award_suspension_event WHERE id = v_s) <> 'EXECUTED' THEN
    RAISE EXCEPTION 'FAIL: execution_status not EXECUTED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_award_status_event
                  WHERE bn_award_id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid
                    AND to_status = 'SUSPENDED') THEN
    RAISE EXCEPTION 'FAIL: no award status event recorded'; END IF;

  -- Idempotent replay must not double-apply.
  IF public.bn_award_suspension_execute_v1(v_s, v_rv, 'executed by harness',
       'idem-execute-a', 'harness-a')->>'status' <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FAIL: idempotent execute replay changed the outcome'; END IF;
  IF (SELECT count(*) FROM public.bn_award_status_event
       WHERE bn_award_id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid
         AND to_status = 'SUSPENDED') <> 1 THEN
    RAISE EXCEPTION 'FAIL: idempotent execute replay applied the suspension twice'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.core_audit_log
                  WHERE entity_id = v_s::text AND event_code = 'BN.SUSPENSION.EXECUTED') THEN
    RAISE EXCEPTION 'FAIL: execution was not audited'; END IF;
END $execute$;

-- =====================================================================
-- 5. Journey B — reinstatement: propose → approve → execute
-- =====================================================================
SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000001","role":"authenticated"}';

DO $rprop$
DECLARE v jsonb; v_err text; v_s uuid;
BEGIN
  RAISE NOTICE '--- journey B: reinstatement propose ---';
  SELECT s.v::uuid INTO v_s FROM bn_susp_harness_state s WHERE s.k = 'suspension_id';

  -- Narrative is mandatory on reinstatement.
  BEGIN
    PERFORM public.bn_award_reinstatement_propose_v1(v_s, 'RESUME_HARNESS',
      CURRENT_DATE - 1, '', NULL, 'harness-b');
    RAISE EXCEPTION 'FAIL: empty reinstatement narrative accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_NARRATIVE_REQUIRED' THEN
      RAISE EXCEPTION 'FAIL: expected E_NARRATIVE_REQUIRED, got %', v_err; END IF;
  END;

  v := public.bn_award_reinstatement_propose_v1(v_s, 'RESUME_HARNESS',
    CURRENT_DATE - 1, 'harness reinstatement', 'idem-rprop-b', 'harness-b');
  IF v->>'status' <> 'REINSTATEMENT_PROPOSED' THEN
    RAISE EXCEPTION 'FAIL: expected REINSTATEMENT_PROPOSED, got %', v->>'status'; END IF;

  INSERT INTO bn_susp_harness_state VALUES
    ('reinstatement_id', coalesce(v->>'reinstatement_id', v->>'suspension_id')),
    ('reinstatement_task_id', v->>'task_id');

  -- A second open reinstatement is refused.
  BEGIN
    PERFORM public.bn_award_reinstatement_propose_v1(v_s, 'RESUME_HARNESS',
      CURRENT_DATE - 1, 'duplicate', NULL, 'harness-b');
    RAISE EXCEPTION 'FAIL: conflicting reinstatement accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_CONFLICTING_OPEN_CASE' THEN
      RAISE EXCEPTION 'FAIL: expected E_CONFLICTING_OPEN_CASE, got %', v_err; END IF;
  END;
END $rprop$;

SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000002","role":"authenticated"}';

DO $rappr$
DECLARE v jsonb; v_r uuid; v_t uuid; v_rv int;
BEGIN
  RAISE NOTICE '--- journey B: reinstatement approve ---';
  SELECT s.v::uuid INTO v_r FROM bn_susp_harness_state s WHERE s.k = 'reinstatement_id';
  SELECT s.v::uuid INTO v_t FROM bn_susp_harness_state s WHERE s.k = 'reinstatement_task_id';
  SELECT row_version INTO v_rv FROM public.bn_award_suspension_event WHERE id = v_r;

  v := public.bn_award_reinstatement_approve_v1(v_r, v_t, 'approved', v_rv,
                                                'idem-rappr-b', 'harness-b');
  IF (SELECT status FROM public.bn_award_suspension_event WHERE id = v_r)
       <> 'REINSTATEMENT_APPROVED' THEN
    RAISE EXCEPTION 'FAIL: reinstatement not approved (status=%)',
      (SELECT status FROM public.bn_award_suspension_event WHERE id = v_r);
  END IF;
  IF (SELECT status FROM public.bn_award WHERE id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid) <> 'SUSPENDED' THEN
    RAISE EXCEPTION 'FAIL: reinstatement approval reactivated the award prematurely';
  END IF;
END $rappr$;

SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000003","role":"authenticated"}';

DO $rexec$
DECLARE v jsonb; v_r uuid; v_s uuid; v_rv int;
BEGIN
  RAISE NOTICE '--- journey B: reinstatement execute ---';
  SELECT s.v::uuid INTO v_r FROM bn_susp_harness_state s WHERE s.k = 'reinstatement_id';
  SELECT s.v::uuid INTO v_s FROM bn_susp_harness_state s WHERE s.k = 'suspension_id';
  SELECT row_version INTO v_rv FROM public.bn_award_suspension_event WHERE id = v_r;

  v := public.bn_award_reinstatement_execute_v1(v_r, v_rv, 'reinstated by harness',
                                                'idem-rexec-b', 'harness-b');

  IF (SELECT status FROM public.bn_award WHERE id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FAIL: award was not reinstated (result=%)', v; END IF;
  IF (SELECT status FROM public.bn_award_suspension_event WHERE id = v_s) <> 'RESUMED' THEN
    RAISE EXCEPTION 'FAIL: original suspension not marked RESUMED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_award_status_event
                  WHERE bn_award_id = 'd5d5d5d5-0000-4000-8000-000000000001'::uuid
                    AND to_status = 'ACTIVE' AND from_status = 'SUSPENDED') THEN
    RAISE EXCEPTION 'FAIL: no reinstatement status event recorded'; END IF;
END $rexec$;

-- =====================================================================
-- 6. Journey C — rejection and withdrawal terminate cleanly
-- =====================================================================
SET LOCAL request.jwt.claims = '{"sub":"a5a5a5a5-0000-4000-8000-000000000001","role":"authenticated"}';

DO $journeyc$
DECLARE v jsonb; v_s uuid; v_t uuid; v_rv int;
BEGIN
  RAISE NOTICE '--- journey C: reject then withdraw ---';

  v := public.bn_award_suspension_propose_v1(
    'd5d5d5d5-0000-4000-8000-000000000002'::uuid, 'SUSP_HARNESS',
    CURRENT_DATE - 8, 'to be rejected', NULL, 'harness-c');
  v_s := (v->>'suspension_id')::uuid;
  v_t := (v->>'task_id')::uuid;
  SELECT row_version INTO v_rv FROM public.bn_award_suspension_event WHERE id = v_s;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"a5a5a5a5-0000-4000-8000-000000000002","role":"authenticated"}', true);
  PERFORM public.bn_award_suspension_reject_v1(v_s, v_t, 'SUSP_HARNESS',
    'rejected by harness', v_rv, NULL, 'harness-c');

  IF (SELECT status FROM public.bn_award_suspension_event WHERE id = v_s) <> 'REJECTED' THEN
    RAISE EXCEPTION 'FAIL: case not REJECTED'; END IF;
  IF (SELECT status FROM public.bn_award WHERE id = 'd5d5d5d5-0000-4000-8000-000000000002'::uuid) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'FAIL: rejection changed the award'; END IF;

  -- Rejection closes the case, so a fresh proposal is allowed and can be withdrawn.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a5a5a5a5-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v := public.bn_award_suspension_propose_v1(
    'd5d5d5d5-0000-4000-8000-000000000002'::uuid, 'SUSP_HARNESS',
    CURRENT_DATE - 7, 'to be withdrawn', NULL, 'harness-c');
  v_s := (v->>'suspension_id')::uuid;
  SELECT row_version INTO v_rv FROM public.bn_award_suspension_event WHERE id = v_s;

  PERFORM public.bn_award_suspension_withdraw_v1(v_s, 'withdrawn by harness', v_rv,
                                                 NULL, 'harness-c');
  IF (SELECT status FROM public.bn_award_suspension_event WHERE id = v_s) <> 'WITHDRAWN' THEN
    RAISE EXCEPTION 'FAIL: case not WITHDRAWN'; END IF;
  IF EXISTS (SELECT 1 FROM public.core_workflow_task t
               JOIN public.core_workflow_instance i ON i.id = t.workflow_instance_id
              WHERE i.entity_id = v_s::text AND t.task_status = 'OPEN') THEN
    RAISE EXCEPTION 'FAIL: withdrawal left an open approval task'; END IF;
END $journeyc$;

RESET ROLE;

-- =====================================================================
-- 7. Result
-- =====================================================================
DO $done$
BEGIN
  RAISE NOTICE 'BN_SUSP_HARNESS_RESULT: PASS (all journeys executed, nothing skipped)';
END $done$;

ROLLBACK;
