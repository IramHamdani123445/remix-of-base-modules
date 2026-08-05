DO $mig$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname LIKE '\_bn\_susp\_%'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated, PUBLIC', r.sig);
  END LOOP;

  -- Scheduler-only surfaces stay closed to browser roles as well.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('bn_award_suspension_due_for_execution_v1',
                         'bn_award_suspension_execute_scheduled_v1')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated, PUBLIC', r.sig);
  END LOOP;

  -- Anonymous visitors may never invoke any suspension or reinstatement command.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'bn\_award\_suspension\_%' OR p.proname LIKE 'bn\_award\_reinstatement\_%')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, PUBLIC', r.sig);
  END LOOP;
END
$mig$;