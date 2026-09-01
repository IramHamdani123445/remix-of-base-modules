DO $mig$
DECLARE
  v_def text;
  v_before text;
BEGIN
  v_def := pg_get_viewdef('public.ce_v_legal_proceeding_register'::regclass, true);
  v_before := v_def;
  v_def := replace(v_def,
    E'c.status_code::text = ''CLOSED''::text OR c.current_stage_code::text = ''CLOSED''::text AS is_closed',
    E'COALESCE(c.status_code::text = ''CLOSED''::text OR c.current_stage_code::text = ''CLOSED''::text, false) AS is_closed');
  IF v_def = v_before THEN RAISE EXCEPTION 'is_closed anchor not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.ce_v_legal_proceeding_register AS ' || v_def;
END
$mig$;