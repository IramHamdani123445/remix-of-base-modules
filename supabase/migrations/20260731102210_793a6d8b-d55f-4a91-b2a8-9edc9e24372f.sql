CREATE OR REPLACE FUNCTION public.fn_ce_route_violations_bulk(p_violation_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_ok integer := 0;
BEGIN
  IF p_violation_ids IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_id IN ARRAY p_violation_ids LOOP
    BEGIN
      PERFORM public.fn_ce_route_violation(v_id);
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      -- routing is best-effort; a single failure must not abort the batch
      NULL;
    END;
  END LOOP;

  RETURN v_ok;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ce_route_violations_bulk(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ce_route_violations_bulk(uuid[]) TO service_role;