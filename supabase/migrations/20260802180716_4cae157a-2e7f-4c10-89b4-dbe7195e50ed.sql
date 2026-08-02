-- =========================================================================
-- C7 Runtime Transition Closure
-- Executable callback, reconciliation and security-definer hardening.
-- No new tables. No object/integration count change. Nothing activated.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Message validator: bounded callback / reconciliation transitions
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_message_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_req_org uuid; v_rcp_org uuid; v_rcp_req uuid;
  v_verified boolean := coalesce(current_setting('omni_comms.verified_callback', true), '') = 'on';
BEGIN
  SELECT organization_id INTO v_req_org FROM public.omni_comms_request WHERE id = NEW.request_id;
  IF v_req_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 message_request_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  SELECT organization_id, request_id INTO v_rcp_org, v_rcp_req FROM public.omni_comms_recipient WHERE id = NEW.recipient_id;
  IF v_rcp_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 message_recipient_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_rcp_req IS DISTINCT FROM NEW.request_id THEN
    RAISE EXCEPTION 'OC422 message_recipient_request_mismatch' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_json_object(NEW.resolved_asset_manifest, 262144);
  PERFORM public.omni_comms_priv_require_json_object(NEW.channel_setting_snapshot, 32768);
  PERFORM public.omni_comms_priv_require_json_object(NEW.destination_snapshot, 32768);
  IF jsonb_typeof(NEW.unresolved_tokens) <> 'array' THEN RAISE EXCEPTION 'OC422 unresolved_tokens_must_be_array' USING ERRCODE='P0001'; END IF;
  IF jsonb_typeof(NEW.unresolved_required_slots) <> 'array' THEN RAISE EXCEPTION 'OC422 unresolved_required_slots_must_be_array' USING ERRCODE='P0001'; END IF;
  IF jsonb_typeof(NEW.blockers) <> 'array' THEN RAISE EXCEPTION 'OC422 blockers_must_be_array' USING ERRCODE='P0001'; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('pending','blocked') THEN
      IF NEW.template_family_id IS DISTINCT FROM OLD.template_family_id
         OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
         OR NEW.layout_id IS DISTINCT FROM OLD.layout_id
         OR NEW.layout_version_id IS DISTINCT FROM OLD.layout_version_id
         OR NEW.resolved_asset_manifest IS DISTINCT FROM OLD.resolved_asset_manifest
         OR NEW.rendered_subject IS DISTINCT FROM OLD.rendered_subject
         OR NEW.rendered_html IS DISTINCT FROM OLD.rendered_html
         OR NEW.rendered_text IS DISTINCT FROM OLD.rendered_text
         OR NEW.rendered_checksum IS DISTINCT FROM OLD.rendered_checksum
         OR NEW.channel IS DISTINCT FROM OLD.channel
         OR NEW.sender_identity_id IS DISTINCT FROM OLD.sender_identity_id
         OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
         OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
         OR NEW.destination_snapshot IS DISTINCT FROM OLD.destination_snapshot THEN
        RAISE EXCEPTION 'OC409 message_snapshot_immutable' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF NEW.status <> OLD.status THEN
      -- Ordinary lifecycle transitions.
      IF (
        (OLD.status = 'pending'     AND NEW.status IN ('rendered','blocked','cancelled')) OR
        (OLD.status = 'rendered'    AND NEW.status IN ('dry_run_completed','shadow_completed','queued','held','cancelled','blocked')) OR
        (OLD.status = 'queued'      AND NEW.status IN ('dispatching','cancelled','held')) OR
        (OLD.status = 'held'        AND NEW.status IN ('queued','cancelled')) OR
        (OLD.status = 'dispatching' AND NEW.status IN ('accepted','failed','reconciliation_required')) OR
        (OLD.status = 'accepted'    AND NEW.status IN ('delivered','failed','reconciliation_required'))
      ) THEN
        NULL;

      -- Exceptional transitions: verified provider callback / reconciliation
      -- path ONLY. A plain UPDATE, an authenticated RPC or a browser call can
      -- never reach these because the transaction-local trusted flag is set
      -- exclusively inside the service-role callback worker.
      ELSIF (
        (OLD.status = 'delivered' AND NEW.status = 'failed') OR
        (OLD.status = 'reconciliation_required' AND NEW.status IN ('accepted','delivered','failed'))
      ) THEN
        IF NOT v_verified THEN
          RAISE EXCEPTION 'OC403 verified_callback_context_required' USING ERRCODE = 'P0001';
        END IF;

      ELSE
        RAISE EXCEPTION 'OC422 invalid_message_transition' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- -------------------------------------------------------------------------
