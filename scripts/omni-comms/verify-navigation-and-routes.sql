-- Omni-Comms Navigation & Routes Verifier
-- Asserts deployed menu, actions, permissions, admin binding.
-- Prints "OMNI COMMS NAVIGATION AND ROUTES VERIFY OK" only when all checks pass.
DO $$
DECLARE
  v_root_id uuid;
  v_child_count int;
  v_action_count int;
  v_enabled_action_count int;
  v_admin_perm_count int;
  v_admin_user_role_count int;
  v_dup_route int;
  v_dup_name int;
  v_expected_children text[] := ARRAY[
    'omni_comms_overview','omni_comms_operations','omni_comms_events',
    'omni_comms_templates','omni_comms_channels','omni_comms_preferences',
    'omni_comms_health'
  ];
  v_expected_actions text[] := ARRAY[
    'view','operate','configure','author_templates',
    'approve_templates','view_sensitive_content'
  ];
  v_missing text;
BEGIN
  -- 1. exactly one omni_comms root
  SELECT id INTO v_root_id FROM public.app_modules
   WHERE name='omni_comms' AND route='/admin/omnichannel-communications';
  IF v_root_id IS NULL THEN RAISE EXCEPTION 'Missing omni_comms root'; END IF;
  IF (SELECT count(*) FROM public.app_modules WHERE name='omni_comms') <> 1 THEN
    RAISE EXCEPTION 'Duplicate omni_comms root';
  END IF;

  -- 2. exactly seven children, all enabled+visible, correct routes
  SELECT count(*) INTO v_child_count
    FROM public.app_modules
   WHERE parent_id = v_root_id
     AND name = ANY(v_expected_children)
     AND is_enabled = true
     AND show_in_menu = true;
  IF v_child_count <> 7 THEN
    RAISE EXCEPTION 'Expected 7 enabled+visible children, found %', v_child_count;
  END IF;

  FOREACH v_missing IN ARRAY v_expected_children LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.app_modules
       WHERE name = v_missing AND parent_id = v_root_id
    ) THEN
      RAISE EXCEPTION 'Missing child menu row: %', v_missing;
    END IF;
  END LOOP;

  -- 3. no duplicate child names / routes
  SELECT count(*) INTO v_dup_name FROM (
    SELECT name FROM public.app_modules WHERE parent_id=v_root_id
    GROUP BY name HAVING count(*) > 1
  ) x;
  IF v_dup_name > 0 THEN RAISE EXCEPTION 'Duplicate child names present'; END IF;

  SELECT count(*) INTO v_dup_route FROM (
    SELECT route FROM public.app_modules WHERE parent_id=v_root_id
    GROUP BY route HAVING count(*) > 1
  ) x;
  IF v_dup_route > 0 THEN RAISE EXCEPTION 'Duplicate child routes present'; END IF;

  -- child routes match expected
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name='omni_comms_overview'    AND route='/admin/omnichannel-communications') THEN RAISE EXCEPTION 'Wrong route for overview'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name='omni_comms_operations'  AND route='/admin/omnichannel-communications/operations') THEN RAISE EXCEPTION 'Wrong route for operations'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name='omni_comms_events'      AND route='/admin/omnichannel-communications/events') THEN RAISE EXCEPTION 'Wrong route for events'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name='omni_comms_templates'   AND route='/admin/omnichannel-communications/templates') THEN RAISE EXCEPTION 'Wrong route for templates'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name='omni_comms_channels'    AND route='/admin/omnichannel-communications/channels') THEN RAISE EXCEPTION 'Wrong route for channels'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name='omni_comms_preferences' AND route='/admin/omnichannel-communications/preferences') THEN RAISE EXCEPTION 'Wrong route for preferences'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name='omni_comms_health'      AND route='/admin/omnichannel-communications/health') THEN RAISE EXCEPTION 'Wrong route for health'; END IF;

  -- 4. six actions, all enabled
  SELECT count(*) INTO v_action_count FROM public.module_actions
   WHERE module_id = v_root_id AND action_name = ANY(v_expected_actions);
  IF v_action_count <> 6 THEN
    RAISE EXCEPTION 'Expected 6 module actions, found %', v_action_count;
  END IF;

  SELECT count(*) INTO v_enabled_action_count FROM public.module_actions
   WHERE module_id = v_root_id AND action_name = ANY(v_expected_actions)
     AND is_enabled = true;
  IF v_enabled_action_count <> 6 THEN
    RAISE EXCEPTION 'Not all 6 actions enabled: % enabled', v_enabled_action_count;
  END IF;

  -- 5. Admin role has all 6 permissions granted
  SELECT count(*) INTO v_admin_perm_count
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    JOIN public.module_actions ma ON ma.id = rp.action_id
   WHERE r.role_name = 'Admin'
     AND ma.module_id = v_root_id
     AND rp.is_granted = true
     AND ma.action_name = ANY(v_expected_actions);
  IF v_admin_perm_count <> 6 THEN
    RAISE EXCEPTION 'Admin role missing omni_comms permissions: % of 6', v_admin_perm_count;
  END IF;

  -- 6. admin@secureserve.gov has Admin role
  SELECT count(*) INTO v_admin_user_role_count
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE p.email = 'admin@secureserve.gov' AND ur.role = 'Admin';
  IF v_admin_user_role_count < 1 THEN
    RAISE EXCEPTION 'admin@secureserve.gov not bound to Admin role';
  END IF;

  RAISE NOTICE 'OMNI COMMS NAVIGATION AND ROUTES VERIFY OK';
END $$;
