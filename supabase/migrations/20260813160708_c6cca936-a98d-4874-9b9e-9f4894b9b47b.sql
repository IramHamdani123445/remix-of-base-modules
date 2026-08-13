DO $migration$
DECLARE
  v_oid oid;
  v_source text;
  v_old text := 'public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)';
  v_new text := 'public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text,uuid,uuid)';
BEGIN
  SELECT p.oid
    INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'omni_comms_priv_channel_release_decision'
    AND pg_get_function_identity_arguments(p.oid) = 'p_organization_id uuid, p_department_id uuid, p_channel text, p_event_code text, p_caller_module_code text, p_mode text, p_recipient_hashes text[], p_requested_message_count integer, p_deployed_revision text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'omni_comms_release_decision_function_missing';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_source;

  IF position(v_old IN v_source) = 0 THEN
    RAISE EXCEPTION 'omni_comms_dispatch_signature_guard_not_found';
  END IF;

  v_source := replace(v_source, v_old, v_new);
  EXECUTE v_source;
END
$migration$;