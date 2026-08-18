CREATE OR REPLACE FUNCTION public.omni_comms_template_version_create_next_draft(
  p_template_family_id uuid,
  p_channel            text,
  p_locale             text,
  p_correlation_id     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid;
  v_locale text;
  v_family public.omni_comms_template_family;
  v_existing public.omni_comms_template_version;
  v_source public.omni_comms_template_version;
  v_content jsonb;
  v_next integer;
  v_row public.omni_comms_template_version;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');

  IF p_channel NOT IN ('email','sms','in_app','push','whatsapp','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_unknown';
  END IF;
  v_locale := public.omni_comms_priv_normalize_locale(p_locale);

  SELECT * INTO v_family
    FROM public.omni_comms_template_family
   WHERE id = p_template_family_id
     FOR UPDATE;
  IF v_family.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_family_not_found';
  END IF;
  IF v_family.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='family_retired';
  END IF;

  SELECT * INTO v_existing
    FROM public.omni_comms_template_version
   WHERE template_family_id = p_template_family_id
     AND channel = p_channel
     AND locale  = v_locale
     AND status  = 'draft'
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'template_family_id', v_existing.template_family_id,
      'version_number', v_existing.version_number,
      'channel', v_existing.channel,
      'locale', v_existing.locale,
      'status', v_existing.status,
      'content', v_existing.content,
      'reused_existing_draft', true,
      'source_version_id', NULL,
      'created_at', v_existing.created_at,
      'updated_at', v_existing.updated_at);
  END IF;

  SELECT * INTO v_source
    FROM public.omni_comms_template_version
   WHERE template_family_id = p_template_family_id
     AND channel = p_channel
     AND locale  = v_locale
   ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'approved' THEN 1
                        WHEN 'retired' THEN 3 ELSE 2 END,
            version_number DESC
   LIMIT 1;

  IF v_source.id IS NOT NULL THEN
    v_content := v_source.content;
  ELSE
    v_content := CASE p_channel
      WHEN 'email'    THEN jsonb_build_object('subject','New message','text','')
      WHEN 'print'    THEN jsonb_build_object('subject','New letter','text','')
      WHEN 'sms'      THEN jsonb_build_object('body','New message')
      WHEN 'whatsapp' THEN jsonb_build_object('body','New message')
      ELSE jsonb_build_object('title','New notification','body','')
    END;
  END IF;

  PERFORM public.omni_comms_priv_validate_channel_content(p_channel, v_content);

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
    FROM public.omni_comms_template_version
   WHERE template_family_id = p_template_family_id
     AND channel = p_channel
     AND locale  = v_locale;

  INSERT INTO public.omni_comms_template_version
    (template_family_id, version_number, channel, locale, content, status,
     created_by, updated_by)
  VALUES (p_template_family_id, v_next, p_channel, v_locale, v_content, 'draft',
          v_uid, v_uid)
  RETURNING * INTO v_row;

  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'create', 'template_version', v_row.id,
    v_family.code || ':' || v_row.channel || ':' || v_row.locale || ':v' || v_row.version_number,
    NULL,
    jsonb_build_object('id', v_row.id, 'template_family_id', v_row.template_family_id,
      'channel', v_row.channel, 'locale', v_row.locale,
      'version_number', v_row.version_number, 'status', v_row.status,
      'cloned_from', v_source.id),
    NULL, NULL, p_correlation_id);

  RETURN jsonb_build_object(
    'id', v_row.id,
    'template_family_id', v_row.template_family_id,
    'version_number', v_row.version_number,
    'channel', v_row.channel,
    'locale', v_row.locale,
    'status', v_row.status,
    'content', v_row.content,
    'reused_existing_draft', false,
    'source_version_id', v_source.id,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at);
END; $$;

ALTER FUNCTION public.omni_comms_template_version_create_next_draft(uuid,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_create_next_draft(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_create_next_draft(uuid,text,text,text) TO authenticated;