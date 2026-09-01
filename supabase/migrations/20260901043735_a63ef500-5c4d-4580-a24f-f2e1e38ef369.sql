REVOKE EXECUTE ON FUNCTION public.ce_breach_detect_v1(text, date, boolean) FROM authenticated;

-- ============================================================
-- Register view
-- ============================================================
CREATE OR REPLACE VIEW public.ce_v_breach_register AS
SELECT
  b.id                              AS breach_id,
  'BR-' || upper(substr(b.id::text,1,8)) AS breach_reference,
  b.arrangement_id,
  ar.arrangement_number,
  ar.employer_id,
  ar.employer_name,
  ar.regno,
  ar.status                         AS arrangement_status,
  ar.status_label                   AS arrangement_status_label,
  ar.health_status                  AS arrangement_health,
  ar.health_label                   AS arrangement_health_label,
  ar.outstanding                    AS arrangement_outstanding,
  ar.past_due_amount                AS arrangement_past_due,
  ar.total_arranged,
  ar.total_paid,
  ar.max_missed_before_breach,
  b.breach_type,
  bt.label                          AS breach_type_label,
  b.severity,
  sv.label                          AS severity_label,
  b.breach_status,
  bs.label                          AS breach_status_label,
  b.escalation_status,
  es.label                          AS escalation_status_label,
  b.detection_method,
  dm.label                          AS detection_method_label,
  b.detection_rule,
  b.detected_at,
  b.detected_at::date               AS breach_date,
  GREATEST(0, (CURRENT_DATE - b.detected_at::date))::int AS age_days,
  b.description,
  b.installment_id,
  COALESCE(b.installment_number, i.installment_number) AS installment_number,
  COALESCE(b.due_date_at_breach, i.due_date)           AS installment_due_date,
  i.amount                          AS installment_amount,
  COALESCE(i.paid_amount,0)         AS installment_paid,
  COALESCE(b.amount_outstanding_at_breach, i.amount - COALESCE(i.paid_amount,0), 0) AS shortfall,
  i.status                          AS installment_status,
  i.payment_reference               AS installment_payment_reference,
  b.grace_days_at_breach,
  COALESCE(b.consecutive_misses, ar.overdue_count, 0)::int AS consecutive_misses,
  b.case_id,
  c.case_number,
  c.status                          AS case_status,
  b.violation_id,
  v.violation_number,
  b.legal_referral_id,
  lr.referral_number                AS legal_referral_number,
  lr.status                         AS legal_referral_status,
  b.assigned_to,
  pr.full_name                      AS assigned_to_name,
  b.assigned_at,
  b.resolution,
  b.resolution_type,
  rt.label                          AS resolution_type_label,
  b.resolution_reason,
  b.resolution_notes,
  b.resolved_at,
  b.resolved_by,
  b.payment_reference,
  b.last_action_at,
  b.created_at,
  b.updated_at,
  n.notice_number                   AS last_notice_number,
  n.status                          AS last_notice_status,
  n.sent_at                         AS last_notice_sent_at
FROM public.ce_arrangement_breaches b
LEFT JOIN public.ce_v_arrangement_register_ext ar ON ar.arrangement_id = b.arrangement_id
LEFT JOIN public.ce_installments i ON i.id = b.installment_id
LEFT JOIN public.ce_cases c ON c.id = b.case_id
LEFT JOIN public.ce_violations v ON v.id = b.violation_id
LEFT JOIN public.ce_legal_referrals lr ON lr.id = b.legal_referral_id
LEFT JOIN public.profiles pr ON pr.id = b.assigned_to
LEFT JOIN public.ce_breach_ref bt ON bt.domain='BREACH_TYPE' AND bt.code = b.breach_type
LEFT JOIN public.ce_breach_ref bs ON bs.domain='BREACH_STATUS' AND bs.code = b.breach_status
LEFT JOIN public.ce_breach_ref es ON es.domain='ESCALATION_STATUS' AND es.code = b.escalation_status
LEFT JOIN public.ce_breach_ref sv ON sv.domain='SEVERITY' AND sv.code = b.severity
LEFT JOIN public.ce_breach_ref dm ON dm.domain='DETECTION_METHOD' AND dm.code = b.detection_method
LEFT JOIN public.ce_breach_ref rt ON rt.domain='RESOLUTION_TYPE' AND rt.code = b.resolution_type
LEFT JOIN LATERAL (
  SELECT nn.notice_number, nn.status, nn.sent_at
  FROM public.ce_notices nn
  WHERE nn.case_id = b.case_id
  ORDER BY COALESCE(nn.sent_at, nn.created_at) DESC
  LIMIT 1
) n ON true;

