DO $$
DECLARE
  v_root uuid;
  v_operate uuid;
  v_configure uuid;
  v_branding uuid;
BEGIN
  SELECT id INTO v_root FROM public.app_modules WHERE name='omni_comms';
  IF v_root IS NULL THEN RAISE EXCEPTION 'omni_comms root missing'; END IF;

  -- 1. Operate group
  INSERT INTO public.app_modules (name, display_name, description, icon, parent_id, route, show_in_menu, is_enabled, sort_order, rollout_state, primary_key_column)
  VALUES ('omni_comms_operate_group','Operate','Day-to-day running of communications.','Activity', v_root, NULL, true, true, 10, 'public','id')
  ON CONFLICT (name) DO UPDATE SET display_name=EXCLUDED.display_name, parent_id=EXCLUDED.parent_id, sort_order=EXCLUDED.sort_order, show_in_menu=true, is_enabled=true, icon=EXCLUDED.icon, description=EXCLUDED.description
  RETURNING id INTO v_operate;
  IF v_operate IS NULL THEN SELECT id INTO v_operate FROM public.app_modules WHERE name='omni_comms_operate_group'; END IF;

  -- 2. Configure group
  INSERT INTO public.app_modules (name, display_name, description, icon, parent_id, route, show_in_menu, is_enabled, sort_order, rollout_state, primary_key_column)
  VALUES ('omni_comms_configure_group','Configure','Channels, business events and templates.','SlidersHorizontal', v_root, NULL, true, true, 20, 'public','id')
  ON CONFLICT (name) DO UPDATE SET display_name=EXCLUDED.display_name, parent_id=EXCLUDED.parent_id, sort_order=EXCLUDED.sort_order, show_in_menu=true, is_enabled=true, icon=EXCLUDED.icon, description=EXCLUDED.description
  RETURNING id INTO v_configure;
  IF v_configure IS NULL THEN SELECT id INTO v_configure FROM public.app_modules WHERE name='omni_comms_configure_group'; END IF;

  -- 3. Re-parent operate children
  UPDATE public.app_modules SET parent_id=v_operate, sort_order=10 WHERE name='omni_comms_overview';
  UPDATE public.app_modules SET parent_id=v_operate, sort_order=20 WHERE name='omni_comms_control_center';
  UPDATE public.app_modules SET parent_id=v_operate, sort_order=30 WHERE name='omni_comms_operations';

  -- 4. Re-parent configure children
  UPDATE public.app_modules SET parent_id=v_configure, sort_order=10 WHERE name='omni_comms_channels';
  UPDATE public.app_modules SET parent_id=v_configure, sort_order=20 WHERE name='omni_comms_events';
  UPDATE public.app_modules SET parent_id=v_configure, sort_order=30 WHERE name='omni_comms_templates';

  -- 5. Rename Stationery group -> Branding & Layouts, keep it third
  UPDATE public.app_modules
     SET display_name='Branding & Layouts',
         description='Which layout and shared assets apply, and the reusable stationery behind them.',
         icon='Palette',
         sort_order=30
   WHERE name='omni_comms_stationery'
  RETURNING id INTO v_branding;
  IF v_branding IS NULL THEN SELECT id INTO v_branding FROM public.app_modules WHERE name='omni_comms_stationery'; END IF;

  -- 6. Defaults & overrides entry (was missing from the menu)
  INSERT INTO public.app_modules (name, display_name, description, icon, parent_id, route, show_in_menu, is_enabled, sort_order, rollout_state, primary_key_column)
  VALUES ('omni_comms_branding_defaults','Defaults & overrides','Effective layout and assets per module, department and event, with the inherited source of every value.','Layers', v_branding, '/admin/omnichannel-communications/branding/defaults', true, true, 5, 'public','id')
  ON CONFLICT (name) DO UPDATE SET display_name=EXCLUDED.display_name, parent_id=EXCLUDED.parent_id, route=EXCLUDED.route, sort_order=EXCLUDED.sort_order, show_in_menu=true, is_enabled=true, icon=EXCLUDED.icon, description=EXCLUDED.description;

  -- 7. Setup & health stays last
  UPDATE public.app_modules SET sort_order=40, icon='HeartPulse' WHERE name='omni_comms_setup_group';
  -- Preferences is a technical surface, not advertised
  UPDATE public.app_modules SET show_in_menu=false WHERE name='omni_comms_preferences';
END $$;