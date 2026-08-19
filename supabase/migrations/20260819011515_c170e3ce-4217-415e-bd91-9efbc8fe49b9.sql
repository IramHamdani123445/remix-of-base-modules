-- 1. Twilio WhatsApp provider (catalogue row only; no credential, no send).
INSERT INTO public.omni_comms_provider (code, display_name, channel, adapter_key, status, data_origin)
VALUES ('twilio_whatsapp', 'Twilio (WhatsApp)', 'whatsapp', 'twilio_whatsapp', 'draft', 'system_seed')
ON CONFLICT (code) DO NOTHING;

UPDATE public.omni_comms_provider
   SET status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
 WHERE code = 'twilio_whatsapp' AND status = 'draft';

-- 2. WhatsApp structured content rules.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_channel_content(p_channel text, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_allowed text[];
  v_required text[];
  v_key text;
  v_val jsonb;
  v_bytes integer;
  v_html text;
  v_text text;
  v_severity text;
  v_action text;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_not_object';
  END IF;
  v_bytes := octet_length(convert_to(p_content::text, 'UTF8'));
  IF v_bytes > 262144 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_too_large';
  END IF;

  CASE p_channel
    WHEN 'email'    THEN v_allowed := ARRAY['subject','html','text','preheader'];
                         v_required := ARRAY['subject'];
    WHEN 'sms'      THEN v_allowed := ARRAY['body'];                v_required := ARRAY['body'];
    WHEN 'in_app'   THEN v_allowed := ARRAY['title','body','severity','category','action_label','action_url'];
                         v_required := ARRAY['title','body'];
    WHEN 'push'     THEN v_allowed := ARRAY['title','body'];        v_required := ARRAY['title','body'];
    WHEN 'whatsapp' THEN v_allowed := ARRAY['header','body','footer','media_url','button_label','button_url','content_sid'];
                         v_required := ARRAY['body'];
    WHEN 'print'    THEN v_allowed := ARRAY['subject','html','text'];v_required := ARRAY['subject'];
    ELSE
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_unknown';
  END CASE;

  FOR v_key IN SELECT k FROM jsonb_object_keys(p_content) k LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_unknown_key';
    END IF;
    v_val := p_content -> v_key;
    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_null_value';
    END IF;
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_non_string_value';
    END IF;
    IF btrim(v_val #>> '{}') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_empty_value';
    END IF;
    PERFORM public.omni_comms_priv_extract_tokens(v_val #>> '{}');
  END LOOP;

  FOR v_key IN SELECT unnest(v_required) LOOP
    IF NOT (p_content ? v_key) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_missing_required_key';
    END IF;
  END LOOP;

  IF p_channel = 'email' THEN
    v_html := p_content ->> 'html';
    v_text := p_content ->> 'text';
    IF COALESCE(btrim(v_html), '') = '' AND COALESCE(btrim(v_text), '') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_email_body_required';
    END IF;
  END IF;

  IF p_channel = 'in_app' THEN
    v_severity := btrim(COALESCE(p_content ->> 'severity', 'info'));
    IF v_severity NOT IN ('info','success','warning','critical') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_severity_invalid';
    END IF;
    v_action := btrim(COALESCE(p_content ->> 'action_url', ''));
    IF v_action <> '' AND v_action !~ '^/[A-Za-z0-9_\-/{}\.\?=&%:]*$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_action_url_invalid';
    END IF;
    IF (p_content ? 'action_label') AND v_action = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_action_url_required';
    END IF;
  END IF;

  IF p_channel = 'whatsapp' THEN
    IF length(btrim(p_content ->> 'body')) > 1024 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_body_too_long';
    END IF;
    IF (p_content ? 'header') AND length(btrim(p_content ->> 'header')) > 60 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_header_too_long';
    END IF;
    IF (p_content ? 'footer') AND length(btrim(p_content ->> 'footer')) > 60 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_footer_too_long';
    END IF;
    IF (p_content ? 'media_url')
       AND btrim(p_content ->> 'media_url') !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-]+$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_media_url_invalid';
    END IF;
    IF (p_content ? 'button_url')
       AND btrim(p_content ->> 'button_url') !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-{}]+$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_button_url_invalid';
    END IF;
    IF (p_content ? 'button_label') AND NOT (p_content ? 'button_url') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_button_url_required';
    END IF;
    -- A provider-approved template reference (Twilio ContentSid) is bounded.
    IF (p_content ? 'content_sid')
       AND btrim(p_content ->> 'content_sid') !~ '^HX[0-9a-fA-F]{32}$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_whatsapp_content_sid_invalid';
    END IF;
  END IF;
END;
$fn$;

-- 3. Governed WhatsApp business claim. Mirrors the Email claim transaction:
--    the Release Control row is locked, every gate is re-enforced, and the
--    delivery attempt is written BEFORE any provider call.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_claim_whatsapp(
  p_worker text DEFAULT 'omni-comms-dispatch',
  p_batch_limit integer DEFAULT 1,
  p_correlation_id text DEFAULT NULL,
  p_deployed_revision text DEFAULT NULL,
  p_execution_context text DEFAULT 'scheduler'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_limit integer;
  v_worker text := left(coalesce(nullif(btrim(p_worker),''),'omni-comms-dispatch'),120);
  v_corr text := left(coalesce(p_correlation_id,''),120);
  v_ctx text := lower(coalesce(nullif(btrim(p_execution_context),''),'scheduler'));
  v_job record;
  v_rel public.omni_comms_channel_release_control;
  v_cert jsonb;
  v_decision jsonb;
  v_recipient text;
  v_norm jsonb;
  v_hash text;
  v_hour int; v_day int; v_total int;
  v_claims jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_scanned int := 0;
  v_claimed int := 0;
  v_identity public.omni_comms_sender_identity%ROWTYPE;
  v_account public.omni_comms_provider_account%ROWTYPE;
  v_binding public.omni_comms_sender_provider_binding%ROWTYPE;
  v_provider_code text;
  v_sid_ref text; v_token_ref text; v_svc_ref text; v_storage_mode text;
  v_deny text;
  v_tok text; v_attempt_id uuid; v_attempt_no int; v_idem text;
  v_from text;
BEGIN
  IF v_ctx NOT IN ('operator','scheduler') THEN
    RAISE EXCEPTION 'OC422 invalid_execution_context' USING ERRCODE='P0001';
  END IF;
  IF p_batch_limit IS NULL THEN v_limit := 1;
  ELSIF p_batch_limit < 1 OR p_batch_limit > 10 THEN
    RAISE EXCEPTION 'OC422 invalid_batch_limit' USING ERRCODE='P0001';
  ELSE v_limit := p_batch_limit; END IF;

  v_cert := public.omni_comms_priv_certification_posture();

  FOR v_job IN
    SELECT j.*, m.recipient_id, m.rendered_text, m.rendered_subject,
           m.sender_identity_id, m.provider_id AS msg_provider_id,
           m.provider_account_id AS msg_provider_account_id,
           m.department_id AS msg_department_id, m.status AS message_status,
           m.channel_setting_snapshot, m.destination_snapshot,
           r.caller_module_code, ed.code AS event_code
      FROM public.omni_comms_dispatch_job j
      JOIN public.omni_comms_message m ON m.id = j.message_id
      JOIN public.omni_comms_request r ON r.id = j.request_id
      JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
     WHERE j.channel = 'whatsapp'
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
    v_deny := NULL; v_norm := NULL; v_hash := NULL;

    v_rel := public.omni_comms_priv_channel_release_effective(
               v_job.organization_id, v_job.msg_department_id, 'whatsapp');
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

    IF v_deny IS NULL THEN
      SELECT rc.phone_destination INTO v_recipient
        FROM public.omni_comms_recipient rc WHERE rc.id = v_job.recipient_id;
      v_norm := public.omni_comms_priv_channel_test_normalize_target('whatsapp', coalesce(v_recipient,''));
      IF coalesce((v_norm->>'valid')::boolean,false) IS NOT TRUE THEN
        v_deny := coalesce(v_norm->>'code','recipient_invalid');
      ELSE
        v_hash := lower(v_norm->>'target_hash');
      END IF;
    END IF;

    IF v_deny IS NULL THEN
      v_decision := public.omni_comms_priv_channel_release_decision(
        v_job.organization_id, v_job.msg_department_id, 'whatsapp',
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

    IF v_deny IS NULL THEN
      IF coalesce((v_cert->>'effective_certified')::boolean,false) IS NOT TRUE THEN
        v_deny := 'certification_not_effective';
      END IF;
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

    -- Exact persisted provider resolution. No fallback, no substitution.
    IF v_deny IS NULL THEN
      v_identity := NULL; v_account := NULL; v_binding := NULL;
      v_sid_ref := NULL; v_token_ref := NULL; v_svc_ref := NULL; v_provider_code := NULL;

      IF v_job.sender_identity_id IS NULL OR v_job.msg_provider_account_id IS NULL THEN
        v_deny := 'resolution_snapshot_incomplete';
      ELSE
        SELECT * INTO v_identity FROM public.omni_comms_sender_identity WHERE id = v_job.sender_identity_id;
        SELECT * INTO v_account FROM public.omni_comms_provider_account WHERE id = v_job.msg_provider_account_id;
        SELECT * INTO v_binding FROM public.omni_comms_sender_provider_binding b
          WHERE b.sender_identity_id = v_job.sender_identity_id
            AND b.provider_account_id = v_job.msg_provider_account_id
            AND b.status = 'active'
            AND coalesce(b.data_origin,'') <> 'reference_seed'
          ORDER BY b.priority NULLS LAST, b.created_at LIMIT 1;
        SELECT p.code INTO v_provider_code FROM public.omni_comms_provider p WHERE p.id = v_account.provider_id;
        SELECT s.secret_ref, s.storage_mode INTO v_sid_ref, v_storage_mode
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = 'account_sid' LIMIT 1;
        SELECT s.secret_ref INTO v_token_ref
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = 'auth_token' LIMIT 1;
        SELECT s.secret_ref INTO v_svc_ref
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = 'messaging_service_sid' LIMIT 1;

        v_from := nullif(btrim(coalesce(v_identity.identity_config ->> 'business_number','')),'');

        IF v_identity.id IS NULL OR v_identity.status <> 'active'
           OR coalesce(v_identity.data_origin,'') = 'reference_seed'
           OR coalesce(v_identity.channel,'') <> 'whatsapp' THEN
          v_deny := 'identity_not_operational';
        ELSIF v_identity.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'identity_tenant_mismatch';
        ELSIF coalesce(v_identity.identity_type,'') <> 'business_number' THEN
          v_deny := 'identity_type_not_supported';
        ELSIF v_from IS NULL OR v_from !~ '^\+[1-9][0-9]{6,14}$' THEN
          v_deny := 'sender_business_number_invalid';
        ELSIF v_binding.id IS NULL THEN
          v_deny := 'binding_not_operational';
        ELSIF v_account.id IS NULL OR v_account.status <> 'active'
           OR coalesce(v_account.data_origin,'') = 'reference_seed'
           OR v_account.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'provider_account_not_operational';
        ELSIF NOT public.omni_comms_provider_credential_send_ready(
                v_account.verification_status, v_account.verification_result_code) THEN
          v_deny := 'provider_account_not_verified';
        ELSIF coalesce(v_provider_code,'') <> 'twilio_whatsapp' THEN
          v_deny := 'provider_not_supported';
        ELSIF coalesce(v_sid_ref,'') !~ '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$'
           OR coalesce(v_token_ref,'') !~ '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
          v_deny := 'secret_reference_invalid';
        END IF;
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
    v_idem := 'omni-comms/whatsapp/' || v_job.message_id::text;

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
      jsonb_build_object('channel','whatsapp','mode','queued',
                         'event_code', v_job.event_code,
                         'caller_module_code', v_job.caller_module_code,
                         'recipient_masked', v_norm->>'target_masked',
                         'correlation_id', nullif(v_corr,''))
    ) RETURNING id INTO v_attempt_id;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      safe_metadata, correlation_id, actor_type, actor_id)
    SELECT v_job.request_id, v_job.message_id, v_job.organization_id, t.et,
           public.omni_comms_priv_next_event_sequence(v_job.request_id),
           jsonb_build_object('attempt_number', v_attempt_no, 'channel','whatsapp',
                              'execution_context', v_ctx, 'worker', v_worker),
           nullif(v_corr,''), 'system', 'omni-comms-dispatch'
      FROM unnest(ARRAY['dispatch_ready','dispatch_claimed','provider_attempt_started']) WITH ORDINALITY AS t(et, ord)
     ORDER BY t.ord;

    v_claimed := v_claimed + 1;
    v_claims := v_claims || jsonb_build_object(
      'attempt_id', v_attempt_id,
      'claim_token', v_tok,
      'attempt_number', v_attempt_no,
      'account_sid_ref', v_sid_ref,
      'auth_token_ref', v_token_ref,
      'messaging_service_ref', v_svc_ref,
      'credential_storage_mode', coalesce(v_storage_mode,'edge_env'),
      'from_number', v_from,
      'recipient', regexp_replace(coalesce(v_recipient,''), '[\s()\-\.]', '', 'g'),
      'body', v_job.rendered_text,
      'content_sid', v_job.channel_setting_snapshot ->> 'content_sid',
      'media_url', v_job.channel_setting_snapshot ->> 'media_url',
      'provider_idempotency_key', v_idem,
      'lease_expires_at', now() + interval '2 minutes');
  END LOOP;

  RETURN jsonb_build_object(
    'channel','whatsapp',
    'scanned_jobs', v_scanned,
    'claimed_jobs', v_claimed,
    'execution_context', v_ctx,
    'claims', v_claims,
    'blockers', v_blockers,
    'blocker', CASE WHEN v_claimed = 0 AND v_scanned = 0 THEN NULL ELSE NULL END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_whatsapp(text,integer,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_claim_whatsapp(text,integer,text,text,text) TO service_role;

-- 4. The automatic scheduler tick now also drains In-App (internal, exactly-once)
--    and reports WhatsApp scanning. Fail-closed behaviour is unchanged: each
--    channel keeps its own release gate and its own evidence.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(
  p_worker text,
  p_batch_limit integer,
  p_deployed_revision text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result jsonb;
  v_in_app jsonb;
  v_scanned int;
  v_claimed int;
  v_blocker_count int;
  v_raw_blocker text;
  v_blocker text;
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

  -- In-App is an INTERNAL production channel: the projection is the delivery,
  -- so the same tick completes it. It stays fail-closed on release state and
  -- exactly-once on omni_comms_message_id.
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

  RETURN v_result || jsonb_build_object('in_app', v_in_app);
END;
$fn$;