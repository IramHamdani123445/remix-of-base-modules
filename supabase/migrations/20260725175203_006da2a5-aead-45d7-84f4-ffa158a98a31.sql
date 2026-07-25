
CREATE OR REPLACE FUNCTION public.set_comm_hub_real_email_gate(
  p_module text, p_event text, p_channel text,
  p_enabled boolean, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.communication_hub_real_email_gate%ROWTYPE;
  v_module text := lower(trim(coalesce(p_module,'')));
  v_event  text := lower(trim(coalesce(p_event,'')));
  v_channel text := lower(trim(coalesce(nullif(p_channel,''),'email')));
  v_reason text := trim(coalesce(p_reason,''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  IF v_module = '' OR v_event = '' THEN
    RAISE EXCEPTION 'module_and_event_required';
  END IF;
  IF length(v_reason) < 8 THEN
    RAISE EXCEPTION 'reason_required_min_8_chars';
  END IF;

  INSERT INTO public.communication_hub_real_email_gate
    (module_code,event_code,channel,enabled,opened_by,opened_at,reason,closed_by,closed_at)
  VALUES
    (v_module, v_event, v_channel, p_enabled,
     CASE WHEN p_enabled THEN v_uid END,
     CASE WHEN p_enabled THEN now() END,
     v_reason,
     CASE WHEN NOT p_enabled THEN v_uid END,
     CASE WHEN NOT p_enabled THEN now() END)
  ON CONFLICT (module_code,event_code,channel) DO UPDATE
    SET enabled  = EXCLUDED.enabled,
        reason   = EXCLUDED.reason,
        opened_by = CASE WHEN EXCLUDED.enabled THEN v_uid
                         ELSE public.communication_hub_real_email_gate.opened_by END,
        opened_at = CASE WHEN EXCLUDED.enabled THEN now()
                         ELSE public.communication_hub_real_email_gate.opened_at END,
        closed_by = CASE WHEN NOT EXCLUDED.enabled THEN v_uid ELSE NULL END,
        closed_at = CASE WHEN NOT EXCLUDED.enabled THEN now() ELSE NULL END
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'gate', to_jsonb(v_row));
END $$;

REVOKE ALL ON FUNCTION public.set_comm_hub_real_email_gate(text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_comm_hub_real_email_gate(text,text,text,boolean,text) TO authenticated;
