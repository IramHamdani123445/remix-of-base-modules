CREATE OR REPLACE FUNCTION public.ce_legal_candidate_setting(_key text, _default numeric)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.ce_setting_num(_key, _default); $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_candidate_setting(text, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ce_legal_candidate_evaluate(_row public.ce_v_legal_referral_candidate)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_blocks   jsonb := '[]'::jsonb;
  v_reasons  jsonb := '[]'::jsonb;
  v_state    text;
  v_action   text;
  v_stage    text;
  v_refstate text;
  v_rule_ok  boolean;
BEGIN
  v_stage := CASE
    WHEN _row.case_status_code IN ('CLOSED','COMPLETED') THEN 'CLOSED'
    WHEN _row.referral_id IS NOT NULL OR _row.case_status_code = 'ESCALATED_LEGAL' THEN 'LEGAL_ESCALATION'
    WHEN _row.arrangement_breach THEN 'ARRANGEMENT_DEFAULT'
    WHEN _row.arrangement_active THEN 'ARRANGEMENT_ACTIVE'
    WHEN _row.final_notice_at IS NOT NULL THEN 'FINAL_ENFORCEMENT'
    WHEN _row.last_notice_stage = 'DEMAND' OR _row.last_notice_type = 'DEMAND' THEN 'DEMAND_ISSUED'
    WHEN _row.notices_sent > 0 THEN 'WARNING_ISSUED'
    WHEN _row.case_status_code = 'INVESTIGATION' THEN 'INVESTIGATION'
    ELSE 'INTAKE' END;

  v_refstate := CASE
    WHEN _row.referral_status = 'RETURNED_BY_LEGAL' THEN 'RETURNED'
    WHEN _row.referral_status = 'IN_LEGAL_PROCEEDINGS' THEN 'IN_PROCEEDINGS'
    WHEN _row.referral_status = 'ACCEPTED_BY_LEGAL' THEN 'ACCEPTED_BY_LEGAL'
    WHEN _row.referral_status = 'SUBMITTED_TO_LEGAL' THEN 'SUBMITTED_TO_LEGAL'
    WHEN _row.referral_status = 'APPROVED_FOR_SUBMISSION' THEN 'APPROVED_FOR_SUBMISSION'
    WHEN _row.referral_status = 'PENDING_APPROVAL' THEN 'PENDING_REFERRAL_APPROVAL'
    WHEN _row.referral_status = 'DRAFT' THEN 'PACK_IN_PREPARATION'
    WHEN _row.referral_status = 'REJECTED' THEN 'REJECTED'
    WHEN _row.referral_status = 'CLOSED' THEN 'CLOSED'
    WHEN _row.recommendation_status = 'APPROVED_FOR_REFERRAL' THEN 'RECOMMENDATION_APPROVED'
    WHEN _row.recommendation_status = 'PENDING_REVIEW' THEN 'RECOMMENDATION_PENDING'
    WHEN _row.recommendation_status = 'REJECTED' THEN 'RECOMMENDATION_REJECTED'
    ELSE 'NONE' END;

  IF _row.rule_json IS NULL THEN
    v_blocks := v_blocks || jsonb_build_object('code','NO_RULE','detail', NULL);
  ELSIF _row.rule_mode = 'DISABLED' THEN
    v_blocks := v_blocks || jsonb_build_object('code','RULE_DISABLED','detail', _row.rule_code);
  ELSE
    IF _row.notices_sent < _row.rule_required_notices THEN
      v_blocks := v_blocks || jsonb_build_object('code','NOTICES_INCOMPLETE',
        'detail', _row.notices_sent || ' of ' || _row.rule_required_notices || ' required notices issued');
    END IF;
    IF _row.rule_days_after_final > 0
       AND COALESCE(_row.days_since_final_notice, -1) < _row.rule_days_after_final THEN
      v_blocks := v_blocks || jsonb_build_object('code','WAITING_PERIOD',
        'detail', COALESCE(_row.days_since_final_notice, 0) || ' of ' || _row.rule_days_after_final || ' days elapsed since final notice');
    END IF;
    IF _row.outstanding_amount < _row.rule_min_outstanding THEN
      v_blocks := v_blocks || jsonb_build_object('code','BELOW_THRESHOLD',
        'detail', 'Configured minimum ' || _row.rule_min_outstanding::text);
    END IF;
    IF _row.rule_require_breach AND NOT _row.arrangement_breach THEN
      v_blocks := v_blocks || jsonb_build_object('code','BREACH_REQUIRED','detail', _row.rule_code);
    END IF;
    IF _row.rule_require_repeat AND COALESCE(_row.return_count,0) = 0 AND NOT _row.arrangement_breach THEN
      v_blocks := v_blocks || jsonb_build_object('code','BREACH_REQUIRED','detail','Repeat default required');
    END IF;
    IF _row.rule_response_window > 0
       AND (_row.last_employer_response IS NULL
            OR (now()::date - _row.last_employer_response::date) < _row.rule_response_window) THEN
      v_blocks := v_blocks || jsonb_build_object('code','WAITING_PERIOD',
        'detail', 'Employer response window of ' || _row.rule_response_window || ' days not elapsed');
    END IF;
  END IF;

  IF _row.arrangement_active AND NOT _row.arrangement_breach THEN
    v_blocks := v_blocks || jsonb_build_object('code','ARRANGEMENT_ACTIVE','detail', _row.arrangement_number);
  END IF;
  IF COALESCE(_row.open_violations,0) = 0 AND COALESCE(_row.outstanding_amount,0) <= 0 THEN
    v_blocks := v_blocks || jsonb_build_object('code','NO_OPEN_VIOLATION','detail', NULL);
  END IF;

  v_rule_ok := (jsonb_array_length(v_blocks) = 0);

  IF _row.arrangement_breach THEN
    v_reasons := v_reasons || jsonb_build_object('code','ARRANGEMENT_DEFAULT','detail', _row.arrangement_number);
  END IF;
  IF _row.final_notice_at IS NOT NULL THEN
    v_reasons := v_reasons || jsonb_build_object('code','FINAL_ENFORCEMENT_REACHED','detail', _row.last_notice_type);
  END IF;
  IF COALESCE(_row.open_violations,0) > 0 THEN
    v_reasons := v_reasons || jsonb_build_object('code','UNRESOLVED_VIOLATION','detail', _row.principal_violation_number);
  END IF;
  IF _row.rule_json IS NOT NULL AND _row.outstanding_amount >= _row.rule_min_outstanding
     AND _row.rule_min_outstanding > 0 THEN
    v_reasons := v_reasons || jsonb_build_object('code','THRESHOLD_EXCEEDED','detail', _row.rule_code);
  END IF;

  IF _row.case_status_code IN ('CLOSED','COMPLETED') AND _row.referral_id IS NULL THEN
    v_state := 'NOT_ELIGIBLE'; v_action := 'VIEW_CASE';
    v_blocks := jsonb_build_array(jsonb_build_object('code','CASE_CLOSED','detail', _row.case_status_code)) || v_blocks;
  ELSIF _row.referral_status = 'RETURNED_BY_LEGAL' THEN
    v_state := 'RETURNED_FOR_REWORK'; v_action := 'REWORK_REFERRAL';
    v_reasons := v_reasons || jsonb_build_object('code','REFERRAL_IN_FLIGHT','detail', _row.referral_number);
  ELSIF _row.referral_status IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','IN_LEGAL_PROCEEDINGS') THEN
    v_state := 'WITH_LEGAL'; v_action := 'TRACK_LEGAL';
    v_reasons := v_reasons || jsonb_build_object('code','REFERRAL_IN_FLIGHT','detail', _row.referral_number);
  ELSIF _row.referral_status IN ('DRAFT','PENDING_APPROVAL','APPROVED_FOR_SUBMISSION') THEN
    v_state := 'ALREADY_REFERRED';
    v_action := CASE WHEN _row.referral_status = 'DRAFT' THEN 'PREPARE_PACK' ELSE 'OPEN_REFERRAL' END;
    v_blocks := jsonb_build_array(jsonb_build_object('code','ACTIVE_REFERRAL','detail', _row.referral_number)) || v_blocks;
    v_reasons := v_reasons || jsonb_build_object('code','REFERRAL_IN_FLIGHT','detail', _row.referral_number);
  ELSIF _row.recommendation_status = 'APPROVED_FOR_REFERRAL' THEN
    v_state := 'APPROVED_FOR_PACK'; v_action := 'PREPARE_PACK';
    v_reasons := v_reasons || jsonb_build_object('code','RECOMMENDATION_APPROVED','detail', NULL);
  ELSIF _row.recommendation_status = 'PENDING_REVIEW' THEN
    v_state := 'AWAITING_RECOMMENDATION_APPROVAL'; v_action := 'OPEN_RECOMMENDATION';
    v_reasons := v_reasons || jsonb_build_object('code','RECOMMENDATION_PENDING','detail', NULL);
  ELSIF v_rule_ok THEN
    v_state := 'ELIGIBLE'; v_action := 'RECOMMEND_LEGAL';
  ELSIF _row.escalation_recommended OR _row.case_status_code = 'RECOMMENDED_FOR_LEGAL' THEN
    v_state := 'RECOMMENDATION_REQUIRED'; v_action := 'RECOMMEND_LEGAL';
  ELSE
    v_state := 'NOT_ELIGIBLE'; v_action := 'VIEW_CASE';
  END IF;

  RETURN jsonb_build_object(
    'eligibility_code', v_state,
    'action_code',      v_action,
    'stage_code',       v_stage,
    'referral_state_code', v_refstate,
    'rule_satisfied',   v_rule_ok,
    'blocks',           v_blocks,
    'reasons',          v_reasons,
    'can_initiate',     (v_state IN ('ELIGIBLE','RECOMMENDATION_REQUIRED')),
    'has_active_referral', (_row.referral_status IS NOT NULL
                            AND _row.referral_status NOT IN ('REJECTED','CLOSED'))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_legal_candidate_evaluate(public.ce_v_legal_referral_candidate) TO authenticated, service_role;