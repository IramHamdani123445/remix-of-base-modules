DO $mig$
DECLARE
  d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.proname = 'bn_submit_claim_application'
    AND p.pronamespace = 'public'::regnamespace
  LIMIT 1;

  IF d IS NULL THEN
    RAISE EXCEPTION 'bn_submit_claim_application not found';
  END IF;

  IF position('postal_address' in d) = 0 THEN
    d := replace(d, '  v_comm JSONB;', '  v_postal JSONB := NULL;' || chr(10) || '  v_comm JSONB;');

    d := replace(
      d,
      '  v_comm := public.omni_comms_priv_enqueue_business_event(',
      '  IF NULLIF(trim(coalesce(v_person.resident_addr1, '''')), '''') IS NOT NULL THEN' || chr(10) ||
      '    v_postal := jsonb_build_object(' || chr(10) ||
      '      ''addressee'', COALESCE(v_claimant_name, ''Claimant''),' || chr(10) ||
      '      ''address_lines'', to_jsonb(ARRAY(SELECT x FROM unnest(ARRAY[v_person.resident_addr1, v_person.resident_addr2]) AS x WHERE NULLIF(trim(x), '''') IS NOT NULL)),' || chr(10) ||
      '      ''locality'', v_person.district,' || chr(10) ||
      '      ''country'', v_person.place_of_residence' || chr(10) ||
      '    );' || chr(10) ||
      '  END IF;' || chr(10) || chr(10) ||
      '  v_comm := public.omni_comms_priv_enqueue_business_event('
    );

    d := replace(
      d,
      '        ''email'', v_claimant_email' || chr(10) || '      )',
      '        ''email'', v_claimant_email,' || chr(10) ||
      '        ''postal_address'', v_postal' || chr(10) || '      )'
    );

    IF position('postal_address' in d) = 0 THEN
      RAISE EXCEPTION 'postal address patch did not apply';
    END IF;

    EXECUTE d;
  END IF;
END
$mig$;

DO $seed$
DECLARE
  v_org uuid;
  v_event uuid;
  v_action uuid;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition
  WHERE code = 'BENEFITS.CLAIM.SUBMITTED' LIMIT 1;

  SELECT organization_id INTO v_org FROM public.omni_comms_communication_action LIMIT 1;

  IF v_event IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'missing event definition or organisation';
  END IF;

  SELECT id INTO v_action FROM public.omni_comms_communication_action
  WHERE event_definition_id = v_event
    AND product_id = 'f5e00001-5555-4000-e000-000000000004'::uuid;

  IF v_action IS NULL THEN
    INSERT INTO public.omni_comms_communication_action (
      organization_id, event_definition_id, product_id, code, name, description,
      recipient_role, obligation, satisfaction_rule, priority, status
    ) VALUES (
      v_org, v_event, 'f5e00001-5555-4000-e000-000000000004'::uuid,
      'CLAIM_RECEIPT_NOTICE', 'Claim receipt notice (Medical Expenses EI)',
      'Product-scoped acknowledgement produced as a printed letter.',
      'claimant', 'required', 'one_of', 100, 'active'
    )
    RETURNING id INTO v_action;
  END IF;

  INSERT INTO public.omni_comms_action_channel_option (
    action_id, channel, rank, is_fallback, template_family_id, status
  )
  SELECT v_action, 'print', 1, false,
         '41e68a2c-bcd9-4f35-a3c5-d2b8f7433260'::uuid, 'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.omni_comms_action_channel_option
    WHERE action_id = v_action AND channel = 'print'
  );
END
$seed$;