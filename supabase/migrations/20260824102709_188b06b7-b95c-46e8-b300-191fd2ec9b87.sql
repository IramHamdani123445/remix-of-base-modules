-- Explicit "approve" right for Benefits configuration governance
INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
SELECT m.id, 'approve', 'Approve', 'Approve, reject and publish benefit product rule versions', true
FROM public.app_modules m
WHERE m.name = 'bn_configuration'
  AND NOT EXISTS (
    SELECT 1 FROM public.module_actions ma
    WHERE ma.module_id = m.id AND ma.action_name = 'approve'
  );

INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, m.id, ma.id, true
FROM public.roles r
JOIN public.app_modules m ON m.name = 'bn_configuration'
JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = 'approve'
WHERE r.role_name IN ('Admin', 'BN_CONFIG_ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.module_id = m.id AND rp.action_id = ma.id
  );