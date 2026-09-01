CREATE OR REPLACE FUNCTION public.omni_comms_ops_job_authorization(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('operate');
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'OC422 request_required' USING ERRCODE='P0001', DETAIL='request_id';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.id,
           'channel', j.channel,
           'status', j.status,
           'is_runnable', j.is_runnable,
           'stored_hold_reason', j.hold_reason,
           'authorization_outcome', j.authorization_outcome,
           'authorization_evaluated_at', j.authorization_evaluated_at,
           'authorization_evaluation_count', j.authorization_evaluation_count,
           'classification', public.omni_comms_hold_classification(
                               coalesce(j.authorization_outcome, j.hold_reason))
         ) ORDER BY j.created_at, j.id), '[]'::jsonb)
    INTO v_rows
    FROM public.omni_comms_dispatch_job j
   WHERE j.request_id = p_request_id;

  RETURN jsonb_build_object('request_id', p_request_id, 'jobs', v_rows,
                            'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_ops_job_authorization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_ops_job_authorization(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_ops_job_authorization(uuid) TO authenticated, service_role;