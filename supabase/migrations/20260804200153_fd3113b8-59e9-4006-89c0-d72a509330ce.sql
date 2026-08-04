CREATE OR REPLACE FUNCTION public.bn_life_certificate_award_list_v1(p_award_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid; v_limit integer := LEAST(GREATEST(COALESCE(p_limit,200),1),500); v_rows jsonb;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  IF p_award_id IS NULL THEN RAISE EXCEPTION 'E_AWARD_REQUIRED' USING ERRCODE='P0001'; END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date DESC NULLS LAST), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT lc.id,
           COALESCE(lc.obligation_period, lc.required_for_period) AS required_for_period,
           lc.due_date, lc.submitted_date, lc.verified_date,
           lc.verification_method,
           COALESCE(lc.obligation_status, lc.status) AS status,
           lc.remarks
      FROM public.bn_life_certificate lc
     WHERE lc.bn_award_id = p_award_id
       AND public._bn_lc_can_access(v_actor, lc.id)
     ORDER BY lc.due_date DESC NULLS LAST
     LIMIT v_limit
  ) t;

  RETURN COALESCE(v_rows,'[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.bn_life_certificate_award_list_v1(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_award_list_v1(uuid, integer) TO authenticated, service_role;