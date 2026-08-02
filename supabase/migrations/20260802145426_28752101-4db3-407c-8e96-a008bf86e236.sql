CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_decision(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_event_code text,
  p_caller_module_code text,
  p_mode text,
  p_recipient_hashes text[],
  p_requested_message_count integer,
  p_deployed_revision text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_allowed boolean := false;
  v_code text := 'release_control_missing';
  v_hour integer := 0; v_day integer := 0; v_total integer := 0;
  v_perm_event boolean := false; v_perm_caller boolean := false;
  v_mode_ok boolean := false; v_rules_ok boolean := false;
  v_match_count integer := 0;
  v_revision_match boolean := false;
  v_prereq jsonb := '[]'::jsonb;
  v_prereq_codes jsonb := '[]'::jsonb;
BEGIN
  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, p_channel);

  IF v_rel.id IS NOT NULL THEN
    v_perm_event := p_event_code = ANY (coalesce(v_rel.permitted_event_codes,'{}'));
    v_perm_caller := p_caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules,'{}'))
                     AND p_caller_module_code <> 'OMNI_COMMS_ADMIN_DRY_RUN';
    v_mode_ok := p_mode = ANY (coalesce(v_rel.permitted_modes,'{}')) AND p_mode = 'queued';

    SELECT count(*) INTO v_match_count
    FROM unnest(coalesce(p_recipient_hashes,'{}')) h
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rel.pilot_recipient_rules) r
      WHERE r->>'target_hash' = lower(h));

    v_rules_ok := coalesce(array_length(p_recipient_hashes,1),0) > 0
      AND coalesce(array_length(p_recipient_hashes,1),0) <= v_rel.max_recipients_per_request
      AND v_match_count = coalesce(array_length(p_recipient_hashes,1),0);

    SELECT count(*) INTO v_hour FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id AND j.created_at > now() - interval '1 hour';
    SELECT count(*) INTO v_day FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id AND j.created_at > now() - interval '1 day';
    SELECT count(*) INTO v_total FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id;

    v_revision_match := lower(coalesce(p_deployed_revision,'')) = lower(coalesce(v_rel.approved_commit,'x'));

    v_prereq := public.omni_comms_priv_channel_release_prerequisites(
      p_organization_id, p_department_id, p_channel, v_rel.id, p_deployed_revision);
    SELECT coalesce(jsonb_agg(jsonb_build_object('code', e->>'code', 'state', e->>'state')
                              ORDER BY (e->>'sequence')::int), '[]'::jsonb)
      INTO v_prereq_codes
    FROM jsonb_array_elements(v_prereq) e;

    IF v_rel.release_state = 'suspended' THEN v_code := 'release_not_active';
    ELSIF v_rel.release_state <> 'controlled_pilot' THEN v_code := 'release_not_active';
    ELSIF v_rel.release_expires_at IS NULL OR v_rel.release_expires_at <= now() THEN v_code := 'release_expired';
    ELSIF v_rel.release_starts_at IS NOT NULL AND v_rel.release_starts_at > now() THEN v_code := 'release_not_active';
    ELSIF NOT v_perm_event OR NOT v_perm_caller OR NOT v_mode_ok OR NOT v_rules_ok THEN v_code := 'release_scope_denied';
    ELSIF v_hour + coalesce(p_requested_message_count,1) > v_rel.max_messages_per_hour
       OR v_day + coalesce(p_requested_message_count,1) > v_rel.max_messages_per_day
       OR v_total + coalesce(p_requested_message_count,1) > v_rel.max_messages_total THEN v_code := 'release_limit_exceeded';
    ELSIF NOT v_revision_match THEN v_code := 'release_scope_denied';
    ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(v_prereq) e WHERE e->>'state' = 'failed')
      THEN v_code := 'release_prerequisites_failed';
    ELSE v_allowed := true; v_code := 'release_allowed';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'code', v_code,
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', p_channel,
    'release_control_id', v_rel.id,
    'release_version', v_rel.release_version,
    'release_state', v_rel.release_state,
    'release_fingerprint', v_rel.release_fingerprint,
    'release_expires_at', v_rel.release_expires_at,
    'permitted_event', v_perm_event,
    'permitted_caller', v_perm_caller,
    'mode_allowed', v_mode_ok,
    'recipient_rules_satisfied', v_rules_ok,
    'recipient_rule_match_count', v_match_count,
    'requested_message_count', coalesce(p_requested_message_count, 1),
    'current_hourly_count', v_hour,
    'current_daily_count', v_day,
    'current_total_count', v_total,
    'max_messages_per_hour', v_rel.max_messages_per_hour,
    'max_messages_per_day', v_rel.max_messages_per_day,
    'max_messages_total', v_rel.max_messages_total,
    'certified_commit', v_rel.approved_commit,
    'deployed_revision_match', v_revision_match,
    'prerequisite_codes', v_prereq_codes,
    'business_dispatch_enabled', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_decision(uuid, uuid, text, text, text, text, text[], integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_release_decision(uuid, uuid, text, text, text, text, text[], integer, text) TO service_role;