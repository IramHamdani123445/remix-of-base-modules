CREATE OR REPLACE FUNCTION public.ce_inspection_detail_v1(p_inspection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_access text := public.ce_field_ops_scope(auth.uid());
  v_summary jsonb;
BEGIN
  IF v_access = 'NONE' THEN
    RAISE EXCEPTION 'Not authorised to view inspections' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'id', i.id,
           'inspection_number', i.inspection_number,
           'lifecycle_status', public.ce_inspection_lifecycle(i.status),
           'raw_status', i.status,
           'inspection_type', i.inspection_type,
           'scheduled_date', i.scheduled_date,
           'visit_date', i.visit_date,
           'check_in_time', i.check_in_time,
           'check_out_time', i.check_out_time,
           'location_address', i.location_address,
           'territory', coalesce(NULLIF(i.territory,''), rp.territory),
           'notes', i.notes,
           'created_at', i.created_at,
           'updated_at', i.updated_at,
           'employer_id', i.employer_id,
           'employer_name', i.employer_name,
           'inspector_id', i.inspector_id,
           'inspector_name', coalesce(NULLIF(i.inspector_name,''), pr.full_name, i.inspector_id),
           'risk_band', rp.risk_band,
           'risk_score', rp.total_score,
           'case_id', i.case_id,
           'case_number', c.case_number,
           'plan_number', wp.plan_number
         )
    INTO v_summary
    FROM public.ce_inspections i
    LEFT JOIN public.profiles pr
      ON lower(coalesce(pr.user_code,'~')) = lower(coalesce(i.inspector_id,'-'))
      OR lower(coalesce(pr.employee_code,'~')) = lower(coalesce(i.inspector_id,'-'))
    LEFT JOIN public.ce_risk_profiles rp ON rp.employer_id = i.employer_id
    LEFT JOIN public.ce_cases c ON c.id = i.case_id
    LEFT JOIN public.ce_weekly_plan_items pi ON pi.id = i.plan_item_id
    LEFT JOIN public.ce_weekly_plans wp ON wp.id = pi.plan_id
   WHERE i.id = p_inspection_id;

  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'Inspection not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'inspection', (SELECT to_jsonb(i) FROM public.ce_inspections i WHERE i.id = p_inspection_id),
    'findings', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'title', f.title, 'finding_type', f.finding_type, 'severity', f.severity,
        'disposition', coalesce(f.disposition,'PENDING'), 'violation_created', f.violation_created,
        'created_at', f.created_at) ORDER BY f.created_at DESC)
      FROM public.ce_inspection_findings f WHERE f.inspection_id = p_inspection_id), '[]'::jsonb),
    'evidence', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'file_name', e.file_name, 'evidence_type', e.evidence_type,
        'description', e.description, 'captured_at', e.captured_at, 'captured_by', e.captured_by)
        ORDER BY e.created_at DESC)
      FROM public.ce_inspection_evidence e WHERE e.inspection_id = p_inspection_id), '[]'::jsonb),
    'report', (SELECT jsonb_build_object('id', ar.id, 'report_number', ar.report_number,
        'status', ar.status, 'report_date', ar.report_date, 'total_findings', ar.total_findings)
      FROM public.ce_employer_audit_reports ar WHERE ar.inspection_id = p_inspection_id
      ORDER BY ar.created_at DESC LIMIT 1)
  );
END;
$function$;