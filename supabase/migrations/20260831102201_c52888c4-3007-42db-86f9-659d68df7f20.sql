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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_page int := GREATEST(COALESCE(p_page,1), 1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25), 5), 200);
  v_mode text := CASE WHEN p_mode = 'review' THEN 'review' ELSE 'assignment' END;
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'asc')) = 'desc' THEN 'desc' ELSE 'asc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''), 'default');
  v_sla_hours int;
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_options jsonb;
  v_workload jsonb := '[]'::jsonb;
  v_own boolean;

  f_search   text := NULLIF(trim(p_filters->>'search'),'');
  f_worktype text := NULLIF(p_filters->>'work_type','');
  f_status   text := NULLIF(p_filters->>'status','');
  f_priority text := NULLIF(p_filters->>'priority','');
  f_owner    text := NULLIF(p_filters->>'owner','');
  f_zone     uuid := NULLIF(p_filters->>'zone','')::uuid;
  f_queue    uuid := NULLIF(p_filters->>'queue','')::uuid;
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
  f_min_age int := NULLIF(p_filters->>'min_age_days','')::int;
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
    RAISE EXCEPTION 'Not authorised for the compliance work queue';
  END IF;
  v_own := (v_scope = 'own');

  SELECT COALESCE(MAX(setting_value)::int, 48) INTO v_sla_hours
  FROM public.ce_settings WHERE setting_key = 'compliance.review.sla_hours';
  v_sla_hours := COALESCE(v_sla_hours, 48);

  WITH base AS (
    SELECT 'Violation'::text AS work_type,
           COALESCE(vt.name,'Violation')::text AS item_type,
           v.violation_number::text AS record_ref,
           v.id::text AS record_id,
           ('/compliance/violations/' || v.id::text) AS route,
           v.employer_id::text, v.employer_name::text, v.zone_id, v.status::text,
           COALESCE(NULLIF(upper(v.priority),''), NULLIF(upper(v.severity),''))::text AS priority,
           NULL::text AS risk_band,
           v.assigned_to_user_id::text AS owner_id, v.assigned_to_name::text AS owner_name,
           v.assigned_queue_id AS queue_id,
           v.created_at, v.assigned_at,
           COALESCE(v.updated_at, v.created_at) AS waiting_since,
           v.due_date,
           true AS reassignable
    FROM public.ce_violations v
    LEFT JOIN public.ce_violation_types vt ON vt.id = v.violation_type_id
    WHERE COALESCE(v.is_deleted,false) = false
      AND upper(COALESCE(v.status,'')) NOT IN ('CLOSED','CANCELLED','RESOLVED')
      AND (NOT v_own OR v.assigned_to_user_id = v_uid::text)
      AND (v_mode <> 'review' OR upper(COALESCE(v.status,'')) IN ('UNDER_REVIEW','ESCALATED')
           OR v.verification_decision = 'SENT_BACK')

    UNION ALL

    SELECT 'Case', COALESCE(c.case_type,'Case'), c.case_number, c.id::text,
           '/compliance/cases/' || c.id::text,
           c.employer_id, c.employer_name, NULL::uuid, c.status,
           NULLIF(upper(c.priority),''), c.risk_band,
           c.assigned_officer_id::text, c.assigned_officer_name, NULL::uuid,
           c.created_at, NULL::timestamptz, COALESCE(c.updated_at, c.created_at),
           c.target_resolution_date,
           false
    FROM public.ce_cases c
    WHERE COALESCE(c.is_deleted,false) = false
      AND NOT EXISTS (SELECT 1 FROM public.ce_case_status_masters m
                      WHERE m.status_code = c.status AND m.is_terminal)
      AND (NOT v_own OR c.assigned_officer_id::text = v_uid::text)
      AND (v_mode <> 'review' OR EXISTS (
            SELECT 1 FROM public.ce_case_status_masters m
            WHERE m.status_code = c.status AND upper(COALESCE(m.category,'')) LIKE '%REVIEW%'))

    UNION ALL

    SELECT 'Inspection', COALESCE(i.inspection_type,'Inspection'), i.inspection_number, i.id::text,
           '/compliance/field/audit-management',
           i.employer_id, i.employer_name, NULL::uuid, i.status,
           NULL::text, NULL::text,
           i.inspector_id::text, i.inspector_name, NULL::uuid,
           i.created_at, NULL::timestamptz, COALESCE(i.updated_at, i.created_at),
           i.scheduled_date::date,
           false
    FROM public.ce_inspections i
    WHERE upper(COALESCE(i.status,'')) NOT IN ('COMPLETED','CANCELLED')
      AND (NOT v_own OR i.inspector_id::text = v_uid::text)
      AND (v_mode <> 'review' OR upper(COALESCE(i.status,'')) IN ('PENDING_REVIEW','SUBMITTED'))

    UNION ALL

    SELECT 'Follow-up', COALESCE(f.action_type,'Follow-up'), COALESCE(f.action_type,'FOLLOW-UP'), f.id::text,
           CASE WHEN f.violation_id IS NOT NULL
                THEN '/compliance/violations/' || f.violation_id::text
                ELSE '/compliance/workbench/queues' END,
           f.employer_id, f.employer_name, NULL::uuid, f.status,
           NULLIF(upper(f.priority),''), NULL::text,
           f.assigned_to_user_id::text, f.assigned_to_name, f.assigned_queue_id,
           f.created_at, NULL::timestamptz, COALESCE(f.updated_at, f.created_at),
           f.due_date,
           false
    FROM public.ce_follow_up_actions f
    WHERE COALESCE(f.is_deleted,false) = false
      AND upper(COALESCE(f.status,'')) NOT IN ('COMPLETED','CANCELLED','CLOSED')
      AND f.due_date BETWEEN v_today - 365 AND v_today + 180
      AND (NOT v_own OR f.assigned_to_user_id = v_uid::text)
      AND (v_mode <> 'review' OR upper(COALESCE(f.status,'')) IN ('PENDING_REVIEW','SUBMITTED'))
  ),
  filtered AS (
    SELECT b.*,
           CASE upper(COALESCE(b.priority,''))
             WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
             WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END AS priority_rank
    FROM base b
    WHERE (f_search IS NULL OR (
             COALESCE(b.employer_name,'') ILIKE '%'||f_search||'%'
             OR COALESCE(b.employer_id,'') ILIKE '%'||f_search||'%'
             OR COALESCE(b.record_ref,'') ILIKE '%'||f_search||'%'))
      AND (f_worktype IS NULL OR b.work_type = f_worktype)
      AND (f_itemtype IS NULL OR b.item_type = f_itemtype)
      AND (f_status IS NULL OR b.status = f_status)
      AND (f_priority IS NULL OR upper(COALESCE(b.priority,'')) = upper(f_priority))
      AND (f_owner IS NULL OR b.owner_id = f_owner)
      AND (f_zone IS NULL OR b.zone_id = f_zone)
      AND (f_queue IS NULL OR b.queue_id = f_queue)
      AND (f_employer IS NULL OR b.employer_id = f_employer)
      AND (NOT f_unassigned OR b.owner_id IS NULL)
      AND (NOT f_mine OR b.owner_id = v_uid::text)
      AND (NOT f_overdue OR (b.due_date IS NOT NULL AND b.due_date < v_today))
      AND (NOT f_due_today OR b.due_date = v_today)
      AND (f_due_from IS NULL OR (b.due_date IS NOT NULL AND b.due_date >= f_due_from))
      AND (f_due_to IS NULL OR (b.due_date IS NOT NULL AND b.due_date <= f_due_to))
      AND (f_created_from IS NULL OR b.created_at >= f_created_from)
      AND (f_created_to IS NULL OR b.created_at < f_created_to + 1)
      AND (f_min_age IS NULL OR COALESCE(b.assigned_at, b.created_at) <= now() - make_interval(days => f_min_age))
  ),
  counted AS (SELECT count(*) AS n FROM filtered),
  ranked AS (
    SELECT f.*,
           row_number() OVER (ORDER BY
             CASE WHEN v_sort = 'default' AND v_mode = 'assignment'
                  THEN (CASE WHEN f.owner_id IS NULL THEN 0 ELSE 1 END) END ASC,
             CASE WHEN v_sort = 'default'
                  THEN (CASE WHEN f.due_date IS NOT NULL AND f.due_date < v_today THEN 0 ELSE 1 END) END ASC,
             CASE WHEN v_sort = 'default' THEN f.priority_rank END ASC,
             CASE WHEN v_sort = 'default' AND v_mode = 'review' THEN f.waiting_since END ASC,
             CASE WHEN v_sort = 'default' THEN f.due_date END ASC NULLS LAST,
             CASE WHEN v_dir = 'asc' THEN
               CASE v_sort WHEN 'priority' THEN f.priority_rank::text
                           WHEN 'status' THEN f.status
                           WHEN 'employer' THEN lower(COALESCE(f.employer_name, f.employer_id,''))
                           WHEN 'work_type' THEN f.work_type
                           WHEN 'owner' THEN lower(COALESCE(f.owner_name,'zzz'))
                           WHEN 'risk' THEN COALESCE(f.risk_band,'zzz') END END ASC NULLS LAST,
             CASE WHEN v_dir = 'desc' THEN
               CASE v_sort WHEN 'priority' THEN f.priority_rank::text
                           WHEN 'status' THEN f.status
                           WHEN 'employer' THEN lower(COALESCE(f.employer_name, f.employer_id,''))
                           WHEN 'work_type' THEN f.work_type
                           WHEN 'owner' THEN lower(COALESCE(f.owner_name,'zzz'))
                           WHEN 'risk' THEN COALESCE(f.risk_band,'zzz') END END DESC NULLS LAST,
             CASE WHEN v_dir = 'asc' THEN
               CASE v_sort WHEN 'due_date' THEN f.due_date::timestamptz
                           WHEN 'created' THEN f.created_at
                           WHEN 'assigned' THEN f.assigned_at
                           WHEN 'age' THEN COALESCE(f.assigned_at, f.created_at)
                           WHEN 'waiting' THEN f.waiting_since END END ASC NULLS LAST,
             CASE WHEN v_dir = 'desc' THEN
               CASE v_sort WHEN 'due_date' THEN f.due_date::timestamptz
                           WHEN 'created' THEN f.created_at
                           WHEN 'assigned' THEN f.assigned_at
                           WHEN 'age' THEN COALESCE(f.assigned_at, f.created_at)
                           WHEN 'waiting' THEN f.waiting_since END END DESC NULLS LAST,
             f.created_at DESC) AS rn
    FROM filtered f
  ),
  page AS (
    SELECT r.*, rp.risk_band AS profile_band
    FROM ranked r
    LEFT JOIN public.ce_risk_profiles rp ON rp.employer_id = r.employer_id
    WHERE r.rn > (v_page - 1) * v_size AND r.rn <= v_page * v_size
  )
  SELECT (SELECT n FROM counted),
         COALESCE(jsonb_agg(jsonb_build_object(
           'work_type', p.work_type, 'item_type', p.item_type,
           'record_ref', p.record_ref, 'record_id', p.record_id, 'route', p.route,
           'employer_id', p.employer_id, 'employer_name', p.employer_name,
           'status', p.status, 'priority', p.priority, 'priority_rank', p.priority_rank,
           'risk_band', COALESCE(p.risk_band, p.profile_band),
           'owner_id', p.owner_id, 'owner_name', p.owner_name,
           'queue_name', q.queue_name, 'zone_code', z.zone_code,
           'due_date', p.due_date, 'created_at', p.created_at, 'assigned_at', p.assigned_at,
           'reassignable', p.reassignable,
           'unassigned', p.owner_id IS NULL,
           'is_mine', p.owner_id = v_uid::text,
           'overdue', (p.due_date IS NOT NULL AND p.due_date < v_today),
           'days_to_due', CASE WHEN p.due_date IS NOT NULL THEN (p.due_date - v_today) END,
           'age_hours', EXTRACT(epoch FROM (now() - COALESCE(p.assigned_at, p.created_at)))/3600,
           'waiting_hours', EXTRACT(epoch FROM (now() - p.waiting_since))/3600,
           'waiting_breach', (EXTRACT(epoch FROM (now() - p.waiting_since))/3600) > v_sla_hours
         ) ORDER BY p.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p
  LEFT JOIN public.ce_assignment_queues q ON q.id = p.queue_id
  LEFT JOIN public.ce_zones z ON z.id = p.zone_id;

  v_total := COALESCE(v_total, 0);

  SELECT jsonb_build_object(
    'work_types', jsonb_build_array('Violation','Case','Inspection','Follow-up'),
    'item_types', (SELECT COALESCE(jsonb_agg(DISTINCT name ORDER BY name),'[]'::jsonb)
                   FROM public.ce_violation_types WHERE is_active),
    'statuses', (
      SELECT COALESCE(jsonb_agg(DISTINCT s ORDER BY s),'[]'::jsonb) FROM (
        SELECT unnest(ARRAY['OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED','DRAFT','PENDING','PENDING_REVIEW','SCHEDULED','SUBMITTED']) AS s
        UNION
        SELECT status_code FROM public.ce_case_status_masters WHERE is_active AND NOT is_terminal
      ) t),
    'priorities', jsonb_build_array('CRITICAL','HIGH','MEDIUM','LOW'),
    'risk_bands', (SELECT COALESCE(jsonb_agg(DISTINCT band_name ORDER BY band_name),'[]'::jsonb)
                   FROM public.ce_risk_bands),
    'owners', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.nm) ORDER BY o.nm),'[]'::jsonb)
      FROM (
        SELECT DISTINCT COALESCE(i.profile_id::text, i.id::text) AS id,
               COALESCE(pr.full_name, i.inspector_code, left(i.id::text,8)) AS nm
        FROM public.ce_inspectors i
        LEFT JOIN public.profiles pr ON pr.id = i.profile_id
        WHERE i.is_active
      ) o),
    'zones', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', z.id, 'code', z.zone_code, 'name', z.zone_name) ORDER BY z.zone_code),'[]'::jsonb)
              FROM public.ce_zones z WHERE z.is_active),
    'queues', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.queue_name, 'type', q.queue_type) ORDER BY q.queue_name),'[]'::jsonb)
               FROM public.ce_assignment_queues q WHERE q.is_active)
  ) INTO v_options;

  IF v_mode = 'assignment' THEN
    SELECT COALESCE(jsonb_agg(o ORDER BY o->>'officer_name'), '[]'::jsonb) INTO v_workload
    FROM (
      SELECT jsonb_build_object(
        'owner_id', w.owner_id,
        'officer_name', COALESCE(max(w.owner_name), left(w.owner_id,12)),
        'active_work', count(*),
        'overdue', count(*) FILTER (WHERE w.due_date IS NOT NULL AND w.due_date < v_today),
        'critical_high', count(*) FILTER (WHERE upper(COALESCE(w.priority,'')) IN ('CRITICAL','HIGH')),
        'due_this_week', count(*) FILTER (WHERE w.due_date BETWEEN v_today AND v_today + 7),
        'oldest_assignment', min(COALESCE(w.assigned_at, w.created_at))
      ) o
      FROM (
        SELECT v.assigned_to_user_id::text AS owner_id, v.assigned_to_name::text AS owner_name,
               upper(COALESCE(v.priority, v.severity))::text AS priority,
               v.due_date, v.assigned_at, v.created_at
        FROM public.ce_violations v
        WHERE COALESCE(v.is_deleted,false) = false
          AND upper(COALESCE(v.status,'')) NOT IN ('CLOSED','CANCELLED','RESOLVED')
          AND v.assigned_to_user_id IS NOT NULL
          AND (NOT v_own OR v.assigned_to_user_id = v_uid::text)
      ) w
      GROUP BY w.owner_id
    ) s;
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'mode', v_mode,
    'scope', v_scope,
    'page', v_page,
    'page_size', v_size,
    'total', v_total,
    'grand_total', v_total,
    'sla_hours', v_sla_hours,
    'sort', v_sort,
    'dir', v_dir,
    'rows', v_rows,
    'options', v_options,
    'workload', v_workload
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ce_work_queue_v1(text, jsonb, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_work_queue_v1(text, jsonb, text, text, int, int) TO authenticated;