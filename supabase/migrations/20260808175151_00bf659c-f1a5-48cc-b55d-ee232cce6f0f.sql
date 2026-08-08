-- Nested Benefits sub-screen navigation for the four newest modules.
-- Sub-screens are menu nodes only: they carry no permissions of their own and
-- inherit view access from their parent module, which remains the single
-- authoritative access boundary (enforced by BnModuleRouteGate at runtime).

ALTER TABLE public.app_modules
  ADD COLUMN IF NOT EXISTS inherits_parent_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_modules.inherits_parent_access IS
  'Menu-only child screen: visible whenever the parent module is visible. Carries no independent permission.';

-- ---------------------------------------------------------------- sub-screens

INSERT INTO public.app_modules
  (name, display_name, description, icon, route, parent_id, sort_order,
   is_enabled, show_in_menu, routes_enabled, actions_enabled,
   rollout_state, internal_only, inherits_parent_access)
VALUES
  -- Means-Test Assessments
  ('bn_means_tests_overview','Overview','Means-Test module overview and work areas','LayoutDashboard','/bn/means-tests','760f025c-3013-4b8a-8cf9-52ecba927718',10,true,true,true,false,'internal_pilot',false,true),
  ('bn_means_tests_assessments','Assessments','Operational queues and assessment search','ClipboardList','/bn/means-tests/assessments','760f025c-3013-4b8a-8cf9-52ecba927718',20,true,true,true,false,'internal_pilot',false,true),
  ('bn_means_tests_verification','Verification','Verification work queue','ShieldCheck','/bn/means-tests/verification','760f025c-3013-4b8a-8cf9-52ecba927718',30,true,true,true,false,'internal_pilot',false,true),
  ('bn_means_tests_decisions','Decisions','Adjustment and approval work','Gavel','/bn/means-tests/decisions','760f025c-3013-4b8a-8cf9-52ecba927718',40,true,true,true,false,'internal_pilot',false,true),
  ('bn_means_tests_reassessments','Reassessments','Reassessment work queue','RefreshCw','/bn/means-tests/reassessments','760f025c-3013-4b8a-8cf9-52ecba927718',50,true,true,true,false,'internal_pilot',false,true),
  ('bn_means_tests_configuration','Configuration','Governed Means-Test policy configuration','Settings','/bn/means-tests/configuration','760f025c-3013-4b8a-8cf9-52ecba927718',60,true,true,true,false,'internal_pilot',false,true),

  -- Fraud, Error & Risk
  ('bn_risk_overview','Overview','Risk operational position','LayoutDashboard','/bn/risk-management','c3e1c0b3-a579-42fc-9fc4-474ecaeac269',10,true,true,true,false,'internal_pilot',false,true),
  ('bn_risk_signals','Signals','Signal intake and triage','Radar','/bn/risk-management/signals','c3e1c0b3-a579-42fc-9fc4-474ecaeac269',20,true,true,true,false,'internal_pilot',false,true),
  ('bn_risk_assessments','Assessments','Risk assessment work','ClipboardList','/bn/risk-management/assessments','c3e1c0b3-a579-42fc-9fc4-474ecaeac269',30,true,true,true,false,'internal_pilot',false,true),
  ('bn_risk_controls','Controls & outcomes','Control decisions, execution and outcomes','ShieldAlert','/bn/risk-management/controls','c3e1c0b3-a579-42fc-9fc4-474ecaeac269',40,true,true,true,false,'internal_pilot',false,true),
  ('bn_risk_reporting','Reporting','Aggregate risk evidence','BarChart3','/bn/risk-management/reporting','c3e1c0b3-a579-42fc-9fc4-474ecaeac269',50,true,true,true,false,'internal_pilot',false,true),
  ('bn_risk_configuration','Configuration','Scoring rule-set configuration','Settings','/bn/risk-management/configuration','c3e1c0b3-a579-42fc-9fc4-474ecaeac269',60,true,true,true,false,'internal_pilot',false,true),

  -- Uprating & Indexation
  ('bn_uprating_overview','Overview','Uprating overview and outstanding work','LayoutDashboard','/bn/uprating','e6340360-c102-4a84-8275-25416a906b0d',10,true,true,true,false,'internal_pilot',false,true),
  ('bn_uprating_policies','Policy catalogue','Governed uprating policies and versions','BookOpen','/bn/uprating/policies','e6340360-c102-4a84-8275-25416a906b0d',20,true,true,true,false,'internal_pilot',false,true),
  ('bn_uprating_runs','Runs & simulation','Run preparation and deterministic simulation','TrendingUp','/bn/uprating/runs','e6340360-c102-4a84-8275-25416a906b0d',30,true,true,true,false,'internal_pilot',false,true),
  ('bn_uprating_approvals','Approvals & scheduling','Independent approval and execution scheduling','Gavel','/bn/uprating/approvals','e6340360-c102-4a84-8275-25416a906b0d',40,true,true,true,false,'internal_pilot',false,true),
  ('bn_uprating_operations','Operational queues','Execution and post-execution work','ListChecks','/bn/uprating/operations','e6340360-c102-4a84-8275-25416a906b0d',50,true,true,true,false,'internal_pilot',false,true),

  -- Overpayment Recovery
  ('bn_overpayments_overview','Overview','Overpayment recovery position','LayoutDashboard','/bn/overpayments','921bbdf2-06c7-48d5-9e05-efed0231f4d7',10,true,true,true,false,'internal_pilot',false,true),
  ('bn_overpayments_cases','Cases','Overpayment case worklist','Banknote','/bn/overpayments/cases','921bbdf2-06c7-48d5-9e05-efed0231f4d7',20,true,true,true,false,'internal_pilot',false,true)
