-- =====================================================================
-- A4.1.2C — Operations Summary + Authorisation/Preparation Hydration
-- Read-only projections. No writes. No provider contact.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Active usable revalidation authorisation for a module/event/channel.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_comm_hub_active_revalidation_authorisation(
  p_module_code text,
  p_event_code  text,
  p_channel     text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_channel text := coalesce(p_channel, 'email');
  v_cycle   public.communication_hub_revalidation_cycle%ROWTYPE;
  v_auth    public.communication_hub_revalidation_send_authorisation%ROWTYPE;
  v_current_fp text;
  v_recipient_match boolean;
  v_reason text := NULL;
  v_usable boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_cycle
    FROM public.communication_hub_revalidation_cycle
   WHERE module_code = p_module_code
     AND event_code  = p_event_code
     AND channel     = v_channel
     AND status NOT IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED','PROMOTED','SUPERSEDED','VERIFIED_SUPPLEMENTAL')
   ORDER BY started_at DESC
   LIMIT 1;

  IF v_cycle.id IS NULL THEN
    RETURN jsonb_build_object(
      'authorisation', NULL,
      'unusable_reason', 'no_active_cycle'
    );
  END IF;

  SELECT * INTO v_auth
    FROM public.communication_hub_revalidation_send_authorisation
   WHERE cycle_id = v_cycle.id
   ORDER BY issued_at DESC
   LIMIT 1;

  IF v_auth.id IS NULL THEN
    RETURN jsonb_build_object(
      'authorisation', NULL,
      'unusable_reason', 'no_authorisation'
    );
  END IF;

  v_current_fp := v_cycle.current_evidence_fingerprint_v2;

  -- Determine usability
  IF v_auth.revoked_at IS NOT NULL THEN
    v_reason := 'revoked';
  ELSIF v_auth.consumed_at IS NOT NULL THEN
    v_reason := 'consumed';
  ELSIF v_auth.expires_at IS NOT NULL AND v_auth.expires_at <= now() THEN
    v_reason := 'expired';
  ELSIF coalesce(v_cycle.needs_reassessment, false) THEN
    v_reason := 'needs_reassessment';
  ELSIF v_auth.bound_current_fingerprint IS DISTINCT FROM v_current_fp THEN
    v_reason := 'stale_fingerprint';
  ELSIF v_auth.bound_event_certification_id IS DISTINCT FROM v_cycle.baseline_event_certification_id THEN
    v_reason := 'wrong_event_certification';
  ELSIF v_auth.bound_production_lineage_id IS DISTINCT FROM v_cycle.baseline_production_lineage_id THEN
    v_reason := 'wrong_production_lineage';
  ELSE
    v_recipient_match := (
      v_cycle.recipient_email IS NULL
      OR lower(v_auth.recipient_email) = lower(v_cycle.recipient_email)
    );
    IF NOT v_recipient_match THEN
      v_reason := 'recipient_mismatch';
    ELSE
      v_usable := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'authorisation', jsonb_build_object(
      'id',                            v_auth.id,
      'cycle_id',                      v_auth.cycle_id,
      'status',                        CASE
                                         WHEN v_auth.revoked_at  IS NOT NULL THEN 'REVOKED'
                                         WHEN v_auth.consumed_at IS NOT NULL THEN 'CONSUMED'
                                         WHEN v_auth.expires_at <= now()     THEN 'EXPIRED'
                                         ELSE 'ISSUED' END,
      'recipient',                     v_auth.recipient_email,
      'bound_current_fingerprint',     v_auth.bound_current_fingerprint,
      'bound_event_certification_id',  v_auth.bound_event_certification_id,
      'bound_production_lineage_id',   v_auth.bound_production_lineage_id,
      'issued_at',                     v_auth.issued_at,
      'expires_at',                    v_auth.expires_at,
      'reserved_at',                   NULL,
      'consumed_at',                   v_auth.consumed_at,
      'revoked_at',                    v_auth.revoked_at,
      'usable',                        v_usable,
      'unusable_reason',               v_reason
    ),
    'cycle_id',       v_cycle.id,
    'cycle_status',   v_cycle.status
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.get_comm_hub_active_revalidation_authorisation(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_active_revalidation_authorisation(text,text,text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Active preparation execution for a revalidation cycle.
--    Returns the most-recent active row, or the most-recent terminal
--    row when nothing is active, so the UI can display outcomes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_comm_hub_active_revalidation_preparation(
  p_cycle_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_exec public.communication_hub_revalidation_execution%ROWTYPE;
  v_classified text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF p_cycle_id IS NULL THEN
    RETURN jsonb_build_object('execution', NULL, 'unavailable_reason','no_cycle');
  END IF;

  -- Prefer an active row (PREPARING/READY/PROVIDER_INVOKED/RECONCILING),
  -- otherwise the most-recent record (COMPLETE/FAILED_PRE_PROVIDER/…).
  SELECT * INTO v_exec
    FROM public.communication_hub_revalidation_execution
   WHERE cycle_id = p_cycle_id
     AND state IN ('PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','RECONCILING')
   ORDER BY updated_at DESC
   LIMIT 1;

  IF v_exec.id IS NULL THEN
    SELECT * INTO v_exec
      FROM public.communication_hub_revalidation_execution
     WHERE cycle_id = p_cycle_id
     ORDER BY updated_at DESC
     LIMIT 1;
  END IF;

  IF v_exec.id IS NULL THEN
    RETURN jsonb_build_object('execution', NULL, 'unavailable_reason','no_execution');
  END IF;

  v_classified := CASE v_exec.state
    WHEN 'PREPARING'          THEN 'PREPARING'
    WHEN 'READY_FOR_PROVIDER' THEN 'READY_FOR_PROVIDER'
    WHEN 'PROVIDER_INVOKED'   THEN 'PROVIDER_RESULT_PENDING'
    WHEN 'RECONCILING'        THEN 'PROVIDER_RESULT_PENDING'
    WHEN 'COMPLETE'           THEN 'COMPLETE'
    WHEN 'FAILED_PRE_PROVIDER' THEN 'FAILED_PRE_PROVIDER'
    WHEN 'RECOVERY_REQUIRED'  THEN 'RECOVERY_REQUIRED'
    ELSE v_exec.state
  END;

  RETURN jsonb_build_object(
    'execution', jsonb_build_object(
      'execution_id',               v_exec.id,
      'preparation_version',        v_exec.preparation_version,
      'authorisation_id',           v_exec.authorisation_id,
      'state',                      v_exec.state,
      'classified_state',           v_classified,
      'canonical_idempotency_key',  v_exec.idempotency_key,
      'request_id',                 v_exec.request_id,
      'message_id',                 v_exec.message_id,
      'trace_id',                   v_exec.trace_id,
      'attempt_id',                 v_exec.delivery_attempt_id,
      'recipient_snapshot_id',      NULL,
      'provider_boundary_state',    v_exec.provider_boundary_state,
      'provider_call_attempted',    v_exec.provider_call_attempted,
      'failure_code',               v_exec.failure_code,
      'created_at',                 v_exec.created_at,
      'updated_at',                 v_exec.updated_at
    )
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.get_comm_hub_active_revalidation_preparation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_active_revalidation_preparation(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Operations summary — compact read-only projection.
--    Never fabricates missing stage evidence: stages surface as UNAVAILABLE
--    when their authoritative certification row is absent.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_comm_hub_operations_summary(
  p_module_code text,
  p_event_code  text,
  p_channel     text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_channel text := coalesce(p_channel, 'email');
  v_settings public.communication_hub_control_settings%ROWTYPE;
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_ore public.communication_controlled_live_certification%ROWTYPE;
  v_stub public.communication_controlled_live_certification%ROWTYPE;
  v_dry public.communication_dry_run_certification%ROWTYPE;
  v_preview public.communication_preview_approval%ROWTYPE;
  v_cycle public.communication_hub_revalidation_cycle%ROWTYPE;
  v_stages jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_auth jsonb;
  v_prep jsonb;
  v_baseline_status text;
  v_next_action jsonb := NULL;
  v_recovery_required boolean := false;
  v_inbox_required boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_settings
    FROM public.communication_hub_control_settings
   WHERE singleton_guard = 'primary';

  SELECT * INTO v_ec
    FROM public.communication_hub_event_certification
   WHERE module_code = p_module_code AND event_code = p_event_code AND channel = v_channel;

  -- Actual evidence per stage (never inferred from later stages).
  SELECT * INTO v_preview FROM public.communication_preview_approval
    WHERE module_code = p_module_code AND event_code = p_event_code AND channel = v_channel
      AND invalidated_at IS NULL
    ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  SELECT * INTO v_dry FROM public.communication_dry_run_certification
    WHERE module_code = p_module_code AND event_code = p_event_code AND channel = v_channel
      AND invalidated_at IS NULL
    ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  SELECT * INTO v_stub FROM public.communication_controlled_live_certification
    WHERE certification_kind = 'CONTROLLED_STUB'
      AND module_code = p_module_code AND event_code = p_event_code AND channel = v_channel
      AND invalidated_at IS NULL
    ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
    WHERE certification_kind = 'ONE_REAL_EMAIL'
      AND module_code = p_module_code AND event_code = p_event_code AND channel = v_channel
      AND invalidated_at IS NULL
    ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  -- Active revalidation cycle (single latest non-terminal row).
  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
    WHERE module_code = p_module_code AND event_code = p_event_code AND channel = v_channel
      AND status NOT IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED','PROMOTED','SUPERSEDED','VERIFIED_SUPPLEMENTAL')
    ORDER BY started_at DESC LIMIT 1;

  -- Baseline status projection.
  IF v_ore.id IS NULL THEN
    v_baseline_status := 'UNAVAILABLE';
  ELSIF v_ec.id IS NOT NULL AND v_ec.one_real_email_certification_id = v_ore.id THEN
    v_baseline_status := 'ANCHORED';
  ELSE
    v_baseline_status := 'CANDIDATE_UNANCHORED';
  END IF;

  -- Stage array (8 canonical stages). No fabrication.
  v_stages := jsonb_build_array(
    jsonb_build_object('code','PREVIEW_APPROVAL',
      'status', CASE WHEN v_preview.id IS NOT NULL THEN 'COMPLETED' ELSE 'UNAVAILABLE' END,
      'certification_id', v_preview.id, 'execution_id', NULL,
      'completed_at', v_preview.certified_at,
      'evidence_source', 'communication_preview_approval',
      'blocker_codes', '[]'::jsonb),
    jsonb_build_object('code','DRY_RUN',
      'status', CASE WHEN v_dry.id IS NOT NULL THEN 'COMPLETED' ELSE 'UNAVAILABLE' END,
      'certification_id', v_dry.id, 'execution_id', NULL,
      'completed_at', v_dry.certified_at,
      'evidence_source','communication_dry_run_certification',
      'blocker_codes','[]'::jsonb),
    jsonb_build_object('code','CONTROLLED_STUB',
      'status', CASE WHEN v_stub.id IS NOT NULL THEN 'COMPLETED' ELSE 'UNAVAILABLE' END,
      'certification_id', v_stub.id, 'execution_id', v_stub.execution_id,
      'completed_at', v_stub.certified_at,
      'evidence_source','communication_controlled_live_certification[CONTROLLED_STUB]',
      'blocker_codes','[]'::jsonb),
    jsonb_build_object('code','ONE_REAL_EMAIL',
      'status', CASE
        WHEN v_ore.id IS NOT NULL AND v_ore.manual_verification_status='CONFIRMED' THEN 'COMPLETED'
        WHEN v_ore.id IS NOT NULL THEN 'IN_PROGRESS'
        ELSE 'UNAVAILABLE' END,
      'certification_id', v_ore.id, 'execution_id', v_ore.execution_id,
      'completed_at', v_ore.manual_verified_at,
      'evidence_source','communication_controlled_live_certification[ONE_REAL_EMAIL]',
      'blocker_codes','[]'::jsonb),
    jsonb_build_object('code','MANUAL_PRODUCTION',
      'status', CASE
        WHEN v_ec.id IS NOT NULL AND v_ec.status IN ('live_manual_only','live_cron_allowed') THEN 'COMPLETED'
        WHEN v_ec.id IS NOT NULL THEN v_ec.status
        ELSE 'UNAVAILABLE' END,
      'certification_id', v_ec.id, 'execution_id', NULL,
      'completed_at', v_ec.approved_at,
      'evidence_source','communication_hub_event_certification',
      'blocker_codes','[]'::jsonb),
    jsonb_build_object('code','AUTOMATED_PRODUCTION',
      'status', CASE
        WHEN v_ec.id IS NOT NULL AND v_ec.status='live_cron_allowed' THEN 'COMPLETED'
        WHEN v_ec.id IS NOT NULL AND v_ec.automation_certified_at IS NOT NULL THEN 'CERTIFIED_NOT_ARMED'
        ELSE 'UNAVAILABLE' END,
      'certification_id', v_ec.id, 'execution_id', NULL,
      'completed_at', v_ec.automation_certified_at,
      'evidence_source','communication_hub_event_certification',
      'blocker_codes','[]'::jsonb),
    jsonb_build_object('code','REVALIDATION',
      'status', CASE WHEN v_cycle.id IS NOT NULL THEN v_cycle.status ELSE 'IDLE' END,
      'certification_id', NULL, 'execution_id', NULL,
      'completed_at', v_cycle.completed_at,
      'evidence_source','communication_hub_revalidation_cycle',
      'blocker_codes','[]'::jsonb),
    jsonb_build_object('code','BASELINE_PROMOTION',
      'status', CASE
        WHEN v_cycle.id IS NOT NULL AND v_cycle.promotion_status='PROMOTED' THEN 'COMPLETED'
        WHEN v_cycle.id IS NOT NULL AND v_cycle.status='READY_FOR_PROMOTION' THEN 'AVAILABLE'
        ELSE 'IDLE' END,
      'certification_id', NULL, 'execution_id', NULL,
      'completed_at', v_cycle.promoted_at,
      'evidence_source','communication_hub_revalidation_cycle',
      'blocker_codes','[]'::jsonb)
  );

  -- Authorisation hydration (server-authoritative).
  BEGIN
    v_auth := public.get_comm_hub_active_revalidation_authorisation(p_module_code, p_event_code, v_channel);
  EXCEPTION WHEN OTHERS THEN
    v_auth := jsonb_build_object('authorisation', NULL, 'unusable_reason','authorisation_unavailable');
    v_warnings := v_warnings || jsonb_build_object('code','authorisation_unavailable','detail', SQLERRM);
  END;

  -- Preparation hydration.
  IF v_cycle.id IS NOT NULL THEN
    BEGIN
      v_prep := public.get_comm_hub_active_revalidation_preparation(v_cycle.id);
    EXCEPTION WHEN OTHERS THEN
      v_prep := jsonb_build_object('execution', NULL, 'unavailable_reason','execution_unavailable');
      v_warnings := v_warnings || jsonb_build_object('code','execution_unavailable','detail', SQLERRM);
    END;
  ELSE
    v_prep := jsonb_build_object('execution', NULL, 'unavailable_reason','no_cycle');
  END IF;

  v_recovery_required := (v_prep->'execution'->>'classified_state') = 'RECOVERY_REQUIRED'
                     OR (v_prep->'execution'->>'classified_state') = 'FAILED_PRE_PROVIDER';
  v_inbox_required := v_cycle.status = 'AWAITING_INBOX_CONFIRMATION';

  -- One next-action hint (never a directive).
  IF v_cycle.id IS NULL THEN
    v_next_action := jsonb_build_object('code','START_OR_ASSESS_REVALIDATION','label','Assess or start a revalidation cycle');
  ELSIF v_cycle.status = 'READY_FOR_CONTROLLED_EMAIL' AND (v_auth->'authorisation'->>'usable')::boolean IS DISTINCT FROM true THEN
    v_next_action := jsonb_build_object('code','ISSUE_AUTHORISATION','label','Issue one-use revalidation authorisation');
  ELSIF (v_auth->'authorisation'->>'usable')::boolean AND (v_prep->'execution') IS NULL THEN
    v_next_action := jsonb_build_object('code','PREPARE_CONTROLLED_DELIVERY','label','Prepare controlled delivery (no email sent)');
  ELSIF (v_prep->'execution'->>'classified_state') = 'READY_FOR_PROVIDER' THEN
    v_next_action := jsonb_build_object('code','PROVIDER_DELIVERY_LOCKED','label','Provider delivery locked until A4.2');
  ELSIF v_inbox_required THEN
    v_next_action := jsonb_build_object('code','CONFIRM_INBOX','label','Record inbox confirmation');
  ELSIF v_recovery_required THEN
    v_next_action := jsonb_build_object('code','RECOVER_PREPARATION','label','Recover preparation');
  END IF;

  RETURN jsonb_build_object(
    'evaluated_at', now(),
    'selection', jsonb_build_object(
      'module_code', p_module_code, 'event_code', p_event_code, 'channel', v_channel),
    'platform', jsonb_build_object(
      'operating_mode', coalesce(v_settings.current_operating_mode, 'UNKNOWN'),
      'automation_state', coalesce(v_settings.automation_state, 'STANDBY'),
      'dispatch_enabled', coalesce(v_settings.dispatch_enabled, false),
      'scheduler_enabled', coalesce(v_settings.scheduler_enabled, false),
      'provider_boundary_approved', coalesce(v_settings.provider_boundary_approved, false)
    ),
    'event', jsonb_build_object(
      'event_status', v_ec.status,
      'event_certification_id', v_ec.id,
      'ore_certification_id', v_ore.id,
      'production_lineage_id', v_ore.production_lineage_id,
      'evidence_authority', 'communication_hub_event_certification+communication_controlled_live_certification'
    ),
    'baseline', jsonb_build_object(
      'status', v_baseline_status,
      'attestation_id', NULL,
      'fingerprint', v_ore.evidence_fingerprint_v2,
      'diagnosis_required', (v_baseline_status = 'CANDIDATE_UNANCHORED'),
      'correction_required', false
    ),
    'stages', v_stages,
    'revalidation', jsonb_build_object(
      'active_cycle', CASE WHEN v_cycle.id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'id', v_cycle.id,
          'status', v_cycle.status,
          'purpose', v_cycle.purpose,
          'reason', v_cycle.reason,
          'required_validation_level', v_cycle.required_validation_level,
          'required_stages', v_cycle.required_stages,
          'needs_reassessment', coalesce(v_cycle.needs_reassessment, false),
          'current_evidence_fingerprint_v2', v_cycle.current_evidence_fingerprint_v2,
          'recipient_email', v_cycle.recipient_email,
          'started_at', v_cycle.started_at
        ) END,
      'usable_authorisation', v_auth->'authorisation',
      'active_preparation_execution', v_prep->'execution',
      'recovery_required', v_recovery_required,
      'inbox_confirmation_required', v_inbox_required,
      'next_action', v_next_action
    ),
    'sources', jsonb_build_object(
      'event_status',        CASE WHEN v_ec.id     IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END,
      'baseline_status',     CASE WHEN v_ore.id    IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END,
      'revalidation_status', CASE WHEN v_cycle.id  IS NULL THEN 'IDLE'        ELSE 'AVAILABLE' END,
      'execution_status',    CASE WHEN (v_prep->'execution') IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END
    ),
    'blockers', v_blockers,
    'warnings', v_warnings
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.get_comm_hub_operations_summary(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_operations_summary(text,text,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_comm_hub_operations_summary(text,text,text) IS
  'A4.1.2C — Read-only projection over existing Communication Hub authorities. '
  'Never fabricates missing evidence; stages without a certification row report UNAVAILABLE. '
  'Authorisation and preparation execution are hydrated from the database, not the browser.';
