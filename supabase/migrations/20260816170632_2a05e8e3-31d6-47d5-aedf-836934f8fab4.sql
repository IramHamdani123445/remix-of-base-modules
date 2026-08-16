-- ── 1. Release Control must be able to represent the internal Print channel ──
ALTER TABLE public.omni_comms_channel_release_control
  DROP CONSTRAINT IF EXISTS omni_comms_release_control_channel_chk;
ALTER TABLE public.omni_comms_channel_release_control
  ADD CONSTRAINT omni_comms_release_control_channel_chk
  CHECK (channel = ANY (ARRAY['email'::text,'sms'::text,'print'::text]));

-- ── 2. Provision the internal Print configuration (idempotent) ───────────────
CREATE OR REPLACE FUNCTION public.omni_comms_print_provision_defaults(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('configure');
  v_provider uuid;
  v_account uuid;
  v_identity uuid;
  v_endpoint uuid;
  v_binding uuid;
  v_release uuid;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT id INTO v_provider FROM public.omni_comms_provider
   WHERE channel='print' AND code='print_spool' AND status='active';
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'OC412 print_provider_missing'
      USING ERRCODE='P0001', DETAIL='print_provider_missing';
  END IF;

  SELECT id INTO v_account FROM public.omni_comms_provider_account
   WHERE organization_id=p_organization_id AND provider_id=v_provider AND code='print_spool_internal';
  IF v_account IS NULL THEN
    INSERT INTO public.omni_comms_provider_account (
      organization_id, provider_id, code, display_name, status, environment,
      sandbox_mode, data_origin, verification_status, created_by, updated_by,
      activated_at, activated_by)
    VALUES (p_organization_id, v_provider, 'print_spool_internal',
      'Internal print spool', 'active', 'production', false, 'system_seed',
      'verified', v_uid, v_uid, now(), v_uid)
    RETURNING id INTO v_account;
  ELSIF (SELECT status FROM public.omni_comms_provider_account WHERE id=v_account) <> 'active' THEN
    UPDATE public.omni_comms_provider_account
       SET status='active', activated_at=coalesce(activated_at, now()),
           activated_by=coalesce(activated_by, v_uid), updated_at=now(), updated_by=v_uid
     WHERE id=v_account;
  END IF;

  SELECT id INTO v_identity FROM public.omni_comms_sender_identity
   WHERE organization_id=p_organization_id AND channel='print' AND code='print_issuing_authority';
  IF v_identity IS NULL THEN
    INSERT INTO public.omni_comms_sender_identity (
      organization_id, department_id, code, display_name, channel, identity_type,
      audience, status, data_origin, print_config, identity_config,
      created_by, updated_by, activated_at, activated_by)
    VALUES (p_organization_id, p_department_id, 'print_issuing_authority',
      'Social Security Board — Correspondence', 'print', 'issuing_authority',
      'external', 'active', 'system_seed',
      jsonb_build_object(
        'return_reference','Social Security Board, Bay Road, Basseterre, St. Kitts',
        'paper_size','A4','sides','simplex','colour_mode','black_white'),
      '{}'::jsonb, v_uid, v_uid, now(), v_uid)
    RETURNING id INTO v_identity;
  ELSIF (SELECT status FROM public.omni_comms_sender_identity WHERE id=v_identity) <> 'active' THEN
    UPDATE public.omni_comms_sender_identity
       SET status='active', activated_at=coalesce(activated_at, now()),
           activated_by=coalesce(activated_by, v_uid), updated_at=now(), updated_by=v_uid
     WHERE id=v_identity;
  END IF;

  SELECT id INTO v_endpoint FROM public.omni_comms_channel_endpoint
   WHERE organization_id=p_organization_id AND channel='print' AND code='print_render_service';
  IF v_endpoint IS NULL THEN
    INSERT INTO public.omni_comms_channel_endpoint (
      organization_id, department_id, channel, provider_account_id, code, display_name,
      endpoint_type, endpoint_config, data_origin, status, verification_status,
      verification_result_code, verification_checked_at, created_by, updated_by,
      activated_at, activated_by)
    VALUES (p_organization_id, p_department_id, 'print', v_account, 'print_render_service',
      'Internal correspondence render service', 'render_service',
      jsonb_build_object('renderer','omni_comms_print_spool','format','pdf',
                         'bucket','core-documents','external_callback', false),
      'system_seed', 'active', 'verified', 'internal_renderer', now(),
      v_uid, v_uid, now(), v_uid)
    RETURNING id INTO v_endpoint;
  ELSIF (SELECT status FROM public.omni_comms_channel_endpoint WHERE id=v_endpoint) <> 'active' THEN
    UPDATE public.omni_comms_channel_endpoint
       SET status='active', verification_status='verified', updated_at=now(), updated_by=v_uid
     WHERE id=v_endpoint;
  END IF;

  SELECT id INTO v_binding FROM public.omni_comms_sender_provider_binding
   WHERE sender_identity_id=v_identity AND provider_account_id=v_account;
  IF v_binding IS NULL THEN
    INSERT INTO public.omni_comms_sender_provider_binding (
      organization_id, department_id, channel, sender_identity_id, provider_account_id,
      channel_endpoint_id, priority, status, verification_status, verification_source,
      verification_result_code, verification_checked_at, verified_at, data_origin,
      created_by, updated_by, activated_at, activated_by)
    VALUES (p_organization_id, p_department_id, 'print', v_identity, v_account,
      v_endpoint, 1, 'active', 'verified', 'internal',
      'internal_no_credential', now(), now(), 'system_seed',
      v_uid, v_uid, now(), v_uid)
    RETURNING id INTO v_binding;
  ELSE
    UPDATE public.omni_comms_sender_provider_binding
       SET status='active', channel_endpoint_id=coalesce(channel_endpoint_id, v_endpoint),
           verification_status='verified', updated_at=now(), updated_by=v_uid
     WHERE id=v_binding;
  END IF;

  SELECT id INTO v_release FROM public.omni_comms_channel_release_control
   WHERE organization_id=p_organization_id AND channel='print';
  IF v_release IS NULL THEN
    INSERT INTO public.omni_comms_channel_release_control (
      organization_id, department_id, channel, data_origin, release_state,
      max_recipients_per_request, max_messages_per_hour, max_messages_per_day,
      created_by, updated_by)
    VALUES (p_organization_id, p_department_id, 'print', 'system_seed', 'configuration',
      10, 20, 100, v_uid, v_uid)
    RETURNING id INTO v_release;
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, metadata)
  VALUES (v_uid, 'omni_comms.print.provisioned', 'omni_comms', 'omni_comms_provider_account',
          v_account::text, jsonb_build_object('organization_id', p_organization_id));

  RETURN jsonb_build_object(
    'provider_id', v_provider, 'provider_account_id', v_account,
    'sender_identity_id', v_identity, 'endpoint_id', v_endpoint,
    'binding_id', v_binding, 'release_control_id', v_release);
