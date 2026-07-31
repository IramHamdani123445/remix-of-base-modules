CREATE OR REPLACE FUNCTION public.omni_comms_priv_load_persisted_recipients(
  p_actor_id uuid,
  p_request_id uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_req record;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  SELECT id, status, mode INTO v_req
  FROM public.omni_comms_request
  WHERE id = p_request_id AND organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'status',     v_req.status,
    'mode',       v_req.mode,
    'recipients', coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'recipient_id',        rc.id,
                 'input_index',         (rc.per_recipient_snapshot->>'input_index')::int,
                 'recipient_reference', rc.recipient_reference,
                 'resolved_channels',   coalesce(rc.resolved_channels, '[]'::jsonb),
                 'eligibility_status',  rc.eligibility_status,
                 'blockers',            coalesce(rc.blockers, '[]'::jsonb)
               )
               ORDER BY (rc.per_recipient_snapshot->>'input_index')::int NULLS LAST,
                        rc.created_at, rc.id
             )
      FROM public.omni_comms_recipient rc
      WHERE rc.request_id = p_request_id
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_recipients(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_recipients(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_recipients(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_load_persisted_recipients(uuid, uuid, uuid) TO service_role;