GRANT SELECT ON public.ce_v_breach_register TO authenticated, service_role;

-- ============================================================
-- Register RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_breach_register_v1(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tab text := COALESCE(p_params->>'tab','ALL');
  v_search text := NULLIF(btrim(COALESCE(p_params->>'search','')),'');
  v_employer text := NULLIF(btrim(COALESCE(p_params->>'employer_id','')),'');
  v_arr text := NULLIF(btrim(COALESCE(p_params->>'arrangement_id','')),'');
  v_officer text := NULLIF(btrim(COALESCE(p_params->>'officer','')),'');
  v_types text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'types','[]'::jsonb))),'{}');
  v_status text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'statuses','[]'::jsonb))),'{}');
  v_esc text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'escalations','[]'::jsonb))),'{}');
  v_health text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'health','[]'::jsonb))),'{}');
  v_detection text := NULLIF(COALESCE(p_params->>'detection',''),'');
  v_window text := NULLIF(COALESCE(p_params->>'breach_window',''),'');
  v_from date := NULLIF(COALESCE(p_params->>'breach_from',''),'')::date;
  v_to date := NULLIF(COALESCE(p_params->>'breach_to',''),'')::date;
  v_amount text := NULLIF(COALESCE(p_params->>'amount_band',''),'');
  v_min numeric := NULLIF(COALESCE(p_params->>'min_shortfall',''),'')::numeric;
  v_max numeric := NULLIF(COALESCE(p_params->>'max_shortfall',''),'')::numeric;
  v_sort text := COALESCE(p_params->>'sort','urgency');
  v_dir text := CASE WHEN lower(COALESCE(p_params->>'dir','desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_page int := GREATEST(1, COALESCE((p_params->>'page')::int,1));
  v_size int := LEAST(200, GREATEST(10, COALESCE((p_params->>'page_size')::int,25)));
  v_sla numeric := COALESCE((SELECT numeric_value FROM ce_breach_ref WHERE domain='THRESHOLD' AND code='RESPONSE_SLA_DAYS'),5);
  v_high numeric := COALESCE((SELECT numeric_value FROM ce_breach_ref WHERE domain='THRESHOLD' AND code='HIGH_VALUE_SHORTFALL'),10000);
  v_newd numeric := COALESCE((SELECT numeric_value FROM ce_breach_ref WHERE domain='THRESHOLD' AND code='NEW_BREACH_DAYS'),7);
  v_total int; v_rows jsonb; v_kpis jsonb; v_tabs jsonb; v_att jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (ce_actor_can(v_uid,'compliance.enforcement.arrangements')
       OR ce_actor_can(v_uid,'compliance.workbench.team')
       OR ce_actor_can(v_uid,'compliance.workbench.enterprise')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  WITH base AS (
    SELECT r.*,
      (r.breach_status IN ('OPEN','UNDER_REVIEW')) AS is_open,
      (r.breach_status IN ('OPEN','UNDER_REVIEW') AND r.age_days > v_sla) AS sla_overdue,
      (r.breach_status IN ('OPEN','UNDER_REVIEW') AND COALESCE(r.shortfall,0) >= v_high) AS high_value,
      (r.breach_type = 'ARRANGEMENT_DEFAULT') AS is_default,
      (r.breach_status IN ('OPEN','UNDER_REVIEW') AND r.assigned_to IS NULL) AS unassigned,
      (r.detected_at >= now() - (v_newd || ' days')::interval) AS is_new,
      (r.breach_status IN ('OPEN','UNDER_REVIEW')
        AND COALESCE(r.consecutive_misses,0) >= COALESCE(r.max_missed_before_breach,2)) AS repeated,
      (r.breach_type = 'ARRANGEMENT_DEFAULT' AND r.breach_status IN ('OPEN','UNDER_REVIEW')
        AND r.escalation_status IN ('NONE','CASE')) AS default_no_action,
      (r.breach_status IN ('OPEN','UNDER_REVIEW') AND r.last_notice_number IS NULL AND r.case_id IS NOT NULL) AS no_notice
    FROM ce_v_breach_register r
  ), scored AS (
    SELECT b.*,
      (CASE WHEN b.is_default THEN 55 ELSE 0 END
     + CASE WHEN b.default_no_action THEN 20 ELSE 0 END
     + CASE WHEN b.sla_overdue THEN 40 ELSE 0 END
     + CASE WHEN b.high_value THEN 30 ELSE 0 END
     + CASE WHEN b.repeated THEN 25 ELSE 0 END
     + CASE WHEN b.unassigned THEN 15 ELSE 0 END
     + CASE WHEN b.no_notice THEN 10 ELSE 0 END
     + CASE WHEN b.is_open THEN LEAST(b.age_days, 30) ELSE 0 END) AS attention_score,
      CASE
        WHEN NOT b.is_open THEN 'No action required'
        WHEN b.escalation_status = 'LEGAL_REFERRED' THEN 'Track legal referral'
        WHEN b.is_default AND b.escalation_status IN ('NONE','CASE') THEN 'Legal review required'
        WHEN b.unassigned THEN 'Assign an officer'
        WHEN b.case_id IS NULL THEN 'Link a compliance case'
        WHEN b.no_notice THEN 'Issue notice'
        WHEN b.sla_overdue THEN 'Contact employer — response overdue'
        WHEN b.breach_status = 'UNDER_REVIEW' THEN 'Await payment / confirm cure'
        ELSE 'Review breach' END AS next_action
    FROM base b
  ), filtered AS (
    SELECT s.* FROM scored s
    WHERE (v_search IS NULL OR (
            s.breach_reference ILIKE '%'||v_search||'%' OR
            COALESCE(s.arrangement_number,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.employer_name,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.employer_id,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.regno,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.case_number,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.violation_number,'') ILIKE '%'||v_search||'%'))
      AND (v_employer IS NULL OR s.employer_id = v_employer)
      AND (v_arr IS NULL OR s.arrangement_id::text = v_arr OR s.arrangement_number = v_arr)
      AND (v_officer IS NULL OR CASE
             WHEN v_officer = 'ME' THEN s.assigned_to = v_uid
             WHEN v_officer = 'UNASSIGNED' THEN s.assigned_to IS NULL
             ELSE s.assigned_to::text = v_officer END)
      AND (cardinality(v_types)=0 OR s.breach_type = ANY(v_types))
      AND (cardinality(v_status)=0 OR s.breach_status = ANY(v_status))
      AND (cardinality(v_esc)=0 OR s.escalation_status = ANY(v_esc))
      AND (cardinality(v_health)=0 OR s.arrangement_health = ANY(v_health))
      AND (v_detection IS NULL OR s.detection_method = v_detection)
      AND (v_window IS NULL OR CASE v_window
             WHEN 'TODAY' THEN s.breach_date = CURRENT_DATE
             WHEN 'D7' THEN s.detected_at >= now() - interval '7 days'
             WHEN 'D30' THEN s.detected_at >= now() - interval '30 days'
             WHEN 'D90' THEN s.detected_at >= now() - interval '90 days'
             WHEN 'CUSTOM' THEN (v_from IS NULL OR s.breach_date >= v_from) AND (v_to IS NULL OR s.breach_date <= v_to)
             ELSE true END)
      AND (v_amount IS NULL OR CASE v_amount
             WHEN 'LT1K' THEN COALESCE(s.shortfall,0) < 1000
             WHEN '1K5K' THEN COALESCE(s.shortfall,0) BETWEEN 1000 AND 5000
             WHEN '5K10K' THEN COALESCE(s.shortfall,0) > 5000 AND COALESCE(s.shortfall,0) <= 10000
             WHEN '10K50K' THEN COALESCE(s.shortfall,0) > 10000 AND COALESCE(s.shortfall,0) <= 50000
             WHEN 'GT50K' THEN COALESCE(s.shortfall,0) > 50000
             ELSE true END)
      AND (v_min IS NULL OR COALESCE(s.shortfall,0) >= v_min)
      AND (v_max IS NULL OR COALESCE(s.shortfall,0) <= v_max)
      AND CASE v_tab
            WHEN 'OPEN' THEN s.is_open
            WHEN 'ATTENTION' THEN s.is_open AND s.attention_score > 0
            WHEN 'NEW' THEN s.is_new
            WHEN 'REPEATED' THEN s.repeated
            WHEN 'HIGH_VALUE' THEN s.high_value
            WHEN 'DEFAULTED' THEN s.is_default
            WHEN 'LEGAL' THEN s.escalation_status IN ('LEGAL_RECOMMENDED','LEGAL_REFERRED')
            WHEN 'AUTO' THEN s.detection_method = 'AUTOMATIC'
            WHEN 'RESOLVED' THEN s.breach_status IN ('RESOLVED','CLOSED')
            WHEN 'MINE' THEN s.assigned_to = v_uid
            ELSE true END
  ), pageset AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN v_sort='urgency' THEN (CASE WHEN f.is_open THEN 1 ELSE 0 END) END DESC,
      CASE WHEN v_sort='urgency' THEN f.attention_score END DESC,
      CASE WHEN v_sort='urgency' THEN f.detected_at END ASC,
      CASE WHEN v_sort='breach_date' AND v_dir='asc' THEN f.detected_at END ASC,
      CASE WHEN v_sort='breach_date' AND v_dir='desc' THEN f.detected_at END DESC,
      CASE WHEN v_sort='age' AND v_dir='asc' THEN f.age_days END ASC,
      CASE WHEN v_sort='age' AND v_dir='desc' THEN f.age_days END DESC,
      CASE WHEN v_sort='shortfall' AND v_dir='asc' THEN COALESCE(f.shortfall,0) END ASC,
      CASE WHEN v_sort='shortfall' AND v_dir='desc' THEN COALESCE(f.shortfall,0) END DESC,
      CASE WHEN v_sort='past_due' AND v_dir='asc' THEN COALESCE(f.arrangement_past_due,0) END ASC,
      CASE WHEN v_sort='past_due' AND v_dir='desc' THEN COALESCE(f.arrangement_past_due,0) END DESC,
      CASE WHEN v_sort='misses' AND v_dir='asc' THEN COALESCE(f.consecutive_misses,0) END ASC,
      CASE WHEN v_sort='misses' AND v_dir='desc' THEN COALESCE(f.consecutive_misses,0) END DESC,
      CASE WHEN v_sort='employer' AND v_dir='asc' THEN COALESCE(f.employer_name,f.employer_id) END ASC,
      CASE WHEN v_sort='employer' AND v_dir='desc' THEN COALESCE(f.employer_name,f.employer_id) END DESC,
      CASE WHEN v_sort='arrangement' AND v_dir='asc' THEN f.arrangement_number END ASC,
      CASE WHEN v_sort='arrangement' AND v_dir='desc' THEN f.arrangement_number END DESC,
      CASE WHEN v_sort='status' AND v_dir='asc' THEN f.breach_status_label END ASC,
      CASE WHEN v_sort='status' AND v_dir='desc' THEN f.breach_status_label END DESC,
      CASE WHEN v_sort='detection' AND v_dir='asc' THEN f.detection_method END ASC,
      CASE WHEN v_sort='detection' AND v_dir='desc' THEN f.detection_method END DESC,
      CASE WHEN v_sort='updated' AND v_dir='asc' THEN COALESCE(f.last_action_at, f.updated_at) END ASC,
      CASE WHEN v_sort='updated' AND v_dir='desc' THEN COALESCE(f.last_action_at, f.updated_at) END DESC,
      f.detected_at DESC
    LIMIT v_size OFFSET (v_page-1)*v_size
  ), att AS (
    SELECT jsonb_build_object(
      'breach_id', s.breach_id,
      'breach_reference', s.breach_reference,
      'arrangement_id', s.arrangement_id,
      'arrangement_number', s.arrangement_number,
      'employer_name', COALESCE(s.employer_name, s.employer_id),
      'shortfall', s.shortfall,
      'age_days', s.age_days,
      'priority', s.attention_score,
      'next_action', s.next_action,
      'reason', CASE
          WHEN s.default_no_action THEN 'Arrangement defaulted with no downstream enforcement'
          WHEN s.sla_overdue THEN 'Unresolved '||s.age_days::text||' day(s) — response interval is '||v_sla::text||' day(s)'
          WHEN s.high_value THEN 'High-value shortfall outstanding'
          WHEN s.repeated THEN COALESCE(s.consecutive_misses,0)::text||' missed installment(s) at or beyond threshold'
          WHEN s.unassigned THEN 'Open breach with no assigned officer'
          WHEN s.no_notice THEN 'No notice issued on the linked case'
          ELSE 'Newly detected breach awaiting review' END) AS a,
      s.attention_score AS sc
    FROM scored s WHERE s.is_open AND s.attention_score > 0
    ORDER BY s.attention_score DESC, s.detected_at ASC
    LIMIT 8
  )
  SELECT
    (SELECT count(*)::int FROM filtered),
    COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM pageset p),'[]'::jsonb),
    jsonb_build_object(
      'open_breaches', (SELECT count(*) FROM scored WHERE is_open),
      'new_breaches', (SELECT count(*) FROM scored WHERE is_new),
      'defaulted', (SELECT count(*) FROM scored WHERE is_default AND is_open),
      'past_due_exposure', (SELECT COALESCE(sum(shortfall),0) FROM scored WHERE is_open),
      'awaiting_action', (SELECT count(*) FROM scored WHERE is_open AND (unassigned OR sla_overdue)),
      'resolved', (SELECT count(*) FROM scored WHERE breach_status IN ('RESOLVED','CLOSED')),
      'auto_rate', (SELECT CASE WHEN count(*)=0 THEN 0
                      ELSE round(100.0 * count(*) FILTER (WHERE detection_method='AUTOMATIC') / count(*)) END FROM scored),
      'total', (SELECT count(*) FROM scored)
    ),
    jsonb_build_object(
      'ALL', (SELECT count(*) FROM scored),
      'OPEN', (SELECT count(*) FROM scored WHERE is_open),
      'ATTENTION', (SELECT count(*) FROM scored WHERE is_open AND attention_score > 0),
      'NEW', (SELECT count(*) FROM scored WHERE is_new),
      'REPEATED', (SELECT count(*) FROM scored WHERE repeated),
      'HIGH_VALUE', (SELECT count(*) FROM scored WHERE high_value),
      'DEFAULTED', (SELECT count(*) FROM scored WHERE is_default),
      'LEGAL', (SELECT count(*) FROM scored WHERE escalation_status IN ('LEGAL_RECOMMENDED','LEGAL_REFERRED')),
      'AUTO', (SELECT count(*) FROM scored WHERE detection_method='AUTOMATIC'),
      'RESOLVED', (SELECT count(*) FROM scored WHERE breach_status IN ('RESOLVED','CLOSED')),
      'MINE', (SELECT count(*) FROM scored WHERE assigned_to = v_uid)
    ),
    COALESCE((SELECT jsonb_agg(a ORDER BY sc DESC) FROM att),'[]'::jsonb)
  INTO v_total, v_rows, v_kpis, v_tabs, v_att;

  RETURN jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
    'kpis', v_kpis, 'tab_counts', v_tabs, 'attention', v_att,
    'thresholds', jsonb_build_object(
      'response_sla_days', v_sla, 'high_value_shortfall', v_high, 'new_breach_days', v_newd),
    'actor', jsonb_build_object(
      'user_id', v_uid,
      'can_manage', ce_actor_can(v_uid,'compliance.enforcement.arrangements'),
      'can_resolve', ce_actor_can(v_uid,'compliance.enforcement.arrangements'),
      'can_override', ce_actor_can(v_uid,'compliance.management.resolve'),
      'can_assign', ce_actor_can(v_uid,'compliance.workbench.team'),
      'can_refer_legal', ce_actor_can(v_uid,'compliance.enforcement.legal'))
  );
