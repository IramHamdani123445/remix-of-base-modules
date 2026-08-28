-- Stage 1B SoD: audit leadership roles must not be auto-assigned as engagement leads
CREATE OR REPLACE FUNCTION public.ia_capacity_schedule_candidates(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_candidate RECORD;
  v_auditor RECORD;
  v_plan_start date;
  v_plan_end date;
  v_fiscal_year text;
  v_slot_start date;
  v_slot_end date;
  v_days numeric;
  v_hours_per_day numeric;
  v_assigned integer := 0;
  v_conflicts integer := 0;
  c_non_field_roles constant text[] := ARRAY['Chief Audit Executive', 'Head of Internal Audit', 'Quality Reviewer'];
BEGIN
  SELECT planned_start_date, planned_end_date, fiscal_year
    INTO v_plan_start, v_plan_end, v_fiscal_year
  FROM public.ia_annual_plans WHERE id = p_plan_id;

  v_plan_start := COALESCE(
    v_plan_start,
    (NULLIF(regexp_replace(COALESCE(v_fiscal_year, ''), '[^0-9]', '', 'g'), '') || '-01-01')::date,
    CURRENT_DATE);
  v_plan_end := COALESCE(v_plan_end, (v_plan_start + INTERVAL '12 months' - INTERVAL '1 day')::date);

  v_hours_per_day := COALESCE(
    NULLIF((public.ia_resolve_planning_parameter('planning_hours_per_day', p_plan_id)->>'value'), '')::numeric,
    7.5);

  DELETE FROM public.ia_availability_conflicts WHERE plan_id = p_plan_id;

  v_slot_start := v_plan_start;

  FOR v_candidate IN
    SELECT c.* FROM public.ia_auto_plan_candidates c
    WHERE c.plan_id = p_plan_id AND c.accepted = true
    ORDER BY c.composite_score DESC, c.entity_name ASC
  LOOP
    v_days := COALESCE(NULLIF(v_candidate.suggested_days, 0), 10);
    v_slot_end := (v_slot_start + (v_days * INTERVAL '1 day'))::date;

    SELECT a.id, a.name INTO v_auditor
    FROM public.ia_auditors a
    WHERE COALESCE(a.employment_status, 'Active') = 'Active'
      AND COALESCE(a.role, 'Auditor') <> ALL (c_non_field_roles)
      AND NOT EXISTS (
        SELECT 1 FROM public.ia_leave_requests lr
        WHERE lr.auditor_id = a.id AND lr.status = 'Approved'
          AND lr.start_date <= v_slot_end
          AND lr.end_date >= v_slot_start
      )
    ORDER BY COALESCE((
      SELECT SUM(COALESCE(e.estimated_hours, 0)) FROM public.ia_audit_engagements e
      WHERE e.lead_auditor_id = a.id
        AND e.status NOT IN ('Completed', 'Closed', 'Cancelled')
        AND (e.is_active = true OR e.is_active IS NULL)
    ), 0) + COALESCE((
      SELECT SUM(COALESCE(c2.suggested_hours, 0)) FROM public.ia_auto_plan_candidates c2
      WHERE c2.plan_id = p_plan_id AND c2.suggested_lead_auditor_id = a.id
    ), 0) ASC, a.name ASC
    LIMIT 1;

    IF v_auditor.id IS NULL THEN
      INSERT INTO public.ia_availability_conflicts (plan_id, engagement_id, conflict_type, conflict_details, detected_at)
      VALUES (p_plan_id, NULL, 'No Available Auditor',
        jsonb_build_object('candidate_id', v_candidate.id, 'entity', v_candidate.entity_name,
                           'slot_start', v_slot_start, 'slot_end', v_slot_end), now());
      v_conflicts := v_conflicts + 1;
    ELSE
      UPDATE public.ia_auto_plan_candidates SET
        suggested_lead_auditor_id = v_auditor.id,
        suggested_start_date = v_slot_start,
        suggested_end_date = v_slot_end,
        suggested_days = v_days,
        suggested_hours = CEIL(v_days * v_hours_per_day),
        suggested_quarter = 'Q' || EXTRACT(QUARTER FROM v_slot_start)::text,
        suggested_month = TO_CHAR(v_slot_start, 'Month')
      WHERE id = v_candidate.id;

      v_assigned := v_assigned + 1;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.ia_holidays h
      WHERE h.holiday_date BETWEEN v_slot_start AND v_slot_end
    ) THEN
      INSERT INTO public.ia_availability_conflicts (plan_id, engagement_id, conflict_type, conflict_details, detected_at)
      VALUES (p_plan_id, NULL, 'Holiday Overlap',
        jsonb_build_object('candidate_id', v_candidate.id, 'entity', v_candidate.entity_name,
                           'slot_start', v_slot_start, 'slot_end', v_slot_end), now());
      v_conflicts := v_conflicts + 1;
    END IF;

    v_slot_start := (v_slot_start + INTERVAL '14 days')::date;
    IF v_slot_start > v_plan_end THEN
      v_slot_start := v_plan_start;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'assigned', v_assigned,
    'conflicts_detected', v_conflicts,
    'plan_window', jsonb_build_object('start', v_plan_start, 'end', v_plan_end)
  );
END;
$function$;