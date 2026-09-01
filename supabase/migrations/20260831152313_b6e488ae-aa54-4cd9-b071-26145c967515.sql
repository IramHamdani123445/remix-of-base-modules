CREATE INDEX IF NOT EXISTS idx_ce_cases_status_active ON public.ce_cases (upper(status)) WHERE COALESCE(is_deleted,false) = false;
CREATE INDEX IF NOT EXISTS idx_ce_cases_priority ON public.ce_cases (priority);
CREATE INDEX IF NOT EXISTS idx_ce_cases_assigned_officer ON public.ce_cases (assigned_officer_id);
CREATE INDEX IF NOT EXISTS idx_ce_cases_target_resolution ON public.ce_cases (target_resolution_date);

CREATE OR REPLACE FUNCTION public.ce_case_queue_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'recommended',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),5),200);
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'recommended');
  v_result jsonb;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_employer text := NULLIF(p_filters->>'employer','');
  f_statuses text[] := CASE WHEN COALESCE(p_filters->>'statuses','') = '' THEN NULL
                            ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'statuses') x) END;
  f_priorities text[] := CASE WHEN COALESCE(p_filters->>'priorities','') = '' THEN NULL
                              ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'priorities') x) END;
  f_risks text[] := CASE WHEN COALESCE(p_filters->>'risk_bands','') = '' THEN NULL
                         ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'risk_bands') x) END;
  f_assigned text := NULLIF(p_filters->>'assigned','');
  f_territory text := NULLIF(p_filters->>'territory','');
  f_case_type text := NULLIF(p_filters->>'case_type','');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
  f_age text := NULLIF(upper(p_filters->>'age'),'');
  f_due text := NULLIF(upper(p_filters->>'due'),'');
  f_amount_min numeric := NULLIF(p_filters->>'amount_min','')::numeric;
  f_amount_max numeric := NULLIF(p_filters->>'amount_max','')::numeric;
  f_arrangement text := NULLIF(upper(p_filters->>'arrangement'),'');
  f_legal boolean := COALESCE((p_filters->>'legal_only')::boolean,false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-CASE-QUEUE-401: authentication required';
  END IF;

  IF public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN
    v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN
    v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid, 'compliance.reports.operational') THEN
    v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'CE-CASE-QUEUE-403: not authorised to read the compliance case queue';
  END IF;

  WITH scoped AS (
    SELECT
      c.id,
      c.case_number,
      c.employer_id,
      c.employer_name,
      COALESCE(NULLIF(trim(c.territory),''),'Unassigned') AS territory,
      upper(COALESCE(c.status,'UNKNOWN')) AS status,
      CASE upper(COALESCE(c.priority,''))
        WHEN 'URGENT' THEN 'CRITICAL'
        WHEN 'CRITICAL' THEN 'CRITICAL'
        WHEN 'HIGH' THEN 'HIGH'
        WHEN 'MEDIUM' THEN 'MEDIUM'
        WHEN 'LOW' THEN 'LOW'
        ELSE 'UNSET' END AS priority,
      COALESCE(NULLIF(upper(c.risk_band),''),'UNRATED') AS risk_band,
      c.risk_score,
      COALESCE(c.total_amount,0)::numeric AS total_amount,
      c.assigned_officer_id,
      c.assigned_officer_name,
      c.opened_date,
      c.target_resolution_date,
      COALESCE(NULLIF(c.case_type,''),'UNCLASSIFIED') AS case_type,
      c.case_family,
      c.legal_case_id,
      c.violation_count,
      c.summary,
      (CURRENT_DATE - COALESCE(c.opened_date, c.created_at::date, CURRENT_DATE)) AS age_days,
      CASE
        WHEN c.legal_case_id IS NOT NULL
          OR upper(COALESCE(c.status,'')) LIKE '%LEGAL%'
          OR upper(COALESCE(c.status,'')) LIKE '%COURT%'
          OR upper(COALESCE(c.status,'')) LIKE '%JUDGMENT%'
          OR upper(COALESCE(c.status,'')) LIKE '%ENFORCEMENT%' THEN 'LEGAL'
        ELSE 'ACTIVE' END AS status_group,
      (
        SELECT upper(a.status) FROM public.ce_payment_arrangements a
        WHERE a.case_id = c.id
        ORDER BY a.created_at DESC NULLS LAST LIMIT 1
      ) AS arrangement_status
    FROM public.ce_cases c
    WHERE COALESCE(c.is_deleted,false) = false
      AND upper(COALESCE(c.status,'')) NOT IN ('CLOSED','RESOLVED','COMPLETED','CANCELLED','WITHDRAWN')
      AND c.closed_date IS NULL
      AND (
        v_scope IN ('enterprise','team')
        OR c.assigned_officer_id = v_uid::text
      )
  ), enriched AS (
    SELECT s.*,
      CASE
        WHEN s.target_resolution_date IS NULL THEN 'NO_TARGET'
        WHEN s.target_resolution_date < CURRENT_DATE THEN 'OVERDUE'
        WHEN s.target_resolution_date = CURRENT_DATE THEN 'DUE_TODAY'
        WHEN s.target_resolution_date <= CURRENT_DATE + 3 THEN 'DUE_1_3'
        WHEN s.target_resolution_date <= CURRENT_DATE + 7 THEN 'DUE_4_7'
        ELSE 'DUE_LATER' END AS due_status,
      COALESCE(s.arrangement_status,'NONE') AS arrangement_state
    FROM scoped s
  ), filtered AS (
    SELECT e.* FROM enriched e
    WHERE (f_search IS NULL
        OR e.case_number ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_name,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_id,'') ILIKE '%'||f_search||'%')
      AND (f_employer IS NULL OR e.employer_id = f_employer)
      AND (f_statuses IS NULL OR e.status = ANY(f_statuses))
      AND (f_priorities IS NULL OR e.priority = ANY(f_priorities))
      AND (f_risks IS NULL OR e.risk_band = ANY(f_risks))
      AND (f_assigned IS NULL
        OR (f_assigned = 'ME' AND e.assigned_officer_id = v_uid::text)
        OR (f_assigned = 'UNASSIGNED' AND NULLIF(trim(COALESCE(e.assigned_officer_id,'')),'') IS NULL)
        OR (f_assigned NOT IN ('ME','UNASSIGNED') AND e.assigned_officer_id = f_assigned))
      AND (f_territory IS NULL OR e.territory = f_territory)
      AND (f_case_type IS NULL OR e.case_type = f_case_type)
      AND (f_date_from IS NULL OR e.opened_date >= f_date_from)
      AND (f_date_to IS NULL OR e.opened_date <= f_date_to)
      AND (f_age IS NULL OR
           (f_age='0_7' AND e.age_days BETWEEN 0 AND 7) OR
           (f_age='8_30' AND e.age_days BETWEEN 8 AND 30) OR
           (f_age='31_60' AND e.age_days BETWEEN 31 AND 60) OR
           (f_age='61_90' AND e.age_days BETWEEN 61 AND 90) OR
           (f_age='91_180' AND e.age_days BETWEEN 91 AND 180) OR
           (f_age='180_PLUS' AND e.age_days > 180))
      AND (f_due IS NULL OR
           (f_due='DUE_7' AND e.due_status IN ('OVERDUE','DUE_TODAY','DUE_1_3','DUE_4_7')) OR
           (f_due <> 'DUE_7' AND e.due_status = f_due))
      AND (f_amount_min IS NULL OR e.total_amount >= f_amount_min)
      AND (f_amount_max IS NULL OR e.total_amount <= f_amount_max)
      AND (f_arrangement IS NULL OR
           (f_arrangement='NONE' AND e.arrangement_state = 'NONE') OR
           (f_arrangement='ACTIVE' AND e.arrangement_state = 'ACTIVE') OR
           (f_arrangement='COMPLETED' AND e.arrangement_state = 'COMPLETED') OR
           (f_arrangement='BREACHED' AND e.arrangement_state IN ('BREACHED','DEFAULTED')))
      AND (f_legal = false OR e.status_group = 'LEGAL')
  ), ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        -- Recommended: overdue first, then priority, then earliest target date, then oldest case
        CASE WHEN v_sort='recommended' THEN (CASE WHEN f.due_status='OVERDUE' THEN 0 ELSE 1 END) END ASC,
        CASE WHEN v_sort='recommended' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='recommended' THEN f.target_resolution_date END ASC NULLS LAST,
        CASE WHEN v_sort='recommended' THEN f.age_days END DESC,
        CASE WHEN v_sort='priority' AND v_dir='desc' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='priority' AND v_dir='asc' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort='due' AND v_dir='asc' THEN f.target_resolution_date END ASC NULLS LAST,
        CASE WHEN v_sort='due' AND v_dir='desc' THEN f.target_resolution_date END DESC NULLS LAST,
        CASE WHEN v_sort='age' AND v_dir='desc' THEN f.age_days END DESC,
        CASE WHEN v_sort='age' AND v_dir='asc' THEN f.age_days END ASC,
        CASE WHEN v_sort='risk' AND v_dir='desc' THEN (CASE f.risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='risk' AND v_dir='asc' THEN (CASE f.risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort='amount' AND v_dir='desc' THEN f.total_amount END DESC,
        CASE WHEN v_sort='amount' AND v_dir='asc' THEN f.total_amount END ASC,
        CASE WHEN v_sort='opened_date' AND v_dir='desc' THEN f.opened_date END DESC NULLS LAST,
        CASE WHEN v_sort='opened_date' AND v_dir='asc' THEN f.opened_date END ASC NULLS LAST,
        CASE WHEN v_sort='employer' AND v_dir='asc' THEN lower(COALESCE(f.employer_name,f.employer_id,'')) END ASC,
        CASE WHEN v_sort='employer' AND v_dir='desc' THEN lower(COALESCE(f.employer_name,f.employer_id,'')) END DESC,
        CASE WHEN v_sort='assigned' AND v_dir='asc' THEN lower(COALESCE(f.assigned_officer_name,'zzz')) END ASC,
        CASE WHEN v_sort='assigned' AND v_dir='desc' THEN lower(COALESCE(f.assigned_officer_name,'zzz')) END DESC,
        CASE WHEN v_sort='case_number' AND v_dir='asc' THEN lower(f.case_number) END ASC,
        CASE WHEN v_sort='case_number' AND v_dir='desc' THEN lower(f.case_number) END DESC,
        f.opened_date ASC NULLS LAST,
        f.case_number ASC
    ) AS rn
    FROM filtered f
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'page', v_page,
    'page_size', v_size,
    'sort', v_sort,
    'dir', v_dir,
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.rn)
      FROM ranked r
      WHERE r.rn > (v_page-1)*v_size AND r.rn <= v_page*v_size
    ), '[]'::jsonb),
    'kpis_all', (
      SELECT jsonb_build_object(
        'total', count(*),
        'critical', count(*) FILTER (WHERE priority='CRITICAL'),
        'high', count(*) FILTER (WHERE priority='HIGH'),
        'overdue', count(*) FILTER (WHERE due_status='OVERDUE'),
        'due_week', count(*) FILTER (WHERE due_status IN ('OVERDUE','DUE_TODAY','DUE_1_3','DUE_4_7')),
        'unassigned', count(*) FILTER (WHERE NULLIF(trim(COALESCE(assigned_officer_id,'')),'') IS NULL),
        'mine', count(*) FILTER (WHERE assigned_officer_id = v_uid::text),
        'exposure', COALESCE(sum(total_amount),0)
      ) FROM enriched
    ),
    'kpis_filtered', (
      SELECT jsonb_build_object(
        'total', count(*),
        'critical', count(*) FILTER (WHERE priority='CRITICAL'),
        'high', count(*) FILTER (WHERE priority='HIGH'),
        'overdue', count(*) FILTER (WHERE due_status='OVERDUE'),
        'due_week', count(*) FILTER (WHERE due_status IN ('OVERDUE','DUE_TODAY','DUE_1_3','DUE_4_7')),
        'unassigned', count(*) FILTER (WHERE NULLIF(trim(COALESCE(assigned_officer_id,'')),'') IS NULL),
        'mine', count(*) FILTER (WHERE assigned_officer_id = v_uid::text),
        'exposure', COALESCE(sum(total_amount),0)
      ) FROM filtered
    ),
    'options', jsonb_build_object(
      'statuses', COALESCE((SELECT jsonb_agg(DISTINCT status ORDER BY status) FROM enriched),'[]'::jsonb),
      'priorities', COALESCE((SELECT jsonb_agg(DISTINCT priority ORDER BY priority) FROM enriched),'[]'::jsonb),
      'risk_bands', COALESCE((SELECT jsonb_agg(DISTINCT risk_band ORDER BY risk_band) FROM enriched),'[]'::jsonb),
      'territories', COALESCE((SELECT jsonb_agg(DISTINCT territory ORDER BY territory) FROM enriched),'[]'::jsonb),
      'case_types', COALESCE((SELECT jsonb_agg(DISTINCT case_type ORDER BY case_type) FROM enriched),'[]'::jsonb),
      'officers', COALESCE((
        SELECT jsonb_agg(o ORDER BY o->>'name')
        FROM (
          SELECT DISTINCT jsonb_build_object('id', assigned_officer_id, 'name', COALESCE(assigned_officer_name, assigned_officer_id)) AS o
          FROM enriched WHERE NULLIF(trim(COALESCE(assigned_officer_id,'')),'') IS NOT NULL
        ) x
      ),'[]'::jsonb),
      'employers', COALESCE((
        SELECT jsonb_agg(e ORDER BY e->>'name')
        FROM (
          SELECT DISTINCT jsonb_build_object('id', employer_id, 'name', COALESCE(employer_name, employer_id)) AS e
          FROM enriched WHERE employer_id IS NOT NULL
        ) y
      ),'[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_case_queue_v1(jsonb, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_case_queue_v1(jsonb, text, text, integer, integer) TO authenticated;