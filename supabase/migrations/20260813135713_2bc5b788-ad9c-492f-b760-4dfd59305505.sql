CREATE OR REPLACE FUNCTION public.omni_comms_priv_requeue_business_event(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.omni_comms_business_event_outbox;
BEGIN
  SELECT * INTO v_row FROM public.omni_comms_business_event_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 business_event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status NOT IN ('blocked', 'needs_review') THEN
    RAISE EXCEPTION 'OC422 business_event_not_requeueable' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.request_id IS NOT NULL
     AND NOT public.omni_comms_priv_request_never_dispatched(v_row.request_id) THEN
    RAISE EXCEPTION 'OC409 business_event_already_materialised' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.omni_comms_business_event_outbox
     SET status = 'pending', blocker_code = NULL, result_code = NULL,
         claimed_at = NULL, processed_at = NULL,
         next_attempt_at = now(), updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('status', 'pending', 'id', p_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_requeue_business_event(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_requeue_business_event(uuid) TO service_role;

SELECT public.omni_comms_priv_requeue_business_event('8963c01b-e8cb-4ba1-8699-90653d085bf4');