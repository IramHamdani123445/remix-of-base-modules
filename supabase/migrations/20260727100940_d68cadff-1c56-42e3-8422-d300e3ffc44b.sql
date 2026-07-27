CREATE OR REPLACE FUNCTION public.audit_comm_hub_runtime_contract()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_checks jsonb := '[]'::jsonb;
  v_ok boolean := true;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  -- 1. Required tables (capability -> table)
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

  -- 2. Required column on the one that Gate 2A repaired — regression guard
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'capability','baseline',
      'requirement','legacy attestation has attested_at (not created_at)',
      'object_name','communication_hub_legacy_evidence_attestation.attested_at',
      'status', CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='communication_hub_legacy_evidence_attestation' AND column_name='attested_at') THEN 'PASS' ELSE 'MISSING_COLUMN' END,
      'detail', NULL, 'fix_action', NULL
    )
  );

  -- 3. Required functions (capability -> proname with expected arg identity)
  WITH req(cap, req, fname, expect_args) AS (
    VALUES
      ('baseline',              'diagnose baseline fingerprint',                     'diagnose_comm_hub_legacy_attestation_fingerprint', 'p_module_code text, p_event_code text, p_channel text'),
      ('baseline',              'correct baseline attestation',                      'correct_comm_hub_legacy_baseline_attestation',     'p_module_code text, p_event_code text, p_channel text, p_reason text, p_typed_confirmation text'),
      ('baseline',              'attest legacy production baseline',                 'attest_comm_hub_legacy_production_baseline',       NULL),
      ('fingerprint',           'canonical evidence core fingerprint v2',            '_comm_hub_fingerprint_evidence_core_v2',           'p_core jsonb'),
      ('snapshot',              'current evidence snapshot',                         'get_comm_hub_current_evidence_snapshot',           NULL),
      ('assessment',            'assess revalidation requirement',                   'assess_comm_hub_revalidation_requirement',         NULL),
      ('assessment',            'derive required stages',                            '_chrc_derive_stages',                              NULL),
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
    'checks', v_checks,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_checks),
      'pass', (SELECT count(*) FROM jsonb_array_elements(v_checks) c WHERE (c->>'status')='PASS'),
      'fail', (SELECT count(*) FROM jsonb_array_elements(v_checks) c WHERE (c->>'status')<>'PASS')
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_comm_hub_runtime_contract() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_comm_hub_runtime_contract() TO authenticated, service_role;