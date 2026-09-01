-- ============================================================
-- Inspection Findings Register (master lifecycle view)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_findings_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'register',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_export boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_code text;
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := CASE WHEN p_export THEN 20000 ELSE LEAST(GREATEST(COALESCE(p_page_size,25),5),200) END;
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'register');
  v_result jsonb;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_quick text := upper(COALESCE(NULLIF(p_filters->>'quick',''),'ALL'));
  f_severities text[] := CASE WHEN COALESCE(p_filters->>'severities','') = '' THEN NULL
    ELSE ARRAY(SELECT lower(trim(x)) FROM jsonb_array_elements_text(p_filters->'severities') x) END;
  f_types text[] := CASE WHEN COALESCE(p_filters->>'finding_types','') = '' THEN NULL
    ELSE ARRAY(SELECT lower(trim(x)) FROM jsonb_array_elements_text(p_filters->'finding_types') x) END;
  f_categories text[] := CASE WHEN COALESCE(p_filters->>'categories','') = '' THEN NULL
    ELSE ARRAY(SELECT lower(trim(x)) FROM jsonb_array_elements_text(p_filters->'categories') x) END;
  f_dispositions text[] := CASE WHEN COALESCE(p_filters->>'dispositions','') = '' THEN NULL
    ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'dispositions') x) END;
  f_employer text := NULLIF(p_filters->>'employer','');
  f_inspection uuid := NULLIF(p_filters->>'inspection_id','')::uuid;
  f_inspector text := NULLIF(p_filters->>'inspector','');
  f_territory text := NULLIF(p_filters->>'territory','');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
  f_age text := NULLIF(upper(p_filters->>'age'),'');
  f_evidence text := NULLIF(upper(p_filters->>'evidence'),'');
  f_outcome text := NULLIF(upper(p_filters->>'violation_outcome'),'');
  f_mine boolean := COALESCE((p_filters->>'mine_only')::boolean, false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-MREG-401: authentication required' USING ERRCODE='42501';
  END IF;

  IF public.ce_actor_can(v_uid,'compliance.workbench.enterprise') THEN v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid,'compliance.workbench.team') THEN v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid,'compliance.field.report') THEN v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'CE-FIND-MREG-403: not authorised to read the inspection findings register' USING ERRCODE='42501';
  END IF;

  v_code := public.ce_actor_code(v_uid);

  WITH base AS (
    SELECT
      f.id, f.title, f.description, f.finding_type, f.category, f.severity,
      f.recommended_action, f.created_at, f.created_by, f.disposition,
      f.review_notes, f.reviewed_by, f.reviewed_at, f.converted_by, f.converted_at,
      f.violation_created, f.violation_id, f.inspection_id, f.candidate_violation_type_id,
      f.follow_up_required,
      i.inspection_number, i.employer_id, i.employer_name, i.visit_date, i.status AS inspection_status,
      COALESCE(NULLIF(trim(i.territory),''),'Unassigned') AS territory,
      i.inspector_id, i.inspector_name,
      (SELECT count(*) FROM public.ce_inspection_evidence e WHERE e.finding_id = f.id) AS evidence_count,
      v.violation_number, v.status AS violation_status,
      EXTRACT(EPOCH FROM (now() - f.created_at))/86400.0 AS age_days,
      CASE
        WHEN v.id IS NULL AND COALESCE(f.violation_created,false) = false THEN
          CASE WHEN COALESCE(f.disposition,'PENDING_REVIEW') = 'VIOLATION_CANDIDATE'
               THEN 'CONVERSION_PENDING' ELSE 'NOT_CONVERTED' END
        WHEN v.status = 'PENDING_VERIFICATION' THEN 'VERIFICATION_PENDING'
        WHEN v.status IN ('RESOLVED','CLOSED','CANCELLED') THEN 'RESOLVED_VIOLATION'
        WHEN v.status IN ('OPEN','UNDER_REVIEW','IN_PROGRESS','ESCALATED') THEN 'OPEN_VIOLATION'
        ELSE 'VIOLATION_CREATED'
      END AS violation_outcome
    FROM public.ce_inspection_findings f
    LEFT JOIN public.ce_inspections i ON i.id = f.inspection_id
    LEFT JOIN public.ce_violations v ON v.id = f.violation_id
    WHERE (v_scope IN ('enterprise','team')
           OR (v_scope = 'own' AND (i.inspector_id = v_code OR f.created_by = v_code)))
  ), ranked0 AS (
    SELECT b.*,
      CASE lower(COALESCE(b.severity,'medium'))
        WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END AS severity_rank,
      COALESCE(NULLIF(upper(trim(b.disposition)),''),'PENDING_REVIEW') AS disposition_code
    FROM base b
  ), scoped AS (
    SELECT * FROM ranked0 b
    WHERE (f_search IS NULL OR (
            COALESCE(b.title,'') ILIKE '%'||f_search||'%' OR COALESCE(b.description,'') ILIKE '%'||f_search||'%'
            OR COALESCE(b.employer_name,'') ILIKE '%'||f_search||'%' OR COALESCE(b.employer_id,'') ILIKE '%'||f_search||'%'
            OR COALESCE(b.inspection_number,'') ILIKE '%'||f_search||'%'
            OR COALESCE(b.violation_number,'') ILIKE '%'||f_search||'%'))
      AND (f_severities IS NULL OR lower(COALESCE(b.severity,'medium')) = ANY(f_severities))
      AND (f_types IS NULL OR lower(COALESCE(b.finding_type,'')) = ANY(f_types))
      AND (f_categories IS NULL OR lower(COALESCE(b.category,'')) = ANY(f_categories))
      AND (f_dispositions IS NULL OR b.disposition_code = ANY(f_dispositions))
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
      AND (f_outcome IS NULL OR b.violation_outcome = f_outcome)
      AND (NOT f_mine OR b.inspector_id = v_code OR b.created_by = v_code)
      AND (
        f_quick = 'ALL'
        OR (f_quick = 'PENDING' AND COALESCE(b.violation_created,false) = false
            AND b.disposition_code IN ('PENDING_REVIEW','FLAG_FOR_REVIEW'))
        OR (f_quick = 'CRITICAL_HIGH' AND b.severity_rank >= 3)
        OR (f_quick = 'CONVERTED' AND COALESCE(b.violation_created,false) = true)
        OR (f_quick = 'NOT_CONVERTED' AND COALESCE(b.violation_created,false) = false)
        OR (f_quick = 'NO_VIOLATION' AND b.disposition_code = 'INFORMATIONAL')
        OR (f_quick = 'NO_EVIDENCE' AND b.evidence_count = 0)
        OR (f_quick = 'MINE' AND (b.inspector_id = v_code OR b.created_by = v_code))
      )
  ), counted AS (SELECT count(*) AS total FROM scoped),
  kpis AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE COALESCE(violation_created,false) = false
                         AND disposition_code IN ('PENDING_REVIEW','FLAG_FOR_REVIEW')) AS pending_review,
      count(*) FILTER (WHERE severity_rank >= 3) AS critical_high,
      count(*) FILTER (WHERE COALESCE(violation_created,false) = true) AS converted,
      count(*) FILTER (WHERE COALESCE(violation_created,false) = false
                         AND disposition_code = 'INFORMATIONAL') AS no_violation,
      count(*) FILTER (WHERE evidence_count = 0) AS no_evidence,
      min(created_at) FILTER (WHERE COALESCE(violation_created,false) = false
                         AND disposition_code IN ('PENDING_REVIEW','FLAG_FOR_REVIEW')) AS oldest_pending
    FROM scoped
  ), dispo AS (
    SELECT COALESCE(jsonb_object_agg(disposition_code, n),'{}'::jsonb) AS summary
    FROM (SELECT disposition_code, count(*) n FROM scoped GROUP BY 1) s
  ), page AS (
    SELECT * FROM scoped
    ORDER BY
      CASE WHEN v_sort='register' THEN
        (CASE WHEN COALESCE(violation_created,false) = false
                AND disposition_code IN ('PENDING_REVIEW','FLAG_FOR_REVIEW') THEN 0 ELSE 1 END) END ASC,
      CASE WHEN v_sort='register' THEN severity_rank END DESC,
      CASE WHEN v_sort='register' THEN created_at END ASC,
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
      CASE WHEN v_sort='disposition' AND v_dir='asc' THEN disposition_code END ASC,
      CASE WHEN v_sort='disposition' AND v_dir='desc' THEN disposition_code END DESC,
      CASE WHEN v_sort='evidence' AND v_dir='desc' THEN evidence_count END DESC,
      CASE WHEN v_sort='evidence' AND v_dir='asc' THEN evidence_count END ASC,
      CASE WHEN v_sort='violation' AND v_dir='asc' THEN violation_outcome END ASC,
      CASE WHEN v_sort='violation' AND v_dir='desc' THEN violation_outcome END DESC,
      created_at DESC
    LIMIT v_size OFFSET (v_page-1)*v_size
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'actor_code', v_code,
    'page', v_page,
    'page_size', v_size,
    'total', (SELECT total FROM counted),
    'kpis', (SELECT to_jsonb(k) FROM kpis k),
    'disposition_summary', (SELECT summary FROM dispo),
    'conversion_queue_count', (
      SELECT count(*) FROM ranked0 r
       WHERE COALESCE(r.violation_created,false) = false
         AND r.disposition_code IN ('PENDING_REVIEW','FLAG_FOR_REVIEW','VIOLATION_CANDIDATE')),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'severity_rank') FROM page p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.ce_findings_register_v1(jsonb,text,text,integer,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_findings_register_v1(jsonb,text,text,integer,integer,boolean) TO authenticated, service_role;

-- ============================================================
-- Filter options for the register (all findings, not only pending)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_findings_register_facets_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'finding_types', COALESCE((SELECT jsonb_agg(DISTINCT finding_type) FROM public.ce_inspection_findings WHERE NULLIF(trim(finding_type),'') IS NOT NULL),'[]'::jsonb),
    'categories', COALESCE((SELECT jsonb_agg(DISTINCT category) FROM public.ce_inspection_findings WHERE NULLIF(trim(category),'') IS NOT NULL),'[]'::jsonb),
    'territories', COALESCE((SELECT jsonb_agg(DISTINCT COALESCE(NULLIF(trim(territory),''),'Unassigned')) FROM public.ce_inspections),'[]'::jsonb),
    'inspectors', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id',inspector_id,'name',COALESCE(inspector_name,inspector_id))) FROM public.ce_inspections WHERE NULLIF(trim(inspector_id),'') IS NOT NULL),'[]'::jsonb),
    'employers', COALESCE((SELECT jsonb_agg(e) FROM (
        SELECT DISTINCT jsonb_build_object('id',i.employer_id,'name',COALESCE(i.employer_name,i.employer_id)) e
        FROM public.ce_inspections i
        JOIN public.ce_inspection_findings f ON f.inspection_id = i.id
        WHERE NULLIF(trim(i.employer_id),'') IS NOT NULL) s),'[]'::jsonb),
    'inspections', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT DISTINCT jsonb_build_object('id',i.id,'number',i.inspection_number,'employer',COALESCE(i.employer_name,i.employer_id)) x
        FROM public.ce_inspections i
        JOIN public.ce_inspection_findings f ON f.inspection_id = i.id) s),'[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.ce_findings_register_facets_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_findings_register_facets_v1() TO authenticated, service_role;

