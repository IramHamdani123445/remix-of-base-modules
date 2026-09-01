-- 1. Remove duplicate foreign keys (PostgREST embedding ambiguity)
ALTER TABLE public.ce_inspection_findings DROP CONSTRAINT IF EXISTS fk_ce_inspection_findings_inspection;
ALTER TABLE public.ce_inspection_findings DROP CONSTRAINT IF EXISTS ce_inspection_findings_violation_id_fkey;

-- 2. Canonical violation numbering from configured templates
CREATE OR REPLACE FUNCTION public.ce_next_number_v1(p_applies_to text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tpl public.ce_number_templates;
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_month int;
  v_val int;
  v_num text;
BEGIN
  SELECT * INTO v_tpl FROM public.ce_number_templates
   WHERE applies_to = p_applies_to AND is_active = true
   ORDER BY is_default DESC, created_at ASC LIMIT 1;
  IF v_tpl.id IS NULL THEN
    RAISE EXCEPTION 'CE-NUM-404: no active number template configured for %', p_applies_to USING ERRCODE='22023';
  END IF;

  v_month := CASE WHEN COALESCE(v_tpl.reset_frequency,'yearly') = 'monthly'
                  THEN EXTRACT(MONTH FROM now())::int ELSE 0 END;

  INSERT INTO public.ce_number_sequences(template_id, year, month, current_value)
  VALUES (v_tpl.id, v_year, v_month, 1)
  ON CONFLICT (template_id, year, month)
  DO UPDATE SET current_value = public.ce_number_sequences.current_value + 1
  RETURNING current_value INTO v_val;

  v_num := COALESCE(v_tpl.template_pattern, COALESCE(v_tpl.prefix,'NUM') || '-{YYYY}-{NNNNN}');
  v_num := replace(v_num, '{YYYY}', v_year::text);
  v_num := replace(v_num, '{MM}', lpad(GREATEST(v_month, EXTRACT(MONTH FROM now())::int)::text, 2, '0'));
  v_num := regexp_replace(v_num, '\{N+\}', lpad(v_val::text, GREATEST(COALESCE(v_tpl.padding_length,5),1), '0'));
  RETURN v_num;
END $$;

GRANT EXECUTE ON FUNCTION public.ce_next_number_v1(text) TO authenticated, service_role;

-- 3. Finding triage register
CREATE OR REPLACE FUNCTION public.ce_finding_triage_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'priority',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_export boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      EXISTS (
        SELECT 1 FROM public.ce_violations dv
         WHERE dv.employer_id = i.employer_id
           AND COALESCE(dv.is_deleted,false) = false
           AND dv.status IN ('OPEN','PENDING_VERIFICATION','UNDER_REVIEW')
           AND (f.candidate_violation_type_id IS NULL
                OR dv.violation_type_id = f.candidate_violation_type_id)
      ) AS possible_duplicate
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
END $$;

GRANT EXECUTE ON FUNCTION public.ce_finding_triage_register_v1(jsonb,text,text,integer,integer,boolean) TO authenticated, service_role;

-- 4. Facet options for filters
CREATE OR REPLACE FUNCTION public.ce_finding_triage_facets_v1()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'finding_types', COALESCE((SELECT jsonb_agg(DISTINCT finding_type) FROM public.ce_inspection_findings WHERE NULLIF(trim(finding_type),'') IS NOT NULL),'[]'::jsonb),
    'categories', COALESCE((SELECT jsonb_agg(DISTINCT category) FROM public.ce_inspection_findings WHERE NULLIF(trim(category),'') IS NOT NULL),'[]'::jsonb),
    'territories', COALESCE((SELECT jsonb_agg(DISTINCT territory) FROM public.ce_inspections WHERE NULLIF(trim(territory),'') IS NOT NULL),'[]'::jsonb),
    'inspectors', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id',inspector_id,'name',COALESCE(inspector_name,inspector_id))) FROM public.ce_inspections WHERE NULLIF(trim(inspector_id),'') IS NOT NULL),'[]'::jsonb),
    'employers', COALESCE((SELECT jsonb_agg(e) FROM (
        SELECT DISTINCT jsonb_build_object('id',i.employer_id,'name',COALESCE(i.employer_name,i.employer_id)) e
        FROM public.ce_inspections i
        JOIN public.ce_inspection_findings f ON f.inspection_id = i.id
        WHERE NULLIF(trim(i.employer_id),'') IS NOT NULL) s),'[]'::jsonb),
    'inspections', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT DISTINCT jsonb_build_object('id',i.id,'number',i.inspection_number,'employer',COALESCE(i.employer_name,i.employer_id)) x
        FROM public.ce_inspections i
        JOIN public.ce_inspection_findings f ON f.inspection_id = i.id
        WHERE COALESCE(f.violation_created,false) = false) s),'[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.ce_finding_triage_facets_v1() TO authenticated, service_role;