-- 2. Dispatch job validator: bounded reconciliation transitions.
--    NO broad completed -> failed transition is introduced.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_job_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_msg record;
  v_worker boolean := coalesce(current_setting('omni_comms.dispatch_worker', true), '') = 'on';
  v_verified boolean := coalesce(current_setting('omni_comms.verified_callback', true), '') = 'on';
BEGIN
  SELECT organization_id, request_id, channel INTO v_msg FROM public.omni_comms_message WHERE id = NEW.message_id;
  IF v_msg.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 dispatch_message_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.request_id IS DISTINCT FROM NEW.request_id THEN
    RAISE EXCEPTION 'OC422 dispatch_message_request_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.channel <> NEW.channel THEN
    RAISE EXCEPTION 'OC422 dispatch_message_channel_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.mode = 'dry_run' AND NEW.is_runnable = true THEN
    RAISE EXCEPTION 'OC422 dry_run_not_runnable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    IF (
      (OLD.status = 'pending'    AND NEW.status IN ('held','ready','cancelled')) OR
      (OLD.status = 'held'       AND NEW.status IN ('ready','cancelled')) OR
      (OLD.status = 'ready'      AND NEW.status IN ('leased','cancelled')) OR
      (OLD.status = 'leased'     AND NEW.status IN ('processing','ready')) OR
      (OLD.status = 'processing' AND NEW.status IN ('completed','retry_wait','failed')) OR
      (OLD.status = 'retry_wait' AND NEW.status IN ('ready','failed','cancelled'))
    ) THEN
      NULL;

    -- Uncertain execution parked for reconciliation. Trusted completion
    -- worker only, and only as a non-runnable reconciliation hold.
    ELSIF OLD.status = 'processing' AND NEW.status = 'held' THEN
      IF NOT v_worker THEN
        RAISE EXCEPTION 'OC403 dispatch_worker_context_required' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.hold_reason IS DISTINCT FROM 'reconciliation_required' OR NEW.is_runnable IS NOT FALSE THEN
        RAISE EXCEPTION 'OC422 invalid_reconciliation_hold' USING ERRCODE = 'P0001';
      END IF;

    -- Reconciliation resolved by a verified provider callback.
    ELSIF OLD.status = 'held'
      AND OLD.hold_reason = 'reconciliation_required'
      AND NEW.status IN ('completed','failed') THEN
      IF NOT v_verified THEN
        RAISE EXCEPTION 'OC403 verified_callback_context_required' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.is_runnable IS NOT FALSE THEN
        RAISE EXCEPTION 'OC422 invalid_reconciliation_resolution' USING ERRCODE = 'P0001';
      END IF;

    ELSE
      RAISE EXCEPTION 'OC422 invalid_dispatch_transition' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- -------------------------------------------------------------------------
