DELETE FROM public.omni_comms_template_version
 WHERE id = '5fd6cdad-d998-4209-945b-2be92f4b2ad8' AND status = 'draft';

DO $$
DECLARE v_id uuid; v_content jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_template_version tv
     WHERE tv.template_family_id = '41e68a2c-bcd9-4f35-a3c5-d2b8f7433260'
       AND tv.channel = 'print' AND tv.status IN ('approved','published')
  ) THEN
    v_content := jsonb_build_object(
      'subject', 'Social Security Board correspondence',
      'text', 'Dear Sir or Madam,' || E'\n\n' ||
              'This letter is issued by the Social Security Board of St. Kitts and Nevis.' || E'\n\n' ||
              'Yours sincerely,' || E'\n' || 'Social Security Board');

    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, status,
       created_by, layout_selection_mode)
    VALUES ('41e68a2c-bcd9-4f35-a3c5-d2b8f7433260', 1, 'print', 'en',
      v_content, 'draft', NULL, 'resolved_default')
    RETURNING id INTO v_id;

    UPDATE public.omni_comms_template_version
       SET status = 'approved', approved_at = now(),
           approved_by = '00000000-0000-0000-0000-000000000000',
           checksum = encode(sha256(convert_to(v_content::text, 'UTF8')), 'hex')
     WHERE id = v_id;
    UPDATE public.omni_comms_template_version
       SET status = 'published', published_at = now(),
           published_by = '00000000-0000-0000-0000-000000000000'
     WHERE id = v_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_release_set(
  p_organization_id uuid, p_enabled boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('configure');
  v_row public.omni_comms_channel_release_control%ROWTYPE;
  v_provider uuid;
  v_account uuid;
  v_identity uuid;
  v_endpoint uuid;
  v_binding uuid;
  v_templates int;
  v_bucket_private boolean;
  v_missing text[] := '{}';
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

  IF p_enabled THEN
    SELECT id INTO v_provider FROM public.omni_comms_provider
     WHERE channel='print' AND code='print_spool' AND status='active';
    SELECT id INTO v_account FROM public.omni_comms_provider_account
     WHERE organization_id=p_organization_id AND provider_id=v_provider
       AND code='print_spool_internal' AND status='active';
    SELECT id INTO v_identity FROM public.omni_comms_sender_identity
     WHERE organization_id=p_organization_id AND channel='print' AND status='active'
     ORDER BY created_at LIMIT 1;
    SELECT id INTO v_endpoint FROM public.omni_comms_channel_endpoint
     WHERE organization_id=p_organization_id AND channel='print'
       AND endpoint_type='render_service' AND status='active' ORDER BY created_at LIMIT 1;
    SELECT id INTO v_binding FROM public.omni_comms_sender_provider_binding
     WHERE organization_id=p_organization_id AND channel='print' AND status='active'
     ORDER BY priority LIMIT 1;
    SELECT count(*) INTO v_templates
      FROM public.omni_comms_template_version tv
      JOIN public.omni_comms_template_family tf ON tf.id = tv.template_family_id
     WHERE tv.channel='print' AND tv.status IN ('published','active','approved')
       AND (tf.organization_id IS NULL OR tf.organization_id = p_organization_id);
    SELECT NOT public INTO v_bucket_private FROM storage.buckets WHERE id='core-documents';

    IF v_provider IS NULL THEN v_missing := v_missing || 'provider'; END IF;
    IF v_account IS NULL THEN v_missing := v_missing || 'account'; END IF;
    IF v_identity IS NULL THEN v_missing := v_missing || 'issuing_authority'; END IF;
    IF v_endpoint IS NULL THEN v_missing := v_missing || 'render_endpoint'; END IF;
    IF v_binding IS NULL THEN v_missing := v_missing || 'binding'; END IF;
    IF v_templates = 0 THEN v_missing := v_missing || 'print_template'; END IF;
    IF NOT coalesce(v_bucket_private,false) THEN v_missing := v_missing || 'pdf_storage'; END IF;

    IF array_length(v_missing,1) > 0 THEN
      RAISE EXCEPTION 'OC409 print_readiness_incomplete'
        USING ERRCODE='P0001',
              DETAIL='print_readiness_incomplete',
              HINT=array_to_string(v_missing, ',');
    END IF;

    PERFORM set_config('omni_comms.live_transition', 'on', true);
  END IF;

  UPDATE public.omni_comms_channel_release_control
     SET release_state = CASE WHEN p_enabled THEN 'live' ELSE 'disabled' END,
         release_version = release_version + 1,
         activated_by = CASE WHEN p_enabled THEN v_uid ELSE activated_by END,
         activated_at = CASE WHEN p_enabled THEN now() ELSE activated_at END,
         release_starts_at = CASE WHEN p_enabled THEN coalesce(release_starts_at, now()) ELSE release_starts_at END,
         suspended_by = CASE WHEN p_enabled THEN NULL ELSE v_uid END,
         suspended_at = CASE WHEN p_enabled THEN NULL ELSE now() END,
         suspension_reason = CASE WHEN p_enabled THEN NULL ELSE p_reason END,
         updated_at = now(), updated_by = v_uid
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM set_config('omni_comms.live_transition', 'off', true);

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id,
                                 old_value, new_value, metadata)
  VALUES (v_uid, 'omni_comms.print.release_' || CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,
          'omni_comms', 'omni_comms_channel_release_control', v_row.id::text,
          NULL, v_row.release_state,
          jsonb_strip_nulls(jsonb_build_object(
            'reason', p_reason,
            'gates_verified', p_enabled,
            'template_variants', v_templates)));

  RETURN jsonb_build_object('id', v_row.id, 'release_state', v_row.release_state,
                            'release_version', v_row.release_version);
END;
$function$;