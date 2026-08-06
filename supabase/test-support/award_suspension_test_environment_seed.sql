-- =====================================================================
-- BN Award Suspension — ISOLATED TEST ENVIRONMENT SEED (persistent)
--
-- Provisions the infrastructure required for Wave 1 controlled UAT on an
-- isolated non-production database:
--
--   1. exactly one public.platform_environment_marker row (TEST, activation
--      allowed) carrying the isolated Test project reference — replaced only
--      when it is safe to do so, never deleted unconditionally
--   2. four synthetic DATABASE actor fixtures with an exact least-privilege
--      permission matrix (RPC/integration testing only — these are NOT
--      browser-login-ready accounts; see the runbook)
--   3. synthetic product / approval policy / reason configuration
--   4. synthetic claims, awards and payment schedules with coherent
--      claimant ownership (one claim per SSN per award)
--
-- SAFETY
--   * Refuses to run when the target looks like Production/Live, when the
--     Lovable Cloud live project ref is present, when an incompatible
--     environment marker already exists, or when the module is activated.
--   * NEVER flips app_modules.actions_enabled. Dark launch is preserved and
--     asserted at the end (actions_enabled = false → effective posture
--     READ_ONLY). rollout_state stays inside the shared enterprise
--     constraint (hidden | internal_pilot | public).
--   * Contains ONLY synthetic data. No real claimant, award or payment rows.
--   * No password, token or credential is written or printed.
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
SELECT set_config('bn_provision.env_label', :env_label, true);

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

  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name = 'bn_award_suspension') THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension module is not registered (migrations incomplete)';
  END IF;
  IF (SELECT actions_enabled FROM public.app_modules WHERE name = 'bn_award_suspension') THEN
    RAISE EXCEPTION 'FAIL: bn_award_suspension is already activated — not a valid provisioning target';
  END IF;
END $guard$;

-- =====================================================================
-- 1. Canonical environment marker — fail closed, never blindly replaced
--
--   0 rows                                      -> insert the TEST marker
--   1 TEST/LOCAL row with the same project ref  -> idempotent update
--   1 row, different ref or different kind      -> FAIL
--   >1 rows                                     -> FAIL
--   PRODUCTION / LIVE marker                    -> FAIL
--
-- There is deliberately NO automatic override. An operator who intends to
-- repurpose a database (for example one freshly bootstrapped and stamped
-- 'CI') must remove the existing marker explicitly and deliberately.
-- =====================================================================
DO $marker$
DECLARE
  v_rows  int;
  v_ref   text := current_setting('bn_provision.project_ref', true);
  v_label text := current_setting('bn_provision.env_label', true);
  m       record;
BEGIN
  SELECT count(*) INTO v_rows FROM public.platform_environment_marker;

  IF v_rows > 1 THEN
    RAISE EXCEPTION 'FAIL: platform_environment_marker holds % rows — ambiguous environment identity, failing closed', v_rows;
  END IF;

  IF v_rows = 0 THEN
    INSERT INTO public.platform_environment_marker
      (id, environment_kind, environment_label, project_ref,
       allows_controlled_test_activation, notes)
    VALUES (true, 'TEST', v_label, v_ref, true,
            'Provisioned by supabase/test-support/award_suspension_test_environment_seed.sql for Award Suspension Wave 1 controlled UAT. Synthetic data only.');
    RETURN;
  END IF;

  SELECT * INTO m FROM public.platform_environment_marker;

  IF upper(m.environment_kind::text) IN ('PRODUCTION', 'LIVE') THEN
    RAISE EXCEPTION 'FAIL: this database carries a % environment marker — refusing to provision', m.environment_kind;
  END IF;
  IF upper(m.environment_kind::text) <> 'TEST' THEN
    RAISE EXCEPTION 'FAIL: existing environment marker is "%", expected TEST — remove it deliberately before repurposing this database', m.environment_kind;
  END IF;
  IF coalesce(m.project_ref, '') <> v_ref THEN
    RAISE EXCEPTION 'FAIL: existing TEST marker names project ref "%", requested "%" — failing closed', coalesce(m.project_ref, '<null>'), v_ref;
  END IF;

  UPDATE public.platform_environment_marker
     SET environment_label = v_label,
         allows_controlled_test_activation = true,
         notes = 'Re-provisioned idempotently by award_suspension_test_environment_seed.sql. Synthetic data only.'
   WHERE id = true;
