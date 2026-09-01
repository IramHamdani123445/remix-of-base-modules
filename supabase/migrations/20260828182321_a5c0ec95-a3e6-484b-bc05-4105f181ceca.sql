CREATE OR REPLACE FUNCTION public.ia_evaluate_plan_closure(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_items jsonb;
  v_pending int;
BEGIN
  SELECT status INTO v_status FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('found', false, 'can_close', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'engagement_id', e.id,
           'engagement_code', e.engagement_code,
           'engagement_name', e.engagement_name,
           'execution_status', COALESCE(e.execution_status,'Planned'),
           'status', e.status,
           'disposition_required',
             COALESCE(e.execution_status,'Planned') NOT IN ('Closed','Closed – Actions Pending','Cancelled','Carried Forward'),
           'untouched', COALESCE(e.execution_status,'Planned') IN ('Planned','Ready for Launch')
         ) ORDER BY e.engagement_code), '[]'::jsonb)
    INTO v_items
    FROM ia_audit_engagements e
   WHERE e.annual_plan_id = p_plan_id AND COALESCE(e.is_active, true);

  SELECT count(*) INTO v_pending
    FROM jsonb_array_elements(v_items) x
   WHERE (x->>'disposition_required')::boolean;

  RETURN jsonb_build_object(
    'found', true,
    'plan_status', v_status,
    'already_closed', v_status = 'Closed',
    'can_close', v_status <> 'Closed' AND v_pending = 0,
    'pending_count', v_pending,
    'engagements', v_items
  );
END;
$function$;