-- Omni-Comms Step 3 — controlled production pilot producer verifier
-- (Benefits claim registration).
--
-- Read-only. Proves that EXACTLY ONE active producer-event binding permits
-- `queued`, that it is the Benefits claim-registration acknowledgement, that
-- its Email route, template family and published template version exist, and
-- that Employer Registration can no longer queue anything. Contacts no
-- provider and changes nothing.

\echo '== Step 3: queued producer authorisation =='

DO $$
DECLARE
  v_total   int;
  v_binding record;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.omni_comms_producer_event_binding b
  WHERE b.status = 'active' AND 'queued' = ANY (b.allowed_modes);

  IF v_total <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 1 active queued binding, found %', v_total;
  END IF;

  SELECT b.caller_module_code, d.code AS event_code, b.organization_id, b.department_id
    INTO v_binding
  FROM public.omni_comms_producer_event_binding b
  JOIN public.omni_comms_event_definition d ON d.id = b.event_definition_id
  WHERE b.status = 'active' AND 'queued' = ANY (b.allowed_modes);

  IF v_binding.caller_module_code <> 'BENEFITS'
     OR v_binding.event_code <> 'BENEFITS.CLAIM.SUBMITTED' THEN
    RAISE EXCEPTION 'FAIL: unexpected queued binding % / %',
      v_binding.caller_module_code, v_binding.event_code;
  END IF;

  RAISE NOTICE 'PASS: single queued binding % -> %',
    v_binding.caller_module_code, v_binding.event_code;
END $$;

\echo '== Step 3: employer registration pilot switched off =='

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.omni_comms_producer_event_binding b
  WHERE b.caller_module_code = 'EMPLOYER_REGISTRATION'
    AND b.status = 'active'
    AND 'queued' = ANY (b.allowed_modes);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: employer registration still authorised for queued';
  END IF;
  RAISE NOTICE 'PASS: employer registration cannot queue';
END $$;

\echo '== Step 3: pilot event Email configuration =='

DO $$
DECLARE v_ok int;
BEGIN
  SELECT count(*) INTO v_ok
  FROM public.omni_comms_event_route r
  JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
  JOIN public.omni_comms_template_family tf ON tf.id = r.template_family_id
  JOIN public.omni_comms_template_version tv ON tv.template_family_id = tf.id
  WHERE d.code = 'BENEFITS.CLAIM.SUBMITTED'
    AND d.status = 'active'
    AND r.channel = 'email'
    AND r.lifecycle_state = 'active'
    AND tf.status = 'active'
    AND tv.channel = 'email'
    AND tv.status = 'published'
    AND r.sender_identity_id IS NOT NULL;

  IF v_ok < 1 THEN
    RAISE EXCEPTION 'FAIL: pilot event lacks an active Email route with a published template version';
  END IF;
  RAISE NOTICE 'PASS: pilot Email route, family, published version and sender identity present';
END $$;

\echo '== Step 3: no unrestricted delivery introduced =='

DO $$
DECLARE v_runnable int;
BEGIN
  SELECT count(*) INTO v_runnable
  FROM public.omni_comms_dispatch_job j
  WHERE j.mode = 'queued' AND j.is_runnable IS TRUE;

  IF v_runnable > 0 THEN
    RAISE EXCEPTION 'FAIL: % queued dispatch job(s) are runnable before release authorisation', v_runnable;
  END IF;
  RAISE NOTICE 'PASS: every queued dispatch job is held';
END $$;
