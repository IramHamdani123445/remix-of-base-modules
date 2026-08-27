CREATE OR REPLACE FUNCTION public.ia_comms_generate_reminders(
  p_today date DEFAULT current_date,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pol record;
  v_row record;
  v_facts jsonb;
  v_extra jsonb;
  v_role text;
  v_res jsonb;
  v_due date;
  v_emitted integer := 0;
  v_dedup integer := 0;
  v_blocked integer := 0;
  v_head_profile uuid;
BEGIN
  SELECT a.profile_id INTO v_head_profile
  FROM public.ia_auditors a
  WHERE a.profile_id IS NOT NULL AND coalesce(a.role,'') ILIKE '%head%'
  ORDER BY a.created_at LIMIT 1;

  -- ── Corrective actions ────────────────────────────────────────────────
  FOR v_pol IN
    SELECT * FROM public.ia_comms_reminder_policy
    WHERE is_active AND obligation_kind = 'action'
  LOOP
    FOR v_row IN
      SELECT a.id, a.action_ref, a.action_description,
             coalesce(a.current_target_date, a.target_date)::date AS due_date,
             a.responsible_profile_id,
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
      v_facts := coalesce(
        public.ia_comms_profile_fact('action_owner', v_row.responsible_profile_id, 'Action owner'),
        '{}'::jsonb);

      FOREACH v_role IN ARRAY v_pol.escalation_roles LOOP
        v_extra := '{}'::jsonb;
        IF v_role = 'department_head' THEN
          SELECT coalesce(public.ia_comms_profile_fact('department_head', d.head_profile_id, d.head), '{}'::jsonb)
            INTO v_extra FROM public.ia_departments d WHERE d.id = v_row.dept_id;
        ELSIF v_role = 'lead_auditor' THEN
          SELECT coalesce(public.ia_comms_profile_fact('lead_auditor', au.profile_id, au.name), '{}'::jsonb)
            INTO v_extra
          FROM public.ia_audit_engagements e
          JOIN public.ia_auditors au ON au.id = e.lead_auditor_id
          WHERE e.id = v_row.engagement_id;
        ELSIF v_role = 'head_of_audit' THEN
          v_extra := coalesce(public.ia_comms_profile_fact('head_of_audit', v_head_profile, 'Head of Internal Audit'), '{}'::jsonb);
        END IF;
        v_facts := v_facts || coalesce(v_extra, '{}'::jsonb);
      END LOOP;

      IF v_facts = '{}'::jsonb THEN
        v_blocked := v_blocked + 1;
        INSERT INTO public.ia_comms_reminder_run_log
          (obligation_kind, event_code, entity_type, entity_id, occurrence,
           recipient_profile_id, outcome, reason)
        VALUES ('action', v_pol.event_code, 'ia_action_tracking', v_row.id::text,
                v_pol.occurrence_key, v_row.responsible_profile_id,
                'blocked', 'RECIPIENT_RESOLUTION_FAILED');
        CONTINUE;
      END IF;

      v_res := public.ia_comms_emit(
        v_pol.event_code, 'ia_action_tracking', v_row.id::text, v_pol.occurrence_key,
        v_facts,
        jsonb_build_object(
          'reference', coalesce(v_row.action_ref, v_row.id::text),
          'subjectName', 'Action owner',
          'actionSummary', left(coalesce(v_row.action_description,''), 400),
          'dueDate', to_char(v_row.due_date, 'YYYY-MM-DD'),
          'daysOverdue', greatest(0, p_today - v_row.due_date),
          'reminderWindow', v_pol.label),
        'ia-reminder:' || v_row.id::text || ':' || v_pol.occurrence_key);

      IF coalesce((v_res->>'deduplicated')::boolean, false) THEN
        v_dedup := v_dedup + 1;
      ELSIF v_res->>'status' IN ('failed','blocked') THEN
        v_blocked := v_blocked + 1;
      ELSE
        v_emitted := v_emitted + 1;
      END IF;

      INSERT INTO public.ia_comms_reminder_run_log
        (obligation_kind, event_code, entity_type, entity_id, occurrence,
         recipient_profile_id, outcome, reason, event_outbox_id)
      VALUES ('action', v_pol.event_code, 'ia_action_tracking', v_row.id::text,
              v_pol.occurrence_key, v_row.responsible_profile_id,
              CASE WHEN coalesce((v_res->>'deduplicated')::boolean,false) THEN 'deduplicated'
                   ELSE coalesce(v_res->>'status','queued') END,
              v_res->>'reason', nullif(v_res->>'event_outbox_id','')::uuid);
    END LOOP;
  END LOOP;

  -- ── Outstanding management responses ──────────────────────────────────
  FOR v_pol IN
    SELECT * FROM public.ia_comms_reminder_policy
    WHERE is_active AND obligation_kind = 'management_response'
  LOOP
    FOR v_row IN
      SELECT r.id, r.finding_id, r.engagement_id,
             coalesce(r.official_target_date, r.due_date, r.target_date)::date AS due_date,
             CASE WHEN r.responsible_person ~* '^[0-9a-f-]{36}$'
                  THEN r.responsible_person::uuid END AS responsible_profile_id,
             f.title AS finding_title, f.department_id
      FROM public.ia_management_responses r
      LEFT JOIN public.ia_findings f ON f.id = r.finding_id
      WHERE r.submitted_date IS NULL
        AND coalesce(r.official_target_date, r.due_date, r.target_date) IS NOT NULL
        AND coalesce(r.status,'') NOT IN ('Submitted','Accepted','Closed','Withdrawn')
        AND (coalesce(r.official_target_date, r.due_date, r.target_date)::date - p_today)
            = v_pol.days_relative_to_due
      LIMIT p_limit
    LOOP
      v_facts := coalesce(
        public.ia_comms_profile_fact('auditee_contact', v_row.responsible_profile_id, 'Management respondent'),
        '{}'::jsonb);

      IF v_facts = '{}'::jsonb AND v_row.department_id IS NOT NULL THEN
        SELECT coalesce(public.ia_comms_profile_fact('auditee_contact', d.head_profile_id, d.head), '{}'::jsonb)
          INTO v_facts FROM public.ia_departments d WHERE d.id = v_row.department_id;
      END IF;

      FOREACH v_role IN ARRAY v_pol.escalation_roles LOOP
        v_extra := '{}'::jsonb;
        IF v_role = 'department_head' THEN
          SELECT coalesce(public.ia_comms_profile_fact('department_head', d.head_profile_id, d.head), '{}'::jsonb)
            INTO v_extra FROM public.ia_departments d WHERE d.id = v_row.department_id;
        ELSIF v_role = 'lead_auditor' THEN
          SELECT coalesce(public.ia_comms_profile_fact('lead_auditor', au.profile_id, au.name), '{}'::jsonb)
            INTO v_extra
          FROM public.ia_audit_engagements e
          JOIN public.ia_auditors au ON au.id = e.lead_auditor_id
          WHERE e.id = v_row.engagement_id;
        END IF;
        v_facts := v_facts || coalesce(v_extra, '{}'::jsonb);
      END LOOP;

      IF v_facts = '{}'::jsonb THEN
        v_blocked := v_blocked + 1;
        INSERT INTO public.ia_comms_reminder_run_log
          (obligation_kind, event_code, entity_type, entity_id, occurrence,
           recipient_profile_id, outcome, reason)
        VALUES ('management_response', v_pol.event_code, 'ia_management_response',
                v_row.id::text, v_pol.occurrence_key, v_row.responsible_profile_id,
                'blocked', 'RECIPIENT_RESOLUTION_FAILED');
        CONTINUE;
      END IF;

      v_res := public.ia_comms_emit(
        v_pol.event_code, 'ia_management_response', v_row.id::text, v_pol.occurrence_key,
        v_facts,
        jsonb_build_object(
          'reference', v_row.id::text,
          'subjectName', 'Management respondent',
          'findingTitle', coalesce(v_row.finding_title,''),
          'responseDueDate', to_char(v_row.due_date,'YYYY-MM-DD'),
          'daysOverdue', greatest(0, p_today - v_row.due_date),
          'reminderWindow', v_pol.label),
        'ia-reminder:' || v_row.id::text || ':' || v_pol.occurrence_key);

      IF coalesce((v_res->>'deduplicated')::boolean, false) THEN
        v_dedup := v_dedup + 1;
      ELSIF v_res->>'status' IN ('failed','blocked') THEN
        v_blocked := v_blocked + 1;
      ELSE
        v_emitted := v_emitted + 1;
      END IF;

      INSERT INTO public.ia_comms_reminder_run_log
        (obligation_kind, event_code, entity_type, entity_id, occurrence,
         recipient_profile_id, outcome, reason, event_outbox_id)
      VALUES ('management_response', v_pol.event_code, 'ia_management_response',
              v_row.id::text, v_pol.occurrence_key, v_row.responsible_profile_id,
              CASE WHEN coalesce((v_res->>'deduplicated')::boolean,false) THEN 'deduplicated'
                   ELSE coalesce(v_res->>'status','queued') END,
              v_res->>'reason', nullif(v_res->>'event_outbox_id','')::uuid);
    END LOOP;
  END LOOP;

  -- ── Follow-up obligations ─────────────────────────────────────────────
  FOR v_pol IN
    SELECT * FROM public.ia_comms_reminder_policy
    WHERE is_active AND obligation_kind = 'follow_up'
  LOOP
    FOR v_row IN
      SELECT fu.id, fu.engagement_id, fu.department_id,
             coalesce(fu.scheduled_follow_up_date, fu.due_date)::date AS due_date,
             fu.action_id
      FROM public.ia_follow_ups fu
      WHERE coalesce(fu.scheduled_follow_up_date, fu.due_date) IS NOT NULL
        AND coalesce(fu.outcome,'') <> 'Implemented'
        AND coalesce(fu.lifecycle_status, fu.status, '') NOT IN ('Closed','Cancelled','Implemented')
        AND (coalesce(fu.scheduled_follow_up_date, fu.due_date)::date - p_today)
            = v_pol.days_relative_to_due
      LIMIT p_limit
    LOOP
      v_facts := '{}'::jsonb;
      SELECT coalesce(public.ia_comms_profile_fact('action_owner', a.responsible_profile_id, 'Action owner'), '{}'::jsonb)
        INTO v_facts FROM public.ia_action_tracking a WHERE a.id = v_row.action_id;
      v_facts := coalesce(v_facts, '{}'::jsonb);

      FOREACH v_role IN ARRAY v_pol.escalation_roles LOOP
        IF v_role = 'lead_auditor' THEN
          SELECT coalesce(public.ia_comms_profile_fact('lead_auditor', au.profile_id, au.name), '{}'::jsonb)
            INTO v_extra
          FROM public.ia_audit_engagements e
          JOIN public.ia_auditors au ON au.id = e.lead_auditor_id
          WHERE e.id = v_row.engagement_id;
          v_facts := v_facts || coalesce(v_extra, '{}'::jsonb);
        END IF;
      END LOOP;

      IF v_facts = '{}'::jsonb THEN
        v_blocked := v_blocked + 1;
        INSERT INTO public.ia_comms_reminder_run_log
          (obligation_kind, event_code, entity_type, entity_id, occurrence, outcome, reason)
        VALUES ('follow_up', v_pol.event_code, 'ia_follow_up', v_row.id::text,
                v_pol.occurrence_key, 'blocked', 'RECIPIENT_RESOLUTION_FAILED');
        CONTINUE;
      END IF;

      v_res := public.ia_comms_emit(
        v_pol.event_code, 'ia_follow_up', v_row.id::text, v_pol.occurrence_key,
        v_facts,
        jsonb_build_object(
          'reference', v_row.id::text,
          'subjectName', 'Action owner',
          'followUpDate', to_char(v_row.due_date,'YYYY-MM-DD'),
          'daysOverdue', greatest(0, p_today - v_row.due_date),
          'reminderWindow', v_pol.label),
        'ia-reminder:' || v_row.id::text || ':' || v_pol.occurrence_key);

      IF coalesce((v_res->>'deduplicated')::boolean, false) THEN
        v_dedup := v_dedup + 1;
      ELSIF v_res->>'status' IN ('failed','blocked') THEN
        v_blocked := v_blocked + 1;
      ELSE
        v_emitted := v_emitted + 1;
      END IF;

      INSERT INTO public.ia_comms_reminder_run_log
        (obligation_kind, event_code, entity_type, entity_id, occurrence,
         outcome, reason, event_outbox_id)
      VALUES ('follow_up', v_pol.event_code, 'ia_follow_up', v_row.id::text,
              v_pol.occurrence_key,
              CASE WHEN coalesce((v_res->>'deduplicated')::boolean,false) THEN 'deduplicated'
                   ELSE coalesce(v_res->>'status','queued') END,
              v_res->>'reason', nullif(v_res->>'event_outbox_id','')::uuid);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'run_at', now(), 'as_of', p_today,
    'emitted', v_emitted, 'deduplicated', v_dedup, 'blocked', v_blocked);
END;
$$;

REVOKE ALL ON FUNCTION public.ia_comms_generate_reminders(date,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ia_comms_generate_reminders(date,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ia_comms_generate_reminders(date,integer) TO service_role;