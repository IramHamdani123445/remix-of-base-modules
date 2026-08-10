-- Omni-Comms Step 2 — controlled production pilot producer authorisation.
-- Narrow, single-row change: the ONE active binding
-- (EMPLOYER_REGISTRATION -> REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED)
-- gains 'queued'. No new objects, no wildcard, no other module/event/channel.
UPDATE public.omni_comms_producer_event_binding b
SET allowed_modes = ARRAY['dry_run','shadow','queued']::text[],
    integration_reference = 'step2_pilot_employer_registration_application_submitted_queued',
    lifecycle_reason = 'Step 2 controlled production pilot: queued Email emissions permitted. Jobs remain held until Release Control authorises dispatch.',
    updated_at = now()
FROM public.omni_comms_event_definition d
WHERE d.id = b.event_definition_id
  AND b.status = 'active'
  AND b.caller_module_code = 'EMPLOYER_REGISTRATION'
  AND d.code = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.omni_comms_producer_event_binding b
  JOIN public.omni_comms_event_definition d ON d.id = b.event_definition_id
  WHERE b.status = 'active' AND 'queued' = ANY (b.allowed_modes);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Exactly one active queued producer binding expected, found %', v_count;
  END IF;
END $$;