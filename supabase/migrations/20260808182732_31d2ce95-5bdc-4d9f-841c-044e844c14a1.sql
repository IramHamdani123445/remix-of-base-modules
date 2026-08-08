-- Means-Test: dedicated search screen
INSERT INTO public.app_modules (name, display_name, description, route, parent_id, sort_order, show_in_menu, is_enabled, inherits_parent_access)
VALUES ('bn_means_tests_search', 'Search assessments', 'Search and filter every Means-Test assessment.', '/bn/means-tests/search', '760f025c-3013-4b8a-8cf9-52ecba927718', 25, true, true, true)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, route = EXCLUDED.route, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order, show_in_menu = true, is_enabled = true, inherits_parent_access = true;

-- Risk: split controls into three screens
UPDATE public.app_modules
SET name = 'bn_risk_control_decisions',
    display_name = 'Control decisions',
    description = 'Recommended controls awaiting independent decision.',
    route = '/bn/risk-management/control-decisions',
    sort_order = 40
WHERE id = '2973d340-282b-4736-b602-f2187d3e6aa0';

INSERT INTO public.app_modules (name, display_name, description, route, parent_id, sort_order, show_in_menu, is_enabled, inherits_parent_access)
VALUES
  ('bn_risk_control_execution', 'Control execution', 'Approved controls awaiting governed execution.', '/bn/risk-management/control-execution', 'c3e1c0b3-a579-42fc-9fc4-474ecaeac269', 45, true, true, true),
  ('bn_risk_outcomes', 'Outcomes & closure', 'Assessment outcomes, completion and closure.', '/bn/risk-management/outcomes', 'c3e1c0b3-a579-42fc-9fc4-474ecaeac269', 47, true, true, true)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, route = EXCLUDED.route, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order, show_in_menu = true, is_enabled = true, inherits_parent_access = true;

-- Uprating: split operational queues into two screens
UPDATE public.app_modules
SET name = 'bn_uprating_execution',
    display_name = 'Execution queue',
    description = 'Approved runs awaiting or undergoing batch execution.',
    route = '/bn/uprating/execution'
WHERE name = 'bn_uprating_operations';

INSERT INTO public.app_modules (name, display_name, description, route, parent_id, sort_order, show_in_menu, is_enabled, inherits_parent_access)
VALUES ('bn_uprating_post_execution', 'Post-execution queue', 'Schedule rebuilds, notices, reconciliation and rollback.', '/bn/uprating/post-execution', 'e6340360-c102-4a84-8275-25416a906b0d', 55, true, true, true)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, route = EXCLUDED.route, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order, show_in_menu = true, is_enabled = true, inherits_parent_access = true;