-- ============================================================
-- Finding detail + lifecycle timeline
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_finding_detail_v1(p_finding_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-DET-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
       OR public.ce_actor_can(v_uid,'compliance.workbench.team')
       OR public.ce_actor_can(v_uid,'compliance.field.report')) THEN
    RAISE EXCEPTION 'CE-FIND-DET-403: not authorised to read inspection findings' USING ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object(
    'finding', to_jsonb(f) - 'evidence_documents',
    'inspection', to_jsonb(i),
    'violation', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v.id, 'violation_number', v.violation_number, 'status', v.status,
        'severity', v.severity, 'created_at', v.created_at) END,
    'candidate_violation_type', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', t.id, 'code', t.code, 'name', t.name,
        'conversion_policy', t.conversion_policy,
        'requires_supervisor_review', t.requires_supervisor_review,
        'maker_checker_required', t.maker_checker_required) END,
    'evidence', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'evidence_type', e.evidence_type, 'file_name', e.file_name,
        'file_url', e.file_url, 'description', e.description,
        'captured_at', e.captured_at, 'captured_by', e.captured_by) ORDER BY e.created_at)
      FROM public.ce_inspection_evidence e WHERE e.finding_id = f.id),'[]'::jsonb),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'action', a.action, 'entity_type', a.entity_type,
        'performed_by', a.performed_by, 'performed_at', a.performed_at,
        'description', a.description, 'reason', a.reason,
        'old_values', a.old_values, 'new_values', a.new_values) ORDER BY a.performed_at)
      FROM public.ce_audit_log a
      WHERE a.entity_id = f.id::text
        AND a.entity_type IN ('ce_inspection_findings','ce_inspection_finding')),'[]'::jsonb)
  ) INTO v_result
  FROM public.ce_inspection_findings f
  LEFT JOIN public.ce_inspections i ON i.id = f.inspection_id
  LEFT JOIN public.ce_violations v ON v.id = f.violation_id
  LEFT JOIN public.ce_violation_types t ON t.id = f.candidate_violation_type_id
  WHERE f.id = p_finding_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-DET-404: finding not found' USING ERRCODE='22023';
  END IF;
  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.ce_finding_detail_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_finding_detail_v1(uuid) TO authenticated, service_role;

