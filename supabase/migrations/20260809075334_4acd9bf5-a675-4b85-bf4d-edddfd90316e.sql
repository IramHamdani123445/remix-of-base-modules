DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_bn_means_calculate_v1';
  IF d IS NULL THEN
    RAISE EXCEPTION 'public._bn_means_calculate_v1 not found';
  END IF;
  IF position('DELETE FROM _mt_out;' in d) = 0 THEN
    RAISE NOTICE 'already patched';
    RETURN;
  END IF;
  d := replace(d, 'DELETE FROM _mt_out;', 'DELETE FROM _mt_out WHERE true;');
  EXECUTE d;
END $mig$;