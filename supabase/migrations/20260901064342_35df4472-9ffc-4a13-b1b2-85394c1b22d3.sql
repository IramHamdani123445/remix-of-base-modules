CREATE OR REPLACE FUNCTION public.ce_legal_recommendation_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'priority',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_can_decide boolean;
  v_can_generate boolean;
  v_sla_days numeric;
  v_high_value numeric;
  v_stall_days numeric;
  v_page integer := GREATEST(1, COALESCE(p_page,1));
  v_size integer := LEAST(200, GREATEST(1, COALESCE(p_page_size,25)));
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_rows jsonb;
  v_total bigint;
  v_kpis jsonb;
  v_tabs jsonb;
  v_attention jsonb;
  v_facets jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error','NOT_AUTHENTICATED');
  END IF;

  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.legal') THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  v_actor        := public.ce_actor_user_code(v_uid);
  v_can_decide   := public.ce_actor_can(v_uid, 'compliance.legal.recommend_approve');
  v_can_generate := public.ce_actor_can(v_uid, 'compliance.config.manage')
                 OR public.ce_actor_can(v_uid, 'compliance.legal.recommend_approve');

  SELECT COALESCE(MAX(CASE WHEN setting_key='compliance.legal.approval_sla_days' THEN setting_value::numeric END), 3),
         COALESCE(MAX(CASE WHEN setting_key='compliance.legal.high_value_threshold' THEN setting_value::numeric END), 50000),
         COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.legal_referral' THEN setting_value::numeric END), 7)
    INTO v_sla_days, v_high_value, v_stall_days
    FROM public.ce_settings
   WHERE setting_key IN ('compliance.legal.approval_sla_days',
                         'compliance.legal.high_value_threshold',
                         'compliance.monitoring.stall_days.legal_referral');

  v_sla_days   := COALESCE(v_sla_days, 3);
  v_high_value := COALESCE(v_high_value, 50000);
  v_stall_days := COALESCE(v_stall_days, 7);

  WITH base AS (
    SELECT v.*,
           (public.ce_legal_rec_label('REC_STATUS', v.status_code))    AS status_json,
           (public.ce_legal_rec_label('RISK_BAND',  v.risk_code))      AS risk_json,
           (public.ce_legal_rec_label('SOURCE',     v.source_code))    AS source_json,
           (public.ce_legal_rec_label('LEGAL_STATE',v.legal_state_code)) AS legal_json,
           (v.status_code = 'PENDING_REVIEW')                          AS is_pending,
           (v.status_code = 'PENDING_REVIEW' AND v.waiting_hours > v_sla_days * 24)      AS review_overdue,
           (v.status_code = 'PENDING_REVIEW' AND v.waiting_hours > (v_sla_days - 1) * 24
              AND v.waiting_hours <= v_sla_days * 24)                  AS review_due_soon,
           (v.grand_total >= v_high_value)                             AS high_value,
           (v.status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED') AND v.referral_id IS NULL) AS approved_no_referral,
           (v.referral_id IS NOT NULL AND v.legal_state_code = 'DRAFT'
              AND v.referral_created_at < now() - (v_stall_days || ' days')::interval)   AS pack_stalled,
           (v.recommended_by IS NOT NULL AND v.recommended_by = v_actor) AS is_own_recommendation
      FROM public.ce_v_legal_recommendation_register v
  ),
  filtered AS (
    SELECT b.* FROM base b
     WHERE (COALESCE(p_filters->>'search','') = ''
            OR b.search_blob LIKE '%' || lower(p_filters->>'search') || '%')
       AND (COALESCE(p_filters->>'status','') = ''
            OR (b.status_json->>'code') = p_filters->>'status')
       AND (COALESCE(p_filters->>'risk','') = ''
            OR (b.risk_json->>'code') = p_filters->>'risk')
       AND (COALESCE(p_filters->>'zone','') = '' OR b.zone = p_filters->>'zone')
       AND (COALESCE(p_filters->>'source','') = ''
            OR (b.source_json->>'code') = p_filters->>'source')
       AND (COALESCE(p_filters->>'legal_state','') = ''
            OR (b.legal_json->>'code') = p_filters->>'legal_state')
       AND (COALESCE(p_filters->>'rule','') = ''
            OR p_filters->>'rule' = ANY (COALESCE(b.rule_names, ARRAY[]::text[])))
       AND (COALESCE(p_filters->>'amount_min','') = ''
            OR b.grand_total >= (p_filters->>'amount_min')::numeric)
       AND (COALESCE(p_filters->>'amount_max','') = ''
            OR b.grand_total <= (p_filters->>'amount_max')::numeric)
       AND (COALESCE(p_filters->>'date_from','') = ''
            OR b.recommended_date >= (p_filters->>'date_from')::date)
       AND (COALESCE(p_filters->>'date_to','') = ''
            OR b.recommended_date <= (p_filters->>'date_to')::date)
       AND (COALESCE(p_filters->>'tab','ALL') = 'ALL'
            OR (p_filters->>'tab' = 'PENDING'    AND b.is_pending)
            OR (p_filters->>'tab' = 'OVERDUE'    AND b.review_overdue)
            OR (p_filters->>'tab' = 'APPROVED'   AND b.status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED'))
            OR (p_filters->>'tab' = 'REFERRED'   AND b.referral_id IS NOT NULL)
            OR (p_filters->>'tab' = 'REJECTED'   AND b.status_code = 'REJECTED')
            OR (p_filters->>'tab' = 'HIGH_RISK'  AND b.risk_rank >= 3)
            OR (p_filters->>'tab' = 'HIGH_VALUE' AND b.high_value))
  ),
  paged AS (
    SELECT f.* FROM filtered f
     ORDER BY
       CASE WHEN p_sort = 'priority'   THEN (CASE WHEN f.review_overdue THEN 1000000 ELSE 0 END
                                             + f.risk_rank * 10000 + LEAST(f.waiting_hours, 9000)) END DESC NULLS LAST,
       CASE WHEN p_sort = 'waiting'   AND v_dir='desc' THEN f.waiting_hours END DESC NULLS LAST,
       CASE WHEN p_sort = 'waiting'   AND v_dir='asc'  THEN f.waiting_hours END ASC  NULLS LAST,
       CASE WHEN p_sort = 'recommended' AND v_dir='desc' THEN f.recommended_at END DESC NULLS LAST,
       CASE WHEN p_sort = 'recommended' AND v_dir='asc'  THEN f.recommended_at END ASC  NULLS LAST,
       CASE WHEN p_sort = 'risk'      AND v_dir='desc' THEN f.risk_rank END DESC NULLS LAST,
       CASE WHEN p_sort = 'risk'      AND v_dir='asc'  THEN f.risk_rank END ASC  NULLS LAST,
       CASE WHEN p_sort = 'amount'    AND v_dir='desc' THEN f.grand_total END DESC NULLS LAST,
       CASE WHEN p_sort = 'amount'    AND v_dir='asc'  THEN f.grand_total END ASC  NULLS LAST,
       CASE WHEN p_sort = 'cases'     AND v_dir='desc' THEN f.qualifying_case_count END DESC NULLS LAST,
       CASE WHEN p_sort = 'cases'     AND v_dir='asc'  THEN f.qualifying_case_count END ASC  NULLS LAST,
       CASE WHEN p_sort = 'employer'  AND v_dir='asc'  THEN lower(f.employer_name) END ASC  NULLS LAST,
       CASE WHEN p_sort = 'employer'  AND v_dir='desc' THEN lower(f.employer_name) END DESC NULLS LAST,
       CASE WHEN p_sort = 'zone'      AND v_dir='asc'  THEN lower(f.zone) END ASC NULLS LAST,
       CASE WHEN p_sort = 'zone'      AND v_dir='desc' THEN lower(f.zone) END DESC NULLS LAST,
       CASE WHEN p_sort = 'status'    AND v_dir='asc'  THEN (f.status_json->>'label') END ASC NULLS LAST,
       CASE WHEN p_sort = 'status'    AND v_dir='desc' THEN (f.status_json->>'label') END DESC NULLS LAST,
       f.recommended_at DESC
     OFFSET (v_page - 1) * v_size
     LIMIT v_size
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'recommendation_id', p.recommendation_id,
        'employer_id', p.employer_id,
        'employer_name', p.employer_name,
        'zone', p.zone,
        'risk_code', p.risk_json->>'code',
        'risk_label', p.risk_json->>'label',
        'risk_tone', p.risk_json->>'tone',
        'risk_score', p.risk_score,
        'status_code', p.status_json->>'code',
        'status_label', p.status_json->>'label',
        'status_tone', p.status_json->>'tone',
        'source_code', p.source_json->>'code',
        'source_label', p.source_json->>'label',
        'legal_state_code', p.legal_json->>'code',
        'legal_state_label', p.legal_json->>'label',
        'legal_state_tone', p.legal_json->>'tone',
        'recommended_by', p.recommended_by,
        'recommended_at', p.recommended_at,
        'recommended_date', p.recommended_date,
        'recommendation_reason', p.recommendation_reason,
        'rule_summary', p.rule_summary,
        'triggered_rules', COALESCE(p.triggered_rules,'[]'::jsonb),
        'qualifying_case_count', p.qualifying_case_count,
        'source_case_id', p.source_case_id,
        'source_case_number', p.source_case_number,
        'assigned_officer_name', p.assigned_officer_name,
        'total_principal', p.total_principal,
        'total_penalties', p.total_penalties,
        'total_interest', p.total_interest,
        'grand_total', p.grand_total,
        'referral_id', p.referral_id,
        'referral_number', p.referral_number,
        'referral_status', p.referral_status,
        'lg_intake_no', p.lg_intake_no,
        'lg_case_no', p.lg_case_no,
        'court_case_number', p.court_case_number,
        'reviewed_by', p.reviewed_by,
        'reviewed_date', p.reviewed_date,
        'review_notes', p.review_notes,
        'waiting_hours', p.waiting_hours,
        'is_pending', p.is_pending,
        'review_overdue', p.review_overdue,
        'review_due_soon', p.review_due_soon,
        'high_value', p.high_value,
        'approved_no_referral', p.approved_no_referral,
        'pack_stalled', p.pack_stalled,
        'is_own_recommendation', p.is_own_recommendation
      )) FROM paged p), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE b.is_pending),
        'overdue', count(*) FILTER (WHERE b.review_overdue),
        'high_risk_pending', count(*) FILTER (WHERE b.is_pending AND b.risk_rank >= 3),
        'approved', count(*) FILTER (WHERE b.status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED')),
        'rejected', count(*) FILTER (WHERE b.status_code = 'REJECTED'),
        'referred', count(*) FILTER (WHERE b.referral_id IS NOT NULL),
        'employers', count(DISTINCT b.employer_id),
        'qualifying_cases', COALESCE(sum(b.qualifying_case_count),0),
        'pending_exposure', COALESCE(sum(b.grand_total) FILTER (WHERE b.is_pending),0),
        'total_exposure', COALESCE(sum(b.grand_total),0),
        'oldest_pending_hours', COALESCE(max(b.waiting_hours) FILTER (WHERE b.is_pending),0)
      ) FROM base b),
    (SELECT jsonb_object_agg(k, v) FROM (
        SELECT 'ALL' AS k, count(*) AS v FROM base
        UNION ALL SELECT 'PENDING',    count(*) FROM base WHERE is_pending
        UNION ALL SELECT 'OVERDUE',    count(*) FROM base WHERE review_overdue
        UNION ALL SELECT 'APPROVED',   count(*) FROM base WHERE status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED')
        UNION ALL SELECT 'REFERRED',   count(*) FROM base WHERE referral_id IS NOT NULL
        UNION ALL SELECT 'REJECTED',   count(*) FROM base WHERE status_code = 'REJECTED'
        UNION ALL SELECT 'HIGH_RISK',  count(*) FROM base WHERE risk_rank >= 3
        UNION ALL SELECT 'HIGH_VALUE', count(*) FROM base WHERE high_value
      ) t),
    COALESCE((SELECT jsonb_agg(a) FROM (
        SELECT jsonb_build_object(
                 'recommendation_id', b.recommendation_id,
                 'employer_name', b.employer_name,
                 'amount', b.grand_total,
                 'status_label', b.status_json->>'label',
                 'priority', CASE reason WHEN 'REVIEW_OVERDUE' THEN 1 WHEN 'CRITICAL_PENDING' THEN 2
                                         WHEN 'APPROVED_NO_REFERRAL' THEN 3 WHEN 'PACK_STALLED' THEN 4
                                         WHEN 'HIGH_VALUE_PENDING' THEN 5 ELSE 6 END,
                 'reason', reason) AS a,
               CASE reason WHEN 'REVIEW_OVERDUE' THEN 1 WHEN 'CRITICAL_PENDING' THEN 2
                           WHEN 'APPROVED_NO_REFERRAL' THEN 3 WHEN 'PACK_STALLED' THEN 4
                           WHEN 'HIGH_VALUE_PENDING' THEN 5 ELSE 6 END AS prio
          FROM base b
          CROSS JOIN LATERAL (
            SELECT unnest(ARRAY[
              CASE WHEN b.review_overdue THEN 'REVIEW_OVERDUE' END,
              CASE WHEN b.is_pending AND b.risk_rank = 4 THEN 'CRITICAL_PENDING' END,
              CASE WHEN b.approved_no_referral THEN 'APPROVED_NO_REFERRAL' END,
              CASE WHEN b.pack_stalled THEN 'PACK_STALLED' END,
              CASE WHEN b.is_pending AND b.high_value THEN 'HIGH_VALUE_PENDING' END,
              CASE WHEN b.is_pending AND b.source_case_id IS NULL
                    AND COALESCE(b.qualifying_case_count,0) = 0 THEN 'NO_SOURCE_CASE' END
            ]) AS reason
          ) r
         WHERE reason IS NOT NULL
         ORDER BY prio, b.grand_total DESC
         LIMIT 12
      ) s), '[]'::jsonb),
    jsonb_build_object(
      'statuses', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', status_json->>'code', 'label', status_json->>'label')) FROM base), '[]'::jsonb),
      'risks',    COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', risk_json->>'code', 'label', risk_json->>'label')) FROM base), '[]'::jsonb),
      'sources',  COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', source_json->>'code', 'label', source_json->>'label')) FROM base), '[]'::jsonb),
      'legal_states', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', legal_json->>'code', 'label', legal_json->>'label')) FROM base), '[]'::jsonb),
      'zones',    COALESCE((SELECT jsonb_agg(DISTINCT zone) FROM base), '[]'::jsonb),
      'rules',    COALESCE((SELECT jsonb_agg(DISTINCT rn) FROM base b2,
                      LATERAL unnest(COALESCE(b2.rule_names, ARRAY[]::text[])) rn), '[]'::jsonb)
    )
  INTO v_rows, v_total, v_kpis, v_tabs, v_attention, v_facets;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'kpis', v_kpis,
    'tab_counts', v_tabs,
    'attention', v_attention,
    'facets', v_facets,
    'thresholds', jsonb_build_object(
      'review_sla_days', v_sla_days,
      'high_value', v_high_value,
      'pack_stall_days', v_stall_days),
    'actor', jsonb_build_object(
      'user_code', v_actor,
      'can_decide', v_can_decide,
      'can_generate', v_can_generate)
  );
END;
$$;