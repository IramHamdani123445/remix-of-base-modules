CREATE OR REPLACE FUNCTION public.ce_work_queue_v1(
  p_mode text DEFAULT 'assignment',
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'default',
  p_dir text DEFAULT 'asc',
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_page int := GREATEST(COALESCE(p_page,1), 1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25), 5), 200);
  v_total bigint := 0;
  v_grand bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_options jsonb;
  v_workload jsonb := '[]'::jsonb;
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'asc')) = 'desc' THEN 'desc' ELSE 'asc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''), 'default');
  v_sla_hours int;

  f_search   text := NULLIF(trim(p_filters->>'search'),'');
  f_worktype text := NULLIF(p_filters->>'work_type','');
  f_status   text := NULLIF(p_filters->>'status','');
  f_priority text := NULLIF(p_filters->>'priority','');
  f_owner    text := NULLIF(p_filters->>'owner','');
  f_zone     text := NULLIF(p_filters->>'zone','');
  f_queue    text := NULLIF(p_filters->>'queue','');
  f_employer text := NULLIF(p_filters->>'employer','');
  f_risk     text := NULLIF(p_filters->>'risk_band','');
  f_itemtype text := NULLIF(p_filters->>'item_type','');
  f_unassigned boolean := COALESCE((p_filters->>'unassigned_only')::boolean, false);
  f_mine     boolean := COALESCE((p_filters->>'mine_only')::boolean, false);
  f_overdue  boolean := COALESCE((p_filters->>'overdue_only')::boolean, false);
  f_due_today boolean := COALESCE((p_filters->>'due_today')::boolean, false);
  f_due_from date := NULLIF(p_filters->>'due_from','')::date;
  f_due_to   date := NULLIF(p_filters->>'due_to','')::date;
  f_created_from date := NULLIF(p_filters->>'created_from','')::date;
  f_created_to   date := NULLIF(p_filters->>'created_to','')::date;
  f_assigned_from date := NULLIF(p_filters->>'assigned_from','')::date;
  f_assigned_to   date := NULLIF(p_filters->>'assigned_to','')::date;
  f_min_age int := NULLIF(p_filters->>'min_age_days','')::int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Data scope is resolved BEFORE any user filter is applied, so a filter can
  -- only ever narrow the authorised set, never widen it.
  IF public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN
    v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN
    v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid, 'compliance.reports.operational') THEN
    v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'Not authorised for the compliance work queue';
  END IF;

  SELECT COALESCE(MAX(setting_value)::int, 48) INTO v_sla_hours
  FROM public.ce_settings
  WHERE setting_key = 'compliance.review.sla_hours';
  v_sla_hours := COALESCE(v_sla_hours, 48);

  DROP TABLE IF EXISTS _wq;
  CREATE TEMP TABLE _wq (
    work_type text, item_type text, record_ref text, record_id text, route text,
    employer_id text, employer_name text, zone_id uuid, status text,
    priority text, priority_rank int, risk_band text,
    owner_id text, owner_name text, queue_id uuid,
    created_at timestamptz, assigned_at timestamptz, waiting_since timestamptz,
    due_date date, review_pending boolean, reassignable boolean
  ) ON COMMIT DROP;

  INSERT INTO _wq
  SELECT 'Violation', COALESCE(vt.name, 'Violation'), v.violation_number, v.id::text,
         '/compliance/violations/' || v.id::text,
         v.employer_id, v.employer_name, v.zone_id, v.status,
         COALESCE(NULLIF(upper(v.priority),''), NULLIF(upper(v.severity),'')),
         NULL, NULL,
         v.assigned_to_user_id, v.assigned_to_name, v.assigned_queue_id,
         v.created_at, v.assigned_at, COALESCE(v.updated_at, v.created_at), v.due_date,
         upper(COALESCE(v.status,'')) IN ('UNDER_REVIEW','ESCALATED')
           OR v.verification_decision = 'SENT_BACK',
         true
  FROM public.ce_violations v
  LEFT JOIN public.ce_violation_types vt ON vt.id = v.violation_type_id
  WHERE COALESCE(v.is_deleted,false) = false
    AND upper(COALESCE(v.status,'')) NOT IN ('CLOSED','CANCELLED','RESOLVED');

  INSERT INTO _wq
  SELECT 'Case', COALESCE(c.case_type,'Case'), c.case_number, c.id::text,
         '/compliance/cases/' || c.id::text,
         c.employer_id, c.employer_name, NULL, c.status,
         NULLIF(upper(c.priority),''), NULL, c.risk_band,
         c.assigned_officer_id, c.assigned_officer_name, NULL,
         c.created_at, NULL, COALESCE(c.updated_at, c.created_at), c.target_resolution_date,
         EXISTS (SELECT 1 FROM public.ce_case_status_masters m
                 WHERE m.status_code = c.status AND upper(COALESCE(m.category,'')) LIKE '%REVIEW%'),
         false
  FROM public.ce_cases c
  WHERE COALESCE(c.is_deleted,false) = false
    AND NOT EXISTS (SELECT 1 FROM public.ce_case_status_masters m
                    WHERE m.status_code = c.status AND m.is_terminal);

  INSERT INTO _wq
  SELECT 'Inspection', COALESCE(i.inspection_type,'Inspection'), i.inspection_number, i.id::text,
         '/compliance/field/audit-management',
         i.employer_id, i.employer_name, NULL, i.status,
         NULL, NULL, NULL,
         i.inspector_id::text, i.inspector_name, NULL,
         i.created_at, NULL, COALESCE(i.updated_at, i.created_at), i.scheduled_date::date,
         upper(COALESCE(i.status,'')) IN ('PENDING_REVIEW','SUBMITTED'),
         false
  FROM public.ce_inspections i
  WHERE upper(COALESCE(i.status,'')) NOT IN ('COMPLETED','CANCELLED');

  INSERT INTO _wq
  SELECT 'Follow-up', COALESCE(f.action_type,'Follow-up'), COALESCE(f.action_type,'FOLLOW-UP'), f.id::text,
         CASE WHEN f.violation_id IS NOT NULL
              THEN '/compliance/violations/' || f.violation_id::text
              ELSE '/compliance/workbench/queues' END,
         f.employer_id, f.employer_name, NULL, f.status,
         NULLIF(upper(f.priority),''), NULL, NULL,
         f.assigned_to_user_id, f.assigned_to_name, f.assigned_queue_id,
         f.created_at, NULL, COALESCE(f.updated_at, f.created_at), f.due_date,
         upper(COALESCE(f.status,'')) IN ('PENDING_REVIEW','SUBMITTED'),
         false
  FROM public.ce_follow_up_actions f
  WHERE COALESCE(f.is_deleted,false) = false
    AND upper(COALESCE(f.status,'')) NOT IN ('COMPLETED','CANCELLED','CLOSED')
    AND f.due_date BETWEEN v_today - 365 AND v_today + 180;

  UPDATE _wq SET priority_rank = CASE upper(COALESCE(priority,''))
      WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3
      WHEN 'LOW' THEN 4 ELSE 5 END
  WHERE priority_rank IS NULL;

  UPDATE _wq w SET risk_band = COALESCE(w.risk_band, r.risk_band)
  FROM public.ce_risk_profiles r
  WHERE r.employer_id = w.employer_id AND w.risk_band IS NULL;

  -- Authorised scope, applied first.
  IF v_scope = 'own' THEN
    DELETE FROM _wq WHERE owner_id IS DISTINCT FROM v_uid::text;
  END IF;

  IF p_mode = 'review' THEN
    DELETE FROM _wq WHERE review_pending IS NOT TRUE;
  END IF;

  SELECT count(*) INTO v_grand FROM _wq;

  -- Option lists derive from the authorised set, so they cannot leak values.
  SELECT jsonb_build_object(
    'work_types', (SELECT COALESCE(jsonb_agg(DISTINCT work_type ORDER BY work_type),'[]'::jsonb) FROM _wq),
    'item_types', (SELECT COALESCE(jsonb_agg(DISTINCT item_type ORDER BY item_type),'[]'::jsonb) FROM _wq WHERE item_type IS NOT NULL),
    'statuses',   (SELECT COALESCE(jsonb_agg(DISTINCT status ORDER BY status),'[]'::jsonb) FROM _wq WHERE status IS NOT NULL),
    'priorities', (SELECT COALESCE(jsonb_agg(DISTINCT upper(priority) ORDER BY upper(priority)),'[]'::jsonb) FROM _wq WHERE priority IS NOT NULL),
    'risk_bands', (SELECT COALESCE(jsonb_agg(DISTINCT risk_band ORDER BY risk_band),'[]'::jsonb) FROM _wq WHERE risk_band IS NOT NULL),
    'owners',     (SELECT COALESCE(jsonb_agg(o ORDER BY o->>'name'),'[]'::jsonb) FROM (
                     SELECT DISTINCT jsonb_build_object('id', owner_id, 'name', COALESCE(owner_name, left(owner_id,12))) o
                     FROM _wq WHERE owner_id IS NOT NULL) s),
    'zones',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', z.id, 'code', z.zone_code, 'name', z.zone_name) ORDER BY z.zone_code),'[]'::jsonb)
                   FROM public.ce_zones z WHERE z.is_active),
    'queues',     (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.queue_name, 'type', q.queue_type) ORDER BY q.queue_name),'[]'::jsonb)
                   FROM public.ce_assignment_queues q WHERE q.is_active)
  ) INTO v_options;

  -- User filters, applied to the authorised set only.
  DELETE FROM _wq WHERE
       (f_search IS NOT NULL AND NOT (
          COALESCE(employer_name,'') ILIKE '%'||f_search||'%'
          OR COALESCE(employer_id,'') ILIKE '%'||f_search||'%'
          OR COALESCE(record_ref,'') ILIKE '%'||f_search||'%'))
    OR (f_worktype IS NOT NULL AND work_type <> f_worktype)
    OR (f_itemtype IS NOT NULL AND item_type IS DISTINCT FROM f_itemtype)
    OR (f_status IS NOT NULL AND status IS DISTINCT FROM f_status)
    OR (f_priority IS NOT NULL AND upper(COALESCE(priority,'')) <> upper(f_priority))
    OR (f_owner IS NOT NULL AND owner_id IS DISTINCT FROM f_owner)
    OR (f_zone IS NOT NULL AND zone_id IS DISTINCT FROM f_zone::uuid)
    OR (f_queue IS NOT NULL AND queue_id IS DISTINCT FROM f_queue::uuid)
    OR (f_employer IS NOT NULL AND COALESCE(employer_id,'') <> f_employer)
    OR (f_risk IS NOT NULL AND risk_band IS DISTINCT FROM f_risk)
    OR (f_unassigned AND owner_id IS NOT NULL)
    OR (f_mine AND owner_id IS DISTINCT FROM v_uid::text)
    OR (f_overdue AND NOT (due_date IS NOT NULL AND due_date < v_today))
    OR (f_due_today AND due_date IS DISTINCT FROM v_today)
    OR (f_due_from IS NOT NULL AND (due_date IS NULL OR due_date < f_due_from))
    OR (f_due_to IS NOT NULL AND (due_date IS NULL OR due_date > f_due_to))
    OR (f_created_from IS NOT NULL AND created_at < f_created_from)
    OR (f_created_to IS NOT NULL AND created_at >= f_created_to + 1)
    OR (f_assigned_from IS NOT NULL AND (assigned_at IS NULL OR assigned_at < f_assigned_from))
    OR (f_assigned_to IS NOT NULL AND (assigned_at IS NULL OR assigned_at >= f_assigned_to + 1))
    OR (f_min_age IS NOT NULL AND COALESCE(assigned_at, created_at) > now() - make_interval(days => f_min_age));

  SELECT count(*) INTO v_total FROM _wq;

  -- Sorting is applied to the whole matching set, before paging.
  SELECT COALESCE(jsonb_agg(r ORDER BY rn), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT to_jsonb(x) - 'rn' AS r, x.rn
    FROM (
      SELECT
        w.work_type, w.item_type, w.record_ref, w.record_id, w.route,
        w.employer_id, w.employer_name, w.status, w.priority, w.priority_rank,
        w.risk_band, w.owner_id, w.owner_name, w.due_date, w.created_at,
        w.assigned_at, w.reassignable,
        z.zone_code, q.queue_name,
        (w.owner_id IS NULL) AS unassigned,
        (w.owner_id = v_uid::text) AS is_mine,
        (w.due_date IS NOT NULL AND w.due_date < v_today) AS overdue,
        CASE WHEN w.due_date IS NOT NULL THEN (w.due_date - v_today) END AS days_to_due,
        EXTRACT(epoch FROM (now() - COALESCE(w.assigned_at, w.created_at)))/3600 AS age_hours,
        EXTRACT(epoch FROM (now() - w.waiting_since))/3600 AS waiting_hours,
        (EXTRACT(epoch FROM (now() - w.waiting_since))/3600) > v_sla_hours AS waiting_breach,
        row_number() OVER (ORDER BY
          CASE WHEN v_sort = 'default' AND p_mode = 'assignment'
               THEN (CASE WHEN w.owner_id IS NULL THEN 0 ELSE 1 END) END ASC,
          CASE WHEN v_sort = 'default'
               THEN (CASE WHEN w.due_date IS NOT NULL AND w.due_date < v_today THEN 0 ELSE 1 END) END ASC,
          CASE WHEN v_sort = 'default' THEN w.priority_rank END ASC,
          CASE WHEN v_sort = 'default' AND p_mode = 'review' THEN w.waiting_since END ASC,
          CASE WHEN v_sort = 'default' THEN w.due_date END ASC NULLS LAST,
          CASE WHEN v_dir = 'asc' THEN
            CASE v_sort WHEN 'priority' THEN w.priority_rank::text
                        WHEN 'status' THEN w.status
                        WHEN 'employer' THEN lower(COALESCE(w.employer_name, w.employer_id,''))
                        WHEN 'work_type' THEN w.work_type
                        WHEN 'owner' THEN lower(COALESCE(w.owner_name,'zzz'))
                        WHEN 'risk' THEN COALESCE(w.risk_band,'zzz') END
          END ASC NULLS LAST,
          CASE WHEN v_dir = 'desc' THEN
            CASE v_sort WHEN 'priority' THEN w.priority_rank::text
                        WHEN 'status' THEN w.status
                        WHEN 'employer' THEN lower(COALESCE(w.employer_name, w.employer_id,''))
                        WHEN 'work_type' THEN w.work_type
                        WHEN 'owner' THEN lower(COALESCE(w.owner_name,'zzz'))
                        WHEN 'risk' THEN COALESCE(w.risk_band,'zzz') END
          END DESC NULLS LAST,
          CASE WHEN v_dir = 'asc' THEN
            CASE v_sort WHEN 'due_date' THEN w.due_date::timestamptz
                        WHEN 'created' THEN w.created_at
                        WHEN 'assigned' THEN w.assigned_at
                        WHEN 'age' THEN COALESCE(w.assigned_at, w.created_at)
                        WHEN 'waiting' THEN w.waiting_since END
          END ASC NULLS LAST,
          CASE WHEN v_dir = 'desc' THEN
            CASE v_sort WHEN 'due_date' THEN w.due_date::timestamptz
                        WHEN 'created' THEN w.created_at
                        WHEN 'assigned' THEN w.assigned_at
                        WHEN 'age' THEN COALESCE(w.assigned_at, w.created_at)
                        WHEN 'waiting' THEN w.waiting_since END
          END DESC NULLS LAST,
          w.created_at DESC
        ) AS rn
      FROM _wq w
      LEFT JOIN public.ce_zones z ON z.id = w.zone_id
      LEFT JOIN public.ce_assignment_queues q ON q.id = w.queue_id
    ) x
    WHERE x.rn > (v_page - 1) * v_size AND x.rn <= v_page * v_size
  ) y;

  IF p_mode = 'assignment' THEN
    SELECT COALESCE(jsonb_agg(o ORDER BY o->>'officer_name'), '[]'::jsonb) INTO v_workload
    FROM (
      SELECT jsonb_build_object(
        'owner_id', owner_id,
        'officer_name', COALESCE(max(owner_name), left(owner_id,12)),
        'active_work', count(*),
        'overdue', count(*) FILTER (WHERE due_date IS NOT NULL AND due_date < v_today),
        'critical_high', count(*) FILTER (WHERE priority_rank <= 2),
        'due_this_week', count(*) FILTER (WHERE due_date BETWEEN v_today AND v_today + 7),
        'oldest_assignment', min(COALESCE(assigned_at, created_at))
      ) o
      FROM _wq WHERE owner_id IS NOT NULL
      GROUP BY owner_id
    ) s;
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'mode', p_mode,
    'scope', v_scope,
    'page', v_page,
    'page_size', v_size,
    'total', v_total,
    'grand_total', v_grand,
    'sla_hours', v_sla_hours,
    'sort', v_sort,
    'dir', v_dir,
    'rows', v_rows,
    'options', v_options,
    'workload', v_workload
  );
END;
$$;