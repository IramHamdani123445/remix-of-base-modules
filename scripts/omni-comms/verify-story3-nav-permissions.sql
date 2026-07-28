-- =============================================================================
-- Epic 3 — Story 3 · Navigation & Permission verification (READ-ONLY)
--
-- Purpose:
--   Source-controlled proof that the "Omnichannel Communications → Templates"
--   left-menu entry, the six omni_comms module actions, the Admin role
--   permission mappings, and admin@secureserve.gov's Admin assignment all
--   exist in the authoritative Test database.
--
-- Contract:
--   * READ-ONLY — no INSERT / UPDATE / DELETE / DDL.
--   * Every check RAISES EXCEPTION if the state is not exactly as expected.
--   * Every check uses stable text codes (module names, action names, role
--     names, permission keys, capability codes) rather than environment-
--     specific UUIDs.
--   * A green run prints:  "STORY 3 NAV & PERMISSIONS OK".
--
-- Idempotency:
--   The script is a verifier, not a setup script. If any assertion fails,
--   apply the documented setup migration manually (never here).
-- =============================================================================

DO $$
DECLARE
  v_omni_id           uuid;
  v_templates_id      uuid;
  v_templates_route   text;
  v_admin_role_id     uuid;
  v_action_count      int;
  v_mapping_count     int;
  v_ur_count          int;
  v_admin_user        uuid;
  v_duplicate_module  int;
  v_duplicate_child   int;
BEGIN
  -- 1. Parent module
  SELECT id INTO v_omni_id
    FROM public.app_modules
   WHERE name = 'omni_comms'
     AND is_enabled = true
     AND show_in_menu = true;
  IF v_omni_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: Parent module public.app_modules(name=omni_comms) missing or disabled';
  END IF;

  -- 1a. No duplicate parent
  SELECT count(*) INTO v_duplicate_module
    FROM public.app_modules WHERE name = 'omni_comms';
  IF v_duplicate_module <> 1 THEN
    RAISE EXCEPTION 'FAIL: Duplicate omni_comms module rows (%). Exactly 1 required.', v_duplicate_module;
  END IF;

  -- 2. Templates child module
  SELECT id, route INTO v_templates_id, v_templates_route
    FROM public.app_modules
   WHERE name = 'omni_comms_templates'
     AND parent_id = v_omni_id
     AND is_enabled = true
     AND show_in_menu = true;
  IF v_templates_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: Templates child module (name=omni_comms_templates, parent=omni_comms) missing or disabled';
  END IF;
  IF v_templates_route <> '/admin/omnichannel-communications/templates' THEN
    RAISE EXCEPTION 'FAIL: Templates route is % (expected /admin/omnichannel-communications/templates)', v_templates_route;
  END IF;

  -- 2a. No duplicate Templates child anywhere in the tree
  SELECT count(*) INTO v_duplicate_child
    FROM public.app_modules
   WHERE name = 'omni_comms_templates' OR route = '/admin/omnichannel-communications/templates';
  IF v_duplicate_child <> 1 THEN
    RAISE EXCEPTION 'FAIL: Duplicate Templates node (found %). Exactly 1 required.', v_duplicate_child;
  END IF;

  -- 2b. No sibling entries for Library / Versions / Preview
  IF EXISTS (
    SELECT 1 FROM public.app_modules
     WHERE parent_id = v_templates_id AND show_in_menu = true
  ) THEN
    RAISE EXCEPTION 'FAIL: Templates node must not have visible child menu entries (Library/Versions/Preview are internal tabs).';
  END IF;

  -- 3. Six omni_comms module actions
  SELECT count(*) INTO v_action_count
    FROM public.module_actions
   WHERE module_id = v_omni_id
     AND action_name IN (
       'view','operate','configure',
       'author_templates','approve_templates','view_sensitive_content'
     )
     AND is_enabled = true;
  IF v_action_count <> 6 THEN
    RAISE EXCEPTION 'FAIL: Expected 6 enabled omni_comms module actions, found %', v_action_count;
  END IF;

  -- 4. Admin role
  SELECT id INTO v_admin_role_id
    FROM public.roles WHERE role_name = 'Admin' AND is_active = true;
  IF v_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: Admin role missing or inactive';
  END IF;

  -- 5. Admin has all 6 mappings granted
  SELECT count(*) INTO v_mapping_count
    FROM public.role_permissions rp
    JOIN public.module_actions ma ON ma.id = rp.action_id
   WHERE rp.role_id = v_admin_role_id
     AND ma.module_id = v_omni_id
     AND ma.action_name IN (
       'view','operate','configure',
       'author_templates','approve_templates','view_sensitive_content'
     )
     AND rp.is_granted = true;
  IF v_mapping_count <> 6 THEN
    RAISE EXCEPTION 'FAIL: Admin role has % of 6 required omni_comms permissions granted', v_mapping_count;
  END IF;

  -- 6. admin@secureserve.gov present in profiles and holds Admin in user_roles
  SELECT id INTO v_admin_user FROM public.profiles WHERE email = 'admin@secureserve.gov';
  IF v_admin_user IS NULL THEN
    RAISE EXCEPTION 'FAIL: profiles row for admin@secureserve.gov missing';
  END IF;
  SELECT count(*) INTO v_ur_count
    FROM public.user_roles
   WHERE user_id = v_admin_user AND role = 'Admin';
  IF v_ur_count < 1 THEN
    RAISE EXCEPTION 'FAIL: admin@secureserve.gov is not assigned the Admin app_role';
  END IF;

  RAISE NOTICE 'STORY 3 NAV & PERMISSIONS OK: module=%, templates=%, actions=6, admin_role=%, mappings=6, admin_user=%',
               v_omni_id, v_templates_id, v_admin_role_id, v_admin_user;
END $$;