-- 3. Completion worker: declare the trusted worker context around the
--    reconciliation hold so the bounded job transition is permitted.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_attempt_complete(
  p_attempt_id uuid, p_claim_token text, p_status text,
  p_provider_message_id text DEFAULT NULL::text,
  p_provider_status_code integer DEFAULT NULL::integer,
  p_provider_response jsonb DEFAULT NULL::jsonb,
  p_error_code text DEFAULT NULL::text,
  p_error_detail text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_att public.omni_comms_delivery_attempt;
  v_job public.omni_comms_dispatch_job;
  v_final text;
  v_status text := p_status;
  v_retriable boolean;
  v_event text;
  v_suspend jsonb := NULL;
  v_error text := p_error_code;
  v_recon text := NULL;
  v_safe jsonb;
BEGIN
  IF p_status NOT IN ('accepted','rejected','failed','timed_out','outcome_unknown') THEN
    RAISE EXCEPTION 'OC422 invalid_attempt_status' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_att FROM public.omni_comms_delivery_attempt
   WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 attempt_not_found' USING ERRCODE='P0001'; END IF;
  IF v_att.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'OC409 stale_claim' USING ERRCODE='P0001';
  END IF;
  IF v_att.status NOT IN ('started','dispatching') THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'already_terminal',
                              'status', v_att.status);
  END IF;

  IF v_status = 'accepted' AND coalesce(btrim(p_provider_message_id),'') = '' THEN
    v_status := 'outcome_unknown';
    v_error := coalesce(v_error, 'provider_acceptance_reference_missing');
  END IF;

  SELECT * INTO v_job FROM public.omni_comms_dispatch_job
   WHERE id = v_att.dispatch_job_id FOR UPDATE;

  v_retriable := v_status IN ('timed_out','outcome_unknown')
                 OR (v_status = 'failed' AND coalesce(p_provider_status_code, 0) >= 500);
  v_final := v_status;
  IF v_final <> 'accepted' AND v_retriable AND v_att.attempt_number < 3 THEN
    v_final := CASE WHEN v_status = 'outcome_unknown' THEN 'outcome_unknown' ELSE 'retry_scheduled' END;
  ELSIF v_final <> 'accepted' AND v_att.attempt_number >= 3 THEN
    v_final := CASE WHEN v_status = 'outcome_unknown' THEN 'outcome_unknown' ELSE 'exhausted' END;
  END IF;

  IF v_final = 'outcome_unknown' THEN
    v_recon := 'required';
  END IF;

  v_safe := jsonb_strip_nulls(jsonb_build_object(
    'provider_status_code', p_provider_status_code,
    'provider_message_id_present', (coalesce(btrim(p_provider_message_id),'') <> ''),
    'error_code', left(v_error, 200),
    'category', coalesce(p_provider_response->>'category', NULL)));

  UPDATE public.omni_comms_delivery_attempt
     SET status = v_final,
         completed_at = now(),
         latency_ms = greatest(0, (extract(epoch FROM (now() - started_at)) * 1000)::int),
         provider_message_id = coalesce(nullif(btrim(p_provider_message_id),''), provider_message_id),
         provider_status_code = coalesce(p_provider_status_code, provider_status_code),
         response_category = CASE WHEN v_status = 'accepted' THEN 'accepted'
                                  WHEN v_status = 'outcome_unknown' THEN 'unknown'
                                  ELSE 'error' END,
         response_code = left(coalesce(v_error, v_status), 100),
         is_retriable = v_retriable,
         failure_category = CASE WHEN v_status = 'accepted' THEN NULL
                                 ELSE left(coalesce(v_error, v_status), 100) END,
         error_code = left(v_error, 200),
         error_detail = left(p_error_detail, 1000),
         safe_response_metadata = v_safe,
         reconciliation_state = v_recon,
         claim_token = NULL
   WHERE id = v_att.id;

  IF v_status = 'accepted' THEN
    UPDATE public.omni_comms_dispatch_job
       SET status = 'completed', completed_at = now(), is_runnable = false,
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    UPDATE public.omni_comms_message SET status = 'accepted', updated_at = now()
     WHERE id = v_att.message_id;
    v_event := 'provider_accepted';

  ELSIF v_final = 'outcome_unknown' AND v_att.attempt_number >= 3 THEN
    -- Exhausted AND uncertain: never assert definite failure.
    PERFORM set_config('omni_comms.dispatch_worker', 'on', true);
    UPDATE public.omni_comms_dispatch_job
       SET status = 'held', hold_reason = 'reconciliation_required',
           is_runnable = false, next_attempt_at = NULL,
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    PERFORM set_config('omni_comms.dispatch_worker', 'off', true);
    UPDATE public.omni_comms_message SET status = 'reconciliation_required', updated_at = now()
     WHERE id = v_att.message_id;
    v_event := 'reconciliation_required';

  ELSIF v_final IN ('retry_scheduled','outcome_unknown') AND v_att.attempt_number < 3 THEN
    UPDATE public.omni_comms_dispatch_job
       SET status = 'retry_wait', is_runnable = false,
           next_attempt_at = now() + (interval '1 minute' * v_att.attempt_number),
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    v_event := CASE WHEN v_final = 'outcome_unknown'
                    THEN 'provider_outcome_unknown' ELSE 'provider_retry_scheduled' END;
  ELSE
    UPDATE public.omni_comms_dispatch_job
       SET status = 'failed', completed_at = now(), is_runnable = false,
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    UPDATE public.omni_comms_message SET status = 'failed', failed_at = now(), updated_at = now()
     WHERE id = v_att.message_id;
    v_event := CASE WHEN v_final = 'exhausted' THEN 'provider_attempts_exhausted'
                    ELSE 'provider_rejected' END;
  END IF;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
  VALUES (
    v_job.request_id, v_att.message_id, v_att.organization_id, v_event,
    public.omni_comms_priv_next_event_sequence(v_job.request_id),
    'dispatching', v_final, v_safe,
    v_job.correlation_id, 'system', 'omni-comms-dispatch');

  PERFORM public.omni_comms_priv_dispatch_recalculate_request(v_job.request_id);

  IF coalesce(v_error,'') IN ('credential_missing','secret_reference_invalid',
                              'certification_mismatch','evidence_integrity_failure',
                              'provider_payload_changed_for_idempotency_key',
                              'provider_authentication_failed') THEN
    v_suspend := public.omni_comms_priv_dispatch_suspend_pilot(
      v_att.release_control_id, v_error, 'automatic dispatch safety suspension');
    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
    VALUES (v_job.request_id, v_att.message_id, v_att.organization_id, 'pilot_suspended',
      public.omni_comms_priv_next_event_sequence(v_job.request_id), NULL, 'suspended',
      jsonb_build_object('trigger', v_error), v_job.correlation_id,
      'system', 'omni-comms-dispatch');
  END IF;

  RETURN jsonb_build_object('recorded', true, 'status', v_final,
                            'attempt_number', v_att.attempt_number,
                            'reconciliation_state', v_recon,
                            'suspension', v_suspend);
