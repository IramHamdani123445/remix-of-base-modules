
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_queue_v1(
  p_actor_user_id uuid, p_filters jsonb, p_page integer, p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_rows jsonb; v_total int; v_counts jsonb;
  v_status text := NULLIF(p_filters->>'status','');
  v_search text := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  v_own text := COALESCE(p_filters->>'ownership','ALL');
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),1),100);
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  SELECT count(*) INTO v_total
    FROM public.bn_risk_assessment a
   WHERE a.status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW')
     AND (v_status IS NULL OR a.status = v_status)
     AND (v_own <> 'MINE' OR a.assigned_owner_user_id = p_actor_user_id)
     AND (v_own <> 'UNASSIGNED' OR a.assigned_owner_user_id IS NULL)
     AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
          OR COALESCE(a.summary,'') ILIKE '%'||v_search||'%');

  SELECT jsonb_object_agg(s.status, s.c) INTO v_counts FROM (
    SELECT a.status, count(*) c
      FROM public.bn_risk_assessment a
     WHERE a.status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW')
       AND (v_own <> 'MINE' OR a.assigned_owner_user_id = p_actor_user_id)
       AND (v_own <> 'UNASSIGNED' OR a.assigned_owner_user_id IS NULL)
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
            OR COALESCE(a.summary,'') ILIKE '%'||v_search||'%')
     GROUP BY a.status) s;

  SELECT jsonb_agg(r) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'assessment_id', a.assessment_id, 'assessment_reference', a.assessment_reference,
      'person_id', a.person_id,
      'person_name', public._bn_risk_person_display_name(a.person_ssn),
      'person_masked_identifier', public._bn_risk_mask_ssn(a.person_ssn),
      'primary_category_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                           WHERE domain='CATEGORY' AND code=a.primary_category_code),
                                          a.primary_category_code),
      'linked_signal_count', (SELECT count(*) FROM public.bn_risk_assessment_signal s
                               WHERE s.assessment_id=a.assessment_id),
      'status', a.status,
      'status_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                 WHERE domain='ASSESSMENT_STATUS' AND code=a.status), a.status),
      'outstanding_information', (SELECT count(*) FROM public.bn_risk_information_request r2
                                   WHERE r2.assessment_id=a.assessment_id
                                     AND r2.status NOT IN ('RESOLVED','CANCELLED')),
      'assigned_owner_name', public._bn_risk_actor_name(a.assigned_owner_user_id),
      'assigned_team_code', a.assigned_team_code,
      'opened_at', a.opened_at,
      'age_days', GREATEST(0, (CURRENT_DATE - a.opened_at::date)),
      'action_required', CASE a.status
        WHEN 'DRAFT' THEN 'Start information gathering'
        WHEN 'OPEN' THEN 'Record factors and evidence'
        WHEN 'INFORMATION_PENDING' THEN 'Awaiting requested information'
        ELSE 'Ready for review' END) AS r
      FROM public.bn_risk_assessment a
     WHERE a.status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW')
       AND (v_status IS NULL OR a.status = v_status)
       AND (v_own <> 'MINE' OR a.assigned_owner_user_id = p_actor_user_id)
       AND (v_own <> 'UNASSIGNED' OR a.assigned_owner_user_id IS NULL)
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
            OR COALESCE(a.summary,'') ILIKE '%'||v_search||'%')
     ORDER BY a.opened_at DESC
     LIMIT v_size OFFSET (v_page-1)*v_size) t;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', COALESCE(v_rows,'[]'::jsonb), 'total_count', COALESCE(v_total,0),
    'page', v_page, 'page_size', v_size, 'status_counts', COALESCE(v_counts,'{}'::jsonb)));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_assessment_queue_v1(uuid,jsonb,integer,integer) TO authenticated;
