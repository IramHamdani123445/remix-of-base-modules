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
  v_soon numeric := public.ce_waiver_setting('APPROVAL_SLA_DUE_SOON_DAYS',2);
  v_high numeric := public.ce_waiver_setting('HIGH_VALUE_AMOUNT',10000);
  v_minjust numeric := public.ce_waiver_setting('MIN_JUSTIFICATION_CHARS',40);
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

  WITH base AS (
    SELECT g.*,
      (g.status_code = 'AWAITING_DECISION')                                        AS is_open,
      (g.status_code = 'AWAITING_DECISION' AND g.waiting_days > v_sla)             AS sla_overdue,
      (g.status_code = 'AWAITING_DECISION' AND g.waiting_days > (v_sla - v_soon)
        AND g.waiting_days <= v_sla)                                               AS sla_due_soon,
      (g.amount_requested >= v_high)                                               AS high_value,
      (g.rule_cap_amount IS NOT NULL AND g.amount_requested > g.rule_cap_amount)   AS exceeds_rule_cap,
      (COALESCE(length(g.justification),0) < v_minjust)                            AS weak_justification,
      (g.status_code = 'APPROVED')                                                 AS approved_not_applied,
      (g.case_id IS NULL AND g.violation_id IS NULL)                               AS missing_linkage,
      (g.requested_by IS NOT NULL AND g.requested_by = v_actor)                    AS is_own_request
    FROM public.ce_v_waiver_register g
  ), filtered AS (
    SELECT * FROM base b
    WHERE (v_tab = 'ALL'
           OR (v_tab='ACTION'    AND b.status_code='AWAITING_DECISION')
           OR (v_tab='APPROVED'  AND b.status_code='APPROVED')
           OR (v_tab='COMPLETED' AND b.status_code='APPLIED')
           OR (v_tab='HISTORY'   AND b.status_code IN ('REJECTED','CANCELLED')))
      AND (v_search IS NULL OR (
            b.waiver_number ILIKE '%'||v_search||'%'
         OR COALESCE(b.employer_name,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.employer_id,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.regno,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.case_number,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.violation_number,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.requested_by_name,'') ILIKE '%'||v_search||'%'
         OR COALESCE(b.requested_by,'') ILIKE '%'||v_search||'%'))
      AND (COALESCE(jsonb_array_length(p_params->'statuses'),0)=0
           OR b.status_code IN (SELECT jsonb_array_elements_text(p_params->'statuses')))
      AND (COALESCE(jsonb_array_length(p_params->'components'),0)=0
           OR b.component_code IN (SELECT jsonb_array_elements_text(p_params->'components')))
      AND (COALESCE(jsonb_array_length(p_params->'scopes'),0)=0
           OR COALESCE(b.scope_code,'') IN (SELECT jsonb_array_elements_text(p_params->'scopes')))
      AND (COALESCE(jsonb_array_length(p_params->'sources'),0)=0
           OR b.source_code IN (SELECT jsonb_array_elements_text(p_params->'sources')))
      AND (NULLIF(p_params->>'employer_id','') IS NULL OR b.employer_id = p_params->>'employer_id')
      AND (NULLIF(p_params->>'requested_by','') IS NULL OR b.requested_by = p_params->>'requested_by')
      AND (NULLIF(p_params->>'rule_id','') IS NULL OR b.waiver_rule_id::text = p_params->>'rule_id')
      AND (NULLIF(p_params->>'case_id','') IS NULL OR b.case_id::text = p_params->>'case_id')
      AND (NULLIF(p_params->>'violation_id','') IS NULL OR b.violation_id::text = p_params->>'violation_id')
      AND (NULLIF(p_params->>'sla','') IS NULL
           OR (p_params->>'sla'='OVERDUE'  AND b.sla_overdue)
           OR (p_params->>'sla'='DUE_SOON' AND b.sla_due_soon)
           OR (p_params->>'sla'='WITHIN'   AND b.is_open AND NOT b.sla_overdue AND NOT b.sla_due_soon))
      AND (NULLIF(p_params->>'date_window','') IS NULL
           OR (p_params->>'date_window'='TODAY'  AND b.requested_at::date = CURRENT_DATE)
           OR (p_params->>'date_window'='7D'     AND b.requested_at >= now() - interval '7 days')
           OR (p_params->>'date_window'='30D'    AND b.requested_at >= now() - interval '30 days')
           OR (p_params->>'date_window'='90D'    AND b.requested_at >= now() - interval '90 days')
           OR (p_params->>'date_window'='CUSTOM'
               AND (NULLIF(p_params->>'date_from','') IS NULL OR b.requested_at::date >= (p_params->>'date_from')::date)
               AND (NULLIF(p_params->>'date_to','')   IS NULL OR b.requested_at::date <= (p_params->>'date_to')::date)))
      AND (NULLIF(p_params->>'amount_band','') IS NULL
           OR (p_params->>'amount_band'='LT500'   AND b.amount_requested < 500)
           OR (p_params->>'amount_band'='500_1K'  AND b.amount_requested BETWEEN 500 AND 1000)
           OR (p_params->>'amount_band'='1K_5K'   AND b.amount_requested > 1000 AND b.amount_requested <= 5000)
           OR (p_params->>'amount_band'='5K_10K'  AND b.amount_requested > 5000 AND b.amount_requested <= 10000)
           OR (p_params->>'amount_band'='GT10K'   AND b.amount_requested > 10000)
           OR (p_params->>'amount_band'='CUSTOM'
               AND (NULLIF(p_params->>'amount_min','') IS NULL OR b.amount_requested >= (p_params->>'amount_min')::numeric)
               AND (NULLIF(p_params->>'amount_max','') IS NULL OR b.amount_requested <= (p_params->>'amount_max')::numeric)))
  ), counted AS (
    SELECT count(*)::int AS n FROM filtered
  ), page AS (
    SELECT * FROM filtered f
    ORDER BY
      CASE WHEN v_sort='default' THEN (CASE WHEN f.sla_overdue THEN 0 ELSE 1 END) END ASC,
      CASE WHEN v_sort='default' AND v_tab IN ('ACTION','APPROVED') THEN f.requested_at END ASC,
      CASE WHEN v_sort='default' AND v_tab NOT IN ('ACTION','APPROVED') THEN f.decided_at END DESC,
      CASE WHEN v_sort='waiting'  AND v_dir='desc' THEN f.waiting_hours END DESC,
      CASE WHEN v_sort='waiting'  AND v_dir='asc'  THEN f.waiting_hours END ASC,
      CASE WHEN v_sort='requested_at' AND v_dir='desc' THEN f.requested_at END DESC,
      CASE WHEN v_sort='requested_at' AND v_dir='asc'  THEN f.requested_at END ASC,
      CASE WHEN v_sort='decided_at' AND v_dir='desc' THEN f.decided_at END DESC,
      CASE WHEN v_sort='decided_at' AND v_dir='asc'  THEN f.decided_at END ASC,
      CASE WHEN v_sort='amount_requested' AND v_dir='desc' THEN f.amount_requested END DESC,
      CASE WHEN v_sort='amount_requested' AND v_dir='asc'  THEN f.amount_requested END ASC,
      CASE WHEN v_sort='amount_approved' AND v_dir='desc' THEN f.amount_approved END DESC NULLS LAST,
      CASE WHEN v_sort='amount_approved' AND v_dir='asc'  THEN f.amount_approved END ASC NULLS LAST,
      CASE WHEN v_sort='employer' AND v_dir='desc' THEN lower(f.employer_name) END DESC,
      CASE WHEN v_sort='employer' AND v_dir='asc'  THEN lower(f.employer_name) END ASC,
      CASE WHEN v_sort='waiver_number' AND v_dir='desc' THEN f.waiver_number END DESC,
      CASE WHEN v_sort='waiver_number' AND v_dir='asc'  THEN f.waiver_number END ASC,
      CASE WHEN v_sort='component' AND v_dir='desc' THEN f.component_code END DESC,
      CASE WHEN v_sort='component' AND v_dir='asc'  THEN f.component_code END ASC,
      CASE WHEN v_sort='requested_by' AND v_dir='desc' THEN lower(f.requested_by_name) END DESC,
      CASE WHEN v_sort='requested_by' AND v_dir='asc'  THEN lower(f.requested_by_name) END ASC,
      CASE WHEN v_sort='status' AND v_dir='desc' THEN f.status_code END DESC,
      CASE WHEN v_sort='status' AND v_dir='asc'  THEN f.status_code END ASC,
      f.requested_at DESC
    OFFSET (v_page-1)*v_size LIMIT v_size
  )
  SELECT (SELECT n FROM counted),
         COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM page p),'[]'::jsonb)
    INTO v_total, v_rows;

  SELECT jsonb_build_object(
    'awaiting_count',   count(*) FILTER (WHERE status_code='AWAITING_DECISION'),
    'awaiting_amount',  COALESCE(sum(amount_requested) FILTER (WHERE status_code='AWAITING_DECISION'),0),
    'requested_amount_total', COALESCE(sum(amount_requested),0),
    'approved_month_count',  count(*) FILTER (WHERE status_code IN ('APPROVED','APPLIED') AND decided_at >= date_trunc('month', now())),
    'approved_month_amount', COALESCE(sum(amount_approved) FILTER (WHERE status_code IN ('APPROVED','APPLIED') AND decided_at >= date_trunc('month', now())),0),
    'rejected_month_count',  count(*) FILTER (WHERE status_code='REJECTED' AND decided_at >= date_trunc('month', now())),
    'oldest_pending_days',   COALESCE(max(waiting_days) FILTER (WHERE status_code='AWAITING_DECISION'),0),
    'sla_overdue_count',     count(*) FILTER (WHERE status_code='AWAITING_DECISION' AND waiting_days > v_sla)
  ) INTO v_kpis FROM public.ce_v_waiver_register;

  SELECT jsonb_build_object(
    'ACTION',    count(*) FILTER (WHERE status_code='AWAITING_DECISION'),
    'APPROVED',  count(*) FILTER (WHERE status_code='APPROVED'),
    'COMPLETED', count(*) FILTER (WHERE status_code='APPLIED'),
    'HISTORY',   count(*) FILTER (WHERE status_code IN ('REJECTED','CANCELLED')),
    'ALL',       count(*)
  ) INTO v_tabs FROM public.ce_v_waiver_register;

  SELECT COALESCE(jsonb_agg(a ORDER BY a->>'priority', a->>'waiver_number'),'[]'::jsonb) INTO v_attention
  FROM (
    SELECT jsonb_build_object(
      'waiver_id', g.waiver_id, 'waiver_number', g.waiver_number,
      'employer_name', g.employer_name, 'amount_requested', g.amount_requested,
      'waiting_days', g.waiting_days,
      'priority', CASE
        WHEN g.status_code='AWAITING_DECISION' AND g.waiting_days > v_sla THEN 1
        WHEN g.status_code='APPROVED' THEN 2
        WHEN g.status_code='AWAITING_DECISION' AND g.rule_cap_amount IS NOT NULL AND g.amount_requested > g.rule_cap_amount THEN 3
        WHEN g.status_code='AWAITING_DECISION' AND g.amount_requested >= v_high THEN 4
        WHEN g.status_code='AWAITING_DECISION' AND g.case_id IS NULL AND g.violation_id IS NULL THEN 5
        ELSE 6 END,
      'reason', CASE
        WHEN g.status_code='AWAITING_DECISION' AND g.waiting_days > v_sla
          THEN 'Approval SLA breached (' || g.waiting_days || 'd, SLA ' || v_sla || 'd)'
        WHEN g.status_code='APPROVED'
          THEN 'Approved but not applied to the case balance'
        WHEN g.status_code='AWAITING_DECISION' AND g.rule_cap_amount IS NOT NULL AND g.amount_requested > g.rule_cap_amount
          THEN 'Requested amount exceeds the rule cap — higher authority required'
        WHEN g.status_code='AWAITING_DECISION' AND g.amount_requested >= v_high
          THEN 'High-value waiver request'
        WHEN g.status_code='AWAITING_DECISION' AND g.case_id IS NULL AND g.violation_id IS NULL
          THEN 'No case or violation linkage'
        ELSE 'Supporting justification is incomplete' END
    ) AS a
    FROM public.ce_v_waiver_register g
    WHERE (g.status_code='AWAITING_DECISION' AND (
             g.waiting_days > v_sla
             OR g.amount_requested >= v_high
             OR (g.rule_cap_amount IS NOT NULL AND g.amount_requested > g.rule_cap_amount)
             OR (g.case_id IS NULL AND g.violation_id IS NULL)
             OR COALESCE(length(g.justification),0) < v_minjust))
       OR g.status_code='APPROVED'
    LIMIT 12
  ) q;

  RETURN jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
    'kpis', v_kpis, 'tab_counts', v_tabs, 'attention', v_attention,
    'thresholds', jsonb_build_object('approval_sla_days', v_sla, 'due_soon_days', v_soon,
                                     'high_value_amount', v_high, 'min_justification_chars', v_minjust),
    'actor', jsonb_build_object(
      'user_code', v_actor,
      'can_approve', public.ce_actor_can(v_uid,'compliance.waiver.approve'),
      'can_approve_high', public.ce_actor_can(v_uid,'compliance.waiver.approve_high'),
      'can_request', public.ce_actor_can(v_uid,'compliance.cases.manage'),
      'can_admin_rules', public.ce_actor_can(v_uid,'compliance.config.manage'),
      'is_admin', public.is_admin(v_uid))
  );
END;
$function$;