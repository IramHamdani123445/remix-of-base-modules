CREATE OR REPLACE FUNCTION public.establish_comm_hub_forward_baseline_policies(
  p_module_code text,
  p_event_code text,
  p_channel text,
  p_expected_event_certification_id uuid,
  p_expected_template_version_id uuid,
  p_reason text,
  p_typed_confirmation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := upper(p_module_code);
  v_event  text := upper(p_event_code);
  v_channel text := lower(coalesce(p_channel,'email'));
  v_evt_cert record;
  v_ctrl record;
  v_map record;
  v_sp_id uuid;
  v_rev_id uuid;
  v_sp record;
  v_rev record;
  v_send_hash text;
  v_review_hash text;
  v_send_version bigint;
  v_review_version bigint;
  v_send_created boolean := false;
  v_review_created boolean := false;
  v_audit_id uuid;
  v_production_lineage_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF coalesce(p_typed_confirmation,'') <> 'ESTABLISH FORWARD BASELINE' THEN
    RAISE EXCEPTION 'typed_confirmation_required' USING ERRCODE='22023';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_evt_cert
  FROM public.communication_hub_event_certification
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel
  ORDER BY created_at DESC LIMIT 1;

  IF v_evt_cert.id IS NULL THEN RAISE EXCEPTION 'event_certification_missing' USING ERRCODE='P0002'; END IF;
  IF v_evt_cert.id <> p_expected_event_certification_id THEN
    RAISE EXCEPTION 'event_certification_mismatch: expected=%, actual=%',
      p_expected_event_certification_id, v_evt_cert.id USING ERRCODE='P0001';
  END IF;
  IF v_evt_cert.status <> 'live_manual_only' THEN
    RAISE EXCEPTION 'event_not_live_manual: status=%', v_evt_cert.status USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_ctrl FROM public.communication_hub_control_settings LIMIT 1;
  IF v_ctrl.operating_mode <> 'MANUAL_PRODUCTION' THEN
    RAISE EXCEPTION 'operating_mode_not_manual_production: mode=%', v_ctrl.operating_mode USING ERRCODE='P0001';
  END IF;
  IF v_ctrl.automation_state <> 'STANDBY' THEN
    RAISE EXCEPTION 'automation_not_standby: state=%', v_ctrl.automation_state USING ERRCODE='P0001';
  END IF;
  IF coalesce(v_ctrl.scheduler_enabled,false) OR coalesce(v_ctrl.automatic_triggers_enabled,false)
     OR coalesce(v_ctrl.retry_worker_enabled,false) OR coalesce(v_ctrl.batch_enabled,false)
     OR coalesce(v_ctrl.bulk_enabled,false) THEN
    RAISE EXCEPTION 'automation_controls_not_disabled' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_map
  FROM public.communication_hub_event_template_map
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel
    AND is_active = true
  ORDER BY updated_at DESC LIMIT 1;
  IF v_map.id IS NULL THEN RAISE EXCEPTION 'template_map_missing' USING ERRCODE='P0002'; END IF;
  IF v_map.template_version_id IS DISTINCT FROM p_expected_template_version_id THEN
    RAISE EXCEPTION 'template_version_mismatch: expected=%, actual=%',
      p_expected_template_version_id, v_map.template_version_id USING ERRCODE='P0001';
  END IF;

  v_production_lineage_id := v_evt_cert.production_lineage_id;

  SELECT * INTO v_sp FROM public.communication_hub_event_send_policy
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel LIMIT 1;

  IF v_sp.id IS NULL THEN
    v_send_version := 1;
    v_send_hash := encode(digest(jsonb_build_object(
      'send_policy','manual_live','recipient_policy','internal_only',
      'requires_template_approval', true,'requires_sender_verified', true,'requires_recipient_validation', true,
      'allow_internal_recipients', true,'allow_external_recipients', false,
      'allowed_internal_domains', to_jsonb(ARRAY['mishainfotech.com']::text[]),
      'allowed_external_domains', to_jsonb(ARRAY[]::text[]),
      'max_recipients_per_send', 1,'max_sends_per_entity_per_event', 1,'duplicate_window_minutes', 1440,
      'require_preview_before_manual_send', true,'require_typed_confirmation_for_send', false,'is_enabled', true
    )::text, 'sha256'),'hex');

    INSERT INTO public.communication_hub_event_send_policy (
      module_code, event_code, channel, send_policy, environment_scope, recipient_policy,
      requires_template_approval, requires_sender_verified, requires_recipient_validation,
      allow_internal_recipients, allow_external_recipients,
      allowed_internal_domains, allowed_external_domains,
      max_recipients_per_send, max_sends_per_entity_per_event, duplicate_window_minutes,
      require_preview_before_manual_send, require_typed_confirmation_for_send,
      require_typed_confirmation_for_policy_change, is_enabled,
      approved_by, approved_at, approval_notes, policy_version, policy_content_hash
    ) VALUES (
      v_module, v_event, v_channel, 'manual_live', 'production', 'internal_only',
      true, true, true, true, false,
      ARRAY['mishainfotech.com']::text[], ARRAY[]::text[],
      1, 1, 1440, true, false, true, true,
      v_uid, now(),
      'Forward baseline established after LIVE_MANUAL confirmation. Effective from this approval time only. This policy is not asserted to have governed the historical One Real Email.',
      v_send_version, v_send_hash
    ) RETURNING id INTO v_sp_id;
    v_send_created := true;
  ELSE
    v_sp_id := v_sp.id; v_send_version := v_sp.policy_version; v_send_hash := v_sp.policy_content_hash;
  END IF;

  SELECT * INTO v_rev FROM public.communication_hub_event_review_policy
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel LIMIT 1;

  IF v_rev.id IS NULL THEN
    v_review_version := 1;
    v_review_hash := encode(digest(jsonb_build_object(
      'review_mode','preview_required','preview_required', true,
      'allow_operator_edit_tokens', false,'allow_operator_edit_body', false,'allow_operator_change_recipient', false,
      'show_template_to_operator', true,'show_template_to_recipient_portal', false,
      'require_template_approval', true,'require_legal_approval', false,'require_business_approval', false,
      'approval_status','approved_internal','approved_template_version_id', p_expected_template_version_id
    )::text, 'sha256'),'hex');

    INSERT INTO public.communication_hub_event_review_policy (
      module_code, event_code, channel, review_mode, preview_required,
      allow_operator_edit_tokens, allow_operator_edit_body, allow_operator_change_recipient,
      show_template_to_operator, show_template_to_recipient_portal,
      require_template_approval, require_legal_approval, require_business_approval,
      approval_status, approved_template_version_id, approved_by, approved_at, notes,
      policy_version, policy_content_hash
    ) VALUES (
      v_module, v_event, v_channel, 'preview_required', true,
      false, false, false, true, false, true, false, false,
      'approved_internal', p_expected_template_version_id, v_uid, now(),
      'Forward review baseline established after LIVE_MANUAL confirmation. Effective from this approval time only. It does not back-date review-policy evidence onto the historical One Real Email.',
      v_review_version, v_review_hash
    ) RETURNING id INTO v_rev_id;
    v_review_created := true;
  ELSE
    v_rev_id := v_rev.id; v_review_version := v_rev.policy_version; v_review_hash := v_rev.policy_content_hash;
  END IF;

  INSERT INTO public.communication_hub_forward_baseline_audit (
    module_code, event_code, channel, production_lineage_id, event_certification_id,
    send_policy_id, send_policy_version, send_policy_hash,
    review_policy_id, review_policy_version, review_policy_hash,
    actor, reason, effective_from, established_at, forward_baseline_only, typed_confirmation
  ) VALUES (
    v_module, v_event, v_channel, v_production_lineage_id, v_evt_cert.id,
    v_sp_id, v_send_version, v_send_hash, v_rev_id, v_review_version, v_review_hash,
    v_uid, p_reason, now(), now(), true, p_typed_confirmation
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', NOT (v_send_created OR v_review_created),
    'send_policy_created', v_send_created,
    'review_policy_created', v_review_created,
    'send_policy_id', v_sp_id, 'send_policy_version', v_send_version, 'send_policy_hash', v_send_hash,
    'review_policy_id', v_rev_id, 'review_policy_version', v_review_version, 'review_policy_hash', v_review_hash,
    'event_certification_id', v_evt_cert.id, 'production_lineage_id', v_production_lineage_id,
    'audit_id', v_audit_id, 'effective_from', now()
  );
END;
$$;