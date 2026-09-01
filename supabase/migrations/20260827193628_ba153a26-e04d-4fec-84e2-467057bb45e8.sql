CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_request_attachments(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg uuid;
  v_res jsonb;
  v_included integer := 0;
  v_dropped integer := 0;
  v_blocked integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_request_attachment WHERE request_id = p_request_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'included', 0, 'dropped', 0, 'blocked', 0);
  END IF;

  FOR v_msg IN
    SELECT id FROM public.omni_comms_message WHERE request_id = p_request_id ORDER BY created_at
  LOOP
    v_res := public.omni_comms_priv_resolve_message_attachments(v_msg);
    v_included := v_included + COALESCE((v_res->>'included')::int, 0);
    v_dropped := v_dropped + COALESCE((v_res->>'dropped')::int, 0);
    v_blocked := v_blocked + COALESCE((v_res->>'blocked')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_blocked = 0,
    'code', CASE WHEN v_blocked > 0 THEN 'attachment_required_unsupported' ELSE NULL END,
    'included', v_included, 'dropped', v_dropped, 'blocked', v_blocked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_request_attachments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_request_attachments(uuid) TO service_role;