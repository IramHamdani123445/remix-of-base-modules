DO $mig$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('bn_award_suspension_approve_v1', 'bn_award_suspension_withdraw_v1')
       AND p.prosrc ~ 'completed_by\s*=\s*[a-z_]+::text'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(v_def, 'completed_by\s*=\s*([a-z_]+)::text', 'completed_by=\1', 'g');
    EXECUTE v_def;
  END LOOP;
END
$mig$;