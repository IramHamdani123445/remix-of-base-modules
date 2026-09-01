CREATE OR REPLACE FUNCTION public.ce_waiver_register_v1(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_tab text := COALESCE(NULLIF(p_params->>'tab',''),'ACTION');
  v_search text := NULLIF(trim(COALESCE(p_params->>'search','')),'');
  v_sort text := COALESCE(NULLIF(p_params->>'sort',''),'default');
  v_dir text := CASE WHEN lower(COALESCE(p_params->>'dir','desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_page int := GREATEST(COALESCE((p_params->>'page')::int,1),1);
  v_size int := LEAST(GREATEST(COALESCE((p_params->>'page_size')::int,25),5),200);
  v_sla numeric := public.ce_waiver_setting('APPROVAL_SLA_DAYS',5);
  v_soon numeric := public.ce_waiver_setting('DUE_SOON_DAYS',2);
  v_high numeric := public.ce_waiver_setting('HIGH_VALUE_AMOUNT',10000);
  v_minjust numeric := public.ce_waiver_setting('MIN_JUSTIFICATION_CHARS',40);
  v_requester text := NULLIF(p_params->>'requested_by','');
  v_total int;
  v_rows jsonb;
  v_kpis jsonb;
  v_tabs jsonb;
  v_attention jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.cases.manage')
          OR public.ce_actor_can(v_uid,'compliance.waiver.approve')
          OR public.has_permission(v_uid,'manage_compliance','view')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  v_actor := public.ce_actor_user_code(v_uid);
  IF v_requester = 'ME' THEN v_requester := v_actor; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp_unused_waiver (x int);

  RETURN (
  WITH base AS (
    SELECT g.*,
      (g.status_code IN ('AWAITING_DECISION','ESCALATED'))                                   AS is_open,
      (g.status_code IN ('AWAITING_DECISION','ESCALATED') AND g.waiting_days > v_sla)        AS sla_overdue,
      (g.status_code IN ('AWAITING_DECISION','ESCALATED')
        AND g.waiting_days <= v_sla AND g.waiting_days >= GREATEST(v_sla - v_soon,0))        AS sla_due_soon,
      (g.amount_requested >= v_high)                                                         AS high_value,
      (g.rule_cap_amount IS NOT NULL AND g.amount_requested > g.rule_cap_amount)             AS exceeds_rule_cap,
      (COALESCE(length(g.justification),0) < v_minjust)                                      AS weak_justification,
      (g.status_code = 'APPROVED')                                                           AS approved_not_applied,
      (g.case_id IS NULL AND g.violation_id IS NULL)                                         AS missing_linkage,
      (g.requested_by IS NOT NULL AND g.requested_by = v_actor)                              AS is_own_request
    FROM public.ce_v_waiver_register g
  ), flagged AS (
    SELECT b.*,
      (b.is_open AND (b.sla_overdue OR b.high_value OR b.exceeds_rule_cap OR b.weak_justification OR b.missing_linkage))
        OR b.approved_not_applied AS needs_attention
    FROM base b
  ), filtered AS (
    SELECT * FROM flagged b
    WHERE (v_tab = 'ALL'
           OR (v_tab='ACTION'     AND b.is_open)
           OR (v_tab='ATTENTION'  AND b.needs_attention)
           OR (v_tab='OVERDUE'    AND b.sla_overdue)
           OR (v_tab='HIGH_VALUE' AND b.high_value AND b.is_open)
           OR (v_tab='MINE'       AND b.is_own_request)
           OR (v_tab='APPROVED'   AND b.status_code='APPROVED')
           OR (v_tab='APPLIED'    AND b.status_code='APPLIED')
           OR (v_tab='REJECTED'   AND b.status_code='REJECTED')
           OR (v_tab='CLOSED'     AND b.status_code IN ('APPLIED','REJECTED','CANCELLED')))
      AND (v_search IS NULL OR (
            b.waiver_number ILIKE '%'||v_search||'%'
         OR COALESCE(b.employer_name,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.regno,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.case_number,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.violation_number,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.requested_by_name,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.justification,'') ILIKE '%'||v_search||'%'))
      AND (COALESCE(jsonb_array_length(p_params->'statuses'),0)=0
           OR b.status_code IN (SELECT jsonb_array_elements_text(p_params->'statuses')))
      AND (COALESCE(jsonb_array_length(p_params->'components'),0)=0
           OR b.component_code IN (SELECT jsonb_array_elements_text(p_params->'components')))
      AND (COALESCE(jsonb_array_length(p_params->'scopes'),0)=0
           OR COALESCE(b.scope_code,'') IN (SELECT jsonb_array_elements_text(p_params->'scopes')))
      AND (COALESCE(jsonb_array_length(p_params->'sources'),0)=0
           OR b.source_code IN (SELECT jsonb_array_elements_text(p_params->'sources')))
      AND (NULLIF(p_params->>'employer_id','') IS NULL OR b.employer_id = p_params->>'employer_id')
      AND (v_requester IS NULL OR b.requested_by = v_requester)
      AND (NULLIF(p_params->>'rule_id','') IS NULL OR b.waiver_rule_id::text = p_params->>'rule_id')
      AND (NULLIF(p_params->>'case_id','') IS NULL OR b.case_id::text = p_params->>'case_id')
      AND (NULLIF(p_params->>'violation_id','') IS NULL OR b.violation_id::text = p_params->>'violation_id')
      AND (NULLIF(p_params->>'sla','') IS NULL
           OR (p_params->>'sla'='OVERDUE'  AND b.sla_overdue)
           OR (p_params->>'sla'='DUE_SOON' AND b.sla_due_soon)
           OR (p_params->>'sla'='WITHIN'   AND b.is_open AND NOT b.sla_overdue))
      AND (NULLIF(p_params->>'date_window','') IS NULL
           OR (p_params->>'date_window'='TODAY' AND b.requested_at::date = CURRENT_DATE)
           OR (p_params->>'date_window'='D7'    AND b.requested_at >= now() - interval '7 days')
           OR (p_params->>'date_window'='D30'   AND b.requested_at >= now() - interval '30 days')
           OR (p_params->>'date_window'='D90'   AND b.requested_at >= now() - interval '90 days')
           OR (p_params->>'date_window'='YTD'   AND b.requested_at >= date_trunc('year', now())))
      AND (NULLIF(p_params->>'date_from','') IS NULL OR b.requested_at::date >= (p_params->>'date_from')::date)
      AND (NULLIF(p_params->>'date_to','')   IS NULL OR b.requested_at::date <= (p_params->>'date_to')::date)
      AND (NULLIF(p_params->>'amount_band','') IS NULL
           OR (p_params->>'amount_band'='LT1K'   AND b.amount_requested < 1000)
           OR (p_params->>'amount_band'='1K5K'   AND b.amount_requested >= 1000 AND b.amount_requested < 5000)
           OR (p_params->>'amount_band'='5K10K'  AND b.amount_requested >= 5000 AND b.amount_requested < 10000)
           OR (p_params->>'amount_band'='10K50K' AND b.amount_requested >= 10000 AND b.amount_requested < 50000)
           OR (p_params->>'amount_band'='GT50K'  AND b.amount_requested >= 50000))
      AND (NULLIF(p_params->>'amount_min','') IS NULL OR b.amount_requested >= (p_params->>'amount_min')::numeric)
      AND (NULLIF(p_params->>'amount_max','') IS NULL OR b.amount_requested <= (p_params->>'amount_max')::numeric)
  ), counted AS (
    SELECT count(*)::int AS n FROM filtered
  ), paged AS (
    SELECT * FROM filtered f
    ORDER BY
      CASE WHEN v_sort='default' THEN (CASE WHEN f.sla_overdue THEN 0 WHEN f.is_open THEN 1 ELSE 2 END) END ASC,
      CASE WHEN v_sort='default' THEN f.requested_at END DESC,
      CASE WHEN v_sort='waiver_number' AND v_dir='asc'  THEN f.waiver_number END ASC,
      CASE WHEN v_sort='waiver_number' AND v_dir='desc' THEN f.waiver_number END DESC,
      CASE WHEN v_sort='employer' AND v_dir='asc'  THEN f.employer_name END ASC,
      CASE WHEN v_sort='employer' AND v_dir='desc' THEN f.employer_name END DESC,
      CASE WHEN v_sort='component' AND v_dir='asc'  THEN f.component_label END ASC,
      CASE WHEN v_sort='component' AND v_dir='desc' THEN f.component_label END DESC,
      CASE WHEN v_sort='status' AND v_dir='asc'  THEN f.status_label END ASC,
      CASE WHEN v_sort='status' AND v_dir='desc' THEN f.status_label END DESC,
      CASE WHEN v_sort='amount_requested' AND v_dir='asc'  THEN f.amount_requested END ASC,
      CASE WHEN v_sort='amount_requested' AND v_dir='desc' THEN f.amount_requested END DESC,
      CASE WHEN v_sort='amount_approved' AND v_dir='asc'  THEN f.amount_approved END ASC,
      CASE WHEN v_sort='amount_approved' AND v_dir='desc' THEN f.amount_approved END DESC,
      CASE WHEN v_sort='requested_at' AND v_dir='asc'  THEN f.requested_at END ASC,
      CASE WHEN v_sort='requested_at' AND v_dir='desc' THEN f.requested_at END DESC,
      CASE WHEN v_sort='waiting' AND v_dir='asc'  THEN f.waiting_hours END ASC,
      CASE WHEN v_sort='waiting' AND v_dir='desc' THEN f.waiting_hours END DESC,
      f.requested_at DESC
    OFFSET (v_page-1)*v_size LIMIT v_size
  ), kpi AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'awaiting', count(*) FILTER (WHERE is_open),
      'awaiting_amount', COALESCE(sum(amount_requested) FILTER (WHERE is_open),0),
      'overdue', count(*) FILTER (WHERE sla_overdue),
      'approved_month', count(*) FILTER (WHERE status_code IN ('APPROVED','APPLIED') AND decided_at >= date_trunc('month', now())),
      'approved_month_amount', COALESCE(sum(amount_approved) FILTER (WHERE status_code IN ('APPROVED','APPLIED') AND decided_at >= date_trunc('month', now())),0),
      'rejected_month', count(*) FILTER (WHERE status_code='REJECTED' AND decided_at >= date_trunc('month', now())),
      'approval_rate', CASE WHEN count(*) FILTER (WHERE status_code IN ('APPROVED','APPLIED','REJECTED')) = 0 THEN 0
                            ELSE round(100.0 * count(*) FILTER (WHERE status_code IN ('APPROVED','APPLIED'))
                                 / count(*) FILTER (WHERE status_code IN ('APPROVED','APPLIED','REJECTED')), 1) END,
      'high_value_pending', count(*) FILTER (WHERE is_open AND high_value),
      'approved_not_applied', count(*) FILTER (WHERE approved_not_applied),
      'oldest_pending_days', COALESCE(max(waiting_days) FILTER (WHERE is_open),0)
    ) AS j FROM flagged
  ), tabs AS (
    SELECT jsonb_build_object(
      'ACTION',     count(*) FILTER (WHERE is_open),
      'ATTENTION',  count(*) FILTER (WHERE needs_attention),
      'OVERDUE',    count(*) FILTER (WHERE sla_overdue),
      'HIGH_VALUE', count(*) FILTER (WHERE high_value AND is_open),
      'MINE',       count(*) FILTER (WHERE is_own_request),
      'APPROVED',   count(*) FILTER (WHERE status_code='APPROVED'),
      'APPLIED',    count(*) FILTER (WHERE status_code='APPLIED'),
      'REJECTED',   count(*) FILTER (WHERE status_code='REJECTED'),
      'CLOSED',     count(*) FILTER (WHERE status_code IN ('APPLIED','REJECTED','CANCELLED')),
      'ALL',        count(*)
    ) AS j FROM flagged
  ), attention AS (
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'priority')::int, (x->>'waiting_days')::numeric DESC),'[]'::jsonb) AS j
    FROM (
      SELECT jsonb_build_object(
        'waiver_id', a.waiver_id, 'waiver_number', a.waiver_number,
        'employer_name', a.employer_name, 'amount_requested', a.amount_requested,
        'waiting_days', a.waiting_days,
        'priority', CASE WHEN a.sla_overdue THEN 1 WHEN a.exceeds_rule_cap THEN 2
                         WHEN a.high_value THEN 3 WHEN a.approved_not_applied THEN 4
                         WHEN a.missing_linkage THEN 5 ELSE 6 END,
        'reason', CASE
          WHEN a.sla_overdue THEN 'Past the approval interval of '||v_sla||' day(s)'
          WHEN a.exceeds_rule_cap THEN 'Requested value is above the permitted rule ceiling'
          WHEN a.high_value THEN 'High-value request needing senior authority'
          WHEN a.approved_not_applied THEN 'Approved but not yet applied to the case balance'
          WHEN a.missing_linkage THEN 'Not linked to a compliance case or violation'
          ELSE 'Justification is thinner than the required standard' END
      ) AS x
      FROM flagged a WHERE a.needs_attention
      ORDER BY CASE WHEN a.sla_overdue THEN 1 WHEN a.exceeds_rule_cap THEN 2
                    WHEN a.high_value THEN 3 WHEN a.approved_not_applied THEN 4
                    WHEN a.missing_linkage THEN 5 ELSE 6 END, a.waiting_days DESC
      LIMIT 8
    ) s
  )
  SELECT jsonb_build_object(
    'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM paged p),
    'total', (SELECT n FROM counted),
    'page', v_page,
    'page_size', v_size,
    'kpis', (SELECT j FROM kpi),
    'tab_counts', (SELECT j FROM tabs),
    'attention', (SELECT j FROM attention),
    'thresholds', jsonb_build_object(
      'approval_sla_days', v_sla,
      'due_soon_days', v_soon,
      'high_value_amount', v_high,
      'min_justification_chars', v_minjust),
    'actor', jsonb_build_object(
      'user_code', v_actor,
      'can_approve', public.ce_actor_can(v_uid,'compliance.waiver.approve'),
      'can_approve_high', public.ce_actor_can(v_uid,'compliance.waiver.approve_high'),
      'can_request', public.ce_actor_can(v_uid,'compliance.waiver.request')
                     OR public.ce_actor_can(v_uid,'compliance.cases.manage'),
      'can_admin_rules', public.ce_actor_can(v_uid,'compliance.waiver.rules.manage'),
      'is_admin', public.is_admin(v_uid))
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_waiver_register_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_waiver_register_v1(jsonb) TO authenticated;

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
  v_minj numeric := public.ce_waiver_setting('MIN_JUSTIFICATION_CHARS',40);
  v_open boolean;
  v_waiting numeric;
  v_employer text;
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
  v_employer := v_row->>'employer_id';

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
    SELECT w.* FROM public.ce_v_waiver_register w
    WHERE w.employer_id = v_employer AND w.waiver_id <> p_waiver_id
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