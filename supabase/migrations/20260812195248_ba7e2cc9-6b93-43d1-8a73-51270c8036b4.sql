-- Simple operator delivery state + trusted go-live orchestration.
-- No provider is contacted, no message is created or dispatched here.

CREATE OR REPLACE FUNCTION public.omni_comms_priv_live_delivery_indicators(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_release_control_id uuid,
  p_deployed_revision text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pre jsonb;
  v_health jsonb;
  v_failed text[] := '{}';
  v_groups jsonb := jsonb_build_object(
    'provider', jsonb_build_array('provider_present','provider_account_active',
      'provider_credentials_complete','provider_credentials_verified'),
    'sender_domain', jsonb_build_array('sender_identity_active','sending_domain_active',
      'sending_domain_verified','binding_active','binding_provider_verified'),
    'events_templates', jsonb_build_array('producer_binding_active','event_route_active',
      'template_family_active','published_template_version_present'),
    'dispatcher', jsonb_build_array('business_dispatch_dispatcher_installed'),
    'callbacks', jsonb_build_array('callback_endpoint_active','signed_delivery_callback_received',
      'no_bounce_or_complaint_evidence'),
    'safety', jsonb_build_array('runtime_environment_known','runtime_certification_effective',
      'deployed_revision_matches_certification','release_volume_limits_valid',
      'effective_policy_present','policy_test_or_pilot_state')
  );
  v_indicators jsonb := '[]'::jsonb;
  v_key text;
  v_group_failed text[];
  v_scheduler_ready boolean;
BEGIN
  v_pre := public.omni_comms_priv_channel_release_prerequisites(
    p_organization_id, p_department_id, p_channel, p_release_control_id, p_deployed_revision);
  v_health := public.omni_comms_priv_scheduler_health();
  v_scheduler_ready := coalesce((v_health->>'ready')::boolean, false);

  SELECT coalesce(array_agg(e->>'code'), '{}')
    INTO v_failed
  FROM jsonb_array_elements(coalesce(v_pre, '[]'::jsonb)) e
  WHERE e->>'state' <> 'passed';

  FOR v_key IN SELECT jsonb_object_keys(v_groups) LOOP
    SELECT coalesce(array_agg(c), '{}') INTO v_group_failed
    FROM jsonb_array_elements_text(v_groups->v_key) c
    WHERE c = ANY(v_failed);

    v_indicators := v_indicators || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'ready', CASE
        WHEN v_key = 'dispatcher' THEN array_length(v_group_failed,1) IS NULL AND v_scheduler_ready
        ELSE array_length(v_group_failed,1) IS NULL END,
      'codes', to_jsonb(v_group_failed)));
  END LOOP;

  RETURN jsonb_build_object(
    'indicators', v_indicators,
    'failed_codes', to_jsonb(v_failed),
    'scheduler', v_health,
    'prerequisites', coalesce(v_pre, '[]'::jsonb));
END;
$function$;

-- Codes the orchestrator may safely repair itself (deterministic administrative
-- preparation only — never provider secrets, DNS, templates or recipients).
CREATE OR REPLACE FUNCTION public.omni_comms_priv_live_delivery_auto_remediable()
RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['release_time_window_valid','pilot_recipient_rules_present']::text[] $$;