END;
$$;

-- ============================================================
-- Facets
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_breach_facets_v1()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  RETURN jsonb_build_object(
    'types', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY sort_order)
                       FROM ce_breach_ref WHERE domain='BREACH_TYPE' AND is_active),'[]'::jsonb),
    'statuses', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY sort_order)
                       FROM ce_breach_ref WHERE domain='BREACH_STATUS' AND is_active),'[]'::jsonb),
    'escalations', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY sort_order)
                       FROM ce_breach_ref WHERE domain='ESCALATION_STATUS' AND is_active),'[]'::jsonb),
    'resolution_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY sort_order)
                       FROM ce_breach_ref WHERE domain='RESOLUTION_TYPE' AND is_active),'[]'::jsonb),
    'detection_methods', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY sort_order)
                       FROM ce_breach_ref WHERE domain='DETECTION_METHOD' AND is_active),'[]'::jsonb),
    'health', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code',code,'label',label))
                       FROM ce_arrangement_ref WHERE domain='HEALTH'),'[]'::jsonb),
    'employers', COALESCE((SELECT jsonb_agg(e ORDER BY e->>'label')
                       FROM (SELECT DISTINCT jsonb_build_object('code',employer_id,
                                    'label', COALESCE(employer_name, employer_id) ||
                                             CASE WHEN regno IS NOT NULL THEN ' ('||regno||')' ELSE '' END) AS e
                             FROM ce_v_breach_register WHERE employer_id IS NOT NULL) q),'[]'::jsonb),
    'arrangements', COALESCE((SELECT jsonb_agg(a ORDER BY a->>'label')
                       FROM (SELECT DISTINCT jsonb_build_object('code',arrangement_id::text,'label',arrangement_number) AS a
                             FROM ce_v_breach_register WHERE arrangement_number IS NOT NULL) q),'[]'::jsonb),
    'officers', COALESCE((SELECT jsonb_agg(o ORDER BY o->>'label')
                       FROM (SELECT DISTINCT jsonb_build_object('code', i.profile_id::text,
                                    'label', COALESCE(pr.full_name, i.inspector_code)) AS o
                             FROM ce_inspectors i LEFT JOIN profiles pr ON pr.id = i.profile_id
                             WHERE i.profile_id IS NOT NULL) q),'[]'::jsonb)
  );
