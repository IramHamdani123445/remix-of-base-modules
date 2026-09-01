CREATE OR REPLACE FUNCTION public.ce_legal_candidate_register_v1(
  p_filters   jsonb DEFAULT '{}'::jsonb,
  p_sort      text  DEFAULT 'readiness',
  p_dir       text  DEFAULT 'desc',
  p_page      integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_can_view boolean;
  v_can_view_all boolean;
  v_can_recommend boolean;
  v_can_approve boolean;
  v_can_override boolean;
  v_quick_forward boolean;
  v_high numeric;
  v_stall int;
  v_page int := GREATEST(1, COALESCE(p_page,1));
  v_size int := LEAST(200, GREATEST(1, COALESCE(p_page_size,25)));
  v_dir  text := CASE WHEN lower(COALESCE(p_dir,'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_tab  text := COALESCE(NULLIF(p_filters->>'tab',''),'ELIGIBLE');
  v_scope text := COALESCE(NULLIF(p_filters->>'scope',''),'ALL');
  v_search text := COALESCE(p_filters->>'search','');
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;

  v_can_view := public.ce_actor_can(v_uid,'compliance.enforcement.legal')
             OR public.ce_actor_can(v_uid,'compliance.legal.recommend')
             OR public.ce_actor_can(v_uid,'compliance.cases.manage');
  IF NOT v_can_view THEN RETURN jsonb_build_object('error','NOT_AUTHORISED'); END IF;

  v_can_approve   := public.ce_actor_can(v_uid,'compliance.legal.recommend_approve');
  v_can_override  := public.ce_actor_can(v_uid,'compliance.legal.override');
  v_can_recommend := public.ce_actor_can(v_uid,'compliance.legal.recommend')
                  OR public.ce_actor_can(v_uid,'compliance.cases.manage');
  v_can_view_all  := public.ce_actor_can(v_uid,'compliance.enforcement.legal')
                  OR v_can_approve OR v_can_override;
  v_quick_forward := v_can_override AND public.ce_feature_flag_enabled('compliance.legal.quick_forward');
  v_code := public.ce_actor_code(v_uid);

  IF NOT v_can_view_all THEN v_scope := 'MINE'; END IF;

  v_high  := public.ce_legal_candidate_setting('compliance.legal.high_value_threshold', 50000);
  v_stall := public.ce_legal_candidate_setting('compliance.legal.approval_sla_days', 5)::int;

  WITH base AS (
    SELECT v.*, e.*
      FROM public.ce_v_legal_referral_candidate v
      CROSS JOIN LATERAL (
        SELECT (j->>'eligibility_code')      AS eligibility_code,
               (j->>'action_code')           AS action_code,
               (j->>'stage_code')            AS stage_code,
               (j->>'referral_state_code')   AS referral_state_code,
               (j->>'rule_satisfied')::boolean AS rule_satisfied,
               (j->>'can_initiate')::boolean   AS can_initiate,
               (j->>'has_active_referral')::boolean AS has_active_referral,
               (j->'blocks')                 AS blocks,
               (j->'reasons')                AS reasons
          FROM (SELECT public.ce_legal_candidate_evaluate(v.*) AS j) x
      ) e
  ), owned AS (
    SELECT b.*,
      (b.assigned_officer_id IS NOT NULL
        AND (b.assigned_officer_id = v_uid::text
             OR b.assigned_officer_id = v_code
             OR b.assigned_officer_name IS NOT DISTINCT FROM v_code)) AS is_mine
    FROM base b
  ), scoped AS (
    SELECT o.* FROM owned o
     WHERE (v_scope = 'ALL' AND v_can_view_all)
        OR (v_scope = 'MINE' AND o.is_mine)
        OR (v_scope = 'TEAM' AND (o.is_mine OR o.zone IN (
              SELECT DISTINCT z.zone FROM owned z
               WHERE z.assigned_officer_id = v_uid::text OR z.assigned_officer_id = v_code)))
  ), enriched AS (
    SELECT s.*,
      (s.outstanding_amount >= v_high) AS high_value,
      (CASE WHEN s.eligibility_code = 'ELIGIBLE' THEN 60
            WHEN s.eligibility_code = 'RETURNED_FOR_REWORK' THEN 70
            WHEN s.eligibility_code = 'APPROVED_FOR_PACK' THEN 55
            WHEN s.eligibility_code = 'RECOMMENDATION_REQUIRED' THEN 45
            WHEN s.eligibility_code = 'AWAITING_RECOMMENDATION_APPROVAL' THEN 25
            WHEN s.eligibility_code = 'ALREADY_REFERRED' THEN 15
            WHEN s.eligibility_code = 'WITH_LEGAL' THEN 5
            ELSE 0 END
       + CASE WHEN s.outstanding_amount >= v_high THEN 20 ELSE 0 END
       + LEAST(20, (s.case_age_days / 30))
       + CASE WHEN s.eligibility_code = 'APPROVED_FOR_PACK'
                   AND s.reviewed_date IS NOT NULL
                   AND s.reviewed_date < now() - (v_stall || ' days')::interval THEN 25 ELSE 0 END
       + CASE WHEN s.open_returns > 0 THEN 20 ELSE 0 END
      ) AS readiness_score
    FROM scoped s
  ), attention_scored AS (
    SELECT e.*,
      CASE
        WHEN e.eligibility_code = 'RETURNED_FOR_REWORK' AND e.open_returns > 0 THEN 'RETURNED_AWAITING_REWORK'
        WHEN e.eligibility_code = 'APPROVED_FOR_PACK' AND e.reviewed_date < now() - (v_stall || ' days')::interval THEN 'APPROVED_PACK_NOT_STARTED'
        WHEN e.eligibility_code = 'ELIGIBLE' AND e.high_value THEN 'HIGH_VALUE_ELIGIBLE'
        WHEN e.eligibility_code = 'ELIGIBLE' AND e.case_age_days > 90 THEN 'ELIGIBLE_NOT_ACTIONED'
        WHEN e.eligibility_code = 'AWAITING_RECOMMENDATION_APPROVAL'
             AND e.recommended_at < now() - (v_stall || ' days')::interval THEN 'RECOMMENDATION_STALLED'
        WHEN e.has_active_referral AND e.recommendation_status = 'PENDING_REVIEW' THEN 'AMBIGUOUS_REFERRAL_STATE'
        WHEN e.eligibility_code IN ('ELIGIBLE','RECOMMENDATION_REQUIRED')
             AND COALESCE(e.employer_name,'') = '' THEN 'MISSING_REQUIRED_DATA'
        ELSE NULL END AS attention_reason
    FROM enriched e
  ), filtered AS (
    SELECT a.* FROM attention_scored a
     WHERE (
        v_tab = 'ALL'
        OR (v_tab = 'ELIGIBLE'   AND a.eligibility_code = 'ELIGIBLE')
        OR (v_tab = 'REC_REQ'    AND a.eligibility_code IN ('ELIGIBLE','RECOMMENDATION_REQUIRED'))
        OR (v_tab = 'AWAITING'   AND a.eligibility_code = 'AWAITING_RECOMMENDATION_APPROVAL')
        OR (v_tab = 'READY_PACK' AND a.eligibility_code = 'APPROVED_FOR_PACK')
        OR (v_tab = 'REFERRED'   AND a.eligibility_code IN ('ALREADY_REFERRED','WITH_LEGAL'))
        OR (v_tab = 'RETURNED'   AND a.eligibility_code = 'RETURNED_FOR_REWORK')
        OR (v_tab = 'HIGH_VALUE' AND a.high_value AND a.eligibility_code <> 'NOT_ELIGIBLE')
        OR (v_tab = 'MINE'       AND a.is_mine)
        OR (v_tab = 'NOT_ELIGIBLE' AND a.eligibility_code = 'NOT_ELIGIBLE')
       )
       AND (v_search = '' OR (
             a.case_number ILIKE '%'||v_search||'%'
          OR a.employer_name ILIKE '%'||v_search||'%'
          OR a.employer_reg_no ILIKE '%'||v_search||'%'
          OR a.principal_violation_number ILIKE '%'||v_search||'%'
          OR a.arrangement_number ILIKE '%'||v_search||'%'
          OR a.referral_number ILIKE '%'||v_search||'%'
          OR a.lg_intake_no ILIKE '%'||v_search||'%'
          OR a.lg_case_no ILIKE '%'||v_search||'%'))
       AND (COALESCE(p_filters->>'employer','') = '' OR a.employer_reg_no = p_filters->>'employer')
       AND (COALESCE(p_filters->>'case_status','') = '' OR a.case_status_code = p_filters->>'case_status')
       AND (COALESCE(p_filters->>'case_stage','') = '' OR a.stage_code = p_filters->>'case_stage')
       AND (COALESCE(p_filters->>'eligibility','') = '' OR a.eligibility_code = p_filters->>'eligibility')
       AND (COALESCE(p_filters->>'referral_state','') = '' OR a.referral_state_code = p_filters->>'referral_state')
       AND (COALESCE(p_filters->>'zone','') = '' OR a.zone = p_filters->>'zone')
       AND (COALESCE(p_filters->>'officer','') = '' OR
            (p_filters->>'officer' = '__UNASSIGNED__' AND a.assigned_officer_id IS NULL) OR
            (p_filters->>'officer' = '__ME__' AND a.is_mine) OR
            a.assigned_officer_name = p_filters->>'officer')
       AND (COALESCE(p_filters->>'arrangement','') = '' OR
            (p_filters->>'arrangement' = 'DEFAULT' AND a.arrangement_breach) OR
            (p_filters->>'arrangement' = 'ACTIVE' AND a.arrangement_active AND NOT a.arrangement_breach) OR
            (p_filters->>'arrangement' = 'NONE' AND a.arrangement_id IS NULL))
       AND (COALESCE(p_filters->>'enforcement','') = '' OR
            (p_filters->>'enforcement' = 'FINAL_NOTICE' AND a.final_notice_at IS NOT NULL) OR
            (p_filters->>'enforcement' = 'NOTICED' AND a.notices_sent > 0) OR
            (p_filters->>'enforcement' = 'NONE' AND a.notices_sent = 0))
       AND (COALESCE(p_filters->>'violation_type','') = '' OR a.case_type = p_filters->>'violation_type')
       AND (COALESCE(p_filters->>'amount_min','') = '' OR a.outstanding_amount >= (p_filters->>'amount_min')::numeric)
       AND (COALESCE(p_filters->>'amount_max','') = '' OR a.outstanding_amount <= (p_filters->>'amount_max')::numeric)
       AND (COALESCE(p_filters->>'action_from','') = '' OR a.last_action_at >= (p_filters->>'action_from')::date)
       AND (COALESCE(p_filters->>'action_to','') = '' OR a.last_action_at < ((p_filters->>'action_to')::date + 1))
  ), page AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'readiness' AND v_dir = 'desc' THEN f.readiness_score END DESC NULLS LAST,
      CASE WHEN p_sort = 'readiness' AND v_dir = 'asc'  THEN f.readiness_score END ASC  NULLS LAST,
      CASE WHEN p_sort = 'exposure'  AND v_dir = 'desc' THEN f.outstanding_amount END DESC NULLS LAST,
      CASE WHEN p_sort = 'exposure'  AND v_dir = 'asc'  THEN f.outstanding_amount END ASC  NULLS LAST,
      CASE WHEN p_sort = 'age'       AND v_dir = 'desc' THEN f.case_age_days END DESC NULLS LAST,
      CASE WHEN p_sort = 'age'       AND v_dir = 'asc'  THEN f.case_age_days END ASC  NULLS LAST,
      CASE WHEN p_sort = 'last_action' AND v_dir = 'desc' THEN f.last_action_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'last_action' AND v_dir = 'asc'  THEN f.last_action_at END ASC  NULLS LAST,
      CASE WHEN p_sort = 'employer'  AND v_dir = 'desc' THEN f.employer_name END DESC NULLS LAST,
      CASE WHEN p_sort = 'employer'  AND v_dir = 'asc'  THEN f.employer_name END ASC  NULLS LAST,
      CASE WHEN p_sort = 'case'      AND v_dir = 'desc' THEN f.case_number END DESC NULLS LAST,
      CASE WHEN p_sort = 'case'      AND v_dir = 'asc'  THEN f.case_number END ASC  NULLS LAST,
      CASE WHEN p_sort = 'officer'   AND v_dir = 'desc' THEN f.assigned_officer_name END DESC NULLS LAST,
      CASE WHEN p_sort = 'officer'   AND v_dir = 'asc'  THEN f.assigned_officer_name END ASC  NULLS LAST,
      CASE WHEN p_sort = 'referral'  AND v_dir = 'desc' THEN f.referral_state_code END DESC NULLS LAST,
      CASE WHEN p_sort = 'referral'  AND v_dir = 'asc'  THEN f.referral_state_code END ASC  NULLS LAST,
      CASE WHEN p_sort = 'eligibility' AND v_dir = 'desc' THEN f.eligibility_code END DESC NULLS LAST,
      CASE WHEN p_sort = 'eligibility' AND v_dir = 'asc'  THEN f.eligibility_code END ASC  NULLS LAST,
      f.readiness_score DESC, f.created_at ASC
    OFFSET (v_page - 1) * v_size LIMIT v_size
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'case_id', p.case_id,
        'case_number', p.case_number,
        'employer_reg_no', p.employer_reg_no,
        'employer_name', p.employer_name,
        'zone', p.zone,
        'case_status', public.ce_legal_candidate_label('CASE_STATUS', p.case_status_code),
        'case_stage', public.ce_legal_candidate_label('CASE_STAGE', p.stage_code),
        'eligibility', public.ce_legal_candidate_label('ELIGIBILITY', p.eligibility_code),
        'referral_state', public.ce_legal_candidate_label('REFERRAL_STATE', p.referral_state_code),
        'action', public.ce_legal_candidate_label('ACTION', p.action_code),
        'blocks', (SELECT COALESCE(jsonb_agg(public.ce_legal_candidate_label('BLOCK_REASON', b->>'code')
                     || jsonb_build_object('detail', b->>'detail')), '[]'::jsonb)
                     FROM jsonb_array_elements(p.blocks) b),
        'reasons', (SELECT COALESCE(jsonb_agg(public.ce_legal_candidate_label('ELIG_REASON', r->>'code')
                     || jsonb_build_object('detail', r->>'detail')), '[]'::jsonb)
                     FROM jsonb_array_elements(p.reasons) r),
        'rule_code', p.rule_code,
        'rule_name', p.rule_name,
        'outstanding_amount', p.outstanding_amount,
        'total_principal', p.total_principal,
        'total_penalties', p.total_penalties,
        'total_interest', p.total_interest,
        'amount_collected', p.amount_collected,
        'open_violations', p.open_violations,
        'total_violations', p.total_violations,
        'principal_violation_id', p.principal_violation_id,
        'principal_violation_number', p.principal_violation_number,
        'notices_sent', p.notices_sent,
        'last_notice_at', p.last_notice_at,
        'last_notice_type', p.last_notice_type,
        'final_notice_at', p.final_notice_at,
        'days_since_final_notice', p.days_since_final_notice,
        'arrangement_id', p.arrangement_id,
        'arrangement_number', p.arrangement_number,
        'arrangement_status', p.arrangement_status,
        'arrangement_breach', p.arrangement_breach,
        'arrangement_active', p.arrangement_active,
        'assigned_officer_name', p.assigned_officer_name,
        'is_mine', p.is_mine,
        'case_age_days', p.case_age_days,
        'last_action_at', p.last_action_at,
        'recommendation_id', p.recommendation_id,
        'recommendation_status', p.recommendation_status,
        'recommended_at', p.recommended_at,
        'referral_id', p.referral_id,
        'referral_number', p.referral_number,
        'referral_status', p.referral_status,
        'lg_intake_no', p.lg_intake_no,
        'lg_case_no', p.lg_case_no,
        'court_case_number', p.court_case_number,
        'open_returns', p.open_returns,
        'return_count', p.return_count,
        'high_value', p.high_value,
        'readiness_score', p.readiness_score,
        'can_initiate', p.can_initiate,
        'attention_reason', p.attention_reason
      ) ORDER BY p.readiness_score DESC, p.created_at ASC) FROM page p), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'page', v_page,
    'page_size', v_size,
    'kpis', (SELECT jsonb_build_object(
        'eligible',        count(*) FILTER (WHERE eligibility_code = 'ELIGIBLE'),
        'recommendation_required', count(*) FILTER (WHERE eligibility_code IN ('ELIGIBLE','RECOMMENDATION_REQUIRED')),
        'awaiting_approval', count(*) FILTER (WHERE eligibility_code = 'AWAITING_RECOMMENDATION_APPROVAL'),
        'ready_for_pack',  count(*) FILTER (WHERE eligibility_code = 'APPROVED_FOR_PACK'),
        'with_legal',      count(*) FILTER (WHERE eligibility_code IN ('ALREADY_REFERRED','WITH_LEGAL')),
        'returned',        count(*) FILTER (WHERE eligibility_code = 'RETURNED_FOR_REWORK'),
        'not_eligible',    count(*) FILTER (WHERE eligibility_code = 'NOT_ELIGIBLE'),
        'eligible_exposure', COALESCE(sum(outstanding_amount) FILTER (WHERE eligibility_code IN ('ELIGIBLE','RECOMMENDATION_REQUIRED','APPROVED_FOR_PACK')),0),
        'total_exposure',  COALESCE(sum(outstanding_amount),0),
        'employers',       count(DISTINCT employer_reg_no)
      ) FROM attention_scored),
    'tab_counts', (SELECT jsonb_build_object(
        'ALL', count(*),
        'ELIGIBLE', count(*) FILTER (WHERE eligibility_code = 'ELIGIBLE'),
        'REC_REQ', count(*) FILTER (WHERE eligibility_code IN ('ELIGIBLE','RECOMMENDATION_REQUIRED')),
        'AWAITING', count(*) FILTER (WHERE eligibility_code = 'AWAITING_RECOMMENDATION_APPROVAL'),
        'READY_PACK', count(*) FILTER (WHERE eligibility_code = 'APPROVED_FOR_PACK'),
        'REFERRED', count(*) FILTER (WHERE eligibility_code IN ('ALREADY_REFERRED','WITH_LEGAL')),
        'RETURNED', count(*) FILTER (WHERE eligibility_code = 'RETURNED_FOR_REWORK'),
        'HIGH_VALUE', count(*) FILTER (WHERE high_value AND eligibility_code <> 'NOT_ELIGIBLE'),
        'MINE', count(*) FILTER (WHERE is_mine),
        'NOT_ELIGIBLE', count(*) FILTER (WHERE eligibility_code = 'NOT_ELIGIBLE')
      ) FROM attention_scored),
    'attention', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'case_id', t.case_id, 'case_number', t.case_number, 'employer_name', t.employer_name,
        'amount', t.outstanding_amount, 'reason', t.attention_reason,
        'eligibility_label', (public.ce_legal_candidate_label('ELIGIBILITY', t.eligibility_code)->>'label'),
        'action_code', t.action_code
      ) ORDER BY t.readiness_score DESC) FROM (
        SELECT * FROM attention_scored WHERE attention_reason IS NOT NULL
        ORDER BY readiness_score DESC LIMIT 8) t), '[]'::jsonb),
    'facets', jsonb_build_object(
      'case_statuses', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', case_status_code,
            'label', (public.ce_legal_candidate_label('CASE_STATUS', case_status_code)->>'label')))
            FROM attention_scored WHERE case_status_code IS NOT NULL), '[]'::jsonb),
      'case_stages', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', stage_code,
            'label', (public.ce_legal_candidate_label('CASE_STAGE', stage_code)->>'label')))
            FROM attention_scored), '[]'::jsonb),
      'eligibilities', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', eligibility_code,
            'label', (public.ce_legal_candidate_label('ELIGIBILITY', eligibility_code)->>'label')))
            FROM attention_scored), '[]'::jsonb),
      'referral_states', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', referral_state_code,
            'label', (public.ce_legal_candidate_label('REFERRAL_STATE', referral_state_code)->>'label')))
            FROM attention_scored), '[]'::jsonb),
      'zones', COALESCE((SELECT jsonb_agg(DISTINCT zone) FROM attention_scored WHERE zone IS NOT NULL), '[]'::jsonb),
      'officers', COALESCE((SELECT jsonb_agg(DISTINCT assigned_officer_name) FROM attention_scored
            WHERE assigned_officer_name IS NOT NULL), '[]'::jsonb),
      'case_types', COALESCE((SELECT jsonb_agg(DISTINCT case_type) FROM attention_scored WHERE case_type IS NOT NULL), '[]'::jsonb),
      'employers', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', employer_reg_no, 'label', employer_name))
            FROM attention_scored WHERE employer_reg_no IS NOT NULL), '[]'::jsonb)
    ),
    'thresholds', jsonb_build_object('high_value', v_high, 'stall_days', v_stall),
    'actor', jsonb_build_object(
      'user_code', v_code,
      'can_view_all', v_can_view_all,
      'can_recommend', v_can_recommend,
      'can_approve', v_can_approve,
      'can_quick_forward', v_quick_forward,
      'scope', v_scope)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_legal_candidate_register_v1(jsonb, text, text, integer, integer) TO authenticated, service_role;