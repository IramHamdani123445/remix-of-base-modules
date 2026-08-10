-- Omni-Comms controlled Email pilot switch:
-- Employer Registration → Benefits claim registration.

-- 1) Employer registration: withdraw queued authorisation (keep evaluation modes).
UPDATE public.omni_comms_producer_event_binding
SET allowed_modes = ARRAY['dry_run','shadow']::text[],
    lifecycle_reason = 'Queued pilot switched to Benefits claim registration acknowledgement.',
    integration_reference = 'useEmployerRegistrationSubmit (shadow only)',
    updated_at = now()
WHERE id = '8c0f7e05-11a3-4c0a-a01c-66217c986356';

-- 2) Benefits claim registration: single queued pilot binding, department scoped.
INSERT INTO public.omni_comms_producer_event_binding (
  organization_id, department_id, caller_module_code, event_definition_id,
  allowed_modes, status, integration_reference, lifecycle_reason, activated_at
)
SELECT
  '69afc88b-da5c-4f41-a1e7-199e1ee1d416'::uuid,
  'c28f40f8-00db-4766-b211-5bda5dd641a9'::uuid,
  'BENEFITS',
  d.id,
  ARRAY['queued']::text[],
  'active',
  'claimIntakeService.submitClaimApplication',
  'Controlled production Email pilot: claimant acknowledgement on claim registration (held jobs only).',
  now()
FROM public.omni_comms_event_definition d
WHERE d.code = 'BENEFITS.CLAIM.SUBMITTED'
  AND NOT EXISTS (
    SELECT 1 FROM public.omni_comms_producer_event_binding b
    WHERE b.organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416'::uuid
      AND b.caller_module_code = 'BENEFITS'
      AND b.event_definition_id = d.id
  );

-- 3) Safety: exactly one active binding may permit queued.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM public.omni_comms_producer_event_binding
  WHERE status = 'active' AND 'queued' = ANY (allowed_modes);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 active queued binding, found %', v_n;
  END IF;
END $$;