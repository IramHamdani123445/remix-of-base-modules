
-- ============================================================
-- Helper: current authenticated admin (throws if not admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public._chrc_require_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.has_role(v_uid, 'Admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  RETURN v_uid;
END $$;

-- ============================================================
-- Helper: resolve active production baseline for pilot event
-- ============================================================
CREATE OR REPLACE FUNCTION public._chrc_get_production_baseline(
  p_module_code text, p_event_code text, p_channel text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT id, one_real_email_certification_id, production_lineage_id,
         evidence_snapshot_v2, evidence_fingerprint_v2, manual_verified_recipient,
         manual_verified_at, status, template_version_id, template_manifest_hash,
         sender_profile_id, recipient_set_hash, configuration_version
    INTO r
    FROM public.communication_hub_event_certification
   WHERE module_code = p_module_code AND event_code = p_event_code AND channel = p_channel
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'event_certification_id', r.id,
    'ore_certification_id', r.one_real_email_certification_id,
    'production_lineage_id', r.production_lineage_id,
    'evidence_core_v2', r.evidence_snapshot_v2,
    'evidence_fingerprint_v2', r.evidence_fingerprint_v2,
    'verified_recipient', r.manual_verified_recipient,
    'verified_at', r.manual_verified_at,
    'status', r.status,
    'template_version_id', r.template_version_id,
    'template_manifest_hash', r.template_manifest_hash,
    'sender_profile_id', r.sender_profile_id,
    'recipient_set_hash', r.recipient_set_hash,
    'configuration_version', r.configuration_version
  );
END $$;

-- ============================================================
-- Helper: derive required stages from change categories
-- ============================================================
CREATE OR REPLACE FUNCTION public._chrc_derive_stages(
  p_categories jsonb
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cats text[];
  v_stages text[] := ARRAY[]::text[];
  v_level text := 'NONE';
BEGIN
  IF p_categories IS NULL OR jsonb_array_length(p_categories) = 0 THEN
    RETURN jsonb_build_object('level','NONE','stages','[]'::jsonb);
  END IF;
  SELECT array_agg(value::text) INTO v_cats FROM jsonb_array_elements_text(p_categories);

  IF 'UI_ONLY' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['CONTRACT_TESTS']; v_level := 'NON_SENDING_ONLY';
  END IF;
  IF 'MONITORING_ONLY' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['AUTOMATED_READINESS']; v_level := 'NON_SENDING_ONLY';
  END IF;
  IF 'SCHEDULER_ARM_ONLY' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['AUTOMATED_READINESS','AUTOMATED_CANARY']; v_level := 'AUTOMATED_CANARY';
  END IF;
  IF 'PROVIDER_CHANGE' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['CONTRACT_TESTS','CONTROLLED_STUB','CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION'];
    v_level := 'CONTROLLED_EMAIL';
  END IF;
  IF 'SENDER_DISPLAY_ONLY' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['PREVIEW','PREVIEW_APPROVAL','CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION'];
    v_level := 'CONTROLLED_EMAIL';
  END IF;
  IF 'SENDER_DOMAIN' = ANY(v_cats) OR 'TEMPLATE_CHANGE' = ANY(v_cats)
     OR 'PAYLOAD_SCHEMA' = ANY(v_cats) OR 'RECIPIENT_POLICY' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['PREVIEW','PREVIEW_APPROVAL','DRY_RUN','CONTROLLED_STUB','CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION'];
    v_level := 'FULL_CONTENT_AND_DELIVERY';
  END IF;
  IF 'SEND_REVIEW_POLICY' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['DRY_RUN','CONTROLLED_STUB','CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION'];
    v_level := 'FULL_CONTENT_AND_DELIVERY';
  END IF;
  IF 'DISPATCHER_TRANSPORT' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['CONTRACT_TESTS','DRY_RUN','CONTROLLED_STUB','CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION','MANUAL_PRODUCTION_ACCEPTANCE'];
    v_level := 'FULL_MANUAL_PRODUCTION';
  END IF;
  IF 'SECURITY' = ANY(v_cats) THEN
    v_stages := v_stages || ARRAY['CONTRACT_TESTS','PREVIEW','DRY_RUN','CONTROLLED_STUB','CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION','MANUAL_PRODUCTION_ACCEPTANCE','AUTOMATED_READINESS','AUTOMATED_CANARY'];
    v_level := 'FULL_MANUAL_PRODUCTION';
  END IF;

  -- de-dup stages preserving order
  RETURN jsonb_build_object(
    'level', v_level,
    'stages', to_jsonb(ARRAY(SELECT DISTINCT unnest(v_stages)))
  );
END $$;

-- ============================================================
-- RPC: assess_comm_hub_revalidation_requirement
-- ============================================================
CREATE OR REPLACE FUNCTION public.assess_comm_hub_revalidation_requirement(
  p_module_code text,
  p_event_code text,
  p_channel text DEFAULT 'email',
  p_declared_change_categories jsonb DEFAULT '[]'::jsonb,
  p_runtime_release_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_uid uuid := public._chrc_require_admin();
  v_baseline jsonb := public._chrc_get_production_baseline(p_module_code,p_event_code,p_channel);
  v_current jsonb;
  v_current_fp text;
  v_baseline_fp text;
  v_drift boolean := false;
  v_changed text[] := ARRAY[]::text[];
  v_derive jsonb := public._chrc_derive_stages(p_declared_change_categories);
  v_release jsonb := NULL;
  v_prod_may boolean := true;
  v_suspend boolean := false;
  v_disarm boolean := false;
  v_cats text[];
BEGIN
  IF v_baseline IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error','NO_PRODUCTION_BASELINE',
      'module_code',p_module_code,'event_code',p_event_code,'channel',p_channel
    );
  END IF;
  -- Current snapshot (best-effort; RPC returns { ok, evidence_core_v2, ... })
  BEGIN
    v_current := (SELECT public.get_comm_hub_current_evidence_snapshot(p_module_code,p_event_code,p_channel));
  EXCEPTION WHEN OTHERS THEN v_current := NULL; END;

  IF v_current IS NOT NULL AND v_current ? 'evidence_core_v2' THEN
    v_current_fp := public._comm_hub_fingerprint_evidence_core_v2(v_current->'evidence_core_v2');
  END IF;
  v_baseline_fp := v_baseline->>'evidence_fingerprint_v2';

  IF v_current_fp IS NOT NULL AND v_baseline_fp IS NOT NULL AND v_current_fp <> v_baseline_fp THEN
    v_drift := true;
    v_changed := v_changed || 'evidence_fingerprint';
  END IF;

  -- Component-level diff (best effort)
  IF v_current ? 'evidence_core_v2' THEN
    IF (v_current->'evidence_core_v2'->>'template_manifest_hash')
       IS DISTINCT FROM (v_baseline->'evidence_core_v2'->>'template_manifest_hash') THEN
      v_changed := v_changed || 'template'; v_drift := true;
    END IF;
    IF (v_current->'evidence_core_v2'->>'sender_profile_id')
       IS DISTINCT FROM (v_baseline->'evidence_core_v2'->>'sender_profile_id') THEN
      v_changed := v_changed || 'sender'; v_drift := true;
    END IF;
    IF (v_current->'evidence_core_v2'->>'provider_id')
       IS DISTINCT FROM (v_baseline->'evidence_core_v2'->>'provider_id') THEN
      v_changed := v_changed || 'provider'; v_drift := true;
    END IF;
    IF (v_current->'evidence_core_v2'->>'recipient_policy_hash')
       IS DISTINCT FROM (v_baseline->'evidence_core_v2'->>'recipient_policy_hash') THEN
      v_changed := v_changed || 'recipient_policy'; v_drift := true;
    END IF;
    IF (v_current->'evidence_core_v2'->>'send_policy_hash')
       IS DISTINCT FROM (v_baseline->'evidence_core_v2'->>'send_policy_hash') THEN
      v_changed := v_changed || 'send_policy'; v_drift := true;
    END IF;
    IF (v_current->'evidence_core_v2'->>'review_policy_hash')
       IS DISTINCT FROM (v_baseline->'evidence_core_v2'->>'review_policy_hash') THEN
      v_changed := v_changed || 'review_policy'; v_drift := true;
    END IF;
  END IF;

  -- Runtime release lookup
  IF p_runtime_release_reference IS NOT NULL THEN
    SELECT to_jsonb(r) INTO v_release
      FROM public.communication_hub_runtime_release r
     WHERE r.release_reference = p_runtime_release_reference LIMIT 1;
  END IF;

  SELECT array_agg(value::text) INTO v_cats FROM jsonb_array_elements_text(p_declared_change_categories);
  IF v_cats IS NULL THEN v_cats := ARRAY[]::text[]; END IF;

  IF 'SECURITY' = ANY(v_cats) THEN
    v_prod_may := false; v_suspend := true; v_disarm := true;
  ELSIF 'DISPATCHER_TRANSPORT' = ANY(v_cats)
     OR 'PROVIDER_CHANGE' = ANY(v_cats)
     OR 'SENDER_DOMAIN' = ANY(v_cats) THEN
    v_disarm := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'module_code', p_module_code,
    'event_code', p_event_code,
    'channel', p_channel,
    'baseline', v_baseline,
    'current_evidence_core_v2', v_current->'evidence_core_v2',
    'baseline_fingerprint', v_baseline_fp,
    'current_fingerprint', v_current_fp,
    'drift_detected', v_drift,
    'changed_components', to_jsonb(v_changed),
    'runtime_changes', COALESCE(v_release,'{}'::jsonb),
    'required_validation_level', v_derive->>'level',
    'required_stages', v_derive->'stages',
    'explanation', CASE WHEN v_drift THEN 'Drift detected between baseline and current configuration.'
                        ELSE 'No configuration drift detected against production baseline.' END,
    'production_may_continue', v_prod_may,
    'event_must_be_suspended', v_suspend,
    'automation_must_be_disarmed', v_disarm,
    'assessed_by', v_uid,
    'assessed_at', now()
  );
END $$;

-- ============================================================
-- RPC: start_comm_hub_revalidation_cycle
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_comm_hub_revalidation_cycle(
  p_module_code text,
  p_event_code text,
  p_channel text,
  p_purpose public.comm_hub_revalidation_purpose,
  p_reason text,
  p_change_ticket_reference text DEFAULT NULL,
  p_declared_change_categories jsonb DEFAULT '[]'::jsonb,
  p_runtime_release_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public._chrc_require_admin();
  v_assess jsonb;
  v_baseline jsonb;
  v_cycle_id uuid;
  v_release_id uuid;
  v_config_version bigint;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 6 THEN
    RAISE EXCEPTION 'reason_required_min_6_chars';
  END IF;

  v_assess := public.assess_comm_hub_revalidation_requirement(
    p_module_code,p_event_code,p_channel,p_declared_change_categories,p_runtime_release_reference
  );
  IF (v_assess->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assessment_failed: %', v_assess->>'error';
  END IF;
  v_baseline := v_assess->'baseline';

  IF p_runtime_release_reference IS NOT NULL THEN
    SELECT id INTO v_release_id FROM public.communication_hub_runtime_release
      WHERE release_reference = p_runtime_release_reference LIMIT 1;
  END IF;

  SELECT configuration_version INTO v_config_version
    FROM public.communication_hub_control_settings LIMIT 1;

  INSERT INTO public.communication_hub_revalidation_cycle(
    module_code,event_code,channel,purpose,reason,change_ticket_reference,
    status,started_by,
    baseline_event_certification_id, baseline_ore_certification_id, baseline_production_lineage_id,
    baseline_evidence_core_v2, baseline_evidence_fingerprint_v2,
    current_evidence_core_v2, current_evidence_fingerprint_v2,
    changed_components, runtime_changes, required_validation_level, required_stages,
    runtime_release_id, configuration_version_at_start
  ) VALUES (
    p_module_code,p_event_code,p_channel,p_purpose,p_reason,p_change_ticket_reference,
    CASE WHEN (v_assess->>'drift_detected')::boolean
         AND (v_assess->>'required_validation_level') <> 'NONE'
         THEN 'REVALIDATION_REQUIRED'::public.comm_hub_revalidation_status
         ELSE 'ASSESSING'::public.comm_hub_revalidation_status END,
    v_uid,
    (v_baseline->>'event_certification_id')::uuid,
    (v_baseline->>'ore_certification_id')::uuid,
    (v_baseline->>'production_lineage_id')::uuid,
    v_baseline->'evidence_core_v2',
    v_baseline->>'evidence_fingerprint_v2',
    v_assess->'current_evidence_core_v2',
    v_assess->>'current_fingerprint',
    v_assess->'changed_components',
    v_assess->'runtime_changes',
    (v_assess->>'required_validation_level')::public.comm_hub_revalidation_level,
    v_assess->'required_stages',
    v_release_id, v_config_version
  ) RETURNING id INTO v_cycle_id;

  RETURN jsonb_build_object('ok',true,'cycle_id',v_cycle_id,'assessment',v_assess);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'unresolved_cycle_exists';
END $$;

-- ============================================================
-- RPC: record_comm_hub_revalidation_stage
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_comm_hub_revalidation_stage(
  p_cycle_id uuid,
  p_stage_code public.comm_hub_revalidation_stage_code,
  p_status public.comm_hub_stage_result_status,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_reused_historical boolean DEFAULT false,
  p_preview_snapshot_id uuid DEFAULT NULL,
  p_preview_approval_id uuid DEFAULT NULL,
  p_dry_run_certification_id uuid DEFAULT NULL,
  p_controlled_stub_certification_id uuid DEFAULT NULL,
  p_one_real_email_certification_id uuid DEFAULT NULL,
  p_manual_observation_id uuid DEFAULT NULL,
  p_automated_canary_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public._chrc_require_admin();
  v_cycle record;
  v_stage_id uuid;
BEGIN
  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
    WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF v_cycle.status IN ('PROMOTED','SUPERSEDED','VOIDED','FAILED','NOT_RECEIVED') THEN
    RAISE EXCEPTION 'cycle_terminal_%', v_cycle.status;
  END IF;

  INSERT INTO public.communication_hub_revalidation_stage_result(
    cycle_id, stage_code, status, evidence, reused_historical_evidence,
    preview_snapshot_id, preview_approval_id, dry_run_certification_id,
    controlled_stub_certification_id, one_real_email_certification_id,
    manual_observation_id, automated_canary_id, completed_by
  ) VALUES (
    p_cycle_id, p_stage_code, p_status, p_evidence, p_reused_historical,
    p_preview_snapshot_id, p_preview_approval_id, p_dry_run_certification_id,
    p_controlled_stub_certification_id, p_one_real_email_certification_id,
    p_manual_observation_id, p_automated_canary_id, v_uid
  ) RETURNING id INTO v_stage_id;

  -- Cycle status transitions on key stages
  IF p_stage_code = 'CHANGE_ASSESSMENT' AND p_status = 'PASSED' THEN
    UPDATE public.communication_hub_revalidation_cycle
       SET status = CASE WHEN required_validation_level IN ('NONE','NON_SENDING_ONLY')
                         THEN 'NON_SENDING_CHECKS'::public.comm_hub_revalidation_status
                         ELSE 'REVALIDATION_REQUIRED'::public.comm_hub_revalidation_status END
     WHERE id = p_cycle_id;
  END IF;

  -- If all non-email stages passed, mark READY_FOR_CONTROLLED_EMAIL
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_cycle.required_stages) s
     WHERE s.value = 'CONTROLLED_REVALIDATION_EMAIL')
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_cycle.required_stages) s
       WHERE s.value NOT IN ('CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION','BASELINE_PROMOTION','MANUAL_PRODUCTION_ACCEPTANCE','AUTOMATED_CANARY')
         AND NOT EXISTS (
           SELECT 1 FROM public.communication_hub_revalidation_stage_result r
            WHERE r.cycle_id = p_cycle_id AND r.stage_code::text = s.value
              AND r.status IN ('PASSED','ACCEPTED_UNCHANGED')
         )
    ) THEN
      UPDATE public.communication_hub_revalidation_cycle
         SET status = 'READY_FOR_CONTROLLED_EMAIL'
       WHERE id = p_cycle_id
         AND status NOT IN ('EMAIL_AUTHORISED','PROVIDER_PROCESSING','AWAITING_INBOX_CONFIRMATION','CONFIRMED','NOT_RECEIVED','PROMOTED','SUPERSEDED','VERIFIED_SUPPLEMENTAL','VOIDED','FAILED');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok',true,'stage_result_id',v_stage_id);
END $$;

-- ============================================================
-- RPC: issue_comm_hub_revalidation_send_authorisation
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_comm_hub_revalidation_send_authorisation(
  p_cycle_id uuid,
  p_recipient_email text,
  p_current_fingerprint text,
  p_typed_phrase text,
  p_expires_minutes int DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public._chrc_require_admin();
  v_cycle record;
  v_ctrl record;
  v_auth_id uuid;
BEGIN
  IF p_typed_phrase IS DISTINCT FROM 'SEND ONE CONTROLLED REVALIDATION EMAIL' THEN
    RAISE EXCEPTION 'typed_phrase_mismatch';
  END IF;
  IF p_recipient_email IS NULL OR position('@' in p_recipient_email) = 0 THEN
    RAISE EXCEPTION 'invalid_recipient';
  END IF;

  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
    WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF v_cycle.status <> 'READY_FOR_CONTROLLED_EMAIL' THEN
    RAISE EXCEPTION 'cycle_not_ready_for_email: %', v_cycle.status;
  END IF;
  IF v_cycle.controlled_email_execution_id IS NOT NULL OR v_cycle.provider_call_attempted THEN
    RAISE EXCEPTION 'provider_execution_already_exists';
  END IF;
  IF v_cycle.current_evidence_fingerprint_v2 IS DISTINCT FROM p_current_fingerprint THEN
    RAISE EXCEPTION 'fingerprint_mismatch';
  END IF;

  SELECT operating_mode, automation_state, batch_enabled, bulk_enabled
    INTO v_ctrl FROM public.communication_hub_control_settings LIMIT 1;
  IF v_ctrl.operating_mode = 'EMERGENCY_STOP' THEN RAISE EXCEPTION 'emergency_stop_active'; END IF;
  IF v_ctrl.automation_state = 'ARMED' THEN RAISE EXCEPTION 'automation_armed_blocks_revalidation'; END IF;
  IF v_ctrl.batch_enabled OR v_ctrl.bulk_enabled THEN RAISE EXCEPTION 'batch_or_bulk_enabled'; END IF;
  IF v_ctrl.operating_mode NOT IN ('MANUAL_PRODUCTION','AUTOMATED_PRODUCTION') THEN
    RAISE EXCEPTION 'invalid_operating_mode: %', v_ctrl.operating_mode;
  END IF;

  INSERT INTO public.communication_hub_revalidation_send_authorisation(
    cycle_id, recipient_email, bound_current_fingerprint,
    bound_event_certification_id, bound_production_lineage_id,
    issued_by, expires_at
  ) VALUES (
    p_cycle_id, p_recipient_email, p_current_fingerprint,
    v_cycle.baseline_event_certification_id, v_cycle.baseline_production_lineage_id,
    v_uid, now() + make_interval(mins => p_expires_minutes)
  ) RETURNING id INTO v_auth_id;

  UPDATE public.communication_hub_revalidation_cycle
     SET recipient_email = p_recipient_email,
         status = 'EMAIL_AUTHORISED'
   WHERE id = p_cycle_id;

  RETURN jsonb_build_object('ok',true,'authorisation_id',v_auth_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'active_authorisation_exists';
END $$;

-- ============================================================
-- RPC: record_comm_hub_revalidation_provider_result
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_comm_hub_revalidation_provider_result(
  p_cycle_id uuid,
  p_execution_id uuid,
  p_outcome text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public._chrc_require_admin();
BEGIN
  IF p_outcome NOT IN ('ACCEPTED','REJECTED') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;

  UPDATE public.communication_hub_revalidation_cycle
     SET controlled_email_execution_id = p_execution_id,
         provider_call_attempted = true,
         status = CASE WHEN p_outcome='ACCEPTED' THEN 'AWAITING_INBOX_CONFIRMATION'::public.comm_hub_revalidation_status
                       ELSE 'FAILED'::public.comm_hub_revalidation_status END,
         inbox_confirmation_status = CASE WHEN p_outcome='ACCEPTED' THEN 'PENDING' ELSE NULL END,
         completed_at = CASE WHEN p_outcome='REJECTED' THEN now() ELSE NULL END
   WHERE id = p_cycle_id;

  UPDATE public.communication_hub_revalidation_send_authorisation
     SET consumed_at = now(), consumed_execution_id = p_execution_id
   WHERE cycle_id = p_cycle_id AND consumed_at IS NULL AND revoked_at IS NULL;

  RETURN jsonb_build_object('ok',true);
END $$;

-- ============================================================
-- RPC: record_comm_hub_revalidation_inbox_confirmation
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_comm_hub_revalidation_inbox_confirmation(
  p_cycle_id uuid, p_status text, p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public._chrc_require_admin();
BEGIN
  IF p_status NOT IN ('CONFIRMED','NOT_RECEIVED') THEN RAISE EXCEPTION 'invalid_status'; END IF;

  UPDATE public.communication_hub_revalidation_cycle
     SET inbox_confirmation_status = p_status,
         status = CASE WHEN p_status='CONFIRMED' THEN 'CONFIRMED'::public.comm_hub_revalidation_status
                       ELSE 'NOT_RECEIVED'::public.comm_hub_revalidation_status END,
         completed_at = now()
   WHERE id = p_cycle_id;

  INSERT INTO public.communication_hub_revalidation_stage_result(
    cycle_id, stage_code, status, evidence, completed_by
  ) VALUES (
    p_cycle_id, 'INBOX_CONFIRMATION',
    CASE WHEN p_status='CONFIRMED' THEN 'PASSED'::public.comm_hub_stage_result_status
         ELSE 'FAILED'::public.comm_hub_stage_result_status END,
    jsonb_build_object('status',p_status,'notes',p_notes), v_uid
  );

  RETURN jsonb_build_object('ok',true);
END $$;

-- ============================================================
-- RPC: void_comm_hub_revalidation_cycle
-- ============================================================
CREATE OR REPLACE FUNCTION public.void_comm_hub_revalidation_cycle(
  p_cycle_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public._chrc_require_admin(); v_cycle record;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
    WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF v_cycle.provider_call_attempted THEN
    RAISE EXCEPTION 'cannot_void_provider_touched_cycle';
  END IF;

  UPDATE public.communication_hub_revalidation_cycle
     SET status = 'VOIDED', completed_at = now()
   WHERE id = p_cycle_id;
  RETURN jsonb_build_object('ok',true);
END $$;

-- ============================================================
-- RPC: mark_comm_hub_revalidation_cycle_supplemental
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_comm_hub_revalidation_cycle_supplemental(
  p_cycle_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public._chrc_require_admin(); v_cycle record;
BEGIN
  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
    WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF v_cycle.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'cycle_not_confirmed'; END IF;
  IF v_cycle.inbox_confirmation_status <> 'CONFIRMED' THEN RAISE EXCEPTION 'inbox_not_confirmed'; END IF;

  UPDATE public.communication_hub_revalidation_cycle
     SET status = 'VERIFIED_SUPPLEMENTAL', promotion_status = 'SUPPLEMENTAL'
   WHERE id = p_cycle_id;
  RETURN jsonb_build_object('ok',true);
END $$;

-- ============================================================
-- RPC: promote_comm_hub_revalidation_baseline
-- ============================================================
CREATE OR REPLACE FUNCTION public.promote_comm_hub_revalidation_baseline(
  p_cycle_id uuid, p_typed_phrase text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public._chrc_require_admin();
  v_cycle record;
  v_prev_cert_snapshot jsonb;
  v_missing_stages text[];
BEGIN
  IF p_typed_phrase IS DISTINCT FROM 'PROMOTE REVALIDATION BASELINE' THEN
    RAISE EXCEPTION 'typed_phrase_mismatch';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
    WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF v_cycle.status NOT IN ('CONFIRMED','READY_FOR_PROMOTION') THEN
    RAISE EXCEPTION 'cycle_not_promotable: %', v_cycle.status;
  END IF;
  IF v_cycle.inbox_confirmation_status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'inbox_not_confirmed';
  END IF;
  IF v_cycle.controlled_email_execution_id IS NULL THEN
    RAISE EXCEPTION 'no_provider_execution';
  END IF;

  -- Verify all required stages have PASSED/ACCEPTED_UNCHANGED
  SELECT array_agg(s) INTO v_missing_stages
    FROM jsonb_array_elements_text(v_cycle.required_stages) t(s)
   WHERE s NOT IN ('BASELINE_PROMOTION')
     AND NOT EXISTS (
       SELECT 1 FROM public.communication_hub_revalidation_stage_result r
        WHERE r.cycle_id = p_cycle_id AND r.stage_code::text = s
          AND r.status IN ('PASSED','ACCEPTED_UNCHANGED')
     );
  IF v_missing_stages IS NOT NULL AND array_length(v_missing_stages,1) > 0 THEN
    RAISE EXCEPTION 'required_stages_missing: %', array_to_string(v_missing_stages,',');
  END IF;

  -- Snapshot current event certification for immutable audit
  SELECT to_jsonb(c) INTO v_prev_cert_snapshot
    FROM public.communication_hub_event_certification c
   WHERE c.id = v_cycle.baseline_event_certification_id;

  -- Record promotion stage
  INSERT INTO public.communication_hub_revalidation_stage_result(
    cycle_id, stage_code, status, evidence, completed_by
  ) VALUES (
    p_cycle_id, 'BASELINE_PROMOTION', 'PASSED',
    jsonb_build_object(
      'previous_event_certification', v_prev_cert_snapshot,
      'previous_ore_id', v_cycle.baseline_ore_certification_id,
      'previous_lineage_id', v_cycle.baseline_production_lineage_id,
      'promoted_reason', p_reason
    ), v_uid
  );

  -- Advance the cycle to PROMOTED (baseline swap performed by follow-up
  -- migration once integration with communication_hub_event_certification
  -- is agreed; refuse to silently rewrite production anchor here).
  UPDATE public.communication_hub_revalidation_cycle
     SET status = 'PROMOTED',
         promotion_status = 'PROMOTED',
         promoted_at = now(),
         promoted_by = v_uid
   WHERE id = p_cycle_id;

  RETURN jsonb_build_object(
    'ok', true,
    'previous_event_certification', v_prev_cert_snapshot,
    'requires_operator_anchor_swap', true,
    'note', 'Promotion recorded; production anchor swap requires explicit lineage-update RPC to preserve immutability.'
  );
END $$;

-- ============================================================
-- RPC: record_comm_hub_runtime_release
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_comm_hub_runtime_release(
  p_release_reference text,
  p_git_commit_sha text,
  p_component_build_ids jsonb DEFAULT '{}'::jsonb,
  p_affected_surfaces text[] DEFAULT ARRAY[]::text[],
  p_revalidation_impact jsonb DEFAULT '{}'::jsonb,
  p_change_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public._chrc_require_admin(); v_id uuid;
BEGIN
  INSERT INTO public.communication_hub_runtime_release(
    release_reference, git_commit_sha, component_build_ids,
    affected_surfaces, revalidation_impact, change_reason, deployed_by
  ) VALUES (
    p_release_reference, p_git_commit_sha, p_component_build_ids,
    p_affected_surfaces, p_revalidation_impact, p_change_reason, v_uid
  ) ON CONFLICT (release_reference) DO UPDATE
    SET git_commit_sha = EXCLUDED.git_commit_sha,
        component_build_ids = EXCLUDED.component_build_ids,
        affected_surfaces = EXCLUDED.affected_surfaces,
        revalidation_impact = EXCLUDED.revalidation_impact,
        change_reason = EXCLUDED.change_reason,
        updated_at = now()
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $$;

-- ============================================================
-- List RPC for UI
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_comm_hub_revalidation_cycles(
  p_module_code text DEFAULT NULL, p_event_code text DEFAULT NULL, p_channel text DEFAULT NULL, p_limit int DEFAULT 50
) RETURNS SETOF public.communication_hub_revalidation_cycle
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._chrc_require_admin();
  RETURN QUERY SELECT * FROM public.communication_hub_revalidation_cycle
   WHERE (p_module_code IS NULL OR module_code = p_module_code)
     AND (p_event_code IS NULL OR event_code = p_event_code)
     AND (p_channel IS NULL OR channel = p_channel)
   ORDER BY started_at DESC LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.assess_comm_hub_revalidation_requirement(text,text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_comm_hub_revalidation_cycle(text,text,text,public.comm_hub_revalidation_purpose,text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_revalidation_stage(uuid,public.comm_hub_revalidation_stage_code,public.comm_hub_stage_result_status,jsonb,boolean,uuid,uuid,uuid,uuid,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_comm_hub_revalidation_send_authorisation(uuid,text,text,text,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_revalidation_provider_result(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_revalidation_inbox_confirmation(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_comm_hub_revalidation_cycle(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_comm_hub_revalidation_cycle_supplemental(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_comm_hub_revalidation_baseline(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_runtime_release(text,text,jsonb,text[],jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_comm_hub_revalidation_cycles(text,text,text,int) TO authenticated;
