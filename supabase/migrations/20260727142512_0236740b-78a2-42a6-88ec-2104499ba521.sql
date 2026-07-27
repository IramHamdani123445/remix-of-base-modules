-- ============================================================
-- A4.1.2B — Preparation version, DB-derived idempotency,
-- active-execution uniqueness, hardened resolver, and
-- runtime-contract extensions for CONTROLLED_REVALIDATION_PREPARE.
--
-- Provider boundary is NOT altered. SEND remains hard-stopped in the
-- Edge Function. No authorisation is consumed. No mode is changed.
-- ============================================================

-- ---------- §1 preparation_version column ----------
ALTER TABLE public.communication_hub_revalidation_execution
  ADD COLUMN IF NOT EXISTS preparation_version INTEGER NOT NULL DEFAULT 1;

-- Explicit backfill (idempotent — column default already applied).
UPDATE public.communication_hub_revalidation_execution
   SET preparation_version = 1
 WHERE preparation_version IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chre_preparation_version_ge_1'
  ) THEN
    ALTER TABLE public.communication_hub_revalidation_execution
      ADD CONSTRAINT chre_preparation_version_ge_1
        CHECK (preparation_version >= 1);
  END IF;
END $$;

-- Recognise PREPARING as a pre-provider preparation state so the atomic
-- prepare flow arriving in A4.1.3 has a starting state. Existing values are
-- preserved.
ALTER TABLE public.communication_hub_revalidation_execution
  DROP CONSTRAINT IF EXISTS communication_hub_revalidation_execution_state_chk;

ALTER TABLE public.communication_hub_revalidation_execution
  ADD CONSTRAINT communication_hub_revalidation_execution_state_chk
  CHECK (state = ANY (ARRAY[
    'PREPARING',
    'READY_FOR_PROVIDER',
    'PROVIDER_INVOKED',
    'PROVIDER_ACCEPTED',
    'PROVIDER_REJECTED',
    'FAILED_PRE_PROVIDER',
    'RECONCILING',
    'CONFIRMED',
    'VOIDED'
  ]));

-- ---------- §3 active execution uniqueness ----------
-- Retain the existing textual-idempotency partial unique index so any
-- fabricated key collides on the derived text as well.
-- Add a stronger structural uniqueness: at most one active pre-provider
-- execution per (cycle_id, preparation_version).
DROP INDEX IF EXISTS public.ux_chre_active_per_cycle_version;
CREATE UNIQUE INDEX ux_chre_active_per_cycle_version
  ON public.communication_hub_revalidation_execution (cycle_id, preparation_version)
  WHERE state IN ('PREPARING', 'READY_FOR_PROVIDER', 'PROVIDER_INVOKED', 'RECONCILING');

