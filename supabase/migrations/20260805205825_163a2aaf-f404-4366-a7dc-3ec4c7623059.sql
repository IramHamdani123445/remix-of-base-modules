DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public._bn_susp_arrears(uuid,date,date)'::regprocedure);
  v_def := replace(v_def,
    'v_notes := v_notes || ''Entitlement rate or payment frequency not resolvable.''',
    'v_notes := v_notes || ''Entitlement rate or payment frequency not resolvable.''::text');
  v_def := replace(v_def,
    'v_notes := v_notes || ''Both paid schedules and paid instructions exist in the suspended period; settled amount cannot be derived automatically.''',
    'v_notes := v_notes || ''Both paid schedules and paid instructions exist in the suspended period; settled amount cannot be derived automatically.''::text');
  EXECUTE v_def;
END
$mig$;