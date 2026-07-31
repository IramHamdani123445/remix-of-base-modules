DO $$
DECLARE v_src text; v_new text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname='omni_comms_priv_send_communication';
  v_new := replace(v_src,
    'p_organization_id::text || ''|'' || v_caller || ''|'' || p_idempotency_key,',
    '''caller_module'',');
  IF v_new = v_src THEN RAISE EXCEPTION 'idempotency_scope expression not found'; END IF;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.omni_comms_priv_send_communication(p_actor_id uuid, p_organization_id uuid, p_department_id uuid, p_event_code text, p_mode text, p_idempotency_key text, p_caller_module_code text, p_caller_entity_type text, p_caller_entity_id text, p_correlation_id text, p_request_fingerprint text, p_payload jsonb, p_requested_channels text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L', v_new);
END $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_send_communication(uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text[]) TO service_role;