-- =====================================================================
-- Omni-Comms Phase C7 — Controlled business Email dispatch foundation
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Delivery attempt ledger — business evidence, claims, leases
-- ---------------------------------------------------------------------
ALTER TABLE public.omni_comms_delivery_attempt
  DROP CONSTRAINT IF EXISTS omni_comms_delivery_attempt_status_check,
  DROP CONSTRAINT IF EXISTS omni_comms_delivery_attempt_completed_chk;

ALTER TABLE public.omni_comms_delivery_attempt
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key text,
  ADD COLUMN IF NOT EXISTS release_control_id uuid,
  ADD COLUMN IF NOT EXISTS release_version_at_claim integer,
  ADD COLUMN IF NOT EXISTS release_state_at_claim text,
  ADD COLUMN IF NOT EXISTS release_fingerprint_at_claim text,
  ADD COLUMN IF NOT EXISTS certified_commit_at_claim text,
  ADD COLUMN IF NOT EXISTS recipient_hash text,
  ADD COLUMN IF NOT EXISTS provider_status_code integer,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_detail text;

ALTER TABLE public.omni_comms_delivery_attempt
  ADD CONSTRAINT omni_comms_delivery_attempt_status_check
    CHECK (status = ANY (ARRAY[
      'started','dispatching','accepted','rejected','failed',
      'timed_out','outcome_unknown','retry_scheduled','exhausted','cancelled'])),
  ADD CONSTRAINT omni_comms_delivery_attempt_completed_chk
    CHECK (status IN ('started','dispatching') OR completed_at IS NOT NULL),
  ADD CONSTRAINT omni_comms_delivery_attempt_recipient_hash_chk
    CHECK (recipient_hash IS NULL OR recipient_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT omni_comms_delivery_attempt_max_attempts_chk
    CHECK (attempt_number <= 3),
  ADD CONSTRAINT omni_comms_delivery_attempt_release_fk
    FOREIGN KEY (release_control_id)
    REFERENCES public.omni_comms_channel_release_control(id);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_delivery_attempt_msg_seq_uq
  ON public.omni_comms_delivery_attempt (message_id, attempt_number);
CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_delivery_attempt_claim_uq
  ON public.omni_comms_delivery_attempt (claim_token) WHERE claim_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS omni_comms_delivery_attempt_provider_msg_idx
  ON public.omni_comms_delivery_attempt (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS omni_comms_delivery_attempt_release_window_idx
  ON public.omni_comms_delivery_attempt (release_control_id, created_at);

-- ---------------------------------------------------------------------
-- 2. Message timeline — C7 business dispatch and callback vocabulary
-- ---------------------------------------------------------------------
ALTER TABLE public.omni_comms_message_event
  DROP CONSTRAINT IF EXISTS omni_comms_message_event_event_type_check;

ALTER TABLE public.omni_comms_message_event
  ADD CONSTRAINT omni_comms_message_event_event_type_check
    CHECK (event_type = ANY (ARRAY[
      'request_accepted','request_processing','recipient_resolved','recipient_blocked',
      'message_rendered','message_blocked','dry_run_completed','shadow_completed',
      'dispatch_queued','dispatch_held','request_completed','request_failed',
      -- C7 dispatch lifecycle
      'dispatch_ready','dispatch_claimed','dispatch_leased','dispatch_lease_expired',
      'dispatch_cancelled',
      'provider_attempt_started','provider_accepted','provider_rejected',
      'provider_outcome_unknown','provider_retry_scheduled','provider_attempts_exhausted',
      -- C7 provider callbacks (normalized)
      'callback_delivered','callback_delayed','callback_bounced','callback_complained',
      'callback_opened','callback_clicked',
      -- C7 automatic safety
      'pilot_suspended']));

-- ---------------------------------------------------------------------
-- 3. omni_comms_webhook_event — deduplicated inbound callback ledger
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.omni_comms_webhook_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL,
  provider_event_id text NOT NULL,
  provider_message_id text,
  raw_event_type text NOT NULL,
  normalized_event_type text,
  signature_verified boolean NOT NULL DEFAULT false,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL DEFAULT 'unmatched',
  delivery_attempt_id uuid REFERENCES public.omni_comms_delivery_attempt(id),
  message_id uuid REFERENCES public.omni_comms_message(id),
  organization_id uuid,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_digest text NOT NULL,
  processing_result text NOT NULL DEFAULT 'recorded',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_webhook_event_scope_chk
    CHECK (scope IN ('business','channel_test','unmatched')),
  CONSTRAINT omni_comms_webhook_event_result_chk
    CHECK (processing_result IN ('recorded','ignored','duplicate','rejected')),
  CONSTRAINT omni_comms_webhook_event_digest_chk
    CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_webhook_event_summary_chk
    CHECK (jsonb_typeof(payload_summary) = 'object'
           AND pg_column_size(payload_summary) <= 8192)
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_webhook_event_dedupe_uq
  ON public.omni_comms_webhook_event (provider_code, provider_event_id);
CREATE INDEX IF NOT EXISTS omni_comms_webhook_event_msg_idx
  ON public.omni_comms_webhook_event (provider_message_id);

GRANT ALL ON public.omni_comms_webhook_event TO service_role;
ALTER TABLE public.omni_comms_webhook_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_webhook_event_no_direct_access
  ON public.omni_comms_webhook_event;
CREATE POLICY omni_comms_webhook_event_no_direct_access
  ON public.omni_comms_webhook_event
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Append-only: callback evidence may never be rewritten.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_webhook_event_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
BEGIN
  RAISE EXCEPTION 'OC409 webhook_event_immutable' USING ERRCODE='P0001';
END; $$;

DROP TRIGGER IF EXISTS omni_comms_webhook_event_append_only
  ON public.omni_comms_webhook_event;
CREATE TRIGGER omni_comms_webhook_event_append_only
  BEFORE UPDATE OR DELETE ON public.omni_comms_webhook_event
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_webhook_event_append_only();

-- ---------------------------------------------------------------------
-- 4. Automatic controlled-pilot suspension
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(
  p_release_control_id uuid,
  p_trigger text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_rel public.omni_comms_channel_release_control; v_from text;
BEGIN
  IF p_release_control_id IS NULL THEN
    RETURN jsonb_build_object('suspended', false, 'code', 'release_control_missing');
  END IF;
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
   WHERE id = p_release_control_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('suspended', false, 'code', 'release_control_missing');
  END IF;
  IF v_rel.release_state = 'suspended' THEN
    RETURN jsonb_build_object('suspended', false, 'code', 'already_suspended');
  END IF;
  v_from := v_rel.release_state;

  UPDATE public.omni_comms_channel_release_control
     SET release_state = 'suspended',
         suspended_at = now(),
         suspension_reason = left(coalesce(p_trigger,'automatic') || ': '
                                  || coalesce(p_reason,'automatic safety suspension'), 500),
         release_version = release_version + 1,
         updated_at = now()
   WHERE id = v_rel.id
   RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'suspended', v_from, 'suspended',
    left(coalesce(p_trigger,'automatic') || ': ' || coalesce(p_reason,''), 500),
    NULL, NULL, NULL,
    jsonb_build_object('automatic', true, 'trigger', p_trigger));

  RETURN jsonb_build_object('suspended', true, 'code', 'pilot_suspended',
                            'trigger', p_trigger,
                            'release_control_id', v_rel.id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_suspend_pilot(uuid,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- 5. The C7 claim transaction — the concurrency authority
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_claim_email(
  p_worker text,
  p_batch_limit integer,
  p_correlation_id text,
  p_deployed_revision text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_limit      integer := least(greatest(coalesce(p_batch_limit, 1), 1), 10);
  v_worker     text := left(coalesce(nullif(btrim(p_worker), ''), 'omni-comms-dispatch'), 120);
  v_corr       text := left(coalesce(p_correlation_id, ''), 120);
  v_job        record;
  v_rel        public.omni_comms_channel_release_control;
  v_cert       jsonb;
  v_decision   jsonb;
  v_recipient  text;
  v_hash       text;
  v_hour int; v_day int; v_total int;
  v_claims     jsonb := '[]'::jsonb;
  v_blockers   jsonb := '[]'::jsonb;
  v_scanned    integer := 0;
  v_claimed    integer := 0;
  v_secret     text;
  v_binding    public.omni_comms_sender_provider_binding%ROWTYPE;
  v_identity   public.omni_comms_sender_identity%ROWTYPE;
  v_account    public.omni_comms_provider_account%ROWTYPE;
  v_provider_code text;
  v_token      text;
  v_attempt_id uuid;
  v_attempt_no integer;
  v_idem       text;
  v_deny       text;
BEGIN
  v_cert := public.omni_comms_priv_certification_posture();

  FOR v_job IN
    SELECT j.*, m.recipient_id, m.rendered_subject, m.rendered_text, m.rendered_html,
           m.sender_identity_id, m.provider_id, m.provider_account_id,
           m.department_id AS msg_department_id, m.status AS message_status,
           r.caller_module_code, r.event_definition_id,
           ed.event_code
      FROM public.omni_comms_dispatch_job j
      JOIN public.omni_comms_message m  ON m.id = j.message_id
      JOIN public.omni_comms_request r  ON r.id = j.request_id
      JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
     WHERE j.channel = 'email'
       AND j.mode = 'queued'
       AND j.status IN ('held','retry_wait')
       AND j.attempt_count < 3
       AND coalesce(j.next_attempt_at, now()) <= now()
       AND m.status IN ('held','queued')
     ORDER BY j.priority, j.created_at
     LIMIT v_limit
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    v_scanned := v_scanned + 1;
    v_deny := NULL;

    -- (a) Lock the governing Release Control row: the claim transaction, not
    --     the read-only oracle, is the concurrency authority.
    v_rel := public.omni_comms_priv_channel_release_effective(
               v_job.organization_id, v_job.msg_department_id, 'email');
    IF v_rel.id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object('job_id', v_job.id, 'code', 'release_control_missing');
      CONTINUE;
    END IF;
    SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
      WHERE id = v_rel.id FOR UPDATE;

    -- (b) Recipient hash gate.
    SELECT lower(btrim(coalesce(rc.email_destination, ''))) INTO v_recipient
      FROM public.omni_comms_recipient rc WHERE rc.id = v_job.recipient_id;
    IF coalesce(v_recipient,'') = '' THEN
      v_deny := 'recipient_missing';
    ELSE
      v_hash := encode(extensions.digest(v_recipient, 'sha256'), 'hex');
    END IF;

    -- (c) Read-only decision evidence from the C6 oracle.
    IF v_deny IS NULL THEN
      v_decision := public.omni_comms_priv_channel_release_decision(
        v_job.organization_id, v_job.msg_department_id, 'email',
        v_job.event_code, v_job.caller_module_code, 'queued',
        ARRAY[v_hash], 1, p_deployed_revision);
      IF coalesce((v_decision->>'allowed')::boolean, false) IS NOT TRUE THEN
        v_deny := coalesce(v_decision->>'code', 'release_denied');
      END IF;
    END IF;

    -- (d) Certification gate — recomputed inside the claim transaction.
    IF v_deny IS NULL THEN
      IF coalesce((v_cert->>'effective_certified')::boolean, false) IS NOT TRUE THEN
        v_deny := 'certification_not_effective';
      ELSIF lower(coalesce(v_cert->>'certified_commit','')) IS DISTINCT FROM
            lower(coalesce(v_rel.approved_commit,'x')) THEN
        v_deny := 'certification_mismatch';
      ELSIF lower(coalesce(p_deployed_revision,'')) IS DISTINCT FROM
            lower(coalesce(v_rel.approved_commit,'x')) THEN
        v_deny := 'deployed_revision_mismatch';
      END IF;
    END IF;

    -- (e) Transactional volume recalculation against the LOCKED release row.
    IF v_deny IS NULL THEN
      SELECT count(*) INTO v_hour FROM public.omni_comms_delivery_attempt a
        WHERE a.release_control_id = v_rel.id AND a.created_at > now() - interval '1 hour';
      SELECT count(*) INTO v_day FROM public.omni_comms_delivery_attempt a
        WHERE a.release_control_id = v_rel.id AND a.created_at > now() - interval '1 day';
      SELECT count(DISTINCT a.message_id) INTO v_total FROM public.omni_comms_delivery_attempt a
        WHERE a.release_control_id = v_rel.id;
      IF v_hour + 1 > v_rel.max_messages_per_hour
         OR v_day + 1 > v_rel.max_messages_per_day
         OR (NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a
                          WHERE a.release_control_id = v_rel.id
                            AND a.message_id = v_job.message_id)
             AND v_total + 1 > v_rel.max_messages_total) THEN
        v_deny := 'release_limit_exceeded';
      END IF;
    END IF;

    -- (f) Provider configuration + canonical api_key child secret reference.
    IF v_deny IS NULL THEN
      SELECT * INTO v_identity FROM public.omni_comms_sender_identity
        WHERE id = v_job.sender_identity_id;
      SELECT * INTO v_binding FROM public.omni_comms_sender_provider_binding
        WHERE sender_identity_id = v_job.sender_identity_id
          AND status = 'active' AND coalesce(data_origin,'') <> 'reference_seed'
        ORDER BY coalesce(priority, 100) LIMIT 1;
      SELECT * INTO v_account FROM public.omni_comms_provider_account
        WHERE id = coalesce(v_job.provider_account_id, v_binding.provider_account_id);
      SELECT code INTO v_provider_code FROM public.omni_comms_provider WHERE id = v_account.provider_id;
      SELECT s.secret_ref INTO v_secret
        FROM public.omni_comms_provider_account_secret_ref s
       WHERE s.provider_account_id = v_account.id AND s.purpose = 'api_key'
       LIMIT 1;

      IF v_identity.id IS NULL OR v_identity.status <> 'active'
         OR coalesce(v_identity.data_origin,'') = 'reference_seed' THEN
        v_deny := 'identity_not_operational';
      ELSIF v_binding.id IS NULL THEN
        v_deny := 'binding_not_operational';
      ELSIF v_account.id IS NULL OR coalesce(v_provider_code,'') <> 'resend_email' THEN
        v_deny := 'provider_not_supported';
      ELSIF coalesce(v_secret,'') !~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
        v_deny := 'secret_reference_invalid';
      END IF;
    END IF;

    IF v_deny IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('job_id', v_job.id, 'code', v_deny);
      CONTINUE;
    END IF;

    -- (g) Claim: held/retry_wait -> ready -> leased -> processing.
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_attempt_no := v_job.attempt_count + 1;
    v_idem := 'omni-comms/c7/' || v_job.message_id::text;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'ready', is_runnable = true, hold_reason = NULL,
           release_control_id = v_rel.id,
           release_version_at_decision = v_rel.release_version,
           release_state_at_decision = v_rel.release_state,
           release_fingerprint_at_decision = v_rel.release_fingerprint,
           release_expires_at_decision = v_rel.release_expires_at,
           release_decision_at = now(),
           release_decision_snapshot = jsonb_build_object(
             'code', v_decision->>'code',
             'release_version', v_rel.release_version,
             'release_state', v_rel.release_state,
             'certified_commit', v_cert->>'certified_commit'),
           updated_at = now()
     WHERE id = v_job.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'leased', lock_token = v_token, locked_at = now(),
           locked_by = v_worker, lease_expires_at = now() + interval '2 minutes',
           attempt_count = v_attempt_no, updated_at = now()
     WHERE id = v_job.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'processing', updated_at = now()
     WHERE id = v_job.id;

    IF v_job.message_status = 'held' THEN
      UPDATE public.omni_comms_message SET status = 'queued', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;
    UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
     WHERE id = v_job.message_id;

    -- (h) Reserve volume by writing the attempt BEFORE any provider call.
    INSERT INTO public.omni_comms_delivery_attempt (
      dispatch_job_id, message_id, organization_id, provider_id, provider_account_id,
      attempt_number, status, started_at, claim_token, claimed_at, lease_expires_at,
      worker_id, provider_idempotency_key, release_control_id,
      release_version_at_claim, release_state_at_claim, release_fingerprint_at_claim,
      certified_commit_at_claim, recipient_hash, safe_request_metadata
    ) VALUES (
      v_job.id, v_job.message_id, v_job.organization_id,
      v_account.provider_id, v_account.id,
      v_attempt_no, 'dispatching', now(), v_token, now(), now() + interval '2 minutes',
      v_worker, v_idem, v_rel.id,
      v_rel.release_version, v_rel.release_state, v_rel.release_fingerprint,
      lower(coalesce(v_cert->>'certified_commit','')), v_hash,
      jsonb_build_object('channel','email','mode','queued',
                         'event_code', v_job.event_code,
                         'caller_module_code', v_job.caller_module_code,
                         'correlation_id', nullif(v_corr,''))
    ) RETURNING id INTO v_attempt_id;

    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
    SELECT v_job.request_id, v_job.message_id, v_job.organization_id, t.et,
           public.omni_comms_priv_next_event_sequence(v_job.request_id),
           NULL, NULL,
           jsonb_build_object('attempt_number', v_attempt_no,
                              'release_version', v_rel.release_version,
                              'worker', v_worker),
           nullif(v_corr,''), 'system', 'omni-comms-dispatch'
      FROM unnest(ARRAY['dispatch_ready','dispatch_claimed','provider_attempt_started']) WITH ORDINALITY AS t(et, ord)
     ORDER BY t.ord;

    v_claimed := v_claimed + 1;
    v_claims := v_claims || jsonb_build_object(
      'attempt_id', v_attempt_id,
      'claim_token', v_token,
      'attempt_number', v_attempt_no,
      'secret_ref', v_secret,
      'from_address', v_identity.from_address,
      'from_name', v_identity.from_name,
      'reply_to_address', v_identity.reply_to_address,
      'recipient', v_recipient,
      'subject', v_job.rendered_subject,
      'text_body', v_job.rendered_text,
      'html_body', v_job.rendered_html,
      'provider_idempotency_key', v_idem,
      'lease_expires_at', now() + interval '2 minutes');
  END LOOP;

  RETURN jsonb_build_object(
    'scanned_jobs', v_scanned,
    'claimed_jobs', v_claimed,
    'claims', v_claims,
    'blockers', v_blockers,
    'blocker', CASE WHEN v_claimed = 0 AND v_scanned = 0
                    THEN 'pilot_business_producer_not_selected' ELSE NULL END,
    'live_delivery_enabled', false);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text,integer,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- 6. Attempt completion — bound to the claim token
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_attempt_complete(
  p_attempt_id uuid,
  p_claim_token text,
  p_status text,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status_code integer DEFAULT NULL,
  p_provider_response jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_detail text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_att public.omni_comms_delivery_attempt;
  v_job public.omni_comms_dispatch_job;
  v_final text;
  v_retriable boolean;
  v_event text;
  v_suspend jsonb := NULL;
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

  SELECT * INTO v_job FROM public.omni_comms_dispatch_job
   WHERE id = v_att.dispatch_job_id FOR UPDATE;

  v_retriable := p_status IN ('timed_out','outcome_unknown')
                 OR (p_status = 'failed' AND coalesce(p_provider_status_code, 0) >= 500);
  v_final := p_status;
  IF v_final <> 'accepted' AND v_retriable AND v_att.attempt_number < 3 THEN
    v_final := CASE WHEN p_status = 'outcome_unknown' THEN 'outcome_unknown' ELSE 'retry_scheduled' END;
  ELSIF v_final <> 'accepted' AND v_att.attempt_number >= 3 THEN
    v_final := CASE WHEN p_status = 'outcome_unknown' THEN 'outcome_unknown' ELSE 'exhausted' END;
  END IF;

  UPDATE public.omni_comms_delivery_attempt
     SET status = v_final,
         completed_at = now(),
         latency_ms = greatest(0, (extract(epoch FROM (now() - started_at)) * 1000)::int),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         provider_status_code = coalesce(p_provider_status_code, provider_status_code),
         response_category = CASE WHEN p_status = 'accepted' THEN 'accepted' ELSE 'error' END,
         response_code = left(coalesce(p_error_code, p_status), 100),
         is_retriable = v_retriable,
         failure_category = CASE WHEN p_status = 'accepted' THEN NULL
                                 ELSE left(coalesce(p_error_code, p_status), 100) END,
         error_code = left(p_error_code, 200),
         error_detail = left(p_error_detail, 1000),
         safe_response_metadata = coalesce(p_provider_response, '{}'::jsonb),
         claim_token = NULL
   WHERE id = v_att.id;

  -- Job + message terminal state (using the approved transitions only).
  IF p_status = 'accepted' THEN
    UPDATE public.omni_comms_dispatch_job
       SET status = 'completed', is_runnable = false, completed_at = now(),
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    UPDATE public.omni_comms_message SET status = 'accepted', updated_at = now()
     WHERE id = v_att.message_id;
    v_event := 'provider_accepted';
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
       SET status = 'failed', is_runnable = false, completed_at = now(),
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    UPDATE public.omni_comms_message SET status = 'failed', failed_at = now(), updated_at = now()
     WHERE id = v_att.message_id;
    v_event := CASE WHEN v_final = 'outcome_unknown' THEN 'provider_outcome_unknown'
                    WHEN v_final = 'exhausted' THEN 'provider_attempts_exhausted'
                    ELSE 'provider_rejected' END;
  END IF;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
  VALUES (
    v_job.request_id, v_att.message_id, v_att.organization_id, v_event,
    public.omni_comms_priv_next_event_sequence(v_job.request_id),
    'dispatching', v_final,
    jsonb_build_object('attempt_number', v_att.attempt_number,
                       'provider_status_code', p_provider_status_code,
                       'error_code', left(p_error_code, 200)),
    v_job.correlation_id, 'system', 'omni-comms-dispatch');

  -- Automatic controlled-pilot suspension on credential / certification /
  -- evidence-integrity failure.
  IF p_error_code IN ('credential_missing','secret_reference_invalid',
                      'certification_mismatch','evidence_integrity_failure') THEN
    v_suspend := public.omni_comms_priv_dispatch_suspend_pilot(
      v_att.release_control_id, p_error_code, 'automatic dispatch safety suspension');
    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
    VALUES (v_job.request_id, v_att.message_id, v_att.organization_id, 'pilot_suspended',
      public.omni_comms_priv_next_event_sequence(v_job.request_id), NULL, 'suspended',
      jsonb_build_object('trigger', p_error_code), v_job.correlation_id,
      'system', 'omni-comms-dispatch');
  END IF;

  RETURN jsonb_build_object('recorded', true, 'status', v_final,
                            'attempt_number', v_att.attempt_number,
                            'suspension', v_suspend);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_attempt_complete(uuid,text,text,text,integer,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_attempt_complete(uuid,text,text,text,integer,jsonb,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- 7. Signed callback normalization for business attempts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_record_callback(
  p_provider_code text,
  p_provider_event_id text,
  p_provider_message_id text,
  p_raw_event_type text,
  p_normalized_event_type text,
  p_occurred_at timestamptz,
  p_payload_summary jsonb,
  p_payload_digest text,
  p_signature_verified boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_att public.omni_comms_delivery_attempt;
  v_job public.omni_comms_dispatch_job;
  v_scope text := 'unmatched';
  v_event text;
  v_suspend jsonb := NULL;
  v_id uuid;
  v_bounce text;
BEGIN
  IF p_signature_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'OC401 signature_required' USING ERRCODE='P0001';
  END IF;
  IF p_normalized_event_type NOT IN
     ('delivered','delayed','bounced','complained','opened','clicked','sent') THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'unsupported_event_type');
  END IF;

  SELECT * INTO v_att FROM public.omni_comms_delivery_attempt
   WHERE provider_message_id = p_provider_message_id
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    v_scope := 'business';
    SELECT * INTO v_job FROM public.omni_comms_dispatch_job WHERE id = v_att.dispatch_job_id;
  END IF;

  INSERT INTO public.omni_comms_webhook_event (
    provider_code, provider_event_id, provider_message_id, raw_event_type,
    normalized_event_type, signature_verified, occurred_at, scope,
    delivery_attempt_id, message_id, organization_id,
    payload_summary, payload_digest, processing_result)
  VALUES (
    p_provider_code, p_provider_event_id, p_provider_message_id, p_raw_event_type,
    p_normalized_event_type, true, p_occurred_at, v_scope,
    v_att.id, v_att.message_id, v_att.organization_id,
    coalesce(p_payload_summary, '{}'::jsonb), p_payload_digest,
    CASE WHEN v_scope = 'business' THEN 'recorded' ELSE 'ignored' END)
  ON CONFLICT (provider_code, provider_event_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'duplicate_event');
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

  IF p_normalized_event_type = 'delivered' THEN
    UPDATE public.omni_comms_message SET status = 'delivered', completed_at = now(),
           updated_at = now()
     WHERE id = v_att.message_id AND status = 'accepted';
  END IF;

  v_bounce := lower(coalesce(p_payload_summary->>'bounce_type',''));
  IF p_normalized_event_type = 'complained'
     OR (p_normalized_event_type = 'bounced' AND v_bounce IN ('hard','permanent')) THEN
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

  RETURN jsonb_build_object('recorded', true, 'code', 'callback_recorded',
                            'scope', v_scope, 'suspension', v_suspend);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_record_callback(text,text,text,text,text,timestamptz,jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_record_callback(text,text,text,text,text,timestamptz,jsonb,text,boolean) TO service_role;

-- ---------------------------------------------------------------------
-- 8. Expired-lease reclamation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_reclaim_expired_leases()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_n integer := 0; v_a record;
BEGIN
  FOR v_a IN
    SELECT a.id, a.dispatch_job_id, a.message_id, a.organization_id, a.attempt_number
      FROM public.omni_comms_delivery_attempt a
     WHERE a.status IN ('started','dispatching')
       AND a.lease_expires_at IS NOT NULL
       AND a.lease_expires_at < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.omni_comms_delivery_attempt
       SET status = CASE WHEN attempt_number >= 3 THEN 'exhausted' ELSE 'outcome_unknown' END,
           completed_at = now(), claim_token = NULL,
           error_code = 'lease_expired',
           error_detail = 'The dispatch lease expired before an outcome was recorded.'
     WHERE id = v_a.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = CASE WHEN v_a.attempt_number >= 3 THEN 'failed' ELSE 'retry_wait' END,
           is_runnable = false, next_attempt_at = now() + interval '2 minutes',
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_a.dispatch_job_id AND status = 'processing';

    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('reclaimed', v_n);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_reclaim_expired_leases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_reclaim_expired_leases() TO service_role;

-- ---------------------------------------------------------------------
-- 9. Operator tick authorization (no sensitive input accepted)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_dispatch_tick_authorize()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'authentication_required');
  END IF;
  IF NOT public.has_permission(v_uid, 'omni_comms', 'operate') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'permission_denied');
  END IF;
  RETURN jsonb_build_object('allowed', true, 'code', 'authorized',
                            'max_batch_limit', 10);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_dispatch_tick_authorize() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_dispatch_tick_authorize() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. Read-only dispatcher diagnostics for Operations / Readiness
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_dispatch_diagnostics(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid := auth.uid(); v_rel public.omni_comms_channel_release_control;
BEGIN
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001';
  END IF;
  v_rel := public.omni_comms_priv_channel_release_effective(
             p_organization_id, p_department_id, 'email');

  RETURN jsonb_build_object(
    'dispatcher_implemented', true,
    'live_delivery_enabled', false,
    'release_live_state_available', false,
    'dispatchable_channels', jsonb_build_array('email'),
    'eligible_jobs', (
      SELECT count(*) FROM public.omni_comms_dispatch_job j
       WHERE j.channel='email' AND j.mode='queued'
         AND j.status IN ('held','retry_wait') AND j.organization_id = p_organization_id),
    'in_flight_attempts', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
       WHERE a.organization_id = p_organization_id
         AND a.status IN ('started','dispatching')),
    'business_attempts_total', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
       WHERE a.organization_id = p_organization_id),
    'business_accepted_total', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
       WHERE a.organization_id = p_organization_id AND a.status = 'accepted'),
    'business_delivered_total', (
      SELECT count(*) FROM public.omni_comms_webhook_event w
       WHERE w.organization_id = p_organization_id
         AND w.normalized_event_type = 'delivered'),
    'queued_producer_binding_count', (
      SELECT count(*) FROM public.omni_comms_producer_event_binding b
       WHERE b.status = 'active' AND 'queued' = ANY (b.allowed_modes)),
    'release_state', v_rel.release_state,
    'blocker', CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.omni_comms_producer_event_binding b
         WHERE b.status = 'active' AND 'queued' = ANY (b.allowed_modes))
      THEN 'pilot_business_producer_not_selected' ELSE NULL END);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_dispatch_diagnostics(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_dispatch_diagnostics(uuid,uuid) TO authenticated, service_role;