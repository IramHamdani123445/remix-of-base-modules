DO $$
DECLARE
  v_parent_cde uuid := 'e1a00000-0000-4000-8000-000000000005';
  v_admin_role uuid := 'bdec06a6-cfbd-4c4e-a2be-11d6b638b948';
  v_omni_root uuid;
  v_view_action_id uuid;
BEGIN
  INSERT INTO public.app_modules (
    name, display_name, description, icon, route, parent_id,
    sort_order, is_enabled, show_in_menu, rollout_state, internal_only
  )
  VALUES (
    'omni_comms',
    'Omnichannel Communications',
    'Parallel replacement for Communication Hub — shell only in Epic 1.',
    'Radio',
    '/admin/omnichannel-communications',
    v_parent_cde,
    55,
    true,
    true,
    'public',
    false
  )
  ON CONFLICT (name) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        description  = EXCLUDED.description,
        icon         = EXCLUDED.icon,
        route        = EXCLUDED.route,
        parent_id    = EXCLUDED.parent_id,
        sort_order   = EXCLUDED.sort_order,
        is_enabled   = EXCLUDED.is_enabled,
        show_in_menu = EXCLUDED.show_in_menu
  RETURNING id INTO v_omni_root;

  IF v_omni_root IS NULL THEN
    SELECT id INTO v_omni_root FROM public.app_modules WHERE name = 'omni_comms';
  END IF;

  INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id, sort_order, is_enabled, show_in_menu)
  VALUES
    ('omni_comms_overview',    'Overview',    'Landing page for Omnichannel Communications.',  'LayoutDashboard',   '/admin/omnichannel-communications',              v_omni_root,  5, true, true),
    ('omni_comms_operations',  'Operations',  'Operational console (future).',                 'Activity',          '/admin/omnichannel-communications/operations',   v_omni_root, 15, true, true),
    ('omni_comms_events',      'Events',      'Business-event catalogue (future).',            'Zap',               '/admin/omnichannel-communications/events',       v_omni_root, 25, true, true),
    ('omni_comms_templates',   'Templates',   'Template authoring and approval (future).',     'FileText',          '/admin/omnichannel-communications/templates',    v_omni_root, 35, true, true),
    ('omni_comms_channels',    'Channels',    'Channel and provider configuration (future).',  'Radio',             '/admin/omnichannel-communications/channels',     v_omni_root, 45, true, true),
    ('omni_comms_preferences', 'Preferences', 'Recipient and org preferences (future).',       'SlidersHorizontal', '/admin/omnichannel-communications/preferences',  v_omni_root, 55, true, true),
    ('omni_comms_health',      'Health',      'System health and observability (future).',     'HeartPulse',        '/admin/omnichannel-communications/health',       v_omni_root, 65, true, true)
  ON CONFLICT (name) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        description  = EXCLUDED.description,
        icon         = EXCLUDED.icon,
        route        = EXCLUDED.route,
        parent_id    = EXCLUDED.parent_id,
        sort_order   = EXCLUDED.sort_order,
        is_enabled   = EXCLUDED.is_enabled,
        show_in_menu = EXCLUDED.show_in_menu;

  INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
  VALUES
    (v_omni_root, 'view',                   'View Omnichannel Communications',      'Access the Omnichannel Communications admin shell.',                             true),
    (v_omni_root, 'operate',                'Operate Omnichannel Communications',   'Perform operational actions (reserved for future stories).',                     true),
    (v_omni_root, 'configure',              'Configure Omnichannel Communications', 'Manage channels/providers/preferences (reserved).',                              true),
    (v_omni_root, 'author_templates',       'Author Omni-Comms Templates',          'Draft and edit templates (reserved).',                                            true),
    (v_omni_root, 'approve_templates',      'Approve Omni-Comms Templates',         'Approve templates for controlled/production use (reserved).',                     true),
    (v_omni_root, 'view_sensitive_content', 'View Sensitive Omni-Comms Content',    'Unmask PII/sensitive payloads in trace/audit views (reserved).',                  true)
  ON CONFLICT (module_id, action_name) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        description  = EXCLUDED.description,
        is_enabled   = EXCLUDED.is_enabled;

  SELECT id INTO v_view_action_id
    FROM public.module_actions
   WHERE module_id = v_omni_root AND action_name = 'view';

  IF v_view_action_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
    VALUES (v_admin_role, v_omni_root, v_view_action_id, true)
    ON CONFLICT (role_id, module_id, action_id) DO UPDATE
      SET is_granted = true;
  END IF;
END $$;