
CREATE OR REPLACE FUNCTION public.ce_notice_actor_can(p_uid uuid, p_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(public.ce_actor_can(p_uid, p_cap), false) OR COALESCE(public.is_admin(p_uid), false);
$$;
REVOKE EXECUTE ON FUNCTION public.ce_notice_actor_can(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ce_notice_actor_can(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ce_notice_facets_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_notice_actor_can(v_uid,'compliance.enforcement.notices')
       OR public.ce_notice_actor_can(v_uid,'compliance.workbench.enterprise')
       OR public.ce_notice_actor_can(v_uid,'compliance.workbench.team')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  RETURN jsonb_build_object(
    'types', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'group',group_code) ORDER BY display_order, label)
                       FROM public.ce_notice_ref WHERE domain='TYPE' AND is_active),'[]'::jsonb),
    'statuses', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'group',group_code) ORDER BY display_order)
                       FROM public.ce_notice_ref WHERE domain='STATUS' AND is_active),'[]'::jsonb),
    'delivery', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY display_order)
                       FROM public.ce_notice_ref WHERE domain='DELIVERY' AND is_active),'[]'::jsonb),
    'response', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY display_order)
                       FROM public.ce_notice_ref WHERE domain='RESPONSE' AND is_active),'[]'::jsonb),
    'methods', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',q.c,'label',q.l) ORDER BY q.l) FROM (
                       SELECT DISTINCT upper(n.delivery_method) AS c,
                              COALESCE(r.label, initcap(lower(n.delivery_method))) AS l
                       FROM public.ce_notices n
                       LEFT JOIN public.ce_notice_ref r ON r.domain='METHOD' AND r.code=upper(n.delivery_method)
                       WHERE NULLIF(btrim(COALESCE(n.delivery_method,'')),'') IS NOT NULL) q),'[]'::jsonb),
    'employers', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',q.c,'label',q.l) ORDER BY q.l) FROM (
                       SELECT DISTINCT v.employer_id AS c, COALESCE(v.employer_name, v.employer_id) AS l
                       FROM public.ce_v_notice_register v WHERE v.employer_id IS NOT NULL) q),'[]'::jsonb),
    'cases', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',q.c,'label',q.l) ORDER BY q.l DESC) FROM (
                       SELECT DISTINCT v.case_id::text AS c, v.case_number AS l
                       FROM public.ce_v_notice_register v WHERE v.case_id IS NOT NULL) q),'[]'::jsonb),
    'violations', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',q.c,'label',q.l) ORDER BY q.l DESC) FROM (
                       SELECT DISTINCT v.violation_id::text AS c, v.violation_number AS l
                       FROM public.ce_v_notice_register v WHERE v.violation_id IS NOT NULL) q),'[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ce_notice_facets_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.ce_notice_facets_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.ce_notice_register_v1(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tab text := COALESCE(p_params->>'tab','ALL');
  v_search text := NULLIF(btrim(COALESCE(p_params->>'search','')),'');
  v_employer text := NULLIF(btrim(COALESCE(p_params->>'employer_id','')),'');
  v_case text := NULLIF(btrim(COALESCE(p_params->>'case_id','')),'');
  v_violation text := NULLIF(btrim(COALESCE(p_params->>'violation_id','')),'');
  v_types text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'types','[]'::jsonb))),'{}');
  v_statuses text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'statuses','[]'::jsonb))),'{}');
  v_delivery text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'delivery','[]'::jsonb))),'{}');
  v_response text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'response','[]'::jsonb))),'{}');
  v_methods text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'methods','[]'::jsonb))),'{}');
  v_due text := NULLIF(COALESCE(p_params->>'due_window',''),'');
  v_created text := NULLIF(COALESCE(p_params->>'created_window',''),'');
  v_sent text := NULLIF(COALESCE(p_params->>'sent_window',''),'');
  v_delivered text := NULLIF(COALESCE(p_params->>'delivered_window',''),'');
  v_from date := NULLIF(COALESCE(p_params->>'created_from',''),'')::date;
  v_to date := NULLIF(COALESCE(p_params->>'created_to',''),'')::date;
  v_sort text := COALESCE(p_params->>'sort','attention');
  v_dir text := CASE WHEN lower(COALESCE(p_params->>'dir','desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_page int := GREATEST(1, COALESCE((p_params->>'page')::int,1));
  v_size int := LEAST(200, GREATEST(25, COALESCE((p_params->>'page_size')::int,25)));
  v_appr_days numeric := COALESCE((SELECT numeric_value FROM public.ce_notice_ref WHERE domain='THRESHOLD' AND code='APPROVAL_AGEING_DAYS'),3);
  v_sent_days numeric := COALESCE((SELECT numeric_value FROM public.ce_notice_ref WHERE domain='THRESHOLD' AND code='APPROVED_NOT_SENT_DAYS'),2);
  v_soon_days numeric := COALESCE((SELECT numeric_value FROM public.ce_notice_ref WHERE domain='THRESHOLD' AND code='DUE_SOON_DAYS'),3);
  v_total int;
  v_rows jsonb;
  v_kpis jsonb;
  v_tabs jsonb;
  v_attention jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_notice_actor_can(v_uid,'compliance.enforcement.notices')
       OR public.ce_notice_actor_can(v_uid,'compliance.workbench.enterprise')
       OR public.ce_notice_actor_can(v_uid,'compliance.workbench.team')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS x_dummy_never_used(i int) ON COMMIT DROP;

  WITH base AS (
    SELECT v.*,
      (v.status='PENDING_APPROVAL' AND v.created_at < now() - (v_appr_days || ' days')::interval) AS approval_stale,
      (v.status='APPROVED' AND v.sent_at IS NULL AND v.created_at < now() - (v_sent_days || ' days')::interval) AS approved_not_sent,
      (v.delivery_status='FAILED') AS delivery_failed,
      (v.response_state='OVERDUE') AS response_overdue,
      (v.response_state='AWAITING' AND v.due_response_date <= CURRENT_DATE + (v_soon_days)::int) AS response_due_soon,
      (v.notice_type_group IN ('FINAL') AND v.status IN ('DRAFT','PENDING_APPROVAL','APPROVED')) AS final_awaiting_action,
      (v.response_state='RECEIVED' AND v.status <> 'ACKNOWLEDGED') AS response_needs_review
    FROM public.ce_v_notice_register v
  ), scored AS (
    SELECT b.*,
      (CASE WHEN b.response_overdue THEN 50 ELSE 0 END
     + CASE WHEN b.delivery_failed THEN 45 ELSE 0 END
     + CASE WHEN b.approval_stale THEN 35 ELSE 0 END
     + CASE WHEN b.approved_not_sent THEN 30 ELSE 0 END
     + CASE WHEN b.final_awaiting_action THEN 25 ELSE 0 END
     + CASE WHEN b.response_needs_review THEN 15 ELSE 0 END
     + CASE WHEN b.response_due_soon THEN 10 ELSE 0 END) AS attention_score
    FROM base b
  ), filtered AS (
    SELECT s.* FROM scored s
    WHERE (v_search IS NULL OR (
            s.notice_number ILIKE '%'||v_search||'%' OR
            COALESCE(s.employer_name,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.employer_id,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.case_number,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.violation_number,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.subject,'') ILIKE '%'||v_search||'%'))
      AND (v_employer IS NULL OR s.employer_id = v_employer)
      AND (v_case IS NULL OR s.case_id::text = v_case)
      AND (v_violation IS NULL OR s.violation_id::text = v_violation)
      AND (cardinality(v_types)=0 OR s.notice_type = ANY(v_types))
      AND (cardinality(v_statuses)=0 OR s.status = ANY(v_statuses))
      AND (cardinality(v_delivery)=0 OR s.delivery_status = ANY(v_delivery))
      AND (cardinality(v_response)=0 OR s.response_state = ANY(v_response))
      AND (cardinality(v_methods)=0 OR upper(COALESCE(s.delivery_method,'')) = ANY(v_methods))
      AND (v_due IS NULL OR CASE v_due
             WHEN 'OVERDUE' THEN s.due_response_date < CURRENT_DATE AND s.response_state='OVERDUE'
             WHEN 'TODAY' THEN s.due_response_date = CURRENT_DATE
             WHEN 'D1_3' THEN s.due_response_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
             WHEN 'WEEK' THEN s.due_response_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
             WHEN 'NONE' THEN s.due_response_date IS NULL
             ELSE true END)
      AND (v_created IS NULL OR CASE v_created
             WHEN 'TODAY' THEN s.created_at::date = CURRENT_DATE
             WHEN 'D7' THEN s.created_at >= now() - interval '7 days'
             WHEN 'D30' THEN s.created_at >= now() - interval '30 days'
             WHEN 'D90' THEN s.created_at >= now() - interval '90 days'
             WHEN 'CUSTOM' THEN (v_from IS NULL OR s.created_at::date >= v_from) AND (v_to IS NULL OR s.created_at::date <= v_to)
             ELSE true END)
      AND (v_sent IS NULL OR CASE v_sent
             WHEN 'TODAY' THEN s.sent_at::date = CURRENT_DATE
             WHEN 'D7' THEN s.sent_at >= now() - interval '7 days'
             WHEN 'D30' THEN s.sent_at >= now() - interval '30 days'
             WHEN 'D90' THEN s.sent_at >= now() - interval '90 days'
             ELSE true END)
      AND (v_delivered IS NULL OR CASE v_delivered
             WHEN 'TODAY' THEN s.delivered_at::date = CURRENT_DATE
             WHEN 'D7' THEN s.delivered_at >= now() - interval '7 days'
             WHEN 'D30' THEN s.delivered_at >= now() - interval '30 days'
             WHEN 'D90' THEN s.delivered_at >= now() - interval '90 days'
             ELSE true END)
      AND CASE v_tab
            WHEN 'DRAFT' THEN s.status='DRAFT'
            WHEN 'PENDING_APPROVAL' THEN s.status='PENDING_APPROVAL'
            WHEN 'FAILED_DELIVERY' THEN s.delivery_failed
            WHEN 'AWAITING_RESPONSE' THEN s.response_state='AWAITING'
            WHEN 'RESPONSE_OVERDUE' THEN s.response_state='OVERDUE'
            WHEN 'FINAL_LEGAL' THEN s.notice_type_group='FINAL'
            WHEN 'CREATED_WEEK' THEN s.created_at >= now() - interval '7 days'
            WHEN 'ATTENTION' THEN s.attention_score > 0
            ELSE true END
  ), page AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN v_sort='attention' THEN f.attention_score END DESC NULLS LAST,
      CASE WHEN v_sort='notice_number' AND v_dir='asc' THEN f.notice_number END ASC,
      CASE WHEN v_sort='notice_number' AND v_dir='desc' THEN f.notice_number END DESC,
      CASE WHEN v_sort='employer' AND v_dir='asc' THEN COALESCE(f.employer_name,f.employer_id) END ASC,
      CASE WHEN v_sort='employer' AND v_dir='desc' THEN COALESCE(f.employer_name,f.employer_id) END DESC,
      CASE WHEN v_sort='status' AND v_dir='asc' THEN COALESCE(f.status_label,f.status) END ASC,
      CASE WHEN v_sort='status' AND v_dir='desc' THEN COALESCE(f.status_label,f.status) END DESC,
      CASE WHEN v_sort='notice_type' AND v_dir='asc' THEN COALESCE(f.notice_type_label,f.notice_type) END ASC,
      CASE WHEN v_sort='notice_type' AND v_dir='desc' THEN COALESCE(f.notice_type_label,f.notice_type) END DESC,
      CASE WHEN v_sort='due_response_date' AND v_dir='asc' THEN f.due_response_date END ASC NULLS LAST,
      CASE WHEN v_sort='due_response_date' AND v_dir='desc' THEN f.due_response_date END DESC NULLS LAST,
      CASE WHEN v_sort='sent_at' AND v_dir='asc' THEN f.sent_at END ASC NULLS LAST,
      CASE WHEN v_sort='sent_at' AND v_dir='desc' THEN f.sent_at END DESC NULLS LAST,
      CASE WHEN v_sort='delivered_at' AND v_dir='asc' THEN f.delivered_at END ASC NULLS LAST,
      CASE WHEN v_sort='delivered_at' AND v_dir='desc' THEN f.delivered_at END DESC NULLS LAST,
      CASE WHEN v_dir='asc' THEN f.created_at END ASC,
      f.created_at DESC
    LIMIT v_size OFFSET (v_page-1)*v_size
  )
  SELECT
    (SELECT count(*)::int FROM filtered),
    COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM page p),'[]'::jsonb),
    jsonb_build_object(
      'pending_approval', (SELECT count(*) FROM scored WHERE status='PENDING_APPROVAL'),
      'failed_delivery', (SELECT count(*) FROM scored WHERE delivery_failed),
      'awaiting_response', (SELECT count(*) FROM scored WHERE response_state='AWAITING'),
      'response_overdue', (SELECT count(*) FROM scored WHERE response_state='OVERDUE'),
      'sent_this_month', (SELECT count(*) FROM scored WHERE sent_at >= date_trunc('month', now())),
      'total_notices', (SELECT count(*) FROM scored)
    ),
    jsonb_build_object(
      'ALL', (SELECT count(*) FROM scored),
      'DRAFT', (SELECT count(*) FROM scored WHERE status='DRAFT'),
      'PENDING_APPROVAL', (SELECT count(*) FROM scored WHERE status='PENDING_APPROVAL'),
      'FAILED_DELIVERY', (SELECT count(*) FROM scored WHERE delivery_failed),
      'AWAITING_RESPONSE', (SELECT count(*) FROM scored WHERE response_state='AWAITING'),
      'RESPONSE_OVERDUE', (SELECT count(*) FROM scored WHERE response_state='OVERDUE'),
      'FINAL_LEGAL', (SELECT count(*) FROM scored WHERE notice_type_group='FINAL'),
      'CREATED_WEEK', (SELECT count(*) FROM scored WHERE created_at >= now() - interval '7 days'),
      'ATTENTION', (SELECT count(*) FROM scored WHERE attention_score > 0)
    ),
    COALESCE((SELECT jsonb_agg(a ORDER BY a->>'priority' DESC) FROM (
       SELECT jsonb_build_object(
         'id', s.id, 'notice_number', s.notice_number,
         'employer_name', COALESCE(s.employer_name, s.employer_id),
         'status_label', COALESCE(s.status_label, s.status),
         'due_response_date', s.due_response_date,
         'priority', s.attention_score,
         'reason', CASE
             WHEN s.response_overdue THEN 'Employer response overdue'
             WHEN s.delivery_failed THEN 'Delivery failed — ' || COALESCE(s.delivery_failure_reason,'no provider detail')
             WHEN s.approval_stale THEN 'Pending approval beyond ' || v_appr_days || ' days'
             WHEN s.approved_not_sent THEN 'Approved but not sent'
             WHEN s.final_awaiting_action THEN 'Final/legal warning awaiting action'
             WHEN s.response_needs_review THEN 'Employer response awaiting review'
             ELSE 'Response due shortly' END
       ) AS a
       FROM scored s WHERE s.attention_score > 0
       ORDER BY s.attention_score DESC, s.due_response_date NULLS LAST
       LIMIT 8) q),'[]'::jsonb)
  INTO v_total, v_rows, v_kpis, v_tabs, v_attention;

  RETURN jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
    'kpis', v_kpis, 'tab_counts', v_tabs, 'attention', v_attention,
    'thresholds', jsonb_build_object('approval_ageing_days', v_appr_days,
                                     'approved_not_sent_days', v_sent_days,
                                     'due_soon_days', v_soon_days),
    'actor', jsonb_build_object(
      'can_generate', public.ce_notice_actor_can(v_uid,'compliance.enforcement.notices'),
      'can_approve', public.ce_notice_actor_can(v_uid,'compliance.core.notice_approval'),
      'can_send', public.ce_notice_actor_can(v_uid,'compliance.enforcement.notices'),
      'can_cancel', public.ce_notice_actor_can(v_uid,'compliance.enforcement.notices'),
      'can_record_response', public.ce_notice_actor_can(v_uid,'compliance.enforcement.notices')
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ce_notice_register_v1(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.ce_notice_register_v1(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.ce_notice_detail_v1(p_notice_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_notice jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_notice_actor_can(v_uid,'compliance.enforcement.notices')
       OR public.ce_notice_actor_can(v_uid,'compliance.workbench.enterprise')
       OR public.ce_notice_actor_can(v_uid,'compliance.workbench.team')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  SELECT to_jsonb(v) INTO v_notice FROM public.ce_v_notice_register v WHERE v.id = p_notice_id;
  IF v_notice IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  RETURN jsonb_build_object(
    'notice', v_notice
      || jsonb_build_object('body', (SELECT body FROM public.ce_notices WHERE id=p_notice_id)),
    'deliveries', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.attempt_number DESC)
                            FROM public.ce_notice_delivery_log l WHERE l.notice_id=p_notice_id),'[]'::jsonb),
    'responses', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.response_date DESC)
                            FROM public.ce_notice_responses r WHERE r.notice_id=p_notice_id),'[]'::jsonb),
    'audit', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'at', a.created_at, 'actor', a.user_code, 'action', a.action,
                            'from_status', a.old_value, 'to_status', a.new_value, 'notes', a.notes) ORDER BY a.created_at DESC)
                       FROM public.system_audit_trail a
                       WHERE a.entity_type='notice' AND a.entity_id = p_notice_id::text),'[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ce_notice_detail_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ce_notice_detail_v1(uuid) TO authenticated;
