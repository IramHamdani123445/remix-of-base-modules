-- A4.1: canonical preparation-context resolver for Controlled Revalidation.
-- Internal helper. Only the Edge Function (service_role) may call it. The
-- Edge Function is responsible for proving admin authority before invoking.
CREATE OR REPLACE FUNCTION public.resolve_comm_hub_revalidation_preparation_context(
  p_cycle_id UUID,
  p_authorisation_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_cycle RECORD;
  v_auth RECORD;
  v_blockers JSONB := '[]'::jsonb;
  v_authorisation_status TEXT;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'Internal resolver. Call via the Edge Function service-role client.';
  END IF;

  SELECT * INTO v_cycle FROM public.communication_hub_revalidation_cycle WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','cycle_not_found','stage','fresh_context')));
  END IF;

  SELECT * INTO v_auth FROM public.communication_hub_revalidation_send_authorisation
    WHERE id = p_authorisation_id AND cycle_id = p_cycle_id;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code','authorisation_not_found','stage','authorisation'));
  END IF;

  IF v_auth.id IS NOT NULL THEN
    IF v_auth.revoked_at IS NOT NULL THEN
      v_authorisation_status := 'REVOKED';
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code','authorisation_revoked','stage','authorisation'));
    ELSIF v_auth.consumed_at IS NOT NULL THEN
      v_authorisation_status := 'CONSUMED';
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code','authorisation_consumed','stage','authorisation'));
    ELSIF v_auth.expires_at IS NOT NULL AND v_auth.expires_at < now() THEN
      v_authorisation_status := 'EXPIRED';
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code','authorisation_expired','stage','authorisation'));
    ELSE
      v_authorisation_status := 'ISSUED';
    END IF;
    IF v_cycle.recipient_email IS NOT NULL
       AND lower(v_cycle.recipient_email) <> lower(v_auth.recipient_email) THEN
      v_blockers := v_blockers || jsonb_build_array(
        jsonb_build_object('code','recipient_mismatch','stage','authorisation'));
    END IF;
  END IF;

  IF COALESCE(v_cycle.needs_reassessment, true) THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code','cycle_needs_reassessment','stage','fresh_context'));
  END IF;
  IF COALESCE(v_cycle.assessment_version, 0) < 1 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code','assessment_missing','stage','fresh_context'));
  END IF;
  IF v_cycle.current_evidence_fingerprint_v2 IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code','current_fingerprint_missing','stage','fresh_context'));
  END IF;

  -- Refuse if a provider-boundary execution already exists for the cycle.
  IF EXISTS (
    SELECT 1 FROM public.communication_hub_revalidation_execution
    WHERE cycle_id = p_cycle_id AND provider_call_attempted = true
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('code','provider_boundary_already_entered','stage','execution'));
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'cycle_id', v_cycle.id,
    'cycle_status', v_cycle.status,
    'module_code', v_cycle.module_code,
    'event_code', v_cycle.event_code,
    'channel', v_cycle.channel,
    'authorisation_id', v_auth.id,
    'authorisation_status', v_authorisation_status,
    'recipient_email', v_auth.recipient_email,
    'baseline_ore_certification_id', v_cycle.baseline_ore_certification_id,
    'baseline_event_certification_id', v_cycle.baseline_event_certification_id,
    'production_lineage_id', v_cycle.baseline_production_lineage_id,
    'baseline_fingerprint_v2', v_cycle.baseline_evidence_fingerprint_v2,
    'current_fingerprint_v2', v_cycle.current_evidence_fingerprint_v2,
    'recipient_set_hash', v_cycle.recipient_set_hash,
    'assessment_version', v_cycle.assessment_version,
    'runtime_release_id', v_cycle.runtime_release_id,
    'blockers', v_blockers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_comm_hub_revalidation_preparation_context(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_comm_hub_revalidation_preparation_context(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.resolve_comm_hub_revalidation_preparation_context(UUID, UUID) IS
  'A4.1: server-authoritative canonical resolution for Controlled Revalidation preparation. Service-role-only. Never consumes the authorisation and never sends an email.';