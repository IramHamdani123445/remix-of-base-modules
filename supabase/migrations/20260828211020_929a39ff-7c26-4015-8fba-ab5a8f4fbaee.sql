-- ============================================================
-- DEF-S1B-45 / DEF-S1B-46 — governed engagement scheduling,
-- rescheduling, postponement and cancellation, each of which
-- transactionally owns its communication obligation.
-- ============================================================

ALTER TABLE public.ia_audit_engagements
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_by text,
  ADD COLUMN IF NOT EXISTS schedule_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intimation_issued_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ia_engagement_schedule_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.ia_audit_engagements(id) ON DELETE CASCADE,
  schedule_version integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('SCHEDULED','RESCHEDULED','POSTPONED','CANCELLED')),
  previous_start_date date,
  previous_end_date date,
  new_start_date date,
  new_end_date date,
  reason text,
  performed_by text,
  performed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ia_engagement_schedule_history TO authenticated;
GRANT ALL ON public.ia_engagement_schedule_history TO service_role;
ALTER TABLE public.ia_engagement_schedule_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_engagement_schedule_history_read ON public.ia_engagement_schedule_history;
CREATE POLICY ia_engagement_schedule_history_read
  ON public.ia_engagement_schedule_history FOR SELECT TO authenticated
  USING (public.ia_can_access_engagement(engagement_id));

DROP TRIGGER IF EXISTS ia_engagement_schedule_history_touch ON public.ia_engagement_schedule_history;
CREATE TRIGGER ia_engagement_schedule_history_touch
  BEFORE UPDATE ON public.ia_engagement_schedule_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS ia_engagement_schedule_history_eng_idx
  ON public.ia_engagement_schedule_history (engagement_id, schedule_version DESC);

