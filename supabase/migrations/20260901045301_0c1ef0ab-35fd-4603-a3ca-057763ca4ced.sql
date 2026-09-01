-- ============================================================
-- Compliance → Waiver Requests: Enterprise governance register
-- Read-only projection layer. Lifecycle stays in the existing
-- governed commands (ce_request/approve/reject/cancel_waiver_v1).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ce_waiver_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  tone text,
  numeric_value numeric,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, code)
);

GRANT SELECT ON public.ce_waiver_ref TO authenticated;
GRANT ALL ON public.ce_waiver_ref TO service_role;
ALTER TABLE public.ce_waiver_ref ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ce_waiver_ref_read ON public.ce_waiver_ref;
CREATE POLICY ce_waiver_ref_read ON public.ce_waiver_ref
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.ce_waiver_ref (domain, code, label, description, tone, numeric_value, sort_order) VALUES
  ('STATUS','AWAITING_DECISION','Awaiting Decision','Submitted and waiting for an authorised reviewer to decide.','warning',NULL,10),
  ('STATUS','APPROVED','Approved — Not Yet Applied','Decision recorded but the financial application did not complete.','info',NULL,20),
  ('STATUS','APPLIED','Approved & Applied','Approved and the waived amount is reflected on the case balance.','success',NULL,30),
  ('STATUS','REJECTED','Rejected','Declined; the case continues under normal recovery.','destructive',NULL,40),
  ('STATUS','CANCELLED','Cancelled','Withdrawn before a decision was taken.','muted',NULL,50),
  ('COMPONENT','PENALTY','Penalty',NULL,NULL,NULL,10),
  ('COMPONENT','INTEREST','Interest',NULL,NULL,NULL,20),
  ('COMPONENT','PRINCIPAL','Principal',NULL,NULL,NULL,30),
  ('COMPONENT','FEE','Administrative Fee',NULL,NULL,NULL,40),
  ('COMPONENT','UNSPECIFIED','Unspecified Component','Legacy record captured only a waiver scope.',NULL,NULL,90),
  ('SCOPE','FULL','Full Waiver',NULL,NULL,NULL,10),
  ('SCOPE','PARTIAL','Partial Waiver',NULL,NULL,NULL,20),
  ('SOURCE','CASE','Compliance Case',NULL,NULL,NULL,10),
  ('SOURCE','VIOLATION','Violation',NULL,NULL,NULL,20),
  ('SOURCE','EMPLOYER_RESPONSE','Employer Request',NULL,NULL,NULL,30),
  ('SOURCE','OFFICER','Officer Request',NULL,NULL,NULL,40),
  ('SOURCE','SYSTEM','System Generated',NULL,NULL,NULL,50),
  ('SOURCE','UNKNOWN','Unrecorded Source',NULL,NULL,NULL,90),
  ('SETTING','APPROVAL_SLA_DAYS','Approval SLA (days)','Working expectation for deciding a waiver request.',NULL,5,10),
  ('SETTING','APPROVAL_SLA_DUE_SOON_DAYS','Due soon threshold (days)','Requests within this many days of the SLA are flagged Due Soon.',NULL,2,20),
  ('SETTING','HIGH_VALUE_AMOUNT','High value amount','Requested amount at or above this is treated as high value.',NULL,10000,30),
  ('SETTING','MIN_JUSTIFICATION_CHARS','Minimum justification length','Shorter justifications are flagged as incomplete.',NULL,40,40)
ON CONFLICT (domain, code) DO NOTHING;

