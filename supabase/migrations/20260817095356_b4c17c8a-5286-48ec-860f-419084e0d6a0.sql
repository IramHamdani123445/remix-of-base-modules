DO $$
DECLARE
  v_layout uuid;
  v_wrapper text := '<div data-omni-whatsapp-layout="1">{{content_body}}</div>';
BEGIN
  SELECT id INTO v_layout FROM public.core_template_layout WHERE code = 'OMNI_REF_WHATSAPP';
  IF v_layout IS NULL THEN
    INSERT INTO public.core_template_layout (code, name, description, layout_kind, has_letterhead, is_active)
    VALUES ('OMNI_REF_WHATSAPP', 'Omni-Comms Reference WhatsApp Layout',
            'Plain-text wrapper for WhatsApp channel template versions.', 'WHATSAPP', false, true)
    RETURNING id INTO v_layout;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.core_template_layout_version WHERE layout_id = v_layout) THEN
    INSERT INTO public.core_template_layout_version (layout_id, version_number, slots, wrapper_html, checksum, status)
    VALUES (v_layout, 1, '[{"code": "content_body", "order": 1}]'::jsonb, v_wrapper,
            md5(v_wrapper) || md5(v_wrapper || ':omni_ref_whatsapp_v1'), 'published');
  END IF;
END $$;