END $marker$;

-- =====================================================================
-- 2. Synthetic DATABASE actor fixtures
--
-- These rows exist so RPC-level and integration testing can execute under
-- a known identity. They are NOT interactive accounts: no usable password
-- is set and none may ever be. Browser UAT accounts are created separately
-- through the hosted Test Auth administration path (see the runbook).
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
VALUES
  ('a7a7a7a7-0000-4000-8000-000000000001'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-claims-officer@test.local', '', now(), now(), now(), '{}'::jsonb, '{"fixture":"db-only"}'::jsonb),
  ('a7a7a7a7-0000-4000-8000-000000000002'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-supervisor@test.local', '', now(), now(), now(), '{}'::jsonb, '{"fixture":"db-only"}'::jsonb),
  ('a7a7a7a7-0000-4000-8000-000000000003'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-manager@test.local', '', now(), now(), now(), '{}'::jsonb, '{"fixture":"db-only"}'::jsonb),
  ('a7a7a7a7-0000-4000-8000-000000000004'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bn-uat-auditor@test.local', '', now(), now(), now(), '{}'::jsonb, '{"fixture":"db-only"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, first_name, last_name, full_name, email, user_code, is_active)
VALUES
  ('a7a7a7a7-0000-4000-8000-000000000001'::uuid, 'UAT', 'Claims Officer', 'UAT Claims Officer', 'bn-uat-claims-officer@test.local', 'UATCLM', true),
  ('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'UAT', 'Supervisor',     'UAT Supervisor',     'bn-uat-supervisor@test.local',     'UATSUP', true),
  ('a7a7a7a7-0000-4000-8000-000000000003'::uuid, 'UAT', 'Manager',        'UAT Manager',        'bn-uat-manager@test.local',        'UATMGR', true),
  ('a7a7a7a7-0000-4000-8000-000000000004'::uuid, 'UAT', 'Auditor',        'UAT Auditor',        'bn-uat-auditor@test.local',        'UATAUD', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, role_name, description, is_active, is_system_role, mfa_required)
SELECT gen_random_uuid(), v.role_name, 'Award Suspension controlled UAT actor', true, false, false
  FROM (VALUES ('BN_CLAIMS_OFFICER'), ('BN_SUPERVISOR'), ('BN_MANAGER'), ('BN_AUDITOR')) AS v(role_name)
 WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.role_name = v.role_name);

INSERT INTO public.user_roles (user_id, role) VALUES
  ('a7a7a7a7-0000-4000-8000-000000000001'::uuid, 'BN_CLAIMS_OFFICER'),
  ('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'BN_SUPERVISOR'),
  ('a7a7a7a7-0000-4000-8000-000000000003'::uuid, 'BN_MANAGER'),
  ('a7a7a7a7-0000-4000-8000-000000000004'::uuid, 'BN_AUDITOR')
ON CONFLICT DO NOTHING;

-- =====================================================================
-- 2b. EXACT least-privilege permission matrix
--
-- Approved Benefits permission architecture (maker / checker / executor /
-- auditor, strict segregation of duties):
--
--   BN_CLAIMS_OFFICER (maker)   : view, propose, resume_propose, withdraw
--   BN_SUPERVISOR     (checker) : view, approve, resume_approve
--   BN_MANAGER        (executor): view, execute, resume_execute,
--                                 view_payment_impact,
--                                 resolve_payment_exception
--   BN_AUDITOR        (auditor) : view, audit, view_payment_impact
--
-- Approved reconciliations:
--   * BN_AUDITOR DOES receive `audit`  — audit read access is the whole
--     purpose of the role and carries no mutation.
--   * BN_AUDITOR DOES receive `view_payment_impact` — read-only financial
--     inspection is required to evidence a suspension's payment effect.
--   * BN_SUPERVISOR does NOT receive proposal actions (propose,
--     resume_propose, withdraw) — a checker may not author the item they
--     approve.
--   * BN_MANAGER does NOT receive approval actions (approve,
--     resume_approve) — an executor may not authorise its own execution.
--   * `reverse` is granted to no UAT role: reversal is an out-of-band
--     correction requiring separate authorisation and is out of Wave 1 scope.
--
-- Every non-expected Award Suspension action for these four roles is
-- explicitly set to is_granted = false. No unexpected positive grant may
-- survive this seed.
-- =====================================================================
CREATE TEMP TABLE bn_susp_expected_matrix(role_name text, action_name text) ON COMMIT DROP;
INSERT INTO bn_susp_expected_matrix(role_name, action_name) VALUES
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
  ('BN_MANAGER',        'resolve_payment_exception'),
  ('BN_AUDITOR',        'view'),
  ('BN_AUDITOR',        'audit'),
  ('BN_AUDITOR',        'view_payment_impact');

-- Upsert every expected pair with is_granted = true.
INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, m.id, ma.id, true
  FROM bn_susp_expected_matrix g
  JOIN public.roles r ON r.role_name = g.role_name
  JOIN public.app_modules m ON m.name = 'bn_award_suspension'
  JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = g.action_name
 WHERE NOT EXISTS (
   SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.action_id = ma.id);

UPDATE public.role_permissions rp
   SET is_granted = true
  FROM bn_susp_expected_matrix g
  JOIN public.roles r ON r.role_name = g.role_name
  JOIN public.app_modules m ON m.name = 'bn_award_suspension'
  JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = g.action_name
 WHERE rp.role_id = r.id AND rp.action_id = ma.id AND rp.is_granted IS DISTINCT FROM true;

-- Revoke every Award Suspension action that is NOT in the expected matrix
-- for the four UAT roles (targeted, never a broad blanket enable).
UPDATE public.role_permissions rp
   SET is_granted = false
  FROM public.roles r,
       public.app_modules m,
       public.module_actions ma
 WHERE rp.role_id = r.id
   AND rp.action_id = ma.id
   AND ma.module_id = m.id
   AND m.name = 'bn_award_suspension'
   AND r.role_name IN ('BN_CLAIMS_OFFICER','BN_SUPERVISOR','BN_MANAGER','BN_AUDITOR')
   AND NOT EXISTS (
     SELECT 1 FROM bn_susp_expected_matrix g
      WHERE g.role_name = r.role_name AND g.action_name = ma.action_name)
   AND rp.is_granted IS DISTINCT FROM false;

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
--
-- Fixture ownership model: one synthetic claim per synthetic claimant SSN,
-- and exactly one award per claim. Award.ssn always equals its claim.ssn so
-- record-scope checks can distinguish claimants correctly. SSNs 900000001-3
-- are reserved synthetic values and are not real claimant identifiers.
-- =====================================================================
INSERT INTO public.bn_claim (id, claim_number, ssn, product_id, status, assigned_to)
VALUES
  ('c7c7c7c7-0000-4000-8000-000000000001'::uuid, 'UAT-CLM-0001', '900000001', 'b7b7b7b7-0000-4000-8000-000000000001'::uuid, 'APPROVED', 'UATCLM'),
  ('c7c7c7c7-0000-4000-8000-000000000002'::uuid, 'UAT-CLM-0002', '900000002', 'b7b7b7b7-0000-4000-8000-000000000001'::uuid, 'APPROVED', 'UATCLM'),
  ('c7c7c7c7-0000-4000-8000-000000000003'::uuid, 'UAT-CLM-0003', '900000003', 'b7b7b7b7-0000-4000-8000-000000000001'::uuid, 'APPROVED', 'UATCLM')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bn_award (id, award_number, bn_claim_id, ssn, benefit_code, award_type,
                             status, start_date, frequency, base_amount, currency)
VALUES
  ('d7d7d7d7-0000-4000-8000-000000000001'::uuid, 'UAT-AWD-0001', 'c7c7c7c7-0000-4000-8000-000000000001'::uuid, '900000001', 'UATSP', 'PENSION', 'ACTIVE', CURRENT_DATE - 500, 'MONTHLY', 1200.00, 'XCD'),
  ('d7d7d7d7-0000-4000-8000-000000000002'::uuid, 'UAT-AWD-0002', 'c7c7c7c7-0000-4000-8000-000000000002'::uuid, '900000002', 'UATSP', 'PENSION', 'ACTIVE', CURRENT_DATE - 400, 'MONTHLY',  850.00, 'XCD'),
  ('d7d7d7d7-0000-4000-8000-000000000003'::uuid, 'UAT-AWD-0003', 'c7c7c7c7-0000-4000-8000-000000000003'::uuid, '900000003', 'UATSP', 'PENSION', 'ACTIVE', CURRENT_DATE - 300, 'MONTHLY',  640.00, 'XCD')
ON CONFLICT (id) DO NOTHING;

-- Repair ownership if an earlier provisioning run pointed every award at one claim.
UPDATE public.bn_award a
   SET bn_claim_id = c.id
  FROM public.bn_claim c
 WHERE c.ssn = a.ssn
   AND a.id IN ('d7d7d7d7-0000-4000-8000-000000000001'::uuid,
                'd7d7d7d7-0000-4000-8000-000000000002'::uuid,
                'd7d7d7d7-0000-4000-8000-000000000003'::uuid)
   AND a.bn_claim_id IS DISTINCT FROM c.id;

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
-- The shared enterprise constraint app_modules_rollout_state_check permits
-- only hidden | internal_pilot | public. Module-specific posture labels
-- (READ_ONLY / TEST_ACTIVE) are DERIVED from actions_enabled and are never
-- stored. Controlled Test provisioning parks the module at internal_pilot
-- with actions_enabled = false → effective posture READ_ONLY.
-- =====================================================================
UPDATE public.app_modules
   SET rollout_state = 'internal_pilot'
 WHERE name = 'bn_award_suspension'
   AND actions_enabled = false
   AND rollout_state IS DISTINCT FROM 'internal_pilot';

-- =====================================================================
-- 5. Postflight assertions
-- =====================================================================
DO $post$
DECLARE
  v_rows int;
  v_bad  text;
  m      record;
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
  IF m.rollout_state NOT IN ('hidden','internal_pilot','public') THEN
    RAISE EXCEPTION 'FAIL: rollout_state "%" violates the shared enterprise constraint', m.rollout_state;
  END IF;
  IF m.rollout_state <> 'internal_pilot' THEN
    RAISE EXCEPTION 'FAIL: expected rollout_state internal_pilot, found "%"', m.rollout_state;
  END IF;

  IF (SELECT count(*) FROM public.roles
       WHERE role_name IN ('BN_CLAIMS_OFFICER','BN_SUPERVISOR','BN_MANAGER','BN_AUDITOR')) <> 4 THEN
    RAISE EXCEPTION 'FAIL: UAT actor roles incomplete';
  END IF;

  -- --- every expected pair must be granted ---------------------------
  SELECT string_agg(g.role_name || ':' || g.action_name, ', ')
    INTO v_bad
    FROM bn_susp_expected_matrix g
    JOIN public.roles r ON r.role_name = g.role_name
    JOIN public.app_modules mm ON mm.name = 'bn_award_suspension'
    JOIN public.module_actions ma ON ma.module_id = mm.id AND ma.action_name = g.action_name
   WHERE NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.action_id = ma.id AND rp.is_granted);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: expected grants missing: %', v_bad;
  END IF;

  -- --- no unexpected positive grant may survive ----------------------
  SELECT string_agg(r.role_name || ':' || ma.action_name, ', ')
    INTO v_bad
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    JOIN public.module_actions ma ON ma.id = rp.action_id
    JOIN public.app_modules mm ON mm.id = ma.module_id AND mm.name = 'bn_award_suspension'
   WHERE r.role_name IN ('BN_CLAIMS_OFFICER','BN_SUPERVISOR','BN_MANAGER','BN_AUDITOR')
     AND rp.is_granted
     AND NOT EXISTS (
       SELECT 1 FROM bn_susp_expected_matrix g
        WHERE g.role_name = r.role_name AND g.action_name = ma.action_name);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: unexpected positive grants survived: %', v_bad;
  END IF;

  -- --- effective permission assertions (resolver level) --------------
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000001'::uuid, 'bn_award_suspension', 'propose') THEN
    RAISE EXCEPTION 'FAIL: BN_CLAIMS_OFFICER did not receive propose';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000001'::uuid, 'bn_award_suspension', 'approve') THEN
    RAISE EXCEPTION 'FAIL: BN_CLAIMS_OFFICER must not hold approve';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'bn_award_suspension', 'approve') THEN
    RAISE EXCEPTION 'FAIL: BN_SUPERVISOR did not receive approve';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'bn_award_suspension', 'propose') THEN
    RAISE EXCEPTION 'FAIL: BN_SUPERVISOR must not hold proposal actions';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000002'::uuid, 'bn_award_suspension', 'execute') THEN
    RAISE EXCEPTION 'FAIL: BN_SUPERVISOR must not hold execute';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000003'::uuid, 'bn_award_suspension', 'execute') THEN
    RAISE EXCEPTION 'FAIL: BN_MANAGER did not receive execute';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000003'::uuid, 'bn_award_suspension', 'approve') THEN
    RAISE EXCEPTION 'FAIL: BN_MANAGER must not hold approval actions';
  END IF;
  IF public.has_permission('a7a7a7a7-0000-4000-8000-000000000004'::uuid, 'bn_award_suspension', 'propose') THEN
    RAISE EXCEPTION 'FAIL: BN_AUDITOR must be read-only';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000004'::uuid, 'bn_award_suspension', 'audit') THEN
    RAISE EXCEPTION 'FAIL: BN_AUDITOR did not receive audit';
  END IF;
  IF NOT public.has_permission('a7a7a7a7-0000-4000-8000-000000000004'::uuid, 'bn_award_suspension', 'view_payment_impact') THEN
    RAISE EXCEPTION 'FAIL: BN_AUDITOR did not receive view_payment_impact';
  END IF;

  -- --- fixture ownership coherence -----------------------------------
  IF (SELECT count(*) FROM public.bn_award
       WHERE id IN ('d7d7d7d7-0000-4000-8000-000000000001'::uuid, 'd7d7d7d7-0000-4000-8000-000000000002'::uuid, 'd7d7d7d7-0000-4000-8000-000000000003'::uuid)) <> 3 THEN
    RAISE EXCEPTION 'FAIL: synthetic awards missing';
  END IF;
  SELECT string_agg(a.award_number, ', ') INTO v_bad
    FROM public.bn_award a
    JOIN public.bn_claim c ON c.id = a.bn_claim_id
   WHERE a.award_number LIKE 'UAT-AWD-%' AND c.ssn IS DISTINCT FROM a.ssn;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: award/claim ownership incoherent for: %', v_bad;
  END IF;
  IF (SELECT count(DISTINCT bn_claim_id) FROM public.bn_award
       WHERE award_number LIKE 'UAT-AWD-%') <> 3 THEN
    RAISE EXCEPTION 'FAIL: synthetic awards must each own a distinct claim';
  END IF;
  IF (SELECT count(DISTINCT ssn) FROM public.bn_claim WHERE claim_number LIKE 'UAT-CLM-%') <> 3 THEN
    RAISE EXCEPTION 'FAIL: synthetic claimants must be distinct';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_claim
              WHERE claim_number LIKE 'UAT-CLM-%'
                AND ssn NOT IN ('900000001','900000002','900000003')) THEN
    RAISE EXCEPTION 'FAIL: non-synthetic claimant identifier detected';
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

\echo '--- module status (effective posture READ_ONLY: actions_enabled = false) ---'
SELECT name, is_enabled, routes_enabled, actions_enabled, rollout_state,
       CASE WHEN actions_enabled THEN 'TEST_ACTIVE' ELSE 'READ_ONLY' END AS effective_posture
  FROM public.app_modules WHERE name = 'bn_award_suspension';

\echo '--- database actor fixtures (NOT browser-login accounts) ---'
SELECT p.id AS actor_id, p.email, p.user_code, ur.role
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
 WHERE p.email LIKE 'bn-uat-%@test.local'
 ORDER BY ur.role;
