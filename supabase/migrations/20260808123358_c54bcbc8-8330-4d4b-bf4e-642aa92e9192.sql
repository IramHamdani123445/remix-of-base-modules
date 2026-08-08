CREATE OR REPLACE FUNCTION public.bn_uprating_operational_queue_v1(
  p_actor_user_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bucket text := NULLIF(btrim(COALESCE(p_filters->>'bucket_code','')),'');
  v_rows jsonb; v_total int; v_summary jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);

  WITH base AS (
    SELECT r.run_id, r.run_reference, r.run_name, r.status, r.target_effective_date,
           r.updated_at, r.schedules_rebuilt_at, r.communications_issued_at, r.reconciled_at,
           r.rolled_back_at, r.failed_at,
           COALESCE(es.applied_item_count,0) AS applied_item_count,
           COALESCE(es.failed_item_count,0)  AS failed_item_count,
           COALESCE(es.planned_item_count,0) AS planned_item_count,
           COALESCE(es.applied_delta_total_minor,0) AS applied_delta_total_minor,
           (SELECT count(*) FROM public.bn_uprating_schedule_rebuild s
             WHERE s.run_id = r.run_id AND s.status NOT IN ('COMPLETED','NOT_REQUIRED')) AS schedule_outstanding,
           (SELECT count(*) FROM public.bn_uprating_communication_intent c
             WHERE c.run_id = r.run_id AND (c.status='PENDING' OR c.status='FAILED')) AS communication_outstanding,
           rec.status AS reconciliation_status,
           rec.blocking_finding_count,
           ro.status AS rollback_status,
           ro.eligible_count, ro.ineligible_count, ro.compensated_count
      FROM public.bn_uprating_run r
      LEFT JOIN public.bn_uprating_execution_session es ON es.run_id = r.run_id
      LEFT JOIN public.bn_uprating_reconciliation rec
             ON rec.reconciliation_id = r.current_reconciliation_id
      LEFT JOIN public.bn_uprating_rollback_operation ro
             ON ro.rollback_id = r.current_rollback_id
     WHERE r.status IN ('EXECUTING','COMPLETED','PARTIAL','SCHEDULES_REBUILT',
                        'COMMUNICATIONS_ISSUED','RECONCILED','FAILED','ROLLED_BACK')
  ), bucketed AS (
    SELECT b.*,
      CASE
        WHEN b.status = 'ROLLED_BACK' THEN 'ROLLED_BACK'
        WHEN b.status = 'FAILED' AND COALESCE(b.rollback_status,'') = 'BLOCKED' THEN 'ROLLBACK_BLOCKED'
        WHEN b.status = 'FAILED' AND COALESCE(b.rollback_status,'') = 'PARTIAL' THEN 'ROLLBACK_IN_PROGRESS'
        WHEN b.status = 'FAILED' AND COALESCE(b.rollback_status,'') = 'ASSESSED' THEN 'ROLLBACK_AWAITING_AUTHORISATION'
        WHEN b.status = 'FAILED' THEN 'ROLLBACK_ASSESSMENT_REQUIRED'
        WHEN b.status = 'RECONCILED' THEN 'RECONCILED'
        WHEN b.status = 'COMMUNICATIONS_ISSUED' AND COALESCE(b.reconciliation_status,'') = 'BLOCKED'
          THEN 'RECONCILIATION_BLOCKED'
        WHEN b.status = 'COMMUNICATIONS_ISSUED' THEN 'READY_TO_RECONCILE'
        WHEN b.status = 'SCHEDULES_REBUILT' THEN 'COMMUNICATION_PENDING'
        ELSE 'SCHEDULE_REBUILD_REQUIRED'
      END AS bucket_code
      FROM base b
  ), labelled AS (
    SELECT bq.*,
      CASE bq.bucket_code
        WHEN 'SCHEDULE_REBUILD_REQUIRED' THEN 'Needs schedule rebuild'
        WHEN 'COMMUNICATION_PENDING' THEN 'Claimant notices pending'
        WHEN 'READY_TO_RECONCILE' THEN 'Ready to reconcile'
        WHEN 'RECONCILIATION_BLOCKED' THEN 'Reconciliation blocked'
        WHEN 'RECONCILED' THEN 'Reconciled — awaiting closure'
        WHEN 'ROLLBACK_ASSESSMENT_REQUIRED' THEN 'Failed — rollback assessment required'
        WHEN 'ROLLBACK_AWAITING_AUTHORISATION' THEN 'Rollback awaiting authorisation'
        WHEN 'ROLLBACK_IN_PROGRESS' THEN 'Rollback partially applied'
        WHEN 'ROLLBACK_BLOCKED' THEN 'Rollback blocked'
        WHEN 'ROLLED_BACK' THEN 'Rolled back'
        ELSE bq.bucket_code
      END AS bucket_label,
      CASE WHEN bq.bucket_code LIKE 'ROLLBACK%' OR bq.bucket_code = 'ROLLED_BACK'
           THEN 'rollback' ELSE 'reconciliation' END AS workspace_section
      FROM bucketed bq
  )
  SELECT
    COALESCE((SELECT count(*) FROM labelled l WHERE v_bucket IS NULL OR l.bucket_code = v_bucket),0),
    COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object(
        'run_id', l.run_id,'run_reference', l.run_reference,'run_name', l.run_name,
        'status', l.status,
        'status_label', public._bn_uprating_ref_label('RUN_STATUS', l.status),
        'bucket_code', l.bucket_code,'bucket_label', l.bucket_label,
        'workspace_section', l.workspace_section,
        'target_effective_date', l.target_effective_date,
        'applied_item_count', l.applied_item_count,
        'failed_item_count', l.failed_item_count,
        'planned_item_count', l.planned_item_count,
        'applied_delta_total_minor', l.applied_delta_total_minor,
        'schedule_outstanding_count', l.schedule_outstanding,
        'communication_outstanding_count', l.communication_outstanding,
        'reconciliation_status', l.reconciliation_status,
        'blocking_finding_count', COALESCE(l.blocking_finding_count,0),
        'rollback_status', l.rollback_status,
        'rollback_eligible_count', COALESCE(l.eligible_count,0),
        'rollback_ineligible_count', COALESCE(l.ineligible_count,0),
        'rollback_compensated_count', COALESCE(l.compensated_count,0),
        'last_activity_at', l.updated_at) AS x
        FROM labelled l
       WHERE v_bucket IS NULL OR l.bucket_code = v_bucket
       ORDER BY l.updated_at DESC
       LIMIT GREATEST(COALESCE(p_limit,50),1) OFFSET GREATEST(COALESCE(p_offset,0),0)) q),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket_code', s.bucket_code,
              'bucket_label', s.bucket_label,'run_count', s.n) ORDER BY s.bucket_code)
       FROM (SELECT l.bucket_code, min(l.bucket_label) AS bucket_label, count(*) AS n
               FROM labelled l GROUP BY l.bucket_code) s),'[]'::jsonb)
  INTO v_total, v_rows, v_summary;

  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,
    'data', jsonb_build_object('rows', v_rows,'total', v_total,'summary', v_summary));
END; $function$;

GRANT EXECUTE ON FUNCTION public.bn_uprating_operational_queue_v1(uuid,jsonb,integer,integer)
  TO authenticated, service_role;