-- Expected run interval derived from a cron expression (used for job staleness)
CREATE OR REPLACE FUNCTION public.ce_cron_interval(p_cron text)
RETURNS interval
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  p text[];
BEGIN
  IF p_cron IS NULL OR btrim(p_cron) = '' THEN RETURN NULL; END IF;
  p := regexp_split_to_array(btrim(p_cron), '\s+');
  IF array_length(p, 1) < 5 THEN RETURN NULL; END IF;

  IF p[1] LIKE '*/%' THEN
    RETURN make_interval(mins => GREATEST(1, (replace(p[1], '*/', ''))::int));
  END IF;
  IF p[2] LIKE '*/%' THEN
    RETURN make_interval(hours => GREATEST(1, (replace(p[2], '*/', ''))::int));
  END IF;
  IF p[2] = '*' THEN RETURN interval '1 hour'; END IF;
  IF p[5] <> '*' THEN RETURN interval '7 days'; END IF;
  IF p[3] <> '*' THEN RETURN interval '30 days'; END IF;
  RETURN interval '1 day';
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_monitoring_v1(
  p_window text DEFAULT '24h',
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_tech boolean;
  v_win interval;
  v_from timestamptz;
  v_today date := (now() AT TIME ZONE 'UTC')::date;

  v_stall_violation int;
  v_stall_case int;
  v_stall_notice int;
  v_stall_inspection int;
  v_stall_arrangement int;
  v_stall_legal int;
  v_detect_grace int;
  v_legal_days int;
  v_unassigned_hours int;

  v_thresholds jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_ex_status text := 'ok';
  v_sla jsonb;
  v_sla_urgent jsonb := '[]'::jsonb;
  v_sla_trend jsonb := '[]'::jsonb;
  v_detection jsonb;
  v_detection_results jsonb := '[]'::jsonb;
  v_stalled jsonb := '[]'::jsonb;
  v_stalled_oldest jsonb := '[]'::jsonb;
  v_arrangements jsonb;
  v_financial jsonb;
  v_comms jsonb;
  v_field jsonb;
  v_legal jsonb;
  v_jobs jsonb := '[]'::jsonb;
  v_job_failures jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_subsystems jsonb;
  v_health text;
  v_health_reasons jsonb := '[]'::jsonb;

  f_severity text := NULLIF(p_filters->>'severity','');
  f_area     text := NULLIF(p_filters->>'area','');
  f_zone     text := NULLIF(p_filters->>'zone','');
  f_owner    text := NULLIF(p_filters->>'owner','');
  f_employer text := NULLIF(p_filters->>'employer','');
  f_type     text := NULLIF(p_filters->>'alert_type','');
  f_status   text := NULLIF(p_filters->>'status','');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN
    v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN
    v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid, 'compliance.reports.operational') THEN
    v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'Not authorised for compliance monitoring';
  END IF;
  v_tech := public.ce_actor_can(v_uid, 'compliance.config.manage');

  v_win := CASE p_window WHEN '7d' THEN interval '7 days'
                         WHEN '30d' THEN interval '30 days'
                         ELSE interval '24 hours' END;
  v_from := now() - v_win;

  -- ---------- thresholds (configurable, ce_settings) ----------
  SELECT
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.violation' THEN setting_value END)::int, 10),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.case' THEN setting_value END)::int, 14),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.notice' THEN setting_value END)::int, 7),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.inspection' THEN setting_value END)::int, 7),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.arrangement' THEN setting_value END)::int, 10),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.legal_referral' THEN setting_value END)::int, 7),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.detection_grace_hours' THEN setting_value END)::int, 6),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.legal_handoff_days' THEN setting_value END)::int, 5),
    COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.unassigned_critical_hours' THEN setting_value END)::int, 24)
  INTO v_stall_violation, v_stall_case, v_stall_notice, v_stall_inspection,
       v_stall_arrangement, v_stall_legal, v_detect_grace, v_legal_days, v_unassigned_hours
  FROM public.ce_settings
  WHERE setting_key LIKE 'compliance.monitoring.%';

  v_thresholds := jsonb_build_object(
    'stall_days', jsonb_build_object(
      'violation', v_stall_violation, 'case', v_stall_case, 'notice', v_stall_notice,
      'inspection', v_stall_inspection, 'arrangement', v_stall_arrangement,
      'legal_referral', v_stall_legal),
    'detection_grace_hours', v_detect_grace,
    'legal_handoff_days', v_legal_days,
    'unassigned_critical_hours', v_unassigned_hours,
    'source', 'ce_settings (compliance.monitoring.*)'
  );

  -- ---------- deadline items (canonical per-record due dates) ----------
  DROP TABLE IF EXISTS _mon_dl;
  CREATE TEMP TABLE _mon_dl (
    area text, record_ref text, record_id text, route text,
    employer_id text, employer_name text, zone text,
    owner_id text, owner_name text, stage text, status text,
    due_date date, closed boolean, closed_at timestamptz, deadline_source text
  ) ON COMMIT DROP;

  INSERT INTO _mon_dl
  SELECT 'Violation', v.violation_number, v.id::text, '/compliance/violations/'||v.id,
         v.employer_id, v.employer_name, v.territory,
         v.assigned_to_user_id::text, v.assigned_to_name, v.status, v.status,
         v.due_date::date, v.status IN ('RESOLVED','CLOSED','CANCELLED'), v.resolved_at,
         'ce_violations.due_date'
  FROM public.ce_violations v
  WHERE COALESCE(v.is_deleted,false) = false AND v.due_date IS NOT NULL;

  INSERT INTO _mon_dl
  SELECT 'Case', c.case_number, c.id::text, '/compliance/cases/'||c.id,
         c.employer_id, c.employer_name, c.territory,
         c.assigned_officer_id::text, c.assigned_officer_name, c.status, c.status,
         c.target_resolution_date::date, c.status IN ('CLOSED','COMPLETED'), c.closed_date::timestamptz,
         'ce_cases.target_resolution_date'
  FROM public.ce_cases c
  WHERE COALESCE(c.is_deleted,false) = false AND c.target_resolution_date IS NOT NULL;

  INSERT INTO _mon_dl
  SELECT 'Notice', n.notice_number, n.id::text, '/compliance/enforcement/notices',
         n.employer_id, n.employer_name, NULL,
         NULL, n.created_by, n.status, n.status,
         n.due_response_date::date, COALESCE(n.response_received,false) OR n.status IN ('ACKNOWLEDGED','CANCELLED'),
         n.response_date::timestamptz, 'ce_notices.due_response_date'
  FROM public.ce_notices n
  WHERE n.due_response_date IS NOT NULL;

  INSERT INTO _mon_dl
  SELECT 'Arrangement', i.arrangement_number||'/'||i.installment_number, i.arrangement_id::text,
         '/compliance/enforcement/arrangements/'||i.arrangement_number,
         i.employer_id, i.employer_name, NULL,
         NULL, NULL, i.effective_status, i.effective_status,
         i.due_date, i.effective_status IN ('PAID','SETTLED','CANCELLED'), i.paid_date::timestamptz,
         'ce_v_arrangement_installment_operational.due_date'
  FROM public.ce_v_arrangement_installment_operational i
  WHERE i.due_date IS NOT NULL;

  INSERT INTO _mon_dl
  SELECT 'Follow-up', COALESCE(f.action_type,'Follow-up'), f.id::text,
         CASE WHEN f.violation_id IS NOT NULL THEN '/compliance/violations/'||f.violation_id
              ELSE '/compliance/work-queue' END,
         f.employer_id, f.employer_name, NULL,
         f.assigned_to_user_id::text, f.assigned_to_name, f.status, f.status,
         f.due_date::date, f.status IN ('COMPLETED','CANCELLED'), f.completed_at,
         'ce_follow_up_actions.due_date'
  FROM public.ce_follow_up_actions f
  WHERE COALESCE(f.is_deleted,false) = false AND f.due_date IS NOT NULL;

  INSERT INTO _mon_dl
  SELECT 'Inspection', s.inspection_number, s.id::text, '/compliance/field/audit-management',
         s.employer_id, s.employer_name, s.territory,
         s.inspector_id::text, s.inspector_name, s.status, s.status,
         s.scheduled_date::date, upper(s.status) IN ('COMPLETED','CANCELLED'), s.actual_end,
         'ce_inspections.scheduled_date'
  FROM public.ce_inspections s
  WHERE s.scheduled_date IS NOT NULL;

  IF v_scope = 'own' THEN
    DELETE FROM _mon_dl WHERE owner_id IS DISTINCT FROM v_uid::text;
  END IF;

  -- ---------- exceptions queue ----------
  DROP TABLE IF EXISTS _mon_ex;
  CREATE TEMP TABLE _mon_ex (
    severity text, area text, alert_type text, alert text,
    employer_id text, employer_name text, record_ref text, record_id text,
    zone text, owner_id text, owner_name text, status text,
    detected_at timestamptz, action text, route text
  ) ON COMMIT DROP;

  -- deadline breaches & imminent deadlines
  INSERT INTO _mon_ex
  SELECT CASE WHEN d.due_date < v_today - 7 THEN 'Critical'
              WHEN d.due_date < v_today THEN 'High'
              ELSE 'Medium' END,
         d.area,
         CASE WHEN d.due_date < v_today THEN 'sla_breach' ELSE 'sla_due' END,
         CASE WHEN d.due_date < v_today
              THEN d.area||' deadline breached by '||(v_today - d.due_date)||'d'
              ELSE d.area||' deadline due within 24h' END,
         d.employer_id, d.employer_name, d.record_ref, d.record_id, d.zone,
         d.owner_id, d.owner_name, d.status,
         (d.due_date + 1)::timestamptz,
         CASE WHEN d.due_date < v_today THEN 'Resolve or escalate' ELSE 'Complete before deadline' END,
         d.route
  FROM _mon_dl d
  WHERE d.closed = false AND d.due_date <= v_today + 1;

  -- unresolved arrangement breaches
  INSERT INTO _mon_ex
  SELECT 'Critical', 'Arrangement', 'arrangement_breach',
         'Payment arrangement breached ('||COALESCE(b.breach_type,'breach')||')',
         a.employer_id, a.employer_name, a.arrangement_number, a.id::text, NULL,
         NULL, NULL, a.status, b.detected_at, 'Review breach and decide action',
         '/compliance/enforcement/arrangements/'||a.arrangement_number
  FROM public.ce_arrangement_breaches b
  JOIN public.ce_payment_arrangements a ON a.id = b.arrangement_id
  WHERE b.resolved_at IS NULL;

  -- notice delivery failures
  INSERT INTO _mon_ex
  SELECT CASE WHEN l.attempt_number >= 2 THEN 'Critical' ELSE 'High' END,
         'Communication', 'delivery_failed',
         'Notice delivery failed ('||COALESCE(l.channel,'unknown')||', attempt '||COALESCE(l.attempt_number,1)||')',
         n.employer_id, n.employer_name, n.notice_number, n.id::text, NULL,
         NULL, n.created_by, n.status, COALESCE(l.sent_at, l.created_at),
         'Re-issue or correct recipient', '/compliance/enforcement/notices'
  FROM public.ce_notice_delivery_log l
  JOIN public.ce_notices n ON n.id = l.notice_id
  WHERE l.status = 'FAILED' AND n.delivered_at IS NULL;

  -- legal handoff breakdowns
  INSERT INTO _mon_ex
  SELECT 'High', 'Legal', 'legal_handoff',
         'Legal recommendation awaiting decision for '||
           EXTRACT(day FROM now() - r.created_at)::int||'d',
         r.employer_id, r.employer_name, COALESCE(r.early_rule_code,'RECOMMENDATION'), r.id::text, r.employer_zone,
         NULL, r.recommended_by, r.status, r.created_at,
         'Review and decide', '/compliance/enforcement/recommendation-queue'
  FROM public.ce_legal_recommendations r
  WHERE r.status = 'PENDING_REVIEW' AND r.created_at < now() - make_interval(days => v_legal_days);

  INSERT INTO _mon_ex
  SELECT 'High', 'Legal', 'legal_handoff',
         'Approved referral not handed off to Legal',
         f.employer_id, f.employer_name, f.referral_number, f.id::text, f.employer_zone,
         NULL, f.approved_by, f.status, f.approved_at,
         'Complete pack and submit', '/compliance/enforcement/legal-queue'
  FROM public.ce_legal_referrals f
  WHERE f.approved_at IS NOT NULL
    AND f.status NOT IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','REJECTED')
    AND f.approved_at < now() - make_interval(days => v_legal_days);

  INSERT INTO _mon_ex
  SELECT 'High', 'Legal', 'legal_returned',
         'Case returned from Legal awaiting Compliance response',
         f.employer_id, f.employer_name, f.referral_number, f.id::text, f.employer_zone,
         NULL, t.returned_by, COALESCE(t.resolution_status,'RETURNED'), t.returned_at,
         'Action the return reason', '/compliance/enforcement/legal-queue'
  FROM public.ce_legal_returns t
  JOIN public.ce_legal_referrals f ON f.id = t.referral_id
  WHERE t.resolved_at IS NULL AND t.returned_at < now() - make_interval(days => v_legal_days);

  -- stalled work (no update within configured threshold)
  INSERT INTO _mon_ex
  SELECT 'Medium', 'Violation', 'stalled',
         'Violation inactive for '||EXTRACT(day FROM now() - v.updated_at)::int||'d',
         v.employer_id, v.employer_name, v.violation_number, v.id::text, v.territory,
         v.assigned_to_user_id::text, v.assigned_to_name, v.status, v.updated_at,
         'Progress or reassign', '/compliance/violations/'||v.id
  FROM public.ce_violations v
  WHERE COALESCE(v.is_deleted,false) = false
    AND v.status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')
    AND v.updated_at < now() - make_interval(days => v_stall_violation);

  INSERT INTO _mon_ex
  SELECT 'Medium', 'Case', 'stalled',
         'Case inactive for '||EXTRACT(day FROM now() - c.updated_at)::int||'d',
         c.employer_id, c.employer_name, c.case_number, c.id::text, c.territory,
         c.assigned_officer_id::text, c.assigned_officer_name, c.status, c.updated_at,
         'Progress or reassign', '/compliance/cases/'||c.id
  FROM public.ce_cases c
  WHERE COALESCE(c.is_deleted,false) = false
    AND c.status NOT IN ('CLOSED','COMPLETED')
    AND c.updated_at < now() - make_interval(days => v_stall_case);

  INSERT INTO _mon_ex
  SELECT 'Medium', 'Communication', 'stalled',
         'Notice awaiting approval/despatch for '||EXTRACT(day FROM now() - n.created_at)::int||'d',
         n.employer_id, n.employer_name, n.notice_number, n.id::text, NULL,
         NULL, n.created_by, n.status, n.created_at,
         'Approve or despatch', '/compliance/enforcement/notices'
  FROM public.ce_notices n
  WHERE n.status IN ('DRAFT','GENERATED','APPROVED')
    AND n.created_at < now() - make_interval(days => v_stall_notice);

  -- unassigned critical work
  INSERT INTO _mon_ex
  SELECT 'Critical', 'Violation', 'unassigned',
         'Unassigned '||lower(v.priority)||'-priority violation',
         v.employer_id, v.employer_name, v.violation_number, v.id::text, v.territory,
         NULL, NULL, v.status, v.created_at,
         'Assign an owner', '/compliance/violations/'||v.id
  FROM public.ce_violations v
  WHERE COALESCE(v.is_deleted,false) = false
    AND v.status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')
    AND v.assigned_to_user_id IS NULL
    AND UPPER(COALESCE(v.priority,'')) IN ('CRITICAL','HIGH','URGENT')
    AND v.created_at < now() - make_interval(hours => v_unassigned_hours);

  -- automation failures inside the window
  IF v_tech THEN
    INSERT INTO _mon_ex
    SELECT 'Critical', 'Automation', 'job_failed',
           'Automation job failed: '||j.name,
           NULL, NULL, j.job_code, j.id::text, NULL,
           NULL, NULL, r.run_status, r.started_at,
           'Review job history', '/compliance/automation/history'
    FROM public.ce_automation_job_runs r
    JOIN public.ce_automation_jobs j ON j.id = r.job_id
    WHERE r.started_at >= v_from AND lower(COALESCE(r.run_status,'')) IN ('failed','failure','error');
  END IF;

  IF v_scope = 'own' THEN
    DELETE FROM _mon_ex WHERE owner_id IS DISTINCT FROM v_uid::text;
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY sev_rank, detected_at ASC), '[]'::jsonb)
  INTO v_exceptions
  FROM (
    SELECT to_jsonb(e) - 'sev_rank' AS x,
           CASE e.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2
                           WHEN 'Medium' THEN 3 ELSE 4 END AS sev_rank,
           e.detected_at
    FROM (
      SELECT *, ROUND(EXTRACT(epoch FROM now() - detected_at)/3600.0, 1) AS age_hours
      FROM _mon_ex
    ) e
    WHERE (f_severity IS NULL OR e.severity = f_severity)
      AND (f_area IS NULL OR e.area = f_area)
      AND (f_zone IS NULL OR e.zone = f_zone)
      AND (f_type IS NULL OR e.alert_type = f_type)
      AND (f_status IS NULL OR e.status = f_status)
      AND (f_owner IS NULL OR
           (f_owner = 'unassigned' AND e.owner_id IS NULL) OR
           e.owner_id = f_owner OR e.owner_name ILIKE '%'||f_owner||'%')
      AND (f_employer IS NULL OR e.employer_id = f_employer OR e.employer_name ILIKE '%'||f_employer||'%')
    LIMIT 500
  ) q;

  -- ---------- SLA summary / urgent / trend ----------
  SELECT jsonb_build_object(
    'status','ok',
    'breached', COUNT(*) FILTER (WHERE due_date < v_today),
    'due_24h', COUNT(*) FILTER (WHERE due_date = v_today),
    'due_1_3', COUNT(*) FILTER (WHERE due_date BETWEEN v_today+1 AND v_today+3),
    'due_4_7', COUNT(*) FILTER (WHERE due_date BETWEEN v_today+4 AND v_today+7),
    'healthy', COUNT(*) FILTER (WHERE due_date > v_today+7),
    'by_area', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('area', area, 'breached', b, 'due_soon', s))
      FROM (SELECT area,
                   COUNT(*) FILTER (WHERE due_date < v_today) b,
                   COUNT(*) FILTER (WHERE due_date BETWEEN v_today AND v_today+3) s
            FROM _mon_dl WHERE closed = false GROUP BY area) t
    ), '[]'::jsonb)
  ) INTO v_sla FROM _mon_dl WHERE closed = false;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'area', area, 'record_ref', record_ref, 'employer_name', employer_name,
      'stage', stage, 'owner_name', owner_name, 'due_date', due_date,
      'days_overdue', (v_today - due_date), 'route', route,
      'deadline_source', deadline_source) ORDER BY due_date), '[]'::jsonb)
  INTO v_sla_urgent
  FROM (SELECT * FROM _mon_dl WHERE closed = false AND due_date <= v_today + 3
        ORDER BY due_date LIMIT 25) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d::date,
      'new_breaches', (SELECT COUNT(*) FROM _mon_dl x WHERE x.due_date = d::date AND x.closed = false),
      'cleared', (SELECT COUNT(*) FROM _mon_dl x WHERE x.closed AND x.closed_at::date = d::date
                                                 AND x.due_date < x.closed_at::date)
    ) ORDER BY d), '[]'::jsonb)
  INTO v_sla_trend
  FROM generate_series(v_today - 6, v_today, interval '1 day') d;

  -- ---------- detection engine health ----------
  BEGIN
    WITH job AS (
      SELECT j.id, j.job_code, j.name, j.is_enabled, j.schedule_cron, j.last_run_at, j.last_run_status
      FROM public.ce_automation_jobs j WHERE j.job_code = 'JOB-VIOLATION-SCAN'
    ),
    runs AS (
      SELECT r.* FROM public.ce_automation_job_runs r JOIN job ON job.id = r.job_id
    ),
    last_run AS (SELECT * FROM runs ORDER BY started_at DESC LIMIT 1),
    last_ok AS (SELECT * FROM runs WHERE lower(COALESCE(run_status,'')) IN ('completed','success','succeeded')
                ORDER BY started_at DESC LIMIT 1)
    SELECT jsonb_build_object(
      'status', CASE
        WHEN (SELECT id FROM job) IS NULL THEN 'unavailable'
        WHEN NOT COALESCE((SELECT is_enabled FROM job), false) THEN 'disabled'
        WHEN (SELECT started_at FROM last_ok) IS NULL THEN 'stale'
        WHEN public.ce_cron_interval((SELECT schedule_cron FROM job)) IS NOT NULL
             AND (SELECT started_at FROM last_ok) < now() - (public.ce_cron_interval((SELECT schedule_cron FROM job))
                  + make_interval(hours => v_detect_grace)) THEN 'degraded'
        WHEN lower(COALESCE((SELECT run_status FROM last_run),'')) IN ('failed','failure','error') THEN 'failed'
        ELSE 'ok' END,
      'job_code', (SELECT job_code FROM job),
      'enabled', (SELECT is_enabled FROM job),
      'schedule_cron', (SELECT schedule_cron FROM job),
      'expected_interval_hours',
        EXTRACT(epoch FROM public.ce_cron_interval((SELECT schedule_cron FROM job)))/3600,
      'last_run_at', (SELECT started_at FROM last_run),
      'last_run_status', (SELECT run_status FROM last_run),
      'last_success_at', (SELECT started_at FROM last_ok),
      'duration_ms', (SELECT duration_ms FROM last_run),
      'records_evaluated', (SELECT records_processed FROM last_ok),
      'violations_detected', (SELECT records_affected FROM last_ok),
      'errors', (SELECT errors_count FROM last_run),
      'manual_runs_window', (SELECT COUNT(*) FROM runs WHERE started_at >= v_from
                              AND COALESCE(triggered_by,'') NOT IN ('system','cron','scheduler')),
      'event_queue', (
        SELECT jsonb_build_object(
          'status', CASE WHEN COUNT(*) = 0 THEN 'no_data' ELSE 'ok' END,
          'pending', COUNT(*) FILTER (WHERE status = 'PENDING'),
          'processed_window', COUNT(*) FILTER (WHERE processed_at >= v_from),
          'failed_window', COUNT(*) FILTER (WHERE status = 'FAILED' AND COALESCE(processed_at, requested_at) >= v_from),
          'oldest_pending_at', MIN(requested_at) FILTER (WHERE status = 'PENDING'))
        FROM public.ce_detection_event_queue),
      'active_rules', (SELECT COUNT(*) FROM public.ce_detection_rules WHERE is_enabled),
      'total_rules', (SELECT COUNT(*) FROM public.ce_detection_rules)
    ) INTO v_detection;
  EXCEPTION WHEN OTHERS THEN
    v_detection := jsonb_build_object('status','unavailable');
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'d')), '[]'::jsonb) INTO v_detection_results
    FROM (
      SELECT jsonb_build_object('d', d.d, 'category', COALESCE(t.category,'Other'), 'count', COUNT(v.id)) x
      FROM generate_series(v_today - 6, v_today, interval '1 day') d(d)
      LEFT JOIN public.ce_violations v
        ON v.discovered_date::date = d.d::date AND COALESCE(v.is_deleted,false) = false
      LEFT JOIN public.ce_violation_types t ON t.id = v.violation_type_id
      GROUP BY d.d, COALESCE(t.category,'Other')
    ) s;
  EXCEPTION WHEN OTHERS THEN v_detection_results := NULL; END;

  -- ---------- stalled work ----------
  SELECT COALESCE(jsonb_agg(jsonb_build_object('area', area, 'count', c) ORDER BY c DESC), '[]'::jsonb)
  INTO v_stalled
  FROM (SELECT area, COUNT(*) c FROM _mon_ex WHERE alert_type = 'stalled' GROUP BY area) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'record_ref', record_ref, 'employer_name', employer_name, 'area', area,
      'stage', status, 'owner_name', owner_name, 'route', route,
      'days_in_stage', GREATEST(0, EXTRACT(day FROM now() - detected_at)::int),
      'severity', severity) ORDER BY detected_at), '[]'::jsonb)
  INTO v_stalled_oldest
  FROM (SELECT * FROM _mon_ex WHERE alert_type = 'stalled' ORDER BY detected_at LIMIT 15) t;

  -- ---------- arrangements ----------
  BEGIN
    SELECT jsonb_build_object(
      'status','ok',
      'due_today', (SELECT COUNT(*) FROM public.ce_v_arrangement_installment_operational
                    WHERE due_date = v_today AND effective_status NOT IN ('PAID','CANCELLED')),
      'overdue', (SELECT COUNT(*) FROM public.ce_v_arrangement_installment_operational
                  WHERE due_date < v_today AND effective_status NOT IN ('PAID','CANCELLED')),
      'new_breaches_window', (SELECT COUNT(*) FROM public.ce_arrangement_breaches WHERE detected_at >= v_from),
      'unresolved_breaches', (SELECT COUNT(*) FROM public.ce_arrangement_breaches WHERE resolved_at IS NULL),
      'health', COALESCE((SELECT jsonb_agg(jsonb_build_object('state', health_status, 'count', c))
                 FROM (SELECT health_status, COUNT(*) c FROM public.ce_v_arrangement_health
                       GROUP BY health_status) h), '[]'::jsonb),
      'approaching_default', (SELECT COUNT(*) FROM public.ce_v_arrangement_health
                              WHERE COALESCE(missed_payments,0) > 0
                                AND COALESCE(missed_payments,0) < COALESCE(max_missed_before_breach,3)
                                AND COALESCE(breach_detected,false) = false)
    ) INTO v_arrangements;
  EXCEPTION WHEN OTHERS THEN v_arrangements := jsonb_build_object('status','unavailable'); END;

  -- ---------- financial exceptions ----------
  BEGIN
    SELECT jsonb_build_object(
      'status','ok',
      'new_outstanding_obligations', (SELECT COUNT(*) FROM public.ce_obligation_periods
        WHERE is_outstanding AND COALESCE(last_evaluated_at, updated_at, created_at) >= v_from),
      'obligations_past_grace', (SELECT COUNT(*) FROM public.ce_obligation_periods
        WHERE is_outstanding AND grace_end_date IS NOT NULL AND grace_end_date < v_today AND resolved_at IS NULL),
      'open_reconciliation_exceptions', (SELECT COUNT(*) FROM public.ce_reconciliation_exceptions
        WHERE resolved_at IS NULL),
      'new_reconciliation_exceptions', (SELECT COUNT(*) FROM public.ce_reconciliation_exceptions
        WHERE created_at >= v_from),
      'pending_partial_payment_requests', (SELECT COUNT(*) FROM public.ce_partial_payment_requests
        WHERE UPPER(COALESCE(status,'')) IN ('PENDING','PENDING_APPROVAL','SUBMITTED')),
      'top_new_exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'employer_name', employer_name, 'type', exception_type,
            'variance', variance_amount, 'created_at', created_at))
          FROM (SELECT * FROM public.ce_reconciliation_exceptions WHERE resolved_at IS NULL
                ORDER BY ABS(COALESCE(variance_amount,0)) DESC LIMIT 8) r), '[]'::jsonb)
    ) INTO v_financial;
  EXCEPTION WHEN OTHERS THEN v_financial := jsonb_build_object('status','unavailable'); END;

  -- ---------- communications ----------
  BEGIN
    SELECT jsonb_build_object(
      'status','ok',
      'awaiting_approval', (SELECT COUNT(*) FROM public.ce_notices WHERE status IN ('DRAFT','GENERATED')),
      'queued', (SELECT COUNT(*) FROM public.ce_notices WHERE status = 'APPROVED'),
      'sent', (SELECT COUNT(*) FROM public.ce_notices WHERE status = 'SENT'),
      'delivered', (SELECT COUNT(*) FROM public.ce_notices WHERE status IN ('DELIVERED','ACKNOWLEDGED')),
      'failed', (SELECT COUNT(*) FROM public.ce_notices WHERE status = 'FAILED'),
      'confirmation_pending', (SELECT COUNT(*) FROM public.ce_notices
        WHERE sent_at IS NOT NULL AND delivered_at IS NULL AND status NOT IN ('FAILED','CANCELLED')),
      'failed_attempts_window', (SELECT COUNT(*) FROM public.ce_notice_delivery_log
        WHERE status = 'FAILED' AND COALESCE(sent_at, created_at) >= v_from),
      'responses_awaiting', (SELECT COUNT(*) FROM public.ce_notice_responses
        WHERE COALESCE(processed_at, NULL) IS NULL)
    ) INTO v_comms;
  EXCEPTION WHEN OTHERS THEN v_comms := jsonb_build_object('status','unavailable'); END;

  -- ---------- field operations ----------
  BEGIN
    SELECT jsonb_build_object(
      'status','ok',
      'visits_overdue', (SELECT COUNT(*) FROM public.ce_inspections
        WHERE scheduled_date < v_today AND UPPER(status) NOT IN ('COMPLETED','CANCELLED')),
      'visits_not_started', (SELECT COUNT(*) FROM public.ce_inspections
        WHERE scheduled_date <= v_today AND UPPER(status) = 'SCHEDULED' AND actual_start IS NULL),
      'planned_visits_overdue', (SELECT COUNT(*) FROM public.ce_planned_visits
        WHERE scheduled_date < v_today AND COALESCE(completed,false) = false),
      'reports_overdue', (SELECT COUNT(*) FROM public.ce_inspections
        WHERE UPPER(status) = 'COMPLETED' AND actual_end IS NOT NULL
          AND actual_end < now() - make_interval(days => v_stall_inspection)
          AND COALESCE(findings_summary,'') = ''),
      'followups_overdue', (SELECT COUNT(*) FROM public.ce_follow_up_actions
        WHERE COALESCE(is_deleted,false) = false AND due_date < v_today
          AND status IN ('PLANNED','IN_PROGRESS','OVERDUE')),
      'plans_awaiting_approval', (SELECT COUNT(*) FROM public.ce_weekly_plans
        WHERE UPPER(COALESCE(status,'')) IN ('SUBMITTED','PENDING_REVIEW','PENDING_APPROVAL'))
    ) INTO v_field;
  EXCEPTION WHEN OTHERS THEN v_field := jsonb_build_object('status','unavailable'); END;

  -- ---------- legal handoff ----------
  BEGIN
    SELECT jsonb_build_object(
      'status','ok',
      'recommendations_pending', (SELECT COUNT(*) FROM public.ce_legal_recommendations WHERE status = 'PENDING_REVIEW'),
      'approved_not_prepared', (SELECT COUNT(*) FROM public.ce_legal_referrals
        WHERE approved_at IS NOT NULL AND pack_completed_at IS NULL
          AND status NOT IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','REJECTED')),
      'approved_not_handed_off', (SELECT COUNT(*) FROM public.ce_legal_referrals
        WHERE approved_at IS NOT NULL AND status NOT IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','REJECTED')),
      'returned_unresolved', (SELECT COUNT(*) FROM public.ce_legal_returns WHERE resolved_at IS NULL),
      'stale_referrals', (SELECT COUNT(*) FROM public.ce_legal_referrals
        WHERE status = 'SUBMITTED_TO_LEGAL' AND updated_at < now() - make_interval(days => v_stall_legal))
    ) INTO v_legal;
  EXCEPTION WHEN OTHERS THEN v_legal := jsonb_build_object('status','unavailable'); END;

  -- ---------- automation health ----------
  IF v_tech THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'job_code', t.job_code, 'name', t.name, 'job_type', j.job_type,
        'purpose', j.description, 'schedule', COALESCE(t.configured_cron, j.frequency),
        'active_cron', t.active_cron, 'sync_state', t.sync_state,
        'enabled', t.is_enabled, 'scheduled', t.is_scheduled,
        'last_run_at', t.last_run_at, 'last_run_status', t.last_run_status,
        'last_success_at', ls.last_success_at, 'duration_ms', ls.duration_ms,
        'next_run_at', j.next_scheduled_at,
        'status', CASE
          WHEN COALESCE(t.is_enabled,false) = false THEN 'disabled'
          WHEN lower(COALESCE(t.last_run_status,'')) IN ('failed','failure','error') THEN 'failed'
          WHEN lower(COALESCE(t.last_run_status,'')) IN ('running','in_progress') THEN 'running'
          WHEN t.last_run_at IS NULL THEN 'never_run'
          WHEN public.ce_cron_interval(t.configured_cron) IS NOT NULL
               AND COALESCE(ls.last_success_at, t.last_run_at) <
                   now() - (public.ce_cron_interval(t.configured_cron) * 2) THEN 'delayed'
          ELSE 'healthy' END
        ) ORDER BY t.job_code), '[]'::jsonb)
      INTO v_jobs
      FROM public.ce_v_automation_job_schedule_truth t
      JOIN public.ce_automation_jobs j ON j.id = t.id
      LEFT JOIN LATERAL (
        SELECT MAX(r.started_at) FILTER (WHERE lower(COALESCE(r.run_status,'')) IN ('completed','success','succeeded')) AS last_success_at,
               MAX(r.duration_ms) FILTER (WHERE r.started_at = (SELECT MAX(started_at) FROM public.ce_automation_job_runs x WHERE x.job_id = j.id)) AS duration_ms
        FROM public.ce_automation_job_runs r WHERE r.job_id = j.id
      ) ls ON true;
    EXCEPTION WHEN OTHERS THEN v_jobs := NULL; END;

    BEGIN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'job_code', j.job_code, 'name', j.name, 'failed_at', r.started_at,
          'error_summary', LEFT(COALESCE(NULLIF(r.error_details->>'message',''),
                                         NULLIF(r.summary->>'message',''),
                                         'The job did not complete successfully'), 160),
          'records_affected', r.records_affected, 'errors_count', r.errors_count,
          'retry_status', CASE WHEN EXISTS (
              SELECT 1 FROM public.ce_automation_job_runs n
              WHERE n.job_id = r.job_id AND n.started_at > r.started_at
                AND lower(COALESCE(n.run_status,'')) IN ('completed','success','succeeded'))
            THEN 'Recovered on a later run' ELSE 'Not retried' END
        ) ORDER BY r.started_at DESC), '[]'::jsonb)
      INTO v_job_failures
      FROM (SELECT * FROM public.ce_automation_job_runs
            WHERE lower(COALESCE(run_status,'')) IN ('failed','failure','error')
              AND started_at >= now() - interval '30 days'
            ORDER BY started_at DESC LIMIT 15) r
      JOIN public.ce_automation_jobs j ON j.id = r.job_id;
    EXCEPTION WHEN OTHERS THEN v_job_failures := NULL; END;
  ELSE
    v_jobs := NULL; v_job_failures := NULL;
  END IF;

  -- ---------- recent operational events ----------
  BEGIN
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'at') DESC), '[]'::jsonb) INTO v_events
    FROM (
      SELECT jsonb_build_object('at', v.discovered_date::timestamptz, 'event', 'Violation detected',
        'record', v.violation_number, 'employer', v.employer_name,
        'severity', CASE WHEN UPPER(COALESCE(v.priority,'')) IN ('CRITICAL','HIGH') THEN 'High' ELSE 'Informational' END,
        'source', 'ce_violations') e
      FROM public.ce_violations v
      WHERE COALESCE(v.is_deleted,false)=false AND v.discovered_date >= v_from::date
      UNION ALL
      SELECT jsonb_build_object('at', b.detected_at, 'event', 'Arrangement breached',
        'record', a.arrangement_number, 'employer', a.employer_name,
        'severity','Critical','source','ce_arrangement_breaches')
      FROM public.ce_arrangement_breaches b JOIN public.ce_payment_arrangements a ON a.id=b.arrangement_id
      WHERE b.detected_at >= v_from
      UNION ALL
      SELECT jsonb_build_object('at', COALESCE(l.sent_at,l.created_at), 'event','Notice delivery failed',
        'record', n.notice_number, 'employer', n.employer_name, 'severity','High','source','ce_notice_delivery_log')
      FROM public.ce_notice_delivery_log l JOIN public.ce_notices n ON n.id=l.notice_id
      WHERE l.status='FAILED' AND COALESCE(l.sent_at,l.created_at) >= v_from
      UNION ALL
      SELECT jsonb_build_object('at', t.returned_at, 'event','Referral returned from Legal',
        'record', f.referral_number, 'employer', f.employer_name, 'severity','High','source','ce_legal_returns')
      FROM public.ce_legal_returns t JOIN public.ce_legal_referrals f ON f.id=t.referral_id
      WHERE t.returned_at >= v_from
      UNION ALL
      SELECT jsonb_build_object('at', g.created_at, 'event','Escalation evaluated: '||COALESCE(g.to_status,g.status),
        'record', g.rule_code, 'employer', NULL,
        'severity', CASE WHEN g.status='BLOCKED' THEN 'High' ELSE 'Informational' END,
        'source','ce_escalation_log')
      FROM public.ce_escalation_log g WHERE g.created_at >= v_from
      UNION ALL
      SELECT jsonb_build_object('at', r.started_at, 'event','Automation job failed: '||j.name,
        'record', j.job_code, 'employer', NULL, 'severity','Critical','source','ce_automation_job_runs')
      FROM public.ce_automation_job_runs r JOIN public.ce_automation_jobs j ON j.id=r.job_id
      WHERE r.started_at >= v_from AND lower(COALESCE(r.run_status,'')) IN ('failed','failure','error') AND v_tech
      LIMIT 60
    ) s;
  EXCEPTION WHEN OTHERS THEN v_events := NULL; END;

  -- ---------- subsystem + overall health ----------
  v_subsystems := jsonb_build_object(
    'detection', COALESCE(v_detection->>'status','unavailable'),
    'automation', CASE
        WHEN NOT v_tech THEN 'restricted'
        WHEN v_jobs IS NULL THEN 'unavailable'
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_jobs) j WHERE j->>'status' = 'failed') THEN 'failed'
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_jobs) j WHERE j->>'status' IN ('delayed','never_run')) THEN 'degraded'
        ELSE 'ok' END,
    'sla', CASE WHEN v_sla IS NULL THEN 'unavailable'
                WHEN (v_sla->>'breached')::int > 0 THEN 'degraded' ELSE 'ok' END,
    'communications', CASE WHEN COALESCE(v_comms->>'status','unavailable') <> 'ok' THEN 'unavailable'
                WHEN (v_comms->>'failed_attempts_window')::int > 0 THEN 'degraded' ELSE 'ok' END,
    'arrangements', CASE WHEN COALESCE(v_arrangements->>'status','unavailable') <> 'ok' THEN 'unavailable'
                WHEN (v_arrangements->>'unresolved_breaches')::int > 0 THEN 'degraded' ELSE 'ok' END,
    'field_ops', CASE WHEN COALESCE(v_field->>'status','unavailable') <> 'ok' THEN 'unavailable'
                WHEN (v_field->>'visits_overdue')::int > 0 OR (v_field->>'followups_overdue')::int > 0 THEN 'degraded' ELSE 'ok' END,
    'legal_handoff', CASE WHEN COALESCE(v_legal->>'status','unavailable') <> 'ok' THEN 'unavailable'
                WHEN (v_legal->>'returned_unresolved')::int > 0 OR (v_legal->>'approved_not_handed_off')::int > 0 THEN 'degraded' ELSE 'ok' END,
    'financial', COALESCE(v_financial->>'status','unavailable')
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object('subsystem', key, 'state', value)), '[]'::jsonb)
  INTO v_health_reasons
  FROM jsonb_each_text(v_subsystems) WHERE value IN ('failed','unavailable','degraded');

  v_health := CASE
    WHEN EXISTS (SELECT 1 FROM jsonb_each_text(v_subsystems) WHERE value = 'failed') THEN 'Critical'
    WHEN EXISTS (SELECT 1 FROM jsonb_each_text(v_subsystems) WHERE value = 'unavailable') THEN 'Unknown'
    WHEN EXISTS (SELECT 1 FROM jsonb_each_text(v_subsystems) WHERE value = 'degraded') THEN 'Degraded'
    WHEN (SELECT COUNT(*) FROM _mon_ex WHERE severity IN ('Critical','High')) > 0 THEN 'Attention Required'
    ELSE 'Healthy' END;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'window', p_window,
    'scope', v_scope,
    'technical_access', v_tech,
    'thresholds', v_thresholds,
    'health', jsonb_build_object('state', v_health, 'reasons', v_health_reasons,
      'policy', 'failed subsystem => Critical; unavailable => Unknown; degraded => Degraded; open critical/high exceptions => Attention Required; otherwise Healthy'),
    'subsystems', v_subsystems,
    'kpis', jsonb_build_object(
      'critical_alerts', (SELECT COUNT(*) FROM _mon_ex WHERE severity = 'Critical'),
      'sla_breaches', COALESCE((v_sla->>'breached')::int, NULL),
      'due_24h', COALESCE((v_sla->>'due_24h')::int, NULL),
      'stalled_items', (SELECT COUNT(*) FROM _mon_ex WHERE alert_type = 'stalled'),
      'failed_jobs', CASE WHEN v_jobs IS NULL THEN NULL ELSE
        (SELECT COUNT(*) FROM jsonb_array_elements(v_jobs) j WHERE j->>'status' = 'failed') END,
      'failed_notices', CASE WHEN COALESCE(v_comms->>'status','') <> 'ok' THEN NULL
        ELSE (v_comms->>'failed_attempts_window')::int END,
      'arrangement_breaches_window', CASE WHEN COALESCE(v_arrangements->>'status','') <> 'ok' THEN NULL
        ELSE (v_arrangements->>'new_breaches_window')::int END,
      'unassigned_critical', (SELECT COUNT(*) FROM _mon_ex WHERE alert_type = 'unassigned'),
      'total_exceptions', (SELECT COUNT(*) FROM _mon_ex)
    ),
    'exceptions', v_exceptions,
    'exceptions_status', v_ex_status,
    'sla_summary', v_sla,
    'sla_urgent', v_sla_urgent,
    'sla_trend', v_sla_trend,
    'detection', v_detection,
    'detection_results', v_detection_results,
    'stalled_by_area', v_stalled,
    'stalled_oldest', v_stalled_oldest,
    'arrangements', v_arrangements,
    'financial_exceptions', v_financial,
    'communications', v_comms,
    'field_ops', v_field,
    'legal_handoff', v_legal,
    'jobs', v_jobs,
    'job_failures', v_job_failures,
    'events', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ce_monitoring_v1(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_monitoring_v1(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_cron_interval(text) TO authenticated;