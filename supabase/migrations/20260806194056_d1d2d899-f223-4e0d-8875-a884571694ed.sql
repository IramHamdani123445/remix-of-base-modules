DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND (p.proname LIKE '\_bn\_mortality\_%'
         OR p.proname LIKE '\_bn\_cross\_module\_%'
         OR p.proname = 'bn_cross_module_handoff_execute_v1')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, PUBLIC', r.sig);
  END LOOP;
END $$;