DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.bn_award_suspension_reject_v1(uuid,uuid,text,text,integer,text,text)'::regprocedure);
  v_def := replace(v_def,
    'FROM public.bn_reason_code WHERE code=p_reason_code',
    'FROM public.bn_reason_code WHERE reason_code=p_reason_code');
  IF v_def LIKE '%bn_reason_code WHERE code=%' THEN
    RAISE EXCEPTION 'bn_reason_code patch did not apply';
  END IF;
  EXECUTE v_def;
END
$mig$;