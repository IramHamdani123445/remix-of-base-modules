CREATE OR REPLACE FUNCTION public.ce_legal_candidate_preview_v1(
  p_case_id uuid,
  p_audit    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ce_v_legal_referral_candidate%ROWTYPE;
  v_eval jsonb;
  v_can_recommend boolean;
  v_can_approve boolean;
  v_can_override boolean;
  v_quick boolean;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;

  IF NOT (public.ce_actor_can(v_uid,'compliance.enforcement.legal')
       OR public.ce_actor_can(v_uid,'compliance.legal.recommend')
       OR public.ce_actor_can(v_uid,'compliance.cases.manage')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  SELECT * INTO v_row FROM public.ce_v_legal_referral_candidate WHERE case_id = p_case_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','CASE_NOT_FOUND');
  END IF;

  v_eval := public.ce_legal_candidate_evaluate(v_row);

  v_can_recommend := public.ce_actor_can(v_uid,'compliance.legal.recommend')
                  OR public.ce_actor_can(v_uid,'compliance.cases.manage');
  v_can_approve   := public.ce_actor_can(v_uid,'compliance.legal.recommend_approve');
  v_can_override  := public.ce_actor_can(v_uid,'compliance.legal.override');
  v_quick         := v_can_override AND public.ce_feature_flag_enabled('compliance.legal.quick_forward');

  v_out := jsonb_build_object(
    'case', jsonb_build_object(
      'case_id', v_row.case_id,
      'case_number', v_row.case_number,
      'employer_reg_no', v_row.employer_reg_no,
      'employer_name', v_row.employer_name,
      'zone', v_row.zone,
      'assigned_officer_name', v_row.assigned_officer_name,
      'case_age_days', v_row.case_age_days,
      'case_status', public.ce_legal_candidate_label('CASE_STATUS', v_row.case_status_code),
      'case_stage', public.ce_legal_candidate_label('CASE_STAGE', v_eval->>'stage_code'),
      'open_violations', v_row.open_violations,
      'total_violations', v_row.total_violations,
      'principal_violation_id', v_row.principal_violation_id,
      'principal_violation_number', v_row.principal_violation_number,
      'notices_sent', v_row.notices_sent,
      'final_notice_at', v_row.final_notice_at,
      'days_since_final_notice', v_row.days_since_final_notice,
      'arrangement_id', v_row.arrangement_id,
      'arrangement_number', v_row.arrangement_number,
      'arrangement_status', v_row.arrangement_status,
      'arrangement_breach', v_row.arrangement_breach,
      'arrangement_active', v_row.arrangement_active
    ),
    'exposure', jsonb_build_object(
      'principal', v_row.total_principal,
      'penalty',   v_row.total_penalties,
      'interest',  v_row.total_interest,
      'collected', v_row.amount_collected,
      'waived',    v_row.amount_waived,
      'total',     v_row.outstanding_amount
    ),
    'rule', jsonb_build_object(
      'code', v_row.rule_code, 'name', v_row.rule_name, 'mode', v_row.rule_mode,
      'required_notices', v_row.rule_required_notices,
      'days_after_final_notice', v_row.rule_days_after_final,
      'min_outstanding', v_row.rule_min_outstanding,
      'require_breach', v_row.rule_require_breach,
      'require_repeat_default', v_row.rule_require_repeat,
      'employer_response_window_days', v_row.rule_response_window
    ),
    'eligibility', public.ce_legal_candidate_label('ELIGIBILITY', v_eval->>'eligibility_code'),
    'referral_state', public.ce_legal_candidate_label('REFERRAL_STATE', v_eval->>'referral_state_code'),
    'action', public.ce_legal_candidate_label('ACTION', v_eval->>'action_code'),
    'blocks', (SELECT COALESCE(jsonb_agg(public.ce_legal_candidate_label('BLOCK_REASON', b->>'code')
                 || jsonb_build_object('detail', b->>'detail')), '[]'::jsonb)
                 FROM jsonb_array_elements(v_eval->'blocks') b),
    'reasons', (SELECT COALESCE(jsonb_agg(public.ce_legal_candidate_label('ELIG_REASON', r->>'code')
                 || jsonb_build_object('detail', r->>'detail')), '[]'::jsonb)
                 FROM jsonb_array_elements(v_eval->'reasons') r),
    'existing', jsonb_build_object(
      'recommendation_id', v_row.recommendation_id,
      'recommendation_status', v_row.recommendation_status,
      'recommended_at', v_row.recommended_at,
      'referral_id', v_row.referral_id,
      'referral_number', v_row.referral_number,
      'referral_status', v_row.referral_status,
      'lg_intake_no', COALESCE(v_row.lg_intake_no, v_row.case_lg_intake_no),
      'lg_case_no', COALESCE(v_row.lg_case_no, v_row.case_lg_case_no),
      'court_case_number', v_row.court_case_number,
      'open_returns', v_row.open_returns,
      'return_count', v_row.return_count,
      'return_reason', v_row.return_reason
    ),
    'route', jsonb_build_object(
      'action_code', v_eval->>'action_code',
      'can_initiate', ((v_eval->>'can_initiate')::boolean AND v_can_recommend),
      'has_active_referral', (v_eval->>'has_active_referral')::boolean,
      'requires_recommendation', ((v_eval->>'can_initiate')::boolean),
      'maker_checker', true,
      'self_approval_blocked', (v_row.recommended_by = v_uid::text)
    ),
    'escalation_reason_code', COALESCE(
      (SELECT r->>'code' FROM jsonb_array_elements(v_eval->'reasons') r LIMIT 1), 'UNRESOLVED_VIOLATION'),
    'referral_source', CASE
      WHEN v_row.arrangement_breach THEN 'PAYMENT_ARRANGEMENT_BREACH'
      WHEN v_row.final_notice_at IS NOT NULL THEN 'ENFORCEMENT_NOTICE'
      WHEN v_row.open_violations > 0 THEN 'VIOLATION'
      ELSE 'COMPLIANCE_CASE' END,
    'capabilities', jsonb_build_object(
      'can_recommend', v_can_recommend,
      'can_approve', v_can_approve,
      'can_quick_forward', v_quick),
    'evaluated_at', now()
  );

  IF p_audit THEN
    INSERT INTO public.ce_audit_log (entity_type, entity_id, action, description, new_values, performed_by, performed_at)
    VALUES ('CE_CASE', p_case_id, 'LEGAL_ELIGIBILITY_EVALUATED',
            'Case evaluated for legal escalation from the Legal Referral Launcher',
            jsonb_build_object(
              'eligibility', v_eval->>'eligibility_code',
              'action', v_eval->>'action_code',
              'rule_code', v_row.rule_code,
              'outstanding', v_row.outstanding_amount,
              'referral_id', v_row.referral_id,
              'recommendation_id', v_row.recommendation_id),
            v_uid::text, now());
  END IF;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_legal_candidate_preview_v1(uuid, boolean) TO authenticated, service_role;