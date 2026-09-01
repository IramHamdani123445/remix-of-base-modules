INSERT INTO app_modules (id, name, display_name, description, icon, route, parent_id, sort_order, is_enabled, show_in_menu, routes_enabled)
SELECT gen_random_uuid(), 'audit_user_manuals', 'User Manuals', 'Download role-based Internal Audit user manuals (PDF/DOCX)', 'BookOpen', '/audit/user-manuals', p.id, 86, true, true, true
FROM app_modules p WHERE p.name = 'internal_audit_reference_data'
ON CONFLICT (name) DO NOTHING;

INSERT INTO module_actions (id, module_id, action_name, display_name, description, is_enabled)
SELECT gen_random_uuid(), m.id, 'view', 'View', 'Open the Internal Audit user manuals download page', true
FROM app_modules m WHERE m.name = 'audit_user_manuals'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (id, module_id, action_id, role_id, is_granted)
SELECT gen_random_uuid(), m.id, ma.id, r.id, true
FROM app_modules m
JOIN module_actions ma ON ma.module_id = m.id AND ma.action_name = 'view'
JOIN roles r ON r.role_name IN ('Audit Manager', 'Auditor')
WHERE m.name = 'audit_user_manuals'
ON CONFLICT DO NOTHING;