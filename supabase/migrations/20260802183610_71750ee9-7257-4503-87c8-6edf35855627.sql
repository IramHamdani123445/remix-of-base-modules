DO $mig$
DECLARE v_src text; v_new text;
BEGIN
  -- 1. Dispatcher referenced ed.event_code; the catalogue column is ed.code.
   SELECT pg_get_functiondef(p.oid) INTO v_src
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'omni_comms_priv_dispatch_claim_email';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'claim worker not found';
  END IF;
  IF position('ed.event_code' in v_src) > 0 THEN
    v_new := replace(v_src, 'ed.event_code', 'ed.code AS event_code');
    EXECUTE v_new;
  END IF;

  -- 2. Prerequisite check 7 referenced public.omni_comms_channel_provider,
  --    which does not exist. The canonical adapter registry is
  --    public.omni_comms_provider.
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_channel_release_prerequisites';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'prerequisite evaluator not found';
  END IF;
  IF position('public.omni_comms_channel_provider' in v_src) > 0 THEN
    v_new := replace(v_src, 'public.omni_comms_channel_provider',
                            'public.omni_comms_provider');
    EXECUTE v_new;
  END IF;
END
$mig$;