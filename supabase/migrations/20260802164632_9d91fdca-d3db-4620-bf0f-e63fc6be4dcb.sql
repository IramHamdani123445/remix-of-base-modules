-- =====================================================================
-- Omni-Comms Phase C7 Closure Correction
-- Controlled business Email dispatch safety, evidence, tenant isolation
-- Fail-closed. No pilot activation. No live delivery.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Bounded vocabulary extensions
-- ---------------------------------------------------------------------
ALTER TABLE public.omni_comms_message DROP CONSTRAINT IF EXISTS omni_comms_message_status_check;
ALTER TABLE public.omni_comms_message ADD CONSTRAINT omni_comms_message_status_check
  CHECK (status = ANY (ARRAY['pending','rendered','blocked','dry_run_completed','shadow_completed',
                             'queued','held','dispatching','accepted','delivered','failed','cancelled',
                             'reconciliation_required']));

ALTER TABLE public.omni_comms_message_event DROP CONSTRAINT IF EXISTS omni_comms_message_event_event_type_check;
ALTER TABLE public.omni_comms_message_event ADD CONSTRAINT omni_comms_message_event_event_type_check
  CHECK (event_type = ANY (ARRAY['request_accepted','request_processing','recipient_resolved','recipient_blocked',
    'message_rendered','message_blocked','dry_run_completed','shadow_completed','dispatch_queued','dispatch_held',
    'request_completed','request_failed','dispatch_ready','dispatch_claimed','dispatch_leased','dispatch_lease_expired',
    'dispatch_cancelled','provider_attempt_started','provider_accepted','provider_rejected','provider_outcome_unknown',
    'provider_retry_scheduled','provider_attempts_exhausted','callback_delivered','callback_delayed','callback_bounced',
    'callback_complained','callback_opened','callback_clicked','pilot_suspended',
    'reconciliation_required','reconciliation_resolved','callback_ambiguous','callback_ignored']));

-- ---------------------------------------------------------------------
-- B. Delivery-attempt claim-time evidence + payload fingerprint
-- ---------------------------------------------------------------------
ALTER TABLE public.omni_comms_delivery_attempt
  ADD COLUMN IF NOT EXISTS release_expires_at_claim timestamptz,
  ADD COLUMN IF NOT EXISTS deployed_revision_at_claim text,
  ADD COLUMN IF NOT EXISTS claim_decision_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS provider_payload_hash text,
  ADD COLUMN IF NOT EXISTS recipient_rule_matched boolean,
  ADD COLUMN IF NOT EXISTS execution_context text,
  ADD COLUMN IF NOT EXISTS reconciliation_state text;

ALTER TABLE public.omni_comms_delivery_attempt
  DROP CONSTRAINT IF EXISTS omni_comms_delivery_attempt_reconciliation_chk;
ALTER TABLE public.omni_comms_delivery_attempt
  ADD CONSTRAINT omni_comms_delivery_attempt_reconciliation_chk
  CHECK (reconciliation_state IS NULL
         OR reconciliation_state = ANY (ARRAY['required','resolved','abandoned']));

ALTER TABLE public.omni_comms_delivery_attempt
  DROP CONSTRAINT IF EXISTS omni_comms_delivery_attempt_execution_context_chk;
ALTER TABLE public.omni_comms_delivery_attempt
  ADD CONSTRAINT omni_comms_delivery_attempt_execution_context_chk
  CHECK (execution_context IS NULL
         OR execution_context = ANY (ARRAY['operator','scheduler']));

-- One provider reference can belong to exactly one business attempt.
CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_delivery_attempt_provider_msg_uq
  ON public.omni_comms_delivery_attempt (provider_message_id)
  WHERE provider_message_id IS NOT NULL AND provider_idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------
