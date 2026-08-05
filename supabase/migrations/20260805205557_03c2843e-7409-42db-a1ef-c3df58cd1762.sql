CREATE OR REPLACE FUNCTION public._bn_susp_resolve_policy_levels()
 RETURNS TABLE(level integer, policy_id uuid, approval_role text, approval_workbasket_id uuid, next_level_workbasket_id uuid, self_approval_allowed boolean, restricted_action boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_min   int;
BEGIN
  SELECT count(*), min(p.level) INTO v_count, v_min
    FROM public.bn_approval_policy p
   WHERE p.policy_area='award_suspension'
     AND p.action_code='approve'
     AND p.is_enabled=true;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'E_POLICY_NOT_CONFIGURED' USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bn_approval_policy p
     WHERE p.policy_area='award_suspension' AND p.action_code='approve' AND p.is_enabled=true
     GROUP BY p.level HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'E_POLICY_AMBIGUOUS' USING ERRCODE='P0001';
  END IF;

  IF v_min IS NULL OR v_min <> 1 THEN
    RAISE EXCEPTION 'E_POLICY_LEVEL_SEQUENCE_INVALID' USING ERRCODE='P0001';
  END IF;

  -- The OUT parameter `level` shadowed the CTE column, so this check raised
  -- an ambiguous-reference error the moment a policy existed. Fully
  -- qualifying the CTE columns keeps the sequence rule intact.
  IF EXISTS (
    WITH lv AS (
      SELECT p.level AS lvl, row_number() OVER (ORDER BY p.level) AS rn
        FROM public.bn_approval_policy p
       WHERE p.policy_area='award_suspension' AND p.action_code='approve' AND p.is_enabled=true
    )
    SELECT 1 FROM lv WHERE lv.lvl <> lv.rn
  ) THEN
    RAISE EXCEPTION 'E_POLICY_LEVEL_SEQUENCE_INVALID' USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bn_approval_policy p
     WHERE p.policy_area='award_suspension' AND p.action_code='approve' AND p.is_enabled=true
       AND (p.approval_workbasket_id IS NULL OR p.approval_role IS NULL)
  ) THEN
    RAISE EXCEPTION 'E_POLICY_ROUTING_INCOMPLETE' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
    SELECT p.level, p.id, p.approval_role,
           p.approval_workbasket_id, p.next_level_workbasket_id,
           coalesce(p.self_approval_allowed,false),
           coalesce(p.restricted_action,true)
      FROM public.bn_approval_policy p
     WHERE p.policy_area='award_suspension' AND p.action_code='approve' AND p.is_enabled=true
     ORDER BY p.level;
END
$function$;