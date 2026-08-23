CREATE OR REPLACE FUNCTION public.fn_ce_unassigned_violation_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::bigint FROM public.ce_violations
   WHERE coalesce(is_deleted,false)=false
     AND assigned_queue_id IS NULL
     AND assigned_to_user_id IS NULL
     AND status NOT IN ('RESOLVED','CLOSED','CANCELLED');
$$;
REVOKE EXECUTE ON FUNCTION public.fn_ce_unassigned_violation_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ce_unassigned_violation_count() TO authenticated, service_role;