-- ---------- canonical mappers ----------
CREATE OR REPLACE FUNCTION public.ce_waiver_status_canonical(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_status IS NULL THEN 'AWAITING_DECISION'
    WHEN upper(p_status) LIKE 'PENDING%' THEN 'AWAITING_DECISION'
    WHEN upper(p_status) IN ('SUBMITTED','UNDER_REVIEW','IN REVIEW') THEN 'AWAITING_DECISION'
    WHEN upper(p_status) = 'APPLIED' THEN 'APPLIED'
    WHEN upper(p_status) = 'APPROVED' THEN 'APPROVED'
    WHEN upper(p_status) = 'REJECTED' THEN 'REJECTED'
    WHEN upper(p_status) IN ('CANCELLED','CANCELED','WITHDRAWN') THEN 'CANCELLED'
    ELSE 'AWAITING_DECISION'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ce_waiver_component_code(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_type IS NULL THEN 'UNSPECIFIED'
    WHEN upper(p_type) LIKE '%PENALT%' THEN 'PENALTY'
    WHEN upper(p_type) LIKE '%INTEREST%' THEN 'INTEREST'
    WHEN upper(p_type) LIKE '%PRINCIPAL%' THEN 'PRINCIPAL'
    WHEN upper(p_type) LIKE '%FEE%' THEN 'FEE'
    ELSE 'UNSPECIFIED'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ce_waiver_scope_code(p_type text, p_requested numeric, p_approved numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_approved IS NOT NULL AND COALESCE(p_requested,0) > 0
      THEN CASE WHEN p_approved >= p_requested THEN 'FULL' ELSE 'PARTIAL' END
    WHEN p_type IS NOT NULL AND upper(p_type) LIKE '%PARTIAL%' THEN 'PARTIAL'
    WHEN p_type IS NOT NULL AND upper(p_type) LIKE '%FULL%' THEN 'FULL'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.ce_waiver_setting(p_code text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT numeric_value FROM public.ce_waiver_ref
                   WHERE domain='SETTING' AND code=p_code AND is_active), p_default);
$$;

-- ---------- register projection ----------
DROP VIEW IF EXISTS public.ce_v_waiver_register;
CREATE VIEW public.ce_v_waiver_register AS
SELECT
  w.id                                   AS waiver_id,
  w.waiver_number,
  w.employer_id,
  COALESCE(er.name, c.employer_name, v.employer_name, w.employer_id) AS employer_name,
  er.regno,
  w.case_id,
  c.case_number,
  c.status                               AS case_status,
  w.violation_id,
  v.violation_number,
  vt.name                                AS violation_type,
  v.status                               AS violation_status,
  w.waiver_type                          AS waiver_type_raw,
  public.ce_waiver_component_code(w.waiver_type)            AS component_code,
  cmp.label                                                  AS component_label,
  public.ce_waiver_scope_code(w.waiver_type, w.amount_requested, w.amount_approved) AS scope_code,
  scp.label                                                  AS scope_label,
  w.status                               AS status_raw,
  public.ce_waiver_status_canonical(w.status)                AS status_code,
  st.label                                                   AS status_label,
  st.tone                                                    AS status_tone,
  COALESCE(NULLIF(upper(COALESCE(w.source,'')),''),'UNKNOWN') AS source_code,
  COALESCE(src.label, 'Unrecorded Source')                    AS source_label,
  COALESCE(w.amount_requested,0)         AS amount_requested,
  w.amount_approved,
  CASE WHEN w.amount_approved IS NOT NULL
       THEN COALESCE(w.amount_requested,0) - w.amount_approved END AS amount_difference,
  CASE WHEN w.amount_approved IS NOT NULL AND COALESCE(w.amount_requested,0) > 0
       THEN round((w.amount_approved / w.amount_requested) * 100, 1) END AS approved_pct,
  w.reason_code,
  w.justification,
  COALESCE(jsonb_array_length(COALESCE(w.supporting_documents,'[]'::jsonb)),0) AS document_count,
  w.supporting_documents,
  w.requested_by,
  COALESCE(rp.full_name, w.requested_by)  AS requested_by_name,
  w.requested_at,
  GREATEST(0, (EXTRACT(EPOCH FROM (now() - w.requested_at)) / 3600))::numeric(12,1) AS waiting_hours,
  GREATEST(0, (CURRENT_DATE - w.requested_at::date))          AS waiting_days,
  w.approver_id,
  COALESCE(ap.full_name, w.approver_id)   AS approver_name,
  w.approver_comments,
  w.approved_at,
  w.rejected_reason,
  w.applied_at,
  COALESCE(w.applied_at, w.approved_at, w.updated_at)         AS decided_at,
  w.waiver_rule_id,
  r.code                                  AS rule_code,
  r.name                                  AS rule_name,
  r.max_percentage                        AS rule_max_percentage,
  r.amount_threshold                      AS rule_amount_threshold,
  r.required_approval_role                AS rule_required_role,
  r.escalated_approval_role               AS rule_escalated_role,
  r.enabled                               AS rule_enabled,
  CASE WHEN r.max_percentage IS NOT NULL
       THEN round(COALESCE(w.amount_requested,0) * r.max_percentage / 100.0, 2) END AS rule_cap_amount,
  w.rule_snapshot,
  -- financial context
  c.total_principal   AS case_principal,
  c.total_penalties   AS case_penalties,
  c.total_interest    AS case_interest,
  c.total_amount      AS case_total,
  c.amount_collected  AS case_paid,
  c.amount_waived     AS case_waived,
  GREATEST(COALESCE(c.total_amount,0) - COALESCE(c.amount_collected,0) - COALESCE(c.amount_waived,0), 0) AS case_outstanding,
  v.principal_amount  AS violation_principal,
  v.penalty_amount    AS violation_penalty,
  v.interest_amount   AS violation_interest,
  v.total_amount      AS violation_total,
  prior.prior_count,
  prior.prior_amount,
  w.workflow_definition_id,
  w.created_at,
  w.updated_at
FROM public.ce_waivers w
LEFT JOIN public.ce_cases c        ON c.id = w.case_id
LEFT JOIN public.ce_violations v   ON v.id = w.violation_id
LEFT JOIN public.ce_violation_types vt ON vt.id = v.violation_type_id
LEFT JOIN public.ce_waiver_rules r ON r.id = w.waiver_rule_id
LEFT JOIN public.er_master er      ON er.regno::text = w.employer_id::text
LEFT JOIN public.profiles rp       ON rp.user_code = w.requested_by OR rp.employee_code = w.requested_by
LEFT JOIN public.profiles ap       ON ap.user_code = w.approver_id  OR ap.employee_code = w.approver_id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS prior_count, COALESCE(sum(p.amount_approved),0) AS prior_amount
  FROM public.ce_waivers p
  WHERE p.employer_id = w.employer_id
    AND p.id <> w.id
    AND public.ce_waiver_status_canonical(p.status) IN ('APPROVED','APPLIED')
    AND p.requested_at < w.requested_at
) prior ON true
LEFT JOIN public.ce_waiver_ref st  ON st.domain='STATUS'    AND st.code = public.ce_waiver_status_canonical(w.status)
LEFT JOIN public.ce_waiver_ref cmp ON cmp.domain='COMPONENT' AND cmp.code = public.ce_waiver_component_code(w.waiver_type)
LEFT JOIN public.ce_waiver_ref scp ON scp.domain='SCOPE'     AND scp.code = public.ce_waiver_scope_code(w.waiver_type, w.amount_requested, w.amount_approved)
LEFT JOIN public.ce_waiver_ref src ON src.domain='SOURCE'    AND src.code = COALESCE(NULLIF(upper(COALESCE(w.source,'')),''),'UNKNOWN');

-- ---------- register RPC ----------
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

  CREATE TEMP TABLE IF NOT EXISTS _wv_noop(x int);  -- placeholder avoided; using CTEs below

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

-- ---------- facets ----------
CREATE OR REPLACE FUNCTION public.ce_waiver_facets_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  RETURN jsonb_build_object(
    'statuses',  COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone,'description',description) ORDER BY sort_order)
                           FROM ce_waiver_ref WHERE domain='STATUS' AND is_active),'[]'::jsonb),
    'components',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY sort_order)
                           FROM ce_waiver_ref WHERE domain='COMPONENT' AND is_active),'[]'::jsonb),
    'scopes',    COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY sort_order)
                           FROM ce_waiver_ref WHERE domain='SCOPE' AND is_active),'[]'::jsonb),
    'sources',   COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY sort_order)
                           FROM ce_waiver_ref WHERE domain='SOURCE' AND is_active),'[]'::jsonb),
    'employers', COALESCE((SELECT jsonb_agg(e ORDER BY e->>'label') FROM (
                    SELECT DISTINCT jsonb_build_object('code',employer_id,
                      'label', COALESCE(employer_name, employer_id) ||
                               CASE WHEN regno IS NOT NULL THEN ' ('||regno||')' ELSE '' END) AS e
                    FROM ce_v_waiver_register WHERE employer_id IS NOT NULL) q),'[]'::jsonb),
    'requesters',COALESCE((SELECT jsonb_agg(r ORDER BY r->>'label') FROM (
                    SELECT DISTINCT jsonb_build_object('code',requested_by,'label',COALESCE(requested_by_name,requested_by)) AS r
                    FROM ce_v_waiver_register WHERE requested_by IS NOT NULL) q),'[]'::jsonb),
    'rules',     COALESCE((SELECT jsonb_agg(jsonb_build_object('code',id::text,'label',name,'max_percentage',max_percentage,
                             'amount_threshold',amount_threshold,'required_role',required_approval_role,
                             'escalated_role',escalated_approval_role,'enabled',enabled) ORDER BY sort_order, name)
                           FROM ce_waiver_rules),'[]'::jsonb)
  );
