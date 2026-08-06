-- =====================================================================
-- BN Award Suspension — ISOLATED TEST ENVIRONMENT SEED (persistent)
--
-- Provisions the infrastructure required for Wave 1 controlled UAT on an
-- isolated non-production database:
--
--   1. exactly one public.platform_environment_marker row (TEST, activation
--      allowed) carrying the isolated Test project reference
--   2. four synthetic UAT actors with least-privilege role grants
--   3. synthetic product / approval policy / reason configuration
--   4. synthetic claims, awards and payment schedules
--
-- SAFETY
--   * Refuses to run when the target looks like Production/Live, when the
--     Lovable Cloud live project ref is present, or when the module is
--     already activated.
--   * NEVER flips app_modules.actions_enabled. Dark launch is preserved and
--     asserted at the end (actions_enabled = false, rollout_state READ_ONLY).
--   * Contains ONLY synthetic data. No real claimant, award or payment rows.
--
-- Usage:
--   psql "$BN_SUSP_DB_URL" -v ON_ERROR_STOP=1 \
--     -v env_project_ref="'<isolated-test-project-ref>'" \
--     -v env_label="'BN Award Suspension UAT (Test)'" \
--     -f supabase/test-support/award_suspension_test_environment_seed.sql
-- =====================================================================
\set ON_ERROR_STOP on
\if :{?env_project_ref}
\else
\echo 'FAIL: -v env_project_ref=<ref> is required'
\quit 1
\endif
\if :{?env_label}
\else
\set env_label '''Isolated BN Award Suspension Test database'''
\endif

BEGIN;

-- Expose the requested project reference to the PL/pgSQL guard blocks
-- (psql variables are not interpolated inside dollar-quoted bodies).
SELECT set_config('bn_provision.project_ref', :env_project_ref, true);

-- Deterministic synthetic identifiers (UAT namespace: a7/b7/c7/d7/e7/f7).
\set u_officer    '''a7a7a7a7-0000-4000-8000-000000000001'''
\set u_supervisor '''a7a7a7a7-0000-4000-8000-000000000002'''
\set u_manager    '''a7a7a7a7-0000-4000-8000-000000000003'''
\set u_auditor    '''a7a7a7a7-0000-4000-8000-000000000004'''
\set product      '''b7b7b7b7-0000-4000-8000-000000000001'''
\set pversion     '''b7b7b7b7-0000-4000-8000-000000000002'''
\set claim_id     '''c7c7c7c7-0000-4000-8000-000000000001'''
\set award_1      '''d7d7d7d7-0000-4000-8000-000000000001'''
\set award_2      '''d7d7d7d7-0000-4000-8000-000000000002'''
\set award_3      '''d7d7d7d7-0000-4000-8000-000000000003'''
\set basket       '''e7e7e7e7-0000-4000-8000-000000000001'''
\set policy       '''f7f7f7f7-0000-4000-8000-000000000001'''

-- =====================================================================
-- 0. Non-production guards (fail closed)
-- =====================================================================
DO $guard$
DECLARE
  v_db   text := current_database();
  v_ref  text := current_setting('bn_provision.project_ref', true);
BEGIN
  IF v_ref IS NULL OR btrim(v_ref) = '' THEN
    RAISE EXCEPTION 'FAIL: env_project_ref must be a non-empty isolated Test project reference';
  END IF;
  IF v_ref = 'xynceskeiiisiefqlgxo' THEN
    RAISE EXCEPTION 'FAIL: refusing the denylisted live project ref';
  END IF;
  IF lower(v_db) ~ '(prod|production|live|prd|release)' THEN
    RAISE EXCEPTION 'FAIL: database name "%" looks like a production target', v_db;
  END IF;
  IF lower(v_ref) ~ '(prod|production|live|prd|release)' THEN
    RAISE EXCEPTION 'FAIL: project ref "%" looks like a production target', v_ref;
  END IF;

  IF to_regclass('public.platform_environment_marker') IS NULL THEN
    RAISE EXCEPTION 'FAIL: platform_environment_marker missing — apply the baseline and forward migrations first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_environment_marker
              WHERE environment_kind = 'PRODUCTION') THEN
    RAISE EXCEPTION 'FAIL: this database is already marked as PRODUCTION';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name = 'bn_award_suspension') THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension module is not registered (migrations incomplete)';
  END IF;
  IF (SELECT actions_enabled FROM public.app_modules WHERE name = 'bn_award_suspension') THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension is already activated — not a valid provisioning target';
  END IF;
END $guard$;

-- =====================================================================
-- 1. Canonical environment marker (exactly one row)
-- =====================================================================
DELETE FROM public.platform_environment_marker;
INSERT INTO public.platform_environment_marker
  (id, environment_kind, environment_label, project_ref,
   allows_controlled_test_activation, notes)