-- 5. Atomic conversion
CREATE OR REPLACE FUNCTION public.ce_convert_finding_to_violation_v1(
  p_finding_id uuid,
  p_violation_type_id uuid,
  p_summary text,
  p_severity text,
  p_principal_amount numeric DEFAULT 0,
  p_duplicate_of_id uuid DEFAULT NULL,
  p_duplicate_justification text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_f public.ce_inspection_findings;
  v_i public.ce_inspections;
  v_type public.ce_violation_types;
  v_status text;
  v_number text;
  v_vid uuid;
  v_evidence uuid[];
  v_queue boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-CONV-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.violations.manage') THEN
    RAISE EXCEPTION 'CE-FIND-CONV-403: compliance.violations.manage is required to convert findings' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_f FROM public.ce_inspection_findings WHERE id = p_finding_id FOR UPDATE;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-CONV-404: finding not found' USING ERRCODE='22023';
  END IF;
  IF COALESCE(v_f.violation_created,false) THEN
    RAISE EXCEPTION 'CE-FIND-CONV-409: finding is already converted' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_type FROM public.ce_violation_types WHERE id = p_violation_type_id AND is_active = true;
  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-CONV-422: an active configured violation type is required' USING ERRCODE='22023';
  END IF;
  IF COALESCE(NULLIF(trim(p_summary),''), NULL) IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-CONV-422: a violation summary is required' USING ERRCODE='22023';
  END IF;
  IF p_duplicate_of_id IS NOT NULL AND COALESCE(length(trim(p_duplicate_justification)),0) < 10 THEN
    RAISE EXCEPTION 'CE-FIND-CONV-422: a justification of at least 10 characters is required to override a duplicate' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_i FROM public.ce_inspections WHERE id = v_f.inspection_id;
  v_code := left(public.ce_actor_code(v_uid),50);

  SELECT COALESCE((value)::boolean, true) INTO v_queue
    FROM public.ce_compliance_settings WHERE key = 'violations.verificationQueue' LIMIT 1;
  v_queue := COALESCE(v_queue, true);

  -- supervisor-review types always go through the verification queue
  IF COALESCE(v_type.requires_supervisor_review,false) THEN v_queue := true; END IF;
  v_status := CASE WHEN v_queue THEN 'PENDING_VERIFICATION' ELSE 'OPEN' END;

  v_number := public.ce_next_number_v1('violation');

  SELECT COALESCE(array_agg(e.id), '{}'::uuid[]) INTO v_evidence
    FROM public.ce_inspection_evidence e WHERE e.finding_id = v_f.id;

  INSERT INTO public.ce_violations(
    violation_number, employer_id, employer_name, territory, violation_type_id,
    fund_type, status, severity, summary, description,
    principal_amount, total_amount, source_type, inspection_id,
    duplicate_of_id, duplicate_justification, discovered_date, discovered_by,
    created_by, updated_by, linked_evidence_ids, linkage_metadata
  ) VALUES (
    v_number, v_i.employer_id, v_i.employer_name, v_i.territory, p_violation_type_id,
    v_type.fund_type,
    v_status,
    COALESCE(NULLIF(trim(p_severity),''), v_type.severity_default, 'Medium'),
    trim(p_summary), v_f.description,
    COALESCE(p_principal_amount,0), COALESCE(p_principal_amount,0),
    'INSPECTION_FINDING', v_f.inspection_id,
    p_duplicate_of_id, NULLIF(trim(p_duplicate_justification),''),
    COALESCE(v_f.created_at::date, CURRENT_DATE), v_code,
    v_code, v_code, v_evidence,
    jsonb_build_object(
      'finding_id', v_f.id,
      'inspection_id', v_f.inspection_id,
      'inspection_number', v_i.inspection_number,
      'finding_type', v_f.finding_type,
      'finding_category', v_f.category,
      'finding_severity', v_f.severity,
      'recommended_action', v_f.recommended_action,
      'evidence_ids', to_jsonb(v_evidence),
      'conversion_policy', v_type.conversion_policy,
      'verification_destination', v_status)
  ) RETURNING id INTO v_vid;

  UPDATE public.ce_inspection_findings
     SET violation_created = true,
         violation_id = v_vid,
         converted_by = v_code,
         converted_at = now(),
         updated_by = v_code,
         updated_at = now()
   WHERE id = v_f.id;

  PERFORM public.ce_b2_audit('ce.finding.convert_to_violation','ce_inspection_findings', v_f.id::text,
    jsonb_build_object('violation_id',v_vid,'violation_number',v_number,
      'violation_type_id',p_violation_type_id,'violation_type_code',v_type.code,
      'employer_id',v_i.employer_id,'inspection_id',v_f.inspection_id,
      'severity',COALESCE(NULLIF(trim(p_severity),''), v_type.severity_default),
      'principal_amount',COALESCE(p_principal_amount,0),
      'duplicate_of_id',p_duplicate_of_id,'duplicate_justification',p_duplicate_justification,
      'destination',v_status,'evidence_count',COALESCE(array_length(v_evidence,1),0)));

  RETURN jsonb_build_object('violation_id',v_vid,'violation_number',v_number,'status',v_status,
                            'evidence_count',COALESCE(array_length(v_evidence,1),0));
END $$;

GRANT EXECUTE ON FUNCTION public.ce_convert_finding_to_violation_v1(uuid,uuid,text,text,numeric,uuid,text) TO authenticated, service_role;

-- 6. No-violation disposition
CREATE OR REPLACE FUNCTION public.ce_dispose_finding_v1(
  p_finding_id uuid,
  p_disposition text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_f public.ce_inspection_findings;
  v_disp text := upper(trim(COALESCE(p_disposition,'')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-DISP-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.violations.manage') THEN
    RAISE EXCEPTION 'CE-FIND-DISP-403: compliance.violations.manage is required to dispose findings' USING ERRCODE='42501';
  END IF;
  IF v_disp NOT IN ('INFORMATIONAL','FLAG_FOR_REVIEW','VIOLATION_CANDIDATE') THEN
    RAISE EXCEPTION 'CE-FIND-DISP-422: unsupported disposition %', v_disp USING ERRCODE='22023';
  END IF;
  IF COALESCE(length(trim(p_reason)),0) < 10 THEN
    RAISE EXCEPTION 'CE-FIND-DISP-422: a decision reason of at least 10 characters is required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_f FROM public.ce_inspection_findings WHERE id = p_finding_id FOR UPDATE;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-DISP-404: finding not found' USING ERRCODE='22023';
  END IF;
  IF COALESCE(v_f.violation_created,false) THEN
    RAISE EXCEPTION 'CE-FIND-DISP-409: a converted finding cannot be re-dispositioned' USING ERRCODE='22023';
  END IF;

  v_code := left(public.ce_actor_code(v_uid),64);

  UPDATE public.ce_inspection_findings
     SET disposition = v_disp,
         review_notes = trim(p_reason),
         reviewed_by = v_code,
         reviewed_at = now(),
         updated_by = v_code,
         updated_at = now()
   WHERE id = p_finding_id;

  PERFORM public.ce_b2_audit('ce.finding.disposition','ce_inspection_findings', p_finding_id::text,
    jsonb_build_object('from',v_f.disposition,'to',v_disp,'reason',trim(p_reason)));

  RETURN jsonb_build_object('finding_id',p_finding_id,'disposition',v_disp);
END $$;

GRANT EXECUTE ON FUNCTION public.ce_dispose_finding_v1(uuid,text,text) TO authenticated, service_role;

-- 7. Supporting indexes
CREATE INDEX IF NOT EXISTS idx_ce_findings_unconverted ON public.ce_inspection_findings (violation_created, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_findings_disposition ON public.ce_inspection_findings (disposition);
CREATE INDEX IF NOT EXISTS idx_ce_evidence_finding ON public.ce_inspection_evidence (finding_id);