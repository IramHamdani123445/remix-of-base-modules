INSERT INTO public.app_modules (id, name, display_name, description, route, parent_id, icon, sort_order, is_enabled, show_in_menu, routes_enabled, actions_enabled, rollout_state, primary_key_column, inherits_parent_access, internal_only)
SELECT
  gen_random_uuid(),
  'ce_field_weekly_plan_reports',
  'Weekly Plan Reports',
  'Manager review of submitted weekly field plan reports',
  '/compliance/field/weekly-plan-reports',
  m.parent_id,
  'FileText',
  35,
  true,
  false,
  true,
  true,
  'public',
  'id',
  false,
  false
FROM public.app_modules m
WHERE m.route = '/compliance/field/all-reports'
  AND NOT EXISTS (SELECT 1 FROM public.app_modules x WHERE x.route = '/compliance/field/weekly-plan-reports')
LIMIT 1;