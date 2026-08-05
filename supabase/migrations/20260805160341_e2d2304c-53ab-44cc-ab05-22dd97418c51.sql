-- BN-SUSP-ACT-1 — forward-only governance corrections for Award Suspension.
-- Does NOT change app_modules.actions_enabled (Test activation is script-guarded).

-- 1) Remove the ambiguous legacy reject overload (no p_reason_code).
DROP FUNCTION IF EXISTS public.bn_award_suspension_reject_v1(uuid, uuid, text, integer, text, text);

-- 2) Least-privilege operational grants for BN_MANAGER / BN_DIRECTOR.
INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, ma.module_id, ma.id, true
  FROM public.module_actions ma
  JOIN public.app_modules m ON m.id = ma.module_id AND m.name = 'bn_award_suspension'
  JOIN public.roles r ON r.role_name IN ('BN_MANAGER', 'BN_DIRECTOR')
 WHERE ma.action_name IN ('execute', 'resume_execute', 'view_payment_impact')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.action_id = ma.id
   );

-- Ensure any pre-existing rows for that matrix are actually granted.
UPDATE public.role_permissions rp
   SET is_granted = true
  FROM public.module_actions ma
  JOIN public.app_modules m ON m.id = ma.module_id AND m.name = 'bn_award_suspension'
  JOIN public.roles r ON r.role_name IN ('BN_MANAGER', 'BN_DIRECTOR')
 WHERE rp.action_id = ma.id
   AND rp.role_id = r.id
   AND ma.action_name IN ('execute', 'resume_execute', 'view_payment_impact')
   AND rp.is_granted = false;