END;
$function$;

-- ---------- detail ----------
CREATE OR REPLACE FUNCTION public.ce_waiver_detail_v1(p_waiver_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_row jsonb;
  v_timeline jsonb;
  v_prior jsonb;
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
  FROM public.ce_v_waiver_register p
  WHERE p.employer_id = (v_row->>'employer_id') AND p.waiver_id <> p_waiver_id
  LIMIT 10;

  RETURN jsonb_build_object(
    'waiver', v_row,
    'timeline', v_timeline,
    'previous_waivers', v_prior,
    'actor', jsonb_build_object(
      'user_code', v_actor,
      'can_approve', public.ce_actor_can(v_uid,'compliance.waiver.approve'),
      'can_approve_high', public.ce_actor_can(v_uid,'compliance.waiver.approve_high'),
      'is_admin', public.is_admin(v_uid),
      'is_own_request', (v_row->>'requested_by') IS NOT NULL AND (v_row->>'requested_by') = v_actor),
    'thresholds', jsonb_build_object(
      'approval_sla_days', public.ce_waiver_setting('APPROVAL_SLA_DAYS',5),
      'high_value_amount', public.ce_waiver_setting('HIGH_VALUE_AMOUNT',10000))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_waiver_register_v1(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.ce_waiver_facets_v1() FROM public;
REVOKE ALL ON FUNCTION public.ce_waiver_detail_v1(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_waiver_register_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_waiver_facets_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_waiver_detail_v1(uuid) TO authenticated;