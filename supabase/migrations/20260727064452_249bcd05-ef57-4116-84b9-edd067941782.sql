-- =========================================================================
-- Slice 2B: canonical fingerprint convergence + attestation correction
-- =========================================================================

-- 1. Canonical core fingerprint helper -------------------------------------
CREATE OR REPLACE FUNCTION public._comm_hub_fingerprint_evidence_core_v2(p_core jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_pgcrypto boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') INTO v_pgcrypto;
  IF NOT v_pgcrypto THEN
    RAISE EXCEPTION 'FINGERPRINT_ALGO_UNAVAILABLE: pgcrypto required for sha256-v2';
  END IF;
  IF p_core IS NULL THEN
    RAISE EXCEPTION 'FINGERPRINT_CORE_NULL';
  END IF;
  RETURN 'sha256-v2:' || encode(extensions.digest(p_core::text,'sha256'),'hex');
END;
$$;

GRANT EXECUTE ON FUNCTION public._comm_hub_fingerprint_evidence_core_v2(jsonb)
  TO authenticated, service_role;

-- 2. Rewrite get_comm_hub_current_evidence_snapshot to emit evidence_core_v2
--    and compute fingerprint from that core only.
CREATE OR REPLACE FUNCTION public.get_comm_hub_current_evidence_snapshot(
  p_module_code text, p_event_code text, p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_module text := _comm_hub_norm_code(p_module_code);
  v_event  text := _comm_hub_norm_code(p_event_code);
  v_channel text := _comm_hub_norm_channel(p_channel);
  v_blockers jsonb := '[]'::jsonb;
  v_map RECORD; v_ctv RECORD; v_rp RECORD; v_sp RECORD; v_rev RECORD;
  v_ps RECORD; v_provider RECORD; v_evt_cert RECORD; v_ore_cert RECORD;
  v_production_lineage_id uuid;
  v_template_manifest_hash text;
  v_recip_set_hash text;
  v_payload_hash text; v_review_hash text; v_send_hash text;
  v_snapshot jsonb; v_core jsonb; v_fingerprint text;
  v_ctrl RECORD;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','UNAUTHENTICATED','component','actor')));
  END IF;
  SELECT public.is_comm_hub_admin(v_actor) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin,false) THEN
    RETURN jsonb_build_object('ok',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','NOT_ADMIN','component','actor')));
  END IF;
  IF v_module IS NULL OR v_event IS NULL OR v_channel IS NULL THEN
    RETURN jsonb_build_object('ok',false,'blockers',
      jsonb_build_array(jsonb_build_object('code','INPUT_INVALID','component','module_event_channel')));
  END IF;

  SELECT operating_mode, runtime_mode_version, configuration_version, automation_generation
    INTO v_ctrl FROM communication_hub_control_settings LIMIT 1;

  SELECT * INTO v_map FROM communication_hub_event_template_map
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event
     AND lower(channel)=v_channel AND active=true LIMIT 1;
  IF v_map.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','TEMPLATE_MAP_UNRESOLVED','component','template_map');
  END IF;

  IF v_map.template_id IS NOT NULL THEN
    SELECT * INTO v_ctv FROM core_template_version
     WHERE template_id=v_map.template_id AND status='PUBLISHED'
     ORDER BY version_no DESC NULLS LAST LIMIT 1;
    IF v_ctv.id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code','TEMPLATE_VERSION_UNRESOLVED','component','template_version');
    ELSE
      v_template_manifest_hash := _comm_hub_sha256_jsonb(jsonb_build_object(
        'template_id', v_ctv.template_id, 'version_no', v_ctv.version_no,
        'subject_hash', _comm_hub_sha256_hex(coalesce(v_ctv.subject,'')),
        'body_html_hash', _comm_hub_sha256_hex(coalesce(v_ctv.body_html,'')),
        'body_text_hash', _comm_hub_sha256_hex(coalesce(v_ctv.body_text,''))
      ));
    END IF;
  END IF;

  SELECT * INTO v_rp FROM communication_hub_event_recipient_policy
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel LIMIT 1;
  IF v_rp.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','RECIPIENT_POLICY_UNRESOLVED','component','recipient_policy');
  ELSE
    v_recip_set_hash := _comm_hub_sha256_jsonb(jsonb_build_object(
      'policy_version', v_rp.policy_version,
      'policy_mode', v_rp.policy_mode,
      'destination_scope', v_rp.destination_scope,
      'approved_recipients', v_rp.approved_recipients,
      'approved_domains', v_rp.approved_domains
    ));
  END IF;

  SELECT * INTO v_sp FROM communication_hub_event_send_policy
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel LIMIT 1;
  IF v_sp.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','SEND_POLICY_UNRESOLVED','component','send_policy');
  ELSE
    v_send_hash := coalesce(v_sp.policy_content_hash, _comm_hub_sha256_jsonb(to_jsonb(v_sp)));
  END IF;

  SELECT * INTO v_rev FROM communication_hub_event_review_policy
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel LIMIT 1;
  IF v_rev.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','REVIEW_POLICY_UNRESOLVED','component','review_policy');
  ELSE
    v_review_hash := coalesce(v_rev.policy_content_hash, _comm_hub_sha256_jsonb(jsonb_build_object(
      'review_mode', v_rev.review_mode,
      'preview_required', v_rev.preview_required,
      'allow_operator_edit_tokens', v_rev.allow_operator_edit_tokens,
      'allow_operator_edit_body', v_rev.allow_operator_edit_body,
      'allow_operator_change_recipient', v_rev.allow_operator_change_recipient,
      'require_template_approval', v_rev.require_template_approval,
      'require_legal_approval', v_rev.require_legal_approval,
      'require_business_approval', v_rev.require_business_approval,
      'approval_status', v_rev.approval_status,
      'approved_template_version_id', v_rev.approved_template_version_id
    )));
  END IF;

  SELECT * INTO v_ps FROM communication_hub_event_payload_schema
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event
   ORDER BY schema_version DESC LIMIT 1;
  IF v_ps.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','PAYLOAD_SCHEMA_UNRESOLVED','component','payload_schema');
  ELSE
    v_payload_hash := _comm_hub_sha256_jsonb(jsonb_build_object(
      'schema_version', v_ps.schema_version, 'status', v_ps.status,
      'json_schema_hash', _comm_hub_sha256_jsonb(COALESCE(v_ps.json_schema,'{}'::jsonb))
    ));
  END IF;

  SELECT * INTO v_provider FROM notification_providers
   WHERE lower(channel::text)=v_channel AND is_active=true AND is_default=true
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_provider.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','PROVIDER_UNRESOLVED','component','provider');
  END IF;

  SELECT * INTO v_evt_cert FROM communication_hub_event_certification
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel LIMIT 1;
  IF v_evt_cert.one_real_email_certification_id IS NOT NULL THEN
    SELECT * INTO v_ore_cert FROM communication_controlled_live_certification
     WHERE id=v_evt_cert.one_real_email_certification_id;
    v_production_lineage_id := v_ore_cert.production_lineage_id;
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'ok',false,'snapshot_version',2,
      'production_lineage_id',v_production_lineage_id,
      'event_certification_id',v_evt_cert.id,
      'operating_mode',v_ctrl.operating_mode,
      'runtime_mode_version',v_ctrl.runtime_mode_version,
      'configuration_version',v_ctrl.configuration_version,
      'automation_generation',v_ctrl.automation_generation,
      'blockers',v_blockers
    );
  END IF;

  v_snapshot := jsonb_build_object(
    'module_code',v_module,'event_code',v_event,'channel',v_channel,
    'template_map_id',v_map.id,'template_id',v_map.template_id,'template_code',v_map.template_code,
    'template_version_id',v_ctv.id,'template_version_no',v_ctv.version_no,
    'template_manifest_hash',v_template_manifest_hash,
    'sender_profile_id',v_map.sender_profile_id,
    'recipient_policy_version',v_rp.policy_version,
    'recipient_set_hash',v_recip_set_hash,
    'provider_id',v_provider.id,'provider_key',v_provider.email_provider_type,
    'payload_schema_version',v_ps.schema_version,'payload_schema_hash',v_payload_hash,
    'review_policy_version',v_rev.policy_version,'review_policy_hash',v_review_hash,
    'send_policy_version',v_sp.policy_version,'send_policy_hash',v_send_hash
  );

  v_core := public._comm_hub_evidence_core_v2(v_snapshot);
  v_fingerprint := public._comm_hub_fingerprint_evidence_core_v2(v_core);

  RETURN jsonb_build_object(
    'ok',true,'snapshot_version',2,
    'production_lineage_id',v_production_lineage_id,
    'event_certification_id',v_evt_cert.id,
    'operating_mode',v_ctrl.operating_mode,
    'runtime_mode_version',v_ctrl.runtime_mode_version,
    'configuration_version',v_ctrl.configuration_version,
    'automation_generation',v_ctrl.automation_generation,
    'resolved_at',now(),
    'snapshot',v_snapshot,
    'evidence_core_v2',v_core,
    'evidence_fingerprint_v2',v_fingerprint,
    'evidence_fingerprint_algorithm','sha256-v2',
    'blockers','[]'::jsonb
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_comm_hub_current_evidence_snapshot(text,text,text)
  TO authenticated, service_role;

-- 3. Fix attest_comm_hub_legacy_production_baseline to use canonical hash ---
CREATE OR REPLACE FUNCTION public.attest_comm_hub_legacy_production_baseline(
  p_module_code text, p_event_code text, p_channel text,
  p_attestation_reason text, p_typed_confirmation text,
  p_historically_proven_components jsonb DEFAULT '[]'::jsonb,
  p_historically_unavailable_components jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_ore public.communication_controlled_live_certification%ROWTYPE;
  v_obs public.communication_manual_production_observation%ROWTYPE;
  v_snap jsonb; v_core jsonb; v_fp text; v_wrapper_fp text;
  v_attest_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF coalesce(p_typed_confirmation,'') <> 'ATTEST LEGACY PRODUCTION BASELINE' THEN
    RETURN jsonb_build_object('ok',false,'phase','TYPED_CONFIRMATION_MISMATCH');
  END IF;
  IF coalesce(trim(p_attestation_reason),'')='' THEN
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
  IF NOT FOUND OR v_ore.manual_verification_status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('ok',false,'phase','ORE_NOT_CONFIRMED');
  END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
   WHERE event_certification_id=v_ec.id AND status='CONFIRMED'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'phase','NO_CONFIRMED_OBSERVATION');
  END IF;

  IF EXISTS (SELECT 1 FROM public.communication_manual_production_observation
              WHERE event_certification_id=v_ec.id
                AND status NOT IN ('CONFIRMED','VOIDED','FAILED')) THEN
    RETURN jsonb_build_object('ok',false,'phase','UNRESOLVED_OBSERVATION');
  END IF;

  IF v_ec.drift_detected_at IS NOT NULL OR v_ec.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'phase','CURRENT_DRIFT_OR_SUSPENSION');
  END IF;

  v_snap := public.get_comm_hub_current_evidence_snapshot(p_module_code, p_event_code, coalesce(p_channel,'email'));
  IF v_snap IS NULL OR coalesce((v_snap->>'ok')::boolean,false)=false THEN
    RETURN jsonb_build_object('ok',false,'phase','CURRENT_SNAPSHOT_INCOMPLETE','snapshot',v_snap);
  END IF;

  -- Canonical path: use the core the snapshot RPC returned, verify determinism.
  v_core := v_snap->'evidence_core_v2';
  IF v_core IS NULL THEN
    v_core := public._comm_hub_evidence_core_v2(v_snap->'snapshot');
  END IF;
  v_fp := public._comm_hub_fingerprint_evidence_core_v2(v_core);
  v_wrapper_fp := v_snap->>'evidence_fingerprint_v2';
  IF v_wrapper_fp IS NOT NULL AND v_wrapper_fp <> v_fp THEN
    RETURN jsonb_build_object('ok',false,'phase','FINGERPRINT_DETERMINISM_MISMATCH',
      'wrapper_fp',v_wrapper_fp,'core_fp',v_fp);
  END IF;

  UPDATE public.communication_hub_legacy_evidence_attestation
     SET status='SUPERSEDED', superseded_at=now()
   WHERE production_lineage_id=v_ec.production_lineage_id AND status='ACTIVE';

  INSERT INTO public.communication_hub_legacy_evidence_attestation(
    production_lineage_id, event_certification_id, one_real_email_certification_id,
    current_evidence_snapshot_v2, current_evidence_fingerprint_v2,
    historically_proven_components, historically_unavailable_components,
    attestation_reason, typed_confirmation, attested_by, status
  ) VALUES (
    v_ec.production_lineage_id, v_ec.id, v_ore.id,
    v_core, v_fp,
    coalesce(p_historically_proven_components,'[]'::jsonb),
    coalesce(p_historically_unavailable_components,'[]'::jsonb),
    p_attestation_reason, p_typed_confirmation, v_uid, 'ACTIVE'
  ) RETURNING id INTO v_attest_id;

  UPDATE public.communication_hub_event_certification
     SET evidence_authority='LEGACY_ATTESTED_BASELINE', updated_at=now()
   WHERE id=v_ec.id;

  RETURN jsonb_build_object(
    'ok',true,'phase','ATTESTED','attestation_id',v_attest_id,
    'production_lineage_id',v_ec.production_lineage_id,
    'event_certification_id',v_ec.id,
    'one_real_email_certification_id',v_ore.id,
    'current_evidence_fingerprint_v2',v_fp
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.attest_comm_hub_legacy_production_baseline(text,text,text,text,text,jsonb,jsonb)
  TO authenticated, service_role;

-- 4. One-ACTIVE constraint --------------------------------------------------
DROP INDEX IF EXISTS public.uq_clea_active_per_lineage_cert;
CREATE UNIQUE INDEX uq_clea_active_per_lineage_cert
  ON public.communication_hub_legacy_evidence_attestation (production_lineage_id, event_certification_id)
  WHERE status='ACTIVE';

-- 5. Diagnostic RPC ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.diagnose_comm_hub_legacy_attestation_fingerprint(
  p_module_code text, p_event_code text, p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
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
   ORDER BY created_at DESC LIMIT 1;

  v_snap := public.get_comm_hub_current_evidence_snapshot(p_module_code,p_event_code,coalesce(p_channel,'email'));
  IF coalesce((v_snap->>'ok')::boolean,false)=false THEN
    RETURN jsonb_build_object('ok',false,'phase','CURRENT_SNAPSHOT_INCOMPLETE','snapshot',v_snap);
  END IF;

  v_current_core := v_snap->'evidence_core_v2';
  v_current_fp_recompute := public._comm_hub_fingerprint_evidence_core_v2(v_current_core);

  IF v_att.id IS NOT NULL THEN
    -- Historical attestations may have stored either the wrapper or the core.
    -- Interpret whichever is present so the diagnostic is honest.
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
$$;

GRANT EXECUTE ON FUNCTION public.diagnose_comm_hub_legacy_attestation_fingerprint(text,text,text)
  TO authenticated, service_role;

-- 6. Correction workflow ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_comm_hub_legacy_baseline_attestation(
  p_module_code text, p_event_code text, p_channel text,
  p_reason text, p_typed_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
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
   ORDER BY created_at DESC LIMIT 1
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
$$;

-- add tracking column if missing
ALTER TABLE public.communication_hub_legacy_evidence_attestation
  ADD COLUMN IF NOT EXISTS supersedes_attestation_id uuid
  REFERENCES public.communication_hub_legacy_evidence_attestation(id);

GRANT EXECUTE ON FUNCTION public.correct_comm_hub_legacy_baseline_attestation(text,text,text,text,text)
  TO authenticated, service_role;

-- 7. Forward-baseline idempotency: skip audit insert when nothing changed ---
CREATE OR REPLACE FUNCTION public.establish_comm_hub_forward_baseline_policies(
  p_module_code text, p_event_code text, p_channel text,
  p_expected_event_certification_id uuid, p_expected_template_version_id uuid,
  p_reason text, p_typed_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := upper(p_module_code);
  v_event  text := upper(p_event_code);
  v_channel text := lower(coalesce(p_channel,'email'));
  v_evt_cert record; v_ctrl record; v_map record;
  v_sp_id uuid; v_rev_id uuid; v_sp record; v_rev record;
  v_send_hash text; v_review_hash text;
  v_send_version bigint; v_review_version bigint;
  v_send_created boolean := false; v_review_created boolean := false;
  v_audit_id uuid; v_production_lineage_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;
  IF coalesce(p_typed_confirmation,'') <> 'ESTABLISH FORWARD BASELINE' THEN
    RETURN jsonb_build_object('ok',false,'phase','TYPED_CONFIRMATION_MISMATCH');
  END IF;

  SELECT * INTO v_evt_cert FROM public.communication_hub_event_certification
   WHERE module_code=v_module AND event_code=v_event AND channel=v_channel FOR UPDATE;
  IF NOT FOUND OR v_evt_cert.id <> p_expected_event_certification_id THEN
    RETURN jsonb_build_object('ok',false,'phase','EVENT_CERT_MISMATCH');
  END IF;
  IF v_evt_cert.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    RETURN jsonb_build_object('ok',false,'phase','EVENT_NOT_LIVE');
  END IF;
  v_production_lineage_id := v_evt_cert.production_lineage_id;

  SELECT * INTO v_map FROM public.communication_hub_event_template_map
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel AND active=true LIMIT 1;

  SELECT * INTO v_sp FROM public.communication_hub_event_send_policy
   WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel LIMIT 1;

  IF v_sp.id IS NULL THEN
    v_send_version := 1;
    v_send_hash := encode(extensions.digest(jsonb_build_object(
      'send_mode','manual_live','environment','production','destination_scope','internal_only',
      'require_operator_reason', true,'require_typed_confirmation', true,
      'require_operator_role', true,'operator_role_required', true,'allow_operator_override', false,
      'approved_domains', ARRAY['mishainfotech.com']::text[], 'approved_recipients', ARRAY[]::text[],
      'max_recipients_per_send',1,'max_sends_per_day_per_recipient',1,'idle_seconds_between_sends',1440,
      'log_operator_reason', true,'auto_live_internal', false,'auto_live_recipient_portal', true,'auto_live_external', true,
      'policy_version',1
    )::text::bytea, 'sha256'::text),'hex');
    INSERT INTO public.communication_hub_event_send_policy(
      module_code,event_code,channel,send_mode,environment,destination_scope,
      require_operator_reason,require_typed_confirmation,require_operator_role,operator_role_required,allow_operator_override,
      approved_domains,approved_recipients,max_recipients_per_send,max_sends_per_day_per_recipient,idle_seconds_between_sends,
      log_operator_reason,auto_live_internal,auto_live_recipient_portal,auto_live_external,
      created_by,updated_at,notes,policy_version,policy_content_hash
    ) VALUES (
      v_module,v_event,v_channel,'manual_live','production','internal_only',
      true,true,true,true,false,
      ARRAY['mishainfotech.com']::text[], ARRAY[]::text[],
      1,1,1440,true,false,true,true,
      v_uid, now(),
      'Forward baseline established after LIVE_MANUAL confirmation.',
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
    v_review_hash := encode(extensions.digest(jsonb_build_object(
      'review_mode','preview_required','preview_required', true,
      'allow_operator_edit_tokens', false,'allow_operator_edit_body', false,'allow_operator_change_recipient', false,
      'show_template_to_operator', true,'show_template_to_recipient_portal', false,
      'require_template_approval', true,'require_legal_approval', false,'require_business_approval', false,
      'approval_status','approved_internal','approved_template_version_id', p_expected_template_version_id
    )::text::bytea,'sha256'::text),'hex');
    INSERT INTO public.communication_hub_event_review_policy(
      module_code,event_code,channel,review_mode,preview_required,
      allow_operator_edit_tokens,allow_operator_edit_body,allow_operator_change_recipient,
      show_template_to_operator,show_template_to_recipient_portal,
      require_template_approval,require_legal_approval,require_business_approval,
      approval_status,approved_template_version_id,approved_by,approved_at,notes,
      policy_version,policy_content_hash
    ) VALUES (
      v_module,v_event,v_channel,'preview_required',true,
      false,false,false,true,false,true,false,false,
      'approved_internal', p_expected_template_version_id, v_uid, now(),
      'Forward review baseline established after LIVE_MANUAL confirmation.',
      v_review_version, v_review_hash
    ) RETURNING id INTO v_rev_id;
    v_review_created := true;
  ELSE
    v_rev_id := v_rev.id; v_review_version := v_rev.policy_version; v_review_hash := v_rev.policy_content_hash;
  END IF;

  IF v_send_created OR v_review_created THEN
    INSERT INTO public.communication_hub_forward_baseline_audit(
      module_code,event_code,channel,production_lineage_id,event_certification_id,
      send_policy_id,send_policy_version,send_policy_hash,
      review_policy_id,review_policy_version,review_policy_hash,
      actor,reason,effective_from,established_at,forward_baseline_only,typed_confirmation
    ) VALUES (
      v_module,v_event,v_channel,v_production_lineage_id,v_evt_cert.id,
      v_sp_id,v_send_version,v_send_hash,v_rev_id,v_review_version,v_review_hash,
      v_uid,p_reason,now(),now(),true,p_typed_confirmation
    ) RETURNING id INTO v_audit_id;
  ELSE
    SELECT id INTO v_audit_id FROM public.communication_hub_forward_baseline_audit
     WHERE event_certification_id=v_evt_cert.id
     ORDER BY established_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,
    'idempotent', NOT (v_send_created OR v_review_created),
    'send_policy_created', v_send_created,'review_policy_created', v_review_created,
    'send_policy_id', v_sp_id,'send_policy_version', v_send_version,'send_policy_hash', v_send_hash,
    'review_policy_id', v_rev_id,'review_policy_version', v_review_version,'review_policy_hash', v_review_hash,
    'event_certification_id', v_evt_cert.id,'production_lineage_id', v_production_lineage_id,
    'audit_id', v_audit_id,'effective_from', now()
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.establish_comm_hub_forward_baseline_policies(text,text,text,uuid,uuid,text,text)
  TO authenticated, service_role;
