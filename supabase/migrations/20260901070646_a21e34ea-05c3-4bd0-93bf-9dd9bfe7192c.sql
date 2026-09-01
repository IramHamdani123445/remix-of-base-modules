
CREATE OR REPLACE FUNCTION public.ce_legal_return_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'attention',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_can_view boolean;
  v_can_complete boolean;
  v_sla int; v_soon int; v_high numeric;
  v_page int := GREATEST(1, COALESCE(p_page,1));
  v_size int := LEAST(200, GREATEST(1, COALESCE(p_page_size,25)));
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_tab text := COALESCE(p_filters->>'tab','OPEN');
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  v_can_view := public.ce_actor_can(v_uid,'compliance.enforcement.legal');
  IF NOT v_can_view THEN RETURN jsonb_build_object('error','NOT_AUTHORISED'); END IF;
  v_can_complete := public.ce_actor_can(v_uid,'compliance.legal.recommend_approve')
                    OR public.ce_actor_can(v_uid,'compliance.legal.override');
  v_code := public.ce_actor_code(v_uid);

  v_sla  := public.ce_legal_return_setting('compliance.legal.rework_sla_days', 5)::int;
  v_soon := 1;
  v_high := public.ce_legal_return_setting('compliance.legal.high_value_threshold', 50000);

  WITH base AS (
    SELECT v.*,
      (public.ce_legal_return_label('RETURN_REASON', v.reason_code)) AS reason_label_json,
      (public.ce_legal_return_label('RETURN_STATUS', v.resolution_status)) AS status_label_json,
      (public.ce_legal_return_label('REWORK_STATUS', v.rework_status)) AS rework_label_json,
      (v.resolution_status IN ('OPEN','IN_PROGRESS')) AS is_open,
      (v.total_referred >= v_high) AS high_value,
      CASE
        WHEN v.resolution_status NOT IN ('OPEN','IN_PROGRESS') THEN NULL
        WHEN v.due_date IS NULL THEN NULL
        WHEN v.due_date < current_date THEN 'OVERDUE'
        WHEN v.due_date <= current_date + v_soon THEN 'DUE_SOON'
        ELSE 'WITHIN_SLA' END AS sla_state,
      CASE WHEN COALESCE(v.pack_required_items,0) = 0 THEN 'NOT_STARTED'
           WHEN v.pack_missing_required > 0 THEN 'MISSING_MANDATORY'
           WHEN v.pack_required_complete = v.pack_required_items THEN 'READY'
           ELSE 'IN_PROGRESS' END AS readiness_code
    FROM public.ce_v_legal_return_register v
  ), scored AS (
    SELECT b.*,
      (CASE WHEN b.is_open AND b.sla_state = 'OVERDUE' THEN 50 ELSE 0 END
       + CASE WHEN b.is_open AND b.assigned_to IS NULL THEN 25 ELSE 0 END
       + CASE WHEN b.is_open AND b.high_value THEN 20 ELSE 0 END
       + CASE WHEN b.is_open AND b.readiness_code = 'MISSING_MANDATORY' THEN 15 ELSE 0 END
       + CASE WHEN b.rework_status = 'READY_FOR_RESUBMISSION' AND b.resubmitted_at IS NULL THEN 18 ELSE 0 END
       + CASE WHEN b.is_open AND COALESCE(btrim(b.required_action),'') = '' THEN 12 ELSE 0 END
       + CASE WHEN b.is_open AND b.total_returns > 1 THEN 10 ELSE 0 END
       + LEAST(20, (b.rework_hours / 24.0))::int) AS attention_score
    FROM base b
  ), filtered AS (
    SELECT s.* FROM scored s
    WHERE (
        v_tab = 'ALL'
        OR (v_tab = 'OPEN' AND s.is_open)
        OR (v_tab = 'MY_REWORK' AND s.is_open AND s.assigned_to IS NOT DISTINCT FROM v_code)
        OR (v_tab = 'UNASSIGNED' AND s.is_open AND s.assigned_to IS NULL)
        OR (v_tab = 'OVERDUE' AND s.is_open AND s.sla_state = 'OVERDUE')
        OR (v_tab = 'NOT_STARTED' AND s.is_open AND s.rework_status = 'NOT_STARTED')
        OR (v_tab = 'IN_REWORK' AND s.rework_status IN ('IN_REWORK','WAITING_DOCUMENTS'))
        OR (v_tab = 'READY' AND s.rework_status = 'READY_FOR_RESUBMISSION')
        OR (v_tab = 'RESOLVED' AND s.resolution_status = 'RESOLVED')
        OR (v_tab = 'HIGH_VALUE' AND s.is_open AND s.high_value)
      )
      AND (COALESCE(p_filters->>'search','') = '' OR (
            s.referral_number ILIKE '%'||(p_filters->>'search')||'%'
         OR s.employer_name ILIKE '%'||(p_filters->>'search')||'%'
         OR s.employer_reg_no ILIKE '%'||(p_filters->>'search')||'%'
         OR s.ce_case_number ILIKE '%'||(p_filters->>'search')||'%'
         OR s.lg_intake_no ILIKE '%'||(p_filters->>'search')||'%'
         OR s.lg_case_no ILIKE '%'||(p_filters->>'search')||'%'
         OR s.court_case_number ILIKE '%'||(p_filters->>'search')||'%'
         OR s.reason_text ILIKE '%'||(p_filters->>'search')||'%'
         OR (s.reason_label_json->>'label') ILIKE '%'||(p_filters->>'search')||'%'))
      AND (COALESCE(p_filters->>'status','') = '' OR s.resolution_status = p_filters->>'status')
      AND (COALESCE(p_filters->>'rework_status','') = '' OR s.rework_status = p_filters->>'rework_status')
      AND (COALESCE(p_filters->>'reason_code','') = '' OR s.reason_code = p_filters->>'reason_code')
      AND (COALESCE(p_filters->>'returned_by','') = '' OR s.returned_by = p_filters->>'returned_by')
      AND (COALESCE(p_filters->>'owner','') = '' OR
           (p_filters->>'owner' = '__UNASSIGNED__' AND s.assigned_to IS NULL) OR
           (p_filters->>'owner' = '__ME__' AND s.assigned_to IS NOT DISTINCT FROM v_code) OR
           s.assigned_to = p_filters->>'owner')
      AND (COALESCE(p_filters->>'employer','') = '' OR s.employer_reg_no = p_filters->>'employer')
      AND (COALESCE(p_filters->>'ce_case','') = '' OR s.ce_case_number = p_filters->>'ce_case')
      AND (COALESCE(p_filters->>'sla','') = '' OR s.sla_state = p_filters->>'sla')
      AND (COALESCE(p_filters->>'readiness','') = '' OR s.readiness_code = p_filters->>'readiness')
      AND (COALESCE(p_filters->>'returned_from','') = '' OR s.returned_at >= (p_filters->>'returned_from')::date)
      AND (COALESCE(p_filters->>'returned_to','') = '' OR s.returned_at < ((p_filters->>'returned_to')::date + 1))
      AND (COALESCE(p_filters->>'amount_min','') = '' OR s.total_referred >= (p_filters->>'amount_min')::numeric)
      AND (COALESCE(p_filters->>'amount_max','') = '' OR s.total_referred <= (p_filters->>'amount_max')::numeric)
  ), page AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'attention' AND v_dir = 'desc' THEN f.attention_score END DESC NULLS LAST,
      CASE WHEN p_sort = 'attention' AND v_dir = 'asc'  THEN f.attention_score END ASC NULLS LAST,
      CASE WHEN p_sort = 'age' AND v_dir = 'desc' THEN f.rework_hours END DESC NULLS LAST,
      CASE WHEN p_sort = 'age' AND v_dir = 'asc'  THEN f.rework_hours END ASC NULLS LAST,
      CASE WHEN p_sort = 'returned_at' AND v_dir = 'desc' THEN f.returned_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'returned_at' AND v_dir = 'asc'  THEN f.returned_at END ASC NULLS LAST,
      CASE WHEN p_sort = 'due_date' AND v_dir = 'desc' THEN f.due_date END DESC NULLS LAST,
      CASE WHEN p_sort = 'due_date' AND v_dir = 'asc'  THEN f.due_date END ASC NULLS LAST,
      CASE WHEN p_sort = 'amount' AND v_dir = 'desc' THEN f.total_referred END DESC NULLS LAST,
      CASE WHEN p_sort = 'amount' AND v_dir = 'asc'  THEN f.total_referred END ASC NULLS LAST,
      CASE WHEN p_sort = 'employer' AND v_dir = 'desc' THEN f.employer_name END DESC NULLS LAST,
      CASE WHEN p_sort = 'employer' AND v_dir = 'asc'  THEN f.employer_name END ASC NULLS LAST,
      CASE WHEN p_sort = 'referral' AND v_dir = 'desc' THEN f.referral_number END DESC NULLS LAST,
      CASE WHEN p_sort = 'referral' AND v_dir = 'asc'  THEN f.referral_number END ASC NULLS LAST,
      CASE WHEN p_sort = 'rework_status' AND v_dir = 'desc' THEN f.rework_status END DESC NULLS LAST,
      CASE WHEN p_sort = 'rework_status' AND v_dir = 'asc'  THEN f.rework_status END ASC NULLS LAST,
      CASE WHEN p_sort = 'owner' AND v_dir = 'desc' THEN f.assigned_to_name END DESC NULLS LAST,
      CASE WHEN p_sort = 'owner' AND v_dir = 'asc'  THEN f.assigned_to_name END ASC NULLS LAST,
      f.returned_at DESC
    LIMIT v_size OFFSET (v_page - 1) * v_size
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'return_id', p.return_id, 'referral_id', p.referral_id, 'return_seq', p.return_seq,
        'total_returns', p.total_returns,
        'referral_number', p.referral_number, 'referral_status', p.referral_status,
        'employer_name', p.employer_name, 'employer_reg_no', p.employer_reg_no, 'zone', p.zone,
        'ce_case_id', p.ce_case_id, 'ce_case_number', p.ce_case_number,
        'lg_intake_no', p.lg_intake_no, 'lg_case_no', p.lg_case_no, 'court_case_no', p.court_case_number,
        'returned_at', p.returned_at, 'returned_by', p.returned_by, 'returned_by_display', p.returned_by_display,
        'reason_code', p.reason_code, 'reason_label', p.reason_label_json->>'label',
        'reason_tone', p.reason_label_json->>'tone', 'reason_text', p.reason_text, 'comments', p.comments,
        'required_action', p.required_action,
        'status_code', p.resolution_status, 'status_label', p.status_label_json->>'label',
        'status_tone', p.status_label_json->>'tone',
        'rework_status', p.rework_status, 'rework_label', p.rework_label_json->>'label',
        'rework_tone', p.rework_label_json->>'tone',
        'assigned_to', p.assigned_to, 'assigned_to_name', p.assigned_to_name, 'assigned_at', p.assigned_at,
        'due_date', p.due_date, 'sla_state', p.sla_state,
        'rework_hours', round(p.rework_hours::numeric, 2),
        'readiness_code', p.readiness_code,
        'pack_required_items', p.pack_required_items, 'pack_required_complete', p.pack_required_complete,
        'pack_missing_required', p.pack_missing_required,
        'returned_pack_version', p.returned_pack_version, 'current_pack_version', p.current_pack_version,
        'principal', p.total_principal, 'penalty', p.total_penalties, 'interest', p.total_interest,
        'total_referred', p.total_referred,
        'resolved_at', p.resolved_at, 'resubmitted_at', p.resubmitted_at,
        'high_value', p.high_value, 'attention_score', p.attention_score,
        'follow_up_action_id', p.follow_up_action_id
      ) ORDER BY p.attention_score DESC) FROM page p), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'page', v_page, 'page_size', v_size,
    'kpis', (SELECT jsonb_build_object(
        'open', count(*) FILTER (WHERE is_open),
        'overdue', count(*) FILTER (WHERE is_open AND sla_state = 'OVERDUE'),
        'ready', count(*) FILTER (WHERE rework_status = 'READY_FOR_RESUBMISSION' AND resubmitted_at IS NULL),
        'returned_this_month', count(*) FILTER (WHERE returned_at >= date_trunc('month', now())),
        'avg_rework_hours', round(COALESCE(avg(rework_hours) FILTER (WHERE is_open), 0)::numeric, 1),
        'open_exposure', COALESCE(sum(total_referred) FILTER (WHERE is_open), 0)
      ) FROM scored),
    'tab_counts', (SELECT jsonb_build_object(
        'ALL', count(*),
        'OPEN', count(*) FILTER (WHERE is_open),
        'MY_REWORK', count(*) FILTER (WHERE is_open AND assigned_to IS NOT DISTINCT FROM v_code),
        'UNASSIGNED', count(*) FILTER (WHERE is_open AND assigned_to IS NULL),
        'OVERDUE', count(*) FILTER (WHERE is_open AND sla_state = 'OVERDUE'),
        'NOT_STARTED', count(*) FILTER (WHERE is_open AND rework_status = 'NOT_STARTED'),
        'IN_REWORK', count(*) FILTER (WHERE rework_status IN ('IN_REWORK','WAITING_DOCUMENTS')),
        'READY', count(*) FILTER (WHERE rework_status = 'READY_FOR_RESUBMISSION'),
        'RESOLVED', count(*) FILTER (WHERE resolution_status = 'RESOLVED'),
        'HIGH_VALUE', count(*) FILTER (WHERE is_open AND high_value)
      ) FROM scored),
    'attention', COALESCE((SELECT jsonb_agg(a) FROM (
        SELECT jsonb_build_object(
          'return_id', s.return_id, 'referral_id', s.referral_id,
          'referral_number', s.referral_number, 'employer_name', s.employer_name,
          'amount', s.total_referred, 'priority', s.attention_score,
          'reason', CASE
             WHEN s.sla_state = 'OVERDUE' THEN 'OVERDUE'
             WHEN s.assigned_to IS NULL THEN 'UNASSIGNED'
             WHEN s.readiness_code = 'MISSING_MANDATORY' THEN 'MISSING_ITEMS'
             WHEN s.rework_status = 'READY_FOR_RESUBMISSION' AND s.resubmitted_at IS NULL THEN 'NOT_RESUBMITTED'
             WHEN COALESCE(btrim(s.required_action),'') = '' THEN 'NO_REQUIRED_ACTION'
             WHEN s.total_returns > 1 THEN 'REPEAT_RETURN'
             ELSE 'HIGH_VALUE' END) AS a
        FROM scored s
        WHERE s.is_open AND (s.sla_state = 'OVERDUE' OR s.assigned_to IS NULL
              OR s.readiness_code = 'MISSING_MANDATORY' OR s.high_value
              OR COALESCE(btrim(s.required_action),'') = '' OR s.total_returns > 1
              OR (s.rework_status = 'READY_FOR_RESUBMISSION' AND s.resubmitted_at IS NULL))
        ORDER BY s.attention_score DESC LIMIT 9) q), '[]'::jsonb),
    'facets', jsonb_build_object(
        'reasons', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY display_order)
                     FROM public.ce_legal_return_ref WHERE domain='RETURN_REASON' AND is_active), '[]'::jsonb),
        'statuses', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY display_order)
                     FROM public.ce_legal_return_ref WHERE domain='RETURN_STATUS' AND is_active), '[]'::jsonb),
        'rework_statuses', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY display_order)
                     FROM public.ce_legal_return_ref WHERE domain='REWORK_STATUS' AND is_active), '[]'::jsonb),
        'owners', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', assigned_to, 'name', COALESCE(assigned_to_name, assigned_to)))
                     FROM scored WHERE assigned_to IS NOT NULL), '[]'::jsonb),
        'returned_by', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', returned_by, 'name', returned_by_display))
                     FROM scored WHERE returned_by IS NOT NULL), '[]'::jsonb),
        'employers', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('code', employer_reg_no, 'name', employer_name))
                     FROM scored WHERE employer_reg_no IS NOT NULL), '[]'::jsonb)),
    'thresholds', jsonb_build_object('rework_sla_days', v_sla, 'due_soon_days', v_soon, 'high_value', v_high),
    'actor', jsonb_build_object('code', v_code, 'can_view', v_can_view, 'can_assign', v_can_view,
                                'can_rework', v_can_view, 'can_complete', v_can_complete)
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_return_register_v1(jsonb, text, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.ce_legal_return_detail_v1(p_return_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_can_complete boolean;
  v public.ce_v_legal_return_register%ROWTYPE;
  v_sla int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.enforcement.legal') THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  v_code := public.ce_actor_code(v_uid);
  v_can_complete := public.ce_actor_can(v_uid,'compliance.legal.recommend_approve')
                    OR public.ce_actor_can(v_uid,'compliance.legal.override');
  v_sla := public.ce_legal_return_setting('compliance.legal.rework_sla_days', 5)::int;

  SELECT * INTO v FROM public.ce_v_legal_return_register WHERE return_id = p_return_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  RETURN jsonb_build_object(
    'return', jsonb_build_object(
      'return_id', v.return_id, 'referral_id', v.referral_id, 'return_seq', v.return_seq,
      'referral_number', v.referral_number, 'referral_status', v.referral_status,
      'employer_name', v.employer_name, 'employer_reg_no', v.employer_reg_no, 'zone', v.zone,
      'ce_case_id', v.ce_case_id, 'ce_case_number', v.ce_case_number,
      'lg_intake_no', v.lg_intake_no, 'lg_case_no', v.lg_case_no, 'court_case_no', v.court_case_number,
      'returned_at', v.returned_at, 'returned_by_display', v.returned_by_display,
      'reason_code', v.reason_code,
      'reason_label', public.ce_legal_return_label('RETURN_REASON', v.reason_code)->>'label',
      'reason_text', v.reason_text, 'comments', v.comments, 'required_action', v.required_action,
      'status_code', v.resolution_status,
      'status_label', public.ce_legal_return_label('RETURN_STATUS', v.resolution_status)->>'label',
      'rework_status', v.rework_status,
      'rework_label', public.ce_legal_return_label('REWORK_STATUS', v.rework_status)->>'label',
      'assigned_to', v.assigned_to, 'assigned_to_name', v.assigned_to_name, 'assigned_at', v.assigned_at,
      'due_date', v.due_date, 'rework_started_at', v.rework_started_at,
      'rework_hours', round(v.rework_hours::numeric, 2),
      'resolved_at', v.resolved_at, 'resolved_by', v.resolved_by,
      'resolution_summary', COALESCE(v.resolution_summary, v.resolution_notes),
      'resubmitted_at', v.resubmitted_at,
      'returned_pack_version', v.returned_pack_version, 'current_pack_version', v.current_pack_version,
      'principal', v.total_principal, 'penalty', v.total_penalties, 'interest', v.total_interest,
      'total_referred', v.total_referred, 'total_returns', v.total_returns,
      'pack_required_items', v.pack_required_items, 'pack_required_complete', v.pack_required_complete,
      'pack_missing_required', v.pack_missing_required),
    'pack', public.ce_legal_pack_rollup_v1(v.referral_id),
    'corrections', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'item_key', i.item_key, 'item_label', i.item_label, 'is_required', i.is_required,
          'is_satisfied', i.is_satisfied, 'group_code', i.group_code,
          'requires_document', i.requires_document, 'notes', i.notes,
          'satisfied_at', i.satisfied_at, 'satisfied_by', COALESCE(i.satisfied_by_name, i.satisfied_by))
          ORDER BY i.is_required DESC, i.display_order)
        FROM public.ce_legal_pack_items i WHERE i.referral_id = v.referral_id), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', d.id, 'title', COALESCE(d.display_title, d.file_name),
          'document_type', d.document_type_code,
          'storage_bucket', d.storage_bucket, 'storage_path', d.storage_path,
          'is_required', d.is_required, 'uploaded_at', d.created_at)
          ORDER BY d.created_at DESC)
        FROM public.core_legal_referral_document d WHERE d.referral_id = v.referral_id), '[]'::jsonb),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'version_no', pv.version_no, 'status', pv.status, 'submitted_at', pv.submitted_at,
          'submitted_by', COALESCE(pv.submitted_by_name, pv.submitted_by),
          'returned_at', pv.returned_at, 'returned_by', pv.returned_by, 'return_reason', pv.return_reason)
          ORDER BY pv.version_no DESC)
        FROM public.ce_legal_pack_version pv WHERE pv.referral_id = v.referral_id), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'return_id', h.id, 'return_seq', h.return_seq, 'returned_at', h.returned_at,
          'returned_by', COALESCE(h.returned_by_name, h.returned_by),
          'reason_code', h.reason_code,
          'reason_label', public.ce_legal_return_label('RETURN_REASON', h.reason_code)->>'label',
          'reason_text', h.reason, 'required_action', h.required_action,
          'status_label', public.ce_legal_return_label('RETURN_STATUS', h.resolution_status)->>'label',
          'resolved_at', h.resolved_at, 'resolution_summary', COALESCE(h.resolution_summary, h.resolution_notes))
          ORDER BY h.return_seq DESC)
        FROM public.ce_legal_returns h WHERE h.referral_id = v.referral_id), '[]'::jsonb),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'event_code', e.event_code, 'description', e.description, 'version_no', e.version_no,
          'actor', COALESCE(e.actor_name, e.actor_code), 'created_at', e.created_at)
          ORDER BY e.created_at DESC)
        FROM public.ce_legal_pack_event e WHERE e.referral_id = v.referral_id), '[]'::jsonb),
    'tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', f.id, 'description', f.description, 'status', f.status, 'priority', f.priority,
          'assigned_to', COALESCE(f.assigned_to_name, f.assigned_to_user_id),
          'due_date', f.due_date, 'completed_at', f.completed_at)
          ORDER BY f.created_at DESC)
        FROM public.ce_follow_up_actions f
        WHERE f.id = v.follow_up_action_id
           OR (f.source = 'LEGAL_RETURN' AND f.employer_id = v.employer_reg_no
               AND f.description ILIKE '%'||COALESCE(v.referral_number,'~none~')||'%')), '[]'::jsonb),
    'thresholds', jsonb_build_object('rework_sla_days', v_sla),
    'actor', jsonb_build_object('code', v_code, 'can_complete', v_can_complete, 'can_assign', true)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_return_detail_v1(uuid) TO authenticated;
