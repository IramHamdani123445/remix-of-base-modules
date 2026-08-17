DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
  WHERE proname='bn_submit_claim_application' AND pronamespace='public'::regnamespace LIMIT 1;

  IF position('claimStatus' in d) = 0 THEN
    d := replace(d,
      '      ''claimType'', COALESCE(v_product_name, p_product_code)' || chr(10) || '    ),',
      '      ''claimType'', COALESCE(v_product_name, p_product_code),' || chr(10) ||
      '      ''claimStatus'', ''INTAKE'',' || chr(10) ||
      '      ''submittedOn'', to_char(now(), ''YYYY-MM-DD'')' || chr(10) || '    ),');
    IF position('claimStatus' in d) = 0 THEN
      RAISE EXCEPTION 'payload patch did not apply';
    END IF;
    EXECUTE d;
  END IF;
END
$mig$;

DO $proof$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.bn_submit_claim_application(
    '950004','SKN-EI-MED', current_date, 'OFFICE',
    jsonb_build_object('declaration_accepted', true,
                       'contact_email','olivia.daniels@mishainfotech.com'),
    NULL, 'PRINT-PROOF-2', NULL, NULL);
  RAISE NOTICE 'claim % comm %', r.claim_number, r.communication_event_id;
END
$proof$;