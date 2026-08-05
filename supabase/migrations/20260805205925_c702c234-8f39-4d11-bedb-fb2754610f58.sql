DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public._bn_susp_persist_arrears_run(uuid,jsonb,text)'::regprocedure);
  v_def := replace(v_def,
    'INSERT INTO public.bn_calc_trace (calc_run_id, step_no, step_name, output_value)
    VALUES (v_run, v_seq, v_step->>''step'', v_step);',
    'INSERT INTO public.bn_calc_trace (calc_run_id, engine_layer, step_number, step_code, step_label, inputs)
    VALUES (v_run, ''ARREARS'', v_seq, v_step->>''step'', v_step->>''step'', v_step);');
  IF v_def LIKE '%step_no,%' THEN
    RAISE EXCEPTION 'bn_calc_trace insert patch did not apply';
  END IF;
  EXECUTE v_def;
END
$mig$;