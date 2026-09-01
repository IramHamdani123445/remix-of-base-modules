CREATE OR REPLACE FUNCTION public.ce_audit_report_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'report_date',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_export boolean DEFAULT false
)
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
  v_sort text := COALESCE(NULLIF(p_sort,''),'report_date');
  v_result jsonb;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_statuses text[] := CASE WHEN COALESCE(p_filters->>'statuses','') = '' THEN NULL
                            ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'statuses') x) END;
  f_acks text[] := CASE WHEN COALESCE(p_filters->>'acknowledgments','') = '' THEN NULL
                        ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'acknowledgments') x) END;
  f_employer text := NULLIF(p_filters->>'employer','');
  f_inspector text := NULLIF(p_filters->>'inspector','');
  f_territory text := NULLIF(p_filters->>'territory','');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
  f_findings text := NULLIF(upper(p_filters->>'findings'),'');
  f_violations text := NULLIF(upper(p_filters->>'violations'),'');
  f_pdf text := NULLIF(upper(p_filters->>'pdf'),'');
  f_attention text := NULLIF(upper(p_filters->>'attention'),'');
  f_age text := NULLIF(upper(p_filters->>'age'),'');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-AUDREP-REG-401: authentication required';
  END IF;

  IF public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN
    v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN
    v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid, 'compliance.reports.operational') THEN
    v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'CE-AUDREP-REG-403: not authorised to read the field audit report register';
  END IF;

  v_code := public.ce_actor_code(v_uid);

  WITH scoped AS (
    SELECT
      r.id,
      r.report_number,
      r.inspection_id,
      i.inspection_number,
      COALESCE(NULLIF(trim(i.territory),''),'Unassigned') AS territory,
      r.employer_id,
      COALESCE(NULLIF(trim(r.employer_name),''), NULLIF(trim(i.employer_name),''),'Unknown employer') AS employer_name,
      r.employer_reg_number,
      COALESCE(r.inspector_id, i.inspector_id) AS inspector_id,
      COALESCE(NULLIF(trim(r.inspector_name),''), NULLIF(trim(i.inspector_name),'')) AS inspector_name,
      r.report_date,
      r.audit_date,
      upper(COALESCE(NULLIF(trim(r.status),''),'DRAFT')) AS status,
      upper(COALESCE(NULLIF(trim(r.acknowledgment_status),''),'NOT_SENT')) AS acknowledgment_status,
      COALESCE(r.total_findings,0) AS total_findings,
      COALESCE(r.total_violations,0) AS total_violations,
      COALESCE(r.total_evidence,0) AS total_evidence,
      COALESCE(r.checklist_completion_pct,0)::numeric AS checklist_completion_pct,
      COALESCE(r.current_version,1) AS current_version,
      (SELECT count(*) FROM public.ce_audit_report_versions v WHERE v.report_id = r.id) AS version_count,
      r.risk_rating,
      (COALESCE(r.signed_pdf_url, r.employer_pdf_url, r.internal_pdf_url, r.pdf_url) IS NOT NULL) AS has_pdf,
      r.pdf_url, r.signed_pdf_url, r.internal_pdf_url, r.employer_pdf_url,
      r.generated_at, r.finalized_at,
      r.acknowledgment_sent_at, r.acknowledgment_completed_at,
      r.created_by, r.created_at, r.updated_at,
      (CURRENT_DATE - COALESCE(r.report_date, r.created_at::date))::int AS age_days
    FROM public.ce_employer_audit_reports r
    LEFT JOIN public.ce_inspections i ON i.id = r.inspection_id
    WHERE (
      v_scope IN ('enterprise','team')
      OR COALESCE(r.inspector_id,'') = COALESCE(v_code,'~')
      OR COALESCE(r.created_by,'') = COALESCE(v_code,'~')
      OR COALESCE(i.inspector_id,'') = COALESCE(v_code,'~')
    )
  ), enriched AS (
    SELECT s.*,
      CASE
        WHEN s.status = 'DRAFT' THEN 'DRAFT'
        WHEN s.status IN ('SUPERSEDED','VOID','CANCELLED') THEN 'SUPERSEDED'
        WHEN s.acknowledgment_status IN ('ACKNOWLEDGED','SIGNED','COMPLETED') THEN 'ACKNOWLEDGED'
        WHEN s.acknowledgment_status IN ('SENT','VIEWED','IN_PROGRESS') THEN 'AWAITING_ACK'
        ELSE 'FINAL'
      END AS lifecycle_stage,
      CASE WHEN s.acknowledgment_sent_at IS NULL THEN NULL
           ELSE (CURRENT_DATE - s.acknowledgment_sent_at::date)::int END AS ack_days_outstanding
    FROM scoped s
  ), flagged AS (
    SELECT e.*,
      (e.status = 'DRAFT' AND e.age_days > 7) AS draft_ageing,
      (e.lifecycle_stage = 'AWAITING_ACK' AND COALESCE(e.ack_days_outstanding,0) > 14) AS ack_overdue,
      (e.status = 'FINAL' AND NOT e.has_pdf) AS missing_pdf
    FROM enriched e
  ), filtered AS (
    SELECT f.* FROM flagged f
    WHERE (f_search IS NULL
        OR f.report_number ILIKE '%'||f_search||'%'
        OR COALESCE(f.inspection_number,'') ILIKE '%'||f_search||'%'
        OR COALESCE(f.employer_name,'') ILIKE '%'||f_search||'%'
        OR COALESCE(f.employer_id,'') ILIKE '%'||f_search||'%'
        OR COALESCE(f.employer_reg_number,'') ILIKE '%'||f_search||'%'
        OR COALESCE(f.inspector_name,'') ILIKE '%'||f_search||'%'
        OR COALESCE(f.inspector_id,'') ILIKE '%'||f_search||'%')
      AND (f_statuses IS NULL OR f.status = ANY(f_statuses))
      AND (f_acks IS NULL OR f.acknowledgment_status = ANY(f_acks))
      AND (f_employer IS NULL OR f.employer_id = f_employer)
      AND (f_inspector IS NULL
        OR (f_inspector = 'ME' AND (f.inspector_id = v_code OR f.created_by = v_code))
        OR (f_inspector = 'UNASSIGNED' AND NULLIF(trim(COALESCE(f.inspector_id,'')),'') IS NULL)
        OR (f_inspector NOT IN ('ME','UNASSIGNED') AND f.inspector_id = f_inspector))
      AND (f_territory IS NULL OR f.territory = f_territory)
      AND (f_date_from IS NULL OR f.report_date >= f_date_from)
      AND (f_date_to IS NULL OR f.report_date <= f_date_to)
      AND (f_findings IS NULL OR (f_findings='WITH' AND f.total_findings > 0) OR (f_findings='WITHOUT' AND f.total_findings = 0))
      AND (f_violations IS NULL OR (f_violations='WITH' AND f.total_violations > 0) OR (f_violations='WITHOUT' AND f.total_violations = 0))
      AND (f_pdf IS NULL OR (f_pdf='YES' AND f.has_pdf) OR (f_pdf='NO' AND NOT f.has_pdf))
      AND (f_age IS NULL OR
           (f_age='0_7' AND f.age_days BETWEEN 0 AND 7) OR
           (f_age='8_30' AND f.age_days BETWEEN 8 AND 30) OR
           (f_age='31_90' AND f.age_days BETWEEN 31 AND 90) OR
           (f_age='90_PLUS' AND f.age_days > 90))
      AND (f_attention IS NULL OR
           (f_attention='DRAFT_AGEING' AND f.draft_ageing) OR
           (f_attention='ACK_OVERDUE' AND f.ack_overdue) OR
           (f_attention='MISSING_PDF' AND f.missing_pdf) OR
           (f_attention='AWAITING_ACK' AND f.lifecycle_stage='AWAITING_ACK') OR
           (f_attention='ANY' AND (f.draft_ageing OR f.ack_overdue OR f.missing_pdf)))
  ), ranked AS (
    SELECT x.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='attention' AND v_dir='desc' THEN
          (CASE WHEN x.draft_ageing OR x.ack_overdue OR x.missing_pdf THEN 0 ELSE 1 END) END ASC,
        CASE WHEN v_sort='report_number' AND v_dir='asc' THEN x.report_number END ASC,
        CASE WHEN v_sort='report_number' AND v_dir='desc' THEN x.report_number END DESC,
        CASE WHEN v_sort='employer' AND v_dir='asc' THEN lower(x.employer_name) END ASC,
        CASE WHEN v_sort='employer' AND v_dir='desc' THEN lower(x.employer_name) END DESC,
        CASE WHEN v_sort='inspector' AND v_dir='asc' THEN lower(COALESCE(x.inspector_name,x.inspector_id,'')) END ASC,
        CASE WHEN v_sort='inspector' AND v_dir='desc' THEN lower(COALESCE(x.inspector_name,x.inspector_id,'')) END DESC,
        CASE WHEN v_sort='status' AND v_dir='asc' THEN x.status END ASC,
        CASE WHEN v_sort='status' AND v_dir='desc' THEN x.status END DESC,
        CASE WHEN v_sort='acknowledgment' AND v_dir='asc' THEN x.acknowledgment_status END ASC,
        CASE WHEN v_sort='acknowledgment' AND v_dir='desc' THEN x.acknowledgment_status END DESC,
        CASE WHEN v_sort='findings' AND v_dir='asc' THEN x.total_findings END ASC,
        CASE WHEN v_sort='findings' AND v_dir='desc' THEN x.total_findings END DESC,
        CASE WHEN v_sort='violations' AND v_dir='asc' THEN x.total_violations END ASC,
        CASE WHEN v_sort='violations' AND v_dir='desc' THEN x.total_violations END DESC,
        CASE WHEN v_sort='age' AND v_dir='asc' THEN x.age_days END ASC,
        CASE WHEN v_sort='age' AND v_dir='desc' THEN x.age_days END DESC,
        CASE WHEN v_sort IN ('report_date','attention') AND v_dir='asc' THEN x.report_date END ASC,
        CASE WHEN v_sort IN ('report_date','attention') AND v_dir='desc' THEN x.report_date END DESC,
        x.created_at DESC
    ) AS rn
    FROM filtered x
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'actor_code', v_code,
    'page', v_page,
    'page_size', v_size,
    'sort', v_sort,
    'dir', v_dir,
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(k) - 'rn' ORDER BY k.rn)
      FROM ranked k
      WHERE k.rn > (v_page-1)*v_size AND k.rn <= v_page*v_size
    ), '[]'::jsonb),
    'kpis_all', (
      SELECT jsonb_build_object(
        'total', count(*),
        'draft', count(*) FILTER (WHERE status='DRAFT'),
        'final', count(*) FILTER (WHERE status<>'DRAFT'),
        'awaiting_ack', count(*) FILTER (WHERE lifecycle_stage='AWAITING_ACK'),
        'acknowledged', count(*) FILTER (WHERE lifecycle_stage='ACKNOWLEDGED'),
        'attention', count(*) FILTER (WHERE draft_ageing OR ack_overdue OR missing_pdf),
        'findings', COALESCE(sum(total_findings),0),
        'violations', COALESCE(sum(total_violations),0)
      ) FROM flagged
    ),
    'kpis_filtered', (
      SELECT jsonb_build_object(
        'total', count(*),
        'draft', count(*) FILTER (WHERE status='DRAFT'),
        'final', count(*) FILTER (WHERE status<>'DRAFT'),
        'awaiting_ack', count(*) FILTER (WHERE lifecycle_stage='AWAITING_ACK'),
        'acknowledged', count(*) FILTER (WHERE lifecycle_stage='ACKNOWLEDGED'),
        'attention', count(*) FILTER (WHERE draft_ageing OR ack_overdue OR missing_pdf),
        'findings', COALESCE(sum(total_findings),0),
        'violations', COALESCE(sum(total_violations),0)
      ) FROM filtered
    ),
    'options', jsonb_build_object(
      'statuses', COALESCE((SELECT jsonb_agg(DISTINCT status) FROM flagged),'[]'::jsonb),
      'acknowledgments', COALESCE((SELECT jsonb_agg(DISTINCT acknowledgment_status) FROM flagged),'[]'::jsonb),
      'territories', COALESCE((SELECT jsonb_agg(DISTINCT territory) FROM flagged),'[]'::jsonb),
      'inspectors', COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object('id', inspector_id, 'name', COALESCE(inspector_name, inspector_id)))
        FROM flagged WHERE inspector_id IS NOT NULL),'[]'::jsonb),
      'employers', COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object('id', employer_id, 'name', employer_name))
        FROM flagged WHERE employer_id IS NOT NULL),'[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_audit_report_register_v1(jsonb, text, text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_audit_report_register_v1(jsonb, text, text, integer, integer, boolean) TO authenticated;

UPDATE public.app_modules
SET display_name = 'Audit Reports',
    description = 'Register of employer field audit reports across draft, final and acknowledgement stages'
WHERE route = '/compliance/field/all-reports';