END;
$fn$;

-- ── 3. Print production enable / disable (real operator gate) ────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_print_release_set(
  p_organization_id uuid,
  p_enabled boolean,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('configure');
  v_row public.omni_comms_channel_release_control%ROWTYPE;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);
  SELECT * INTO v_row FROM public.omni_comms_channel_release_control
   WHERE organization_id=p_organization_id AND channel='print' FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_release_missing'
      USING ERRCODE='P0001', DETAIL='print_release_missing';
  END IF;
  IF NOT p_enabled AND coalesce(btrim(p_reason),'')='' THEN
    RAISE EXCEPTION 'OC422 reason_required'
      USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;

  UPDATE public.omni_comms_channel_release_control
     SET release_state = CASE WHEN p_enabled THEN 'live' ELSE 'disabled' END,
         release_version = release_version + 1,
         activated_by = CASE WHEN p_enabled THEN v_uid ELSE activated_by END,
         activated_at = CASE WHEN p_enabled THEN now() ELSE activated_at END,
         suspended_by = CASE WHEN p_enabled THEN NULL ELSE v_uid END,
         suspended_at = CASE WHEN p_enabled THEN NULL ELSE now() END,
         suspension_reason = CASE WHEN p_enabled THEN NULL ELSE p_reason END,
         updated_at = now(), updated_by = v_uid
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id,
                                 old_value, new_value, metadata)
  VALUES (v_uid, 'omni_comms.print.release_' || CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,
          'omni_comms', 'omni_comms_channel_release_control', v_row.id::text,
          NULL, v_row.release_state, jsonb_strip_nulls(jsonb_build_object('reason', p_reason)));

  RETURN jsonb_build_object('id', v_row.id, 'release_state', v_row.release_state,
                            'release_version', v_row.release_version);
