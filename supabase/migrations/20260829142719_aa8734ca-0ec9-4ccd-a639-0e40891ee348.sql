CREATE OR REPLACE FUNCTION public.ce_review_flag_convert_to_violation_v1(p_flag_id uuid, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_flag public.ce_compliance_review_flags;
  v_violation_id uuid;
  v_number text;
  v_period text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-401: authentication required' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_flag FROM public.ce_compliance_review_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-404: review flag not found' USING ERRCODE='22023';
  END IF;

  IF NOT public.ce_actor_can(v_uid, v_flag.required_review_capability) THEN
    RAISE EXCEPTION 'CE-FLAG-403: % is required to convert this flag', v_flag.required_review_capability
      USING ERRCODE='42501';
  END IF;

  IF v_flag.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'CE-FLAG-409: only a CONFIRMED flag can be converted to a violation (flag is %)',
      v_flag.status USING ERRCODE='22023';
  END IF;

  IF v_flag.converted_violation_id IS NOT NULL THEN
    RAISE EXCEPTION 'CE-FLAG-409: flag % is already converted to violation %',
      v_flag.flag_number, v_flag.converted_violation_id USING ERRCODE='22023';
  END IF;

  IF v_flag.subject_type <> 'EMPLOYER' OR COALESCE(v_flag.employer_id, '') = '' THEN
    RAISE EXCEPTION 'CE-FLAG-422: only employer-subject flags with an employer reference can be converted; % flags must be actioned through their own workflow',
      v_flag.subject_type USING ERRCODE='22023';
  END IF;

  IF COALESCE(trim(p_notes),'') = '' THEN
    RAISE EXCEPTION 'CE-FLAG-422: a conversion justification is required' USING ERRCODE='22023';
  END IF;

  -- Normalise the flag period key to the violation period format (YYYY-MM).
  -- Flags may carry 'ALL' (no period) or a full date such as '2026-03-01'.
  v_period := CASE
    WHEN v_flag.period_key IS NULL OR upper(trim(v_flag.period_key)) IN ('', 'ALL') THEN NULL
    WHEN v_flag.period_key ~ '^\d{4}-\d{2}' THEN substr(v_flag.period_key, 1, 7)
    ELSE NULL
  END;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  v_number := 'VIO-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(md5(v_flag.dedupe_key || clock_timestamp()::text),1,6));

  INSERT INTO public.ce_violations(
    violation_number, employer_id, employer_name, territory, status, priority, severity,
    summary, description, source_type, source_rule_id, period_from,
    discovered_date, discovered_by, created_by, linkage_metadata
  ) VALUES (
    v_number, v_flag.employer_id, v_flag.subject_name, 'St Kitts', 'OPEN',
    CASE upper(v_flag.severity) WHEN 'CRITICAL' THEN 'High' WHEN 'HIGH' THEN 'High'
         WHEN 'LOW' THEN 'Low' ELSE 'Medium' END,
    initcap(v_flag.severity),
    v_flag.summary,
    'Raised from review flag ' || v_flag.flag_number || ' (' || v_flag.flag_type || '). ' || p_notes,
    'REVIEW_FLAG_CONVERSION', v_flag.rule_id, v_period,
    CURRENT_DATE, v_actor, v_actor,
    jsonb_build_object(
      'origin','REVIEW_FLAG',
      'review_flag_id', v_flag.id,
      'review_flag_number', v_flag.flag_number,
      'flag_type', v_flag.flag_type,
      'rule_code', v_flag.rule_code,
      'dedupe_key', v_flag.dedupe_key,
      'flag_period_key', v_flag.period_key,
      'evidence', v_flag.evidence
    )
  )
  RETURNING id INTO v_violation_id;

  UPDATE public.ce_compliance_review_flags
     SET converted_violation_id = v_violation_id,
         updated_at = now()
   WHERE id = p_flag_id;

  INSERT INTO public.ce_review_flag_events(flag_id,event_type,from_status,to_status,notes,actor,actor_user_id,payload)
  VALUES (p_flag_id,'CONVERTED_TO_VIOLATION',v_flag.status,v_flag.status,p_notes,v_actor,v_uid,
          jsonb_build_object('violation_id',v_violation_id,'violation_number',v_number));

  PERFORM public.ce_b2_audit('ce.review_flag.convert_to_violation','ce_compliance_review_flags',p_flag_id::text,
    jsonb_build_object('violation_id',v_violation_id,'violation_number',v_number,
                       'rule_code',v_flag.rule_code,'dedupe_key',v_flag.dedupe_key));

  RETURN v_violation_id;
END $function$;