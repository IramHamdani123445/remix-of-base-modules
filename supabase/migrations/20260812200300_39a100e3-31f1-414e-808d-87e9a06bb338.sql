CREATE OR REPLACE FUNCTION public.omni_comms_priv_live_delivery_request(
  p_actor uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_deployed_revision text,
  p_intent text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_ind jsonb;
  v_blockers text[];
  v_from text;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'OC401 authentication_required'; END IF;
  IF p_intent NOT IN ('enable','disable') THEN RAISE EXCEPTION 'invalid_intent'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor, p_organization_id, p_department_id);

  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control r
  WHERE r.id = (public.omni_comms_priv_channel_release_effective(
                  p_organization_id, p_department_id, p_channel)).id
  FOR UPDATE;

  IF v_rel.id IS NULL THEN
    RETURN jsonb_build_object('state','action_required','blockers',
      to_jsonb(ARRAY['release_control_missing']));
  END IF;
  IF v_rel.data_origin = 'reference_seed' THEN
    RETURN jsonb_build_object('state','action_required','blockers',
      to_jsonb(ARRAY['reference_release_non_operational']));
  END IF;

  IF p_intent = 'disable' THEN
    IF NOT public.has_permission(p_actor, 'omni_comms', 'operate') THEN
      RAISE EXCEPTION 'OC403 permission_denied' USING DETAIL='operate';
    END IF;
    v_from := v_rel.release_state;
    UPDATE public.omni_comms_channel_release_control SET
      release_state = 'suspended',
      release_version = release_version + 1,
      proposed_state = NULL, proposal_reason = NULL, proposed_by = NULL,
      proposed_at = NULL, proposal_expires_at = NULL,
      suspended_by = p_actor, suspended_at = now(),
      suspension_reason = public.omni_comms_priv_normalize_reason(
        'Operator turned automatic delivery off.', true),
      updated_by = p_actor
    WHERE id = v_rel.id RETURNING * INTO v_rel;
    PERFORM public.omni_comms_priv_channel_release_record_event(
      v_rel, 'release_suspended', v_from, 'suspended', v_rel.suspension_reason,
      p_actor, p_correlation_id, NULL, '{}'::jsonb);
    RETURN jsonb_build_object('state','suspended','blockers','[]'::jsonb);
  END IF;

  IF NOT (public.has_permission(p_actor, 'omni_comms', 'configure')
          OR public.has_permission(p_actor, 'omni_comms', 'operate')) THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING DETAIL='configure';
  END IF;

  IF v_rel.release_state = 'live' THEN
    RETURN jsonb_build_object('state','on','blockers','[]'::jsonb);
  END IF;

  -- Safe deterministic administrative preparation: a valid governed window and
  -- the configured production quotas. An expiry always remains in force.
  IF v_rel.release_state IN ('test_only','controlled_pilot','suspended')
     AND v_rel.proposed_state IS DISTINCT FROM 'live' THEN
    UPDATE public.omni_comms_channel_release_control SET
      release_starts_at = now(),
      release_expires_at = now() + interval '7 days',
      max_recipients_per_request = 1,
      max_messages_per_hour = greatest(coalesce(max_messages_per_hour, 20), 20),
      max_messages_per_day = greatest(coalesce(max_messages_per_day, 100), 100),
      max_messages_total = NULL,
      updated_by = p_actor
    WHERE id = v_rel.id RETURNING * INTO v_rel;
  END IF;

  v_ind := public.omni_comms_priv_live_delivery_indicators(
    p_organization_id, p_department_id, p_channel, v_rel.id, p_deployed_revision);
  SELECT coalesce(array_agg(c), '{}') INTO v_blockers
  FROM jsonb_array_elements_text(v_ind->'failed_codes') c;

  IF array_length(v_blockers,1) IS NOT NULL THEN
    RETURN jsonb_build_object('state','action_required','blockers', to_jsonb(v_blockers));
  END IF;

  IF v_rel.proposed_state = 'live'
     AND (v_rel.proposal_expires_at IS NULL OR v_rel.proposal_expires_at > now()) THEN
    IF v_rel.proposed_by = p_actor THEN
      RETURN jsonb_build_object('state','awaiting_approval','self_proposed', true,
        'blockers','[]'::jsonb);
    END IF;
    RETURN jsonb_build_object(
      'state','approve_ready',
      'release_control_id', v_rel.id,
      'expected_updated_at', v_rel.updated_at,
      'expected_fingerprint', public.omni_comms_priv_channel_release_fingerprint(v_rel),
      'blockers','[]'::jsonb);
  END IF;

  v_from := v_rel.release_state;
  UPDATE public.omni_comms_channel_release_control SET
    proposed_state = 'live',
    proposal_reason = public.omni_comms_priv_normalize_reason(
      'Operator requested automatic production Email delivery.', true),
    proposed_by = p_actor,
    proposed_at = now(),
    proposal_expires_at = now() + interval '24 hours',
    approved_by = NULL, approved_at = NULL, approval_note = NULL,
    updated_by = p_actor
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_proposed', v_from, 'live', v_rel.proposal_reason,
    p_actor, p_correlation_id, NULL, '{}'::jsonb);

  RETURN jsonb_build_object('state','awaiting_approval','self_proposed', true,
    'blockers','[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_live_delivery_request(uuid, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;