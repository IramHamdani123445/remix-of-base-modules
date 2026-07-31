DO $$
DECLARE
  v_org uuid := '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
  v_layout uuid;
  v_slots jsonb := '[{"code":"content_body","order":1}]'::jsonb;
BEGIN
  SELECT id INTO v_layout FROM public.core_template_layout WHERE code = 'OMNI_SYNTHETIC_EMAIL_PILOT';
  IF v_layout IS NULL THEN
    INSERT INTO public.core_template_layout (code, name, description, has_letterhead, layout_kind, is_active)
    VALUES ('OMNI_SYNTHETIC_EMAIL_PILOT', 'Omni-Comms Synthetic Email Pilot Layout',
            'Synthetic non-production email layout used exclusively by the Omni-Comms controlled dry-run pilot.',
            false, 'EMAIL', true)
    RETURNING id INTO v_layout;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.core_template_layout_version WHERE layout_id = v_layout AND version_number = 1) THEN
    INSERT INTO public.core_template_layout_version (layout_id, version_number, slots, wrapper_html, checksum, status)
    VALUES (v_layout, 1, v_slots,
            '<div class="omni-synthetic-pilot">{{content_body}}</div>',
            encode(digest(v_slots::text, 'sha256'), 'hex'),
            'published');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.core_comm_assignment
     WHERE organization_id = v_org AND department_id IS NULL
       AND output_channel = 'email' AND assignment_kind = 'layout_default'
  ) THEN
    INSERT INTO public.core_comm_assignment (organization_id, department_id, output_channel, assignment_kind, layout_id)
    VALUES (v_org, NULL, 'email', 'layout_default', v_layout);
  END IF;
END $$;