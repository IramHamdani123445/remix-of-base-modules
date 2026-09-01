-- 1. Assignment fields
ALTER TABLE public.ce_compliance_review_flags
  ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid,
  ADD COLUMN IF NOT EXISTS assigned_to_name text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- 2. Disposition vocabulary normaliser (accepts UI verbs and canonical states)
CREATE OR REPLACE FUNCTION public.ce_review_flag_normalise_disposition(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE upper(coalesce(trim(p_raw), ''))
    WHEN 'CONFIRM'      THEN 'CONFIRMED'
    WHEN 'CONFIRMED'    THEN 'CONFIRMED'
    WHEN 'DISMISS'      THEN 'DISMISSED'
    WHEN 'DISMISSED'    THEN 'DISMISSED'
    WHEN 'FALSE_POSITIVE' THEN 'DISMISSED'
    WHEN 'RESOLVE'      THEN 'RESOLVED'
    WHEN 'RESOLVED'     THEN 'RESOLVED'
    WHEN 'SUPPRESS'     THEN 'SUPPRESSED'
    WHEN 'SUPPRESSED'   THEN 'SUPPRESSED'
    WHEN 'INVESTIGATE'  THEN 'UNDER_REVIEW'
    WHEN 'UNDER_REVIEW' THEN 'UNDER_REVIEW'
    WHEN 'ANNOTATE'     THEN 'ANNOTATE'
    WHEN 'NOTE'         THEN 'ANNOTATE'
    ELSE NULL
  END
$$;

-- 3. Rewritten disposition command
CREATE OR REPLACE FUNCTION public.ce_review_flag_disposition_v1(
  p_flag_id uuid,
  p_disposition text,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_flag public.ce_compliance_review_flags;
  v_disp text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-401: authentication required' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_flag FROM public.ce_compliance_review_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-404: review flag not found' USING ERRCODE='22023';
  END IF;

  IF NOT public.ce_actor_can(v_uid, v_flag.required_review_capability) THEN
    RAISE EXCEPTION 'CE-FLAG-403: % is required to review this flag', v_flag.required_review_capability
      USING ERRCODE='42501';
  END IF;

  v_disp := public.ce_review_flag_normalise_disposition(p_disposition);
  IF v_disp IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-422: invalid disposition %', p_disposition USING ERRCODE='22023';
  END IF;

  -- No re-opening a closed flag by disposition; use a fresh detection run.
  IF v_flag.status IN ('CONFIRMED','DISMISSED','RESOLVED')
     AND v_disp NOT IN ('ANNOTATE') THEN
    RAISE EXCEPTION 'CE-FLAG-409: flag % is already %, further disposition is not permitted',
      v_flag.flag_number, v_flag.status USING ERRCODE='22023';
  END IF;

  IF v_disp NOT IN ('UNDER_REVIEW') AND COALESCE(trim(p_notes),'') = '' THEN
    RAISE EXCEPTION 'CE-FLAG-422: a review note is required' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);

  IF v_disp = 'ANNOTATE' THEN
    -- Annotation never changes state.
    INSERT INTO public.ce_review_flag_events(flag_id,event_type,from_status,to_status,notes,actor,actor_user_id)
    VALUES (p_flag_id,'NOTE',v_flag.status,v_flag.status,p_notes,v_actor,v_uid);

    PERFORM public.ce_b2_audit('ce.review_flag.note','ce_compliance_review_flags',p_flag_id::text,
      jsonb_build_object('flag_type',v_flag.flag_type,'subject',v_flag.subject_id));
    RETURN p_flag_id;
  END IF;

  UPDATE public.ce_compliance_review_flags
     SET status = v_disp,
         disposition = CASE WHEN v_disp='UNDER_REVIEW' THEN disposition ELSE v_disp END,
         disposition_notes = COALESCE(p_notes, disposition_notes),
         reviewed_by = v_actor,
         reviewed_at = now(),
         excluded_from_risk = (v_disp IN ('DISMISSED','SUPPRESSED')),
         updated_at = now()
   WHERE id = p_flag_id;

  INSERT INTO public.ce_review_flag_events(flag_id,event_type,from_status,to_status,notes,actor,actor_user_id)
  VALUES (p_flag_id,'DISPOSITION',v_flag.status,v_disp,p_notes,v_actor,v_uid);

  PERFORM public.ce_b2_audit('ce.review_flag.disposition','ce_compliance_review_flags',p_flag_id::text,
    jsonb_build_object('disposition',v_disp,'flag_type',v_flag.flag_type,'subject',v_flag.subject_id));

  RETURN p_flag_id;
END $function$;

-- 4. Assignment command
CREATE OR REPLACE FUNCTION public.ce_review_flag_assign_v1(
  p_flag_id uuid,
  p_assignee_user_id uuid,
  p_assignee_name text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_flag public.ce_compliance_review_flags;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-401: authentication required' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_flag FROM public.ce_compliance_review_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-404: review flag not found' USING ERRCODE='22023';
  END IF;

  IF NOT public.ce_actor_can(v_uid, v_flag.required_review_capability) THEN
    RAISE EXCEPTION 'CE-FLAG-403: % is required to assign this flag', v_flag.required_review_capability
      USING ERRCODE='42501';
  END IF;

  IF v_flag.status IN ('CONFIRMED','DISMISSED','RESOLVED') THEN
    RAISE EXCEPTION 'CE-FLAG-409: flag % is closed (%) and cannot be reassigned',
      v_flag.flag_number, v_flag.status USING ERRCODE='22023';
  END IF;

  IF p_assignee_user_id IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-422: an assignee is required' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);

  UPDATE public.ce_compliance_review_flags
     SET assigned_to_user_id = p_assignee_user_id,
         assigned_to_name = COALESCE(p_assignee_name, public.ce_actor_user_code(p_assignee_user_id)),
         assigned_at = now(),
         updated_at = now()
   WHERE id = p_flag_id;

  INSERT INTO public.ce_review_flag_events(flag_id,event_type,from_status,to_status,notes,actor,actor_user_id,payload)
  VALUES (p_flag_id,'ASSIGNMENT',v_flag.status,v_flag.status,p_notes,v_actor,v_uid,
          jsonb_build_object('assigned_to_user_id',p_assignee_user_id,
                             'previous_assignee',v_flag.assigned_to_user_id));

  PERFORM public.ce_b2_audit('ce.review_flag.assign','ce_compliance_review_flags',p_flag_id::text,
    jsonb_build_object('assigned_to',p_assignee_user_id,'previous',v_flag.assigned_to_user_id,
                       'flag_type',v_flag.flag_type));

  RETURN p_flag_id;
END $function$;

-- 5. Convert a confirmed flag into a real violation
CREATE OR REPLACE FUNCTION public.ce_review_flag_convert_to_violation_v1(
  p_flag_id uuid,
  p_notes text
)
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
    'REVIEW_FLAG_CONVERSION', v_flag.rule_id, v_flag.period_key,
    CURRENT_DATE, v_actor, v_actor,
    jsonb_build_object(
      'origin','REVIEW_FLAG',
      'review_flag_id', v_flag.id,
      'review_flag_number', v_flag.flag_number,
      'flag_type', v_flag.flag_type,
      'rule_code', v_flag.rule_code,
      'dedupe_key', v_flag.dedupe_key,
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

GRANT EXECUTE ON FUNCTION public.ce_review_flag_normalise_disposition(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_review_flag_disposition_v1(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_review_flag_assign_v1(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_review_flag_convert_to_violation_v1(uuid, text) TO authenticated;