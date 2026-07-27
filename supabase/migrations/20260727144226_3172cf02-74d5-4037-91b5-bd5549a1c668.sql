
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
#variable_conflict use_column
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_prep_version INTEGER := COALESCE(p_preparation_version, 1);
  v_key TEXT;
  v_existing RECORD;
  v_new_id UUID;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_cycle_id IS NULL OR p_authorisation_id IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PREPARE_ARGS' USING ERRCODE = '22023';
  END IF;
  IF v_prep_version < 1 THEN
    RAISE EXCEPTION 'INVALID_PREPARATION_VERSION' USING ERRCODE = '22023';
  END IF;

  v_key := 'crev-prep:' || p_cycle_id::text || ':' ||
           p_authorisation_id::text || ':' || v_prep_version::text;

  SELECT e.* INTO v_existing
    FROM public.communication_hub_revalidation_execution e
   WHERE e.cycle_id = p_cycle_id
     AND e.preparation_version = v_prep_version
     AND e.state IN ('PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','RECONCILING')
   ORDER BY e.created_at ASC LIMIT 1;

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
    SELECT 1 FROM public.communication_hub_revalidation_execution e2
     WHERE e2.cycle_id = p_cycle_id AND e2.provider_call_attempted = true
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
    SELECT e3.* INTO v_existing
      FROM public.communication_hub_revalidation_execution e3
     WHERE e3.cycle_id = p_cycle_id
       AND e3.preparation_version = v_prep_version
       AND e3.state IN ('PREPARING','READY_FOR_PROVIDER','PROVIDER_INVOKED','RECONCILING')
     ORDER BY e3.created_at ASC LIMIT 1;
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
