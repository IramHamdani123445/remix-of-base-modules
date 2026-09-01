-- UAT-DEF-01 / UAT-DEF-03: entitle IA_AUDIT_ADMIN to maintain configuration & reference data
INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, m.id, ma.id, true
FROM public.roles r
CROSS JOIN public.app_modules m
JOIN public.module_actions ma ON ma.module_id = m.id
WHERE r.role_name = 'IA_AUDIT_ADMIN'
  AND (
        (m.name = 'audit_configuration'       AND ma.action_name IN ('view','configure'))
     OR (m.name = 'internal_audit_configuration' AND ma.action_name IN ('view'))
     OR (m.name = 'audit_department_master'   AND ma.action_name IN ('view','create','edit'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.module_id = m.id AND rp.action_id = ma.id
  );

UPDATE public.role_permissions rp
SET is_granted = true
FROM public.roles r, public.app_modules m, public.module_actions ma
WHERE rp.role_id = r.id AND rp.module_id = m.id AND rp.action_id = ma.id
  AND r.role_name = 'IA_AUDIT_ADMIN'
  AND (
        (m.name = 'audit_configuration'       AND ma.action_name IN ('view','configure'))
     OR (m.name = 'internal_audit_configuration' AND ma.action_name IN ('view'))
     OR (m.name = 'audit_department_master'   AND ma.action_name IN ('view','create','edit'))
  )
  AND rp.is_granted IS DISTINCT FROM true;