DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ce_legal_proceeding_register_v1';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ce_legal_proceeding_register_v1 not found';
  END IF;

  v_def := replace(
    v_def,
    'CREATE TEMP TABLE IF NOT EXISTS _ce_lp_scratch ON COMMIT DROP AS SELECT 1 WHERE false;',
    ''
  );

  IF position('CREATE TEMP TABLE' in v_def) > 0 THEN
    RAISE EXCEPTION 'temp table statement still present after rewrite';
  END IF;

  EXECUTE v_def;
END
$mig$;