-- ============================================================
-- Governed classification (disposition + candidate violation type)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_classify_finding_v1(
  p_finding_id uuid,
  p_disposition text,
  p_reason text,
  p_candidate_violation_type_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_f public.ce_inspection_findings;
  v_disp text := upper(trim(COALESCE(p_disposition,'')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-CLS-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.violations.manage') THEN
    RAISE EXCEPTION 'CE-FIND-CLS-403: compliance.violations.manage is required to classify findings' USING ERRCODE='42501';
  END IF;
  IF v_disp NOT IN ('INFORMATIONAL','FLAG_FOR_REVIEW','VIOLATION_CANDIDATE') THEN
    RAISE EXCEPTION 'CE-FIND-CLS-422: unsupported disposition %', v_disp USING ERRCODE='22023';
  END IF;
  IF COALESCE(length(trim(p_reason)),0) < 10 THEN
    RAISE EXCEPTION 'CE-FIND-CLS-422: a review note of at least 10 characters is required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_f FROM public.ce_inspection_findings WHERE id = p_finding_id FOR UPDATE;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'CE-FIND-CLS-404: finding not found' USING ERRCODE='22023';
  END IF;
  IF COALESCE(v_f.violation_created,false) THEN
    RAISE EXCEPTION 'CE-FIND-CLS-409: a converted finding cannot be re-classified' USING ERRCODE='22023';
  END IF;

  v_code := left(public.ce_actor_code(v_uid),64);

  UPDATE public.ce_inspection_findings
     SET disposition = v_disp,
         candidate_violation_type_id = COALESCE(p_candidate_violation_type_id, candidate_violation_type_id),
         review_notes = trim(p_reason),
         reviewed_by = v_code,
         reviewed_at = now(),
         updated_by = v_code,
         updated_at = now()
   WHERE id = p_finding_id;

  PERFORM public.ce_b2_audit('ce.finding.classified','ce_inspection_findings', p_finding_id::text,
    jsonb_build_object('from', v_f.disposition, 'to', v_disp,
                       'reason', trim(p_reason),
                       'candidate_violation_type_id', COALESCE(p_candidate_violation_type_id, v_f.candidate_violation_type_id)));

  RETURN jsonb_build_object('finding_id', p_finding_id, 'disposition', v_disp);
END $function$;

REVOKE ALL ON FUNCTION public.ce_classify_finding_v1(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_classify_finding_v1(uuid,text,text,uuid) TO authenticated, service_role;