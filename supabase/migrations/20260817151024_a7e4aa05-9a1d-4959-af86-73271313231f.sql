DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_priv_print_production_claim'
   LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'claim function missing'; END IF;
  IF position('omni_comms_priv_print_stationery_effective' in d) = 0 THEN
    RAISE NOTICE 'already migrated';
    RETURN;
  END IF;
  d := replace(d,
    'public.omni_comms_priv_print_stationery_effective(',
    'public.omni_comms_priv_print_letterhead_effective(');
  EXECUTE d;
END $$;