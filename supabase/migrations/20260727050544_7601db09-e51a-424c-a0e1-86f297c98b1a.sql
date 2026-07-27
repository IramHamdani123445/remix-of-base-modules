DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='get_comm_hub_current_evidence_snapshot' AND pronamespace='public'::regnamespace;
  v_new := replace(v_def,
    'to_jsonb(COALESCE(v_rp.approved_domains, ARRAY[]::text[]))',
    'COALESCE(v_rp.approved_domains, ''[]''::jsonb)');
  IF v_new = v_def THEN
    RAISE NOTICE 'no change';
  ELSE
    EXECUTE v_new;
  END IF;
END $$;