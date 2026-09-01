
-- Drift detection: active workbasket roles lacking queue/worklist view access
CREATE OR REPLACE FUNCTION public.bn_workbasket_permission_gaps()
RETURNS TABLE (
  assigned_role text,
  basket_code text,
  basket_name text,
  missing_module text,
  role_exists boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH targets(module_name) AS (
    VALUES ('bn_claim_queue'), ('bn_claim_worklist')
  ),
  baskets AS (
    SELECT DISTINCT w.assigned_role, w.basket_code, w.basket_name
    FROM public.bn_workbasket w
    WHERE w.is_active AND w.assigned_role IS NOT NULL AND btrim(w.assigned_role) <> ''
  )
  SELECT b.assigned_role,
         b.basket_code,
         b.basket_name,
         t.module_name,
         (r.id IS NOT NULL) AS role_exists
  FROM baskets b
  CROSS JOIN targets t
  LEFT JOIN public.roles r ON r.role_name = b.assigned_role
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.app_modules m ON m.id = rp.module_id
    JOIN public.module_actions ma ON ma.id = rp.action_id
    WHERE rp.role_id = r.id
      AND m.name = t.module_name
      AND ma.action_name = 'view'
      AND rp.is_granted
  )
  ORDER BY 1, 4, 2;
$$;

REVOKE ALL ON FUNCTION public.bn_workbasket_permission_gaps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bn_workbasket_permission_gaps() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_workbasket_permission_gaps() TO service_role;

-- Reconciliation: derive grants from active workbasket assigned roles
CREATE OR REPLACE FUNCTION public.bn_sync_workbasket_queue_permissions()
RETURNS TABLE (granted_role text, granted_module text, granted_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can reconcile workbasket queue permissions'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH targets(module_name) AS (
    VALUES ('bn_claim_queue'), ('bn_claim_worklist')
  ),
  wanted AS (
    SELECT DISTINCT r.id AS role_id, r.role_name, m.id AS module_id, m.name AS module_name, ma.id AS action_id
    FROM public.bn_workbasket w
    JOIN public.roles r ON r.role_name = w.assigned_role
    CROSS JOIN targets t
    JOIN public.app_modules m ON m.name = t.module_name
    JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = 'view'
    WHERE w.is_active AND w.assigned_role IS NOT NULL AND btrim(w.assigned_role) <> ''
  ),
  ins AS (
    INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
    SELECT wnt.role_id, wnt.module_id, wnt.action_id, true
    FROM wanted wnt
    ON CONFLICT (role_id, module_id, action_id) DO NOTHING
    RETURNING role_id, module_id, action_id
  )
  SELECT r.role_name, m.name, 'view'::text
  FROM ins
  JOIN public.roles r ON r.id = ins.role_id
  JOIN public.app_modules m ON m.id = ins.module_id
  ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.bn_sync_workbasket_queue_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bn_sync_workbasket_queue_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_sync_workbasket_queue_permissions() TO service_role;

-- Close today's gap
SELECT public.bn_sync_workbasket_queue_permissions();