-- ---------- §2/§4 DB-derived idempotency + binding rules ----------
-- Replace the internal preparation RPC. The Edge Function may pass
-- p_preparation_version (defaults to 1); it MUST NOT supply the
-- authoritative idempotency key. The key is derived by this function.
DROP FUNCTION IF EXISTS public._comm_hub_revalidation_prepare_execution(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, text,
  uuid, text, uuid, text, text, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_prepare_execution(
  p_cycle_id                     uuid,
  p_authorisation_id             uuid,
  p_operator_id                  uuid,
  p_preparation_version          integer,
  p_event_certification_id       uuid,
  p_production_lineage_id        uuid,
  p_baseline_ore_certification_id uuid,
  p_baseline_fingerprint_v2      text,
  p_current_fingerprint_v2       text,
  p_template_version_id          uuid,
  p_template_manifest_hash       text,
  p_sender_profile_id            uuid,
  p_recipient_policy_version     text,
  p_recipient_set_hash           text,
  p_provider_id                  uuid,
  p_runtime_build                text,
  p_metadata                     jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  execution_id             uuid,
  reused                   boolean,
  state                    text,
  preparation_version      integer,
  canonical_idempotency_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_prep_version INTEGER := COALESCE(p_preparation_version, 1);
  v_key TEXT;
  v_existing RECORD;
  v_new_id UUID;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'Internal RPC. Call via the Edge Function service-role client.';
  END IF;

  IF p_cycle_id IS NULL OR p_authorisation_id IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PREPARE_ARGS'
      USING ERRCODE = '22023';
  END IF;
  IF v_prep_version < 1 THEN
    RAISE EXCEPTION 'INVALID_PREPARATION_VERSION'
      USING ERRCODE = '22023';
  END IF;

  -- Cycle + authorisation binding: derived key is the ONLY key.
  v_key := 'crev-prep:' || p_cycle_id::text || ':' ||
           p_authorisation_id::text || ':' || v_prep_version::text;

  -- Reuse only when everything canonical matches. Otherwise reject.
  SELECT * INTO v_existing
    FROM public.communication_hub_revalidation_execution
   WHERE cycle_id = p_cycle_id
     AND preparation_version = v_prep_version
     AND state IN ('PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','RECONCILING')
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.authorisation_id IS DISTINCT FROM p_authorisation_id THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_BOUND_TO_DIFFERENT_AUTHORISATION'
        USING ERRCODE = '23505';
    END IF;
    IF p_recipient_set_hash IS NOT NULL
       AND v_existing.recipient_set_hash IS NOT NULL
       AND v_existing.recipient_set_hash IS DISTINCT FROM p_recipient_set_hash THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_RECIPIENT_MISMATCH'
        USING ERRCODE = '23505';
    END IF;
    IF p_current_fingerprint_v2 IS NOT NULL
       AND v_existing.current_fingerprint_v2 IS NOT NULL
       AND v_existing.current_fingerprint_v2 IS DISTINCT FROM p_current_fingerprint_v2 THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_FINGERPRINT_DRIFT'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
      SELECT v_existing.id, true, v_existing.state,
             v_existing.preparation_version, v_key;
    RETURN;
  END IF;

  -- One provider-boundary execution per cycle across all versions.
  IF EXISTS (
    SELECT 1 FROM public.communication_hub_revalidation_execution
     WHERE cycle_id = p_cycle_id
       AND provider_call_attempted = true
  ) THEN
    RAISE EXCEPTION 'CYCLE_PROVIDER_BOUNDARY_ALREADY_USED'
      USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO public.communication_hub_revalidation_execution (
      cycle_id, authorisation_id, operator_id, idempotency_key,
      preparation_version,
      state, provider_boundary_state, provider_call_attempted,
      event_certification_id, production_lineage_id,
      baseline_ore_certification_id, baseline_fingerprint_v2, current_fingerprint_v2,
      template_version_id, template_manifest_hash, sender_profile_id,
      recipient_policy_version, recipient_set_hash, provider_id,
      runtime_build, metadata
    ) VALUES (
      p_cycle_id, p_authorisation_id, p_operator_id, v_key,
      v_prep_version,
      'READY_FOR_PROVIDER', 'NOT_ENTERED', false,
      p_event_certification_id, p_production_lineage_id,
      p_baseline_ore_certification_id, p_baseline_fingerprint_v2, p_current_fingerprint_v2,
      p_template_version_id, p_template_manifest_hash, p_sender_profile_id,
      p_recipient_policy_version, p_recipient_set_hash, p_provider_id,
      p_runtime_build, COALESCE(p_metadata, '{}'::jsonb)
    ) RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent caller won the race. Return the row they wrote if it
    -- matches this authorisation, otherwise surface a clean conflict.
    SELECT * INTO v_existing
      FROM public.communication_hub_revalidation_execution
     WHERE cycle_id = p_cycle_id
       AND preparation_version = v_prep_version
       AND state IN ('PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','RECONCILING')
     ORDER BY created_at ASC
     LIMIT 1;
    IF v_existing.id IS NULL
       OR v_existing.authorisation_id IS DISTINCT FROM p_authorisation_id THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true, v_existing.state,
                        v_existing.preparation_version, v_key;
    RETURN;
  END;

  RETURN QUERY SELECT v_new_id, false, 'READY_FOR_PROVIDER'::text,
                      v_prep_version, v_key;
END;
$$;

-- ---------- §5/§6 Hardened resolver + full envelope ----------
CREATE OR REPLACE FUNCTION public.resolve_comm_hub_revalidation_preparation_context(
  p_cycle_id         uuid,
  p_authorisation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_cycle RECORD;
  v_auth RECORD;
  v_snapshot JSONB;
  v_current_core JSONB;
  v_current_fingerprint TEXT;
  v_attestation RECORD;
  v_template RECORD;
  v_sender RECORD;
  v_provider RECORD;
  v_control RECORD;
  v_stage_ok BOOLEAN := true;
  v_required_stages JSONB := '[]'::jsonb;
  v_authorisation_status TEXT := NULL;
  v_blockers JSONB := '[]'::jsonb;
  v_warnings JSONB := '[]'::jsonb;
  v_prep_version INTEGER := 1;
  v_canonical_key TEXT := NULL;
  v_baseline_ok BOOLEAN := true;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'Internal resolver. Call via the Edge Function service-role client.';
  END IF;

  -- A. Cycle
  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle
   WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','cycle_not_found','stage','cycle'))
    );
  END IF;

  v_required_stages := COALESCE(v_cycle.required_stages, '[]'::jsonb);

  IF COALESCE(v_cycle.needs_reassessment, true) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','cycle_needs_reassessment','stage','cycle'));
  END IF;
  IF COALESCE(v_cycle.assessment_version, 0) < 1 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','assessment_version_zero','stage','cycle'));
  END IF;
  IF v_cycle.assessed_at IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','assessed_at_missing','stage','cycle'));
  END IF;
  IF v_cycle.assessment_fingerprint IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','assessment_fingerprint_missing','stage','cycle'));
  END IF;
  IF v_cycle.last_reassessment_error IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','last_reassessment_error_present','stage','cycle',
      'detail', v_cycle.last_reassessment_error));
  END IF;

  -- Required stages complete
  IF jsonb_typeof(v_required_stages) = 'array'
     AND jsonb_array_length(v_required_stages) > 0 THEN
    SELECT bool_and(EXISTS(
      SELECT 1 FROM public.communication_hub_revalidation_stage_result r
       WHERE r.cycle_id = p_cycle_id
         AND r.stage_code = s.stage_code
         AND r.status IN ('PASS','COMPLETED','VERIFIED')
    ))
      INTO v_stage_ok
      FROM (SELECT jsonb_array_elements_text(v_required_stages) AS stage_code) s;
    IF NOT COALESCE(v_stage_ok, false) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','required_stage_incomplete','stage','cycle'));
    END IF;
  END IF;

  -- B. Authorisation
  SELECT * INTO v_auth
    FROM public.communication_hub_revalidation_send_authorisation
   WHERE id = p_authorisation_id
     AND cycle_id = p_cycle_id;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','authorisation_not_found','stage','authorisation'));
  ELSE
    IF v_auth.revoked_at IS NOT NULL THEN
      v_authorisation_status := 'REVOKED';
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','authorisation_revoked','stage','authorisation'));
    ELSIF v_auth.consumed_at IS NOT NULL THEN
      v_authorisation_status := 'CONSUMED';
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','authorisation_consumed','stage','authorisation'));
    ELSIF v_auth.expires_at IS NOT NULL AND v_auth.expires_at < now() THEN
      v_authorisation_status := 'EXPIRED';
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','authorisation_expired','stage','authorisation'));
    ELSE
      v_authorisation_status := 'ISSUED';
    END IF;

    IF v_cycle.recipient_email IS NOT NULL
       AND lower(v_cycle.recipient_email) IS DISTINCT FROM lower(v_auth.recipient_email) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','recipient_mismatch','stage','authorisation'));
    END IF;
    IF v_auth.bound_event_certification_id IS DISTINCT FROM v_cycle.baseline_event_certification_id THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','event_certification_mismatch','stage','authorisation'));
    END IF;
    IF v_auth.bound_production_lineage_id IS DISTINCT FROM v_cycle.baseline_production_lineage_id THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','production_lineage_mismatch','stage','authorisation'));
    END IF;
  END IF;

  -- C. Fresh snapshot + fingerprint recompute.
  BEGIN
    v_snapshot := public.get_comm_hub_current_evidence_snapshot(
      v_cycle.module_code, v_cycle.event_code, v_cycle.channel);
    v_current_core := COALESCE(v_snapshot->'evidence_core', v_snapshot);
    v_current_fingerprint := public._comm_hub_fingerprint_evidence_core_v2(v_current_core);
  EXCEPTION WHEN OTHERS THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','current_snapshot_error','stage','current_authority',
      'detail', SQLERRM));
  END;

  IF v_current_fingerprint IS NOT NULL THEN
    IF v_cycle.current_evidence_fingerprint_v2 IS DISTINCT FROM v_current_fingerprint THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','cycle_current_fingerprint_stale','stage','current_authority'));
    END IF;
    IF v_cycle.assessment_fingerprint IS NOT NULL
       AND v_cycle.assessment_fingerprint IS DISTINCT FROM v_current_fingerprint THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','assessment_fingerprint_drift','stage','current_authority'));
    END IF;
    IF v_auth.bound_current_fingerprint IS NOT NULL
       AND v_auth.bound_current_fingerprint IS DISTINCT FROM v_current_fingerprint THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','authorisation_fingerprint_drift','stage','authorisation'));
    END IF;
  END IF;

  -- D. Production authority — event certification + ORE + baseline attestation
  IF v_cycle.baseline_event_certification_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','baseline_event_certification_missing','stage','production_authority'));
  ELSIF NOT EXISTS(
    SELECT 1 FROM public.communication_hub_event_certification
     WHERE id = v_cycle.baseline_event_certification_id
       AND module_code = v_cycle.module_code
       AND event_code = v_cycle.event_code
       AND channel = v_cycle.channel
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','event_certification_not_matched','stage','production_authority'));
  END IF;

  IF v_cycle.baseline_ore_certification_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','baseline_ore_missing','stage','production_authority'));
  END IF;

  IF v_cycle.baseline_production_lineage_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','baseline_production_lineage_missing','stage','production_authority'));
  END IF;

  SELECT * INTO v_attestation
    FROM public.communication_hub_legacy_evidence_attestation
   WHERE module_code = v_cycle.module_code
     AND event_code = v_cycle.event_code
     AND channel = v_cycle.channel
     AND (revoked_at IS NULL)
   ORDER BY attested_at DESC NULLS LAST
   LIMIT 1;
  IF v_attestation.id IS NULL THEN
    v_baseline_ok := false;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','baseline_attestation_missing','stage','production_authority'));
  END IF;

  -- E. Recipient policy resolution
  IF v_cycle.recipient_email IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','canonical_recipient_missing','stage','recipient'));
  END IF;
  IF v_cycle.recipient_set_hash IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','recipient_set_hash_missing','stage','recipient'));
  END IF;

  -- F. Template resolution
  SELECT * INTO v_template
    FROM public.communication_hub_event_template_map
   WHERE module_code = v_cycle.module_code
     AND event_code = v_cycle.event_code
     AND channel = v_cycle.channel
     AND active = true
   LIMIT 1;
  IF v_template.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','template_mapping_missing','stage','template'));
  END IF;

  -- G. Sender resolution
  SELECT * INTO v_sender
    FROM public.communication_hub_sender_profile
   WHERE (v_template.sender_profile_id IS NOT NULL AND id = v_template.sender_profile_id)
      OR (v_template.sender_profile_id IS NULL AND is_default = true AND is_enabled = true)
   ORDER BY (id = v_template.sender_profile_id) DESC NULLS LAST,
            is_default DESC, updated_at DESC
   LIMIT 1;
  IF v_sender.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','sender_profile_missing','stage','sender'));
  ELSIF NOT COALESCE(v_sender.is_enabled, false) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','sender_profile_disabled','stage','sender'));
  END IF;

  -- H. Provider configuration resolution (no transport)
  SELECT * INTO v_provider
    FROM public.notification_providers
   WHERE is_active = true
   ORDER BY updated_at DESC
   LIMIT 1;
  IF v_provider.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','provider_configuration_missing','stage','provider'));
  END IF;

  -- I. Control settings — SEND must remain hard-stopped, provider boundary
  --    approval must remain FALSE, automation must remain unarmed.
  SELECT * INTO v_control
    FROM public.communication_hub_control_settings
   ORDER BY updated_at DESC
   LIMIT 1;
  IF v_control.id IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','control_settings_unavailable','stage','control_settings'));
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'cycle', jsonb_build_object(
      'id', v_cycle.id,
      'module_code', v_cycle.module_code,
      'event_code', v_cycle.event_code,
      'channel', v_cycle.channel,
      'status', v_cycle.status,
      'needs_reassessment', v_cycle.needs_reassessment,
      'assessment_version', v_cycle.assessment_version,
      'assessed_at', v_cycle.assessed_at,
      'assessment_fingerprint', v_cycle.assessment_fingerprint,
      'required_stages', v_required_stages,
      'last_reassessment_error', v_cycle.last_reassessment_error
    ),
    'authorisation', jsonb_build_object(
      'id', v_auth.id,
      'status', v_authorisation_status,
      'recipient', v_auth.recipient_email,
      'fingerprint', v_auth.bound_current_fingerprint,
      'issued_at', v_auth.issued_at,
      'expires_at', v_auth.expires_at,
      'consumed_at', v_auth.consumed_at,
      'revoked_at', v_auth.revoked_at
    ),
    'production_authority', jsonb_build_object(
      'event_certification_id', v_cycle.baseline_event_certification_id,
      'ore_certification_id', v_cycle.baseline_ore_certification_id,
      'production_lineage_id', v_cycle.baseline_production_lineage_id,
      'evidence_authority', CASE WHEN v_baseline_ok THEN 'ACTIVE' ELSE 'MISSING' END,
      'baseline_attestation_id', v_attestation.id,
      'baseline_fingerprint', v_cycle.baseline_evidence_fingerprint_v2
    ),
    'current_authority', jsonb_build_object(
      'evidence_core', v_current_core,
      'fingerprint', v_current_fingerprint,
      'snapshot_generated_at', now()
    ),
    'recipient', jsonb_build_object(
      'email', v_cycle.recipient_email,
      'policy_version', NULL,
      'recipient_set_hash', v_cycle.recipient_set_hash
    ),
    'template', jsonb_build_object(
      'version_id', v_template.template_id,
      'template_code', v_template.template_code,
      'manifest_hash', NULL,
      'renderer_code', 'core_template_renderer'
    ),
    'sender', jsonb_build_object(
      'profile_id', v_sender.id,
      'from_email', v_sender.from_email,
      'display_name', v_sender.display_name
    ),
    'provider_configuration', jsonb_build_object(
      'provider_id', v_provider.id,
      'provider_type', v_provider.provider_type,
      'configuration_version', NULL
    ),
    'control_settings', jsonb_build_object(
      'operating_mode', v_control.operating_mode,
      'automation_state', v_control.automation_state,
      'provider_boundary_approved', false
    ),
    'preparation_version', v_prep_version,
    'canonical_idempotency_key',
      'crev-prep:' || p_cycle_id::text || ':' ||
      COALESCE(p_authorisation_id::text,'null') || ':' || v_prep_version::text,
    -- Back-compat convenience fields used by the current Edge Function
    'cycle_id', v_cycle.id,
    'cycle_status', v_cycle.status,
    'module_code', v_cycle.module_code,
    'event_code', v_cycle.event_code,
    'channel', v_cycle.channel,
    'authorisation_id', v_auth.id,
    'authorisation_status', v_authorisation_status,
    'recipient_email', v_cycle.recipient_email,
    'baseline_event_certification_id', v_cycle.baseline_event_certification_id,
    'baseline_ore_certification_id', v_cycle.baseline_ore_certification_id,
    'production_lineage_id', v_cycle.baseline_production_lineage_id,
    'baseline_fingerprint_v2', v_cycle.baseline_evidence_fingerprint_v2,
    'current_fingerprint_v2', v_current_fingerprint,
    'recipient_set_hash', v_cycle.recipient_set_hash
  );