END;
$$;

-- ============================================================
-- Detail
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_breach_detail_v1(p_breach_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb; v_hist jsonb; v_inst jsonb; v_notices jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (ce_actor_can(v_uid,'compliance.enforcement.arrangements')
       OR ce_actor_can(v_uid,'compliance.workbench.team')
       OR ce_actor_can(v_uid,'compliance.workbench.enterprise')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  SELECT to_jsonb(r) INTO v_row FROM ce_v_breach_register r WHERE r.breach_id = p_breach_id;
  IF v_row IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', l.performed_at, 'actor', l.performed_by, 'action', l.action,
           'description', l.description, 'old_values', l.old_values, 'new_values', l.new_values)
           ORDER BY l.performed_at DESC), '[]'::jsonb)
  INTO v_hist
  FROM ce_audit_log l
  WHERE (l.entity_type = 'ARRANGEMENT_BREACH' AND l.entity_id IN (p_breach_id, (v_row->>'arrangement_id')::uuid))
     OR (l.entity_type = 'ARRANGEMENT' AND l.entity_id = (v_row->>'arrangement_id')::uuid);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'installment_number', i.installment_number, 'due_date', i.due_date,
           'amount', i.amount, 'paid_amount', COALESCE(i.paid_amount,0),
           'shortfall', i.amount - COALESCE(i.paid_amount,0),
           'status', i.status, 'paid_date', i.paid_date,
           'payment_reference', i.payment_reference,
           'is_breached_installment', (i.id = (v_row->>'installment_id')::uuid))
           ORDER BY i.installment_number), '[]'::jsonb)
  INTO v_inst
  FROM ce_installments i WHERE i.arrangement_id = (v_row->>'arrangement_id')::uuid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'notice_number', n.notice_number, 'notice_type', n.notice_type,
           'status', n.status, 'sent_at', n.sent_at, 'due_response_date', n.due_response_date)
           ORDER BY COALESCE(n.sent_at, n.created_at) DESC), '[]'::jsonb)
  INTO v_notices
  FROM ce_notices n WHERE n.case_id = (v_row->>'case_id')::uuid;

  RETURN jsonb_build_object(
    'breach', v_row, 'installments', v_inst, 'notices', v_notices, 'history', v_hist,
    'actor', jsonb_build_object(
      'can_resolve', ce_actor_can(v_uid,'compliance.enforcement.arrangements'),
      'can_override', ce_actor_can(v_uid,'compliance.management.resolve'),
      'can_assign', ce_actor_can(v_uid,'compliance.workbench.team'),
      'can_refer_legal', ce_actor_can(v_uid,'compliance.enforcement.legal')));
