DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc ~ '[^.]digest\('
       AND NOT EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path%extensions%'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO ''public'', ''extensions''', r.sig);
  END LOOP;
END $$;