VALUES (true, 'TEST', :env_label, :env_project_ref, true,
        'Provisioned by supabase/test-support/award_suspension_test_environment_seed.sql for Award Suspension Wave 1 controlled UAT. Synthetic data only.');

-- =====================================================================
-- 2. Synthetic UAT actors
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
VALUES
  ('a7a7a7a7-0000-4000-8000-000000000001'::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-claims-officer@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('a7a7a7a7-0000-4000-8000-000000000002'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-supervisor@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('a7a7a7a7-0000-4000-8000-000000000003'::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-manager@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('a7a7a7a7-0000-4000-8000-000000000004'::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-auditor@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, first_name, last_name, full_name, email, user_code, is_active)
VALUES
  ('a7a7a7a7-0000-4000-8000-000000000001'::uuid,    'UAT', 'Claims Officer', 'UAT Claims Officer', 'bn-uat-claims-officer@test.local', 'UATCLM', true),
  ('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'UAT', 'Supervisor',     'UAT Supervisor',     'bn-uat-supervisor@test.local',     'UATSUP', true),
  ('a7a7a7a7-0000-4000-8000-000000000003'::uuid,    'UAT', 'Manager',        'UAT Manager',        'bn-uat-manager@test.local',        'UATMGR', true),
  ('a7a7a7a7-0000-4000-8000-000000000004'::uuid,    'UAT', 'Auditor',        'UAT Auditor',        'bn-uat-auditor@test.local',        'UATAUD', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, role_name, description, is_active, is_system_role, mfa_required)
SELECT gen_random_uuid(), v.role_name, 'Award Suspension controlled UAT actor', true, false, false
  FROM (VALUES ('BN_CLAIMS_OFFICER'), ('BN_SUPERVISOR'), ('BN_MANAGER'), ('BN_AUDITOR')) AS v(role_name)
 WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.role_name = v.role_name);

INSERT INTO public.user_roles (user_id, role) VALUES
  ('a7a7a7a7-0000-4000-8000-000000000001'::uuid,    'BN_CLAIMS_OFFICER'),
  ('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'BN_SUPERVISOR'),
  ('a7a7a7a7-0000-4000-8000-000000000003'::uuid,    'BN_MANAGER'),
  ('a7a7a7a7-0000-4000-8000-000000000004'::uuid,    'BN_AUDITOR')
ON CONFLICT DO NOTHING;

-- Least-privilege matrix: maker / checker / executor / auditor.
INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, m.id, ma.id, true
  FROM public.roles r
  JOIN public.app_modules m ON m.name = 'bn_award_suspension'
  JOIN public.module_actions ma ON ma.module_id = m.id
  JOIN (VALUES
    ('BN_CLAIMS_OFFICER', 'view'),
    ('BN_CLAIMS_OFFICER', 'propose'),
    ('BN_CLAIMS_OFFICER', 'resume_propose'),
    ('BN_CLAIMS_OFFICER', 'withdraw'),
    ('BN_SUPERVISOR',     'view'),
    ('BN_SUPERVISOR',     'approve'),
    ('BN_SUPERVISOR',     'resume_approve'),
    ('BN_MANAGER',        'view'),
    ('BN_MANAGER',        'execute'),
    ('BN_MANAGER',        'resume_execute'),
    ('BN_MANAGER',        'view_payment_impact'),
    ('BN_AUDITOR',        'view'),
    ('BN_AUDITOR',        'view_payment_impact')
  ) AS g(role_name, action_name)
    ON g.role_name = r.role_name AND g.action_name = ma.action_name
ON CONFLICT DO NOTHING;

UPDATE public.role_permissions rp SET is_granted = true
  FROM public.roles r, public.app_modules m, public.module_actions ma
 WHERE rp.role_id = r.id AND rp.module_id = m.id AND rp.action_id = ma.id
   AND m.name = 'bn_award_suspension'
   AND r.role_name IN ('BN_CLAIMS_OFFICER','BN_SUPERVISOR','BN_MANAGER','BN_AUDITOR');

-- Workbasket routing consumed by the approval policy resolver.
INSERT INTO public.bn_workbasket (id, basket_code, basket_name, assigned_role, is_active)
VALUES ('e7e7e7e7-0000-4000-8000-000000000001'::uuid, 'BN_SUSP_UAT_L1', 'Award Suspension UAT approvals (level 1)', 'BN_SUPERVISOR', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bn_workbasket_role (workbasket_id, role_name, is_primary)
VALUES ('e7e7e7e7-0000-4000-8000-000000000001'::uuid, 'BN_SUPERVISOR', true)
ON CONFLICT DO NOTHING;

-- =====================================================================
-- 3. Synthetic product, approval policy and reason configuration
-- =====================================================================
INSERT INTO public.bn_product (id, benefit_code, benefit_name, category, branch, payment_type, country_code, status)
VALUES ('b7b7b7b7-0000-4000-8000-000000000001'::uuid, 'UATSP', 'UAT Suspension Product (synthetic)', 'LONG_TERM', 'LT', 'PERIODIC', 'SKN', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bn_product_version (id, product_id, version_number, effective_from, status)
VALUES ('b7b7b7b7-0000-4000-8000-000000000002'::uuid, 'b7b7b7b7-0000-4000-8000-000000000001'::uuid, 1, CURRENT_DATE - 1000, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bn_approval_policy
  (id, product_version_id, policy_area, action_code, level, is_enabled,
   approval_role, approval_workbasket_id, self_approval_allowed, restricted_action)
VALUES ('f7f7f7f7-0000-4000-8000-000000000001'::uuid, 'b7b7b7b7-0000-4000-8000-000000000002'::uuid, 'award_suspension', 'approve', 1, true,
        'BN_SUPERVISOR', 'e7e7e7e7-0000-4000-8000-000000000001'::uuid, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bn_reason_code (reason_code, reason_label, reason_category, applicable_actions, is_active)
VALUES ('SUSP_UAT_NONCOMPLIANCE', 'UAT — obligation not met', 'SUSPENSION',    ARRAY['suspend'], true),
       ('SUSP_UAT_REVIEW',        'UAT — under review',      'SUSPENSION',    ARRAY['suspend'], true),
       ('RESUME_UAT_COMPLIANT',   'UAT — obligation met',    'REINSTATEMENT', ARRAY['resume'],  true)
ON CONFLICT DO NOTHING;

-- =====================================================================
-- 4. Synthetic claims, awards and payment schedules (no real data)
-- =====================================================================
INSERT INTO public.bn_claim (id, claim_number, ssn, product_id, status, assigned_to)
VALUES ('c7c7c7c7-0000-4000-8000-000000000001'::uuid, 'UAT-CLM-0001', '900000001', 'b7b7b7b7-0000-4000-8000-000000000001'::uuid, 'APPROVED', 'UATCLM')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bn_award (id, award_number, bn_claim_id, ssn, benefit_code, award_type,
                             status, start_date, frequency, base_amount, currency)
VALUES
  ('d7d7d7d7-0000-4000-8000-000000000001'::uuid, 'UAT-AWD-0001', 'c7c7c7c7-0000-4000-8000-000000000001'::uuid, '900000001', 'UATSP', 'PENSION', 'ACTIVE', CURRENT_DATE - 500, 'MONTHLY', 1200.00, 'XCD'),
  ('d7d7d7d7-0000-4000-8000-000000000002'::uuid, 'UAT-AWD-0002', 'c7c7c7c7-0000-4000-8000-000000000001'::uuid, '900000002', 'UATSP', 'PENSION', 'ACTIVE', CURRENT_DATE - 400, 'MONTHLY',  850.00, 'XCD'),
  ('d7d7d7d7-0000-4000-8000-000000000003'::uuid, 'UAT-AWD-0003', 'c7c7c7c7-0000-4000-8000-000000000001'::uuid, '900000003', 'UATSP', 'PENSION', 'ACTIVE', CURRENT_DATE - 300, 'MONTHLY',  640.00, 'XCD')
ON CONFLICT (id) DO NOTHING;

-- Six future monthly schedule rows per award: the payment-impact projection
-- needs pending instalments to hold or release.
INSERT INTO public.bn_payment_schedule
  (id, bn_award_id, schedule_period, due_date, gross_amount, net_amount, deductions,
   status, payment_method, notes, entered_by, entered_at, modified_by, modified_at)
SELECT gen_random_uuid(),
       a.id,
       (date_trunc('month', CURRENT_DATE) + make_interval(months => g.n))::date,
       (date_trunc('month', CURRENT_DATE) + make_interval(months => g.n) + interval '7 days')::date,
       a.base_amount, a.base_amount, 0,
       'PENDING', 'EFT', 'Synthetic UAT schedule', 'UATCLM', now(), 'UATCLM', now()
  FROM public.bn_award a
  CROSS JOIN generate_series(0, 5) AS g(n)
 WHERE a.id IN ('d7d7d7d7-0000-4000-8000-000000000001'::uuid, 'd7d7d7d7-0000-4000-8000-000000000002'::uuid, 'd7d7d7d7-0000-4000-8000-000000000003'::uuid)
   AND NOT EXISTS (
     SELECT 1 FROM public.bn_payment_schedule s
      WHERE s.bn_award_id = a.id
        AND s.schedule_period = (date_trunc('month', CURRENT_DATE) + make_interval(months => g.n))::date);

-- =====================================================================
-- 4b. Dark-launch posture normalisation (tightening only, never activation)
--
-- `READ_ONLY` is the canonical dark-launch posture used by
-- scripts/bn/activate-award-suspension-test.sh. Some databases still carry
-- the legacy app_modules_rollout_state_check constraint that only permits
-- hidden/internal_pilot/public. The literal value is written ONLY when the
-- constraint allows it; otherwise the posture stays read-only by virtue of
-- actions_enabled = false, which is what every RPC gate actually reads.
-- =====================================================================
DO $posture$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'app_modules_rollout_state_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%READ_ONLY%'
  ) THEN
    RAISE NOTICE 'BN_SUSP_PROVISION_NOTE: legacy rollout_state constraint present; posture is enforced by actions_enabled=false';
  ELSE
    UPDATE public.app_modules
       SET rollout_state = 'READ_ONLY'
     WHERE name = 'bn_award_suspension'
       AND actions_enabled = false
       AND rollout_state IS DISTINCT FROM 'READ_ONLY';
  END IF;
END $posture$;

-- =====================================================================
-- 5. Postflight assertions
-- =====================================================================
DO $post$
DECLARE
  v_rows int;
  m record;
BEGIN
  SELECT count(*) INTO v_rows FROM public.platform_environment_marker;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected exactly one environment marker row, found %', v_rows;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_environment_marker
                  WHERE environment_kind = 'TEST' AND allows_controlled_test_activation) THEN
    RAISE EXCEPTION 'FAIL: marker is not a TEST marker allowing controlled activation';
  END IF;

  SELECT actions_enabled, rollout_state INTO m
    FROM public.app_modules WHERE name = 'bn_award_suspension';
  IF m.actions_enabled THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension.actions_enabled must remain false after provisioning';
  END IF;
  IF m.rollout_state NOT IN ('READ_ONLY','hidden','internal_pilot','public') THEN
    RAISE EXCEPTION 'FAIL: unexpected rollout_state %', m.rollout_state;
  END IF;


  IF (SELECT count(*) FROM public.roles
       WHERE role_name IN ('BN_CLAIMS_OFFICER','BN_SUPERVISOR','BN_MANAGER','BN_AUDITOR')) <> 4 THEN
    RAISE EXCEPTION 'FAIL: UAT actor roles incomplete';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000001'::uuid, 'bn_award_suspension', 'propose') THEN
    RAISE EXCEPTION 'FAIL: BN_CLAIMS_OFFICER did not receive propose';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000001'::uuid, 'bn_award_suspension', 'approve') THEN
    RAISE EXCEPTION 'FAIL: BN_CLAIMS_OFFICER must not hold approve';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'bn_award_suspension', 'approve') THEN
    RAISE EXCEPTION 'FAIL: BN_SUPERVISOR did not receive approve';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'bn_award_suspension', 'execute') THEN
    RAISE EXCEPTION 'FAIL: BN_SUPERVISOR must not hold execute';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000003'::uuid, 'bn_award_suspension', 'execute') THEN
    RAISE EXCEPTION 'FAIL: BN_MANAGER did not receive execute';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000004'::uuid, 'bn_award_suspension', 'propose') THEN
    RAISE EXCEPTION 'FAIL: BN_AUDITOR must be read-only';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000004'::uuid, 'bn_award_suspension', 'view_payment_impact') THEN
    RAISE EXCEPTION 'FAIL: BN_AUDITOR did not receive view_payment_impact';
  END IF;

  IF (SELECT count(*) FROM public.bn_award
       WHERE id IN ('d7d7d7d7-0000-4000-8000-000000000001'::uuid, 'd7d7d7d7-0000-4000-8000-000000000002'::uuid, 'd7d7d7d7-0000-4000-8000-000000000003'::uuid)) <> 3 THEN
    RAISE EXCEPTION 'FAIL: synthetic awards missing';
  END IF;
  IF (SELECT count(*) FROM public.bn_payment_schedule
       WHERE bn_award_id IN ('d7d7d7d7-0000-4000-8000-000000000001'::uuid, 'd7d7d7d7-0000-4000-8000-000000000002'::uuid, 'd7d7d7d7-0000-4000-8000-000000000003'::uuid)) < 18 THEN
    RAISE EXCEPTION 'FAIL: synthetic payment schedules incomplete';
  END IF;

  RAISE NOTICE 'BN_SUSP_PROVISION_RESULT: PASS';
END $post$;

COMMIT;

\echo '--- environment marker ---'
SELECT environment_kind, environment_label, project_ref,
       allows_controlled_test_activation, current_database() AS database_name
  FROM public.platform_environment_marker;

\echo '--- module status ---'
SELECT name, is_enabled, routes_enabled, actions_enabled, rollout_state
  FROM public.app_modules WHERE name = 'bn_award_suspension';

\echo '--- UAT actors ---'
SELECT p.id AS actor_id, p.email, p.user_code, ur.role
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
 WHERE p.email LIKE 'bn-uat-%@test.local'
 ORDER BY ur.role;
