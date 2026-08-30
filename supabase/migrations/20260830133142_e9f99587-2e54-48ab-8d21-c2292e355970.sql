-- =====================================================================
-- Omni-Comms — held-job reevaluation integrity, hold classification and
-- actionable-attention model. Additive and idempotent.
-- =====================================================================

-- 1. Reevaluation bookkeeping + separated authorization truth --------------
ALTER TABLE public.omni_comms_dispatch_job
  ADD COLUMN IF NOT EXISTS authorization_evaluated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS authorization_evaluation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS authorization_outcome          text,
  ADD COLUMN IF NOT EXISTS authorization_outcome_at       timestamptz;

COMMENT ON COLUMN public.omni_comms_dispatch_job.authorization_outcome IS
  'Current authoritative dispatch-authorization result recomputed by the hold reevaluator. NULL means currently authorized. Distinct from hold_reason, which is the last stored claim blocker.';

CREATE INDEX IF NOT EXISTS omni_comms_dispatch_job_hold_reeval_idx
  ON public.omni_comms_dispatch_job (authorization_evaluated_at NULLS FIRST, created_at)
  WHERE status = 'held';

-- 2. Canonical hold classification ---------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_hold_classification(p_reason text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN nullif(btrim(coalesce(p_reason,'')), '') IS NULL THEN
      jsonb_build_object('bucket','READY','actionable',false,
        'label','Ready — eligible for delivery')
    WHEN p_reason = 'historical_job_not_authorized' THEN
      jsonb_build_object('bucket','PERMANENT_HISTORICAL','actionable',false,
        'label','Held — historical pre-activation communication')
    WHEN p_reason LIKE 'superseded_%' OR p_reason IN ('archived','cancelled_by_operator') THEN
      jsonb_build_object('bucket','PERMANENT_HISTORICAL','actionable',false,
        'label','Archived — superseded record')
    WHEN p_reason IN ('recipient_not_allowlisted','recipient_not_permitted') THEN
      jsonb_build_object('bucket','GOVERNANCE_BLOCKED','actionable',true,
        'label','Held — recipient not allowlisted')
    WHEN p_reason IN ('release_control_missing','release_snapshot_missing','release_snapshot_stale',
                      'release_fingerprint_mismatch','release_expired','release_denied',
                      'business_dispatch_disabled','certification_not_effective',
                      'certification_mismatch','deployed_revision_mismatch',
                      'runtime_certification_missing') THEN
      jsonb_build_object('bucket','GOVERNANCE_BLOCKED','actionable',true,
        'label','Held — release approval required')
    WHEN p_reason IN ('resolution_snapshot_incomplete','provider_account_missing','provider_unavailable',
                      'sender_not_verified','sender_binding_missing','provider_secret_missing',
                      'credential_missing','adapter_not_capable','live_delivery_enabled_unexpected',
                      'volume_integrity_failure','recipient_invalid','recipient_malformed') THEN
      jsonb_build_object('bucket','CONFIGURATION_BLOCKED','actionable',true,
        'label','Held — provider or recipient configuration required')
    WHEN p_reason IN ('release_limit_exceeded','retry_wait','provider_rate_limited') THEN
      jsonb_build_object('bucket','TEMPORARY_HOLD','actionable',false,
        'label','Waiting — temporary limit, resumes automatically')
    WHEN p_reason IN ('retry_exhausted','provider_attempts_exhausted','delivery_failed') THEN
      jsonb_build_object('bucket','FAILED_RETRY_REQUIRED','actionable',true,
        'label','Failed — retry exhausted')
    ELSE
      jsonb_build_object('bucket','GOVERNANCE_BLOCKED','actionable',true,
        'label','Held — governance review required')
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_hold_classification(text) TO authenticated, service_role;

-- 3. Audit vocabulary for reevaluation -----------------------------------
ALTER TABLE public.omni_comms_message_event
  DROP CONSTRAINT IF EXISTS omni_comms_message_event_event_type_check;
ALTER TABLE public.omni_comms_message_event
  ADD CONSTRAINT omni_comms_message_event_event_type_check CHECK (event_type = ANY (ARRAY[
    'request_accepted','request_processing','recipient_resolved','recipient_blocked',
    'message_rendered','message_blocked','dry_run_completed','shadow_completed',
    'dispatch_queued','dispatch_held','request_completed','request_failed','dispatch_ready',
    'dispatch_claimed','dispatch_leased','dispatch_lease_expired','dispatch_cancelled',
    'provider_attempt_started','provider_accepted','provider_rejected','provider_outcome_unknown',
    'provider_retry_scheduled','provider_attempts_exhausted','callback_delivered','callback_delayed',
    'callback_bounced','callback_complained','callback_opened','callback_clicked','pilot_suspended',
    'reconciliation_required','reconciliation_resolved','callback_ambiguous','callback_ignored',
    'request_recovered','print_artefact_produced','print_production_failed',
    'dispatch_hold_reevaluated'
  ]));

-- 4. Starvation-free, snapshot-faithful reevaluator ----------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_reevaluate_held_jobs(
  p_worker            text DEFAULT 'omni-comms-hold-reevaluation',
  p_batch_limit       integer DEFAULT 25,
  p_deployed_revision text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit   integer := least(greatest(coalesce(p_batch_limit, 25), 1), 100);
  v_rev     text    := lower(btrim(coalesce(nullif(p_deployed_revision, ''),
                                            public.omni_comms_priv_observed_deployed_revision(),
                                            '')));
  v_worker  text    := left(coalesce(nullif(btrim(p_worker),''), 'omni-comms-hold-reevaluation'), 120);
  j          record;
  v_rel      public.omni_comms_channel_release_control;
  v_deny     text;
  v_hash     text;
  v_target   text;
  v_user     uuid;
  v_changed  boolean;
  v_scanned  integer := 0;
  v_released integer := 0;
  v_still    integer := 0;
  v_audited  integer := 0;
  v_results  jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('omni_comms.dispatch_worker', 'on', true);

  -- Least-recently-evaluated first. Every scanned job is stamped below, so the
  -- cursor always advances and no held job can be starved, at any table size.
  FOR j IN
    SELECT d.id, d.channel, d.organization_id, d.message_id, d.request_id,
           d.release_control_id, d.release_decision_at, d.hold_reason,
           d.authorization_outcome, d.status,
           m.department_id, m.recipient_id,
           r.caller_module_code, r.created_at AS request_created_at
      FROM public.omni_comms_dispatch_job d
      JOIN public.omni_comms_message m ON m.id = d.message_id
      JOIN public.omni_comms_request r ON r.id = d.request_id
     WHERE d.status = 'held'
       AND d.mode = 'queued'
       AND d.channel IN ('email', 'in_app')
     ORDER BY d.authorization_evaluated_at ASC NULLS FIRST, d.created_at ASC
     LIMIT v_limit
     FOR UPDATE OF d SKIP LOCKED
  LOOP
    v_scanned := v_scanned + 1;
    v_deny := NULL;
    v_hash := NULL;
    v_changed := false;

    v_rel := public.omni_comms_priv_channel_release_effective(
               j.organization_id, j.department_id, j.channel);

    IF v_rel.id IS NULL THEN
      v_deny := 'release_control_missing';
    ELSE
      -- IMMUTABLE recipient evidence. The destination snapshot captured when
      -- the communication was created is authoritative; a later edit of the
      -- mutable recipient row must never re-authorize an old held job for a
      -- materially different destination.
      IF j.channel = 'in_app' THEN
        SELECT nullif(btrim(coalesce(rc.destination_snapshot ->> 'in_app_user_id', '')), '')
          INTO v_target
          FROM public.omni_comms_recipient rc WHERE rc.id = j.recipient_id;
        IF v_target IS NULL THEN
          v_user := public.omni_comms_priv_resolve_in_app_user(j.recipient_id);
          v_target := coalesce(v_user::text, '');
        END IF;
      ELSE
        SELECT coalesce(
                 nullif(btrim(coalesce(rc.destination_snapshot ->> 'email', '')), ''),
                 '')
          INTO v_target
          FROM public.omni_comms_recipient rc WHERE rc.id = j.recipient_id;
      END IF;

      v_hash := lower(coalesce(
        public.omni_comms_priv_channel_test_normalize_target(
          j.channel, coalesce(v_target, '')) ->> 'target_hash', ''));

      v_deny := public.omni_comms_priv_evaluate_dispatch_authorization(
        j.organization_id, j.department_id, j.channel,
        j.caller_module_code, 'queued', nullif(v_hash, ''), NULL,
        j.request_created_at, nullif(v_rev, ''));
    END IF;

    -- Always stamp the evaluation cursor and the current authorization truth.
    UPDATE public.omni_comms_dispatch_job
       SET authorization_evaluated_at     = now(),
           authorization_evaluation_count = coalesce(authorization_evaluation_count, 0) + 1,
           authorization_outcome          = v_deny,
           authorization_outcome_at       = now()
     WHERE id = j.id;

    IF j.authorization_outcome IS DISTINCT FROM v_deny THEN
      v_changed := true;
    END IF;

    IF v_deny IS NOT NULL THEN
      v_still := v_still + 1;
      -- hold_reason is the STORED claim blocker. It is refreshed only when the
      -- authoritative outcome actually moved, never rewritten every hour.
      IF v_changed AND j.hold_reason IS DISTINCT FROM v_deny
         AND j.hold_reason IS DISTINCT FROM 'release_snapshot_missing' THEN
        UPDATE public.omni_comms_dispatch_job
           SET hold_reason = v_deny, updated_at = now()
         WHERE id = j.id;
      END IF;
    ELSE
      IF j.release_decision_at IS NULL THEN
        UPDATE public.omni_comms_dispatch_job
           SET release_control_id               = v_rel.id,
               release_version_at_decision      = v_rel.release_version,
               release_state_at_decision        = v_rel.release_state,
               release_fingerprint_at_decision  = v_rel.release_fingerprint,
               release_expires_at_decision      = v_rel.release_expires_at,
               release_decision_at              = now(),
               release_decision_snapshot        = jsonb_build_object(
                 'event_matched', true, 'caller_matched', true, 'mode_matched', true,
                 'recipient_source', 'immutable_destination_snapshot',
                 'release_state', v_rel.release_state,
                 'certified_commit', v_rel.approved_commit,
                 'authorized_by', 'hold_reevaluation',
                 'authorized_at', now()),
               hold_reason = NULL,
               updated_at  = now()
         WHERE id = j.id;
        v_changed := true;
      ELSIF j.hold_reason IS NOT NULL THEN
        UPDATE public.omni_comms_dispatch_job
           SET hold_reason = NULL, updated_at = now()
         WHERE id = j.id;
        v_changed := true;
      END IF;

      -- In-App is delivered by the internal worker, which consumes ready jobs.
      -- Email is claimed by the certified claim function, whose status-paired
      -- eligibility already accepts status='held'; its status is NOT altered
      -- here so the certified claim contract stays untouched.
      IF j.channel = 'in_app' THEN
        UPDATE public.omni_comms_dispatch_job
           SET status = 'ready', is_runnable = true, updated_at = now()
         WHERE id = j.id AND status = 'held';
        v_changed := true;
      END IF;

      v_released := v_released + 1;
    END IF;

    -- Audit ONLY on a meaningful transition. Permanent unchanged historical
    -- holds produce no hourly noise.
    IF v_changed THEN
      v_audited := v_audited + 1;
      INSERT INTO public.omni_comms_message_event(
        request_id, message_id, organization_id, event_type, event_sequence,
        status_before, status_after, summary, safe_metadata, actor_type, actor_id)
      VALUES (
        j.request_id, j.message_id, j.organization_id,
        'dispatch_hold_reevaluated',
        (SELECT coalesce(max(event_sequence), 0) + 1
           FROM public.omni_comms_message_event e WHERE e.request_id = j.request_id),
        j.hold_reason, v_deny,
        CASE WHEN v_deny IS NULL THEN 'Held job authorized by reevaluation'
             ELSE 'Held job reevaluated; still not authorized' END,
        jsonb_build_object(
          'job_id', j.id,
          'channel', j.channel,
          'previous_outcome', j.authorization_outcome,
          'previous_hold_reason', j.hold_reason,
          'new_outcome', v_deny,
          'classification', public.omni_comms_hold_classification(v_deny),
          'deployed_revision', nullif(v_rev, ''),
          'release_control_id', v_rel.id,
          'release_version', v_rel.release_version,
          'release_state', v_rel.release_state,
          'state_changed', true,
          'evaluated_at', now()),
        'system', v_worker);
    END IF;

    v_results := v_results || jsonb_build_object(
      'job_id', j.id, 'channel', j.channel,
      'outcome', CASE WHEN v_deny IS NULL THEN 'authorized' ELSE 'still_held' END,
      'reason', v_deny, 'state_changed', v_changed);
  END LOOP;

  RETURN jsonb_build_object(
    'worker', v_worker,
    'deployed_revision_used', nullif(v_rev, ''),
    'scanned', v_scanned,
    'authorized', v_released,
    'still_held', v_still,
    'audited', v_audited,
    'results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) TO service_role;

-- 5. Actionable-attention projection -------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_ops_attention_summary(
  p_organization_id uuid,
  p_department_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_buckets jsonb;
  v_action  bigint := 0;
  v_failed  bigint := 0;
  v_blocked bigint := 0;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('operate');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organisation_required' USING ERRCODE='P0001', DETAIL='organization_id';
  END IF;

  WITH held AS (
    SELECT public.omni_comms_hold_classification(
             coalesce(d.authorization_outcome, d.hold_reason)) AS c
      FROM public.omni_comms_dispatch_job d
      JOIN public.omni_comms_request r ON r.id = d.request_id
     WHERE d.organization_id = p_organization_id
       AND d.status = 'held'
       AND d.mode = 'queued'
       AND (p_department_id IS NULL OR r.department_id = p_department_id)
  )
  SELECT coalesce(jsonb_object_agg(bucket, n), '{}'::jsonb),
         coalesce(sum(n) FILTER (WHERE actionable), 0)
    INTO v_buckets, v_action
    FROM (SELECT c ->> 'bucket' AS bucket,
                 (c ->> 'actionable')::boolean AS actionable,
                 count(*) AS n
            FROM held GROUP BY 1, 2) s;

  SELECT count(*) FILTER (WHERE d.status = 'failed'),
         count(*) FILTER (WHERE d.status = 'retry_wait' AND d.attempt_count >= d.max_attempts)
    INTO v_failed, v_blocked
    FROM public.omni_comms_dispatch_job d
    JOIN public.omni_comms_request r ON r.id = d.request_id
   WHERE d.organization_id = p_organization_id
     AND (p_department_id IS NULL OR r.department_id = p_department_id);

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'held_by_bucket', v_buckets,
    'actionable_held', v_action,
    'failed_jobs', coalesce(v_failed, 0),
    'retry_exhausted_jobs', coalesce(v_blocked, 0),
    'attention_total', coalesce(v_action, 0) + coalesce(v_failed, 0) + coalesce(v_blocked, 0),
    'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_ops_attention_summary(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_ops_attention_summary(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_ops_attention_summary(uuid, uuid) TO authenticated, service_role;