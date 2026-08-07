
DO $do$
DECLARE v_def text; v_new text; r record;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('bn_risk_assessment_detail_v1','bn_risk_assessment_queue_v1')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def,
      '(SELECT NULLIF(btrim(concat_ws('' '', m.first_name, m.last_name)),'''')
                        FROM public.ip_master m WHERE m.ssn = v_a.person_ssn LIMIT 1)',
      'public._bn_risk_person_display_name(v_a.person_ssn)');
    v_new := replace(v_new,
      '(SELECT NULLIF(btrim(concat_ws('' '', m.first_name, m.last_name)),'''')
                        FROM public.ip_master m WHERE m.ssn = a.person_ssn LIMIT 1)',
      'public._bn_risk_person_display_name(a.person_ssn)');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'person name lookup pattern not found in function oid %', r.oid;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $do$;