-- ------------------------------------------------------------
-- Recipient resolution for the auditee side of an engagement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_comms_auditee_fact(p_engagement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eng record;
  v jsonb := '{}'::jsonb;
BEGIN
  SELECT e.*, d.head_profile_id, d.head AS dept_head_name
  INTO v_eng
  FROM public.ia_audit_engagements e
  LEFT JOIN public.ia_departments d ON d.id = e.department_id
  WHERE e.id = p_engagement_id;

  IF v_eng IS NULL THEN RETURN '{}'::jsonb; END IF;

  IF v_eng.primary_auditee_contact_id IS NOT NULL THEN
    v := coalesce(public.ia_comms_profile_fact('auditee_contact', v_eng.primary_auditee_contact_id, v_eng.auditee_contact), '{}'::jsonb);
  END IF;

  IF v = '{}'::jsonb AND v_eng.head_profile_id IS NOT NULL THEN
    v := coalesce(public.ia_comms_profile_fact('auditee_contact', v_eng.head_profile_id, v_eng.dept_head_name), '{}'::jsonb);
  END IF;

  RETURN coalesce(v, '{}'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_comms_auditee_fact(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Mandatory obligation helper: raises (rolling the business
-- transaction back) when a required obligation cannot be created.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_comms_emit_mandatory(
  p_event_code text,
  p_entity_type text,
  p_entity_id text,
  p_occurrence text,
  p_recipient_facts jsonb,
  p_payload jsonb,
  p_correlation_id text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  v := public.ia_comms_emit(p_event_code, p_entity_type, p_entity_id, p_occurrence,
                            p_recipient_facts, p_payload, p_correlation_id, p_department_id);

  IF coalesce(v->>'status','failed') NOT IN ('queued','accepted','duplicate','deduped','skipped_duplicate') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'IA_COMMS_OBLIGATION_NOT_CREATED',
      DETAIL  = coalesce(v::text, '{}'),
      HINT    = upper(btrim(p_event_code));
  END IF;

  RETURN v;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_comms_emit_mandatory(text,text,text,text,jsonb,jsonb,text,uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- ia_schedule_engagement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_schedule_engagement(
  p_engagement_id uuid,
  p_planned_start_date date,
  p_planned_end_date date,
  p_scope_summary text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_actor text := public.ia_actor_label();
  v_auditee jsonb;
  v_lead jsonb;
  v_dept_name text;
  v_scope text;
  v_version integer;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id AND is_active = true;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to schedule this engagement');
  END IF;

  IF coalesce(v_eng.execution_status, 'Planned') NOT IN ('Planned', 'Ready for Launch', 'Scheduled', 'Postponed') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_STATE',
      'error', 'Only a planned or postponed engagement can be scheduled (current: ' || coalesce(v_eng.execution_status,'NULL') || ')');
  END IF;

  IF p_planned_start_date IS NULL OR p_planned_end_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_DATES_REQUIRED',
      'error', 'Both a planned start date and a planned end date are required');
  END IF;
  IF p_planned_end_date < p_planned_start_date THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_DATE_RANGE_INVALID',
      'error', 'The planned end date cannot precede the planned start date');
  END IF;

  -- Command-retry dedupe: identical schedule on an already scheduled engagement
  IF coalesce(v_eng.execution_status,'') = 'Scheduled'
     AND v_eng.planned_start_date IS NOT DISTINCT FROM p_planned_start_date
     AND v_eng.planned_end_date IS NOT DISTINCT FROM p_planned_end_date THEN
    RETURN jsonb_build_object('success', true, 'code', 'IA_ALREADY_SCHEDULED', 'deduped', true,
      'schedule_version', v_eng.schedule_version,
      'message', 'Engagement is already scheduled for these dates; no further notice issued');
  END IF;

  v_auditee := public.ia_comms_auditee_fact(p_engagement_id);
  IF v_auditee = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'code', 'INTIMATION_RECIPIENT_REQUIRED',
      'error', 'No auditee contact or department head can be resolved; formal intimation cannot be issued');
  END IF;

  SELECT name INTO v_dept_name FROM public.ia_departments WHERE id = v_eng.department_id;
  v_scope := coalesce(nullif(btrim(coalesce(p_scope_summary, '')), ''), nullif(btrim(coalesce(v_eng.scope,'')),''), 'As set out in the approved annual audit plan');
  v_version := coalesce(v_eng.schedule_version, 0) + 1;

  UPDATE public.ia_audit_engagements SET
    planned_start_date = p_planned_start_date,
    planned_end_date   = p_planned_end_date,
    scope              = coalesce(nullif(btrim(coalesce(p_scope_summary,'')),''), scope),
    scheduling_notes   = coalesce(nullif(btrim(coalesce(p_notes,'')),''), scheduling_notes),
    execution_status   = 'Scheduled',
    scheduled_at       = now(),
    scheduled_by       = v_actor,
    schedule_version   = v_version,
    intimation_issued_at = now(),
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_schedule_history
    (engagement_id, schedule_version, operation, previous_start_date, previous_end_date,
     new_start_date, new_end_date, reason, performed_by)
  VALUES (p_engagement_id, v_version, 'SCHEDULED', v_eng.planned_start_date, v_eng.planned_end_date,
     p_planned_start_date, p_planned_end_date, p_notes, v_actor);

  INSERT INTO public.ia_engagement_execution_log
    (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_SCHEDULED', 'Engagement scheduled and auditee formally notified',
    coalesce(v_eng.execution_status,'Planned'), 'Scheduled', v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.SCHEDULED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('execution_status', coalesce(v_eng.execution_status,'Planned'),
                       'planned_start_date', v_eng.planned_start_date,
                       'planned_end_date', v_eng.planned_end_date),
    jsonb_build_object('execution_status', 'Scheduled',
                       'planned_start_date', p_planned_start_date,
                       'planned_end_date', p_planned_end_date,
                       'schedule_version', v_version),
    v_actor, NULL, 'ia_schedule_engagement');

  v_payload := jsonb_build_object(
    'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name', 'Auditee'),
    'reference', coalesce(v_eng.engagement_code, p_engagement_id::text),
    'engagementTitle', v_eng.engagement_name,
    'auditeeUnit', coalesce(v_dept_name, 'Audited department'),
    'scopeSummary', v_scope,
    'plannedStartDate', to_char(p_planned_start_date, 'DD Mon YYYY'),
    'plannedEndDate', to_char(p_planned_end_date, 'DD Mon YYYY'));

  -- MANDATORY_AUTOMATIC: formal auditee intimation. Failure rolls the schedule back.
  PERFORM public.ia_comms_emit_mandatory(
    'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED', 'ia_audit_engagement', p_engagement_id::text,
    'schedule:' || v_version, v_auditee, v_payload,
    'internal_audit:schedule:' || p_engagement_id::text || ':' || v_version,
    v_eng.department_id);

  -- Internal team awareness (non-blocking: informational).
  v_lead := public.ia_comms_escalation_fact('lead_auditor', v_eng.department_id, p_engagement_id);
  IF v_lead <> '{}'::jsonb THEN
    PERFORM public.ia_comms_emit(
      'INTERNAL_AUDIT.ENGAGEMENT.SCHEDULED', 'ia_audit_engagement', p_engagement_id::text,
      'schedule:' || v_version, v_lead,
      v_payload || jsonb_build_object('subjectName', coalesce(v_lead->'lead_auditor'->>'display_name','Lead auditor')),
      'internal_audit:schedule_notice:' || p_engagement_id::text || ':' || v_version,
      v_eng.department_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'code', 'IA_SCHEDULED',
    'schedule_version', v_version, 'new_execution_status', 'Scheduled',
    'message', 'Engagement scheduled and formal intimation issued to the auditee');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_schedule_engagement(uuid, date, date, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- ia_reschedule_engagement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_reschedule_engagement(
  p_engagement_id uuid,
  p_planned_start_date date,
  p_planned_end_date date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_actor text := public.ia_actor_label();
  v_auditee jsonb;
  v_dept_name text;
  v_version integer;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id AND is_active = true;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to reschedule this engagement');
  END IF;

  IF coalesce(v_eng.execution_status,'') NOT IN ('Scheduled','Postponed') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_STATE',
      'error', 'Only a scheduled or postponed engagement can be rescheduled (current: ' || coalesce(v_eng.execution_status,'NULL') || ')');
  END IF;

  IF coalesce(btrim(coalesce(p_reason,'')),'') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED',
      'error', 'A reason is required to reschedule a notified audit');
  END IF;

  IF p_planned_start_date IS NULL OR p_planned_end_date IS NULL OR p_planned_end_date < p_planned_start_date THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_DATE_RANGE_INVALID',
      'error', 'A valid new start and end date are required');
  END IF;

  IF v_eng.planned_start_date IS NOT DISTINCT FROM p_planned_start_date
     AND v_eng.planned_end_date IS NOT DISTINCT FROM p_planned_end_date
     AND coalesce(v_eng.execution_status,'') = 'Scheduled' THEN
    RETURN jsonb_build_object('success', true, 'code', 'IA_NO_DATE_CHANGE', 'deduped', true,
      'message', 'The audit dates are unchanged; no reschedule notice issued');
  END IF;

  v_auditee := public.ia_comms_auditee_fact(p_engagement_id);
  IF v_auditee = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'code', 'INTIMATION_RECIPIENT_REQUIRED',
      'error', 'No auditee recipient can be resolved for the reschedule notice');
  END IF;

  SELECT name INTO v_dept_name FROM public.ia_departments WHERE id = v_eng.department_id;
  v_version := coalesce(v_eng.schedule_version, 0) + 1;

  UPDATE public.ia_audit_engagements SET
    planned_start_date = p_planned_start_date,
    planned_end_date   = p_planned_end_date,
    execution_status   = 'Scheduled',
    schedule_version   = v_version,
    scheduled_at       = now(),
    scheduled_by       = v_actor,
    updated_at = now(), updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_schedule_history
    (engagement_id, schedule_version, operation, previous_start_date, previous_end_date,
     new_start_date, new_end_date, reason, performed_by)
  VALUES (p_engagement_id, v_version, 'RESCHEDULED', v_eng.planned_start_date, v_eng.planned_end_date,
     p_planned_start_date, p_planned_end_date, p_reason, v_actor);

  INSERT INTO public.ia_engagement_execution_log
    (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_RESCHEDULED', 'Audit rescheduled: ' || p_reason,
     coalesce(v_eng.execution_status,'Scheduled'), 'Scheduled', v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.RESCHEDULED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('planned_start_date', v_eng.planned_start_date, 'planned_end_date', v_eng.planned_end_date),
    jsonb_build_object('planned_start_date', p_planned_start_date, 'planned_end_date', p_planned_end_date,
                       'reason', p_reason, 'schedule_version', v_version),
    v_actor, NULL, 'ia_reschedule_engagement');

  PERFORM public.ia_comms_emit_mandatory(
    'INTERNAL_AUDIT.ENGAGEMENT.RESCHEDULED', 'ia_audit_engagement', p_engagement_id::text,
    'reschedule:' || v_version, v_auditee,
    jsonb_build_object(
      'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
      'reference', coalesce(v_eng.engagement_code, p_engagement_id::text),
      'engagementTitle', v_eng.engagement_name,
      'auditeeUnit', coalesce(v_dept_name,'Audited department'),
      'previousStartDate', coalesce(to_char(v_eng.planned_start_date,'DD Mon YYYY'), 'Not previously set'),
      'previousEndDate', coalesce(to_char(v_eng.planned_end_date,'DD Mon YYYY'), 'Not previously set'),
      'plannedStartDate', to_char(p_planned_start_date,'DD Mon YYYY'),
      'plannedEndDate', to_char(p_planned_end_date,'DD Mon YYYY'),
      'rescheduleReason', p_reason),
    'internal_audit:reschedule:' || p_engagement_id::text || ':' || v_version,
    v_eng.department_id);

  RETURN jsonb_build_object('success', true, 'code', 'IA_RESCHEDULED',
    'schedule_version', v_version, 'message', 'Audit rescheduled and the auditee notified');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_reschedule_engagement(uuid, date, date, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- ia_postpone_engagement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_postpone_engagement(
  p_engagement_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_actor text := public.ia_actor_label();
  v_auditee jsonb;
  v_dept_name text;
  v_version integer;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id AND is_active = true;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to postpone this engagement');
  END IF;

  IF coalesce(v_eng.execution_status,'') <> 'Scheduled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_STATE',
      'error', 'Only a scheduled engagement can be postponed (current: ' || coalesce(v_eng.execution_status,'NULL') || ')');
  END IF;

  IF coalesce(btrim(coalesce(p_reason,'')),'') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED',
      'error', 'A reason is required to postpone a notified audit');
  END IF;

  v_auditee := public.ia_comms_auditee_fact(p_engagement_id);
  IF v_auditee = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'code', 'INTIMATION_RECIPIENT_REQUIRED',
      'error', 'No auditee recipient can be resolved for the postponement notice');
  END IF;

  SELECT name INTO v_dept_name FROM public.ia_departments WHERE id = v_eng.department_id;
  v_version := coalesce(v_eng.schedule_version, 0) + 1;

  UPDATE public.ia_audit_engagements SET
    execution_status = 'Postponed', schedule_version = v_version,
    updated_at = now(), updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_schedule_history
    (engagement_id, schedule_version, operation, previous_start_date, previous_end_date, reason, performed_by)
  VALUES (p_engagement_id, v_version, 'POSTPONED', v_eng.planned_start_date, v_eng.planned_end_date, p_reason, v_actor);

  INSERT INTO public.ia_engagement_execution_log
    (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_POSTPONED', 'Audit postponed: ' || p_reason, 'Scheduled', 'Postponed', v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.POSTPONED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('execution_status','Scheduled'),
    jsonb_build_object('execution_status','Postponed','reason',p_reason),
    v_actor, NULL, 'ia_postpone_engagement');

  PERFORM public.ia_comms_emit_mandatory(
    'INTERNAL_AUDIT.ENGAGEMENT.POSTPONED', 'ia_audit_engagement', p_engagement_id::text,
    'postpone:' || v_version, v_auditee,
    jsonb_build_object(
      'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
      'reference', coalesce(v_eng.engagement_code, p_engagement_id::text),
      'engagementTitle', v_eng.engagement_name,
      'auditeeUnit', coalesce(v_dept_name,'Audited department'),
      'previousStartDate', coalesce(to_char(v_eng.planned_start_date,'DD Mon YYYY'),'Not previously set'),
      'previousEndDate', coalesce(to_char(v_eng.planned_end_date,'DD Mon YYYY'),'Not previously set'),
      'postponementReason', p_reason,
      'postponedOn', to_char(now(),'DD Mon YYYY')),
    'internal_audit:postpone:' || p_engagement_id::text || ':' || v_version,
    v_eng.department_id);

  RETURN jsonb_build_object('success', true, 'code', 'IA_POSTPONED',
    'message', 'Audit postponed and the auditee notified');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_postpone_engagement(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- ia_cancel_engagement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_cancel_engagement(
  p_engagement_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_actor text := public.ia_actor_label();
  v_auditee jsonb;
  v_dept_name text;
  v_version integer;
  v_notified boolean;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id AND is_active = true;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'delete', p_engagement_id)
     AND NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to cancel this engagement');
  END IF;

  IF coalesce(v_eng.execution_status,'') IN ('Cancelled','Closed','Closed – Actions Pending') THEN
    RETURN jsonb_build_object('success', true, 'code', 'IA_ALREADY_TERMINAL', 'deduped', true,
      'message', 'Engagement is already in a terminal state');
  END IF;

  IF coalesce(btrim(coalesce(p_reason,'')),'') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED',
      'error', 'A reason is required to cancel an audit');
  END IF;

  v_notified := v_eng.intimation_issued_at IS NOT NULL;
  v_version := coalesce(v_eng.schedule_version, 0) + 1;

  IF v_notified THEN
    v_auditee := public.ia_comms_auditee_fact(p_engagement_id);
    IF v_auditee = '{}'::jsonb THEN
      RETURN jsonb_build_object('success', false, 'code', 'INTIMATION_RECIPIENT_REQUIRED',
        'error', 'The auditee was formally notified but no recipient can be resolved for the cancellation notice');
    END IF;
  END IF;

  SELECT name INTO v_dept_name FROM public.ia_departments WHERE id = v_eng.department_id;

  UPDATE public.ia_audit_engagements SET
    execution_status = 'Cancelled', schedule_version = v_version,
    updated_at = now(), updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_schedule_history
    (engagement_id, schedule_version, operation, previous_start_date, previous_end_date, reason, performed_by)
  VALUES (p_engagement_id, v_version, 'CANCELLED', v_eng.planned_start_date, v_eng.planned_end_date, p_reason, v_actor);

  INSERT INTO public.ia_engagement_execution_log
    (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_CANCELLED', 'Audit cancelled: ' || p_reason,
    coalesce(v_eng.execution_status,'Planned'), 'Cancelled', v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.CANCELLED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('execution_status', coalesce(v_eng.execution_status,'Planned')),
    jsonb_build_object('execution_status','Cancelled','reason',p_reason,'previously_notified',v_notified),
    v_actor, NULL, 'ia_cancel_engagement');

  IF v_notified THEN
    PERFORM public.ia_comms_emit_mandatory(
      'INTERNAL_AUDIT.ENGAGEMENT.CANCELLED', 'ia_audit_engagement', p_engagement_id::text,
      'cancel:' || v_version, v_auditee,
      jsonb_build_object(
        'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
        'reference', coalesce(v_eng.engagement_code, p_engagement_id::text),
        'engagementTitle', v_eng.engagement_name,
        'auditeeUnit', coalesce(v_dept_name,'Audited department'),
        'cancelledOn', to_char(now(),'DD Mon YYYY'),
        'cancellationReason', p_reason),
      'internal_audit:cancel:' || p_engagement_id::text || ':' || v_version,
      v_eng.department_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'code', 'IA_CANCELLED',
    'auditee_notified', v_notified,
    'message', CASE WHEN v_notified THEN 'Audit cancelled and the notified auditee informed'
                    ELSE 'Audit cancelled (no formal intimation had been issued)' END);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_cancel_engagement(uuid, text) TO authenticated, service_role;

