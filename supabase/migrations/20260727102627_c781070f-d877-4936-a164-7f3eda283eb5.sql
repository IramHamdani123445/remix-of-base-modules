-- =============================================================================
-- CHECKPOINT A — Stabilisation and authority
-- Strengthen runtime contract, add reassessment marker, fail-closed reassess RPC.
-- =============================================================================

-- 1. Runtime-contract version stamp (used by audit RPC + reassessment).
CREATE OR REPLACE FUNCTION public.comm_hub_runtime_contract_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT 'v2026-07-27-checkpoint-a'::text $$;

-- 2. Reassessment fields on the revalidation cycle (server-owned).
ALTER TABLE public.communication_hub_revalidation_cycle
  ADD COLUMN IF NOT EXISTS assessment_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS assessed_runtime_contract_version text,
  ADD COLUMN IF NOT EXISTS assessment_fingerprint text,
  ADD COLUMN IF NOT EXISTS needs_reassessment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_reassessment_error text,
  ADD COLUMN IF NOT EXISTS last_reassessment_at timestamptz;

-- Flag every currently-unresolved cycle as needing reassessment under the new contract.
UPDATE public.communication_hub_revalidation_cycle
SET needs_reassessment = true
WHERE status NOT IN (
  'CONFIRMED','NOT_RECEIVED','FAILED','VOIDED',
  'VERIFIED_SUPPLEMENTAL','PROMOTED','SUPERSEDED'
);

