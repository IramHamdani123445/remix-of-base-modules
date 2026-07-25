
CREATE OR REPLACE FUNCTION public.get_comm_hub_one_real_email_context(
  p_module_code text,
  p_event_code  text,
  p_channel     text,
  p_controlled_stub_certification_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_ch  text := coalesce(p_channel,'email');
  v_cert record;
  v_exec record;
  v_snap record;
  v_sender record;
  v_provider record;
  v_gate  record;
  v_settings record;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF p_module_code IS NULL OR p_event_code IS NULL OR p_controlled_stub_certification_id IS NULL THEN
    RAISE EXCEPTION 'module_event_and_certification_required';
  END IF;

  SELECT * INTO v_cert
    FROM public.communication_controlled_live_certification
   WHERE id = p_controlled_stub_certification_id;

  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','certification_missing','message','Controlled Stub certification not found'));
  ELSE
    IF v_cert.certification_kind <> 'CONTROLLED_STUB' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','wrong_certification_kind','message','Certification is not CONTROLLED_STUB'));
    END IF;
    IF v_cert.invalidated_at IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','certification_invalidated','message','Controlled Stub certification has been invalidated'));
    END IF;
    IF v_cert.module_code <> p_module_code OR v_cert.event_code <> p_event_code OR v_cert.channel <> v_ch THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','certification_lineage_mismatch','message','Certification does not match module/event/channel'));
    END IF;
  END IF;

  IF v_cert.execution_id IS NOT NULL THEN
    SELECT * INTO v_exec
      FROM public.communication_controlled_live_execution
     WHERE id = v_cert.execution_id;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','execution_missing','message','Certification execution row missing'));
    END IF;
  END IF;

  IF v_cert.preview_snapshot_id IS NOT NULL THEN
    SELECT * INTO v_snap
      FROM public.communication_preview_snapshot
     WHERE id = v_cert.preview_snapshot_id;
    IF FOUND AND v_snap.sender_profile_id IS NOT NULL THEN
      SELECT * INTO v_sender
        FROM public.communication_hub_sender_profile
       WHERE id = v_snap.sender_profile_id;
      IF NOT FOUND THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_profile_missing','message','Sender profile not found'));
      ELSIF coalesce(v_sender.is_enabled, false) = false THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_profile_disabled','message','Sender profile is not enabled'));
      ELSIF btrim(coalesce(v_sender.from_email,'')) = '' OR btrim(coalesce(v_sender.display_name,'')) = '' THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_profile_incomplete','message','Sender profile missing display_name or from_email'));
      END IF;
    ELSE
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','sender_lineage_missing','message','Snapshot did not resolve a sender profile'));
    END IF;
  ELSE
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','preview_snapshot_missing','message','Certification has no preview snapshot'));
  END IF;

  SELECT * INTO v_provider
    FROM public.notification_providers
   WHERE channel = 'email'::notification_channel
     AND is_active = true
     AND is_default = true
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','no_active_real_provider','message','No active default email provider is configured'));
  ELSIF lower(coalesce(v_provider.provider_name,'')) = 'provider_stub' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code','provider_is_stub','message','Configured provider is provider_stub and cannot be used for Stage 6'));
  END IF;

  SELECT * INTO v_gate
    FROM public.communication_hub_real_email_gate
   WHERE module_code = p_module_code AND event_code = p_event_code AND channel = v_ch;

  SELECT * INTO v_settings FROM public.communication_hub_control_settings LIMIT 1;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'module_code', p_module_code,
    'event_code', p_event_code,
    'channel', v_ch,
    'recipient', v_exec.recipient,
    'recipient_set_hash', v_cert.recipient_set_hash,
    'configuration_version', v_cert.configuration_version,
    'recipient_policy_version', v_cert.recipient_policy_version,
    'preview_snapshot_id', v_cert.preview_snapshot_id,
    'preview_approval_id', v_cert.preview_approval_id,
    'dry_run_certification_id', v_cert.dry_run_certification_id,
    'controlled_stub_certification_id', p_controlled_stub_certification_id,
    'sender_profile_id', v_snap.sender_profile_id,
    'sender_name', v_sender.display_name,
    'sender_address', v_sender.from_email,
    'provider_id', v_provider.id,
    'provider_name', v_provider.provider_name,
    'provider_health', CASE WHEN v_provider.id IS NULL THEN 'MISSING'
                            WHEN lower(coalesce(v_provider.provider_name,'')) = 'provider_stub' THEN 'STUB'
                            ELSE 'READY' END,
    'operating_mode', v_settings.operating_mode,
    'real_email_gate_enabled', coalesce(v_gate.enabled, false),
    'real_email_gate_opened_by', v_gate.opened_by,
    'real_email_gate_opened_at', v_gate.opened_at,
    'evaluated_at', now()
  );
