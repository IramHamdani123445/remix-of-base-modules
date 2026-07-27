DO $$
DECLARE
  v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='get_comm_hub_current_evidence_snapshot' AND pronamespace='public'::regnamespace;
  v_new := replace(v_def,
    'WHERE lower(channel) = v_channel AND is_active = true AND is_default = true',
    'WHERE lower(channel::text) = v_channel AND is_active = true AND is_default = true');
  IF v_new = v_def THEN RAISE NOTICE 'nochange';
  ELSE EXECUTE v_new; END IF;
END $$;