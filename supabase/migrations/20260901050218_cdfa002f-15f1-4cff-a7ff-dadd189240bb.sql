CREATE OR REPLACE FUNCTION public.ce_waiver_detail_v1(p_waiver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_row jsonb;
  v_timeline jsonb;
  v_prior jsonb;
  v_sla numeric := public.ce_waiver_setting('APPROVAL_SLA_DAYS',5);
  v_soon numeric := public.ce_waiver_setting('DUE_SOON_DAYS',2);
  v_high numeric := public.ce_waiver_setting('HIGH_VALUE_AMOUNT',10000);
  v_minj numeric := public.ce_waiver_setting('MIN_JUSTIFICATION_CHARS',30);
  v_open boolean;
  v_waiting numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.cases.manage')
          OR public.ce_actor_can(v_uid,'compliance.waiver.approve')
          OR public.has_permission(v_uid,'manage_compliance','view')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  v_actor := public.ce_actor_user_code(v_uid);

  SELECT to_jsonb(g) INTO v_row FROM public.ce_v_waiver_register g WHERE g.waiver_id = p_waiver_id;
  IF v_row IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  v_open := (v_row->>'status_code') IN ('AWAITING_DECISION','ESCALATED');
  v_waiting := COALESCE((v_row->>'waiting_days')::numeric, 0);

  v_row := v_row || jsonb_build_object(
    'is_open', v_open,
    'sla_overdue', v_open AND v_waiting > v_sla,
    'sla_due_soon', v_open AND v_waiting <= v_sla AND v_waiting >= GREATEST(v_sla - v_soon, 0),
    'high_value', COALESCE((v_row->>'amount_requested')::numeric,0) >= v_high,
    'exceeds_rule_cap', (v_row->>'rule_cap_amount') IS NOT NULL
                        AND COALESCE((v_row->>'amount_requested')::numeric,0) > (v_row->>'rule_cap_amount')::numeric,
    'weak_justification', COALESCE(length(v_row->>'justification'),0) < v_minj,
    'approved_not_applied', (v_row->>'status_code') = 'APPROVED',
    'missing_linkage', (v_row->>'case_id') IS NULL AND (v_row->>'violation_id') IS NULL,
    'is_own_request', (v_row->>'requested_by') IS NOT NULL AND (v_row->>'requested_by') = v_actor
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', d.id, 'action', d.action,
           'from_status', d.from_status, 'to_status', d.to_status,
           'from_label', COALESCE(fs.label, d.from_status),
           'to_label',   COALESCE(ts.label, d.to_status),
           'amount', d.amount, 'reason', d.reason, 'comments', d.comments,
           'acted_by', d.acted_by,
           'acted_by_name', COALESCE(pr.full_name, d.acted_by),
           'acted_at', d.acted_at) ORDER BY d.acted_at),'[]'::jsonb)
    INTO v_timeline
  FROM public.ce_waiver_decisions d
  LEFT JOIN public.profiles pr ON pr.user_code = d.acted_by OR pr.employee_code = d.acted_by
  LEFT JOIN public.ce_waiver_ref fs ON fs.domain='STATUS' AND fs.code = public.ce_waiver_status_canonical(d.from_status)
  LEFT JOIN public.ce_waiver_ref ts ON ts.domain='STATUS' AND ts.code = public.ce_waiver_status_canonical(d.to_status)
  WHERE d.waiver_id = p_waiver_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'waiver_id', p.waiver_id, 'waiver_number', p.waiver_number,
           'status_label', p.status_label, 'component_label', p.component_label,
           'amount_requested', p.amount_requested, 'amount_approved', p.amount_approved,
           'requested_at', p.requested_at) ORDER BY p.requested_at DESC),'[]'::jsonb)
    INTO v_prior
  FROM (
    SELECT * FROM public.ce_v_waiver_register w
    WHERE w.employer_id = (v_row->>'employer_id')::uuid AND w.waiver_id <> p_waiver_id
    ORDER BY w.requested_at DESC LIMIT 10
  ) p;

  RETURN jsonb_build_object(
    'waiver', v_row,
    'timeline', v_timeline,
    'previous_waivers', v_prior,
    'actor', jsonb_build_object(
      'user_code', v_actor,
      'can_approve', public.ce_actor_can(v_uid,'compliance.waiver.approve'),
      'can_approve_high', public.ce_actor_can(v_uid,'compliance.waiver.approve_high'),
      'can_request', public.ce_actor_can(v_uid,'compliance.waiver.request')
                     OR public.ce_actor_can(v_uid,'compliance.cases.manage'),
      'is_admin', public.is_admin(v_uid),
      'is_own_request', (v_row->>'is_own_request')::boolean),
    'thresholds', jsonb_build_object(
      'approval_sla_days', v_sla,
      'high_value_amount', v_high)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_waiver_detail_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_waiver_detail_v1(uuid) TO authenticated;