CREATE OR REPLACE FUNCTION public.ce_legal_referral_queue_v1(
  p_filters   jsonb DEFAULT '{}'::jsonb,
  p_sort      text  DEFAULT 'waiting',
  p_dir       text  DEFAULT 'desc',
  p_page      integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_code         text;
  v_role         text;
  v_scope        text;
  v_can_view     boolean;
  v_can_approve  boolean;
  v_can_submit   boolean;
  v_approval_sla numeric := public.ce_setting_num('compliance.legal.approval_sla_days', 3);
  v_handover_sla numeric := public.ce_setting_num('compliance.monitoring.legal_handoff_days', 5);
  v_legal_sla    numeric := public.ce_setting_num('compliance.monitoring.stall_days.legal_referral', 7);
  v_rework_sla   numeric := public.ce_setting_num('compliance.legal.rework_sla_days', 5);
  v_high_value   numeric := public.ce_setting_num('compliance.legal.high_value_threshold', 50000);
  v_page         integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size         integer := LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 200);
  v_sort         text := lower(COALESCE(p_sort, 'waiting'));
  v_desc         boolean := lower(COALESCE(p_dir, 'desc')) <> 'asc';
  v_tab          text := upper(COALESCE(p_filters->>'tab', 'ALL'));
  v_search       text := NULLIF(btrim(COALESCE(p_filters->>'search', '')), '');
  v_total        bigint := 0;
  v_rows         jsonb := '[]'::jsonb;
  v_kpis         jsonb := '{}'::jsonb;
  v_tabs         jsonb := '{}'::jsonb;
  v_attention    jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  v_code := public.ce_actor_code(v_uid);
  v_role := public.ce_compliance_role(v_uid);
  v_can_view := public.ce_actor_can(v_uid, 'compliance.enforcement.legal')
             OR public.ce_actor_can(v_uid, 'compliance.workbench.enterprise')
             OR public.ce_actor_can(v_uid, 'compliance.workbench.team');
  IF NOT v_can_view THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORISED');
  END IF;
  v_can_approve := public.ce_actor_can(v_uid, 'compliance.legal.recommend_approve');
  v_can_submit  := public.ce_actor_can(v_uid, 'compliance.enforcement.legal');
  v_scope := CASE
    WHEN public.is_admin(v_uid) OR public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN 'ENTERPRISE'
    WHEN public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN 'TEAM'
    ELSE 'OWN' END;

  WITH base AS (
    SELECT r.*,
      CASE r.status
        WHEN 'PENDING_APPROVAL'        THEN COALESCE(r.approval_requested_at, r.created_at)
        WHEN 'APPROVED_FOR_SUBMISSION' THEN COALESCE(r.approved_at, r.created_at)
        WHEN 'RETURNED_BY_LEGAL'       THEN COALESCE(r.returned_at, r.updated_at, r.created_at)
        WHEN 'SUBMITTED_TO_LEGAL'      THEN COALESCE(r.submitted_date, r.created_at)
        WHEN 'ACCEPTED_BY_LEGAL'       THEN COALESCE(r.accepted_date, r.updated_at, r.created_at)
        WHEN 'IN_LEGAL_PROCEEDINGS'    THEN COALESCE(r.accepted_date, r.updated_at, r.created_at)
        ELSE COALESCE(r.updated_at, r.created_at)
      END AS stage_since,
      CASE r.status
        WHEN 'PENDING_APPROVAL'        THEN v_approval_sla
        WHEN 'APPROVED_FOR_SUBMISSION' THEN v_handover_sla
        WHEN 'RETURNED_BY_LEGAL'       THEN v_rework_sla
        WHEN 'SUBMITTED_TO_LEGAL'      THEN v_legal_sla
        ELSE NULL
      END AS sla_days,
      CASE r.status
        WHEN 'PENDING_APPROVAL'        THEN 'ACTION'
        WHEN 'APPROVED_FOR_SUBMISSION' THEN 'ACTION'
        WHEN 'RETURNED_BY_LEGAL'       THEN 'ACTION'
        WHEN 'DRAFT'                   THEN 'PREPARATION'
        WHEN 'SUBMITTED_TO_LEGAL'      THEN 'TRACKING'
        WHEN 'ACCEPTED_BY_LEGAL'       THEN 'TRACKING'
        WHEN 'IN_LEGAL_PROCEEDINGS'    THEN 'TRACKING'
        ELSE 'CLOSED'
      END AS stage_group
    FROM public.ce_legal_referrals r
    WHERE (v_scope IN ('ENTERPRISE','TEAM')
        OR r.created_by = v_code OR r.approval_requested_by = v_code OR r.referred_by = v_code)
  ), enriched AS (
    SELECT b.*,
      ROUND(EXTRACT(EPOCH FROM (now() - b.stage_since)) / 86400.0, 2) AS days_in_stage,
      (b.sla_days IS NOT NULL AND now() > b.stage_since + make_interval(days => b.sla_days::int)) AS is_overdue,
      (b.sla_days IS NOT NULL AND now() > b.stage_since + make_interval(days => GREATEST(b.sla_days::int - 1, 0))
        AND now() <= b.stage_since + make_interval(days => b.sla_days::int)) AS is_due_soon,
      (COALESCE(b.documents_count, 0) = 0 OR COALESCE(b.items_count, 0) = 0) AS pack_incomplete,
      (COALESCE(b.grand_total, b.total_referred_amount, 0) >= v_high_value) AS is_high_value
    FROM base b
  ), scoped AS (
    SELECT e.* FROM enriched e
    WHERE (v_search IS NULL OR (
            COALESCE(e.referral_number,'')     ILIKE '%'||v_search||'%'
         OR COALESCE(e.employer_name,'')       ILIKE '%'||v_search||'%'
         OR COALESCE(e.employer_id,'')         ILIKE '%'||v_search||'%'
         OR COALESCE(e.lg_intake_no,'')        ILIKE '%'||v_search||'%'
         OR COALESCE(e.lg_case_no,'')          ILIKE '%'||v_search||'%'
         OR COALESCE(e.court_case_number,'')   ILIKE '%'||v_search||'%'
         OR COALESCE(e.source_reference_no,'') ILIKE '%'||v_search||'%'
         OR COALESCE(e.referral_reason_text,'')ILIKE '%'||v_search||'%'))
      AND (p_filters->'statuses' IS NULL OR jsonb_array_length(COALESCE(p_filters->'statuses','[]'::jsonb)) = 0
           OR e.status IN (SELECT jsonb_array_elements_text(p_filters->'statuses')))
      AND (COALESCE(p_filters->>'employer_id','') = '' OR e.employer_id = p_filters->>'employer_id')
      AND (COALESCE(p_filters->>'zone','') = '' OR e.employer_zone = p_filters->>'zone')
      AND (COALESCE(p_filters->>'requested_by','') = '' OR e.approval_requested_by = p_filters->>'requested_by')
      AND (COALESCE(p_filters->>'approved_by','') = '' OR e.approved_by = p_filters->>'approved_by')
      AND (COALESCE(p_filters->>'reason_code','') = '' OR e.referral_reason_code = p_filters->>'reason_code')
      AND (COALESCE(p_filters->>'source_case_id','') = '' OR e.source_case_id = (p_filters->>'source_case_id')::uuid)
      AND (COALESCE(p_filters->>'amount_min','') = '' OR COALESCE(e.grand_total,0) >= (p_filters->>'amount_min')::numeric)
      AND (COALESCE(p_filters->>'amount_max','') = '' OR COALESCE(e.grand_total,0) <= (p_filters->>'amount_max')::numeric)
      AND (COALESCE(p_filters->>'created_from','') = '' OR e.created_at >= (p_filters->>'created_from')::timestamptz)
      AND (COALESCE(p_filters->>'created_to','') = '' OR e.created_at < ((p_filters->>'created_to')::date + 1))
      AND (COALESCE(p_filters->>'submitted_from','') = '' OR e.submitted_date >= (p_filters->>'submitted_from')::timestamptz)
      AND (COALESCE(p_filters->>'submitted_to','') = '' OR e.submitted_date < ((p_filters->>'submitted_to')::date + 1))
      AND (COALESCE(p_filters->>'overdue_only','') <> 'true' OR e.is_overdue)
      AND (COALESCE(p_filters->>'high_value_only','') <> 'true' OR e.is_high_value)
      AND (COALESCE(p_filters->>'pack_incomplete_only','') <> 'true' OR e.pack_incomplete)
      AND (COALESCE(p_filters->>'mine_only','') <> 'true'
           OR e.created_by = v_code OR e.approval_requested_by = v_code OR e.referred_by = v_code)
  )
  SELECT
    (SELECT jsonb_object_agg(k, c) FROM (
        SELECT s.status AS k, count(*) AS c FROM scoped s GROUP BY s.status
        UNION ALL SELECT 'ALL', count(*) FROM scoped
        UNION ALL SELECT 'ACTION', count(*) FROM scoped s WHERE s.stage_group = 'ACTION'
        UNION ALL SELECT 'TRACKING', count(*) FROM scoped s WHERE s.stage_group = 'TRACKING'
        UNION ALL SELECT 'CLOSED', count(*) FROM scoped s WHERE s.stage_group = 'CLOSED'
        UNION ALL SELECT 'PREPARATION', count(*) FROM scoped s WHERE s.stage_group = 'PREPARATION'
      ) t),
    jsonb_build_object(
      'total',              (SELECT count(*) FROM scoped),
      'pending_approval',   (SELECT count(*) FROM scoped WHERE status = 'PENDING_APPROVAL'),
      'awaiting_handover',  (SELECT count(*) FROM scoped WHERE status = 'APPROVED_FOR_SUBMISSION'),
      'with_legal',         (SELECT count(*) FROM scoped WHERE status IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','IN_LEGAL_PROCEEDINGS')),
      'returned',           (SELECT count(*) FROM scoped WHERE status = 'RETURNED_BY_LEGAL'),
      'rejected',           (SELECT count(*) FROM scoped WHERE status = 'REJECTED'),
      'overdue',            (SELECT count(*) FROM scoped WHERE is_overdue),
      'pack_incomplete',    (SELECT count(*) FROM scoped WHERE pack_incomplete AND stage_group IN ('ACTION','PREPARATION')),
      'high_value',         (SELECT count(*) FROM scoped WHERE is_high_value AND stage_group IN ('ACTION','TRACKING')),
      'value_total',        (SELECT COALESCE(sum(COALESCE(grand_total,0)),0) FROM scoped),
      'value_with_legal',   (SELECT COALESCE(sum(COALESCE(grand_total,0)),0) FROM scoped WHERE status IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','IN_LEGAL_PROCEEDINGS')),
      'avg_days_pending',   (SELECT COALESCE(ROUND(avg(days_in_stage)::numeric, 1), 0) FROM scoped WHERE status = 'PENDING_APPROVAL')
    )
  INTO v_tabs, v_kpis;

  WITH base AS (
    SELECT r.*,
      CASE r.status
        WHEN 'PENDING_APPROVAL'        THEN COALESCE(r.approval_requested_at, r.created_at)
        WHEN 'APPROVED_FOR_SUBMISSION' THEN COALESCE(r.approved_at, r.created_at)
        WHEN 'RETURNED_BY_LEGAL'       THEN COALESCE(r.returned_at, r.updated_at, r.created_at)
        WHEN 'SUBMITTED_TO_LEGAL'      THEN COALESCE(r.submitted_date, r.created_at)
        WHEN 'ACCEPTED_BY_LEGAL'       THEN COALESCE(r.accepted_date, r.updated_at, r.created_at)
        WHEN 'IN_LEGAL_PROCEEDINGS'    THEN COALESCE(r.accepted_date, r.updated_at, r.created_at)
        ELSE COALESCE(r.updated_at, r.created_at)
      END AS stage_since,
      CASE r.status
        WHEN 'PENDING_APPROVAL'        THEN v_approval_sla
        WHEN 'APPROVED_FOR_SUBMISSION' THEN v_handover_sla
        WHEN 'RETURNED_BY_LEGAL'       THEN v_rework_sla
        WHEN 'SUBMITTED_TO_LEGAL'      THEN v_legal_sla
        ELSE NULL
      END AS sla_days,
      CASE r.status
        WHEN 'PENDING_APPROVAL'        THEN 'ACTION'
        WHEN 'APPROVED_FOR_SUBMISSION' THEN 'ACTION'
        WHEN 'RETURNED_BY_LEGAL'       THEN 'ACTION'
        WHEN 'DRAFT'                   THEN 'PREPARATION'
        WHEN 'SUBMITTED_TO_LEGAL'      THEN 'TRACKING'
        WHEN 'ACCEPTED_BY_LEGAL'       THEN 'TRACKING'
        WHEN 'IN_LEGAL_PROCEEDINGS'    THEN 'TRACKING'
        ELSE 'CLOSED'
      END AS stage_group
    FROM public.ce_legal_referrals r
    WHERE (v_scope IN ('ENTERPRISE','TEAM')
        OR r.created_by = v_code OR r.approval_requested_by = v_code OR r.referred_by = v_code)
  ), enriched AS (
    SELECT b.*,
      ROUND(EXTRACT(EPOCH FROM (now() - b.stage_since)) / 86400.0, 2) AS days_in_stage,
      (b.sla_days IS NOT NULL AND now() > b.stage_since + make_interval(days => b.sla_days::int)) AS is_overdue,
      (b.sla_days IS NOT NULL AND now() > b.stage_since + make_interval(days => GREATEST(b.sla_days::int - 1, 0))
        AND now() <= b.stage_since + make_interval(days => b.sla_days::int)) AS is_due_soon,
      (COALESCE(b.documents_count, 0) = 0 OR COALESCE(b.items_count, 0) = 0) AS pack_incomplete,
      (COALESCE(b.grand_total, b.total_referred_amount, 0) >= v_high_value) AS is_high_value
    FROM base b
  ), scoped AS (
    SELECT e.* FROM enriched e
    WHERE (v_search IS NULL OR (
            COALESCE(e.referral_number,'')     ILIKE '%'||v_search||'%'
         OR COALESCE(e.employer_name,'')       ILIKE '%'||v_search||'%'
         OR COALESCE(e.employer_id,'')         ILIKE '%'||v_search||'%'
         OR COALESCE(e.lg_intake_no,'')        ILIKE '%'||v_search||'%'
         OR COALESCE(e.lg_case_no,'')          ILIKE '%'||v_search||'%'
         OR COALESCE(e.court_case_number,'')   ILIKE '%'||v_search||'%'
         OR COALESCE(e.source_reference_no,'') ILIKE '%'||v_search||'%'
         OR COALESCE(e.referral_reason_text,'')ILIKE '%'||v_search||'%'))
      AND (p_filters->'statuses' IS NULL OR jsonb_array_length(COALESCE(p_filters->'statuses','[]'::jsonb)) = 0
           OR e.status IN (SELECT jsonb_array_elements_text(p_filters->'statuses')))
      AND (COALESCE(p_filters->>'employer_id','') = '' OR e.employer_id = p_filters->>'employer_id')
      AND (COALESCE(p_filters->>'zone','') = '' OR e.employer_zone = p_filters->>'zone')
      AND (COALESCE(p_filters->>'requested_by','') = '' OR e.approval_requested_by = p_filters->>'requested_by')
      AND (COALESCE(p_filters->>'approved_by','') = '' OR e.approved_by = p_filters->>'approved_by')
      AND (COALESCE(p_filters->>'reason_code','') = '' OR e.referral_reason_code = p_filters->>'reason_code')
      AND (COALESCE(p_filters->>'source_case_id','') = '' OR e.source_case_id = (p_filters->>'source_case_id')::uuid)
      AND (COALESCE(p_filters->>'amount_min','') = '' OR COALESCE(e.grand_total,0) >= (p_filters->>'amount_min')::numeric)
      AND (COALESCE(p_filters->>'amount_max','') = '' OR COALESCE(e.grand_total,0) <= (p_filters->>'amount_max')::numeric)
      AND (COALESCE(p_filters->>'created_from','') = '' OR e.created_at >= (p_filters->>'created_from')::timestamptz)
      AND (COALESCE(p_filters->>'created_to','') = '' OR e.created_at < ((p_filters->>'created_to')::date + 1))
      AND (COALESCE(p_filters->>'submitted_from','') = '' OR e.submitted_date >= (p_filters->>'submitted_from')::timestamptz)
      AND (COALESCE(p_filters->>'submitted_to','') = '' OR e.submitted_date < ((p_filters->>'submitted_to')::date + 1))
      AND (COALESCE(p_filters->>'overdue_only','') <> 'true' OR e.is_overdue)
      AND (COALESCE(p_filters->>'high_value_only','') <> 'true' OR e.is_high_value)
      AND (COALESCE(p_filters->>'pack_incomplete_only','') <> 'true' OR e.pack_incomplete)
      AND (COALESCE(p_filters->>'mine_only','') <> 'true'
           OR e.created_by = v_code OR e.approval_requested_by = v_code OR e.referred_by = v_code)
  ), tabbed AS (
    SELECT s.* FROM scoped s
    WHERE v_tab = 'ALL'
       OR (v_tab IN ('ACTION','TRACKING','CLOSED','PREPARATION') AND s.stage_group = v_tab)
       OR (v_tab NOT IN ('ACTION','TRACKING','CLOSED','PREPARATION') AND s.status = v_tab)
  ), ordered AS (
    SELECT t.*, row_number() OVER (ORDER BY
        CASE WHEN v_desc THEN NULL ELSE
          CASE v_sort
            WHEN 'waiting'  THEN to_char(t.stage_since, 'YYYYMMDDHH24MISS')
            WHEN 'created'  THEN to_char(t.created_at, 'YYYYMMDDHH24MISS')
            WHEN 'submitted'THEN to_char(t.submitted_date, 'YYYYMMDDHH24MISS')
            WHEN 'approved' THEN to_char(t.approved_at, 'YYYYMMDDHH24MISS')
            WHEN 'amount'   THEN lpad(COALESCE(t.grand_total,0)::bigint::text, 18, '0')
            WHEN 'employer' THEN lower(COALESCE(t.employer_name,''))
            WHEN 'zone'     THEN lower(COALESCE(t.employer_zone,''))
            WHEN 'status'   THEN t.status
            WHEN 'referral' THEN COALESCE(t.referral_number,'')
            ELSE to_char(t.stage_since, 'YYYYMMDDHH24MISS')
          END END ASC NULLS LAST,
        CASE WHEN v_desc THEN
          CASE v_sort
            WHEN 'waiting'  THEN to_char(t.stage_since, 'YYYYMMDDHH24MISS')
            WHEN 'created'  THEN to_char(t.created_at, 'YYYYMMDDHH24MISS')
            WHEN 'submitted'THEN to_char(t.submitted_date, 'YYYYMMDDHH24MISS')
            WHEN 'approved' THEN to_char(t.approved_at, 'YYYYMMDDHH24MISS')
            WHEN 'amount'   THEN lpad(COALESCE(t.grand_total,0)::bigint::text, 18, '0')
            WHEN 'employer' THEN lower(COALESCE(t.employer_name,''))
            WHEN 'zone'     THEN lower(COALESCE(t.employer_zone,''))
            WHEN 'status'   THEN t.status
            WHEN 'referral' THEN COALESCE(t.referral_number,'')
            ELSE to_char(t.stage_since, 'YYYYMMDDHH24MISS')
          END ELSE NULL END DESC NULLS LAST,
        t.created_at DESC) AS rn
    FROM tabbed t
  )
  SELECT
    (SELECT count(*) FROM tabbed),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'rn' ORDER BY x.rn) FROM (
        SELECT o.id, o.referral_number, o.status, o.stage_group, o.employer_id, o.employer_name,
               o.employer_zone, o.grand_total, o.total_principal, o.total_interest, o.total_penalties,
               o.periods_count, o.items_count, o.documents_count, o.notices_sent, o.period_from, o.period_to,
               o.referral_reason_code, o.referral_reason_text, o.source_case_id, o.source_reference_no,
               o.lg_intake_id, o.lg_intake_no, o.lg_case_no, o.legal_case_id, o.court_case_number,
               o.legal_officer_assigned, o.created_at, o.created_by, o.created_via,
               o.approval_requested_at, o.approval_requested_by,
               public.ce_officer_label(o.approval_requested_by) AS approval_requested_by_name,
               o.approved_at, o.approved_by, public.ce_officer_label(o.approved_by) AS approved_by_name,
               o.approval_notes, o.submitted_date, o.accepted_date, o.accepted_by,
               o.returned_at, o.returned_by, o.return_reason,
               o.rejected_date, o.rejected_by, o.rejection_reason,
               o.stage_since, o.days_in_stage, o.sla_days, o.is_overdue, o.is_due_soon,
               o.pack_incomplete, o.is_high_value, o.updated_at, o.rn
        FROM ordered o WHERE o.rn > (v_page - 1) * v_size AND o.rn <= v_page * v_size) x), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.priority, y.days_in_stage DESC) FROM (
        SELECT s.id, s.referral_number, s.employer_name, s.status, s.grand_total, s.days_in_stage,
               s.sla_days, s.pack_incomplete, s.is_high_value,
               CASE
                 WHEN s.status = 'RETURNED_BY_LEGAL' THEN 1
                 WHEN s.status = 'PENDING_APPROVAL' AND s.is_overdue THEN 2
                 WHEN s.status = 'APPROVED_FOR_SUBMISSION' AND s.is_overdue THEN 3
                 WHEN s.status = 'SUBMITTED_TO_LEGAL' AND s.is_overdue THEN 4
                 WHEN s.pack_incomplete AND s.stage_group = 'ACTION' THEN 5
                 ELSE 9 END AS priority,
               CASE
                 WHEN s.status = 'RETURNED_BY_LEGAL' THEN 'Returned by Legal — rework required'
                 WHEN s.status = 'PENDING_APPROVAL' AND s.is_overdue THEN 'Approval overdue'
                 WHEN s.status = 'APPROVED_FOR_SUBMISSION' AND s.is_overdue THEN 'Approved but not handed over'
                 WHEN s.status = 'SUBMITTED_TO_LEGAL' AND s.is_overdue THEN 'No Legal response'
                 ELSE 'Referral pack incomplete' END AS attention_reason
        FROM scoped s
        WHERE s.status = 'RETURNED_BY_LEGAL'
           OR (s.is_overdue AND s.stage_group IN ('ACTION','TRACKING'))
           OR (s.pack_incomplete AND s.stage_group = 'ACTION')
        LIMIT 25) y), '[]'::jsonb)
  INTO v_total, v_rows, v_attention;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'tab_counts', COALESCE(v_tabs, '{}'::jsonb),
    'kpis', v_kpis,
    'attention', v_attention,
    'actor', jsonb_build_object('user_code', v_code, 'role', v_role, 'scope', v_scope,
                                'can_approve', v_can_approve, 'can_submit', v_can_submit),
    'sla', jsonb_build_object('approval_days', v_approval_sla, 'handover_days', v_handover_sla,
                              'legal_response_days', v_legal_sla, 'rework_days', v_rework_sla,
                              'high_value_threshold', v_high_value)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_legal_referral_queue_v1(jsonb, text, text, integer, integer) TO authenticated;