-- Launch may now follow a scheduled engagement, and owns its own communication.
CREATE OR REPLACE FUNCTION public.ia_launch_engagement(p_engagement_id uuid, p_launched_by text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng record;
  v_plan_status text;
  v_actor text := public.ia_actor_label();
  v_errors text[] := '{}';
  v_auditee jsonb;
  v_dept_name text;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id AND is_active = true;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to launch this engagement');
  END IF;

  IF COALESCE(v_eng.execution_status, 'Planned') NOT IN ('Planned', 'Ready for Launch', 'Scheduled') THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_ALREADY_LAUNCHED',
      'error', 'Engagement already launched (current: ' || COALESCE(v_eng.execution_status, 'NULL') || ')');
  END IF;

  IF v_eng.annual_plan_id IS NOT NULL THEN
    SELECT status INTO v_plan_status FROM public.ia_annual_plans WHERE id = v_eng.annual_plan_id;
    IF v_plan_status IS NULL OR v_plan_status <> 'Approved' THEN
      v_errors := array_append(v_errors, 'Parent plan not approved (status: ' || COALESCE(v_plan_status, 'N/A') || ')');
    END IF;
    IF v_eng.approved_plan_version IS NULL THEN
      v_errors := array_append(v_errors, 'Engagement is not stamped with an approved plan version');
    END IF;
  END IF;

  IF COALESCE(v_eng.engagement_name, '') = '' THEN v_errors := array_append(v_errors, 'Title missing'); END IF;
  IF v_eng.department_id IS NULL THEN v_errors := array_append(v_errors, 'Department not assigned'); END IF;
  IF v_eng.function_id IS NULL THEN v_errors := array_append(v_errors, 'Function not assigned'); END IF;
  IF v_eng.lead_auditor_id IS NULL THEN v_errors := array_append(v_errors, 'Lead auditor not assigned'); END IF;
  IF v_eng.planned_start_date IS NULL OR v_eng.planned_end_date IS NULL THEN v_errors := array_append(v_errors, 'Planned dates missing'); END IF;
  IF COALESCE(v_eng.objectives, '') = '' THEN v_errors := array_append(v_errors, 'Objectives missing'); END IF;
  IF COALESCE(v_eng.scope, '') = '' THEN v_errors := array_append(v_errors, 'Scope missing'); END IF;
  IF v_eng.primary_auditee_contact_id IS NULL AND COALESCE(v_eng.auditee_contact, '') = '' THEN
    v_errors := array_append(v_errors, 'Auditee contact missing');
  END IF;
  IF v_eng.reviewer_id IS NOT NULL AND v_eng.reviewer_id = v_eng.lead_auditor_id THEN
    v_errors := array_append(v_errors, 'Independent reviewer must differ from the lead auditor');
  END IF;

  IF array_length(v_errors, 1) > 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_READY', 'errors', to_jsonb(v_errors),
      'error', 'Launch readiness failed: ' || array_to_string(v_errors, '; '));
  END IF;

  UPDATE public.ia_audit_engagements SET
    execution_status = 'Notification Sent',
    status = CASE WHEN status IN ('Planned', 'Approved') THEN 'In Progress' ELSE status END,
    preparation_status = CASE WHEN COALESCE(preparation_status, 'Not Started') = 'Not Started' THEN 'In Progress' ELSE preparation_status END,
    launched_at = now(),
    launched_by = v_actor,
    actual_start_date = COALESCE(actual_start_date, now()::date),
    updated_at = now(),
    updated_by = v_actor
  WHERE id = p_engagement_id;

  INSERT INTO public.ia_engagement_execution_log (engagement_id, event_type, event_description, old_status, new_status, performed_by)
  VALUES (p_engagement_id, 'ENGAGEMENT_LAUNCHED', 'Engagement launched for execution',
    COALESCE(v_eng.execution_status, 'Planned'), 'Notification Sent', v_actor);

  PERFORM public.ia_log_event('IA.ENGAGEMENT.LAUNCHED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id,
    jsonb_build_object('execution_status', COALESCE(v_eng.execution_status, 'Planned'), 'status', v_eng.status,
                       'preparation_status', v_eng.preparation_status),
    jsonb_build_object('execution_status', 'Notification Sent', 'status', 'In Progress',
                       'preparation_status', 'In Progress', 'approved_plan_version', v_eng.approved_plan_version),
    p_launched_by, NULL, 'ia_launch_engagement');

  -- DEF-S1B-48: the launch command now owns the launch communication.
  v_auditee := public.ia_comms_auditee_fact(p_engagement_id);
  SELECT name INTO v_dept_name FROM public.ia_departments WHERE id = v_eng.department_id;
  IF v_auditee <> '{}'::jsonb THEN
    PERFORM public.ia_comms_emit_mandatory(
      'INTERNAL_AUDIT.ENGAGEMENT.LAUNCHED', 'ia_audit_engagement', p_engagement_id::text, 'default',
      v_auditee,
      jsonb_build_object(
        'subjectName', coalesce(v_auditee->'auditee_contact'->>'display_name','Auditee'),
        'reference', coalesce(v_eng.engagement_code, p_engagement_id::text),
        'engagementTitle', v_eng.engagement_name,
        'auditeeUnit', coalesce(v_dept_name,'Audited department'),
        'launchedOn', to_char(now(),'DD Mon YYYY'),
        'plannedEndDate', coalesce(to_char(v_eng.planned_end_date,'DD Mon YYYY'),'Not stated')),
      'internal_audit:launch:' || p_engagement_id::text,
      v_eng.department_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Engagement launched successfully',
    'new_execution_status', 'Notification Sent', 'launched_by', v_actor);
END;
$function$;