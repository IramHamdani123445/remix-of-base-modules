CREATE OR REPLACE FUNCTION public.ce_recommend_legal_v1(p_employer_id text, p_reason text, p_case_id uuid DEFAULT NULL::uuid, p_entry_path text DEFAULT 'RECOMMEND_LEGAL'::text, p_early_rule_code text DEFAULT NULL::text, p_violation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_fin jsonb;
  v_elig jsonb := NULL;
  v_arrears jsonb;
  v_type text := 'ORDINARY';
  v_id uuid;
  v_name text;
  v_zone text;
  v_band text;
  v_score numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-LGL-401: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.legal.recommend')
          OR public.ce_actor_can(v_uid,'compliance.cases.manage')) THEN
    RAISE EXCEPTION 'CE-LGL-403: compliance.legal.recommend required' USING ERRCODE='42501';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-LGL-422: a recommendation reason is required' USING ERRCODE='22023';
  END IF;
  IF p_entry_path = 'QUICK_FORWARD' THEN
    IF NOT public.ce_feature_flag_enabled('compliance.legal.quick_forward') THEN
      RAISE EXCEPTION 'CE-LGL-503: expedited Quick Forward is disabled by configuration' USING ERRCODE='22023';
    END IF;
    IF NOT public.ce_actor_can(v_uid,'compliance.legal.override') THEN
      RAISE EXCEPTION 'CE-LGL-403: compliance.legal.override required for Quick Forward' USING ERRCODE='42501';
    END IF;
  END IF;

  v_actor := public.ce_actor_user_code(v_uid);
  v_fin := public.ce_canonical_financial_snapshot(p_employer_id);
  v_arrears := public.ce_evaluate_arrears_threshold_v1(p_employer_id, false);

  IF p_violation_id IS NOT NULL THEN
    v_elig := public.ce_evaluate_stage_eligibility_v1(p_violation_id, 'LEGAL_ELIGIBLE');
    SELECT NULLIF(btrim(employer_name),'') INTO v_name
      FROM public.ce_violations WHERE id = p_violation_id;
  END IF;

  IF v_name IS NULL THEN
    SELECT NULLIF(btrim(v.employer_name),'') INTO v_name
      FROM public.ce_violations v
     WHERE v.employer_id = p_employer_id AND NULLIF(btrim(v.employer_name),'') IS NOT NULL
     ORDER BY v.created_at DESC LIMIT 1;
  END IF;

  IF v_name IS NULL THEN
    BEGIN
      SELECT NULLIF(btrim(er_name),'') INTO v_name
        FROM public.au_er_master WHERE er_regno::text = p_employer_id LIMIT 1;
    EXCEPTION WHEN others THEN v_name := NULL;
    END;
  END IF;

  v_name := COALESCE(v_name, p_employer_id);

  BEGIN
    SELECT risk_band, risk_score INTO v_band, v_score
      FROM public.ce_employer_risk_scores
     WHERE employer_id = p_employer_id
     ORDER BY calculated_at DESC LIMIT 1;
  EXCEPTION WHEN others THEN v_band := NULL; v_score := NULL;
  END;

  IF p_early_rule_code IS NOT NULL OR p_entry_path = 'QUICK_FORWARD' THEN
    v_type := CASE WHEN p_entry_path='QUICK_FORWARD' THEN 'EXPEDITED' ELSE 'EARLY_SERIOUS' END;
    IF COALESCE(btrim(p_early_rule_code),'') = '' AND p_entry_path <> 'QUICK_FORWARD' THEN
      RAISE EXCEPTION 'CE-LGL-422: early recommendation requires a justifying rule code' USING ERRCODE='22023';
    END IF;
  END IF;

  INSERT INTO public.ce_legal_recommendations
    (employer_id, employer_name, employer_zone, risk_band, risk_score,
     status, recommendation_type, early_rule_code, recommendation_reason,
     recommended_by, recommended_at, eligibility_snapshot, financial_snapshot, policy_snapshot,
     source_case_id, entry_path, total_principal, total_penalties, total_interest, grand_total,
     recommended_date, created_by)
  VALUES
    (p_employer_id, v_name, v_zone, v_band, v_score,
     'PENDING_APPROVAL', v_type, p_early_rule_code, p_reason,
     v_actor, now(), v_elig, v_fin, v_arrears, p_case_id, p_entry_path,
     COALESCE((v_fin->>'principal_outstanding')::numeric,0),
     COALESCE((v_fin->>'penalties_outstanding')::numeric,0),
     COALESCE((v_fin->>'interest_outstanding')::numeric,0),
     COALESCE((v_fin->>'total_collectible')::numeric,0),
     CURRENT_DATE, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.system_audit_trail (module, action, entity_type, entity_id, severity, user_name, payload_json)
  VALUES ('COMPLIANCE_TO_LEGAL','LEGAL_RECOMMENDATION_SUBMITTED','ce_legal_recommendation', v_id::text,
          'info', v_actor, jsonb_build_object('entry_path',p_entry_path,'type',v_type,
          'reason',p_reason,'eligibility',v_elig,'financials',v_fin,'arrears',v_arrears,
          'violation_id',p_violation_id));

  RETURN jsonb_build_object('status','pending_approval','recommendation_id',v_id,
    'recommendation_type',v_type,'entry_path',p_entry_path,
    'eligibility',v_elig,'financial_snapshot',v_fin,'arrears_evaluation',v_arrears);
END;
$function$;