-- M1 defect fix: bn_mortality_check_actor_permission joined user_roles.role_id,
-- but public.user_roles stores the role *name* in `role`. With actions enabled
-- every command would have failed with a SQL error instead of a governed denial.
CREATE OR REPLACE FUNCTION public.bn_mortality_check_actor_permission(
  p_actor_user_id uuid,
  p_action_name text,
  p_is_mutation boolean
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module         public.app_modules%ROWTYPE;
  v_action_id      uuid;
  v_action_enabled boolean;
  v_has_grant      boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_module FROM public.app_modules WHERE name = 'bn_mortality';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MODULE_NOT_REGISTERED');
  END IF;
  IF NOT v_module.is_enabled THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MODULE_DISABLED');
  END IF;
  IF NOT COALESCE(v_module.routes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROUTES_DISABLED');
  END IF;
  IF p_is_mutation AND NOT COALESCE(v_module.actions_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTIONS_DISABLED');
  END IF;

  SELECT id, is_enabled INTO v_action_id, v_action_enabled
    FROM public.module_actions
   WHERE module_id = v_module.id AND action_name = p_action_name;
  IF v_action_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_UNREGISTERED');
  END IF;
  IF NOT COALESCE(v_action_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_DISABLED');
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.role_permissions rp
      JOIN public.roles r      ON r.id = rp.role_id
      JOIN public.user_roles ur ON ur.role = r.role_name
     WHERE ur.user_id = p_actor_user_id
       AND rp.action_id = v_action_id
       AND COALESCE(rp.is_granted, true) = true
       AND COALESCE(r.is_active, true) = true
  ) INTO v_has_grant;

  IF NOT v_has_grant THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CAPABILITY_DENIED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'PERMITTED',
    'module_id', v_module.id, 'action_id', v_action_id);
END;
$$;

REVOKE ALL ON FUNCTION public.bn_mortality_check_actor_permission(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_mortality_check_actor_permission(uuid,text,boolean) TO authenticated, service_role;