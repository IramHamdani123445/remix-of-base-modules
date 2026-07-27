-- Gate 2A: repair schema-reference defect in baseline convergence RPCs.
-- Table communication_hub_legacy_evidence_attestation has attested_at, not created_at.

CREATE OR REPLACE FUNCTION public.diagnose_comm_hub_legacy_attestation_fingerprint(p_module_code text, p_event_code text, p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_att public.communication_hub_legacy_evidence_attestation%ROWTYPE;
  v_snap jsonb; v_current_core jsonb; v_current_fp_recompute text;
  v_att_core jsonb; v_att_fp_recompute text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=coalesce(p_channel,'email');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'phase','EVENT_NOT_FOUND'); END IF;

  SELECT * INTO v_att FROM public.communication_hub_legacy_evidence_attestation
   WHERE event_certification_id=v_ec.id AND status='ACTIVE'
   ORDER BY attested_at DESC, id DESC LIMIT 1;

  v_snap := public.get_comm_hub_current_evidence_snapshot(p_module_code,p_event_code,coalesce(p_channel,'email'));
  IF coalesce((v_snap->>'ok')::boolean,false)=false THEN
    RETURN jsonb_build_object('ok',false,'phase','CURRENT_SNAPSHOT_INCOMPLETE','snapshot',v_snap);
  END IF;

  v_current_core := v_snap->'evidence_core_v2';
  v_current_fp_recompute := public._comm_hub_fingerprint_evidence_core_v2(v_current_core);

  IF v_att.id IS NOT NULL THEN
    IF v_att.current_evidence_snapshot_v2 ? 'template_version_id' THEN
      v_att_core := public._comm_hub_evidence_core_v2(v_att.current_evidence_snapshot_v2);
    ELSIF v_att.current_evidence_snapshot_v2 ? 'snapshot' THEN
      v_att_core := public._comm_hub_evidence_core_v2(v_att.current_evidence_snapshot_v2->'snapshot');
    ELSE
      v_att_core := v_att.current_evidence_snapshot_v2;
    END IF;
    v_att_fp_recompute := public._comm_hub_fingerprint_evidence_core_v2(v_att_core);
  END IF;

  RETURN jsonb_build_object(
    'ok',true,
    'event_certification_id',v_ec.id,
    'production_lineage_id',v_ec.production_lineage_id,
    'current_fingerprint_stored',v_snap->>'evidence_fingerprint_v2',
    'current_fingerprint_recomputed',v_current_fp_recompute,
    'attestation_id',v_att.id,
    'attestation_fingerprint_stored',v_att.current_evidence_fingerprint_v2,
    'attestation_fingerprint_recomputed',v_att_fp_recompute,
    'current_core',v_current_core,
    'attestation_core',v_att_core,
    'current_rpc_matches_current_core_rehash',
      (v_snap->>'evidence_fingerprint_v2') = v_current_fp_recompute,
    'attestation_stored_matches_attestation_core_rehash',
      v_att.current_evidence_fingerprint_v2 = v_att_fp_recompute,
    'current_core_matches_attestation_core',
      v_current_core = v_att_core,
    'current_fingerprint_matches_attestation_fingerprint',
      (v_snap->>'evidence_fingerprint_v2') = v_att.current_evidence_fingerprint_v2
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.correct_comm_hub_legacy_baseline_attestation(p_module_code text, p_event_code text, p_channel text, p_reason text, p_typed_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_ore public.communication_controlled_live_certification%ROWTYPE;
  v_prev public.communication_hub_legacy_evidence_attestation%ROWTYPE;
  v_snap jsonb; v_core jsonb; v_fp text; v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF coalesce(p_typed_confirmation,'') <> 'CORRECT LEGACY BASELINE ATTESTATION' THEN
    RETURN jsonb_build_object('ok',false,'phase','TYPED_CONFIRMATION_MISMATCH');
  END IF;
  IF coalesce(trim(p_reason),'')='' THEN
    RETURN jsonb_build_object('ok',false,'phase','REASON_REQUIRED');
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=coalesce(p_channel,'email')
   FOR UPDATE;
  IF NOT FOUND OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    RETURN jsonb_build_object('ok',false,'phase','EVENT_NOT_LIVE');
  END IF;

  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE id=v_ec.one_real_email_certification_id;

  SELECT * INTO v_prev FROM public.communication_hub_legacy_evidence_attestation
   WHERE production_lineage_id=v_ec.production_lineage_id AND status='ACTIVE'
   ORDER BY attested_at DESC, id DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'phase','NO_ACTIVE_ATTESTATION');
  END IF;

  v_snap := public.get_comm_hub_current_evidence_snapshot(p_module_code,p_event_code,coalesce(p_channel,'email'));
  IF coalesce((v_snap->>'ok')::boolean,false)=false THEN
    RETURN jsonb_build_object('ok',false,'phase','CURRENT_SNAPSHOT_INCOMPLETE','snapshot',v_snap);
  END IF;
  v_core := v_snap->'evidence_core_v2';
  v_fp := public._comm_hub_fingerprint_evidence_core_v2(v_core);

  UPDATE public.communication_hub_legacy_evidence_attestation
     SET status='SUPERSEDED', superseded_at=now()
   WHERE id=v_prev.id;

  INSERT INTO public.communication_hub_legacy_evidence_attestation(
    production_lineage_id, event_certification_id, one_real_email_certification_id,
    current_evidence_snapshot_v2, current_evidence_fingerprint_v2,
    historically_proven_components, historically_unavailable_components,
    attestation_reason, typed_confirmation, attested_by, status,
    supersedes_attestation_id
  ) VALUES (
    v_ec.production_lineage_id, v_ec.id, v_ore.id,
    v_core, v_fp,
    coalesce(v_prev.historically_proven_components,'[]'::jsonb),
    coalesce(v_prev.historically_unavailable_components,'[]'::jsonb),
    p_reason, p_typed_confirmation, v_uid, 'ACTIVE',
    v_prev.id
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok',true,'phase','CORRECTED',
    'previous_attestation_id',v_prev.id,
    'new_attestation_id',v_new_id,
    'current_evidence_fingerprint_v2',v_fp
  );
END;
$function$;