END $fn$;

REVOKE ALL ON FUNCTION public.get_comm_hub_one_real_email_context(text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_comm_hub_one_real_email_context(text,text,text,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_one_real_email_context(text,text,text,uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.probe_comm_hub_one_real_email_contracts()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_checks jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','begin_comm_hub_one_real_email',
    'signature','public.begin_comm_hub_one_real_email(jsonb)',
    'present', to_regprocedure('public.begin_comm_hub_one_real_email(jsonb)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','create_comm_hub_one_real_email_message',
    'signature','public.create_comm_hub_one_real_email_message(uuid,uuid)',
    'present', to_regprocedure('public.create_comm_hub_one_real_email_message(uuid,uuid)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','reserve_comm_hub_one_real_email_grant',
    'signature','public.reserve_comm_hub_one_real_email_grant(uuid,uuid)',
    'present', to_regprocedure('public.reserve_comm_hub_one_real_email_grant(uuid,uuid)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','consume_comm_hub_one_real_email_grant',
    'signature','public.consume_comm_hub_one_real_email_grant(uuid,uuid,uuid)',
    'present', to_regprocedure('public.consume_comm_hub_one_real_email_grant(uuid,uuid,uuid)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','revoke_comm_hub_one_real_email_grant',
    'signature','public.revoke_comm_hub_one_real_email_grant(uuid,uuid,text)',
    'present', to_regprocedure('public.revoke_comm_hub_one_real_email_grant(uuid,uuid,text)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','reconcile_comm_hub_one_real_email_pre_provider',
    'signature','public.reconcile_comm_hub_one_real_email_pre_provider(uuid,uuid,text)',
    'present', to_regprocedure('public.reconcile_comm_hub_one_real_email_pre_provider(uuid,uuid,text)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','finalize_comm_hub_one_real_email',
    'signature','public.finalize_comm_hub_one_real_email(jsonb)',
    'present', to_regprocedure('public.finalize_comm_hub_one_real_email(jsonb)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','set_comm_hub_real_email_gate',
    'signature','public.set_comm_hub_real_email_gate(text,text,text,boolean,text)',
    'present', to_regprocedure('public.set_comm_hub_real_email_gate(text,text,text,boolean,text)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','record_controlled_live_manual_verification',
    'signature','public.record_controlled_live_manual_verification(jsonb)',
    'present', to_regprocedure('public.record_controlled_live_manual_verification(jsonb)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','check_comm_hub_readiness',
    'signature','public.check_comm_hub_readiness(jsonb)',
    'present', to_regprocedure('public.check_comm_hub_readiness(jsonb)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','get_controlled_live_certification',
    'signature','public.get_controlled_live_certification(uuid)',
    'present', to_regprocedure('public.get_controlled_live_certification(uuid)') IS NOT NULL));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','get_comm_hub_one_real_email_context',
    'signature','public.get_comm_hub_one_real_email_context(text,text,text,uuid)',
    'present', to_regprocedure('public.get_comm_hub_one_real_email_context(text,text,text,uuid)') IS NOT NULL));

  RETURN jsonb_build_object(
    'ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) c WHERE (c->>'present')::boolean = false),
    'checks', v_checks,
    'evaluated_at', now(),
    'note','Signature-only probe. Uses to_regprocedure; creates no execution/grant/request/message/attempt and invokes no provider.'
  );
END $fn$;

REVOKE ALL ON FUNCTION public.probe_comm_hub_one_real_email_contracts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.probe_comm_hub_one_real_email_contracts() FROM anon;
GRANT EXECUTE ON FUNCTION public.probe_comm_hub_one_real_email_contracts() TO authenticated, service_role;
