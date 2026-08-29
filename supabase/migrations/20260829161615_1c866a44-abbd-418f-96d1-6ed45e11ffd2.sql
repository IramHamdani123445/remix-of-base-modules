CREATE OR REPLACE FUNCTION public.ce_evaluate_stage_eligibility_v1(p_violation_id uuid, p_stage_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage record;
  v_viol record;
  v_basis timestamptz;
  v_prereq record;
  v_due date;
BEGIN
  SELECT * INTO v_stage FROM public.ce_escalation_stage_config WHERE stage_code = p_stage_code;
  IF v_stage IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'status','configuration_error',
      'reasons', ARRAY['Unknown escalation stage: '||p_stage_code]);
  END IF;
  IF NOT v_stage.is_enabled THEN
    RETURN jsonb_build_object('eligible', false, 'status','stage_disabled',
      'reasons', ARRAY[v_stage.stage_name||' is not part of the active escalation sequence.']);
  END IF;

  SELECT id, employer_id, created_at, status, resolved_at INTO v_viol
    FROM public.ce_violations WHERE id = p_violation_id;
  IF v_viol IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'status','not_found',
      'reasons', ARRAY['Violation not found']);
  END IF;

  -- Settlement / closure stops future escalation. History is untouched.
  IF upper(COALESCE(v_viol.status,'')) IN
     ('RESOLVED','CLOSED','SETTLED','WAIVED','CANCELLED','WRITTEN_OFF','WRITTEN OFF')
     OR v_viol.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('eligible', false, 'status','resolved',
      'stage_code', v_stage.stage_code, 'stage_order', v_stage.stage_order,
      'reasons', ARRAY['Violation is '||COALESCE(v_viol.status,'resolved')||
                       ' — no further escalation is generated.']);
  END IF;

  IF v_stage.delay_days IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'status','configuration_error',
      'open_decision', v_stage.open_decision_code,
      'reasons', ARRAY['No waiting period configured for '||v_stage.stage_name||
                       '. Configure it in Escalation Stage Configuration before notices can be issued.']);
  END IF;

  IF v_stage.prerequisite_stage_code IS NOT NULL THEN
    SELECT id, COALESCE(effective_date, sent_at::date, created_at::date) AS eff
      INTO v_prereq
      FROM public.ce_notices
     WHERE violation_id = p_violation_id
       AND stage_code = v_stage.prerequisite_stage_code
       AND COALESCE(status,'') <> 'CANCELLED'
     ORDER BY COALESCE(effective_date, sent_at::date, created_at::date) DESC
     LIMIT 1;
    IF v_prereq IS NULL THEN
      RETURN jsonb_build_object('eligible', false, 'status','prerequisite_missing',
        'reasons', ARRAY[v_stage.prerequisite_stage_code||' stage has not been completed for this violation.']);
    END IF;
    v_basis := v_prereq.eff::timestamptz;
  ELSE
    v_basis := v_viol.created_at;
  END IF;

  v_due := (v_basis + make_interval(days => v_stage.delay_days))::date;

  RETURN jsonb_build_object(
    'eligible', CURRENT_DATE >= v_due,
    'status', CASE WHEN CURRENT_DATE >= v_due THEN 'eligible' ELSE 'waiting' END,
    'stage_code', v_stage.stage_code,
    'stage_order', v_stage.stage_order,
    'requires_approval', v_stage.requires_approval,
    'basis_date', v_basis::date,
    'delay_days', v_stage.delay_days,
    'delay_basis', v_stage.delay_basis,
    'eligible_from', v_due,
    'stage_snapshot', to_jsonb(v_stage),
    'reasons', CASE WHEN CURRENT_DATE >= v_due THEN '{}'::text[]
                    ELSE ARRAY[v_stage.stage_name||' eligible from '||v_due::text] END
  );
END;
$function$;