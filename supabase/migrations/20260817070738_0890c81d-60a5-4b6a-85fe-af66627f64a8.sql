SELECT public.bn_submit_claim_application(
  '950004', 'SKN-EI-MED', current_date, 'portal',
  '{"notes":"print proof 2","contact_email":"marcus.anderson@mishainfotech.com"}'::jsonb,
  NULL, NULL, NULL, NULL);