CREATE OR REPLACE FUNCTION public.omni_comms_live_delivery_state(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_ind jsonb;
  v_blockers text[];
  v_state text;
  v_queue int; v_last_accepted timestamptz; v_last_delivered timestamptz; v_last_attempt timestamptz;
  v_can_configure boolean; v_can_operate boolean;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);

  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, p_channel);
  v_ind := public.omni_comms_priv_live_delivery_indicators(
    p_organization_id, p_department_id, p_channel, v_rel.id,
    (public.omni_comms_priv_runtime_certification()->>'deployed_revision'));

  SELECT coalesce(array_agg(c), '{}') INTO v_blockers
  FROM jsonb_array_elements_text(v_ind->'failed_codes') c
  WHERE c <> ALL (public.omni_comms_priv_live_delivery_auto_remediable());

  v_can_configure := public.has_permission(v_actor, 'omni_comms', 'configure');
  v_can_operate := public.has_permission(v_actor, 'omni_comms', 'operate');

  SELECT count(*) INTO v_queue FROM public.omni_comms_dispatch_job j
  WHERE j.organization_id = p_organization_id AND j.channel = p_channel
    AND j.status IN ('held','ready','retry_wait');

  SELECT max(a.created_at), max(a.created_at) FILTER (WHERE a.status='accepted')
    INTO v_last_attempt, v_last_accepted
  FROM public.omni_comms_delivery_attempt a WHERE a.organization_id = p_organization_id;

  SELECT max(e.created_at) INTO v_last_delivered
  FROM public.omni_comms_message_event e
  WHERE e.organization_id = p_organization_id AND e.event_type = 'delivered';

  v_state := CASE
    WHEN v_rel.id IS NULL THEN 'action_required'
    WHEN v_rel.release_state = 'live' THEN 'on'
    WHEN v_rel.release_state = 'suspended' THEN 'suspended'
    WHEN v_rel.proposed_state = 'live'
      AND (v_rel.proposal_expires_at IS NULL OR v_rel.proposal_expires_at > now())
      THEN 'awaiting_approval'
    WHEN array_length(v_blockers,1) IS NOT NULL THEN 'action_required'
    ELSE 'off' END;

  RETURN jsonb_build_object(
    'channel', p_channel,
    'state', v_state,
    'indicators', v_ind->'indicators',
    'blockers', to_jsonb(v_blockers),
    'can_enable', v_can_configure OR v_can_operate,
    'can_disable', v_can_operate AND v_rel.release_state = 'live',
    'awaiting_self_approval',
      v_rel.proposed_state = 'live' AND v_rel.proposed_by = v_actor,
    'release', jsonb_build_object(
      'id', v_rel.id,
      'release_state', v_rel.release_state,
      'proposed_state', v_rel.proposed_state,
      'updated_at', v_rel.updated_at,
      'permitted_event_codes', to_jsonb(coalesce(v_rel.permitted_event_codes,'{}')),
      'permitted_caller_modules', to_jsonb(coalesce(v_rel.permitted_caller_modules,'{}'))),
    'evidence', jsonb_build_object(
      'queue_depth', coalesce(v_queue,0),
      'last_attempt_at', v_last_attempt,
      'last_accepted_at', v_last_accepted,
      'last_delivered_at', v_last_delivered,
      'scheduler_last_run_at', v_ind->'scheduler'->>'last_run_at',
      'scheduler_healthy', coalesce((v_ind->'scheduler'->>'ready')::boolean, false)),
    'generated_at', now());
END;
$function$;

-- Trusted orchestration. The browser supplies only organisation, department and
-- channel; every technical fact is derived here. Two-person approval is
-- preserved: the proposer can never approve their own live proposal.
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

  -- ENABLE
  IF NOT (public.has_permission(p_actor, 'omni_comms', 'configure')
          OR public.has_permission(p_actor, 'omni_comms', 'operate')) THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING DETAIL='configure';
  END IF;

  IF v_rel.release_state = 'live' THEN
    RETURN jsonb_build_object('state','on','blockers','[]'::jsonb);
  END IF;

  -- Safe deterministic administrative preparation: an operational live release
  -- has no pilot window and carries the configured production quotas.
  IF v_rel.release_state IN ('test_only','controlled_pilot','suspended')
     AND v_rel.proposed_state IS DISTINCT FROM 'live' THEN
    UPDATE public.omni_comms_channel_release_control SET
      release_starts_at = now(),
      release_expires_at = NULL,
      max_recipients_per_request = 1,
      max_messages_per_hour = coalesce(nullif(max_messages_per_hour,1), 20),
      max_messages_per_day = coalesce(nullif(max_messages_per_day,1), 100),
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

GRANT EXECUTE ON FUNCTION public.omni_comms_live_delivery_state(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_live_delivery_request(uuid, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_live_delivery_indicators(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;