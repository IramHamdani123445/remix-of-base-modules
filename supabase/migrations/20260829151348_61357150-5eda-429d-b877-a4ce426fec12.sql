-- Actor code helper used by the governed arrangement RPCs.
CREATE OR REPLACE FUNCTION public.ce_actor_code(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT i.inspector_code FROM public.ce_inspectors i WHERE i.profile_id = _user_id LIMIT 1),
    (SELECT p.email FROM public.profiles p WHERE p.id = _user_id LIMIT 1),
    _user_id::text
  );
$$;
REVOKE ALL ON FUNCTION public.ce_actor_code(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ce_actor_code(uuid) TO authenticated, service_role;

-- Arrangement approval is a governance capability: head/senior only, never a
-- blanket-permission fallback.
CREATE OR REPLACE FUNCTION public.ce_actor_can(_user_id uuid, _capability text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_role text;
  v_caps text[];
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_admin(_user_id) THEN RETURN true; END IF;

  v_role := public.ce_compliance_role(_user_id);

  v_caps := CASE v_role
    WHEN 'head' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.cases.approve_requests',
      'compliance.cases.view_confidential_documents','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.workbench.enterprise',
      'compliance.reports.operational','compliance.reports.analytics',
      'compliance.config.manage','compliance.schedule.manage',
      'compliance.waiver.approve','compliance.waiver.approve_high',
      'compliance.legal.override','compliance.workflow.override',
      'compliance.partial_payment.request','compliance.partial_payment.approve',
      'compliance.review_flag.review','compliance.management.resolve',
      'compliance.employer_status.change','compliance.benchmark.override',
      'compliance.registration_lead.manage','compliance.legal.recommend_approve',
      'compliance.exemption.manage','compliance.arrangement.approve']
    WHEN 'senior' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.reports.operational',
      'compliance.waiver.approve',
      'compliance.partial_payment.request','compliance.partial_payment.approve',
      'compliance.review_flag.review','compliance.employer_status.change',
      'compliance.registration_lead.manage','compliance.legal.recommend_approve',
      'compliance.exemption.manage','compliance.arrangement.approve']
    WHEN 'inspector' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.report',
      'compliance.violations.manage','compliance.cases.manage',
      'compliance.enforcement.notices','compliance.reports.operational',
      'compliance.partial_payment.request','compliance.registration_lead.manage']
    ELSE ARRAY[]::text[]
  END;

  IF _capability = ANY (v_caps) THEN RETURN true; END IF;

  IF _capability IN ('compliance.config.manage','compliance.schedule.manage',
                     'compliance.waiver.approve_high','compliance.legal.override',
                     'compliance.workflow.override','compliance.partial_payment.approve',
                     'compliance.review_flag.review','compliance.management.resolve',
                     'compliance.employer_status.change','compliance.benchmark.override',
                     'compliance.legal.recommend_approve','compliance.exemption.manage',
                     'compliance.arrangement.approve') THEN
    RETURN false;
  END IF;

  IF _capability = 'compliance.partial_payment.request' THEN
    RETURN public.has_permission(_user_id, 'c3_payments', 'create')
        OR public.has_permission(_user_id, 'c3_payments', 'edit');
  END IF;

  IF _capability = 'compliance.waiver.approve' THEN
    RETURN public.has_permission(_user_id, 'manage_compliance', 'approve');
  END IF;

  RETURN public.has_permission(_user_id, 'manage_compliance',
           CASE WHEN _capability LIKE '%.approve%' THEN 'approve' ELSE 'edit' END);
END;
$function$;