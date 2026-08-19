CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_claim_generic(
  p_channel text,
  p_worker text DEFAULT 'omni-comms-dispatch',
  p_batch_limit integer DEFAULT 1,
  p_correlation_id text DEFAULT NULL,
  p_deployed_revision text DEFAULT NULL,
  p_execution_context text DEFAULT 'scheduler'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_channel text := lower(btrim(coalesce(p_channel,'')));
  v_limit integer;
  v_worker text := left(coalesce(nullif(btrim(p_worker),''),'omni-comms-dispatch'),120);
  v_corr text := left(coalesce(p_correlation_id,''),120);
  v_ctx text := lower(coalesce(nullif(btrim(p_execution_context),''),'scheduler'));
  v_job record;
  v_rel public.omni_comms_channel_release_control;
  v_cert jsonb;
  v_decision jsonb;
  v_norm jsonb;
  v_hash text;
  v_hour int; v_day int; v_total int;
  v_claims jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_scanned int := 0;
  v_claimed int := 0;
  v_deny text;
  v_tok text; v_attempt_id uuid; v_attempt_no int; v_idem text;
  v_identity public.omni_comms_sender_identity%ROWTYPE;
  v_account public.omni_comms_provider_account%ROWTYPE;
  v_endpoint public.omni_comms_channel_endpoint%ROWTYPE;
  v_provider_code text;
  v_expect_provider text;
  v_target text;
  v_devices jsonb := '[]'::jsonb;
  v_resolved jsonb;
  v_from text;
  v_sid_ref text; v_token_ref text; v_secret_ref text; v_sign_ref text;
  v_storage_mode text;
  v_callback text;
  v_extra jsonb;
BEGIN
  IF v_channel NOT IN ('push','webhook','voice') THEN
    RAISE EXCEPTION 'OC422 channel_not_supported_by_generic_claim' USING ERRCODE='P0001';
  END IF;
  IF v_ctx NOT IN ('operator','scheduler') THEN
    RAISE EXCEPTION 'OC422 invalid_execution_context' USING ERRCODE='P0001';
  END IF;
  IF p_batch_limit IS NULL THEN v_limit := 1;
  ELSIF p_batch_limit < 1 OR p_batch_limit > 10 THEN
    RAISE EXCEPTION 'OC422 invalid_batch_limit' USING ERRCODE='P0001';
  ELSE v_limit := p_batch_limit; END IF;

  v_expect_provider := CASE v_channel WHEN 'push' THEN 'firebase_push'
                                      WHEN 'webhook' THEN 'outbound_webhook'
                                      ELSE 'twilio_voice' END;

  v_cert := public.omni_comms_priv_certification_posture();

  SELECT endpoint_url INTO v_callback
    FROM public.omni_comms_runtime_endpoint WHERE endpoint_key = 'twilio_status_callback';

  FOR v_job IN
    SELECT j.*, m.recipient_id, m.rendered_text, m.rendered_subject,
           m.sender_identity_id, m.provider_account_id AS msg_provider_account_id,
           m.department_id AS msg_department_id, m.status AS message_status,
           m.channel_setting_snapshot, m.destination_snapshot, m.template_version_id,
           r.caller_module_code, r.payload_snapshot, ed.code AS event_code
      FROM public.omni_comms_dispatch_job j
      JOIN public.omni_comms_message m ON m.id = j.message_id
      JOIN public.omni_comms_request r ON r.id = j.request_id
      JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
     WHERE j.channel = v_channel
       AND j.mode = 'queued'
       AND j.attempt_count < 3
       AND coalesce(j.next_attempt_at, now()) <= now()
       AND (
         (j.status = 'held' AND m.status IN ('held','queued'))
         OR (j.status = 'retry_wait' AND m.status = 'dispatching')
       )
     ORDER BY j.priority, j.created_at
     LIMIT greatest(v_limit * 5, 25)
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    EXIT WHEN v_claimed >= v_limit;
    v_scanned := v_scanned + 1;
    v_deny := NULL; v_norm := NULL; v_hash := NULL; v_target := NULL;
    v_devices := '[]'::jsonb; v_extra := '{}'::jsonb;
    v_identity := NULL; v_account := NULL; v_endpoint := NULL;
    v_sid_ref := NULL; v_token_ref := NULL; v_secret_ref := NULL; v_sign_ref := NULL;
    v_from := NULL; v_provider_code := NULL;

    v_rel := public.omni_comms_priv_channel_release_effective(
               v_job.organization_id, v_job.msg_department_id, v_channel);
    IF v_rel.id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object('job_id', v_job.id, 'code', 'release_control_missing');
      CONTINUE;
    END IF;
    SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = v_rel.id FOR UPDATE;

    IF v_job.release_control_id IS NULL OR v_job.release_fingerprint_at_decision IS NULL THEN
      v_deny := 'release_snapshot_missing';
    ELSIF v_job.release_control_id IS DISTINCT FROM v_rel.id
       OR v_job.release_version_at_decision IS DISTINCT FROM v_rel.release_version
       OR v_job.release_state_at_decision IS DISTINCT FROM v_rel.release_state THEN
      v_deny := 'release_snapshot_stale';
    ELSIF v_job.release_fingerprint_at_decision IS DISTINCT FROM v_rel.release_fingerprint THEN
      v_deny := 'release_fingerprint_mismatch';
    ELSIF v_job.release_expires_at_decision IS NOT NULL
      AND v_job.release_expires_at_decision <= now() THEN
      v_deny := 'release_expired';
    END IF;

    -- Destination resolution ---------------------------------------------------
    IF v_deny IS NULL THEN
      IF v_channel = 'voice' THEN
        SELECT rc.phone_destination INTO v_target
          FROM public.omni_comms_recipient rc WHERE rc.id = v_job.recipient_id;
        v_norm := public.omni_comms_priv_channel_test_normalize_target('voice', coalesce(v_target,''));
        IF coalesce((v_norm->>'valid')::boolean,false) IS NOT TRUE THEN
          v_deny := coalesce(v_norm->>'code','recipient_invalid');
        ELSE
          v_hash := lower(v_norm->>'target_hash');
          v_target := regexp_replace(coalesce(v_target,''), '[\s()\-\.]', '', 'g');
        END IF;

      ELSIF v_channel = 'push' THEN
        v_resolved := public.omni_comms_priv_resolve_push_devices(
                        v_job.organization_id, v_job.recipient_id);
        IF coalesce((v_resolved->>'resolved')::boolean,false) IS NOT TRUE THEN
          v_deny := coalesce(v_resolved->>'code','push_no_active_device');
        ELSE
          v_devices := v_resolved->'devices';
          v_norm := public.omni_comms_priv_channel_test_normalize_target(
                      'push', coalesce(v_devices->0->>'token',''));
          IF coalesce((v_norm->>'valid')::boolean,false) IS NOT TRUE THEN
            v_deny := coalesce(v_norm->>'code','target_invalid_device_token');
          ELSE
            v_hash := lower(v_norm->>'target_hash');
          END IF;
        END IF;

      ELSE -- webhook
        SELECT * INTO v_endpoint
          FROM public.omni_comms_channel_endpoint e
         WHERE e.organization_id = v_job.organization_id
           AND e.channel = 'webhook'
           AND e.status = 'active'
           AND coalesce(e.data_origin,'') <> 'reference_seed'
           AND (e.department_id IS NOT DISTINCT FROM v_job.msg_department_id
                OR e.department_id IS NULL)
         ORDER BY (e.department_id IS NOT NULL) DESC, e.created_at
         LIMIT 1;
        IF v_endpoint.id IS NULL THEN
          v_deny := 'webhook_endpoint_not_configured';
        ELSE
          v_target := btrim(coalesce(v_endpoint.endpoint_config ->> 'url',''));
          v_norm := public.omni_comms_priv_channel_test_normalize_target('webhook', v_target);
          IF coalesce((v_norm->>'valid')::boolean,false) IS NOT TRUE THEN
            v_deny := coalesce(v_norm->>'code','webhook_endpoint_url_invalid');
          ELSE
            v_hash := lower(v_norm->>'target_hash');
            v_sign_ref := btrim(coalesce(v_endpoint.endpoint_config ->> 'signing_secret_ref',''));
            IF v_sign_ref !~ '^OMNI_COMMS_WEBHOOK_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
              v_deny := 'webhook_signing_secret_reference_invalid';
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_deny IS NULL THEN
      v_decision := public.omni_comms_priv_channel_release_decision(
        v_job.organization_id, v_job.msg_department_id, v_channel,
        v_job.event_code, v_job.caller_module_code, 'queued',
        ARRAY[v_hash], 1, p_deployed_revision);
      IF coalesce((v_decision->>'allowed')::boolean,false) IS NOT TRUE THEN
        v_deny := coalesce(v_decision->>'code','release_denied');
      ELSIF coalesce((v_decision->>'business_dispatch_enabled')::boolean,false) IS NOT TRUE THEN
        v_deny := 'business_dispatch_disabled';
      ELSIF coalesce((v_decision->>'recipient_rules_satisfied')::boolean,false) IS NOT TRUE THEN
        v_deny := 'recipient_not_permitted';
      END IF;
    END IF;

    IF v_deny IS NULL AND coalesce((v_cert->>'effective_certified')::boolean,false) IS NOT TRUE THEN
      v_deny := 'certification_not_effective';
    END IF;

    IF v_deny IS NULL THEN
      SELECT count(*) INTO v_hour FROM public.omni_comms_delivery_attempt a
       WHERE a.release_control_id = v_rel.id AND a.created_at > now() - interval '1 hour';
      SELECT count(*) INTO v_day FROM public.omni_comms_delivery_attempt a
       WHERE a.release_control_id = v_rel.id AND a.created_at > now() - interval '1 day';
      SELECT count(DISTINCT a.message_id) INTO v_total FROM public.omni_comms_delivery_attempt a
       WHERE a.release_control_id = v_rel.id;
      IF v_rel.max_messages_per_hour IS NULL OR v_rel.max_messages_per_day IS NULL THEN
        v_deny := 'volume_integrity_failure';
      ELSIF v_hour + 1 > v_rel.max_messages_per_hour
         OR v_day + 1 > v_rel.max_messages_per_day
         OR (NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a
                          WHERE a.release_control_id = v_rel.id AND a.message_id = v_job.message_id)
             AND v_rel.max_messages_total IS NOT NULL AND v_total + 1 > v_rel.max_messages_total) THEN
        v_deny := 'release_limit_exceeded';
      END IF;
    END IF;

    -- Provider account resolution -----------------------------------------------
    IF v_deny IS NULL THEN
      IF v_job.msg_provider_account_id IS NOT NULL THEN
        SELECT * INTO v_account FROM public.omni_comms_provider_account
         WHERE id = v_job.msg_provider_account_id;
      ELSE
        SELECT pa.* INTO v_account
          FROM public.omni_comms_provider_account pa
          JOIN public.omni_comms_provider p ON p.id = pa.provider_id
         WHERE pa.organization_id = v_job.organization_id
           AND pa.status = 'active'
           AND coalesce(pa.data_origin,'') <> 'reference_seed'
           AND p.code = v_expect_provider
         ORDER BY pa.created_at
         LIMIT 1;
      END IF;

      IF v_account.id IS NULL THEN
        v_deny := 'provider_account_not_operational';
      ELSE
        SELECT p.code INTO v_provider_code
          FROM public.omni_comms_provider p WHERE p.id = v_account.provider_id;
        IF v_account.status <> 'active'
           OR coalesce(v_account.data_origin,'') = 'reference_seed'
           OR v_account.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'provider_account_not_operational';
        ELSIF coalesce(v_provider_code,'') <> v_expect_provider THEN
          v_deny := 'provider_not_supported';
        ELSIF NOT public.omni_comms_provider_credential_send_ready(
                v_account.verification_status, v_account.verification_result_code) THEN
          v_deny := 'provider_account_not_verified';
        END IF;
      END IF;
    END IF;

    -- Channel-specific credential + identity requirements -------------------------
    IF v_deny IS NULL AND v_channel = 'voice' THEN
      IF v_job.sender_identity_id IS NULL THEN
        v_deny := 'resolution_snapshot_incomplete';
      ELSE
        SELECT * INTO v_identity FROM public.omni_comms_sender_identity
         WHERE id = v_job.sender_identity_id;
        v_from := nullif(btrim(coalesce(v_identity.identity_config ->> 'caller_number','')),'');
        IF v_identity.id IS NULL OR v_identity.status <> 'active'
           OR coalesce(v_identity.channel,'') <> 'voice'
           OR coalesce(v_identity.data_origin,'') = 'reference_seed' THEN
          v_deny := 'identity_not_operational';
        ELSIF v_identity.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'identity_tenant_mismatch';
        ELSIF v_from IS NULL OR v_from !~ '^\+[1-9][0-9]{6,14}$' THEN
          v_deny := 'sender_caller_number_invalid';
        END IF;
      END IF;

      IF v_deny IS NULL THEN
        SELECT s.secret_ref, s.storage_mode INTO v_sid_ref, v_storage_mode
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = 'account_sid' LIMIT 1;
        SELECT s.secret_ref INTO v_token_ref
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = 'auth_token' LIMIT 1;
        IF coalesce(v_sid_ref,'') !~ '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$'
           OR coalesce(v_token_ref,'') !~ '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
          v_deny := 'secret_reference_invalid';
        END IF;
      END IF;
    END IF;

    IF v_deny IS NULL AND v_channel = 'push' THEN
      SELECT s.secret_ref, s.storage_mode INTO v_secret_ref, v_storage_mode
        FROM public.omni_comms_provider_account_secret_ref s
       WHERE s.provider_account_id = v_account.id AND s.purpose = 'service_account' LIMIT 1;
      IF coalesce(v_secret_ref,'') !~ '^OMNI_COMMS_FCM_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
        v_deny := 'secret_reference_invalid';
      END IF;
    END IF;

    IF v_deny IS NOT NULL THEN
      PERFORM public.omni_comms_priv_dispatch_claim_safety_suspend(v_rel.id, v_deny, v_job.id);
      UPDATE public.omni_comms_dispatch_job
         SET hold_reason = left(v_deny,200), is_runnable = false,
             next_attempt_at = greatest(coalesce(next_attempt_at, now()), now()) + interval '1 minute',
             updated_at = now()
       WHERE id = v_job.id;
      v_blockers := v_blockers || jsonb_build_object('job_id', v_job.id, 'code', v_deny);
      CONTINUE;
    END IF;

    v_tok := encode(extensions.gen_random_bytes(24),'hex');
    v_attempt_no := v_job.attempt_count + 1;
    v_idem := 'omni-comms/' || v_channel || '/' || v_job.message_id::text;

    UPDATE public.omni_comms_dispatch_job
       SET status='ready', is_runnable=true, hold_reason=NULL, updated_at=now() WHERE id = v_job.id;
    UPDATE public.omni_comms_dispatch_job
       SET status='leased', lock_token=v_tok, locked_at=now(), locked_by=v_worker,
           lease_expires_at = now() + interval '2 minutes', attempt_count = v_attempt_no,
           updated_at=now() WHERE id = v_job.id;
    UPDATE public.omni_comms_dispatch_job SET status='processing', updated_at=now() WHERE id = v_job.id;

    IF v_job.message_status IN ('held','queued') THEN
      IF v_job.message_status = 'held' THEN
        UPDATE public.omni_comms_message SET status='queued', updated_at=now() WHERE id = v_job.message_id;
      END IF;
      UPDATE public.omni_comms_message SET status='dispatching', updated_at=now() WHERE id = v_job.message_id;
    END IF;

    INSERT INTO public.omni_comms_delivery_attempt (
      dispatch_job_id, message_id, organization_id, provider_id, provider_account_id,
      attempt_number, status, started_at, claim_token, claimed_at, lease_expires_at,
      worker_id, provider_idempotency_key, release_control_id,
      release_version_at_claim, release_state_at_claim, release_fingerprint_at_claim,
      release_expires_at_claim, certified_commit_at_claim, deployed_revision_at_claim,
      recipient_hash, recipient_rule_matched, execution_context,
      claim_decision_snapshot, safe_request_metadata
    ) VALUES (
      v_job.id, v_job.message_id, v_job.organization_id, v_account.provider_id, v_account.id,
      v_attempt_no, 'dispatching', now(), v_tok, now(), now() + interval '2 minutes',
      v_worker, v_idem, v_rel.id,
      v_rel.release_version, v_rel.release_state, v_rel.release_fingerprint, v_rel.release_expires_at,
      lower(coalesce(v_cert->>'certified_commit','')), lower(coalesce(p_deployed_revision,'')),
      v_hash, true, v_ctx,
      jsonb_build_object('code', v_decision->>'code',
                         'release_version', v_rel.release_version,
                         'release_state', v_rel.release_state),
      jsonb_build_object('channel', v_channel, 'mode','queued',
                         'event_code', v_job.event_code,
                         'caller_module_code', v_job.caller_module_code,
                         'recipient_masked', v_norm->>'target_masked',
                         'device_count', jsonb_array_length(v_devices),
                         'correlation_id', nullif(v_corr,''))
    ) RETURNING id INTO v_attempt_id;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      safe_metadata, correlation_id, actor_type, actor_id)
    SELECT v_job.request_id, v_job.message_id, v_job.organization_id, t.et,
           public.omni_comms_priv_next_event_sequence(v_job.request_id),
           jsonb_build_object('attempt_number', v_attempt_no, 'channel', v_channel,
                              'execution_context', v_ctx, 'worker', v_worker),
           nullif(v_corr,''), 'system', 'omni-comms-dispatch'
      FROM unnest(ARRAY['dispatch_ready','dispatch_claimed','provider_attempt_started']) WITH ORDINALITY AS t(et, ord)
     ORDER BY t.ord;

    v_extra := CASE v_channel
      WHEN 'push' THEN jsonb_build_object(
        'service_account_ref', v_secret_ref,
        'devices', v_devices,
        'title', coalesce(v_job.rendered_subject, ''),
        'body', coalesce(v_job.rendered_text, ''),
        'image_url', v_job.channel_setting_snapshot ->> 'image_url',
        'action_url', v_job.channel_setting_snapshot ->> 'action_url',
        'collapse_key', v_job.channel_setting_snapshot ->> 'collapse_key',
        'priority', coalesce(v_job.channel_setting_snapshot ->> 'priority', 'high'),
        'ttl_seconds', v_job.channel_setting_snapshot ->> 'ttl_seconds')
      WHEN 'webhook' THEN jsonb_build_object(
        'endpoint_id', v_endpoint.id,
        'endpoint_url', v_target,
        'http_method', upper(coalesce(v_endpoint.endpoint_config ->> 'method','POST')),
        'timeout_ms', coalesce((v_endpoint.endpoint_config ->> 'timeout_ms')::int, 10000),
        'signing_secret_ref', v_sign_ref,
        'custom_headers', coalesce(v_endpoint.endpoint_config -> 'headers', '{}'::jsonb),
        'schema_version', coalesce(v_job.channel_setting_snapshot ->> 'schema_version','1.0'),
        'payload', coalesce(v_job.rendered_text, '{}'))
      ELSE jsonb_build_object(
        'account_sid_ref', v_sid_ref,
        'auth_token_ref', v_token_ref,
        'from_number', v_from,
        'recipient', v_target,
        'script', coalesce(v_job.rendered_text, ''),
        'language', coalesce(v_job.channel_setting_snapshot ->> 'language','en-US'),
        'voice_name', v_job.channel_setting_snapshot ->> 'voice_name',
        'audio_url', v_job.channel_setting_snapshot ->> 'audio_url',
        'gather_digits', v_job.channel_setting_snapshot ->> 'gather_digits',
        'gather_prompt', v_job.channel_setting_snapshot ->> 'gather_prompt',
        'status_callback_url', v_callback)
    END;

    v_claimed := v_claimed + 1;
    v_claims := v_claims || (jsonb_build_object(
      'channel', v_channel,
      'attempt_id', v_attempt_id,
      'claim_token', v_tok,
      'attempt_number', v_attempt_no,
      'message_id', v_job.message_id,
      'credential_storage_mode', coalesce(v_storage_mode,'edge_env'),
      'provider_idempotency_key', v_idem,
      'lease_expires_at', now() + interval '2 minutes') || v_extra);
  END LOOP;

  RETURN jsonb_build_object(
    'channel', v_channel,
    'scanned_jobs', v_scanned,
    'claimed_jobs', v_claimed,
    'execution_context', v_ctx,
    'claims', v_claims,
    'blockers', v_blockers,
    'blocker', NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_generic(text,text,integer,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_claim_generic(text,text,integer,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(
  p_worker text, p_batch_limit integer, p_deployed_revision text, p_correlation_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_in_app jsonb;
  v_wa jsonb;
  v_claims jsonb;
  v_scanned int;
  v_claimed int;
  v_blocker_count int;
  v_raw_blocker text;
  v_blocker text;
  v_extra jsonb := '{}'::jsonb;
  v_one jsonb;
  v_ch text;
BEGIN
  v_result := public.omni_comms_priv_dispatch_claim_email(
    p_worker, p_batch_limit, p_correlation_id, p_deployed_revision, NULL, 'scheduler');

  v_scanned := coalesce((v_result->>'scanned_jobs')::int, 0);
  v_claimed := coalesce((v_result->>'claimed_jobs')::int, 0);
  v_blocker_count := jsonb_array_length(coalesce(v_result->'blockers', '[]'::jsonb));
  v_raw_blocker := nullif(v_result->>'blocker', '');

  v_blocker := CASE
    WHEN v_scanned = 0 AND v_claimed = 0 AND v_blocker_count = 0 THEN NULL
    ELSE v_raw_blocker
  END;

  INSERT INTO public.omni_comms_scheduler_run (
    worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
  VALUES (
    left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', 'email',
    v_scanned, v_claimed, v_blocker,
    jsonb_build_object(
      'blocker_count', v_blocker_count,
      'jobs_claimed', v_claimed,
      'zero_work', (v_scanned = 0 AND v_claimed = 0),
      'raw_blocker', v_raw_blocker));

  v_claims := (
    SELECT coalesce(jsonb_agg(c || jsonb_build_object('channel','email')), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_result->'claims','[]'::jsonb)) AS c);

  v_in_app := public.omni_comms_priv_dispatch_deliver_in_app(
    coalesce(p_worker,'omni-comms-scheduler'), greatest(coalesce(p_batch_limit,5),1), p_correlation_id);

  INSERT INTO public.omni_comms_scheduler_run (
    worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
  VALUES (
    left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', 'in_app',
    coalesce((v_in_app->>'scanned_jobs')::int,0),
    coalesce((v_in_app->>'delivered')::int,0),
    CASE WHEN coalesce((v_in_app->>'blocked')::int,0) > 0 THEN 'in_app_blocked' ELSE NULL END,
    v_in_app);

  v_wa := public.omni_comms_priv_dispatch_claim_whatsapp(
    coalesce(p_worker,'omni-comms-scheduler'), greatest(least(coalesce(p_batch_limit,1),10),1),
    p_correlation_id, p_deployed_revision, 'scheduler');

  INSERT INTO public.omni_comms_scheduler_run (
    worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
  VALUES (
    left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', 'whatsapp',
    coalesce((v_wa->>'scanned_jobs')::int,0),
    coalesce((v_wa->>'claimed_jobs')::int,0),
    nullif(v_wa->>'blocker',''),
    jsonb_build_object('blocker_count', jsonb_array_length(coalesce(v_wa->'blockers','[]'::jsonb))));

  v_claims := v_claims || (
    SELECT coalesce(jsonb_agg(c || jsonb_build_object('channel','whatsapp')), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_wa->'claims','[]'::jsonb)) AS c);

  -- Push / Webhook / Voice share the generic claim contract.
  FOREACH v_ch IN ARRAY ARRAY['push','webhook','voice'] LOOP
    v_one := public.omni_comms_priv_dispatch_claim_generic(
      v_ch, coalesce(p_worker,'omni-comms-scheduler'),
      greatest(least(coalesce(p_batch_limit,1),10),1),
      p_correlation_id, p_deployed_revision, 'scheduler');

    INSERT INTO public.omni_comms_scheduler_run (
      worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
    VALUES (
      left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', v_ch,
      coalesce((v_one->>'scanned_jobs')::int,0),
      coalesce((v_one->>'claimed_jobs')::int,0),
      nullif(v_one->>'blocker',''),
      jsonb_build_object('blocker_count', jsonb_array_length(coalesce(v_one->'blockers','[]'::jsonb))));

    v_claims := v_claims || coalesce(v_one->'claims','[]'::jsonb);
    v_extra := v_extra || jsonb_build_object(v_ch, v_one);
  END LOOP;

  RETURN v_result
    || jsonb_build_object('claims', v_claims, 'in_app', v_in_app, 'whatsapp', v_wa)
    || v_extra;
END;
$function$;