-- ── Capability modules required by governed plan-closeout / action / follow-up commands
UPDATE public.app_modules SET is_enabled = true, updated_at = now()
 WHERE name IN ('plan_closeout','action_tracking','follow_up_tracker');

-- ── DEF-S1B-29: target-year lineage for carried-forward audits
ALTER TABLE public.ia_plan_carry_forward
  ADD COLUMN IF NOT EXISTS target_plan_id uuid REFERENCES public.ia_annual_plans(id),
  ADD COLUMN IF NOT EXISTS target_engagement_id uuid REFERENCES public.ia_audit_engagements(id),
  ADD COLUMN IF NOT EXISTS accepted_by text,
  ADD COLUMN IF NOT EXISTS accepted_by_profile uuid,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS acceptance_notes text;

CREATE INDEX IF NOT EXISTS ix_ia_plan_carry_forward_target ON public.ia_plan_carry_forward(target_plan_id);
CREATE INDEX IF NOT EXISTS ix_ia_plan_carry_forward_source ON public.ia_plan_carry_forward(annual_plan_id);

-- ── Governed acceptance of a carry-forward into the target-year plan
CREATE OR REPLACE FUNCTION public.ia_plan_accept_carry_forward(
  p_carry_forward_id uuid,
  p_target_plan_id uuid,
  p_notes text DEFAULT NULL,
  p_quarter text DEFAULT 'Q1'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_actor text := public.ia_actor_label();
  v_cf record; v_src record; v_target record;
  v_seq int; v_code text; v_new_id uuid;
BEGIN
  IF NOT (public.ia_actor_can('plan_closeout','close') OR public.ia_actor_can('audit_plans','create')) THEN
    RETURN jsonb_build_object('success', false, 'code','IA_FORBIDDEN',
      'error','You do not have permission to accept carried-forward audits into a plan');
  END IF;

  SELECT * INTO v_cf FROM public.ia_plan_carry_forward WHERE id = p_carry_forward_id;
  IF v_cf.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_NOT_FOUND','error','Carry-forward record not found');
  END IF;
  IF v_cf.target_engagement_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_ALREADY_ACCEPTED',
      'error','This carry-forward has already been accepted into a plan',
      'target_engagement_id', v_cf.target_engagement_id);
  END IF;
  IF NULLIF(trim(COALESCE(v_cf.description,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_REASON_REQUIRED',
      'error','The carry-forward has no recorded reason and cannot be promoted');
  END IF;

  SELECT * INTO v_target FROM public.ia_annual_plans WHERE id = p_target_plan_id;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_NOT_FOUND','error','Target annual plan not found');
  END IF;
  IF v_target.status = 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'code','IA_PLAN_CLOSED','error','The target annual plan is closed');
  END IF;
  IF p_target_plan_id = v_cf.annual_plan_id THEN
    RETURN jsonb_build_object('success', false, 'code','IA_SAME_PLAN',
      'error','A carry-forward must be accepted into a later plan, not its source plan');
  END IF;

  SELECT * INTO v_src FROM public.ia_audit_engagements
   WHERE id = COALESCE(v_cf.original_engagement_id, v_cf.source_id);
  IF v_src.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_NOT_FOUND','error','Source audit not found for this carry-forward');
  END IF;

  SELECT COALESCE(count(*),0) + 1 INTO v_seq
    FROM public.ia_audit_engagements WHERE annual_plan_id = p_target_plan_id;
  v_code := 'ENG-' || regexp_replace(COALESCE(v_target.fiscal_year,'0000'),'[^0-9]','','g')
            || '-' || lpad(v_seq::text, 3, '0');
  IF length(v_code) > 16 THEN
    v_code := 'ENG-' || left(regexp_replace(COALESCE(v_target.fiscal_year,'0000'),'[^0-9]','','g'),4)
              || '-' || lpad(v_seq::text, 3, '0');
  END IF;

  INSERT INTO public.ia_audit_engagements (
    annual_plan_id, engagement_name, engagement_code, department_id, function_id,
    scope, objectives, methodology, engagement_risk_rating, estimated_hours, estimated_days,
    quarter, sequence_no, status, execution_status, engagement_type, is_active,
    inclusion_rationale, created_by, created_at, updated_by, updated_at)
  VALUES (
    p_target_plan_id, v_src.engagement_name, v_code, v_src.department_id, v_src.function_id,
    v_src.scope, v_src.objectives, v_src.methodology, v_src.engagement_risk_rating,
    v_src.estimated_hours, v_src.estimated_days,
    COALESCE(p_quarter,'Q1'), v_seq, 'Planned', 'Planned',
    COALESCE(v_src.engagement_type,'Assurance'), true,
    'Carried forward from ' || COALESCE(v_src.engagement_code, v_src.engagement_name)
      || ' (' || COALESCE(v_cf.description,'') || ')',
    v_actor, now(), v_actor, now())
  RETURNING id INTO v_new_id;

  UPDATE public.ia_plan_carry_forward
     SET target_plan_id = p_target_plan_id,
         target_engagement_id = v_new_id,
         target_fiscal_year = v_target.fiscal_year,
         status = 'Accepted',
         accepted_by = v_actor,
         accepted_by_profile = auth.uid(),
         accepted_at = now(),
         acceptance_notes = p_notes
   WHERE id = p_carry_forward_id;

  PERFORM public.ia_log_event('IA.PLAN.CARRY_FORWARD_ACCEPTED','carry_forward', p_carry_forward_id,
    v_new_id, p_target_plan_id,
    jsonb_build_object('source_plan_id', v_cf.annual_plan_id, 'source_engagement_id', v_src.id,
                       'source_engagement_code', v_src.engagement_code),
    jsonb_build_object('target_plan_id', p_target_plan_id, 'target_engagement_id', v_new_id,
                       'target_engagement_code', v_code, 'target_fiscal_year', v_target.fiscal_year),
    COALESCE(p_notes, v_cf.description), NULL, 'ia_plan_accept_carry_forward');

  RETURN jsonb_build_object('success', true, 'carry_forward_id', p_carry_forward_id,
    'target_plan_id', p_target_plan_id, 'target_engagement_id', v_new_id,
    'target_engagement_code', v_code, 'source_engagement_code', v_src.engagement_code,
    'source_plan_id', v_cf.annual_plan_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_plan_accept_carry_forward(uuid,uuid,text,text) TO authenticated;

-- ── DEF-S1B-30: annual plan closure must write immutable audit history
CREATE OR REPLACE FUNCTION public.ia_close_annual_plan(p_plan_id uuid, p_dispositions jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor text := public.ia_actor_label();
  v_plan_status text;
  v_fiscal_year text;
  v_item jsonb;
  v_eng record;
  v_disposition text;
  v_reason text;
  v_errors jsonb := '[]'::jsonb;
  v_planned int := 0;
  v_completed int := 0;
  v_actions_pending int := 0;
  v_carried int := 0;
  v_cancelled int := 0;
  v_gate jsonb;
BEGIN
  IF NOT public.ia_actor_can('plan_closeout','close') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to close annual plans');
  END IF;

  SELECT status, fiscal_year INTO v_plan_status, v_fiscal_year FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Annual plan not found');
  END IF;
  IF v_plan_status = 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Annual plan is already closed');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_dispositions,'[]'::jsonb))
  LOOP
    v_disposition := v_item->>'disposition';
    v_reason := NULLIF(trim(COALESCE(v_item->>'reason','')), '');

    SELECT * INTO v_eng FROM ia_audit_engagements
     WHERE id = (v_item->>'engagement_id')::uuid AND annual_plan_id = p_plan_id;

    IF v_eng.id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('engagement_id', v_item->>'engagement_id',
        'message','Audit does not belong to this plan');
      CONTINUE;
    END IF;

    IF COALESCE(v_eng.execution_status,'Planned') IN ('Closed','Closed – Actions Pending','Cancelled') THEN
      CONTINUE;
    END IF;

    IF v_disposition = 'Cancelled' THEN
      IF v_reason IS NULL THEN
        v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
          'message','Cancellation reason is required for ' || COALESCE(v_eng.engagement_code, v_eng.engagement_name));
        CONTINUE;
      END IF;
      UPDATE ia_audit_engagements SET execution_status = 'Cancelled', status = 'Cancelled',
             execution_notes = v_reason, updated_at = now(), updated_by = v_actor
       WHERE id = v_eng.id;
      INSERT INTO ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
      VALUES (v_eng.id, 'ENGAGEMENT_CANCELLED', v_reason, COALESCE(v_eng.execution_status,'Planned'), 'Cancelled', v_actor);
      PERFORM public.ia_log_event('IA.ENGAGEMENT.CANCELLED','engagement', v_eng.id, v_eng.id, p_plan_id,
        jsonb_build_object('execution_status', COALESCE(v_eng.execution_status,'Planned')),
        jsonb_build_object('execution_status','Cancelled'), v_reason, NULL, 'ia_close_annual_plan');

    ELSIF v_disposition = 'Carried Forward' THEN
      IF v_reason IS NULL THEN
        v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
          'message','Carry-forward reason is required for ' || COALESCE(v_eng.engagement_code, v_eng.engagement_name));
        CONTINUE;
      END IF;
      INSERT INTO ia_plan_carry_forward (annual_plan_id, source_type, source_id, source_reference,
        description, priority, status, carried_by, original_engagement_id, target_fiscal_year)
      VALUES (p_plan_id, 'ENGAGEMENT', v_eng.id, COALESCE(v_eng.engagement_code, v_eng.engagement_name),
        v_reason, COALESCE(v_eng.engagement_risk_rating,'Medium'), 'Open', v_actor, v_eng.id,
        NULLIF(v_item->>'target_fiscal_year',''));
      UPDATE ia_audit_engagements SET execution_status = 'Carried Forward', status = 'Carried Forward',
             execution_notes = v_reason, updated_at = now(), updated_by = v_actor
       WHERE id = v_eng.id;
      INSERT INTO ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
      VALUES (v_eng.id, 'ENGAGEMENT_CARRIED_FORWARD', v_reason, COALESCE(v_eng.execution_status,'Planned'), 'Carried Forward', v_actor);
      PERFORM public.ia_log_event('IA.ENGAGEMENT.CARRIED_FORWARD','engagement', v_eng.id, v_eng.id, p_plan_id,
        jsonb_build_object('execution_status', COALESCE(v_eng.execution_status,'Planned')),
        jsonb_build_object('execution_status','Carried Forward',
                           'target_fiscal_year', NULLIF(v_item->>'target_fiscal_year','')),
        v_reason, NULL, 'ia_close_annual_plan');

    ELSE
      v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
        'message','Unsupported disposition "' || COALESCE(v_disposition,'NULL') || '" — close the audit from its own workspace');
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Some dispositions could not be applied', 'issues', v_errors);
  END IF;

  FOR v_eng IN
    SELECT id, engagement_code, engagement_name, execution_status
      FROM ia_audit_engagements
     WHERE annual_plan_id = p_plan_id AND COALESCE(is_active, true)
  LOOP
    v_planned := v_planned + 1;
    IF COALESCE(v_eng.execution_status,'Planned') = 'Closed' THEN
      v_completed := v_completed + 1;
    ELSIF v_eng.execution_status = 'Closed – Actions Pending' THEN
      v_completed := v_completed + 1;
      v_actions_pending := v_actions_pending + 1;
    ELSIF v_eng.execution_status = 'Carried Forward' THEN
      v_carried := v_carried + 1;
    ELSIF v_eng.execution_status = 'Cancelled' THEN
      v_cancelled := v_cancelled + 1;
    ELSE
      v_errors := v_errors || jsonb_build_object('engagement_id', v_eng.id,
        'message', COALESCE(v_eng.engagement_code, v_eng.engagement_name) || ' has no disposition (current: '
                   || COALESCE(v_eng.execution_status,'Planned') || ')');
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Every audit in the plan needs a disposition before closure',
      'issues', v_errors);
  END IF;

  v_gate := jsonb_build_object(
    'fiscal_year', v_fiscal_year,
    'planned', v_planned,
    'completed', v_completed,
    'closed_actions_pending', v_actions_pending,
    'carried_forward', v_carried,
    'cancelled', v_cancelled,
    'pending', 0,
    'completion_rate', CASE WHEN v_planned = 0 THEN 0
                            ELSE round((v_completed::numeric / v_planned) * 100, 1) END,
    'closed_by', v_actor,
    'closed_at', now(),
    'notes', p_notes
  );

  PERFORM set_config('ia.governed_plan_write','on', true);

  UPDATE ia_annual_plans SET
    status = 'Closed',
    closed_by = v_actor,
    closed_date = now()::date,
    closure_summary = v_gate,
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_plan_id;

  PERFORM public.ia_log_event('IA.PLAN.CLOSED','annual_plan', p_plan_id, NULL, p_plan_id,
    jsonb_build_object('status', v_plan_status),
    v_gate || jsonb_build_object('status','Closed'),
    p_notes, NULL, 'ia_close_annual_plan');

  PERFORM set_config('ia.governed_plan_write','off', true);

  RETURN jsonb_build_object('success', true, 'summary', v_gate);
