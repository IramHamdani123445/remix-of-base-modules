DO $$
DECLARE
  v_parent uuid := '21a6c11c-8205-4fba-913b-002ea73a21b9';
  v_stationery uuid := 'b4cfd764-3a78-4420-a0e5-8135814156da';
  v_setup uuid;
BEGIN
  -- Direct children ordering
  UPDATE public.app_modules SET sort_order = 5  WHERE name = 'omni_comms_overview';
  UPDATE public.app_modules SET sort_order = 20 WHERE name = 'omni_comms_operations';
  UPDATE public.app_modules SET sort_order = 30 WHERE name = 'omni_comms_channels';
  UPDATE public.app_modules SET sort_order = 35 WHERE name = 'omni_comms_events';
  UPDATE public.app_modules SET sort_order = 40 WHERE name = 'omni_comms_templates';

  -- Control Center as a first-class entry
  INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id, sort_order, is_enabled, show_in_menu)
  VALUES ('omni_comms_control_center', 'Control Center', 'Delivery gates, test send and the approval queue.', 'ShieldCheck',
          '/admin/omnichannel-communications/control-center', v_parent, 10, true, true)
  ON CONFLICT (name) DO UPDATE SET route = EXCLUDED.route, parent_id = EXCLUDED.parent_id,
    sort_order = EXCLUDED.sort_order, display_name = EXCLUDED.display_name, show_in_menu = true, is_enabled = true;

  -- Stationery becomes a group (no route of its own)
  UPDATE public.app_modules
     SET route = NULL, icon = 'PenTool', sort_order = 50,
         description = 'Letterheads, email layouts, media, text blocks and signatures.'
   WHERE id = v_stationery;

  INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id, sort_order, is_enabled, show_in_menu)
  VALUES
    ('omni_comms_stationery_letterheads', 'Letterheads', 'Printed letterhead designs.', 'FileText', '/admin/omnichannel-communications/stationery/letterheads', v_stationery, 10, true, true),
    ('omni_comms_stationery_email_layouts', 'Email layouts', 'Branded email shells and organisation defaults.', 'Mail', '/admin/omnichannel-communications/stationery/email-layouts', v_stationery, 20, true, true),
    ('omni_comms_stationery_media', 'Media library', 'Logos, seals and banner assets.', 'Boxes', '/admin/omnichannel-communications/stationery/media', v_stationery, 30, true, true),
    ('omni_comms_stationery_text_blocks', 'Text blocks', 'Reusable copy and disclaimers.', 'FileCode', '/admin/omnichannel-communications/stationery/text-blocks', v_stationery, 40, true, true),
    ('omni_comms_stationery_headers_footers', 'Headers & footers', 'Header and footer compositions.', 'Layers', '/admin/omnichannel-communications/stationery/headers-footers', v_stationery, 50, true, true),
    ('omni_comms_stationery_signatures', 'Signatures', 'Signing officers and signature images.', 'PenTool', '/admin/omnichannel-communications/stationery/signatures', v_stationery, 60, true, true)
  ON CONFLICT (name) DO UPDATE SET route = EXCLUDED.route, parent_id = EXCLUDED.parent_id,
    sort_order = EXCLUDED.sort_order, display_name = EXCLUDED.display_name, show_in_menu = true, is_enabled = true;

  -- Setup & health group
  INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id, sort_order, is_enabled, show_in_menu)
  VALUES ('omni_comms_setup_group', 'Setup & health', 'Readiness, safe test, reference data and diagnostics.', 'Wrench', NULL, v_parent, 60, true, true)
  ON CONFLICT (name) DO UPDATE SET route = NULL, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order,
    display_name = EXCLUDED.display_name, show_in_menu = true, is_enabled = true
  RETURNING id INTO v_setup;

  IF v_setup IS NULL THEN
    SELECT id INTO v_setup FROM public.app_modules WHERE name = 'omni_comms_setup_group';
  END IF;

  INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id, sort_order, is_enabled, show_in_menu)
  VALUES
    ('omni_comms_setup', 'Setup readiness', 'What still has to be configured.', 'ClipboardCheck', '/admin/omnichannel-communications/setup', v_setup, 10, true, true),
    ('omni_comms_safe_test', 'Safe test', 'Rehearse a send without contacting a provider.', 'FlaskConical', '/admin/omnichannel-communications/safe-test', v_setup, 20, true, true),
    ('omni_comms_reference_data', 'Reference data', 'Canonical vocabularies and registries.', 'Database', '/admin/omnichannel-communications/reference-data', v_setup, 30, true, true)
  ON CONFLICT (name) DO UPDATE SET route = EXCLUDED.route, parent_id = EXCLUDED.parent_id,
    sort_order = EXCLUDED.sort_order, display_name = EXCLUDED.display_name, show_in_menu = true, is_enabled = true;

  UPDATE public.app_modules SET parent_id = v_setup, sort_order = 40 WHERE name = 'omni_comms_health';
  UPDATE public.app_modules SET parent_id = v_setup, sort_order = 50 WHERE name = 'omni_comms_preferences';
END $$;