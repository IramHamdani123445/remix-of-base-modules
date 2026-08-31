CREATE OR REPLACE FUNCTION public.ce_employer_lookup_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'relevance',
  p_dir text DEFAULT 'asc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),5),200);
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'asc'))='desc' THEN 'desc' ELSE 'asc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'relevance');
  v_result jsonb;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_statuses text[] := CASE WHEN COALESCE(p_filters->>'statuses','')='' THEN NULL
    ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'statuses') x) END;
  f_offices text[] := CASE WHEN COALESCE(p_filters->>'offices','')='' THEN NULL
    ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'offices') x) END;
  f_risks text[] := CASE WHEN COALESCE(p_filters->>'risk_bands','')='' THEN NULL
    ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'risk_bands') x) END;
  f_sector text := NULLIF(upper(p_filters->>'sector'),'');
  f_ownership text := NULLIF(upper(p_filters->>'ownership'),'');
  f_registered text := NULLIF(upper(p_filters->>'registered'),'');
  f_from date := NULLIF(p_filters->>'date_from','')::date;
  f_to date := NULLIF(p_filters->>'date_to','')::date;
  f_has_viol boolean := COALESCE((p_filters->>'has_violations')::boolean,false);
  f_has_cases boolean := COALESCE((p_filters->>'has_cases')::boolean,false);
  f_has_out boolean := COALESCE((p_filters->>'has_outstanding')::boolean,false);
  f_high_risk boolean := COALESCE((p_filters->>'high_risk')::boolean,false);
  v_term text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-EMP-LOOKUP-401: authentication required';
  END IF;

  IF NOT (
    public.ce_actor_can(v_uid,'compliance.reports.operational')
    OR public.ce_actor_can(v_uid,'compliance.violations.manage')
    OR public.ce_actor_can(v_uid,'compliance.cases.manage')
    OR public.ce_actor_can(v_uid,'compliance.enforcement.arrangements')
    OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
    OR public.ce_actor_can(v_uid,'compliance.workbench.team')
  ) THEN
    RAISE EXCEPTION 'CE-EMP-LOOKUP-403: not authorised to search employers';
  END IF;

  v_term := lower(COALESCE(f_search,''));

  WITH viol AS (
    SELECT v.employer_id, count(*)::int AS open_violations
    FROM public.ce_violations v
    WHERE v.status IN ('OPEN','UNDER_REVIEW','IN_PROGRESS','ESCALATED')
      AND COALESCE(v.is_deleted,false)=false
    GROUP BY v.employer_id
  ), cse AS (
    SELECT c.employer_id, count(*)::int AS active_cases
    FROM public.ce_cases c
    WHERE upper(COALESCE(c.status,'')) NOT IN ('CLOSED','COMPLETED','RESOLVED','CANCELLED')
    GROUP BY c.employer_id
  ), base AS (
    SELECT
      trim(e.regno) AS regno,
      trim(COALESCE(e.name,'')) AS name,
      NULLIF(trim(COALESCE(e.trade_name,'')),'') AS trade_name,
      upper(COALESCE(trim(e.status),'')) AS status_code,
      COALESCE(
        s.status,
        CASE upper(COALESCE(trim(e.status),''))
          WHEN 'A' THEN 'ACTIVE' WHEN 'I' THEN 'INACTIVE'
          WHEN 'C' THEN 'CLOSED' WHEN 'D' THEN 'CEASED'
          ELSE 'UNCLASSIFIED' END
      ) AS status,
      NULLIF(upper(trim(COALESCE(e.office_code,''))),'') AS office_code,
      NULLIF(trim(COALESCE(e.village_code,'')),'') AS village_code,
      e.registration_date::date AS registration_date,
      NULLIF(trim(COALESCE(e.phone,'')),'') AS phone,
      NULLIF(trim(COALESCE(e.email,'')),'') AS email,
      NULLIF(upper(trim(COALESCE(e.sector_code,''))),'') AS sector_code,
      NULLIF(upper(trim(COALESCE(e.ownership_code,''))),'') AS ownership_code,
      (COALESCE(e.males_employed,0)+COALESCE(e.females_employed,0))::int AS employees,
      COALESCE(NULLIF(upper(COALESCE(r.override_band,r.risk_band)),''),'UNRATED') AS risk_band,
      r.total_score::numeric AS risk_score,
      COALESCE(v.open_violations,0) AS open_violations,
      COALESCE(cs.active_cases,0) AS active_cases,
      COALESCE(a.total_outstanding,0)::numeric AS outstanding
    FROM public.er_master e
    LEFT JOIN public.ce_employer_status_states s ON s.employer_id = trim(e.regno)
    LEFT JOIN public.ce_risk_profiles r ON r.employer_id = trim(e.regno)
    LEFT JOIN viol v ON v.employer_id = trim(e.regno)
    LEFT JOIN cse cs ON cs.employer_id = trim(e.regno)
    LEFT JOIN public.ce_v_employer_arrears_summary a ON trim(a.regno) = trim(e.regno)
  ), ranked AS (
    SELECT b.*,
      CASE
        WHEN v_term = '' THEN 9
        WHEN lower(b.regno) = v_term THEN 1
        WHEN lower(b.regno) LIKE v_term || '%' THEN 2
        WHEN lower(b.name) = v_term THEN 3
        WHEN lower(COALESCE(b.trade_name,'')) = v_term THEN 4
        WHEN lower(b.name) LIKE '%' || v_term || '%' THEN 5
        WHEN lower(COALESCE(b.trade_name,'')) LIKE '%' || v_term || '%' THEN 6
        ELSE 7
      END AS match_rank
    FROM base b
  ), filtered AS (
    SELECT * FROM ranked t
    WHERE (v_term = '' OR t.match_rank <= 6
           OR lower(COALESCE(t.email,'')) LIKE '%' || v_term || '%'
           OR lower(COALESCE(t.phone,'')) LIKE '%' || v_term || '%')
      AND (f_statuses IS NULL OR t.status = ANY(f_statuses))
      AND (f_offices IS NULL OR COALESCE(t.office_code,'-') = ANY(f_offices))
      AND (f_risks IS NULL OR t.risk_band = ANY(f_risks))
      AND (f_sector IS NULL OR t.sector_code = f_sector)
      AND (f_ownership IS NULL OR t.ownership_code = f_ownership)
      AND (NOT f_has_viol OR t.open_violations > 0)
      AND (NOT f_has_cases OR t.active_cases > 0)
      AND (NOT f_has_out OR t.outstanding > 0)
      AND (NOT f_high_risk OR t.risk_band IN ('HIGH','CRITICAL'))
      AND (
        f_registered IS NULL
        OR (f_registered = 'THIS_YEAR' AND t.registration_date >= date_trunc('year',CURRENT_DATE)::date)
        OR (f_registered = 'LAST_12M' AND t.registration_date >= (CURRENT_DATE - INTERVAL '12 months')::date)
        OR (f_registered = 'OLDER_1Y' AND t.registration_date < (CURRENT_DATE - INTERVAL '12 months')::date)
        OR (f_registered = 'CUSTOM'
            AND (f_from IS NULL OR t.registration_date >= f_from)
            AND (f_to IS NULL OR t.registration_date <= f_to))
      )
  ), paged AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='relevance' THEN f.match_rank END ASC,
        CASE WHEN v_sort='name' AND v_dir='asc' THEN lower(f.name) END ASC,
        CASE WHEN v_sort='name' AND v_dir='desc' THEN lower(f.name) END DESC,
        CASE WHEN v_sort='regno' AND v_dir='asc' THEN f.regno END ASC,
        CASE WHEN v_sort='regno' AND v_dir='desc' THEN f.regno END DESC,
        CASE WHEN v_sort='status' AND v_dir='asc' THEN f.status END ASC,
        CASE WHEN v_sort='status' AND v_dir='desc' THEN f.status END DESC,
        CASE WHEN v_sort='registered' AND v_dir='asc' THEN f.registration_date END ASC NULLS LAST,
        CASE WHEN v_sort='registered' AND v_dir='desc' THEN f.registration_date END DESC NULLS LAST,
        CASE WHEN v_sort='risk' AND v_dir='asc' THEN COALESCE(f.risk_score,-1) END ASC,
        CASE WHEN v_sort='risk' AND v_dir='desc' THEN COALESCE(f.risk_score,-1) END DESC,
        CASE WHEN v_sort='violations' AND v_dir='asc' THEN f.open_violations END ASC,
        CASE WHEN v_sort='violations' AND v_dir='desc' THEN f.open_violations END DESC,
        CASE WHEN v_sort='outstanding' AND v_dir='asc' THEN f.outstanding END ASC,
        CASE WHEN v_sort='outstanding' AND v_dir='desc' THEN f.outstanding END DESC,
        lower(f.name) ASC, f.regno ASC
    ) AS rn
    FROM filtered f
  )
  SELECT jsonb_build_object(
    'page', v_page,
    'page_size', v_size,
    'sort', v_sort,
    'dir', v_dir,
    'total', (SELECT count(*) FROM filtered),
    'exact_regno', (SELECT p.regno FROM paged p WHERE v_term <> '' AND lower(p.regno) = v_term LIMIT 1),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) - 'rn' ORDER BY p.rn)
      FROM paged p
      WHERE p.rn > (v_page-1)*v_size AND p.rn <= v_page*v_size
    ), '[]'::jsonb),
    'options', jsonb_build_object(
      'statuses', COALESCE((SELECT jsonb_agg(DISTINCT x.status) FROM base x WHERE x.status IS NOT NULL),'[]'::jsonb),
      'offices', COALESCE((SELECT jsonb_agg(DISTINCT x.office_code) FROM base x WHERE x.office_code IS NOT NULL),'[]'::jsonb),
      'risk_bands', COALESCE((SELECT jsonb_agg(DISTINCT x.risk_band) FROM base x WHERE x.risk_band IS NOT NULL),'[]'::jsonb),
      'sectors', COALESCE((SELECT jsonb_agg(DISTINCT x.sector_code) FROM base x WHERE x.sector_code IS NOT NULL),'[]'::jsonb),
      'ownerships', COALESCE((SELECT jsonb_agg(DISTINCT x.ownership_code) FROM base x WHERE x.ownership_code IS NOT NULL),'[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_employer_lookup_v1(jsonb,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_employer_lookup_v1(jsonb,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_employer_lookup_v1(jsonb,text,text,integer,integer) TO service_role;