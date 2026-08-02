CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_claim_email(p_worker text, p_batch_limit integer, p_correlation_id text, p_deployed_revision text, p_scopes jsonb DEFAULT NULL::jsonb, p_execution_context text DEFAULT 'operator'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit      integer;
  v_scan_limit integer;
  v_worker     text := left(coalesce(nullif(btrim(p_worker), ''), 'omni-comms-dispatch'), 120);
  v_corr       text := left(coalesce(p_correlation_id, ''), 120);
  v_ctx        text := lower(coalesce(nullif(btrim(p_execution_context), ''), 'operator'));
  v_job        record;
  v_rel        public.omni_comms_channel_release_control;
  v_cert       jsonb;
  v_decision   jsonb;
  v_recipient  text;
  v_norm       jsonb;
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
  v_endpoint   public.omni_comms_channel_endpoint%ROWTYPE;
  v_binding_count integer;
  v_provider_code text;
  v_token      text;
  v_attempt_id uuid;
  v_attempt_no integer;
  v_idem       text;
  v_deny       text;
  v_suspension jsonb;
BEGIN
  IF v_ctx NOT IN ('operator','scheduler') THEN
    RAISE EXCEPTION 'OC422 invalid_execution_context' USING ERRCODE='P0001';
  END IF;

  -- Strict batch limit. A supplied out-of-range value is REJECTED, never
  -- silently clamped. Absence defaults to one.
  IF p_batch_limit IS NULL THEN
    v_limit := 1;
  ELSIF p_batch_limit < 1 OR p_batch_limit > 10 THEN
    RAISE EXCEPTION 'OC422 invalid_batch_limit' USING ERRCODE='P0001';
  ELSE
    v_limit := p_batch_limit;
  END IF;

  IF v_ctx = 'operator'
     AND (p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'array'
          OR jsonb_array_length(p_scopes) = 0) THEN
    RETURN jsonb_build_object('scanned_jobs', 0, 'claimed_jobs', 0,
      'claims', '[]'::jsonb, 'blockers', '[]'::jsonb,
      'blocker', 'operator_scope_required', 'live_delivery_enabled', false);
  END IF;

  v_cert := public.omni_comms_priv_certification_posture();
  v_scan_limit := greatest(v_limit * 5, 25);

  FOR v_job IN
    SELECT j.*, m.recipient_id, m.rendered_subject, m.rendered_text, m.rendered_html,
           m.sender_identity_id, m.provider_id AS msg_provider_id,
           m.provider_account_id AS msg_provider_account_id,
           m.department_id AS msg_department_id, m.status AS message_status,
           r.caller_module_code, r.event_definition_id,
           ed.event_code
      FROM public.omni_comms_dispatch_job j
      JOIN public.omni_comms_message m  ON m.id = j.message_id
      JOIN public.omni_comms_request r  ON r.id = j.request_id
      JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
     WHERE j.channel = 'email'
       AND j.mode = 'queued'
       AND j.attempt_count < 3
       AND coalesce(j.next_attempt_at, now()) <= now()
       -- Status-paired eligibility. An initial controlled dispatch and a safe
       -- retry are the ONLY two claimable shapes. A reconciliation hold, a
       -- completed/failed/cancelled job and an accepted/delivered/failed
       -- message can never be claimed, because neither pair matches.
       AND (
         (j.status = 'held'       AND m.status IN ('held','queued'))
         OR
         (j.status = 'retry_wait' AND m.status = 'dispatching')
       )
       AND (
         v_ctx = 'scheduler'
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_scopes) s
            WHERE (s->>'organization_id')::uuid = j.organization_id
              AND ( s->>'department_id' IS NULL
                    OR (s->>'department_id')::uuid IS NOT DISTINCT FROM m.department_id)
         ))
     ORDER BY j.priority, j.created_at
     LIMIT v_scan_limit
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    EXIT WHEN v_claimed >= v_limit;
    v_scanned := v_scanned + 1;
    v_deny := NULL;
    v_norm := NULL;
    v_hash := NULL;

    -- (a) Lock the governing Release Control row.
    v_rel := public.omni_comms_priv_channel_release_effective(
               v_job.organization_id, v_job.msg_department_id, 'email');
    IF v_rel.id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object('job_id', v_job.id, 'code', 'release_control_missing');
      CONTINUE;
    END IF;
    SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
      WHERE id = v_rel.id FOR UPDATE;

    -- (b) Immutable rendering-time release snapshot is COMPARED, never rewritten.
    IF v_job.release_control_id IS NULL
       OR v_job.release_fingerprint_at_decision IS NULL THEN
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

    -- (c) Canonical recipient normalisation — identical to the Test Centre.
    IF v_deny IS NULL THEN
      SELECT rc.email_destination INTO v_recipient
        FROM public.omni_comms_recipient rc WHERE rc.id = v_job.recipient_id;
      v_norm := public.omni_comms_priv_channel_test_normalize_target('email', coalesce(v_recipient,''));
      IF coalesce((v_norm->>'valid')::boolean, false) IS NOT TRUE THEN
        v_deny := coalesce(v_norm->>'code', 'recipient_invalid');
      ELSE
        v_hash := lower(v_norm->>'target_hash');
      END IF;
    END IF;

    -- (d) Read-only decision evidence from the C6 oracle. ALL THREE gates are
    --     ENFORCED here, not merely reported.
    IF v_deny IS NULL THEN
      v_decision := public.omni_comms_priv_channel_release_decision(
        v_job.organization_id, v_job.msg_department_id, 'email',
        v_job.event_code, v_job.caller_module_code, 'queued',
        ARRAY[v_hash], 1, p_deployed_revision);
      IF coalesce((v_decision->>'allowed')::boolean, false) IS NOT TRUE THEN
        v_deny := coalesce(v_decision->>'code', 'release_denied');
      ELSIF coalesce((v_decision->>'business_dispatch_enabled')::boolean, false) IS NOT TRUE THEN
        v_deny := 'business_dispatch_disabled';
      ELSIF coalesce((v_decision->>'recipient_rules_satisfied')::boolean, false) IS NOT TRUE THEN
        v_deny := 'recipient_not_permitted';
      END IF;
    END IF;

    -- (e) Certification gate, recomputed inside the claim transaction.
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

    -- (e2) Live delivery must never be enabled on the governing policy.
    IF v_deny IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.omni_comms_channel_setting cs
         WHERE cs.channel = 'email'
           AND cs.organization_id = v_job.organization_id
           AND cs.live_delivery_enabled IS TRUE) THEN
        v_deny := 'live_delivery_enabled_unexpected';
      END IF;
    END IF;

    -- (f) Transactional volume recalculation against the LOCKED release row.
    IF v_deny IS NULL THEN
      SELECT count(*) INTO v_hour FROM public.omni_comms_delivery_attempt a
        WHERE a.release_control_id = v_rel.id AND a.created_at > now() - interval '1 hour';
      SELECT count(*) INTO v_day FROM public.omni_comms_delivery_attempt a
        WHERE a.release_control_id = v_rel.id AND a.created_at > now() - interval '1 day';
      SELECT count(DISTINCT a.message_id) INTO v_total FROM public.omni_comms_delivery_attempt a
        WHERE a.release_control_id = v_rel.id;
      IF v_rel.max_messages_per_hour IS NULL OR v_rel.max_messages_per_day IS NULL
         OR v_rel.max_messages_total IS NULL THEN
        v_deny := 'volume_integrity_failure';
      ELSIF v_hour + 1 > v_rel.max_messages_per_hour
         OR v_day + 1 > v_rel.max_messages_per_day
         OR (NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a
                          WHERE a.release_control_id = v_rel.id
                            AND a.message_id = v_job.message_id)
             AND v_total + 1 > v_rel.max_messages_total) THEN
        v_deny := 'release_limit_exceeded';
      END IF;
    END IF;

    -- (g) EXACT persisted provider resolution. No fallback, no re-selection,
    --     no unrelated organisation-level substitute.
    IF v_deny IS NULL THEN
      v_identity := NULL; v_binding := NULL; v_account := NULL;
      v_endpoint := NULL; v_provider_code := NULL; v_secret := NULL;
      v_binding_count := 0;

      IF v_job.sender_identity_id IS NULL
         OR v_job.msg_provider_account_id IS NULL
         OR v_job.msg_provider_id IS NULL THEN
        v_deny := 'resolution_snapshot_incomplete';
      ELSE
        SELECT * INTO v_identity FROM public.omni_comms_sender_identity
          WHERE id = v_job.sender_identity_id;
        SELECT * INTO v_account FROM public.omni_comms_provider_account
          WHERE id = v_job.msg_provider_account_id;

        SELECT count(*) INTO v_binding_count
          FROM public.omni_comms_sender_provider_binding b
         WHERE b.sender_identity_id = v_job.sender_identity_id
           AND b.provider_account_id = v_job.msg_provider_account_id
           AND b.status = 'active'
           AND coalesce(b.data_origin,'') <> 'reference_seed'
           AND b.verification_status = 'verified';

        SELECT * INTO v_binding FROM public.omni_comms_sender_provider_binding b
          WHERE b.sender_identity_id = v_job.sender_identity_id
            AND b.provider_account_id = v_job.msg_provider_account_id
            AND b.status = 'active'
            AND coalesce(b.data_origin,'') <> 'reference_seed'
            AND b.verification_status = 'verified'
          ORDER BY b.priority NULLS LAST, b.created_at
          LIMIT 1;

        IF v_binding.channel_endpoint_id IS NOT NULL THEN
          SELECT * INTO v_endpoint FROM public.omni_comms_channel_endpoint
            WHERE id = v_binding.channel_endpoint_id;
        END IF;

        SELECT p.code INTO v_provider_code
          FROM public.omni_comms_provider p WHERE p.id = v_account.provider_id;
        SELECT s.secret_ref INTO v_secret
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = 'api_key'
         LIMIT 1;

        IF v_identity.id IS NULL OR v_identity.status <> 'active'
           OR coalesce(v_identity.data_origin,'') = 'reference_seed'
           OR coalesce(v_identity.channel,'') <> 'email' THEN
          v_deny := 'identity_not_operational';
        ELSIF v_identity.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'identity_tenant_mismatch';
        ELSIF v_identity.department_id IS NOT NULL
          AND v_identity.department_id IS DISTINCT FROM v_job.msg_department_id THEN
          v_deny := 'identity_department_mismatch';
        ELSIF v_binding_count > 1 THEN
          v_deny := 'binding_ambiguous';
        ELSIF v_binding.id IS NULL THEN
          v_deny := 'binding_not_operational';
        ELSIF v_binding.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'binding_tenant_mismatch';
        ELSIF v_binding.department_id IS NOT NULL
          AND v_binding.department_id IS DISTINCT FROM v_job.msg_department_id THEN
          v_deny := 'binding_department_mismatch';
        ELSIF v_account.id IS NULL
           OR v_account.status <> 'active'
           OR coalesce(v_account.data_origin,'') = 'reference_seed'
           OR v_account.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'provider_account_not_operational';
        ELSIF v_account.provider_id IS DISTINCT FROM v_job.msg_provider_id THEN
          v_deny := 'provider_identity_ambiguous';
        ELSIF coalesce(v_account.verification_status,'') <> 'verified' THEN
          v_deny := 'provider_account_not_verified';
        ELSIF coalesce(v_provider_code,'') <> 'resend_email' THEN
          v_deny := 'provider_not_supported';
        ELSIF v_binding.channel_endpoint_id IS NULL THEN
          v_deny := 'endpoint_missing';
        ELSIF v_endpoint.id IS NULL
           OR v_endpoint.status <> 'active'
           OR v_endpoint.verification_status <> 'verified'
           OR coalesce(v_endpoint.endpoint_type,'') <> 'sending_domain'
           OR coalesce(v_endpoint.channel,'') <> 'email'
           OR coalesce(v_endpoint.data_origin,'') = 'reference_seed' THEN
          v_deny := 'endpoint_not_verified';
        ELSIF v_endpoint.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'endpoint_tenant_mismatch';
        ELSIF v_endpoint.department_id IS NOT NULL
          AND v_endpoint.department_id IS DISTINCT FROM v_job.msg_department_id THEN
          v_deny := 'endpoint_department_mismatch';
        ELSIF coalesce(v_secret,'') !~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
          v_deny := 'secret_reference_invalid';
        END IF;
      END IF;
    END IF;

    IF v_deny IS NOT NULL THEN
      -- Automatic bounded safety suspension for genuine integrity failures
      -- detected while a controlled pilot is ACTIVE.
      v_suspension := public.omni_comms_priv_dispatch_claim_safety_suspend(
                        v_rel.id, v_deny, v_job.id);

      UPDATE public.omni_comms_dispatch_job
         SET hold_reason = left(v_deny, 200),
             is_runnable = false,
             next_attempt_at = greatest(coalesce(next_attempt_at, now()), now()) + interval '1 minute',
             updated_at = now()
       WHERE id = v_job.id;
      v_blockers := v_blockers || jsonb_build_object(
        'job_id', v_job.id, 'code', v_deny,
        'pilot_suspended', coalesce((v_suspension->>'suspended')::boolean, false));
      CONTINUE;
    END IF;

    -- (h) Claim: held/retry_wait -> ready -> leased -> processing.
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_attempt_no := v_job.attempt_count + 1;
    v_idem := 'omni-comms/c7/' || v_job.message_id::text;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'ready', is_runnable = true, hold_reason = NULL, updated_at = now()
     WHERE id = v_job.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'leased', lock_token = v_token, locked_at = now(),
           locked_by = v_worker, lease_expires_at = now() + interval '2 minutes',
           attempt_count = v_attempt_no, updated_at = now()
     WHERE id = v_job.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'processing', updated_at = now()
     WHERE id = v_job.id;

    -- Message state is advanced ONLY for an initial controlled dispatch
    -- (held -> queued -> dispatching). A retry claim finds the message already
    -- dispatching and MUST NOT move it backwards to queued or held.
    IF v_job.message_status IN ('held','queued') THEN
      IF v_job.message_status = 'held' THEN
        UPDATE public.omni_comms_message SET status = 'queued', updated_at = now()
         WHERE id = v_job.message_id;
      END IF;
      UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;

    -- (i) Reserve volume by writing the attempt BEFORE any provider call.
    INSERT INTO public.omni_comms_delivery_attempt (
      dispatch_job_id, message_id, organization_id, provider_id, provider_account_id,
      attempt_number, status, started_at, claim_token, claimed_at, lease_expires_at,
      worker_id, provider_idempotency_key, release_control_id,
      release_version_at_claim, release_state_at_claim, release_fingerprint_at_claim,
      release_expires_at_claim, certified_commit_at_claim, deployed_revision_at_claim,
      recipient_hash, recipient_rule_matched, execution_context,
      claim_decision_snapshot, safe_request_metadata
    ) VALUES (
      v_job.id, v_job.message_id, v_job.organization_id,
      v_account.provider_id, v_account.id,
      v_attempt_no, 'dispatching', now(), v_token, now(), now() + interval '2 minutes',
      v_worker, v_idem, v_rel.id,
      v_rel.release_version, v_rel.release_state, v_rel.release_fingerprint,
      v_rel.release_expires_at,
      lower(coalesce(v_cert->>'certified_commit','')),
      lower(coalesce(p_deployed_revision,'')),
      v_hash, true, v_ctx,
      jsonb_build_object(
        'code', v_decision->>'code',
        'release_version', v_rel.release_version,
        'release_state', v_rel.release_state,
        'business_dispatch_enabled', v_decision->>'business_dispatch_enabled',
        'recipient_rule_match_count', v_decision->>'recipient_rule_match_count',
        'certified_commit', v_cert->>'certified_commit'),
      jsonb_build_object('channel','email','mode','queued',
                         'event_code', v_job.event_code,
                         'caller_module_code', v_job.caller_module_code,
                         'recipient_masked', v_norm->>'target_masked',
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
                              'execution_context', v_ctx,
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
      'recipient', lower(btrim(v_recipient)),
      'subject', v_job.rendered_subject,
      'text_body', v_job.rendered_text,
      'html_body', v_job.rendered_html,
      'provider_idempotency_key', v_idem,
      'lease_expires_at', now() + interval '2 minutes');
  END LOOP;

  RETURN jsonb_build_object(
    'scanned_jobs', v_scanned,
    'claimed_jobs', v_claimed,
    'execution_context', v_ctx,
    'claims', v_claims,
    'blockers', v_blockers,
    'blocker', CASE WHEN v_claimed = 0 AND v_scanned = 0
                    THEN 'pilot_business_producer_not_selected' ELSE NULL END,
    'live_delivery_enabled', false);
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text) TO service_role;