END;
$function$;

-- ── Governed reopen (the only sanctioned way out of a closed plan)
CREATE OR REPLACE FUNCTION public.ia_reopen_annual_plan(p_plan_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_actor text := public.ia_actor_label(); v_status text;
BEGIN
  IF NOT public.ia_actor_can('plan_closeout','close') THEN
    RETURN jsonb_build_object('success', false, 'code','IA_FORBIDDEN','error','You do not have permission to reopen annual plans');
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('success', false, 'code','IA_REASON_REQUIRED','error','A reopen reason is required');
  END IF;
  SELECT status INTO v_status FROM ia_annual_plans WHERE id = p_plan_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code','IA_NOT_FOUND','error','Annual plan not found');
  END IF;
  IF v_status <> 'Closed' THEN
    RETURN jsonb_build_object('success', false, 'code','IA_INVALID_STATE','error','Only a closed plan can be reopened');
  END IF;

  PERFORM set_config('ia.governed_plan_write','on', true);
  UPDATE ia_annual_plans SET status = 'Approved', updated_at = now(), updated_by = v_actor WHERE id = p_plan_id;
  PERFORM public.ia_log_event('IA.PLAN.REOPENED','annual_plan', p_plan_id, NULL, p_plan_id,
    jsonb_build_object('status','Closed'), jsonb_build_object('status','Approved'), p_reason, NULL, 'ia_reopen_annual_plan');
  PERFORM set_config('ia.governed_plan_write','off', true);

  RETURN jsonb_build_object('success', true, 'plan_id', p_plan_id, 'status','Approved');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_reopen_annual_plan(uuid,text) TO authenticated;

-- ── Closed-plan immutability
CREATE OR REPLACE FUNCTION public.ia_guard_closed_annual_plan()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('ia.governed_plan_write', true),'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Closed' THEN
      RAISE EXCEPTION 'IA_PLAN_CLOSED: annual plan % is closed and cannot be deleted', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'Closed' THEN
    RAISE EXCEPTION 'IA_PLAN_CLOSED: annual plan % is closed; use the governed reopen command', OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ia_guard_closed_annual_plan ON public.ia_annual_plans;
CREATE TRIGGER trg_ia_guard_closed_annual_plan
BEFORE UPDATE OR DELETE ON public.ia_annual_plans
FOR EACH ROW EXECUTE FUNCTION public.ia_guard_closed_annual_plan();

CREATE OR REPLACE FUNCTION public.ia_guard_closed_plan_engagement()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_plan uuid; v_status text;
BEGIN
  IF COALESCE(current_setting('ia.governed_plan_write', true),'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_plan := COALESCE(NEW.annual_plan_id, OLD.annual_plan_id);
  IF v_plan IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO v_status FROM public.ia_annual_plans WHERE id = v_plan;
  IF v_status = 'Closed' THEN
    RAISE EXCEPTION 'IA_PLAN_CLOSED: annual plan % is closed; its audits are historical and cannot be changed', v_plan;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_ia_guard_closed_plan_engagement ON public.ia_audit_engagements;
CREATE TRIGGER trg_ia_guard_closed_plan_engagement
BEFORE INSERT OR UPDATE OR DELETE ON public.ia_audit_engagements
FOR EACH ROW EXECUTE FUNCTION public.ia_guard_closed_plan_engagement();