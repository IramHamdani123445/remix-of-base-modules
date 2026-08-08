CREATE OR REPLACE FUNCTION public.bn_risk_control_execution_queue_v1(
  p_actor_user_id uuid, p_filters jsonb, p_page integer, p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_restricted boolean; v_bucket text; v_page int; v_size int;
  v_rows jsonb; v_total int; v_counts jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_restricted := COALESCE((public.bn_risk_check_actor_permission(
                    p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  v_bucket := NULLIF(btrim(COALESCE(p_filters->>'bucket','')),'');
  v_page := GREATEST(COALESCE(p_page,1),1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size,20),1),100);

  WITH base AS (
    SELECT a.assessment_id, a.assessment_reference, a.person_ssn, a.status,
           a.assigned_team_code, a.assigned_owner_user_id,
           r.control_code, r.control_label, r.control_class, r.decided_at,
           e.status AS exec_status, e.target_module, e.is_retryable
      FROM public.bn_risk_assessment a
      JOIN public.bn_risk_recommendation r
        ON r.assessment_id = a.assessment_id AND r.status = 'APPROVED'
      LEFT JOIN LATERAL (
        SELECT * FROM public.bn_risk_control_execution x
         WHERE x.recommendation_id = r.recommendation_id
         ORDER BY x.attempt_no DESC LIMIT 1) e ON true
     WHERE a.status IN ('CONTROL_ACTION','REFERRED')
  ), bucketed AS (
    SELECT b.*, CASE
      WHEN b.exec_status IS NULL THEN 'AWAITING_EXECUTION'
      WHEN b.exec_status = 'FAILED' AND b.is_retryable THEN 'RETRY_AVAILABLE'
      WHEN b.exec_status = 'FAILED' THEN 'FAILED'
      WHEN b.exec_status = 'REJECTED_BY_TARGET' THEN 'REJECTED_BY_TARGET'
      WHEN b.exec_status = 'COMPLETED' THEN 'AWAITING_OUTCOME'
      WHEN b.control_class = 'REFERRAL' THEN 'REFERRAL_PENDING'
      ELSE 'IN_PROGRESS' END AS bucket
      FROM base b
  ), filtered AS (
    SELECT * FROM bucketed WHERE v_bucket IS NULL OR bucket = v_bucket
  ), page_rows AS (
    SELECT f.decided_at, jsonb_build_object(
      'assessment_id', f.assessment_id,
      'assessment_reference', f.assessment_reference,
      'person_name', public._bn_risk_person_display_name(f.person_ssn),
      'person_masked_identifier', public._bn_risk_mask_ssn(f.person_ssn),
      'current_stage', CASE WHEN f.status='REFERRED' THEN 'Referral' ELSE 'Control execution' END,
      'execution_status', COALESCE(f.exec_status,'NOT_STARTED'),
      'execution_status_label', public._bn_risk_exec_status_label(COALESCE(f.exec_status,'NOT_STARTED')),
      'target_module', f.target_module,
      'approved_at', f.decided_at,
      'age_days', GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(f.decided_at, now())))/86400)::int),
      'assigned_owner_name', public._bn_risk_actor_name(f.assigned_owner_user_id),
      'assigned_team_code', f.assigned_team_code,
      'action_required', CASE f.bucket
        WHEN 'AWAITING_EXECUTION' THEN 'Control execution required'
        WHEN 'RETRY_AVAILABLE'    THEN 'Execution failed — retry available'
        WHEN 'FAILED'             THEN 'Execution failed'
        WHEN 'REJECTED_BY_TARGET' THEN 'Owning domain rejected the control'
        WHEN 'AWAITING_OUTCOME'   THEN 'Execution complete — awaiting outcome'
        WHEN 'REFERRAL_PENDING'   THEN 'Referral handoff pending'
        ELSE 'Execution in progress' END,
      'control_code',  CASE WHEN v_restricted THEN f.control_code ELSE NULL END,
      'control_label', CASE WHEN v_restricted THEN f.control_label ELSE NULL END
    ) AS row_json
      FROM filtered f
     ORDER BY f.decided_at NULLS LAST
     OFFSET (v_page-1)*v_size LIMIT v_size
  )
  SELECT COALESCE((SELECT jsonb_agg(row_json ORDER BY decided_at NULLS LAST) FROM page_rows),'[]'::jsonb),
         (SELECT count(*) FROM filtered),
         COALESCE((SELECT jsonb_object_agg(bucket, n) FROM (
            SELECT bucket, count(*) n FROM bucketed GROUP BY 1) c),'{}'::jsonb)
    INTO v_rows, v_total, v_counts;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', v_rows, 'total', COALESCE(v_total,0), 'page', v_page, 'page_size', v_size,
    'bucket_counts', v_counts, 'restricted_detail_visible', v_restricted));
END; $$;