END; $function$;

-- -------------------------------------------------------------------------
-- 4. Callback worker: provider execution history and delivery outcome are
--    kept strictly separate. A completed job is NEVER rewritten as failed.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_record_callback(
  p_provider_code text, p_provider_event_id text, p_provider_message_id text,
  p_raw_event_type text, p_normalized_event_type text,
  p_occurred_at timestamp with time zone, p_payload_summary jsonb,
  p_payload_digest text, p_signature_verified boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_att public.omni_comms_delivery_attempt;
  v_job public.omni_comms_dispatch_job;
  v_scope text := 'unmatched';
  v_event text;
  v_suspend jsonb := NULL;
  v_id uuid;
  v_bounce text;
  v_matches integer := 0;
  v_result text;
  v_terminal boolean := false;
  v_msg_status text;
  v_job_outcome text := NULL;
BEGIN
  IF p_signature_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'OC401 signature_required' USING ERRCODE='P0001';
  END IF;
  IF p_normalized_event_type NOT IN
     ('delivered','delayed','bounced','complained','opened','clicked','sent') THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'unsupported_event_type');
  END IF;

  SELECT count(*) INTO v_matches
    FROM public.omni_comms_delivery_attempt a
   WHERE a.provider_message_id = p_provider_message_id
     AND a.provider_idempotency_key IS NOT NULL;

  IF v_matches = 1 THEN
    SELECT * INTO v_att FROM public.omni_comms_delivery_attempt a
     WHERE a.provider_message_id = p_provider_message_id
       AND a.provider_idempotency_key IS NOT NULL;
    v_scope := 'business';
    SELECT * INTO v_job FROM public.omni_comms_dispatch_job WHERE id = v_att.dispatch_job_id;
  ELSIF v_matches > 1 THEN
    v_scope := 'ambiguous';
  END IF;

  v_result := CASE v_scope WHEN 'business' THEN 'recorded'
                           WHEN 'ambiguous' THEN 'ambiguous'
                           ELSE 'ignored' END;

  INSERT INTO public.omni_comms_webhook_event (
    provider_code, provider_event_id, provider_message_id, raw_event_type,
    normalized_event_type, signature_verified, occurred_at, scope,
    delivery_attempt_id, message_id, organization_id,
    payload_summary, payload_digest, processing_result)
  VALUES (
    p_provider_code, p_provider_event_id, p_provider_message_id, p_raw_event_type,
    p_normalized_event_type, true, p_occurred_at,
    CASE WHEN v_scope = 'ambiguous' THEN 'unmatched' ELSE v_scope END,
    v_att.id, v_att.message_id, v_att.organization_id,
    coalesce(p_payload_summary, '{}'::jsonb), p_payload_digest, v_result)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'duplicate_event');
  END IF;

  IF v_scope = 'ambiguous' THEN
    IF (SELECT count(DISTINCT a.release_control_id)
          FROM public.omni_comms_delivery_attempt a
         WHERE a.provider_message_id = p_provider_message_id) = 1 THEN
      v_suspend := public.omni_comms_priv_dispatch_suspend_pilot(
        (SELECT DISTINCT a.release_control_id
           FROM public.omni_comms_delivery_attempt a
          WHERE a.provider_message_id = p_provider_message_id),
        'ambiguous_callback',
        'a verified callback matched more than one delivery attempt');
    ELSE
      v_suspend := jsonb_build_object('suspended', false,
                                      'code', 'release_not_resolvable',
                                      'severity', 'high');
    END IF;
    RETURN jsonb_build_object('recorded', true, 'code', 'callback_ambiguous',
                              'scope', 'unmatched', 'suspension', v_suspend);
  END IF;
  IF v_scope <> 'business' THEN
    RETURN jsonb_build_object('recorded', true, 'code', 'unmatched_ignored');
  END IF;

  v_event := CASE p_normalized_event_type
               WHEN 'delivered' THEN 'callback_delivered'
               WHEN 'delayed'   THEN 'callback_delayed'
               WHEN 'bounced'   THEN 'callback_bounced'
               WHEN 'complained' THEN 'callback_complained'
               WHEN 'opened'    THEN 'callback_opened'
               WHEN 'clicked'   THEN 'callback_clicked'
               ELSE NULL END;

  IF v_event IS NOT NULL THEN
    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
    VALUES (v_job.request_id, v_att.message_id, v_att.organization_id, v_event,
      public.omni_comms_priv_next_event_sequence(v_job.request_id),
      NULL, NULL, coalesce(p_payload_summary, '{}'::jsonb),
      v_job.correlation_id, 'system', 'omni-comms-webhook-resend');
  END IF;

  v_bounce := lower(coalesce(p_payload_summary->>'bounce_type',''));
  v_terminal := p_normalized_event_type = 'complained'
                OR (p_normalized_event_type = 'bounced'
                    AND v_bounce IN ('hard','permanent'));

  SELECT status INTO v_msg_status FROM public.omni_comms_message WHERE id = v_att.message_id;

  -- Trusted verified-callback context for the whole outcome application.
  PERFORM set_config('omni_comms.verified_callback', 'on', true);

  -- A verified callback is the only authority that can resolve an
  -- outcome_unknown attempt. Opened / clicked can NEVER reverse a terminal
  -- failed, bounced or complained outcome.
  IF v_att.status = 'outcome_unknown'
     AND NOT v_terminal
     AND coalesce(v_msg_status,'') <> 'failed'
     AND p_normalized_event_type IN ('delivered','sent','opened','clicked') THEN
    PERFORM set_config('omni_comms.reconciliation', 'on', true);
    UPDATE public.omni_comms_delivery_attempt
       SET status = 'accepted', reconciliation_state = 'resolved'
     WHERE id = v_att.id;
    PERFORM set_config('omni_comms.reconciliation', 'off', true);

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
    VALUES (v_job.request_id, v_att.message_id, v_att.organization_id,
      'reconciliation_resolved',
      public.omni_comms_priv_next_event_sequence(v_job.request_id),
      'outcome_unknown', 'accepted',
      jsonb_build_object('resolved_by', p_normalized_event_type),
      v_job.correlation_id, 'system', 'omni-comms-webhook-resend');
  END IF;

  IF p_normalized_event_type = 'delivered' THEN
    UPDATE public.omni_comms_message SET status = 'delivered', completed_at = now(),
           updated_at = now()
     WHERE id = v_att.message_id
       AND status IN ('accepted','reconciliation_required');
    -- Only a reconciliation hold is resolved to completed. An already
    -- completed job keeps its truthful execution history.
    UPDATE public.omni_comms_dispatch_job
       SET status = 'completed', hold_reason = NULL, is_runnable = false,
           completed_at = now(), updated_at = now()
     WHERE id = v_job.id
       AND status = 'held'
       AND hold_reason = 'reconciliation_required';
    v_job_outcome := CASE WHEN v_job.status = 'held' THEN 'reconciliation_completed'
                          ELSE 'job_history_preserved' END;
  END IF;

  -- Terminal harm: the delivery OUTCOME is failed and the pilot suspended.
  -- Provider EXECUTION history is never rewritten: a completed job stays
  -- completed and only becomes non-runnable with bounded outcome evidence.
  IF v_terminal THEN
    UPDATE public.omni_comms_message
       SET status = 'failed', failed_at = coalesce(failed_at, now()), updated_at = now()
     WHERE id = v_att.message_id
       AND status IN ('accepted','delivered','dispatching','reconciliation_required');

    IF v_job.status = 'held' AND v_job.hold_reason = 'reconciliation_required' THEN
      UPDATE public.omni_comms_dispatch_job
         SET status = 'failed', is_runnable = false, updated_at = now()
       WHERE id = v_job.id;
      v_job_outcome := 'reconciliation_failed';
    ELSIF v_job.status = 'processing' THEN
      UPDATE public.omni_comms_dispatch_job
         SET status = 'failed', completed_at = now(), is_runnable = false,
             updated_at = now()
       WHERE id = v_job.id;
      v_job_outcome := 'processing_failed';
    ELSE
      -- completed / failed / cancelled: history preserved.
      UPDATE public.omni_comms_dispatch_job
         SET is_runnable = false,
             hold_reason = CASE WHEN p_normalized_event_type = 'complained'
                                THEN 'complaint' ELSE 'hard_bounce' END,
             updated_at = now()
       WHERE id = v_job.id;
      v_job_outcome := 'job_history_preserved';
    END IF;

    v_suspend := public.omni_comms_priv_dispatch_suspend_pilot(
      v_att.release_control_id,
      CASE WHEN p_normalized_event_type = 'complained' THEN 'complaint' ELSE 'hard_bounce' END,
      'automatic controlled-pilot suspension from a verified provider callback');

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
    VALUES (v_job.request_id, v_att.message_id, v_att.organization_id, 'pilot_suspended',
      public.omni_comms_priv_next_event_sequence(v_job.request_id), NULL, 'suspended',
      jsonb_build_object('trigger', p_normalized_event_type),
      v_job.correlation_id, 'system', 'omni-comms-webhook-resend');
  END IF;

  -- Soft / transient bounces record truthful evidence and do NOT suspend.
  PERFORM public.omni_comms_priv_dispatch_recalculate_request(v_job.request_id);
  PERFORM set_config('omni_comms.verified_callback', 'off', true);

  RETURN jsonb_build_object('recorded', true, 'code', 'callback_recorded',
                            'scope', v_scope,
                            'terminal', v_terminal,
                            'job_outcome', coalesce(v_job_outcome, 'unchanged'),
                            'job_status_before', v_job.status,
                            'suspension', v_suspend);
