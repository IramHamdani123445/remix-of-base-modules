CREATE OR REPLACE FUNCTION public.validate_comm_hub_dry_run_certification(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cert_id uuid := nullif(p_payload->>'certification_id','')::uuid;
  v_module text := p_payload->>'module_code';
  v_event  text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_to jsonb := coalesce(p_payload->'to_recipients','[]'::jsonb);
  v_cc jsonb := coalesce(p_payload->'cc_recipients','[]'::jsonb);
  v_bcc jsonb := coalesce(p_payload->'bcc_recipients','[]'::jsonb);
  v_exp_tpl_ver uuid := nullif(p_payload->>'expected_template_version_id','')::uuid;
  v_exp_sender  uuid := nullif(p_payload->>'expected_sender_profile_id','')::uuid;
  v_exp_content text := nullif(p_payload->>'expected_content_hash','');
  v_current_recip_hash text := nullif(p_payload->>'current_recipient_set_hash','');
  v_current_cfg_ver bigint := nullif(p_payload->>'current_configuration_version','')::bigint;
  v_current_recip_ver bigint := nullif(p_payload->>'current_recipient_policy_version','')::bigint;
  v_current_send_ver bigint := nullif(p_payload->>'current_send_policy_version','')::bigint;
  v_current_review_ver bigint := nullif(p_payload->>'current_review_policy_version','')::bigint;
  v_cert public.communication_dry_run_certification%ROWTYPE;
  v_msg public.communication_message%ROWTYPE;
  v_attempt_count int := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_valid boolean := true;
  v_now timestamptz := now();
  v_approval_check jsonb;
  v_decision jsonb;
  v_decision_status text;
BEGIN
  IF v_cert_id IS NULL THEN
    RETURN jsonb_build_object('valid',false,'certification_id',NULL,'status','MISSING',
      'blockers', jsonb_build_array(jsonb_build_object('code','dry_run_certification_missing','stage','dry_run','severity','critical','message','No dry_run_certification_id was supplied.')),
      'warnings','[]'::jsonb,'validated_at',v_now);
  END IF;

  SELECT * INTO v_cert FROM public.communication_dry_run_certification WHERE id = v_cert_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid',false,'certification_id',v_cert_id,'status','MISSING',
      'blockers', jsonb_build_array(jsonb_build_object('code','dry_run_certification_missing','stage','dry_run','severity','critical','message','Dry-run certification not found.')),
      'warnings','[]'::jsonb,'validated_at',v_now);
  END IF;

  IF v_cert.status = 'REVOKED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_certification_revoked','stage','dry_run','severity','critical','message',coalesce(v_cert.revocation_reason,'revoked')); v_valid := false;
  ELSIF v_cert.status = 'EXPIRED' OR v_cert.expires_at < v_now THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_certification_expired','stage','dry_run','severity','high'); v_valid := false;
  ELSIF v_cert.status = 'INVALIDATED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_certification_invalidated','stage','dry_run','severity','high','message',coalesce(v_cert.invalidation_reason,'invalidated')); v_valid := false;
  ELSIF v_cert.status = 'SUPERSEDED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_certification_superseded','stage','dry_run','severity','high'); v_valid := false;
  ELSIF v_cert.status = 'FAILED' OR v_cert.result <> 'DRY_RUN_PASSED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_certification_failed','stage','dry_run','severity','high'); v_valid := false;
  ELSIF v_cert.status <> 'ACTIVE' THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_certification_failed','stage','dry_run','severity','high'); v_valid := false;
  END IF;

  IF v_module IS NOT NULL AND v_cert.module_code <> v_module THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_scope_mismatch','stage','dry_run','severity','high','message','module mismatch'); v_valid := false;
  END IF;
  IF v_event IS NOT NULL AND v_cert.event_code <> v_event THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_scope_mismatch','stage','dry_run','severity','high','message','event mismatch'); v_valid := false;
  END IF;
  IF v_channel IS NOT NULL AND v_cert.channel <> v_channel THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_scope_mismatch','stage','dry_run','severity','high','message','channel mismatch'); v_valid := false;
  END IF;

  IF v_current_recip_hash IS NOT NULL AND v_current_recip_hash <> v_cert.recipient_set_hash THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_recipient_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;

  IF v_exp_tpl_ver IS NOT NULL AND v_exp_tpl_ver <> v_cert.template_version_id THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_template_version_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;
  IF v_exp_sender IS NOT NULL AND v_exp_sender <> v_cert.sender_profile_id THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_sender_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;
  IF v_exp_content IS NOT NULL AND v_exp_content <> v_cert.content_hash THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_content_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;

  IF v_current_cfg_ver IS NOT NULL AND v_current_cfg_ver <> v_cert.configuration_version THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_configuration_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;
  IF v_current_recip_ver IS NOT NULL AND v_current_recip_ver <> v_cert.recipient_policy_version THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_recipient_policy_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;
  IF v_current_send_ver IS NOT NULL AND v_current_send_ver <> v_cert.send_policy_version THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_send_policy_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;
  IF v_current_review_ver IS NOT NULL AND v_current_review_ver <> v_cert.review_policy_version THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_review_policy_drift','stage','dry_run','severity','high'); v_valid := false;
  END IF;

  BEGIN
    v_decision := public.evaluate_comm_hub_send_decision(jsonb_build_object(
      'module_code', v_cert.module_code,
      'event_code',  v_cert.event_code,
      'channel',     v_cert.channel,
      'send_context','controlled_live',
      'to_recipients', v_to,
      'cc_recipients', v_cc,
      'bcc_recipients', v_bcc
    ));
    v_decision_status := coalesce(v_decision->>'decision', v_decision->>'status', '');
    IF v_decision_status IN ('EVENT_UNKNOWN','EVENT_NOT_REGISTERED','EVENT_DISABLED','event_unknown','event_not_registered','event_disabled') THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code','dry_run_event_no_longer_eligible','stage','dry_run','severity','high',
        'detail', v_decision);
      v_valid := false;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_warnings := v_warnings || jsonb_build_object('code','event_probe_unavailable','message',SQLERRM);
  END;

  IF v_cert.preview_approval_id IS NOT NULL THEN
    BEGIN
      v_approval_check := public.validate_comm_hub_preview_approval(jsonb_build_object(
        'approval_id', v_cert.preview_approval_id,
        'module_code', v_cert.module_code, 'event_code', v_cert.event_code, 'channel', v_cert.channel,
        'send_context','controlled_live',
        'to_recipients', v_to, 'cc_recipients', v_cc, 'bcc_recipients', v_bcc,
        'expected_template_version_id', v_cert.template_version_id,
        'expected_sender_profile_id',   v_cert.sender_profile_id,
        'expected_content_hash',        v_cert.content_hash));
      IF NOT coalesce((v_approval_check->>'valid')::boolean,false) THEN
        v_blockers := v_blockers || jsonb_build_object('code','dry_run_preview_approval_invalid','stage','dry_run','severity','high','detail',v_approval_check);
        v_valid := false;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_warnings := v_warnings || jsonb_build_object('code','preview_validator_unavailable','message',SQLERRM);
    END;
  END IF;

  -- Evidence completeness (Dry Run architecture: request + message + trace,
  -- NO delivery attempt, provider not attempted).
  IF v_cert.communication_request_id IS NULL
     OR v_cert.communication_message_id IS NULL
     OR v_cert.trace_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','dry_run_evidence_incomplete','stage','dry_run','severity','high',
      'message','request_id, message_id and trace_id are required.');
    v_valid := false;
  ELSE
    SELECT * INTO v_msg FROM public.communication_message WHERE id = v_cert.communication_message_id;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_object('code','dry_run_evidence_incomplete','stage','dry_run','severity','high','message','certified message not found');
      v_valid := false;
    ELSE
      IF v_msg.request_id IS DISTINCT FROM v_cert.communication_request_id THEN
        v_blockers := v_blockers || jsonb_build_object('code','dry_run_message_linkage_invalid','stage','dry_run','severity','high',
          'message','message.request_id does not match certification.communication_request_id');
        v_valid := false;
      END IF;
      IF coalesce(v_msg.send_context,'') <> 'dry_run' THEN
        v_blockers := v_blockers || jsonb_build_object('code','dry_run_message_linkage_invalid','stage','dry_run','severity','high',
          'message','certified message send_context is not dry_run');
        v_valid := false;
      END IF;
    END IF;

    IF coalesce(v_cert.provider_call_attempted, false) THEN
      v_blockers := v_blockers || jsonb_build_object('code','dry_run_provider_attempt_detected','stage','dry_run','severity','critical',
        'message','provider_call_attempted must be false for a Dry Run certification');
      v_valid := false;
    END IF;

    SELECT count(*) INTO v_attempt_count
      FROM public.communication_delivery_attempt
     WHERE message_id = v_cert.communication_message_id;
    IF v_attempt_count > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','dry_run_provider_attempt_detected','stage','dry_run','severity','critical',
        'message', format('%s delivery attempt(s) exist for the certified message', v_attempt_count));
      v_valid := false;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', v_valid, 'certification_id', v_cert.id, 'certification_no', v_cert.certification_no,
    'status', v_cert.status, 'result', v_cert.result,
    'blockers', v_blockers, 'warnings', v_warnings,
    'module_code', v_cert.module_code, 'event_code', v_cert.event_code, 'channel', v_cert.channel,
    'recipient_set_hash', v_cert.recipient_set_hash,
    'template_version_id', v_cert.template_version_id, 'sender_profile_id', v_cert.sender_profile_id,
    'content_hash', v_cert.content_hash,
    'rendered_subject_hash', v_cert.rendered_subject_hash, 'rendered_body_hash', v_cert.rendered_body_hash,
    'configuration_version', v_cert.configuration_version,
    'recipient_policy_version', v_cert.recipient_policy_version,
    'send_policy_version', v_cert.send_policy_version, 'review_policy_version', v_cert.review_policy_version,
    'original_decision_id', v_cert.original_decision_id,
    'dispatcher_revalidation_decision_id', v_cert.dispatcher_revalidation_decision_id,
    'preview_snapshot_id', v_cert.preview_snapshot_id, 'preview_approval_id', v_cert.preview_approval_id,
    'communication_request_id', v_cert.communication_request_id,
    'communication_message_id', v_cert.communication_message_id,
    'communication_delivery_attempt_id', v_cert.communication_delivery_attempt_id,
    'trace_id', v_cert.trace_id,
    'provider_call_attempted', coalesce(v_cert.provider_call_attempted,false),
    'delivery_attempt_count', v_attempt_count,
    'certified_at', v_cert.certified_at, 'expires_at', v_cert.expires_at,
    'validated_at', v_now);
END; $function$;