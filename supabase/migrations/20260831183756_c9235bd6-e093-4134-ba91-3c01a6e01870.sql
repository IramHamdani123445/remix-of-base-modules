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

  SELECT COALESCE(is_enabled, true) INTO v_queue
    FROM public.feature_flags WHERE flag_key = 'compliance.core.verification_queue';
  v_queue := COALESCE(v_queue, true);
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
    v_type.fund_type, v_status,
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