END;
$$;

-- ============================================================
-- Governed actions
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_breach_assign_v1(
  p_breach_id uuid, p_assignee uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_old uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT ce_actor_can(v_uid,'compliance.workbench.team') THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  SELECT assigned_to INTO v_old FROM ce_arrangement_breaches WHERE id = p_breach_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  UPDATE ce_arrangement_breaches
  SET assigned_to = p_assignee, assigned_at = now(), assigned_by = v_uid::text,
      breach_status = CASE WHEN breach_status = 'OPEN' THEN 'UNDER_REVIEW' ELSE breach_status END,
      last_action_at = now(), updated_by = v_uid::text
  WHERE id = p_breach_id;

  INSERT INTO ce_audit_log (entity_type, entity_id, action, description, old_values, new_values, performed_by, performed_at)
  VALUES ('ARRANGEMENT_BREACH', p_breach_id, 'BREACH_ASSIGNED',
          COALESCE(p_notes,'Breach assigned'),
          jsonb_build_object('assigned_to', v_old),
          jsonb_build_object('assigned_to', p_assignee), v_uid::text, now());

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_breach_resolve_v1(
  p_breach_id uuid,
  p_resolution_type text,
  p_resolution_reason text,
  p_resolution_date date DEFAULT CURRENT_DATE,
  p_payment_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_b RECORD; v_paid numeric; v_amount numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT ce_actor_can(v_uid,'compliance.enforcement.arrangements') THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  IF COALESCE(btrim(p_resolution_reason),'') = '' THEN
    RETURN jsonb_build_object('error','RESOLUTION_REASON_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ce_breach_ref WHERE domain='RESOLUTION_TYPE' AND code = p_resolution_type AND is_active) THEN
    RETURN jsonb_build_object('error','INVALID_RESOLUTION_TYPE');
  END IF;

  SELECT * INTO v_b FROM ce_arrangement_breaches WHERE id = p_breach_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF v_b.breach_status IN ('RESOLVED','CLOSED') THEN
    RETURN jsonb_build_object('error','ALREADY_RESOLVED');
  END IF;

  -- Evidence rule: a payment-based resolution must be supported by allocated money
  IF p_resolution_type = 'PAYMENT_ALLOCATED' THEN
    SELECT COALESCE(paid_amount,0), amount INTO v_paid, v_amount
    FROM ce_installments WHERE id = v_b.installment_id;
    IF v_b.installment_id IS NULL OR COALESCE(v_paid,0) < COALESCE(v_amount,0) THEN
      RETURN jsonb_build_object('error','PAYMENT_NOT_EVIDENCED',
        'message','The installment is not fully settled in the payment ledger. Allocate the payment first, or resolve with a different resolution type.');
    END IF;
  END IF;

  -- Exceptional (non payment) resolutions require senior authority
  IF p_resolution_type IN ('MANAGEMENT_WAIVED','DETECTION_ERROR')
     AND NOT ce_actor_can(v_uid,'compliance.management.resolve') THEN
    RETURN jsonb_build_object('error','APPROVAL_REQUIRED',
      'message','Waiver and detection-error resolutions require senior compliance authority.');
  END IF;

  UPDATE ce_arrangement_breaches
  SET resolution = CASE WHEN p_resolution_type = 'PAYMENT_ALLOCATED' THEN 'CURED' ELSE 'RESOLVED' END,
      breach_status = 'RESOLVED',
      resolution_type = p_resolution_type,
      resolution_reason = p_resolution_reason,
      resolution_notes = p_notes,
      payment_reference = p_payment_reference,
      resolved_at = (p_resolution_date::timestamptz + (now()::time)),
      resolved_by = v_uid::text,
      last_action_at = now(), updated_by = v_uid::text
  WHERE id = p_breach_id;

  INSERT INTO ce_audit_log (entity_type, entity_id, action, description, old_values, new_values, performed_by, performed_at)
  VALUES ('ARRANGEMENT_BREACH', p_breach_id, 'BREACH_RESOLVED',
          format('Breach resolved (%s): %s', p_resolution_type, p_resolution_reason),
          jsonb_build_object('breach_status', v_b.breach_status),
          jsonb_build_object('breach_status','RESOLVED','resolution_type',p_resolution_type,
                             'resolution_reason',p_resolution_reason,'payment_reference',p_payment_reference,
                             'arrangement_id', v_b.arrangement_id, 'installment_id', v_b.installment_id),
          v_uid::text, now());

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_breach_link_referral_v1(
  p_breach_id uuid, p_referral_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT ce_actor_can(v_uid,'compliance.enforcement.legal') THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  SELECT status INTO v_status FROM ce_legal_referrals WHERE id = p_referral_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','REFERRAL_NOT_FOUND'); END IF;

  UPDATE ce_arrangement_breaches
  SET legal_referral_id = p_referral_id,
      escalation_status = CASE WHEN v_status IN ('DRAFT','PENDING_APPROVAL') THEN 'LEGAL_RECOMMENDED' ELSE 'LEGAL_REFERRED' END,
      last_action_at = now(), updated_by = v_uid::text
  WHERE id = p_breach_id AND legal_referral_id IS NULL;

  IF NOT FOUND THEN RETURN jsonb_build_object('error','ALREADY_REFERRED'); END IF;

  INSERT INTO ce_audit_log (entity_type, entity_id, action, description, new_values, performed_by, performed_at)
  VALUES ('ARRANGEMENT_BREACH', p_breach_id, 'BREACH_LEGAL_LINKED',
          'Legal referral linked to breach',
          jsonb_build_object('legal_referral_id', p_referral_id, 'referral_status', v_status),
          v_uid::text, now());
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_breach_run_detection_v1(p_as_of_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT ce_actor_can(v_uid,'compliance.enforcement.arrangements') THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  RETURN public.ce_breach_detect_v1(v_uid::text, p_as_of_date, false);
END;
$$;

REVOKE ALL ON FUNCTION public.ce_breach_register_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_breach_facets_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_breach_detail_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_breach_assign_v1(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_breach_resolve_v1(uuid, text, text, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_breach_link_referral_v1(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_breach_run_detection_v1(date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ce_breach_register_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_breach_facets_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_breach_detail_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_breach_assign_v1(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_breach_resolve_v1(uuid, text, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_breach_link_referral_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_breach_run_detection_v1(date) TO authenticated;