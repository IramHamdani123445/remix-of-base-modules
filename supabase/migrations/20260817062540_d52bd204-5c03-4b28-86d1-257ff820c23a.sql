DO $proof$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.bn_submit_claim_application(
    '950004','SKN-EI-MED', current_date, 'OFFICE',
    jsonb_build_object('declaration_accepted', true,
                       'contact_email','olivia.daniels@mishainfotech.com'),
    NULL, 'PRINT-PROOF', NULL, NULL);
  RAISE NOTICE 'claim % comm % %', r.claim_number, r.communication_event_id, r.communication_event_status;
END
$proof$;