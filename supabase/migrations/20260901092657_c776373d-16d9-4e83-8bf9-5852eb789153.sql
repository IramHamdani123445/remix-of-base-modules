-- 1. Lock down ia_prior_action_reference: governed commands only
REVOKE ALL ON TABLE public.ia_prior_action_reference FROM authenticated;
REVOKE ALL ON TABLE public.ia_prior_action_reference FROM anon;
REVOKE ALL ON TABLE public.ia_prior_action_reference FROM PUBLIC;
GRANT ALL ON TABLE public.ia_prior_action_reference TO service_role;

-- 2. Canonical annual-plan view authorisation
CREATE OR REPLACE FUNCTION public.ia_can_view_annual_plan(p_plan_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF public.has_role(v_uid, 'Admin'::app_role) THEN RETURN true; END IF;

  -- canonical Annual Plan workspace capability
  IF NOT public.ia_actor_can('audit_plans', 'view') THEN RETURN false; END IF;

  -- plan governance personas see any plan
  IF public.ia_actor_can('audit_plans', 'edit')
     OR public.ia_actor_can('plan_approval', 'view')
     OR public.ia_actor_can('audit_configuration', 'configure') THEN
    RETURN true;
  END IF;

  -- otherwise the caller must be a registered auditor or participate in the plan
  IF EXISTS (SELECT 1 FROM public.ia_auditors a
              WHERE (a.profile_id = v_uid OR a.user_id = v_uid)
                AND COALESCE(a.employment_status, 'Active') <> 'Inactive') THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.ia_audit_engagements e
     WHERE e.annual_plan_id = p_plan_id
       AND (e.lead_auditor_id = v_uid OR e.reviewer_id = v_uid)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ia_can_view_annual_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_can_view_annual_plan(uuid) TO authenticated, service_role;

-- 3. Gate the three portfolio read models
CREATE OR REPLACE FUNCTION public.ia_annual_plan_portfolio_summary(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_inner jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT public.ia_can_view_annual_plan(p_plan_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN');
  END IF;
  SELECT public.ia_annual_plan_portfolio_summary_core(p_plan_id) INTO v_inner;
  RETURN v_inner;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ia_annual_plan_coverage(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_inner jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT public.ia_can_view_annual_plan(p_plan_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN');
  END IF;
  SELECT public.ia_annual_plan_coverage_core(p_plan_id) INTO v_inner;
  RETURN v_inner;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ia_annual_plan_version_diff(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_inner jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT public.ia_can_view_annual_plan(p_plan_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN');
  END IF;
  SELECT public.ia_annual_plan_version_diff_core(p_plan_id) INTO v_inner;
  RETURN v_inner;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ia_annual_plan_portfolio_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_annual_plan_coverage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_annual_plan_version_diff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_annual_plan_portfolio_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_annual_plan_coverage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_annual_plan_version_diff(uuid) TO authenticated, service_role;

-- 4. Expected-access policy for sensitive IA capabilities
CREATE OR REPLACE FUNCTION public.ia_sensitive_capability_policy()
RETURNS TABLE(module_name text, action_name text, intended_roles text[])
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('audit_plans','create', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR']),
    ('audit_plans','edit',   ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR']),
    ('audit_plans','submit', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR']),
    ('audit_plans','delete', ARRAY['Admin']),
    ('plan_approval','approve', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('plan_approval','reject',  ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('audit_configuration','configure', ARRAY['Admin','IA_AUDIT_ADMIN','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('internal_audit_configuration','view', ARRAY['Admin','IA_AUDIT_ADMIN','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('audit_engagements','create', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR']),
    ('audit_engagements','edit',   ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR']),
    ('audit_engagements','launch', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR']),
    ('audit_engagements','assign', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR']),
    ('audit_engagements','close',  ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('quality_review','approve', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_QUALITY_REVIEWER']),
    ('quality_review','create',  ARRAY['Admin','IA_QUALITY_REVIEWER','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('action_tracking','create', ARRAY['Admin','IA_LEAD_AUDITOR','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('action_tracking','edit',   ARRAY['Admin','IA_LEAD_AUDITOR','IA_HEAD_OF_INTERNAL_AUDIT','IA_MANAGEMENT_RESPONDENT']),
    ('action_tracking','close',  ARRAY['Admin','IA_LEAD_AUDITOR','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('action_tracking','verify', ARRAY['Admin','IA_LEAD_AUDITOR','IA_HEAD_OF_INTERNAL_AUDIT','IA_QUALITY_REVIEWER']),
    ('follow_up_tracker','create', ARRAY['Admin','IA_LEAD_AUDITOR','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('follow_up_tracker','edit',   ARRAY['Admin','IA_LEAD_AUDITOR','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('follow_up_tracker','close',  ARRAY['Admin','IA_LEAD_AUDITOR','IA_HEAD_OF_INTERNAL_AUDIT']),
    ('audit_risk_assessment','create', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR','IA_AUDIT_ADMIN']),
    ('audit_risk_assessment','edit',   ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT','IA_LEAD_AUDITOR','IA_AUDIT_ADMIN']),
    ('audit_risk_assessment','approve', ARRAY['Admin','IA_HEAD_OF_INTERNAL_AUDIT'])
  ) v(module_name, action_name, intended_roles);
$$;

REVOKE ALL ON FUNCTION public.ia_sensitive_capability_policy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_sensitive_capability_policy() TO authenticated, service_role;

-- 5. Reconciliation with OVER-BROAD classification
CREATE OR REPLACE FUNCTION public.ia_permission_reconciliation(p_expected jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_rows jsonb; v_unused jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_UNAUTHENTICATED');
  END IF;
  IF NOT (public.ia_actor_can('audit_configuration', 'configure')
          OR public.ia_actor_can('internal_audit_configuration', 'view')
          OR public.has_role(auth.uid(), 'Admin'::app_role)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN');
  END IF;

  WITH expected AS (
    SELECT e->>'capability' capability, e->>'module' module_name, e->>'action' action_name
      FROM jsonb_array_elements(COALESCE(p_expected, '[]'::jsonb)) e
  ), resolved AS (
    SELECT x.*,
           m.id module_id, m.is_enabled module_enabled,
           ma.id action_id, ma.is_enabled action_enabled,
           pol.intended_roles
      FROM expected x
      LEFT JOIN public.app_modules m ON m.name = x.module_name
      LEFT JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = x.action_name
      LEFT JOIN public.ia_sensitive_capability_policy() pol
             ON pol.module_name = x.module_name AND pol.action_name = x.action_name
  ), scored AS (
    SELECT r.*,
      COALESCE((SELECT jsonb_agg(DISTINCT ro.role_name)
                  FROM public.role_permissions rp
                  JOIN public.roles ro ON ro.id = rp.role_id
                 WHERE rp.module_id = r.module_id AND rp.action_id = r.action_id
                   AND COALESCE(rp.is_granted, false)), '[]'::jsonb) AS granted,
      COALESCE((SELECT jsonb_agg(DISTINCT ro.role_name)
                  FROM public.role_permissions rp
                  JOIN public.roles ro ON ro.id = rp.role_id
                 WHERE rp.module_id = r.module_id AND rp.action_id = r.action_id
                   AND COALESCE(rp.is_granted, false)
                   AND r.intended_roles IS NOT NULL
                   AND NOT (ro.role_name = ANY (r.intended_roles))), '[]'::jsonb) AS unexpected
      FROM resolved r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'capability', s.capability,
    'module', s.module_name,
    'action', s.action_name,
    'registry_status', CASE
        WHEN s.module_id IS NULL THEN 'MISSING_MODULE'
        WHEN s.action_id IS NULL THEN 'MISSING_ACTION'
        WHEN NOT COALESCE(s.module_enabled, false) OR NOT COALESCE(s.action_enabled, false) THEN 'DISABLED'
        ELSE 'REGISTERED' END,
    'roles_granted', s.granted,
    'grant_count', jsonb_array_length(s.granted),
    'sensitive', s.intended_roles IS NOT NULL,
    'intended_roles', COALESCE(to_jsonb(s.intended_roles), '[]'::jsonb),
    'unexpected_roles', s.unexpected,
    'final_status', CASE
        WHEN s.module_id IS NULL OR s.action_id IS NULL THEN 'MISSING'
        WHEN NOT COALESCE(s.module_enabled, false) OR NOT COALESCE(s.action_enabled, false) THEN 'MISMATCHED'
        WHEN jsonb_array_length(s.granted) = 0 THEN 'UNUSED'
        WHEN jsonb_array_length(s.unexpected) > 0 THEN 'OVER-BROAD'
        ELSE 'PASS' END
  ) ORDER BY s.capability, s.module_name, s.action_name), '[]'::jsonb) INTO v_rows FROM scored s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('module', m.name, 'action', ma.action_name)
                            ORDER BY m.name, ma.action_name), '[]'::jsonb) INTO v_unused
    FROM public.app_modules m
    JOIN public.module_actions ma ON ma.module_id = m.id
   WHERE m.name = ANY (public.ia_capability_modules())
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(p_expected, '[]'::jsonb)) e
        WHERE e->>'module' = m.name AND e->>'action' = ma.action_name);

  RETURN jsonb_build_object('success', true, 'rows', v_rows, 'registry_only', v_unused);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ia_permission_reconciliation(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_permission_reconciliation(jsonb) TO authenticated, service_role;