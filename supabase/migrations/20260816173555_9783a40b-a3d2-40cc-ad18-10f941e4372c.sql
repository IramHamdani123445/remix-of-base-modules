-- Print provisioning must respect the governed draft → active lifecycle.
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

  -- Provider account (draft → active)
  SELECT id INTO v_account FROM public.omni_comms_provider_account
   WHERE organization_id=p_organization_id AND provider_id=v_provider AND code='print_spool_internal';
  IF v_account IS NULL THEN
    INSERT INTO public.omni_comms_provider_account (
      organization_id, provider_id, code, display_name, status, environment,
      sandbox_mode, data_origin, verification_status, created_by, updated_by)
    VALUES (p_organization_id, v_provider, 'print_spool_internal',
      'Internal print spool', 'draft', 'production', false, 'system_seed',
      'verified', v_uid, v_uid)
    RETURNING id INTO v_account;
  END IF;
  UPDATE public.omni_comms_provider_account
     SET status='active', activated_at=coalesce(activated_at, now()),
         activated_by=coalesce(activated_by, v_uid), updated_at=now(), updated_by=v_uid
   WHERE id=v_account AND status <> 'active';

  -- Issuing authority (draft → active)
  SELECT id INTO v_identity FROM public.omni_comms_sender_identity
   WHERE organization_id=p_organization_id AND channel='print' AND code='print_issuing_authority';
  IF v_identity IS NULL THEN
    INSERT INTO public.omni_comms_sender_identity (
      organization_id, department_id, code, display_name, channel, identity_type,
      audience, status, data_origin, print_config, identity_config,
      created_by, updated_by)
    VALUES (p_organization_id, p_department_id, 'print_issuing_authority',
      'Social Security Board — Correspondence', 'print', 'issuing_authority',
      'external', 'draft', 'system_seed',
      jsonb_build_object(
        'return_reference','Social Security Board, Bay Road, Basseterre, St. Kitts',
        'paper_size','A4','sides','simplex','colour_mode','black_white'),
      '{}'::jsonb, v_uid, v_uid)
    RETURNING id INTO v_identity;
  END IF;
  UPDATE public.omni_comms_sender_identity
     SET status='active', activated_at=coalesce(activated_at, now()),
         activated_by=coalesce(activated_by, v_uid), updated_at=now(), updated_by=v_uid
   WHERE id=v_identity AND status <> 'active';

  -- Render endpoint (draft → active)
  SELECT id INTO v_endpoint FROM public.omni_comms_channel_endpoint
   WHERE organization_id=p_organization_id AND channel='print' AND code='print_render_service';
  IF v_endpoint IS NULL THEN
    INSERT INTO public.omni_comms_channel_endpoint (
      organization_id, department_id, channel, provider_account_id, code, display_name,
      endpoint_type, endpoint_config, data_origin, status, verification_status,
      verification_result_code, verification_checked_at, created_by, updated_by)
    VALUES (p_organization_id, p_department_id, 'print', v_account, 'print_render_service',
      'Internal correspondence render service', 'render_service',
      jsonb_build_object('renderer','omni_comms_print_spool','format','pdf',
                         'bucket','core-documents','external_callback', false),
      'system_seed', 'draft', 'verified', 'internal_renderer', now(),
      v_uid, v_uid)
    RETURNING id INTO v_endpoint;
  END IF;
  UPDATE public.omni_comms_channel_endpoint
     SET status='active', verification_status='verified',
         activated_at=coalesce(activated_at, now()),
         activated_by=coalesce(activated_by, v_uid), updated_at=now(), updated_by=v_uid
   WHERE id=v_endpoint AND status <> 'active';

  -- Binding (draft → active)
  SELECT id INTO v_binding FROM public.omni_comms_sender_provider_binding
   WHERE sender_identity_id=v_identity AND provider_account_id=v_account;
  IF v_binding IS NULL THEN
    INSERT INTO public.omni_comms_sender_provider_binding (
      organization_id, department_id, channel, sender_identity_id, provider_account_id,
      channel_endpoint_id, priority, status, verification_status, verification_source,
      verification_result_code, verification_checked_at, verified_at, data_origin,
      created_by, updated_by)
    VALUES (p_organization_id, p_department_id, 'print', v_identity, v_account,
      v_endpoint, 1, 'draft', 'verified', 'internal',
      'internal_no_credential', now(), now(), 'system_seed',
      v_uid, v_uid)
    RETURNING id INTO v_binding;
  END IF;
  UPDATE public.omni_comms_sender_provider_binding
     SET status='active', channel_endpoint_id=coalesce(channel_endpoint_id, v_endpoint),
         verification_status='verified',
         activated_at=coalesce(activated_at, now()),
         activated_by=coalesce(activated_by, v_uid), updated_at=now(), updated_by=v_uid
   WHERE id=v_binding AND status <> 'active';

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

REVOKE ALL ON FUNCTION public.omni_comms_print_provision_defaults(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_provision_defaults(uuid, uuid) TO authenticated;