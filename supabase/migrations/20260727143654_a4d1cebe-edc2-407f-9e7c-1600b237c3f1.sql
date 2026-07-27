
-- A4.1.2B — PREPARING/finalize split for controlled revalidation preparation.

-- 1. Prepare-execution binder now inserts PREPARING (not READY_FOR_PROVIDER).
CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_prepare_execution(
  p_cycle_id uuid, p_authorisation_id uuid, p_operator_id uuid,
  p_preparation_version integer,
  p_event_certification_id uuid, p_production_lineage_id uuid,
  p_baseline_ore_certification_id uuid, p_baseline_fingerprint_v2 text,
  p_current_fingerprint_v2 text, p_template_version_id uuid,
  p_template_manifest_hash text, p_sender_profile_id uuid,
  p_recipient_policy_version text, p_recipient_set_hash text,
  p_provider_id uuid, p_runtime_build text,
  p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(execution_id uuid, reused boolean, state text,
               preparation_version integer, canonical_idempotency_key text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_prep_version INTEGER := COALESCE(p_preparation_version, 1);
  v_key TEXT;
  v_existing RECORD;
  v_new_id UUID;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501',
      HINT = 'Internal RPC. Call via the Edge Function service-role client.';
  END IF;

  IF p_cycle_id IS NULL OR p_authorisation_id IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PREPARE_ARGS' USING ERRCODE = '22023';
  END IF;
  IF v_prep_version < 1 THEN
    RAISE EXCEPTION 'INVALID_PREPARATION_VERSION' USING ERRCODE = '22023';
  END IF;

  v_key := 'crev-prep:' || p_cycle_id::text || ':' ||
           p_authorisation_id::text || ':' || v_prep_version::text;

  SELECT * INTO v_existing
    FROM public.communication_hub_revalidation_execution
   WHERE cycle_id = p_cycle_id
     AND preparation_version = v_prep_version
     AND state IN ('PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','RECONCILING')
   ORDER BY created_at ASC LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.authorisation_id IS DISTINCT FROM p_authorisation_id THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_BOUND_TO_DIFFERENT_AUTHORISATION' USING ERRCODE = '23505';
    END IF;
    IF p_recipient_set_hash IS NOT NULL
       AND v_existing.recipient_set_hash IS NOT NULL
       AND v_existing.recipient_set_hash IS DISTINCT FROM p_recipient_set_hash THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_RECIPIENT_MISMATCH' USING ERRCODE = '23505';
    END IF;
    IF p_current_fingerprint_v2 IS NOT NULL
       AND v_existing.current_fingerprint_v2 IS NOT NULL
       AND v_existing.current_fingerprint_v2 IS DISTINCT FROM p_current_fingerprint_v2 THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_FINGERPRINT_DRIFT' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true, v_existing.state,
                        v_existing.preparation_version, v_key;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.communication_hub_revalidation_execution
     WHERE cycle_id = p_cycle_id AND provider_call_attempted = true
  ) THEN
    RAISE EXCEPTION 'CYCLE_PROVIDER_BOUNDARY_ALREADY_USED' USING ERRCODE = '23505';
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
      'PREPARING', 'NOT_ENTERED', false,
      p_event_certification_id, p_production_lineage_id,
      p_baseline_ore_certification_id, p_baseline_fingerprint_v2, p_current_fingerprint_v2,
      p_template_version_id, p_template_manifest_hash, p_sender_profile_id,
      p_recipient_policy_version, p_recipient_set_hash, p_provider_id,
      p_runtime_build, COALESCE(p_metadata, '{}'::jsonb)
    ) RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
      FROM public.communication_hub_revalidation_execution
     WHERE cycle_id = p_cycle_id
       AND preparation_version = v_prep_version
       AND state IN ('PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','RECONCILING')
     ORDER BY created_at ASC LIMIT 1;
    IF v_existing.id IS NULL
       OR v_existing.authorisation_id IS DISTINCT FROM p_authorisation_id THEN
      RAISE EXCEPTION 'ACTIVE_EXECUTION_CONFLICT' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true, v_existing.state,
                        v_existing.preparation_version, v_key;
    RETURN;
  END;

  RETURN QUERY SELECT v_new_id, false, 'PREPARING'::text, v_prep_version, v_key;
END;
$function$;

