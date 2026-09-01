CREATE INDEX IF NOT EXISTS idx_ce_cases_intake_unassigned
  ON public.ce_cases (opened_date DESC)
  WHERE assigned_officer_id IS NULL AND COALESCE(is_deleted,false) = false;
CREATE INDEX IF NOT EXISTS idx_ce_cases_case_family ON public.ce_cases (case_family);
CREATE INDEX IF NOT EXISTS idx_ce_case_violations_case_id ON public.ce_case_violations (case_id);

CREATE OR REPLACE FUNCTION public.ce_case_intake_v1(
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
  f_families text[] := CASE WHEN COALESCE(p_filters->>'families','')='' THEN NULL
                            ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'families') x) END;
  f_funds text[] := CASE WHEN COALESCE(p_filters->>'funds','')='' THEN NULL
                         ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'funds') x) END;
  f_statuses text[] := CASE WHEN COALESCE(p_filters->>'statuses','')='' THEN NULL
                            ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'statuses') x) END;
  f_priorities text[] := CASE WHEN COALESCE(p_filters->>'priorities','')='' THEN NULL
                              ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'priorities') x) END;
  f_risks text[] := CASE WHEN COALESCE(p_filters->>'risk_bands','')='' THEN NULL
                         ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'risk_bands') x) END;
  f_territory text := NULLIF(p_filters->>'territory','');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
  f_opened text := NULLIF(upper(p_filters->>'opened'),'');
  f_wait text := NULLIF(upper(p_filters->>'wait'),'');
  f_amount_min numeric := NULLIF(p_filters->>'amount_min','')::numeric;
  f_amount_max numeric := NULLIF(p_filters->>'amount_max','')::numeric;
  f_incomplete boolean := COALESCE((p_filters->>'incomplete')::boolean,false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-CASE-INTAKE-401: authentication required';
  END IF;

  IF public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN
    v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN
    v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid, 'compliance.reports.operational') THEN
    v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'CE-CASE-INTAKE-403: not authorised to read the compliance case intake queue';
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
      c.opened_date,
      c.created_at,
      COALESCE(NULLIF(upper(c.case_family),''),'UNCLASSIFIED') AS case_family,
      c.violation_count,
      c.summary,
      -- Waiting time is measured from the intake creation timestamp where present.
      GREATEST(0, (CURRENT_DATE - COALESCE(c.created_at::date, c.opened_date, CURRENT_DATE))) AS waiting_days,
      (
        SELECT string_agg(DISTINCT upper(v.fund_type), ', ' ORDER BY upper(v.fund_type))
        FROM public.ce_case_violations cv
        JOIN public.ce_violations v ON v.id = cv.violation_id
        WHERE cv.case_id = c.id AND NULLIF(trim(COALESCE(v.fund_type,'')),'') IS NOT NULL
      ) AS derived_funds,
      (SELECT count(*) FROM public.ce_case_violations cv2 WHERE cv2.case_id = c.id) AS linked_violations
    FROM public.ce_cases c
    WHERE COALESCE(c.is_deleted,false) = false
      AND COALESCE(c.is_merged,false) = false
      AND NULLIF(trim(COALESCE(c.assigned_officer_id,'')),'') IS NULL
      AND c.closed_date IS NULL
      AND upper(COALESCE(c.status,'')) NOT IN ('CLOSED','RESOLVED','COMPLETED','CANCELLED','WITHDRAWN')
  ), enriched AS (
    SELECT s.*,
      COALESCE(NULLIF(trim(COALESCE(s.derived_funds,'')),''),'UNSPECIFIED') AS fund_display,
      CASE
        WHEN s.waiting_days < 1 THEN 'LT_1'
        WHEN s.waiting_days <= 3 THEN '1_3'
        WHEN s.waiting_days <= 7 THEN '4_7'
        WHEN s.waiting_days <= 14 THEN '8_14'
        ELSE '15_PLUS' END AS wait_bucket,
      (s.case_family = 'UNCLASSIFIED'
        OR NULLIF(trim(COALESCE(s.employer_id,'')),'') IS NULL
        OR NULLIF(trim(COALESCE(s.employer_name,'')),'') IS NULL
        OR COALESCE(s.linked_violations,0) = 0) AS data_incomplete
    FROM scoped s
  ), filtered AS (
    SELECT e.* FROM enriched e
    WHERE (f_search IS NULL
        OR e.case_number ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_name,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_id,'') ILIKE '%'||f_search||'%')
      AND (f_employer IS NULL OR e.employer_id = f_employer)
      AND (f_families IS NULL OR e.case_family = ANY(f_families))
      AND (f_funds IS NULL OR EXISTS (
            SELECT 1 FROM unnest(string_to_array(e.fund_display, ', ')) fx WHERE upper(trim(fx)) = ANY(f_funds)))
      AND (f_statuses IS NULL OR e.status = ANY(f_statuses))
      AND (f_priorities IS NULL OR e.priority = ANY(f_priorities))
      AND (f_risks IS NULL OR e.risk_band = ANY(f_risks))
      AND (f_territory IS NULL OR e.territory = f_territory)
      AND (f_date_from IS NULL OR e.opened_date >= f_date_from)
      AND (f_date_to IS NULL OR e.opened_date <= f_date_to)
      AND (f_opened IS NULL OR
           (f_opened='TODAY' AND e.opened_date = CURRENT_DATE) OR
           (f_opened='7' AND e.opened_date >= CURRENT_DATE - 7) OR
           (f_opened='30' AND e.opened_date >= CURRENT_DATE - 30) OR
           (f_opened='90' AND e.opened_date >= CURRENT_DATE - 90))
      AND (f_wait IS NULL OR
           (f_wait='GT_3' AND e.waiting_days > 3) OR
           (f_wait <> 'GT_3' AND e.wait_bucket = f_wait))
      AND (f_amount_min IS NULL OR e.total_amount >= f_amount_min)
      AND (f_amount_max IS NULL OR e.total_amount <= f_amount_max)
      AND (f_incomplete = false OR e.data_incomplete)
  ), ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='recommended' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='recommended' THEN f.waiting_days END DESC,
        CASE WHEN v_sort='recommended' THEN (CASE f.risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='waiting' AND v_dir='desc' THEN f.waiting_days END DESC,
        CASE WHEN v_sort='waiting' AND v_dir='asc' THEN f.waiting_days END ASC,
        CASE WHEN v_sort='priority' AND v_dir='desc' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='priority' AND v_dir='asc' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort='risk' AND v_dir='desc' THEN (CASE f.risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='risk' AND v_dir='asc' THEN (CASE f.risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort='amount' AND v_dir='desc' THEN f.total_amount END DESC,
        CASE WHEN v_sort='amount' AND v_dir='asc' THEN f.total_amount END ASC,
        CASE WHEN v_sort='opened_date' AND v_dir='desc' THEN f.opened_date END DESC NULLS LAST,
        CASE WHEN v_sort='opened_date' AND v_dir='asc' THEN f.opened_date END ASC NULLS LAST,
        CASE WHEN v_sort='employer' AND v_dir='asc' THEN lower(COALESCE(f.employer_name,f.employer_id,'')) END ASC,
        CASE WHEN v_sort='employer' AND v_dir='desc' THEN lower(COALESCE(f.employer_name,f.employer_id,'')) END DESC,
        CASE WHEN v_sort='family' AND v_dir='asc' THEN f.case_family END ASC,
        CASE WHEN v_sort='family' AND v_dir='desc' THEN f.case_family END DESC,
        CASE WHEN v_sort='fund' AND v_dir='asc' THEN f.fund_display END ASC,
        CASE WHEN v_sort='fund' AND v_dir='desc' THEN f.fund_display END DESC,
        CASE WHEN v_sort='case_number' AND v_dir='asc' THEN lower(f.case_number) END ASC,
        CASE WHEN v_sort='case_number' AND v_dir='desc' THEN lower(f.case_number) END DESC,
        f.waiting_days DESC,
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
    'sla_configured', false,
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.rn)
      FROM ranked r WHERE r.rn > (v_page-1)*v_size AND r.rn <= v_page*v_size
    ), '[]'::jsonb),
    'kpis_all', (
      SELECT jsonb_build_object(
        'total', count(*),
        'critical_high', count(*) FILTER (WHERE priority IN ('CRITICAL','HIGH')),
        'high_risk', count(*) FILTER (WHERE risk_band IN ('CRITICAL','HIGH')),
        'waiting_gt_3', count(*) FILTER (WHERE waiting_days > 3),
        'opened_today', count(*) FILTER (WHERE opened_date = CURRENT_DATE),
        'incomplete', count(*) FILTER (WHERE data_incomplete),
        'oldest_waiting', COALESCE(max(waiting_days),0),
        'exposure', COALESCE(sum(total_amount),0)
      ) FROM enriched
    ),
    'kpis_filtered', (
      SELECT jsonb_build_object(
        'total', count(*),
        'critical_high', count(*) FILTER (WHERE priority IN ('CRITICAL','HIGH')),
        'high_risk', count(*) FILTER (WHERE risk_band IN ('CRITICAL','HIGH')),
        'waiting_gt_3', count(*) FILTER (WHERE waiting_days > 3),
        'opened_today', count(*) FILTER (WHERE opened_date = CURRENT_DATE),
        'incomplete', count(*) FILTER (WHERE data_incomplete),
        'oldest_waiting', COALESCE(max(waiting_days),0),
        'exposure', COALESCE(sum(total_amount),0)
      ) FROM filtered
    ),
    'options', jsonb_build_object(
      'families', COALESCE((
        SELECT jsonb_agg(x ORDER BY x)
        FROM (SELECT DISTINCT upper(code) AS x FROM public.ce_case_families WHERE is_active
              UNION SELECT DISTINCT case_family FROM enriched) f2
      ),'[]'::jsonb),
      'funds', COALESCE((
        SELECT jsonb_agg(DISTINCT upper(trim(fx)) ORDER BY upper(trim(fx)))
        FROM enriched e, unnest(string_to_array(e.fund_display, ', ')) fx
      ),'[]'::jsonb),
      'statuses', COALESCE((SELECT jsonb_agg(DISTINCT status ORDER BY status) FROM enriched),'[]'::jsonb),
      'priorities', COALESCE((SELECT jsonb_agg(DISTINCT priority ORDER BY priority) FROM enriched),'[]'::jsonb),
      'risk_bands', COALESCE((SELECT jsonb_agg(DISTINCT risk_band ORDER BY risk_band) FROM enriched),'[]'::jsonb),
      'territories', COALESCE((SELECT jsonb_agg(DISTINCT territory ORDER BY territory) FROM enriched),'[]'::jsonb),
      'employers', COALESCE((
        SELECT jsonb_agg(e ORDER BY e->>'name')
        FROM (SELECT DISTINCT jsonb_build_object('id', employer_id, 'name', COALESCE(employer_name, employer_id)) AS e
              FROM enriched WHERE employer_id IS NOT NULL) y
      ),'[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_case_intake_v1(jsonb, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_case_intake_v1(jsonb, text, text, integer, integer) TO authenticated;