-- B2. Terminal-evidence immutability
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_delivery_attempt_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE
  v_terminal text[] := ARRAY['accepted','rejected','failed','timed_out','exhausted','cancelled'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OC409 delivery_attempt_immutable'
      USING ERRCODE='P0001', DETAIL='delivery attempt evidence cannot be deleted';
  END IF;

  IF OLD.status = ANY (v_terminal) THEN
    -- Terminal rows accept no further mutation at all.
    RAISE EXCEPTION 'OC409 delivery_attempt_immutable'
      USING ERRCODE='P0001', DETAIL='terminal delivery attempt evidence is immutable';
  END IF;

  IF OLD.status = 'outcome_unknown'
     AND coalesce(current_setting('omni_comms.reconciliation', true), '') <> 'on' THEN
    RAISE EXCEPTION 'OC409 reconciliation_required'
      USING ERRCODE='P0001',
            DETAIL='an outcome_unknown attempt may only be resolved by verified reconciliation';
  END IF;

  -- Claim-time evidence is append-once.
  IF OLD.claim_token IS NOT NULL
     AND NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key THEN
    RAISE EXCEPTION 'OC409 idempotency_key_immutable' USING ERRCODE='P0001';
  END IF;
  IF OLD.recipient_hash IS NOT NULL
     AND NEW.recipient_hash IS DISTINCT FROM OLD.recipient_hash THEN
    RAISE EXCEPTION 'OC409 recipient_hash_immutable' USING ERRCODE='P0001';
  END IF;
  IF OLD.release_fingerprint_at_claim IS NOT NULL
     AND NEW.release_fingerprint_at_claim IS DISTINCT FROM OLD.release_fingerprint_at_claim THEN
    RAISE EXCEPTION 'OC409 release_evidence_immutable' USING ERRCODE='P0001';
  END IF;

  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS omni_comms_delivery_attempt_immutable_trg ON public.omni_comms_delivery_attempt;
CREATE TRIGGER omni_comms_delivery_attempt_immutable_trg
  BEFORE UPDATE OR DELETE ON public.omni_comms_delivery_attempt
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_delivery_attempt_immutable();

-- ---------------------------------------------------------------------
-- C. is_runnable is a derived invariant, never a stored decision
-- ---------------------------------------------------------------------
UPDATE public.omni_comms_dispatch_job
   SET is_runnable = false
 WHERE is_runnable IS TRUE AND status <> 'ready';

CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_job_runnable_invariant()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','public' AS $fn$
BEGIN
  IF NEW.status <> 'ready' THEN
    NEW.is_runnable := false;
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS omni_comms_dispatch_job_runnable_trg ON public.omni_comms_dispatch_job;
CREATE TRIGGER omni_comms_dispatch_job_runnable_trg
  BEFORE INSERT OR UPDATE ON public.omni_comms_dispatch_job
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_dispatch_job_runnable_invariant();

ALTER TABLE public.omni_comms_dispatch_job
  DROP CONSTRAINT IF EXISTS omni_comms_dispatch_job_runnable_chk;
ALTER TABLE public.omni_comms_dispatch_job
  ADD CONSTRAINT omni_comms_dispatch_job_runnable_chk
  CHECK (is_runnable IS NOT TRUE OR status = 'ready');

-- ---------------------------------------------------------------------
-- D. Tenant-scoped operator authorisation projection
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_operator_scopes(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE
  v_privileged boolean;
  v_scopes jsonb := '[]'::jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'authentication_required', 'scopes', '[]'::jsonb);
  END IF;
  IF NOT public.has_permission(p_actor, 'omni_comms', 'operate') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'permission_denied', 'scopes', '[]'::jsonb);
  END IF;

  v_privileged := public.is_admin(p_actor)
                  OR public.has_permission(p_actor, 'omni_comms', 'administer');

  IF v_privileged THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'organization_id', o.id, 'department_id', NULL)), '[]'::jsonb)
      INTO v_scopes
      FROM public.core_organization o
     WHERE coalesce(lower(o.status),'active') NOT IN ('retired','archived','deleted');
  ELSE
    SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
             'organization_id', d.organization_id, 'department_id', d.id)), '[]'::jsonb)
      INTO v_scopes
      FROM public.core_staff_assignments a
      JOIN public.core_department d ON d.id = a.department_id
     WHERE a.user_id = p_actor
       AND a.is_active = true
       AND a.assignment_status = 'ACTIVE'
       AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
       AND coalesce(d.is_active, true);
  END IF;

  IF jsonb_array_length(v_scopes) = 0 THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'no_operable_scope', 'scopes', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'authorized',
    'privileged', v_privileged,
    'scopes', v_scopes);
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_operator_scopes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_operator_scopes(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_dispatch_tick_authorize()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_scopes jsonb;
BEGIN
  v_scopes := public.omni_comms_priv_dispatch_operator_scopes(v_uid);
  IF coalesce((v_scopes->>'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'code', v_scopes->>'code',
                              'scopes', '[]'::jsonb, 'max_batch_limit', 0);
  END IF;
  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'authorized',
    'execution_context', 'operator',
    'max_batch_limit', 10,
    'scopes', v_scopes->'scopes');
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_dispatch_tick_authorize() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_dispatch_tick_authorize() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- E. Prerequisite check 32 becomes a truthful C7 dispatcher check
-- ---------------------------------------------------------------------
DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_channel_release_prerequisites';

  v_src := replace(v_src,
    $q$jsonb_build_object('sequence',32,'code','business_dispatch_not_implemented_c6','state','not_implemented','detail','Release governance is active, but business provider dispatch is introduced only in C7.')$q$,
    $q$jsonb_build_object('sequence',32,'code','business_dispatch_dispatcher_installed','state',CASE WHEN to_regprocedure('public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)') IS NOT NULL AND to_regprocedure('public.omni_comms_priv_dispatch_attempt_complete(uuid,text,text,text,integer,jsonb,text,text)') IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Controlled business dispatch RPCs are installed; without them dispatch fails closed.')$q$);

  EXECUTE v_src;
END $do$;

-- ---------------------------------------------------------------------
-- F. Decision oracle reports business dispatch truthfully
-- ---------------------------------------------------------------------
DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_channel_release_decision';

  v_src := replace(v_src,
    $q$'business_dispatch_enabled', false$q$,
    $q$'business_dispatch_enabled', (v_allowed AND to_regprocedure('public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)') IS NOT NULL)$q$);

  EXECUTE v_src;
END $do$;

-- ---------------------------------------------------------------------
-- G. Corrected claim RPC
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_claim_email(text,integer,text,text);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_claim_email(
  p_worker text,
  p_batch_limit integer,
  p_correlation_id text,
  p_deployed_revision text,
  p_scopes jsonb,
  p_execution_context text DEFAULT 'operator'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE
  v_limit      integer := least(greatest(coalesce(p_batch_limit, 1), 1), 10);
  v_scan_limit integer;
  v_worker     text := left(coalesce(nullif(btrim(p_worker), ''), 'omni-comms-dispatch'), 120);
  v_corr       text := left(coalesce(p_correlation_id, ''), 120);
  v_ctx        text := lower(coalesce(nullif(btrim(p_execution_context), ''), 'operator'));
  v_job        record;
  v_rel        public.omni_comms_channel_release_control;
  v_cur        public.omni_comms_channel_release_control;
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
  v_provider_code text;
  v_token      text;
  v_attempt_id uuid;
  v_attempt_no integer;
  v_idem       text;
  v_deny       text;
BEGIN
  IF v_ctx NOT IN ('operator','scheduler') THEN
    RAISE EXCEPTION 'OC422 invalid_execution_context' USING ERRCODE='P0001';
  END IF;

  -- Tenant isolation: an operator tick MUST carry an authorised scope set.
  IF v_ctx = 'operator'
     AND (p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'array'
          OR jsonb_array_length(p_scopes) = 0) THEN
    RETURN jsonb_build_object('scanned_jobs', 0, 'claimed_jobs', 0,
      'claims', '[]'::jsonb, 'blockers', '[]'::jsonb,
      'blocker', 'operator_scope_required', 'live_delivery_enabled', false);
  END IF;

  v_cert := public.omni_comms_priv_certification_posture();
  -- Starvation resistance: scan wider than the claim budget so that a run of
  -- permanently blocked jobs cannot hide a claimable one.
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
       AND j.status IN ('held','retry_wait')
       AND j.attempt_count < 3
       AND coalesce(j.next_attempt_at, now()) <= now()
       AND m.status IN ('held','queued')
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

    -- (b) Rendering-time release snapshot is immutable evidence. It is
    --     COMPARED here, never rewritten. A drifted snapshot fails closed.
    IF v_job.release_control_id IS NULL
       OR v_job.release_fingerprint_at_decision IS NULL THEN
      v_deny := 'release_snapshot_missing';
    ELSIF v_job.release_control_id IS DISTINCT FROM v_rel.id
       OR v_job.release_version_at_decision IS DISTINCT FROM v_rel.release_version
       OR v_job.release_state_at_decision IS DISTINCT FROM v_rel.release_state
       OR v_job.release_fingerprint_at_decision IS DISTINCT FROM v_rel.release_fingerprint THEN
      v_deny := 'release_snapshot_stale';
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

    -- (d) Read-only decision evidence from the C6 oracle.
    IF v_deny IS NULL THEN
      v_decision := public.omni_comms_priv_channel_release_decision(
        v_job.organization_id, v_job.msg_department_id, 'email',
        v_job.event_code, v_job.caller_module_code, 'queued',
        ARRAY[v_hash], 1, p_deployed_revision);
      IF coalesce((v_decision->>'allowed')::boolean, false) IS NOT TRUE THEN
        v_deny := coalesce(v_decision->>'code', 'release_denied');
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

    -- (f) Transactional volume recalculation against the LOCKED release row.
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

    -- (g) EXACT persisted provider resolution. No fallback, no re-selection.
    IF v_deny IS NULL THEN
      v_identity := NULL; v_binding := NULL; v_account := NULL;
      v_endpoint := NULL; v_provider_code := NULL; v_secret := NULL;

      SELECT * INTO v_identity FROM public.omni_comms_sender_identity
        WHERE id = v_job.sender_identity_id;
      SELECT * INTO v_account FROM public.omni_comms_provider_account
        WHERE id = v_job.msg_provider_account_id;

      IF v_job.sender_identity_id IS NULL OR v_job.msg_provider_account_id IS NULL THEN
        v_deny := 'resolution_snapshot_incomplete';
      ELSE
        SELECT * INTO v_binding FROM public.omni_comms_sender_provider_binding
          WHERE sender_identity_id = v_job.sender_identity_id
            AND provider_account_id = v_job.msg_provider_account_id
            AND status = 'active'
            AND coalesce(data_origin,'') <> 'reference_seed'
            AND verification_status = 'verified'
          LIMIT 1;

        IF v_binding.channel_endpoint_id IS NOT NULL THEN
          SELECT * INTO v_endpoint FROM public.omni_comms_channel_endpoint
            WHERE id = v_binding.channel_endpoint_id;
        END IF;

        SELECT code INTO v_provider_code FROM public.omni_comms_provider WHERE id = v_account.provider_id;
        SELECT s.secret_ref INTO v_secret
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id = v_account.id AND s.purpose = 'api_key'
         LIMIT 1;

        IF v_identity.id IS NULL OR v_identity.status <> 'active'
           OR coalesce(v_identity.data_origin,'') = 'reference_seed' THEN
          v_deny := 'identity_not_operational';
        ELSIF v_identity.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'identity_tenant_mismatch';
        ELSIF v_binding.id IS NULL THEN
          v_deny := 'binding_not_operational';
        ELSIF v_binding.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'binding_tenant_mismatch';
        ELSIF v_account.id IS NULL
           OR v_account.status <> 'active'
           OR coalesce(v_account.data_origin,'') = 'reference_seed'
           OR v_account.organization_id IS DISTINCT FROM v_job.organization_id THEN
          v_deny := 'provider_account_not_operational';
        ELSIF coalesce(v_provider_code,'') <> 'resend_email' THEN
          v_deny := 'provider_not_supported';
        ELSIF v_binding.channel_endpoint_id IS NOT NULL
           AND (v_endpoint.id IS NULL OR v_endpoint.status <> 'active'
                OR v_endpoint.verification_status <> 'verified') THEN
          v_deny := 'endpoint_not_verified';
        ELSIF coalesce(v_secret,'') !~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
          v_deny := 'secret_reference_invalid';
        END IF;
      END IF;
    END IF;

    IF v_deny IS NOT NULL THEN
      -- Record the refusal on the job so the same blocked job cannot be
      -- rescanned indefinitely inside the same tick window.
      UPDATE public.omni_comms_dispatch_job
         SET hold_reason = left(v_deny, 200),
             is_runnable = false,
             next_attempt_at = greatest(coalesce(next_attempt_at, now()), now()) + interval '1 minute',
             updated_at = now()
       WHERE id = v_job.id;
      v_blockers := v_blockers || jsonb_build_object('job_id', v_job.id, 'code', v_deny);
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

    IF v_job.message_status = 'held' THEN
      UPDATE public.omni_comms_message SET status = 'queued', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;
    UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
     WHERE id = v_job.message_id;

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
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text) TO service_role;

-- ---------------------------------------------------------------------
-- H. Provider payload fingerprint gate (runs BEFORE the provider is called)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_record_payload_hash(
  p_attempt_id uuid,
  p_claim_token text,
  p_payload_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE
  v_att public.omni_comms_delivery_attempt;
  v_prior text;
BEGIN
  IF coalesce(p_payload_hash,'') !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'payload_hash_invalid');
  END IF;

  SELECT * INTO v_att FROM public.omni_comms_delivery_attempt
   WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  END IF;
  IF v_att.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_claim');
  END IF;

  SELECT a.provider_payload_hash INTO v_prior
    FROM public.omni_comms_delivery_attempt a
   WHERE a.message_id = v_att.message_id
     AND a.provider_idempotency_key = v_att.provider_idempotency_key
     AND a.id <> v_att.id
     AND a.provider_payload_hash IS NOT NULL
   ORDER BY a.attempt_number
   LIMIT 1;

  IF v_prior IS NOT NULL AND v_prior <> lower(p_payload_hash) THEN
    RETURN jsonb_build_object('ok', false,
      'code', 'provider_payload_changed_for_idempotency_key');
  END IF;

  UPDATE public.omni_comms_delivery_attempt
     SET provider_payload_hash = lower(p_payload_hash)
   WHERE id = v_att.id;

  RETURN jsonb_build_object('ok', true, 'code', 'payload_hash_recorded');
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_record_payload_hash(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_record_payload_hash(uuid,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- I. Request aggregate recalculation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_recalculate_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE
  v_open integer; v_failed integer; v_good integer; v_recon integer;
BEGIN
  SELECT count(*) FILTER (WHERE status IN ('pending','rendered','queued','held','dispatching')),
         count(*) FILTER (WHERE status IN ('failed','cancelled','blocked')),
         count(*) FILTER (WHERE status IN ('accepted','delivered','dry_run_completed','shadow_completed')),
         count(*) FILTER (WHERE status = 'reconciliation_required')
    INTO v_open, v_failed, v_good, v_recon
    FROM public.omni_comms_message WHERE request_id = p_request_id;

  IF v_open > 0 OR v_recon > 0 THEN
    UPDATE public.omni_comms_request
       SET status = 'processing', updated_at = now()
     WHERE id = p_request_id AND status IN ('accepted','processing');
  ELSIF v_failed > 0 AND v_good > 0 THEN
    UPDATE public.omni_comms_request
       SET status = 'completed_with_blockers', completed_at = now(), updated_at = now()
     WHERE id = p_request_id AND status IN ('accepted','processing');
  ELSIF v_failed > 0 THEN
    UPDATE public.omni_comms_request
       SET status = 'failed', failed_at = now(), updated_at = now()
     WHERE id = p_request_id AND status IN ('accepted','processing');
  ELSE
    UPDATE public.omni_comms_request
       SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE id = p_request_id AND status IN ('accepted','processing');
  END IF;
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_recalculate_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_recalculate_request(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- J. Corrected attempt completion
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
SET search_path TO 'pg_catalog','public' AS $fn$
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

  -- Acceptance without a provider reference is NOT acceptance.
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

  -- Response evidence is sanitised: bounded, non-identifying keys only.
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
       SET status = 'completed', completed_at = now(),
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    UPDATE public.omni_comms_message SET status = 'accepted', updated_at = now()
     WHERE id = v_att.message_id;
    v_event := 'provider_accepted';

  ELSIF v_final = 'outcome_unknown' AND v_att.attempt_number >= 3 THEN
    -- Exhausted AND uncertain: never assert definite failure.
    UPDATE public.omni_comms_dispatch_job
       SET status = 'held', hold_reason = 'reconciliation_required',
           next_attempt_at = NULL,
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    UPDATE public.omni_comms_message SET status = 'reconciliation_required', updated_at = now()
     WHERE id = v_att.message_id;
    v_event := 'reconciliation_required';

  ELSIF v_final IN ('retry_scheduled','outcome_unknown') AND v_att.attempt_number < 3 THEN
    UPDATE public.omni_comms_dispatch_job
       SET status = 'retry_wait',
           next_attempt_at = now() + (interval '1 minute' * v_att.attempt_number),
           lock_token = NULL, locked_at = NULL, locked_by = NULL,
           lease_expires_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    v_event := CASE WHEN v_final = 'outcome_unknown'
                    THEN 'provider_outcome_unknown' ELSE 'provider_retry_scheduled' END;
  ELSE
    UPDATE public.omni_comms_dispatch_job
       SET status = 'failed', completed_at = now(),
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
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_attempt_complete(uuid,text,text,text,integer,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_attempt_complete(uuid,text,text,text,integer,jsonb,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- K. Corrected signed-callback normalization
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
SET search_path TO 'pg_catalog','public' AS $fn$
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
  ON CONFLICT (provider_code, provider_event_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'duplicate_event');
  END IF;

  IF v_scope = 'ambiguous' THEN
    RETURN jsonb_build_object('recorded', true, 'code', 'callback_ambiguous',
                              'scope', 'unmatched');
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

  -- A verified callback is the only authority that can resolve an
  -- outcome_unknown attempt.
  IF v_att.status = 'outcome_unknown'
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
       AND status IN ('accepted','dispatching','reconciliation_required');
    UPDATE public.omni_comms_dispatch_job
       SET status = 'completed', hold_reason = NULL, completed_at = now(), updated_at = now()
     WHERE id = v_job.id AND status IN ('held','processing','retry_wait');
  END IF;

  PERFORM public.omni_comms_priv_dispatch_recalculate_request(v_job.request_id);

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
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_record_callback(text,text,text,text,text,timestamptz,jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_record_callback(text,text,text,text,text,timestamptz,jsonb,text,boolean) TO service_role;

-- ---------------------------------------------------------------------
-- L. Trusted scheduler entry point (service role only, no operator path)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(
  p_worker text,
  p_batch_limit integer,
  p_deployed_revision text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $fn$
BEGIN
  RETURN public.omni_comms_priv_dispatch_claim_email(
    p_worker, p_batch_limit, p_correlation_id, p_deployed_revision, NULL, 'scheduler');
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(text,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(text,integer,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- M. Tenant-scoped dispatcher diagnostics
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_dispatch_diagnostics(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_rel public.omni_comms_channel_release_control;
BEGIN
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_rel := public.omni_comms_priv_channel_release_effective(
             p_organization_id, p_department_id, 'email');

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
       WHERE w.organization_id = p_organization_id
         AND w.normalized_event_type = 'delivered'),
    'ambiguous_callback_count', (
      SELECT count(*) FROM public.omni_comms_webhook_event w
       WHERE w.organization_id IS NOT DISTINCT FROM p_organization_id
         AND w.processing_result = 'ambiguous'),
    'queued_producer_binding_count', (
      SELECT count(*) FROM public.omni_comms_producer_event_binding b
       WHERE b.status = 'active' AND 'queued' = ANY (b.allowed_modes)),
    'release_state', v_rel.release_state,
    'blocker', CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.omni_comms_producer_event_binding b
         WHERE b.status = 'active' AND 'queued' = ANY (b.allowed_modes))
      THEN 'pilot_business_producer_not_selected' ELSE NULL END);
END; $fn$;

REVOKE ALL ON FUNCTION public.omni_comms_dispatch_diagnostics(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_dispatch_diagnostics(uuid,uuid) TO authenticated, service_role;