END;
$fn$;

-- ── 4. Authoritative Print readiness projection ──────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_print_readiness(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_gates jsonb := '[]'::jsonb;
  v_provider uuid;
  v_account public.omni_comms_provider_account%ROWTYPE;
  v_identity public.omni_comms_sender_identity%ROWTYPE;
  v_endpoint public.omni_comms_channel_endpoint%ROWTYPE;
  v_binding public.omni_comms_sender_provider_binding%ROWTYPE;
  v_release public.omni_comms_channel_release_control%ROWTYPE;
  v_templates int;
  v_bucket_private boolean;
  v_queue int;
  v_blocked int := 0;
  v_can_operate boolean := public.has_permission(v_uid, 'omni_comms', 'operate');

  PROCEDURE_PLACEHOLDER text;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT id INTO v_provider FROM public.omni_comms_provider
   WHERE channel='print' AND code='print_spool' AND status='active';
  SELECT * INTO v_account FROM public.omni_comms_provider_account
   WHERE organization_id=p_organization_id AND provider_id=v_provider AND code='print_spool_internal';
  SELECT * INTO v_identity FROM public.omni_comms_sender_identity
   WHERE organization_id=p_organization_id AND channel='print' AND status='active'
   ORDER BY created_at LIMIT 1;
  SELECT * INTO v_endpoint FROM public.omni_comms_channel_endpoint
   WHERE organization_id=p_organization_id AND channel='print' AND endpoint_type='render_service'
     AND status='active' ORDER BY created_at LIMIT 1;
  SELECT * INTO v_binding FROM public.omni_comms_sender_provider_binding
   WHERE organization_id=p_organization_id AND channel='print' AND status='active'
   ORDER BY priority LIMIT 1;
  SELECT * INTO v_release FROM public.omni_comms_channel_release_control
   WHERE organization_id=p_organization_id AND channel='print';
  SELECT count(*) INTO v_templates
    FROM public.omni_comms_template_version tv
    JOIN public.omni_comms_template_family tf ON tf.id = tv.template_family_id
   WHERE tv.channel='print' AND tv.status IN ('published','active','approved')
     AND (tf.organization_id IS NULL OR tf.organization_id = p_organization_id);
  SELECT NOT public FROM storage.buckets WHERE id='core-documents' INTO v_bucket_private;
  SELECT count(*) INTO v_queue FROM public.omni_comms_print_item
   WHERE organization_id=p_organization_id;

  v_gates := v_gates
  || jsonb_build_array(
    jsonb_build_object('key','provider','label','Provider',
      'status', CASE WHEN v_provider IS NOT NULL THEN 'ready' ELSE 'blocked' END,
      'error_code', CASE WHEN v_provider IS NULL THEN 'print_provider_missing' END,
      'reason', CASE WHEN v_provider IS NOT NULL
        THEN 'Internal print spool adapter is registered and active.'
        ELSE 'The internal print spool provider is not registered.' END,
      'resource','omni_comms_provider',
      'fix_action', CASE WHEN v_provider IS NULL THEN 'provision' END),

    jsonb_build_object('key','account','label','Account',
      'status', CASE WHEN v_account.id IS NULL THEN 'blocked'
                     WHEN v_account.status <> 'active' THEN 'blocked' ELSE 'ready' END,
      'error_code', CASE WHEN v_account.id IS NULL THEN 'print_account_missing'
                         WHEN v_account.status <> 'active' THEN 'print_account_inactive' END,
      'reason', CASE WHEN v_account.id IS NULL THEN 'No internal print production account exists for this organisation.'
                     WHEN v_account.status <> 'active' THEN 'The internal print production account is not active.'
                     ELSE 'Internal print production account is active.' END,
      'resource','omni_comms_provider_account',
      'fix_action', CASE WHEN v_account.id IS NULL OR v_account.status <> 'active' THEN 'provision' END),

    jsonb_build_object('key','credentials','label','Credentials',
      'status','not_applicable', 'error_code', NULL,
      'reason','The internal print spool contacts no external service: no API credential, sending domain, DNS record, webhook callback or external authentication applies.',
      'resource','omni_comms_provider_account', 'fix_action', NULL),

    jsonb_build_object('key','issuing_authority','label','Issuing authority',
      'status', CASE WHEN v_identity.id IS NULL THEN 'blocked' ELSE 'ready' END,
      'error_code', CASE WHEN v_identity.id IS NULL THEN 'print_identity_missing' END,
      'reason', CASE WHEN v_identity.id IS NULL
        THEN 'No active issuing authority is configured, so letters have no return reference.'
        ELSE coalesce(v_identity.display_name,'Issuing authority') || ' is active.' END,
      'resource','omni_comms_sender_identity',
      'fix_action', CASE WHEN v_identity.id IS NULL THEN 'provision' END),

    jsonb_build_object('key','render_endpoint','label','Render endpoint',
      'status', CASE WHEN v_endpoint.id IS NULL THEN 'blocked' ELSE 'ready' END,
      'error_code', CASE WHEN v_endpoint.id IS NULL THEN 'print_endpoint_missing' END,
      'reason', CASE WHEN v_endpoint.id IS NULL
        THEN 'No active internal render service endpoint is configured.'
        ELSE 'Internal PDF render service endpoint is active.' END,
      'resource','omni_comms_channel_endpoint',
      'fix_action', CASE WHEN v_endpoint.id IS NULL THEN 'provision' END),

    jsonb_build_object('key','binding','label','Binding',
      'status', CASE WHEN v_binding.id IS NULL THEN 'blocked' ELSE 'ready' END,
      'error_code', CASE WHEN v_binding.id IS NULL THEN 'print_binding_missing' END,
      'reason', CASE WHEN v_binding.id IS NULL
        THEN 'No active Print binding links the issuing authority to the print production account.'
        ELSE 'Issuing authority is bound to the internal print production account.' END,
      'resource','omni_comms_sender_provider_binding',
      'fix_action', CASE WHEN v_binding.id IS NULL THEN 'provision' END),

    jsonb_build_object('key','print_template','label','Print template',
      'status', CASE WHEN v_templates > 0 THEN 'ready' ELSE 'blocked' END,
      'error_code', CASE WHEN v_templates = 0 THEN 'print_variant_required' END,
      'reason', CASE WHEN v_templates > 0
        THEN v_templates || ' published print template variant(s) available.'
        ELSE 'No published print template variant exists. Print content is never derived from an email or SMS variant.' END,
      'resource','omni_comms_template_version',
      'fix_action', CASE WHEN v_templates = 0 THEN 'templates' END),

    jsonb_build_object('key','pdf_storage','label','PDF storage',
      'status', CASE WHEN coalesce(v_bucket_private,false) THEN 'ready' ELSE 'blocked' END,
      'error_code', CASE WHEN NOT coalesce(v_bucket_private,false) THEN 'print_storage_unavailable' END,
      'reason', CASE WHEN coalesce(v_bucket_private,false)
        THEN 'Private document store core-documents is available for archived correspondence.'
        ELSE 'The private document store core-documents is unavailable or is not private.' END,
      'resource','storage.core-documents', 'fix_action', NULL),

    jsonb_build_object('key','runtime','label','Runtime',
      'status', CASE WHEN v_provider IS NOT NULL AND v_account.id IS NOT NULL THEN 'ready' ELSE 'blocked' END,
      'error_code', CASE WHEN v_provider IS NULL OR v_account.id IS NULL THEN 'print_provider_missing' END,
      'reason','Print artefacts are produced by the in-platform print spool adapter; no external runtime dependency applies.',
      'resource','omni-comms-runtime', 'fix_action', NULL),

    jsonb_build_object('key','release_control','label','Release control',
      'status', CASE WHEN v_release.id IS NULL THEN 'blocked'
                     WHEN v_release.release_state IN ('live','controlled_pilot') THEN 'ready'
                     ELSE 'blocked' END,
      'error_code', CASE WHEN v_release.id IS NULL THEN 'print_release_missing'
                         WHEN v_release.release_state NOT IN ('live','controlled_pilot') THEN 'print_release_disabled' END,
      'reason', CASE WHEN v_release.id IS NULL THEN 'Print release control has never been provisioned.'
                     WHEN v_release.release_state IN ('live','controlled_pilot') THEN 'Print production is enabled.'
                     ELSE 'Print production is currently ' || v_release.release_state || '.' END,
      'resource','omni_comms_channel_release_control',
      'fix_action', CASE WHEN v_release.id IS NULL THEN 'provision'
                         WHEN v_release.release_state NOT IN ('live','controlled_pilot') THEN 'enable_release' END),

    jsonb_build_object('key','physical_queue','label','Physical queue',
      'status','ready', 'error_code', NULL,
      'reason', v_queue || ' print item(s) recorded for this organisation.',
      'resource','omni_comms_print_item', 'fix_action', NULL),

    jsonb_build_object('key','secure_pdf_access','label','Secure PDF access',
      'status', CASE WHEN v_can_operate THEN 'ready' ELSE 'blocked' END,
      'error_code', CASE WHEN NOT v_can_operate THEN 'permission_denied' END,
      'reason', CASE WHEN v_can_operate
        THEN 'Short-lived, server-authorised access to archived PDFs is available to this operator.'
        ELSE 'You hold view access only. Opening and printing letters requires the Omni-Comms operate permission.' END,
      'resource','omni-comms-print-document', 'fix_action', NULL)
  );

  SELECT count(*) INTO v_blocked
    FROM jsonb_array_elements(v_gates) g WHERE g->>'status' = 'blocked';

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'generated_at', now(),
    'gates', v_gates,
    'blocked_count', v_blocked,
    'ready_to_print', v_blocked = 0,
    'can_operate', v_can_operate,
    'can_configure', public.has_permission(v_uid, 'omni_comms', 'configure'),
    'queue_count', v_queue);
