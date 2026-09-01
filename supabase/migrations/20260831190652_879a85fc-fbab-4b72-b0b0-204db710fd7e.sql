-- =====================================================================
-- Compliance Field Operations : enterprise register + governed lifecycle
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ce_field_ops_scope(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN 'NONE'
    WHEN public.is_admin(_user_id) THEN 'ALL'
    WHEN public.ce_compliance_role(_user_id) IN ('head','senior') THEN 'ALL'
    WHEN public.ce_actor_can(_user_id, 'compliance.workbench.team') THEN 'ALL'
    WHEN public.ce_actor_can(_user_id, 'compliance.field.execute') THEN 'OWN'
    WHEN public.has_permission(_user_id, 'manage_compliance', 'view') THEN 'ALL'
    ELSE 'NONE'
  END
$$;

GRANT EXECUTE ON FUNCTION public.ce_field_ops_scope(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Register
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_field_operations_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'schedule',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_export boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text := public.ce_field_ops_scope(auth.uid());
  v_search text := NULLIF(trim(coalesce(p_filters->>'search','')), '');
  v_quick text := upper(coalesce(NULLIF(p_filters->>'quick',''), 'ALL'));
  v_statuses text[] := CASE WHEN p_filters ? 'statuses'
      THEN ARRAY(SELECT upper(jsonb_array_elements_text(p_filters->'statuses'))) END;
  v_types text[] := CASE WHEN p_filters ? 'visit_types'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'visit_types')) END;
  v_territories text[] := CASE WHEN p_filters ? 'territories'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'territories')) END;
  v_inspector text := NULLIF(p_filters->>'inspector','');
  v_employer text := NULLIF(p_filters->>'employer','');
  v_plan text := NULLIF(p_filters->>'plan_id','');
  v_from date := NULLIF(p_filters->>'date_from','')::date;
  v_to date := NULLIF(p_filters->>'date_to','')::date;
  v_mine boolean := coalesce((p_filters->>'mine_only')::boolean, false);
  v_page integer := greatest(1, coalesce(p_page,1));
  v_size integer := least(greatest(coalesce(p_page_size,25),1), CASE WHEN p_export THEN 2000 ELSE 200 END);
  v_dir text := CASE WHEN lower(coalesce(p_dir,'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := lower(coalesce(NULLIF(p_sort,''),'schedule'));
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_total bigint := 0;
  v_kpis jsonb;
  v_rows jsonb;
BEGIN
  IF v_scope = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view field operations'
      USING ERRCODE = '42501';
  END IF;

  CREATE TEMP TABLE _ce_fo_base ON COMMIT DROP AS
  WITH base AS (
    SELECT
      i.id,
      i.plan_id,
      w.plan_number,
      w.status                              AS plan_status,
      w.inspector_id,
      coalesce(w.inspector_name, pr.full_name)  AS inspector_name,
      coalesce(pr.user_code, pr.employee_code)  AS inspector_code,
      i.employer_id,
      i.employer_name,
      coalesce(NULLIF(i.territory,''), NULLIF(i.area_name,'')) AS territory,
      coalesce(NULLIF(i.visit_type,''), i.item_type, 'VISIT')  AS visit_type,
      i.purpose,
      i.priority,
      i.source_type,
      i.source_ref,
      i.is_mandatory,
      i.scheduled_date,
      i.scheduled_start_time,
      i.scheduled_end_time,
      upper(coalesce(i.execution_status,'PLANNED')) AS execution_status,
      i.check_in_time,
      i.check_in_gps_lat,
      i.check_in_gps_lng,
      i.check_out_time,
      i.check_out_gps_lat,
      i.check_out_gps_lng,
      i.outcome_notes,
      i.findings          AS findings_note,
      i.not_done_reason,
      i.rescheduled_to,
      i.created_at,
      i.updated_at,
      insp.id             AS inspection_id,
      insp.inspection_number,
      insp.status         AS inspection_status,
      (SELECT count(*) FROM public.ce_inspection_evidence e
         WHERE e.plan_item_id = i.id
            OR (insp.id IS NOT NULL AND e.inspection_id = insp.id))::int AS evidence_count,
      (SELECT count(*) FROM public.ce_inspection_findings f
         WHERE insp.id IS NOT NULL AND f.inspection_id = insp.id)::int   AS findings_count,
      (SELECT count(*) FROM public.ce_inspection_working_papers wp
         WHERE insp.id IS NOT NULL AND wp.inspection_id = insp.id)::int  AS working_papers_count,
      CASE
        WHEN i.check_in_time IS NOT NULL AND i.check_out_time IS NOT NULL
          THEN round(extract(epoch FROM (i.check_out_time - i.check_in_time)) / 60.0)::int
        WHEN i.check_in_time IS NOT NULL
          THEN round(extract(epoch FROM (now() - i.check_in_time)) / 60.0)::int
        ELSE NULL
      END AS duration_minutes,
      (i.scheduled_date < v_today
        AND upper(coalesce(i.execution_status,'PLANNED')) IN ('PLANNED','PENDING')) AS is_overdue,
      (v_today - i.scheduled_date) AS age_days
    FROM public.ce_weekly_plan_items i
    JOIN public.ce_weekly_plans w ON w.id = i.plan_id
    LEFT JOIN public.profiles pr ON pr.id = w.inspector_id
    LEFT JOIN LATERAL (
      SELECT x.id, x.inspection_number, x.status
      FROM public.ce_inspections x
      WHERE x.plan_item_id = i.id
      ORDER BY x.created_at DESC
      LIMIT 1
    ) insp ON true
    WHERE coalesce(w.is_current_version, true)
  )
  SELECT * FROM base b
  WHERE (v_scope = 'ALL' OR b.inspector_id = v_uid)
    AND (NOT v_mine OR b.inspector_id = v_uid)
    AND (v_statuses IS NULL OR array_length(v_statuses,1) IS NULL OR b.execution_status = ANY(v_statuses))
    AND (v_types IS NULL OR array_length(v_types,1) IS NULL OR b.visit_type = ANY(v_types))
    AND (v_territories IS NULL OR array_length(v_territories,1) IS NULL OR b.territory = ANY(v_territories))
    AND (v_inspector IS NULL OR b.inspector_id::text = v_inspector
         OR lower(coalesce(b.inspector_name,'')) = lower(v_inspector)
         OR lower(coalesce(b.inspector_code,'')) = lower(v_inspector))
    AND (v_employer IS NULL OR b.employer_id = v_employer)
    AND (v_plan IS NULL OR b.plan_id::text = v_plan)
    AND (v_from IS NULL OR b.scheduled_date >= v_from)
    AND (v_to IS NULL OR b.scheduled_date <= v_to)
    AND (
      v_search IS NULL OR
      b.employer_name ILIKE '%'||v_search||'%' OR
      b.employer_id ILIKE '%'||v_search||'%' OR
      b.plan_number ILIKE '%'||v_search||'%' OR
      coalesce(b.inspector_name,'') ILIKE '%'||v_search||'%' OR
      coalesce(b.inspector_code,'') ILIKE '%'||v_search||'%' OR
      coalesce(b.territory,'') ILIKE '%'||v_search||'%' OR
      coalesce(b.source_ref,'') ILIKE '%'||v_search||'%' OR
      coalesce(b.inspection_number,'') ILIKE '%'||v_search||'%' OR
      coalesce(b.purpose,'') ILIKE '%'||v_search||'%' OR
      coalesce(b.visit_type,'') ILIKE '%'||v_search||'%'
    )
    AND (
      v_quick = 'ALL'
      OR (v_quick = 'ACTIVE'    AND b.check_in_time IS NOT NULL AND b.check_out_time IS NULL)
      OR (v_quick = 'TODAY'     AND b.scheduled_date = v_today)
      OR (v_quick = 'PLANNED'   AND b.execution_status IN ('PLANNED','PENDING'))
      OR (v_quick = 'COMPLETED' AND b.execution_status = 'COMPLETED')
      OR (v_quick = 'OVERDUE'   AND b.is_overdue)
      OR (v_quick = 'NO_EVIDENCE' AND b.evidence_count = 0
          AND b.execution_status IN ('IN_PROGRESS','COMPLETED'))
      OR (v_quick = 'MINE'      AND b.inspector_id = v_uid)
    );

  SELECT count(*) INTO v_total FROM _ce_fo_base;

  SELECT jsonb_build_object(
    'total', count(*),
    'active_visits', count(*) FILTER (WHERE check_in_time IS NOT NULL AND check_out_time IS NULL),
    'scheduled_today', count(*) FILTER (WHERE scheduled_date = v_today),
    'planned', count(*) FILTER (WHERE execution_status IN ('PLANNED','PENDING')),
    'in_progress', count(*) FILTER (WHERE execution_status = 'IN_PROGRESS'),
    'completed', count(*) FILTER (WHERE execution_status = 'COMPLETED'),
    'overdue', count(*) FILTER (WHERE is_overdue),
    'evidence_total', coalesce(sum(evidence_count),0),
    'no_evidence', count(*) FILTER (WHERE evidence_count = 0
        AND execution_status IN ('IN_PROGRESS','COMPLETED')),
    'findings_total', coalesce(sum(findings_count),0),
    'avg_visit_minutes', round(avg(duration_minutes) FILTER (WHERE check_out_time IS NOT NULL))
  ) INTO v_kpis FROM _ce_fo_base;

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.__rn), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT b.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='schedule'  AND v_dir='asc'  THEN b.scheduled_date END ASC,
        CASE WHEN v_sort='schedule'  AND v_dir='desc' THEN b.scheduled_date END DESC,
        CASE WHEN v_sort='employer'  AND v_dir='asc'  THEN lower(b.employer_name) END ASC,
        CASE WHEN v_sort='employer'  AND v_dir='desc' THEN lower(b.employer_name) END DESC,
        CASE WHEN v_sort='inspector' AND v_dir='asc'  THEN lower(coalesce(b.inspector_name,'')) END ASC,
        CASE WHEN v_sort='inspector' AND v_dir='desc' THEN lower(coalesce(b.inspector_name,'')) END DESC,
        CASE WHEN v_sort='status'    AND v_dir='asc'  THEN b.execution_status END ASC,
        CASE WHEN v_sort='status'    AND v_dir='desc' THEN b.execution_status END DESC,
        CASE WHEN v_sort='evidence'  AND v_dir='asc'  THEN b.evidence_count END ASC,
        CASE WHEN v_sort='evidence'  AND v_dir='desc' THEN b.evidence_count END DESC,
        CASE WHEN v_sort='checkin'   AND v_dir='asc'  THEN b.check_in_time END ASC,
        CASE WHEN v_sort='checkin'   AND v_dir='desc' THEN b.check_in_time END DESC,
        CASE WHEN v_sort='territory' AND v_dir='asc'  THEN lower(coalesce(b.territory,'')) END ASC,
        CASE WHEN v_sort='territory' AND v_dir='desc' THEN lower(coalesce(b.territory,'')) END DESC,
        b.scheduled_date DESC, b.created_at DESC
    ) AS __rn
    FROM _ce_fo_base b
    OFFSET CASE WHEN p_export THEN 0 ELSE (v_page - 1) * v_size END
    LIMIT v_size
  ) t;

  DROP TABLE IF EXISTS _ce_fo_base;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'user_id', v_uid,
    'page', v_page,
    'page_size', v_size,
    'total', v_total,
    'kpis', v_kpis,
    'rows', v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_field_operations_register_v1(jsonb, text, text, integer, integer, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Facets
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_field_operations_facets_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text := public.ce_field_ops_scope(auth.uid());
BEGIN
  IF v_scope = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view field operations' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH base AS (
      SELECT i.*, w.inspector_id, coalesce(w.inspector_name, pr.full_name) AS inspector_name
      FROM public.ce_weekly_plan_items i
      JOIN public.ce_weekly_plans w ON w.id = i.plan_id
      LEFT JOIN public.profiles pr ON pr.id = w.inspector_id
      WHERE coalesce(w.is_current_version, true)
        AND (v_scope = 'ALL' OR w.inspector_id = v_uid)
    )
    SELECT jsonb_build_object(
      'statuses', (SELECT coalesce(jsonb_agg(DISTINCT upper(coalesce(execution_status,'PLANNED'))), '[]'::jsonb) FROM base),
      'visit_types', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(visit_type,''), item_type)), '[]'::jsonb)
                        FROM base WHERE coalesce(NULLIF(visit_type,''), item_type) IS NOT NULL),
      'territories', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(territory,''), NULLIF(area_name,''))), '[]'::jsonb)
                        FROM base WHERE coalesce(NULLIF(territory,''), NULLIF(area_name,'')) IS NOT NULL),
      'inspectors', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', inspector_id, 'name', inspector_name)), '[]'::jsonb)
                        FROM base WHERE inspector_name IS NOT NULL),
      'employers', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', employer_id, 'name', employer_name)), '[]'::jsonb)
                        FROM base WHERE employer_id IS NOT NULL)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_field_operations_facets_v1() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Visit detail
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_field_visit_detail_v1(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text := public.ce_field_ops_scope(auth.uid());
  v_item public.ce_weekly_plan_items;
  v_plan public.ce_weekly_plans;
  v_insp public.ce_inspections;
BEGIN
  IF v_scope = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view field operations' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.ce_weekly_plan_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.ce_weekly_plans WHERE id = v_item.plan_id;

  IF v_scope <> 'ALL' AND v_plan.inspector_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Not authorised to view this field visit' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_insp FROM public.ce_inspections
   WHERE plan_item_id = v_item.id ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'plan', to_jsonb(v_plan),
    'inspection', to_jsonb(v_insp),
    'evidence', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC), '[]'::jsonb)
                   FROM public.ce_inspection_evidence e
                  WHERE e.plan_item_id = v_item.id
                     OR (v_insp.id IS NOT NULL AND e.inspection_id = v_insp.id)),
    'findings', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb)
                   FROM public.ce_inspection_findings f
                  WHERE v_insp.id IS NOT NULL AND f.inspection_id = v_insp.id),
    'audit', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.performed_at DESC), '[]'::jsonb)
                FROM public.ce_weekly_plan_item_audit a
               WHERE a.item_id = v_item.id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_field_visit_detail_v1(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Governed check-in / check-out
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_field_visit_check_in_v1(
  p_item_id uuid,
  p_notes text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_gps_unavailable_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.ce_weekly_plan_items;
  v_plan public.ce_weekly_plans;
  v_actor text := coalesce((SELECT coalesce(user_code, employee_code, email) FROM public.profiles WHERE id = auth.uid()), auth.uid()::text);
BEGIN
  IF NOT public.ce_actor_can(v_uid, 'compliance.field.execute') THEN
    RAISE EXCEPTION 'Not authorised to execute field visits' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.ce_weekly_plan_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.ce_weekly_plans WHERE id = v_item.plan_id;

  IF public.ce_field_ops_scope(v_uid) <> 'ALL' AND v_plan.inspector_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You may only check in to your own planned visits' USING ERRCODE = '42501';
  END IF;

  IF v_item.check_in_time IS NOT NULL AND v_item.check_out_time IS NULL THEN
    RAISE EXCEPTION 'This visit is already checked in' USING ERRCODE = '22023';
  END IF;

  IF upper(coalesce(v_item.execution_status,'PLANNED')) = 'COMPLETED' THEN
    RAISE EXCEPTION 'This visit is already completed' USING ERRCODE = '22023';
  END IF;

  IF p_lat IS NULL AND p_lng IS NULL
     AND NULLIF(trim(coalesce(p_gps_unavailable_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'GPS position or a reason for unavailable GPS is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ce_weekly_plan_items
     SET execution_status = 'IN_PROGRESS',
         check_in_time = now(),
         check_in_gps_lat = p_lat,
         check_in_gps_lng = p_lng,
         check_out_time = NULL,
         check_out_gps_lat = NULL,
         check_out_gps_lng = NULL,
         outcome_notes = coalesce(NULLIF(trim(coalesce(p_notes,'')),''), outcome_notes),
         updated_by = v_actor,
         updated_at = now()
   WHERE id = p_item_id;

  INSERT INTO public.ce_weekly_plan_item_audit
    (plan_id, item_id, action, employer_id, employer_name, snapshot, performed_by, performed_at)
  VALUES (v_item.plan_id, v_item.id, 'CHECK_IN', v_item.employer_id, v_item.employer_name,
          jsonb_build_object('lat', p_lat, 'lng', p_lng,
                             'gps_unavailable_reason', p_gps_unavailable_reason,
                             'notes', p_notes),
          v_actor, now());

  RETURN jsonb_build_object('item_id', p_item_id, 'execution_status', 'IN_PROGRESS', 'check_in_time', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_field_visit_check_in_v1(uuid, text, numeric, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ce_field_visit_check_out_v1(
  p_item_id uuid,
  p_outcome_notes text DEFAULT NULL,
  p_findings text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.ce_weekly_plan_items;
  v_plan public.ce_weekly_plans;
  v_actor text := coalesce((SELECT coalesce(user_code, employee_code, email) FROM public.profiles WHERE id = auth.uid()), auth.uid()::text);
BEGIN
  IF NOT public.ce_actor_can(v_uid, 'compliance.field.execute') THEN
    RAISE EXCEPTION 'Not authorised to execute field visits' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.ce_weekly_plan_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.ce_weekly_plans WHERE id = v_item.plan_id;

  IF public.ce_field_ops_scope(v_uid) <> 'ALL' AND v_plan.inspector_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You may only check out of your own visits' USING ERRCODE = '42501';
  END IF;

  IF v_item.check_in_time IS NULL THEN
    RAISE EXCEPTION 'This visit has not been checked in' USING ERRCODE = '22023';
  END IF;
  IF v_item.check_out_time IS NOT NULL THEN
    RAISE EXCEPTION 'This visit is already checked out' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(coalesce(p_outcome_notes,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Visit outcome notes are required at check-out' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ce_weekly_plan_items
     SET execution_status = 'COMPLETED',
         check_out_time = now(),
         check_out_gps_lat = p_lat,
         check_out_gps_lng = p_lng,
         outcome_notes = p_outcome_notes,
         findings = coalesce(NULLIF(trim(coalesce(p_findings,'')),''), findings),
         updated_by = v_actor,
         updated_at = now()
   WHERE id = p_item_id;

  UPDATE public.ce_weekly_plans w
     SET completed_visits = (
           SELECT count(*) FROM public.ce_weekly_plan_items x
            WHERE x.plan_id = w.id AND upper(coalesce(x.execution_status,'')) = 'COMPLETED'),
         updated_at = now()
   WHERE w.id = v_item.plan_id;

  INSERT INTO public.ce_weekly_plan_item_audit
    (plan_id, item_id, action, employer_id, employer_name, snapshot, performed_by, performed_at)
  VALUES (v_item.plan_id, v_item.id, 'CHECK_OUT', v_item.employer_id, v_item.employer_name,
          jsonb_build_object('lat', p_lat, 'lng', p_lng,
                             'outcome_notes', p_outcome_notes, 'findings', p_findings),
          v_actor, now());

  RETURN jsonb_build_object('item_id', p_item_id, 'execution_status', 'COMPLETED', 'check_out_time', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_field_visit_check_out_v1(uuid, text, text, numeric, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Governed evidence registration
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_field_visit_add_evidence_v1(
  p_item_id uuid,
  p_evidence_type text,
  p_file_name text,
  p_file_url text,
  p_file_size bigint DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.ce_weekly_plan_items;
  v_plan public.ce_weekly_plans;
  v_insp_id uuid;
  v_id uuid;
  v_actor text := coalesce((SELECT coalesce(user_code, employee_code, email) FROM public.profiles WHERE id = auth.uid()), auth.uid()::text);
BEGIN
  IF NOT public.ce_actor_can(v_uid, 'compliance.field.execute') THEN
    RAISE EXCEPTION 'Not authorised to record field evidence' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.ce_weekly_plan_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field visit not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.ce_weekly_plans WHERE id = v_item.plan_id;

  IF public.ce_field_ops_scope(v_uid) <> 'ALL' AND v_plan.inspector_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You may only attach evidence to your own visits' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(coalesce(p_file_name,'')),'') IS NULL
     OR NULLIF(trim(coalesce(p_file_url,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A stored file is required for evidence' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_insp_id FROM public.ce_inspections
   WHERE plan_item_id = p_item_id ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.ce_inspection_evidence
    (inspection_id, plan_item_id, evidence_type, file_name, file_url, file_size,
     description, captured_at, captured_by, gps_lat, gps_lng, created_by, updated_by)
  VALUES (v_insp_id, p_item_id, upper(coalesce(NULLIF(p_evidence_type,''),'DOCUMENT')),
          p_file_name, p_file_url, p_file_size, p_description, now(), v_actor,
          p_lat, p_lng, v_actor, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.ce_weekly_plan_item_audit
    (plan_id, item_id, action, employer_id, employer_name, snapshot, performed_by, performed_at)
  VALUES (v_item.plan_id, v_item.id, 'EVIDENCE_ADDED', v_item.employer_id, v_item.employer_name,
          jsonb_build_object('evidence_id', v_id, 'file_name', p_file_name,
                             'evidence_type', p_evidence_type),
          v_actor, now());

  RETURN jsonb_build_object('evidence_id', v_id, 'item_id', p_item_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_field_visit_add_evidence_v1(uuid, text, text, text, bigint, text, numeric, numeric) TO authenticated, service_role;
