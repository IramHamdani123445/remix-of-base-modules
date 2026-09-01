DO $mig$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.ce_waiver_register_v1(jsonb)'::regprocedure) INTO v_def;
  v_def := replace(v_def, '  CREATE TEMP TABLE IF NOT EXISTS pg_temp_unused_waiver (x int);'||chr(10), '');
  EXECUTE v_def;
END
$mig$;