REVOKE ALL ON FUNCTION public._comm_hub_revalidation_prepare_execution(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_execution(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,uuid,text,jsonb) TO service_role;


-- 2. Finalisation binder: verifies pre-provider evidence, then flips to
--    READY_FOR_PROVIDER. Never enters the provider transport.
CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_finalize_preparation(
  p_execution_id uuid,
  p_request_id uuid,
  p_message_id uuid,
  p_trace_id uuid,
  p_delivery_attempt_id uuid,
  p_recipient_snapshot_id uuid DEFAULT NULL)
 RETURNS TABLE(execution_id uuid, state text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_row RECORD;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_execution_id IS NULL OR p_request_id IS NULL OR p_message_id IS NULL
     OR p_trace_id IS NULL OR p_delivery_attempt_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_FINALIZE_ARGS' USING ERRCODE = '22023',
      HINT = 'execution/request/message/trace/attempt IDs are all required';
  END IF;

  SELECT * INTO v_row
    FROM public.communication_hub_revalidation_execution
    WHERE id = p_execution_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXECUTION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.state <> 'PREPARING' THEN
    RAISE EXCEPTION 'EXECUTION_NOT_PREPARING' USING ERRCODE = '55000',
      DETAIL = 'current_state=' || v_row.state;
  END IF;
  IF v_row.provider_call_attempted OR v_row.provider_boundary_state <> 'NOT_ENTERED' THEN
    RAISE EXCEPTION 'PROVIDER_BOUNDARY_ALREADY_ENTERED' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.communication_request WHERE id = p_request_id) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.communication_message
                 WHERE id = p_message_id AND request_id = p_request_id) THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND_OR_UNLINKED' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.communication_delivery_attempt
                 WHERE id = p_delivery_attempt_id AND message_id = p_message_id) THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND_OR_UNLINKED' USING ERRCODE = 'P0002';
  END IF;
  -- trace_id anchor: we accept the execution row itself as the correlation
  -- trace anchor for A4.1.2B (matches Edge Function behaviour). Require
  -- either the execution id, or a real communication_delivery_attempt id.
  IF p_trace_id <> p_execution_id
     AND NOT EXISTS(SELECT 1 FROM public.communication_delivery_attempt WHERE id = p_trace_id) THEN
    RAISE EXCEPTION 'TRACE_ANCHOR_INVALID' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.communication_hub_revalidation_execution
    SET request_id             = p_request_id,
        message_id             = p_message_id,
        trace_id               = p_trace_id,
        delivery_attempt_id    = p_delivery_attempt_id,
        state                  = 'READY_FOR_PROVIDER',
        provider_boundary_state= 'NOT_ENTERED',
        provider_call_attempted= false,
        metadata               = COALESCE(metadata,'{}'::jsonb)
                                 || jsonb_build_object(
                                      'finalized_at', now(),
                                      'recipient_snapshot_id', p_recipient_snapshot_id)
    WHERE id = p_execution_id;

  RETURN QUERY SELECT p_execution_id, 'READY_FOR_PROVIDER'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public._comm_hub_revalidation_finalize_preparation(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_finalize_preparation(uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;


-- 3. Extend audit_comm_hub_runtime_contract to require the finalisation RPC.
--    We dynamically append one row to the required-functions CTE so we
--    don't have to re-emit the entire 190-line function body.
DO $mig$
DECLARE
  v_def text;
  v_needle text;
  v_replacement text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='audit_comm_hub_runtime_contract';

  v_needle := $needle$'p_cycle_id uuid, p_authorisation_id uuid, p_operator_id uuid, p_preparation_version integer, p_event_certification_id uuid, p_production_lineage_id uuid, p_baseline_ore_certification_id uuid, p_baseline_fingerprint_v2 text, p_current_fingerprint_v2 text, p_template_version_id uuid, p_template_manifest_hash text, p_sender_profile_id uuid, p_recipient_policy_version text, p_recipient_set_hash text, p_provider_id uuid, p_runtime_build text, p_metadata jsonb')$needle$;

  IF position(v_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'audit function shape unexpected; cannot append finalize check';
  END IF;

  IF position($fin$_comm_hub_revalidation_finalize_preparation$fin$ IN v_def) > 0 THEN
    RAISE NOTICE 'audit already contains finalize check; skipping';
    RETURN;
  END IF;

  v_replacement := v_needle || $addl$,
      ('revalidation',          'preparation finalisation binder',                   '_comm_hub_revalidation_finalize_preparation', 'p_execution_id uuid, p_request_id uuid, p_message_id uuid, p_trace_id uuid, p_delivery_attempt_id uuid, p_recipient_snapshot_id uuid')$addl$;

  v_def := replace(v_def, v_needle, v_replacement);
  EXECUTE v_def;
END $mig$;