END;
$$;

-- ---------- §7 Runtime-contract extensions ----------
-- Wrap existing audit with additional checks for A4.1.2B artefacts.
CREATE OR REPLACE FUNCTION public.audit_comm_hub_runtime_contract()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_checks jsonb := '[]'::jsonb;
  v_ok boolean := true;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  -- A. Required tables
  WITH req(cap, req, tbl) AS (
    VALUES
      ('preview',                  'core_template exists',                              'core_template'),
      ('preview',                  'core_template_version exists',                      'core_template_version'),
      ('preview',                  'event->template map exists',                        'communication_hub_event_template_map'),
      ('policy',                   'recipient policy table',                            'communication_hub_recipient_policy'),
      ('policy',                   'send policy table',                                 'communication_hub_event_send_policy'),
      ('policy',                   'review policy table',                               'communication_hub_event_review_policy'),
      ('policy',                   'payload schema table',                              'communication_hub_event_payload_schema'),
      ('provider',                 'notification providers table',                      'notification_providers'),
      ('provider',                 'sender profile table',                              'communication_hub_sender_profile'),
      ('event_certification',      'event certification table',                         'communication_hub_event_certification'),
      ('ore',                      'controlled live certification table',               'communication_controlled_live_certification'),
      ('manual_production',        'manual production observation table',               'communication_manual_production_observation'),
      ('baseline',                 'legacy evidence attestation table',                 'communication_hub_legacy_evidence_attestation'),
      ('control_settings',         'control settings table',                            'communication_hub_control_settings'),
      ('revalidation',             'revalidation cycle table',                          'communication_hub_revalidation_cycle'),
      ('revalidation',             'revalidation stage result table',                   'communication_hub_revalidation_stage_result'),
      ('revalidation',             'revalidation send authorisation table',             'communication_hub_revalidation_send_authorisation'),
      ('revalidation',             'revalidation execution table',                      'communication_hub_revalidation_execution'),
      ('runtime_dispatch',         'communication request table',                       'communication_request'),
      ('runtime_dispatch',         'communication message table',                       'communication_message'),
      ('runtime_dispatch',         'communication delivery attempt table',              'communication_delivery_attempt')
  )
  SELECT jsonb_agg(jsonb_build_object(
    'capability', cap, 'requirement', req, 'object_name', tbl,
    'status', CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables t WHERE t.table_schema='public' AND t.table_name=req.tbl) THEN 'PASS' ELSE 'MISSING_TABLE' END,
    'detail', NULL,
    'fix_action', CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables t WHERE t.table_schema='public' AND t.table_name=req.tbl) THEN NULL ELSE 'create table via migration' END
  ) ORDER BY cap, req)
  INTO v_checks FROM req;

  -- B. Required columns (adds preparation_version)
  WITH col_req(cap, req, tbl, col) AS (
    VALUES
      ('runtime_dispatch','communication_request.request_no',           'communication_request','request_no'),
      ('runtime_dispatch','communication_request.module_code',          'communication_request','module_code'),
      ('runtime_dispatch','communication_request.event_code',           'communication_request','event_code'),
      ('runtime_dispatch','communication_request.status',               'communication_request','status'),
      ('runtime_dispatch','communication_request.payload',              'communication_request','payload'),
      ('runtime_dispatch','communication_request.context',              'communication_request','context'),
      ('runtime_dispatch','communication_request.idempotency_key',      'communication_request','idempotency_key'),
      ('runtime_dispatch','communication_message.request_id',           'communication_message','request_id'),
      ('runtime_dispatch','communication_message.provider_id',          'communication_message','provider_id'),
      ('runtime_dispatch','communication_message.status',               'communication_message','status'),
      ('runtime_dispatch','communication_message.send_context',         'communication_message','send_context'),
      ('runtime_dispatch','communication_message.provider_message_id',  'communication_message','provider_message_id'),
      ('runtime_dispatch','communication_delivery_attempt.message_id',              'communication_delivery_attempt','message_id'),
      ('runtime_dispatch','communication_delivery_attempt.provider_id',             'communication_delivery_attempt','provider_id'),
      ('runtime_dispatch','communication_delivery_attempt.provider_call_attempted', 'communication_delivery_attempt','provider_call_attempted'),
      ('runtime_dispatch','communication_delivery_attempt.provider_message_id',     'communication_delivery_attempt','provider_message_id'),
      ('runtime_dispatch','communication_delivery_attempt.status',                  'communication_delivery_attempt','status'),
      ('revalidation','revalidation_cycle.status',                                 'communication_hub_revalidation_cycle','status'),
      ('revalidation','revalidation_cycle.provider_call_attempted',                'communication_hub_revalidation_cycle','provider_call_attempted'),
      ('revalidation','revalidation_cycle.controlled_email_execution_id',          'communication_hub_revalidation_cycle','controlled_email_execution_id'),
      ('revalidation','revalidation_cycle.current_evidence_fingerprint_v2',        'communication_hub_revalidation_cycle','current_evidence_fingerprint_v2'),
      ('revalidation','revalidation_cycle.baseline_event_certification_id',        'communication_hub_revalidation_cycle','baseline_event_certification_id'),
      ('revalidation','revalidation_cycle.baseline_ore_certification_id',          'communication_hub_revalidation_cycle','baseline_ore_certification_id'),
      ('revalidation','revalidation_cycle.baseline_production_lineage_id',         'communication_hub_revalidation_cycle','baseline_production_lineage_id'),
      ('revalidation','revalidation_cycle.needs_reassessment',                     'communication_hub_revalidation_cycle','needs_reassessment'),
      ('revalidation','revalidation_cycle.assessment_version',                     'communication_hub_revalidation_cycle','assessment_version'),
      ('revalidation','revalidation_cycle.assessed_runtime_contract_version',      'communication_hub_revalidation_cycle','assessed_runtime_contract_version'),
      ('revalidation','revalidation_cycle.assessed_at',                            'communication_hub_revalidation_cycle','assessed_at'),
      ('revalidation','revalidation_cycle.assessment_fingerprint',                 'communication_hub_revalidation_cycle','assessment_fingerprint'),
      ('revalidation','revalidation_cycle.last_reassessment_error',                'communication_hub_revalidation_cycle','last_reassessment_error'),
      ('revalidation','revalidation_send_authorisation.cycle_id',                  'communication_hub_revalidation_send_authorisation','cycle_id'),
      ('revalidation','revalidation_send_authorisation.expires_at',                'communication_hub_revalidation_send_authorisation','expires_at'),
      ('revalidation','revalidation_send_authorisation.bound_current_fingerprint', 'communication_hub_revalidation_send_authorisation','bound_current_fingerprint'),
      ('revalidation','revalidation_execution.preparation_version',                'communication_hub_revalidation_execution','preparation_version'),
      ('revalidation','revalidation_execution.authorisation_id',                   'communication_hub_revalidation_execution','authorisation_id'),
      ('revalidation','revalidation_execution.recipient_set_hash',                 'communication_hub_revalidation_execution','recipient_set_hash'),
      ('revalidation','revalidation_execution.current_fingerprint_v2',             'communication_hub_revalidation_execution','current_fingerprint_v2')
  )
  SELECT v_checks || COALESCE(jsonb_agg(jsonb_build_object(
    'capability', cap, 'requirement', req, 'object_name', tbl||'.'||col,
    'status', CASE WHEN EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=col_req.tbl AND column_name=col_req.col
    ) THEN 'PASS' ELSE 'MISSING_COLUMN' END,
    'detail', NULL,
    'fix_action', CASE WHEN EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=col_req.tbl AND column_name=col_req.col
    ) THEN NULL ELSE 'add column via migration' END
  ) ORDER BY cap, req), '[]'::jsonb)
  INTO v_checks FROM col_req;

  -- C. Baseline column regression guard
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'capability','baseline',
      'requirement','legacy attestation has attested_at (not created_at)',
      'object_name','communication_hub_legacy_evidence_attestation.attested_at',
      'status', CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='communication_hub_legacy_evidence_attestation' AND column_name='attested_at') THEN 'PASS' ELSE 'MISSING_COLUMN' END,
      'detail', NULL, 'fix_action', NULL
    )
  );

  -- C2. Unique active pre-provider execution index
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'capability','revalidation',
      'requirement','unique active pre-provider execution per (cycle_id, preparation_version)',
      'object_name','ux_chre_active_per_cycle_version',
      'status', CASE WHEN EXISTS(
        SELECT 1 FROM pg_indexes
         WHERE schemaname='public'
           AND tablename='communication_hub_revalidation_execution'
           AND indexname='ux_chre_active_per_cycle_version'
      ) THEN 'PASS' ELSE 'MISSING_INDEX' END,
      'detail', NULL,
      'fix_action', 'create partial unique index via migration'
    )
  );

  -- D. Required functions and signatures (adds hardened resolver + prep RPC)
  WITH req(cap, req, fname, expect_args) AS (
    VALUES
      ('baseline',              'diagnose baseline fingerprint',                     'diagnose_comm_hub_legacy_attestation_fingerprint', 'p_module_code text, p_event_code text, p_channel text'),
      ('baseline',              'correct baseline attestation',                      'correct_comm_hub_legacy_baseline_attestation',     'p_module_code text, p_event_code text, p_channel text, p_reason text, p_typed_confirmation text'),
      ('baseline',              'attest legacy production baseline',                 'attest_comm_hub_legacy_production_baseline',       NULL),
      ('fingerprint',           'canonical evidence core fingerprint v2',            '_comm_hub_fingerprint_evidence_core_v2',           'p_core jsonb'),
      ('snapshot',              'current evidence snapshot',                         'get_comm_hub_current_evidence_snapshot',           NULL),
      ('assessment',            'assess revalidation requirement',                   'assess_comm_hub_revalidation_requirement',         NULL),
      ('assessment',            'derive required stages',                            '_chrc_derive_stages',                              NULL),
      ('assessment',            'reassess revalidation cycle',                       'reassess_comm_hub_revalidation_cycle',             'p_cycle_id uuid'),
      ('baseline',              'resolve production baseline',                       '_chrc_get_production_baseline',                    NULL),
      ('revalidation_runtime',  'reserve revalidation send authorisation',           'reserve_comm_hub_revalidation_send_authorisation', NULL),
      ('revalidation_runtime',  'get revalidation send context',                     'get_comm_hub_revalidation_send_context',           NULL),
      ('revalidation_runtime',  'record provider result',                            'record_comm_hub_revalidation_provider_result',     NULL),
      ('revalidation_runtime',  'issue send authorisation',                          'issue_comm_hub_revalidation_send_authorisation',   NULL),
      ('revalidation_runtime',  'start revalidation cycle',                          'start_comm_hub_revalidation_cycle',                NULL),
      ('revalidation_runtime',  'promote revalidation baseline',                     'promote_comm_hub_revalidation_baseline',           NULL),
      ('mode_transitions',      'apply communication release mode',                  'apply_communication_release_mode',                 NULL),
      ('manual_production',     'finalize manual production observation',            'finalize_comm_hub_manual_production_observation',  NULL),
      ('automated_readiness',   'pre-arm readiness probe',                           'run_comm_hub_automation_readiness_probe',          NULL),
      ('automation',            'arm automation',                                    'arm_comm_hub_automation',                          NULL),
      ('automation',            'scheduler tick begin',                              'begin_comm_hub_scheduler_tick',                    NULL),
      ('automation',            'scheduler tick complete',                           'complete_comm_hub_scheduler_tick',                 NULL),
      ('revalidation',          'preparation context resolver (hardened)',           'resolve_comm_hub_revalidation_preparation_context', 'p_cycle_id uuid, p_authorisation_id uuid'),
      ('revalidation',          'preparation execution binder (DB-derived key)',     '_comm_hub_revalidation_prepare_execution',
        'p_cycle_id uuid, p_authorisation_id uuid, p_operator_id uuid, p_preparation_version integer, p_event_certification_id uuid, p_production_lineage_id uuid, p_baseline_ore_certification_id uuid, p_baseline_fingerprint_v2 text, p_current_fingerprint_v2 text, p_template_version_id uuid, p_template_manifest_hash text, p_sender_profile_id uuid, p_recipient_policy_version text, p_recipient_set_hash text, p_provider_id uuid, p_runtime_build text, p_metadata jsonb')
  )
  SELECT v_checks || COALESCE(jsonb_agg(jsonb_build_object(
    'capability', cap, 'requirement', req, 'object_name', fname,
    'status', CASE
      WHEN NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=req.fname) THEN 'MISSING_FUNCTION'
      WHEN req.expect_args IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=req.fname
          AND pg_get_function_identity_arguments(p.oid)=req.expect_args
      ) THEN 'SIGNATURE_MISMATCH'
      ELSE 'PASS'
    END,
    'detail', (SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=req.fname),
    'fix_action', CASE WHEN NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=req.fname) THEN 'create function via migration' ELSE NULL END
  ) ORDER BY cap, req), '[]'::jsonb)
  INTO v_checks FROM req;

  SELECT bool_and((c->>'status')='PASS') INTO v_ok
    FROM jsonb_array_elements(v_checks) c;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'checked_at', now(),
    'runtime_contract_version', public.comm_hub_runtime_contract_version(),
    'checks', v_checks,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_checks),
      'pass', (SELECT count(*) FROM jsonb_array_elements(v_checks) c WHERE (c->>'status')='PASS'),
      'fail', (SELECT count(*) FROM jsonb_array_elements(v_checks) c WHERE (c->>'status')<>'PASS')
    )
  );
END;
$$;

-- ---------- §8 Permissions ----------
REVOKE ALL ON FUNCTION public._comm_hub_revalidation_prepare_execution(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text,
  uuid, text, uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._comm_hub_revalidation_prepare_execution(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text,
  uuid, text, uuid, text, text, uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_execution(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text,
  uuid, text, uuid, text, text, uuid, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_comm_hub_revalidation_preparation_context(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_comm_hub_revalidation_preparation_context(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_comm_hub_revalidation_preparation_context(uuid, uuid) TO service_role;