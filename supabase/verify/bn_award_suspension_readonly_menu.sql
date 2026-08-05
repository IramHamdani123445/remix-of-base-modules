-- BN-MENU-S1 — Verification queries. Read-only.

WITH root AS (SELECT id FROM public.app_modules WHERE name='benefits_management'),
     grp  AS (SELECT id FROM public.app_modules WHERE name='bn_servicing'),
     susp AS (SELECT id FROM public.app_modules WHERE name='bn_award_suspension')
SELECT 'bn_servicing_count' AS check_name, 1 AS expected,
       (SELECT COUNT(*) FROM public.app_modules WHERE name='bn_servicing') AS actual
UNION ALL SELECT 'bn_servicing_visible', 1,
       (SELECT COUNT(*) FROM public.app_modules
         WHERE name='bn_servicing' AND show_in_menu=true AND is_enabled=true)
UNION ALL SELECT 'bn_servicing_parent_is_bn_root', 1,
       (SELECT COUNT(*) FROM public.app_modules
         WHERE name='bn_servicing' AND parent_id=(SELECT id FROM root))
UNION ALL SELECT 'award_suspension_count', 1,
       (SELECT COUNT(*) FROM public.app_modules WHERE name='bn_award_suspension')
UNION ALL SELECT 'award_suspension_route', 1,
       (SELECT COUNT(*) FROM public.app_modules
         WHERE name='bn_award_suspension' AND route='/bn/award-suspension')
UNION ALL SELECT 'award_suspension_parent_is_servicing', 1,
       (SELECT COUNT(*) FROM public.app_modules
         WHERE name='bn_award_suspension' AND parent_id=(SELECT id FROM grp))
UNION ALL SELECT 'award_suspension_visible_enabled_routes', 1,
       (SELECT COUNT(*) FROM public.app_modules
         WHERE name='bn_award_suspension'
           AND show_in_menu=true AND is_enabled=true AND routes_enabled=true)
UNION ALL SELECT 'award_suspension_actions_disabled', 1,
       (SELECT COUNT(*) FROM public.app_modules
         WHERE name='bn_award_suspension' AND actions_enabled=false)
UNION ALL SELECT 'view_action_present_and_enabled', 1,
       (SELECT COUNT(*) FROM public.module_actions
         WHERE module_id=(SELECT id FROM susp)
           AND action_name='view' AND is_enabled=true)
UNION ALL SELECT 'roles_missing_view_inheritance', 0,
       (SELECT COUNT(*) FROM public.role_permissions rp_root
          JOIN public.module_actions ma
            ON ma.id=rp_root.action_id
           AND ma.module_id=(SELECT id FROM root)
           AND ma.action_name='view'
         WHERE rp_root.module_id=(SELECT id FROM root)
           AND rp_root.is_granted=true
           AND NOT EXISTS (
             SELECT 1 FROM public.role_permissions rp
              JOIN public.module_actions ma2 ON ma2.id=rp.action_id
             WHERE rp.role_id=rp_root.role_id
               AND rp.module_id=(SELECT id FROM susp)
               AND ma2.action_name='view'
               AND rp.is_granted=true
           ))
UNION ALL SELECT 'duplicate_award_suspension_routes', 0,
       (SELECT COUNT(*) FROM public.app_modules
         WHERE route='/bn/award-suspension') - 1;

-- Least-privilege guard: only the sanctioned matrix may hold operational grants.
WITH susp AS (SELECT id FROM public.app_modules WHERE name='bn_award_suspension')
SELECT 'unauthorized_operational_grants' AS check_name, 0 AS expected,
       COUNT(*) AS actual
  FROM public.role_permissions rp
  JOIN public.module_actions ma ON ma.id=rp.action_id
  JOIN public.roles r ON r.id=rp.role_id
 WHERE ma.module_id=(SELECT id FROM susp)
   AND rp.is_granted=true
   AND ma.action_name <> 'view'
   AND NOT (
     r.role_name='Admin'
     OR (r.role_name='BN_AUDITOR'        AND ma.action_name='audit')
     OR (r.role_name='BN_CLAIMS_OFFICER' AND ma.action_name IN ('propose','resume_propose'))
     OR (r.role_name='BN_SUPERVISOR'     AND ma.action_name IN ('propose','approve','resume_propose','resume_approve','audit'))
     OR (r.role_name IN ('BN_MANAGER','BN_DIRECTOR')
         AND ma.action_name IN ('propose','approve','resume_propose','resume_approve','reverse','audit'))
   );
