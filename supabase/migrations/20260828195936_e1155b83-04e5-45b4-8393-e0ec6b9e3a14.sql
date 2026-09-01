CREATE OR REPLACE FUNCTION public.ia_comms_generate_reminders(p_today date DEFAULT CURRENT_DATE, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_pol public.ia_comms_reminder_policy;
  v_row record;
  v_role text;
  v_roles text[];
  v_out text;
  v_emitted integer := 0;
  v_dedup integer := 0;
  v_blocked integer := 0;
  v_unresolved integer := 0;
  v_conflict integer := 0;
  v_errors integer := 0;
  v_outcome text;
BEGIN
  -- Corrective actions
  FOR v_pol IN
    SELECT * FROM public.ia_comms_reminder_policy
    WHERE is_active AND obligation_kind = 'action'
  LOOP
    FOR v_row IN
      SELECT a.id, a.action_ref, a.action_description,
             coalesce(a.current_target_date, a.target_date)::date AS due_date,
             coalesce(a.accountable_department_id, a.department_id) AS dept_id,
             a.engagement_id
      FROM public.ia_action_tracking a
      WHERE coalesce(a.current_target_date, a.target_date) IS NOT NULL
        AND coalesce(a.lifecycle_status, a.status, '') NOT IN
            ('Closed','Cancelled','Verified','Completed','Superseded')
        AND (coalesce(a.current_target_date, a.target_date)::date - p_today)
            = v_pol.days_relative_to_due
      LIMIT p_limit
    LOOP
      BEGIN
        v_roles := ARRAY['action_owner']::text[] || coalesce(v_pol.escalation_roles, '{}'::text[]);
        FOREACH v_role IN ARRAY v_roles LOOP
          v_out := public.ia_comms_emit_role(
            v_run_id, v_pol, 'action', 'ia_action_tracking', v_row.id::text,
            v_role, v_row.dept_id, v_row.engagement_id, v_row.id,
            jsonb_build_object(
              'reference', coalesce(v_row.action_ref, v_row.id::text),
              'subjectName', 'Action owner',
              'ownerName', 'Action owner',
              'actionTitle', left(coalesce(nullif(btrim(v_row.action_description),''), 'Corrective action'), 200),
              'actionSummary', left(coalesce(v_row.action_description,''), 400),
              'targetDate', to_char(v_row.due_date, 'YYYY-MM-DD'),
              'dueDate', to_char(v_row.due_date, 'YYYY-MM-DD'),
              'daysRemaining', greatest(0, v_row.due_date - p_today)::text,
              'daysOverdue', greatest(0, p_today - v_row.due_date)::text),
            p_today);
          v_emitted := v_emitted + (v_out = 'emitted')::int;
          v_dedup := v_dedup + (v_out = 'deduplicated')::int;
          v_blocked := v_blocked + (v_out = 'blocked')::int;
          v_unresolved := v_unresolved + (v_out = 'unresolved')::int;
          v_conflict := v_conflict + (v_out = 'conflict')::int;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
        INSERT INTO public.ia_comms_reminder_run_log
          (run_id, policy_id, obligation_kind, event_code, entity_type, entity_id,
           occurrence, outcome, reason)
        VALUES (v_run_id, v_pol.id, 'action', v_pol.event_code, 'ia_action_tracking',
                v_row.id::text, v_pol.occurrence_key, 'error', SQLERRM);
      END;
    END LOOP;
  END LOOP;

  -- Outstanding management responses
  FOR v_pol IN
    SELECT * FROM public.ia_comms_reminder_policy
    WHERE is_active AND obligation_kind = 'management_response'
  LOOP
    FOR v_row IN
      SELECT r.id, r.finding_id, r.engagement_id,
             coalesce(r.official_target_date, r.due_date, r.target_date)::date AS due_date,
             CASE WHEN r.responsible_person ~* '^[0-9a-f-]{36}$'
                  THEN r.responsible_person::uuid END AS responsible_profile_id,
             f.title AS finding_title, f.severity AS finding_severity, f.department_id
      FROM public.ia_management_responses r
      LEFT JOIN public.ia_findings f ON f.id = r.finding_id
      WHERE r.submitted_date IS NULL
        AND coalesce(r.official_target_date, r.due_date, r.target_date) IS NOT NULL
        AND coalesce(r.status,'') NOT IN ('Submitted','Accepted','Closed','Withdrawn')
        AND (coalesce(r.official_target_date, r.due_date, r.target_date)::date - p_today)
            = v_pol.days_relative_to_due
      LIMIT p_limit
    LOOP
      BEGIN
        IF v_row.responsible_profile_id IS NOT NULL THEN
          DECLARE v_emit jsonb; v_occ text;
          BEGIN
            v_occ := v_pol.occurrence_key || ':auditee_contact';
            v_emit := public.ia_comms_emit(
              v_pol.event_code, 'ia_management_response', v_row.id::text, v_occ,
              public.ia_comms_profile_fact('auditee_contact', v_row.responsible_profile_id, 'Management respondent'),
              jsonb_build_object(
                'reference', v_row.id::text,
                'subjectName', 'Management respondent',
                'findingTitle', coalesce(nullif(btrim(v_row.finding_title),''),'Audit finding'),
                'severity', coalesce(nullif(btrim(v_row.finding_severity),''),'Not stated'),
                'dueDate', to_char(v_row.due_date,'YYYY-MM-DD'),
                'responseDueDate', to_char(v_row.due_date,'YYYY-MM-DD'),
                'daysOverdue', greatest(0, p_today - v_row.due_date)::text,
                'reminderWindow', v_pol.label),
              'ia-reminder:' || v_row.id::text || ':' || v_occ);
            v_out := CASE
              WHEN coalesce((v_emit->>'deduplicated')::boolean,false) THEN 'deduplicated'
              WHEN v_emit->>'status' IN ('failed','blocked') THEN 'blocked'
              ELSE 'emitted' END;
            INSERT INTO public.ia_comms_reminder_run_log
              (run_id, policy_id, obligation_kind, event_code, entity_type, entity_id,
               occurrence, required_role, resolution_source, department_id, engagement_id,
               recipient_profile_id, outcome, reason, event_outbox_id)
            VALUES (v_run_id, v_pol.id, 'management_response', v_pol.event_code,
                    'ia_management_response', v_row.id::text, v_occ,
                    'MANAGEMENT_RESPONDENT', 'ia_management_responses.responsible_person',
                    v_row.department_id, v_row.engagement_id, v_row.responsible_profile_id,
                    v_out, v_emit->>'reason', nullif(v_emit->>'event_outbox_id','')::uuid);
          END;
        ELSE
          v_out := 'unresolved';
          INSERT INTO public.ia_comms_reminder_run_log
            (run_id, policy_id, obligation_kind, event_code, entity_type, entity_id,
             occurrence, required_role, resolution_source, department_id, engagement_id,
             outcome, reason)
          VALUES (v_run_id, v_pol.id, 'management_response', v_pol.event_code,
                  'ia_management_response', v_row.id::text,
                  v_pol.occurrence_key || ':auditee_contact', 'MANAGEMENT_RESPONDENT',
                  'ia_management_responses.responsible_person',
                  v_row.department_id, v_row.engagement_id,
                  'escalation_role_unresolved', 'UNRESOLVED:RESPONDENT_NOT_PROFILE_LINKED');
        END IF;
        v_emitted := v_emitted + (v_out = 'emitted')::int;
        v_dedup := v_dedup + (v_out = 'deduplicated')::int;
        v_blocked := v_blocked + (v_out = 'blocked')::int;
        v_unresolved := v_unresolved + (v_out = 'unresolved')::int;

        FOREACH v_role IN ARRAY coalesce(v_pol.escalation_roles, '{}'::text[]) LOOP
          v_out := public.ia_comms_emit_role(
            v_run_id, v_pol, 'management_response', 'ia_management_response', v_row.id::text,
            v_role, v_row.department_id, v_row.engagement_id, NULL,
            jsonb_build_object(
              'reference', v_row.id::text,
              'subjectName', 'Management respondent',
              'findingTitle', coalesce(nullif(btrim(v_row.finding_title),''),'Audit finding'),
              'severity', coalesce(nullif(btrim(v_row.finding_severity),''),'Not stated'),
              'dueDate', to_char(v_row.due_date,'YYYY-MM-DD'),
              'responseDueDate', to_char(v_row.due_date,'YYYY-MM-DD'),
              'daysOverdue', greatest(0, p_today - v_row.due_date)::text),
            p_today);
          v_emitted := v_emitted + (v_out = 'emitted')::int;
          v_dedup := v_dedup + (v_out = 'deduplicated')::int;
          v_blocked := v_blocked + (v_out = 'blocked')::int;
          v_unresolved := v_unresolved + (v_out = 'unresolved')::int;
          v_conflict := v_conflict + (v_out = 'conflict')::int;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
        INSERT INTO public.ia_comms_reminder_run_log
          (run_id, policy_id, obligation_kind, event_code, entity_type, entity_id,
           occurrence, outcome, reason)
        VALUES (v_run_id, v_pol.id, 'management_response', v_pol.event_code,
                'ia_management_response', v_row.id::text, v_pol.occurrence_key, 'error', SQLERRM);
      END;
    END LOOP;
  END LOOP;

  -- Follow-up obligations
  FOR v_pol IN
    SELECT * FROM public.ia_comms_reminder_policy
    WHERE is_active AND obligation_kind = 'follow_up'
  LOOP
    FOR v_row IN
      SELECT fu.id, fu.engagement_id, fu.department_id, fu.action_id,
             coalesce(fu.scheduled_follow_up_date, fu.due_date)::date AS due_date,
             e.engagement_name
      FROM public.ia_follow_ups fu
      LEFT JOIN public.ia_audit_engagements e ON e.id = fu.engagement_id
      WHERE coalesce(fu.scheduled_follow_up_date, fu.due_date) IS NOT NULL
        AND coalesce(fu.outcome,'') <> 'Implemented'
        AND coalesce(fu.lifecycle_status, fu.status, '') NOT IN ('Closed','Cancelled','Implemented')
        AND (coalesce(fu.scheduled_follow_up_date, fu.due_date)::date - p_today)
            = v_pol.days_relative_to_due
      LIMIT p_limit
    LOOP
      BEGIN
        v_roles := ARRAY['action_owner']::text[] || coalesce(v_pol.escalation_roles, '{}'::text[]);
        FOREACH v_role IN ARRAY v_roles LOOP
          v_out := public.ia_comms_emit_role(
            v_run_id, v_pol, 'follow_up', 'ia_follow_up', v_row.id::text,
            v_role, v_row.department_id, v_row.engagement_id, v_row.action_id,
            jsonb_build_object(
              'reference', v_row.id::text,
              'subjectName', 'Action owner',
              'followupSubject', 'Audit follow-up review',
              'engagementTitle', coalesce(nullif(btrim(v_row.engagement_name),''),'Audit engagement'),
              'scheduledFor', to_char(v_row.due_date,'YYYY-MM-DD'),
              'followUpDate', to_char(v_row.due_date,'YYYY-MM-DD'),
              'daysOverdue', greatest(0, p_today - v_row.due_date)::text),
            p_today);
          v_emitted := v_emitted + (v_out = 'emitted')::int;
          v_dedup := v_dedup + (v_out = 'deduplicated')::int;
          v_blocked := v_blocked + (v_out = 'blocked')::int;
          v_unresolved := v_unresolved + (v_out = 'unresolved')::int;
          v_conflict := v_conflict + (v_out = 'conflict')::int;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
        INSERT INTO public.ia_comms_reminder_run_log
          (run_id, policy_id, obligation_kind, event_code, entity_type, entity_id,
           occurrence, outcome, reason)
        VALUES (v_run_id, v_pol.id, 'follow_up', v_pol.event_code, 'ia_follow_up',
                v_row.id::text, v_pol.occurrence_key, 'error', SQLERRM);
      END;
    END LOOP;
  END LOOP;

  v_outcome := CASE
    WHEN (v_unresolved + v_conflict) > 0 AND (v_emitted + v_dedup) > 0
      THEN 'PARTIALLY_EMITTED_WITH_UNRESOLVED_ROLES'
    WHEN (v_unresolved + v_conflict) > 0 THEN 'NOT_EMITTED_UNRESOLVED_ROLES'
    WHEN v_errors > 0 THEN 'COMPLETED_WITH_ERRORS'
    ELSE 'COMPLETED' END;

  UPDATE public.ia_comms_reminder_run_log SET run_outcome = v_outcome WHERE run_id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'run_at', now(), 'as_of', p_today,
    'emitted', v_emitted, 'deduplicated', v_dedup, 'blocked', v_blocked,
    'escalation_unresolved', v_unresolved, 'role_conflicts', v_conflict,
    'errors', v_errors, 'outcome', v_outcome);
END;
$function$;