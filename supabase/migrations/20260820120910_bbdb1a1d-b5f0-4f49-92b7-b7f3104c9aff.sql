DO $mig$
DECLARE
  d text;
  o text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_priv_dispatch_claim_generic';
  o := d;

  d := replace(d,
    'IF v_channel NOT IN (''push'',''webhook'',''voice'') THEN',
    'IF v_channel NOT IN (''push'',''webhook'',''voice'',''sms'') THEN');

  d := replace(d,
    'WHEN ''webhook'' THEN ''outbound_webhook''',
    'WHEN ''webhook'' THEN ''outbound_webhook'' WHEN ''sms'' THEN ''twilio_sms''');

  d := replace(d,
    'IF v_channel = ''voice'' THEN
        SELECT rc.phone_destination INTO v_target
          FROM public.omni_comms_recipient rc WHERE rc.id = v_job.recipient_id;
        v_norm := public.omni_comms_priv_channel_test_normalize_target(''voice'', coalesce(v_target,''''));',
    'IF v_channel IN (''voice'',''sms'') THEN
        SELECT rc.phone_destination INTO v_target
          FROM public.omni_comms_recipient rc WHERE rc.id = v_job.recipient_id;
        v_norm := public.omni_comms_priv_channel_test_normalize_target(v_channel, coalesce(v_target,''''));');

  d := replace(d,
    'IF v_deny IS NULL AND v_channel = ''push'' THEN',
    'IF v_deny IS NULL AND v_channel = ''sms'' THEN
      IF v_job.sender_identity_id IS NULL THEN
        v_deny := ''resolution_snapshot_incomplete'';
      ELSE
        SELECT * INTO v_identity FROM public.omni_comms_sender_identity
         WHERE id = v_job.sender_identity_id;
        v_from := coalesce(
          nullif(btrim(coalesce(v_identity.identity_config ->> ''sender_number'','''')),''''),
          nullif(btrim(coalesce(v_identity.identity_config ->> ''sender_id'','''')),''''));
        IF v_identity.id IS NULL OR v_identity.status <> ''active''
           OR coalesce(v_identity.channel,'''') <> ''sms''
           OR coalesce(v_identity.data_origin,'''') = ''reference_seed'' THEN
          v_deny := ''identity_not_operational'';
        ELSIF v_identity.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := ''identity_tenant_mismatch'';
        END IF;
      END IF;

      IF v_deny IS NULL THEN
        SELECT s.secret_ref, s.storage_mode INTO v_sid_ref, v_storage_mode
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = ''account_sid'' LIMIT 1;
        SELECT s.secret_ref INTO v_token_ref
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = ''auth_token'' LIMIT 1;
        SELECT s.secret_ref INTO v_secret_ref
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = ''messaging_service_sid'' LIMIT 1;
        IF coalesce(v_sid_ref,'''') !~ ''^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$''
           OR coalesce(v_token_ref,'''') !~ ''^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$''
           OR (v_secret_ref IS NOT NULL
               AND v_secret_ref !~ ''^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$'') THEN
          v_deny := ''secret_reference_invalid'';
        ELSIF v_from IS NULL AND v_secret_ref IS NULL THEN
          v_deny := ''sms_sender_not_configured'';
        END IF;
      END IF;
    END IF;

    IF v_deny IS NULL AND v_channel = ''push'' THEN');

  d := replace(d,
    'WHEN ''webhook'' THEN jsonb_build_object(',
    'WHEN ''sms'' THEN jsonb_build_object(
        ''account_sid_ref'', v_sid_ref,
        ''auth_token_ref'', v_token_ref,
        ''messaging_service_secret_ref'', v_secret_ref,
        ''from_number'', v_from,
        ''recipient'', v_target,
        ''body'', coalesce(v_job.rendered_text, ''''),
        ''status_callback_url'', v_callback)
      WHEN ''webhook'' THEN jsonb_build_object(');

  IF d = o THEN
    RAISE EXCEPTION 'sms_claim_patch_no_change';
  END IF;
  EXECUTE d;

  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_priv_dispatch_scheduler_tick';
  o := d;
  d := replace(d,
    'ARRAY[''push'',''webhook'',''voice'']',
    'ARRAY[''sms'',''push'',''webhook'',''voice'']');
  IF d = o THEN
    RAISE EXCEPTION 'sms_scheduler_patch_no_change';
  END IF;
  EXECUTE d;
END
$mig$;