-- 1) DEF-S1B-32: Quality Reviewer independent read access to engagements
CREATE OR REPLACE FUNCTION public.ia_is_quality_reviewer()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND ( EXISTS (SELECT 1 FROM public.user_roles ur
                   WHERE ur.user_id = auth.uid()
                     AND ur.role::text = 'IA_QUALITY_REVIEWER')
        OR EXISTS (SELECT 1 FROM public.ia_auditors a
                   WHERE (a.profile_id = auth.uid() OR a.user_id = auth.uid())
                     AND a.role = 'Quality Reviewer') )
$$;

CREATE OR REPLACE FUNCTION public.ia_can_access_engagement_internal(_engagement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.ia_can_read_all() THEN true
    WHEN public.ia_is_quality_reviewer() THEN true
    WHEN _engagement_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.ia_audit_engagements e
      WHERE e.id = _engagement_id
        AND public.ia_current_auditor_id() IS NOT NULL
        AND ( e.lead_auditor_id::text = public.ia_current_auditor_id()::text
           OR e.reviewer_id::text = public.ia_current_auditor_id()::text
           OR COALESCE(e.team_member_ids, '[]'::jsonb) ? public.ia_current_auditor_id()::text
           OR COALESCE(e.supportive_auditor_ids, '[]'::jsonb) ? public.ia_current_auditor_id()::text )
    )
    OR EXISTS (
      SELECT 1 FROM public.ia_quality_reviews q
      WHERE q.engagement_id = _engagement_id
        AND q.reviewer_id::text = public.ia_current_auditor_id()::text
    )
  END
$$;

-- 2) DEF-S1B-33: Management Respondent navigation
DO $$
DECLARE
  v_parent uuid := '014f0c8f-7388-4bf9-9de0-28d122b6d3bf';
  v_group uuid;
  v_role uuid;
  v_mod uuid;
  v_action uuid;
  r record;
BEGIN
  INSERT INTO public.app_modules (name, display_name, icon, route, parent_id, sort_order, is_enabled, show_in_menu, routes_enabled)
  VALUES ('ia_management_workspace', 'Management Workspace', 'MessageSquare', NULL, v_parent, 345, true, true, true)
  ON CONFLICT (name) DO UPDATE SET is_enabled = true, show_in_menu = true, parent_id = EXCLUDED.parent_id
  RETURNING id INTO v_group;

  IF v_group IS NULL THEN
    SELECT id INTO v_group FROM public.app_modules WHERE name = 'ia_management_workspace';
  END IF;

  SELECT id INTO v_role FROM public.roles WHERE role_name = 'IA_MANAGEMENT_RESPONDENT';

  FOR r IN
    SELECT * FROM (VALUES
      ('ia_mgmt_my_work',      'My Work',            'Inbox',        '/audit/action-centre?tab=my-work',  1),
      ('ia_mgmt_findings',     'Findings Register',  'AlertTriangle','/audit/action-centre?tab=findings', 2),
      ('ia_mgmt_actions',      'Corrective Actions', 'ListChecks',   '/audit/action-centre?tab=register', 3),
      ('ia_mgmt_followups',    'Follow-Ups',         'Clock',        '/audit/action-centre?tab=followup', 4)
    ) AS t(nm, dn, ic, rt, so)
  LOOP
    INSERT INTO public.app_modules (name, display_name, icon, route, parent_id, sort_order, is_enabled, show_in_menu, routes_enabled)
    VALUES (r.nm, r.dn, r.ic, r.rt, v_group, r.so, true, true, true)
    ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, route = EXCLUDED.route,
      parent_id = EXCLUDED.parent_id, is_enabled = true, show_in_menu = true, routes_enabled = true
    RETURNING id INTO v_mod;

    IF v_mod IS NULL THEN
      SELECT id INTO v_mod FROM public.app_modules WHERE name = r.nm;
    END IF;

    SELECT id INTO v_action FROM public.module_actions WHERE module_id = v_mod AND action_name = 'view';
    IF v_action IS NULL THEN
      INSERT INTO public.module_actions (module_id, action_name, display_name, is_enabled)
      VALUES (v_mod, 'view', 'View', true) RETURNING id INTO v_action;
    END IF;

    IF v_role IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_role AND module_id = v_mod AND action_id = v_action
    ) THEN
      INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
      VALUES (v_role, v_mod, v_action, true);
    END IF;
  END LOOP;
END $$;

-- 3) Audit Administrator role
DO $$
DECLARE
  v_role uuid;
  v_mod uuid;
  v_action uuid;
  r record;
BEGIN
  INSERT INTO public.roles (role_name, description, is_active)
  VALUES ('IA_AUDIT_ADMIN', 'Internal Audit administrator — configuration, reference data and resources', true)
  ON CONFLICT (role_name) DO UPDATE SET is_active = true
  RETURNING id INTO v_role;

  IF v_role IS NULL THEN
    SELECT id INTO v_role FROM public.roles WHERE role_name = 'IA_AUDIT_ADMIN';
  END IF;

  FOR r IN
    SELECT m.id
    FROM public.app_modules m
    WHERE m.is_enabled = true
      AND m.show_in_menu = true
      AND ( m.parent_id IN (
              '5a9e2e6e-812c-4472-98db-263070b65033',  -- Configuration
              'a1100001-0001-4000-8000-000000000001',  -- Audit Universe
              '88d99dc8-1cab-49b5-980f-f41b11ea933d'   -- Resources
            )
            OR m.id IN (
              '5a9e2e6e-812c-4472-98db-263070b65033',
              'a1100001-0001-4000-8000-000000000001',
              '88d99dc8-1cab-49b5-980f-f41b11ea933d',
              'a1100001-0001-4000-8000-000000000009'   -- Dashboard
            ) )
  LOOP
    v_mod := r.id;
    SELECT id INTO v_action FROM public.module_actions WHERE module_id = v_mod AND action_name = 'view';
    IF v_action IS NULL THEN
      INSERT INTO public.module_actions (module_id, action_name, display_name, is_enabled)
      VALUES (v_mod, 'view', 'View', true) RETURNING id INTO v_action;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_role AND module_id = v_mod AND action_id = v_action
    ) THEN
      INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
      VALUES (v_role, v_mod, v_action, true);
    END IF;
  END LOOP;
END $$;