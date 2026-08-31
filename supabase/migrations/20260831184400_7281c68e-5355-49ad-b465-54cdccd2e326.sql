CREATE OR REPLACE FUNCTION public.ce_finding_triage_register_v1(p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'priority'::text, p_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_export boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_code text;
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := CASE WHEN p_export THEN 20000 ELSE LEAST(GREATEST(COALESCE(p_page_size,25),5),200) END;
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'priority');
  v_result jsonb;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_queue text := upper(COALESCE(NULLIF(p_filters->>'queue',''),'PENDING'));
  f_severities text[] := CASE WHEN COALESCE(p_filters->>'severities','') = '' THEN NULL
    ELSE ARRAY(SELECT lower(trim(x)) FROM jsonb_array_elements_text(p_filters->'severities') x) END;
  f_types text[] := CASE WHEN COALESCE(p_filters->>'finding_types','') = '' THEN NULL
    ELSE ARRAY(SELECT lower(trim(x)) FROM jsonb_array_elements_text(p_filters->'finding_types') x) END;
  f_categories text[] := CASE WHEN COALESCE(p_filters->>'categories','') = '' THEN NULL
    ELSE ARRAY(SELECT lower(trim(x)) FROM jsonb_array_elements_text(p_filters->'categories') x) END;
  f_employer text := NULLIF(p_filters->>'employer','');
  f_inspection uuid := NULLIF(p_filters->>'inspection_id','')::uuid;
  f_inspector text := NULLIF(p_filters->>'inspector','');
  f_territory text := NULLIF(p_filters->>'territory','');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
  f_age text := NULLIF(upper(p_filters->>'age'),'');
  f_evidence text := NULLIF(upper(p_filters->>'evidence'),'');
  f_duplicate boolean := COALESCE((p_filters->>'duplicates_only')::boolean, false);
  f_mine boolean := COALESCE((p_filters->>'mine_only')::boolean, false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-REG-401: authentication required' USING ERRCODE='42501';
  END IF;

  IF public.ce_actor_can(v_uid,'compliance.workbench.enterprise') THEN v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid,'compliance.workbench.team') THEN v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid,'compliance.field.report') THEN v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'CE-FIND-REG-403: not authorised to read the finding triage register' USING ERRCODE='42501';
  END IF;

  v_code := public.ce_actor_code(v_uid);

  WITH base AS (
    SELECT
      f.id, f.title, f.description, f.finding_type, f.category, f.severity,
      f.recommended_action, f.created_at, f.created_by, f.disposition,
      f.violation_created, f.violation_id, f.inspection_id, f.candidate_violation_type_id,
      i.inspection_number, i.employer_id, i.employer_name,
      COALESCE(NULLIF(trim(i.territory),''),'Unassigned') AS territory,
      i.inspector_id, i.inspector_name,
      (SELECT count(*) FROM public.ce_inspection_evidence e WHERE e.finding_id = f.id) AS evidence_count,
      v.violation_number AS converted_violation_number,
      EXTRACT(EPOCH FROM (now() - f.created_at))/86400.0 AS age_days,
      (f.candidate_violation_type_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.ce_violations dv
         WHERE dv.employer_id = i.employer_id
           AND COALESCE(dv.is_deleted,false) = false
           AND dv.status IN ('OPEN','PENDING_VERIFICATION','UNDER_REVIEW')
           AND dv.violation_type_id = f.candidate_violation_type_id
      )) AS possible_duplicate
    FROM public.ce_inspection_findings f
    LEFT JOIN public.ce_inspections i ON i.id = f.inspection_id
    LEFT JOIN public.ce_violations v ON v.id = f.violation_id
    WHERE (v_scope = 'enterprise'
           OR (v_scope = 'team')
           OR (v_scope = 'own' AND (i.inspector_id = v_code OR f.created_by = v_code)))
  ), scoped AS (
    SELECT * FROM base b
    WHERE (
        (f_queue = 'PENDING' AND COALESCE(b.violation_created,false) = false
           AND b.disposition IN ('PENDING_REVIEW','FLAG_FOR_REVIEW','VIOLATION_CANDIDATE'))
        OR (f_queue = 'CONVERTED' AND COALESCE(b.violation_created,false) = true)
        OR (f_queue = 'NO_VIOLATION' AND COALESCE(b.violation_created,false) = false
           AND b.disposition = 'INFORMATIONAL')
        OR (f_queue = 'ALL')
      )
      AND (f_search IS NULL OR (
            b.title ILIKE '%'||f_search||'%' OR b.description ILIKE '%'||f_search||'%'
            OR b.employer_name ILIKE '%'||f_search||'%' OR b.employer_id ILIKE '%'||f_search||'%'
            OR b.inspection_number ILIKE '%'||f_search||'%'))
      AND (f_severities IS NULL OR lower(COALESCE(b.severity,'medium')) = ANY(f_severities))
      AND (f_types IS NULL OR lower(COALESCE(b.finding_type,'')) = ANY(f_types))
      AND (f_categories IS NULL OR lower(COALESCE(b.category,'')) = ANY(f_categories))
      AND (f_employer IS NULL OR b.employer_id = f_employer)
      AND (f_inspection IS NULL OR b.inspection_id = f_inspection)
      AND (f_inspector IS NULL OR b.inspector_id = f_inspector)
      AND (f_territory IS NULL OR b.territory = f_territory)
      AND (f_date_from IS NULL OR b.created_at::date >= f_date_from)
      AND (f_date_to IS NULL OR b.created_at::date <= f_date_to)
      AND (f_age IS NULL OR (
            (f_age = 'LT1' AND b.age_days < 1) OR
            (f_age = 'D1_3' AND b.age_days >= 1 AND b.age_days < 4) OR
            (f_age = 'D4_7' AND b.age_days >= 4 AND b.age_days < 8) OR
            (f_age = 'D8_14' AND b.age_days >= 8 AND b.age_days < 15) OR
            (f_age = 'D15P' AND b.age_days >= 15)))
      AND (f_evidence IS NULL OR (
            (f_evidence = 'NONE' AND b.evidence_count = 0) OR
            (f_evidence = 'HAS' AND b.evidence_count > 0)))
      AND (NOT f_duplicate OR b.possible_duplicate)
      AND (NOT f_mine OR b.inspector_id = v_code OR b.created_by = v_code)
  ), ranked AS (
    SELECT s.*,
      CASE lower(COALESCE(s.severity,'medium'))
        WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END AS severity_rank
    FROM scoped s
  ), counted AS (SELECT count(*) AS total FROM ranked),
  kpis AS (
    SELECT
      count(*) AS awaiting,
      count(*) FILTER (WHERE severity_rank >= 3) AS critical_high,
      count(*) FILTER (WHERE possible_duplicate) AS duplicates,
      count(*) FILTER (WHERE evidence_count = 0) AS no_evidence,
      min(created_at) AS oldest_pending,
      COALESCE(max(age_days),0)::numeric(10,1) AS max_age_days
    FROM ranked
  ), page AS (
    SELECT * FROM ranked
    ORDER BY
      CASE WHEN v_sort='priority' THEN severity_rank END DESC NULLS LAST,
      CASE WHEN v_sort='priority' THEN created_at END ASC,
      CASE WHEN v_sort='created_at' AND v_dir='asc' THEN created_at END ASC,
      CASE WHEN v_sort='created_at' AND v_dir='desc' THEN created_at END DESC,
      CASE WHEN v_sort='age' AND v_dir='desc' THEN age_days END DESC,
      CASE WHEN v_sort='age' AND v_dir='asc' THEN age_days END ASC,
      CASE WHEN v_sort='severity' AND v_dir='desc' THEN severity_rank END DESC,
      CASE WHEN v_sort='severity' AND v_dir='asc' THEN severity_rank END ASC,
      CASE WHEN v_sort='employer' AND v_dir='asc' THEN employer_name END ASC,
      CASE WHEN v_sort='employer' AND v_dir='desc' THEN employer_name END DESC,
      CASE WHEN v_sort='inspection' AND v_dir='asc' THEN inspection_number END ASC,
      CASE WHEN v_sort='inspection' AND v_dir='desc' THEN inspection_number END DESC,
      CASE WHEN v_sort='finding_type' AND v_dir='asc' THEN finding_type END ASC,
      CASE WHEN v_sort='finding_type' AND v_dir='desc' THEN finding_type END DESC,
      CASE WHEN v_sort='evidence' AND v_dir='desc' THEN evidence_count END DESC,
      CASE WHEN v_sort='evidence' AND v_dir='asc' THEN evidence_count END ASC,
      created_at DESC
    LIMIT v_size OFFSET (v_page-1)*v_size
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'page', v_page,
    'page_size', v_size,
    'total', (SELECT total FROM counted),
    'kpis', (SELECT to_jsonb(k) FROM kpis k),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'severity_rank') FROM page p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $function$;