END; $function$;

-- -------------------------------------------------------------------------
-- 5. Diagnostics: exact department compatibility + pinned search path.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_dispatch_diagnostics(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rel public.omni_comms_channel_release_control;
  v_queued_bindings integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_rel := public.omni_comms_priv_channel_release_effective(
             p_organization_id, p_department_id, 'email');

  -- Exact department compatibility: an organisation-level release is cleared
  -- ONLY by an organisation-level binding. A department-only binding can
  -- never clear pilot_business_producer_not_selected for the organisation.
  SELECT count(*) INTO v_queued_bindings
    FROM public.omni_comms_producer_event_binding b
    JOIN public.omni_comms_event_definition ed ON ed.id = b.event_definition_id
   WHERE b.status = 'active'
     AND 'queued' = ANY (b.allowed_modes)
     AND b.organization_id = p_organization_id
     AND (
       (p_department_id IS NULL AND b.department_id IS NULL)
       OR (p_department_id IS NOT NULL
           AND (b.department_id IS NULL OR b.department_id = p_department_id))
     )
     AND v_rel.id IS NOT NULL
     AND (v_rel.permitted_event_codes IS NOT NULL
          AND ed.event_code = ANY (v_rel.permitted_event_codes))
     AND (v_rel.permitted_caller_modules IS NOT NULL
          AND b.caller_module_code = ANY (v_rel.permitted_caller_modules));

  RETURN jsonb_build_object(
    'dispatcher_implemented', true,
    'live_delivery_enabled', false,
    'release_live_state_available', false,
    'dispatchable_channels', jsonb_build_array('email'),
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'eligible_jobs', (
      SELECT count(*) FROM public.omni_comms_dispatch_job j
        JOIN public.omni_comms_message m ON m.id = j.message_id
       WHERE j.channel='email' AND j.mode='queued'
         AND j.status IN ('held','retry_wait')
         AND j.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)),
    'in_flight_attempts', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND a.status IN ('started','dispatching')),
    'reconciliation_required_count', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND a.reconciliation_state = 'required'),
    'business_attempts_total', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)),
    'business_accepted_total', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND a.status = 'accepted'),
    'business_delivered_total', (
      SELECT count(*) FROM public.omni_comms_webhook_event w
        JOIN public.omni_comms_message m ON m.id = w.message_id
       WHERE w.organization_id = p_organization_id
         AND m.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND w.normalized_event_type = 'delivered'),
    'ambiguous_callback_count', (
      SELECT count(*) FROM public.omni_comms_webhook_event w
       WHERE w.processing_result = 'ambiguous'
         AND EXISTS (
           SELECT 1 FROM public.omni_comms_delivery_attempt a
             JOIN public.omni_comms_message m2 ON m2.id = a.message_id
            WHERE a.provider_message_id = w.provider_message_id
              AND a.organization_id = p_organization_id
              AND (p_department_id IS NULL OR m2.department_id = p_department_id))),
    'queued_producer_binding_count', v_queued_bindings,
    'release_state', v_rel.release_state,
    'release_control_id', v_rel.id,
    'blocker', CASE WHEN v_queued_bindings = 0
      THEN 'pilot_business_producer_not_selected' ELSE NULL END);
