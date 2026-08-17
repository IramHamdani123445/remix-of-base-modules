DO $$
DECLARE v_layout uuid; v_version uuid;
BEGIN
  SELECT id INTO v_layout FROM public.core_template_layout WHERE code = 'OMNI_REF_PRINT';
  IF v_layout IS NULL THEN
    INSERT INTO public.core_template_layout (code, name, description, layout_kind, is_active, page_size, orientation, show_page_numbers, show_generated_date, show_doc_reference)
    VALUES ('OMNI_REF_PRINT', 'Omni-Comms Reference Print Layout', 'Canonical printed correspondence page layout used by the Print channel.', 'LETTER', true, 'A4', 'portrait', true, true, true)
    RETURNING id INTO v_layout;
  END IF;

  SELECT id INTO v_version FROM public.core_template_layout_version WHERE layout_id = v_layout AND version_number = 1;
  IF v_version IS NULL THEN
    INSERT INTO public.core_template_layout_version (layout_id, version_number, slots, wrapper_html, checksum, status, published_at)
    VALUES (
      v_layout, 1,
      '[{"code":"content_body","order":1}]'::jsonb,
      '<div data-omni-print-layout="1">{{content_body}}</div>',
      encode(digest('omni-ref-print-layout-v1', 'sha256'), 'hex'),
      'published', now()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.core_comm_assignment
    WHERE assignment_kind = 'layout_default'
      AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416'
      AND department_id IS NULL
      AND output_channel = 'print'
  ) THEN
    INSERT INTO public.core_comm_assignment (assignment_kind, organization_id, department_id, output_channel, layout_id)
    VALUES ('layout_default', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, 'print', v_layout);
  END IF;
END $$;