-- 3. Strengthened audit_comm_hub_runtime_contract:
--    same shape as before, but adds column checks for the runtime-dispatch
--    tables, revalidation cycle, and send authorisation. Also stamps the
--    report with the runtime-contract version.
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

  ------------------------------------------------------------------------------
  -- A. Required tables (capability -> table)
  ------------------------------------------------------------------------------
  WITH req(cap, req, tbl) AS (
    VALUES
      ('preview',                  'core_template exists',                              'core_template'),
      ('preview',                  'core_template_version exists',                      'core_template_version'),
      ('preview',                  'event->template map exists',                        'communication_hub_event_template_map'),
      ('policy',                   'recipient policy table',                            'communication_hub_event_recipient_policy'),
      ('policy',                   'send policy table',                                 'communication_hub_event_send_policy'),
      ('policy',                   'review policy table',                               'communication_hub_event_review_policy'),
      ('policy',                   'payload schema table',                              'communication_hub_event_payload_schema'),
      ('provider',                 'notification providers table',                      'notification_providers'),
      ('event_certification',      'event certification table',                         'communication_hub_event_certification'),
      ('ore',                      'controlled live certification table',               'communication_controlled_live_certification'),
      ('manual_production',        'manual production observation table',               'communication_manual_production_observation'),
      ('baseline',                 'legacy evidence attestation table',                 'communication_hub_legacy_evidence_attestation'),
      ('control_settings',         'control settings table',                            'communication_hub_control_settings'),
      ('revalidation',             'revalidation cycle table',                          'communication_hub_revalidation_cycle'),
      ('revalidation',             'revalidation stage result table',                   'communication_hub_revalidation_stage_result'),
      ('revalidation',             'revalidation send authorisation table',             'communication_hub_revalidation_send_authorisation'),
      ('runtime_dispatch',         'communication request table',                       'communication_request'),
      ('runtime_dispatch',         'communication message table',                       'communication_message'),
      ('runtime_dispatch',         'communication delivery attempt table',              'communication_delivery_attempt'),
      ('runtime_dispatch',         'communication traces table',                        'communication_traces')
  )
  SELECT jsonb_agg(jsonb_build_object(
    'capability', cap,
    'requirement', req,
    'object_name', tbl,
    'status', CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables t WHERE t.table_schema='public' AND t.table_name=req.tbl) THEN 'PASS' ELSE 'MISSING_TABLE' END,
    'detail', NULL,
    'fix_action', CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables t WHERE t.table_schema='public' AND t.table_name=req.tbl) THEN NULL ELSE 'create table via migration' END
  ) ORDER BY cap, req)
  INTO v_checks FROM req;

  ------------------------------------------------------------------------------
  -- B. Required columns (capability -> table.column)
  ------------------------------------------------------------------------------
  WITH col_req(cap, req, tbl, col) AS (
    VALUES
      -- runtime dispatch: request
      ('runtime_dispatch','communication_request.request_no',           'communication_request','request_no'),
      ('runtime_dispatch','communication_request.module_code',          'communication_request','module_code'),
      ('runtime_dispatch','communication_request.event_code',           'communication_request','event_code'),
      ('runtime_dispatch','communication_request.status',               'communication_request','status'),
      ('runtime_dispatch','communication_request.payload',              'communication_request','payload'),
      ('runtime_dispatch','communication_request.context',              'communication_request','context'),
      ('runtime_dispatch','communication_request.idempotency_key',      'communication_request','idempotency_key'),
      -- runtime dispatch: message
      ('runtime_dispatch','communication_message.request_id',           'communication_message','request_id'),
      ('runtime_dispatch','communication_message.provider_id',          'communication_message','provider_id'),
      ('runtime_dispatch','communication_message.status',               'communication_message','status'),
      ('runtime_dispatch','communication_message.send_context',         'communication_message','send_context'),
      ('runtime_dispatch','communication_message.provider_message_id',  'communication_message','provider_message_id'),
      -- runtime dispatch: delivery attempt
      ('runtime_dispatch','communication_delivery_attempt.message_id',              'communication_delivery_attempt','message_id'),
      ('runtime_dispatch','communication_delivery_attempt.provider_id',             'communication_delivery_attempt','provider_id'),
      ('runtime_dispatch','communication_delivery_attempt.provider_call_attempted', 'communication_delivery_attempt','provider_call_attempted'),
      ('runtime_dispatch','communication_delivery_attempt.provider_message_id',     'communication_delivery_attempt','provider_message_id'),
      ('runtime_dispatch','communication_delivery_attempt.status',                  'communication_delivery_attempt','status'),
      -- revalidation cycle: authority + fingerprints + execution binding + reassessment
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
      -- send authorisation lifecycle columns (accept legacy names)
      ('revalidation','revalidation_send_authorisation.cycle_id',                  'communication_hub_revalidation_send_authorisation','cycle_id'),
      ('revalidation','revalidation_send_authorisation.expires_at',                'communication_hub_revalidation_send_authorisation','expires_at')
  )
  SELECT v_checks || COALESCE(jsonb_agg(jsonb_build_object(
    'capability', cap,
    'requirement', req,
    'object_name', tbl||'.'||col,
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

  ------------------------------------------------------------------------------
  -- C. Baseline attested_at column regression guard (pre-existing)
  ------------------------------------------------------------------------------
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'capability','baseline',
      'requirement','legacy attestation has attested_at (not created_at)',
      'object_name','communication_hub_legacy_evidence_attestation.attested_at',
      'status', CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='communication_hub_legacy_evidence_attestation' AND column_name='attested_at') THEN 'PASS' ELSE 'MISSING_COLUMN' END,
      'detail', NULL, 'fix_action', NULL
    )
  );

  ------------------------------------------------------------------------------
  -- D. Required functions and signatures
  ------------------------------------------------------------------------------
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
      ('automation',            'scheduler tick complete',                           'complete_comm_hub_scheduler_tick',                 NULL)
  )
  SELECT v_checks || COALESCE(jsonb_agg(jsonb_build_object(
    'capability', cap,
    'requirement', req,
    'object_name', fname,
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

REVOKE ALL ON FUNCTION public.audit_comm_hub_runtime_contract() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_comm_hub_runtime_contract() TO authenticated;

-- 4. Fail-closed reassessment RPC.
--    Recomputes assessment from current evidence. Does NOT change status,
--    baseline anchors, provider evidence, or promotion state. Stores its
--    result and clears needs_reassessment on success.
CREATE OR REPLACE FUNCTION public.reassess_comm_hub_revalidation_cycle(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cycle public.communication_hub_revalidation_cycle%ROWTYPE;
  v_snapshot jsonb;
  v_current_core jsonb;
  v_current_fp text;
  v_assessment jsonb;
  v_err text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_cycle
  FROM public.communication_hub_revalidation_cycle
  WHERE id = p_cycle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cycle_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_cycle.status IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED',
                        'VERIFIED_SUPPLEMENTAL','PROMOTED','SUPERSEDED') THEN
    -- Terminal cycles cannot be reassessed.
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'cycle_terminal',
      'status', v_cycle.status,
      'assessment_version', v_cycle.assessment_version
    );
  END IF;

  -- Fail closed if current evidence cannot be resolved.
  BEGIN
    v_snapshot := public.get_comm_hub_current_evidence_snapshot(
      v_cycle.module_code, v_cycle.event_code, v_cycle.channel
    );
    v_current_core := COALESCE(v_snapshot->'evidence_core_v2', v_snapshot);
    v_current_fp := public._comm_hub_fingerprint_evidence_core_v2(v_current_core);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    UPDATE public.communication_hub_revalidation_cycle
    SET last_reassessment_error = v_err,
        last_reassessment_at    = now(),
        needs_reassessment      = true,
        updated_at              = now()
    WHERE id = p_cycle_id;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'current_evidence_unresolved',
      'error', v_err
    );
  END;

  -- Store recomputed fields (no baseline mutation, no anchor mutation).
  UPDATE public.communication_hub_revalidation_cycle
  SET current_evidence_core_v2         = v_current_core,
      current_evidence_fingerprint_v2  = v_current_fp,
      assessment_version               = COALESCE(v_cycle.assessment_version, 0) + 1,
      assessed_at                      = now(),
      assessed_runtime_contract_version = public.comm_hub_runtime_contract_version(),
      assessment_fingerprint           = v_current_fp,
      needs_reassessment               = false,
      last_reassessment_error          = NULL,
      last_reassessment_at             = now(),
      updated_at                       = now()
  WHERE id = p_cycle_id;

  RETURN jsonb_build_object(
    'ok', true,
    'cycle_id', p_cycle_id,
    'assessment_version', COALESCE(v_cycle.assessment_version, 0) + 1,
    'assessed_runtime_contract_version', public.comm_hub_runtime_contract_version(),
    'current_evidence_fingerprint_v2', v_current_fp,
    'baseline_fingerprint_v2', v_cycle.baseline_evidence_fingerprint_v2,
    'drift', (v_cycle.baseline_evidence_fingerprint_v2 IS DISTINCT FROM v_current_fp)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reassess_comm_hub_revalidation_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassess_comm_hub_revalidation_cycle(uuid) TO authenticated;

-- 5. Runtime-contract version helper is public read.
GRANT EXECUTE ON FUNCTION public.comm_hub_runtime_contract_version() TO authenticated, anon, service_role;

COMMENT ON COLUMN public.communication_hub_revalidation_cycle.needs_reassessment IS
  'Server-owned. True whenever the cycle was created or last assessed under an older runtime-contract version, or when current evidence could not be resolved. Cleared by reassess_comm_hub_revalidation_cycle().';
COMMENT ON COLUMN public.communication_hub_revalidation_cycle.assessment_version IS
  'Monotonic per-cycle counter; incremented by reassess_comm_hub_revalidation_cycle().';