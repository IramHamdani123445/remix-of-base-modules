-- BN Medical Reviews — Phase 1 UI enablement.
-- Forward-only, narrow correction: the registry migration seeded
-- core_permission_registry but not module_actions, so the permission-aware
-- frontend cannot resolve any Medical Review action for non-admin users.
-- This seeds the action catalogue ONLY. No role_permissions grants are made,
-- and actions_enabled remains false (dark launch).
INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
SELECT m.id,
       r.action_code,
       initcap(replace(r.action_code, '_', ' ')),
       r.description,
       true
FROM public.core_permission_registry r
JOIN public.app_modules m ON m.name = 'bn_medical_review'
WHERE r.module_code = 'bn_medical_review'
  AND NOT EXISTS (
    SELECT 1 FROM public.module_actions ma
    WHERE ma.module_id = m.id AND ma.action_name = r.action_code
  );

-- Re-assert the dark-launch posture (defensive; must remain false).
UPDATE public.app_modules
SET actions_enabled = false
WHERE name = 'bn_medical_review';