END; $function$;

-- -------------------------------------------------------------------------
-- 6. Security-definer pinning, ownership and grant hardening.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_service_only text[] := ARRAY[
    'omni_comms_priv_dispatch_claim_safety_suspend',
    'omni_comms_priv_dispatch_claim_email',
    'omni_comms_priv_dispatch_scheduler_tick',
    'omni_comms_priv_dispatch_record_payload_hash',
    'omni_comms_priv_dispatch_attempt_complete',
    'omni_comms_priv_dispatch_record_callback',
    'omni_comms_priv_dispatch_recalculate_request',
    'omni_comms_priv_dispatch_suspend_pilot',
    'omni_comms_priv_dispatch_reclaim_expired_leases',
    'omni_comms_priv_dispatch_operator_scopes'];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname = ANY (v_service_only)
            OR p.proname IN ('omni_comms_dispatch_diagnostics',
                             'omni_comms_dispatch_tick_authorize',
                             'omni_comms_priv_message_validate',
                             'omni_comms_priv_dispatch_job_validate',
                             'omni_comms_priv_delivery_attempt_immutable'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', r.sig);
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);

    IF r.proname = ANY (v_service_only)
       OR r.proname IN ('omni_comms_priv_message_validate',
                        'omni_comms_priv_dispatch_job_validate',
                        'omni_comms_priv_delivery_attempt_immutable') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    ELSE
      -- Tenant- and permission-checked operator surfaces.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;

    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;