END;
$fn$;

-- ── 5. Secure Print document access (used by the print document endpoint) ────
CREATE OR REPLACE FUNCTION public.omni_comms_print_document_access(
  p_id uuid,
  p_mode text DEFAULT 'preview',
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.omni_comms_print_item%ROWTYPE;
  v_release public.omni_comms_channel_release_control%ROWTYPE;
  v_attempt uuid;
  v_next text;
BEGIN
  IF p_mode NOT IN ('preview','print') THEN
    RAISE EXCEPTION 'OC422 unknown_print_access_mode'
      USING ERRCODE='P0001', DETAIL='unknown_print_access_mode';
  END IF;

  v_uid := public.omni_comms_priv_require_capability(
             CASE WHEN p_mode='print' THEN 'operate' ELSE 'view' END);

  SELECT * INTO v_item FROM public.omni_comms_print_item WHERE id=p_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_item_missing'
      USING ERRCODE='P0001', DETAIL='print_item_missing';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_item.organization_id, NULL);

  IF coalesce(v_item.artefact_bucket,'')='' OR coalesce(v_item.artefact_path,'')='' THEN
    RAISE EXCEPTION 'OC412 print_artefact_missing'
      USING ERRCODE='P0001', DETAIL='print_artefact_missing';
  END IF;
  IF coalesce(v_item.artefact_checksum_sha256,'')='' THEN
    RAISE EXCEPTION 'OC412 print_artefact_corrupt'
      USING ERRCODE='P0001', DETAIL='print_artefact_corrupt';
  END IF;

  IF p_mode='print' THEN
    IF p_expected_version IS NOT NULL AND p_expected_version <> v_item.version THEN
      RAISE EXCEPTION 'OC413 concurrent_update'
        USING ERRCODE='P0001', DETAIL='concurrent_update';
    END IF;

    SELECT * INTO v_release FROM public.omni_comms_channel_release_control
     WHERE organization_id=v_item.organization_id AND channel='print';
    IF v_release.id IS NULL OR v_release.release_state NOT IN ('live','controlled_pilot') THEN
      RAISE EXCEPTION 'OC412 print_release_disabled'
        USING ERRCODE='P0001', DETAIL='print_release_disabled';
    END IF;

    IF v_item.physical_status = 'held' THEN
      RAISE EXCEPTION 'OC412 print_item_held'
        USING ERRCODE='P0001', DETAIL='print_item_held';
    END IF;

    -- Safe internal transitions so a single letter never needs a batch or a
    -- sequence of technical buttons. The governed state machine still applies.
    IF v_item.physical_status IN ('artefact_produced','print_failed','spoiled') THEN
      IF NOT public.omni_comms_priv_print_transition_allowed(v_item.physical_status,'queued_for_print') THEN
        RAISE EXCEPTION 'OC412 invalid_print_transition'
          USING ERRCODE='P0001', DETAIL=v_item.physical_status || '->queued_for_print';
      END IF;
      UPDATE public.omni_comms_print_item
         SET physical_status='queued_for_print', hold_reason=NULL,
             version=version+1, updated_at=now(), updated_by=v_uid
       WHERE id=v_item.id RETURNING * INTO v_item;
    END IF;

    IF v_item.physical_status = 'queued_for_print' THEN
      IF NOT public.omni_comms_priv_print_transition_allowed('queued_for_print','printing') THEN
        RAISE EXCEPTION 'OC412 invalid_print_transition'
          USING ERRCODE='P0001', DETAIL='queued_for_print->printing';
      END IF;
      INSERT INTO public.omni_comms_print_attempt (
        print_item_id, organization_id, attempt_number, production_provider_id,
        production_account_id, operator_id, idempotency_key, outcome)
      SELECT v_item.id, v_item.organization_id, v_item.attempt_count + 1,
             (SELECT provider_id FROM public.omni_comms_provider_account
               WHERE id = v_item.production_account_id),
             v_item.production_account_id, v_uid,
             v_item.id::text || ':' || (v_item.attempt_count + 1)::text, 'in_progress'
      RETURNING id INTO v_attempt;

      UPDATE public.omni_comms_print_item
         SET physical_status='printing', attempt_count=attempt_count+1,
             version=version+1, updated_at=now(), updated_by=v_uid
       WHERE id=v_item.id RETURNING * INTO v_item;
    ELSIF v_item.physical_status = 'printing' THEN
      SELECT id INTO v_attempt FROM public.omni_comms_print_attempt
       WHERE print_item_id=v_item.id AND outcome='in_progress'
       ORDER BY attempt_number DESC LIMIT 1;
    ELSE
      RAISE EXCEPTION 'OC412 invalid_print_transition'
        USING ERRCODE='P0001', DETAIL=v_item.physical_status || '->printing';
    END IF;

    INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, metadata)
    VALUES (v_uid, 'omni_comms.print_item.opened_for_print', 'omni_comms',
            'omni_comms_print_item', v_item.id::text,
            jsonb_build_object('attempt_id', v_attempt, 'checksum', v_item.artefact_checksum_sha256));
  ELSE
    INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, metadata)
    VALUES (v_uid, 'omni_comms.print_item.previewed', 'omni_comms',
            'omni_comms_print_item', v_item.id::text,
            jsonb_build_object('checksum', v_item.artefact_checksum_sha256));
  END IF;

  RETURN jsonb_build_object(
    'id', v_item.id,
    'mode', p_mode,
    'letter_reference', v_item.letter_reference,
    'bucket', v_item.artefact_bucket,
    'path', v_item.artefact_path,
    'checksum_sha256', v_item.artefact_checksum_sha256,
    'byte_size', v_item.artefact_byte_size,
    'page_count', v_item.page_count,
    'physical_status', v_item.physical_status,
    'version', v_item.version,
    'attempt_id', v_attempt,
    'attempt_count', v_item.attempt_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_print_provision_defaults(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_print_release_set(uuid, boolean, text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_print_readiness(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_print_document_access(uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_provision_defaults(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_release_set(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_readiness(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_document_access(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_document_access(uuid, text, integer) TO service_role;