ON CONFLICT (name) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    route = EXCLUDED.route,
    parent_id = EXCLUDED.parent_id,
    sort_order = EXCLUDED.sort_order,
    is_enabled = true,
    show_in_menu = true,
    routes_enabled = true,
    inherits_parent_access = true,
    updated_at = now();

-- ------------------------------------------------- navigation RPC: descendants
CREATE OR REPLACE FUNCTION public.get_user_accessible_modules(_user_id uuid)
 RETURNS TABLE(id uuid, name text, display_name text, icon text, route text, parent_id uuid, sort_order integer, description text, base_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_admin(_user_id) THEN
    RETURN QUERY
    SELECT
      m.id, m.name, m.display_name, m.icon, m.route, m.parent_id,
      m.sort_order, m.description, m.base_url
    FROM app_modules m
    WHERE m.is_enabled = true
      AND m.show_in_menu = true
      AND m.routes_enabled = true
      AND public.check_module_rollout_access(
        _user_id, m.rollout_state, m.internal_only,
        m.pilot_user_ids, m.pilot_role_ids
      )
    ORDER BY m.sort_order NULLS LAST, m.display_name;
  ELSE
    RETURN QUERY
    WITH RECURSIVE permitted_modules AS (
      SELECT DISTINCT m2.id AS module_id
      FROM app_modules m2
      INNER JOIN module_actions ma ON ma.module_id = m2.id
      INNER JOIN role_permissions rp ON rp.module_id = m2.id AND rp.action_id = ma.id
      INNER JOIN roles r ON r.id = rp.role_id
      INNER JOIN user_roles ur ON ur.role::text = r.role_name
      WHERE ur.user_id = _user_id
        AND m2.is_enabled = true
        AND m2.show_in_menu = true
        AND m2.routes_enabled = true
        AND ma.action_name = 'view'
        AND ma.is_enabled = true
        AND rp.is_granted = true
        AND public.check_module_rollout_access(
          _user_id, m2.rollout_state, m2.internal_only,
          m2.pilot_user_ids, m2.pilot_role_ids
        )
    ),
    -- Menu-only sub-screens inherit visibility from their permitted parent.
    inherited_children AS (
      SELECT m.id AS module_id
      FROM app_modules m
      INNER JOIN permitted_modules pm ON pm.module_id = m.parent_id
      WHERE m.inherits_parent_access = true
        AND m.is_enabled = true
        AND m.show_in_menu = true
        AND m.routes_enabled = true
        AND public.check_module_rollout_access(
          _user_id, m.rollout_state, m.internal_only,
          m.pilot_user_ids, m.pilot_role_ids
        )
      UNION
      SELECT m.id
      FROM app_modules m
      INNER JOIN inherited_children ic ON ic.module_id = m.parent_id
      WHERE m.inherits_parent_access = true
        AND m.is_enabled = true
        AND m.show_in_menu = true
        AND m.routes_enabled = true
    ),
    seed AS (
      SELECT module_id FROM permitted_modules
      UNION
      SELECT module_id FROM inherited_children
    ),
    ancestor_chain AS (
      SELECT m.id AS module_id, m.parent_id
      FROM app_modules m
      INNER JOIN seed s ON s.module_id = m.id
      UNION
      SELECT m.id, m.parent_id
      FROM app_modules m
      INNER JOIN ancestor_chain ac ON ac.parent_id = m.id
    ),
    all_visible AS (
      SELECT module_id FROM ancestor_chain
    )
    SELECT
      m.id, m.name, m.display_name, m.icon, m.route, m.parent_id,
      m.sort_order, m.description, m.base_url
    FROM app_modules m
    INNER JOIN all_visible av ON av.module_id = m.id
    WHERE m.is_enabled = true
      AND m.show_in_menu = true
      AND m.routes_enabled = true
    ORDER BY m.sort_order NULLS LAST, m.display_name;
  END IF;
END;
$function$;