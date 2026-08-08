
CREATE OR REPLACE FUNCTION public._bn_risk_rule_set_validation(p_rule_set uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rs public.bn_risk_scoring_rule_set%ROWTYPE;
  v_b text[] := '{}'; v_w text[] := '{}'; v_n int; v_prev numeric; v_row record;
BEGIN
  SELECT * INTO v_rs FROM public.bn_risk_scoring_rule_set WHERE rule_set_id = p_rule_set;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('blockers', to_jsonb(ARRAY['Rule set not found.']), 'warnings','[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_n FROM public.bn_risk_scoring_rule
   WHERE rule_set_id = p_rule_set AND is_enabled;
  IF v_n = 0 THEN v_b := v_b || 'Add at least one enabled scoring rule.'; END IF;

  SELECT count(*) INTO v_n FROM public.bn_risk_scoring_band WHERE rule_set_id = p_rule_set;
  IF v_n = 0 THEN v_b := v_b || 'Add at least one risk band.'; END IF;

  FOR v_row IN SELECT * FROM public.bn_risk_scoring_rule
                WHERE rule_set_id = p_rule_set ORDER BY sort_order, rule_code LOOP
    IF v_row.factor_type_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.bn_risk_factor_type ft
                        WHERE ft.factor_type_code = v_row.factor_type_code AND ft.is_active) THEN
      v_b := v_b || format('Rule %s refers to a factor type that no longer exists.', v_row.rule_code);
    END IF;
    IF v_row.operator IN ('VALUE_AT_LEAST','VALUE_LESS_THAN','FACTOR_COUNT_AT_LEAST')
       AND v_row.comparison_numeric IS NULL THEN
      v_b := v_b || format('Rule %s needs a comparison value.', v_row.rule_code);
    END IF;
    IF v_row.operator IN ('VALUE_EQUALS_CODE','MATERIALITY_AT_LEAST')
       AND NULLIF(btrim(COALESCE(v_row.comparison_code,'')),'') IS NULL THEN
      v_b := v_b || format('Rule %s needs a comparison option.', v_row.rule_code);
    END IF;
    IF v_row.contribution = 0 THEN
      v_b := v_b || format('Rule %s has no contribution and would never affect the score.', v_row.rule_code);
    END IF;
    IF v_row.max_contribution IS NOT NULL AND v_row.max_contribution < abs(v_row.contribution) THEN
      v_b := v_b || format('Rule %s has a cap smaller than its own contribution.', v_row.rule_code);
    END IF;
  END LOOP;

  v_prev := NULL;
  FOR v_row IN SELECT * FROM public.bn_risk_scoring_band
                WHERE rule_set_id = p_rule_set ORDER BY min_score, sort_order LOOP
    IF v_prev IS NULL THEN
      IF v_row.min_score > v_rs.score_scale_min THEN
        v_b := v_b || 'The lowest band must start at the bottom of the score scale.';
      END IF;
    ELSIF v_row.min_score <= v_prev THEN
      v_b := v_b || format('Band %s overlaps the previous band.', v_row.band_code);
    ELSIF v_row.min_score > v_prev + 0.01 THEN
      v_b := v_b || format('There is a gap in the score scale before band %s.', v_row.band_code);
    END IF;
    v_prev := v_row.max_score;
  END LOOP;
  IF v_prev IS NOT NULL AND v_prev < v_rs.score_scale_max THEN
    v_b := v_b || 'The highest band must reach the top of the score scale.';
  END IF;

  IF v_rs.effective_from IS NOT NULL AND v_rs.effective_to IS NOT NULL
     AND v_rs.effective_to <= v_rs.effective_from THEN
    v_b := v_b || 'The end date must be after the start date.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bn_risk_scoring_rule
                  WHERE rule_set_id = p_rule_set AND is_enabled AND contribution < 0) THEN
    v_w := v_w || 'No mitigating rule is configured, so evidence that reduces concern cannot lower the score.';
  END IF;

  RETURN jsonb_build_object('blockers', to_jsonb(v_b), 'warnings', to_jsonb(v_w));
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_risk_rule_set_json(p_rule_set uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rule_id', r.rule_id, 'rule_code', r.rule_code, 'name', r.name,
      'factor_type_code', r.factor_type_code, 'direction_code', r.direction_code,
      'operator', r.operator, 'comparison_numeric', r.comparison_numeric,
      'comparison_code', r.comparison_code,
      'requires_usable_evidence', r.requires_usable_evidence,
      'contribution', r.contribution, 'max_contribution', r.max_contribution,
      'explanation_template', r.explanation_template,
      'sort_order', r.sort_order, 'is_enabled', r.is_enabled) ORDER BY r.sort_order, r.rule_code),
    '[]'::jsonb)
  FROM public.bn_risk_scoring_rule r WHERE r.rule_set_id = p_rule_set AND r.is_enabled;
$function$;

CREATE OR REPLACE FUNCTION public._bn_risk_band_json(p_rule_set uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'band_code', b.band_code, 'label', b.label, 'min_score', b.min_score,
      'max_score', b.max_score, 'sort_order', b.sort_order,
      'review_priority', b.review_priority) ORDER BY b.sort_order, b.min_score), '[]'::jsonb)
  FROM public.bn_risk_scoring_band b WHERE b.rule_set_id = p_rule_set;
$function$;

CREATE OR REPLACE FUNCTION public.bn_risk_scoring_readiness_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_rs public.bn_risk_scoring_rule_set%ROWTYPE; v_cur public.bn_risk_score%ROWTYPE;
  v_b text[] := '{}'; v_w text[] := '{}'; v_write boolean;
  v_active int; v_unsat int; v_blocking int; v_fp text; v_state text; v_stale boolean := false;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;

  v_write := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false);
  SELECT * INTO v_rs FROM public._bn_risk_active_rule_set();
  SELECT * INTO v_cur FROM public.bn_risk_score
   WHERE assessment_id = p_assessment_id AND status='CURRENT';

  SELECT count(*) INTO v_active FROM public.bn_risk_factor
   WHERE assessment_id = p_assessment_id AND status='ACTIVE';
  SELECT count(*) INTO v_unsat FROM public.bn_risk_factor f
   WHERE f.assessment_id = p_assessment_id AND f.status='ACTIVE'
     AND f.evidence_requirement_code='REQUIRED'
     AND NOT EXISTS (SELECT 1 FROM public.bn_risk_evidence_link e
                      WHERE e.assessment_id=f.assessment_id AND e.factor_id=f.factor_id
                        AND e.status='LINKED' AND e.usability_code='USABLE');
  SELECT count(*) INTO v_blocking FROM public.bn_risk_information_request
   WHERE assessment_id = p_assessment_id AND is_blocking AND status NOT IN ('RESOLVED','CANCELLED');

  IF v_rs.rule_set_id IS NULL THEN
    v_b := v_b || 'Risk scoring configuration is incomplete.';
  END IF;
  IF v_a.status <> 'REVIEW' THEN
    v_b := v_b || 'Scoring is only available while the assessment is in review.';
  END IF;
  IF NOT v_a.information_gathering_complete THEN
    v_b := v_b || 'Information gathering has not been completed.';
  END IF;
  IF v_active = 0 THEN
    v_b := v_b || 'No active factor is recorded for this assessment.';
  END IF;
  IF v_unsat > 0 THEN
    v_b := v_b || format('%s factor(s) still need usable supporting evidence.', v_unsat);
  END IF;
  IF v_blocking > 0 THEN
    v_b := v_b || format('%s information request(s) are still outstanding.', v_blocking);
  END IF;
  IF NOT v_write THEN
    v_b := v_b || 'You do not have permission to run risk scoring.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_risk_evidence_link
              WHERE assessment_id=p_assessment_id AND status='LINKED' AND usability_code='RECEIVED') THEN
    v_w := v_w || 'Some linked evidence has not yet been assessed for usability.';
  END IF;

  IF v_rs.rule_set_id IS NOT NULL THEN
    v_fp := public._bn_risk_score_fingerprint(p_assessment_id, v_rs.rule_set_id);
  END IF;
  IF v_cur.score_id IS NOT NULL THEN
    v_stale := (v_fp IS NULL) OR (v_cur.input_fingerprint IS DISTINCT FROM v_fp);
  END IF;

  v_state := CASE
    WHEN v_rs.rule_set_id IS NULL THEN 'CONFIGURATION_REQUIRED'
    WHEN v_cur.score_id IS NOT NULL AND v_stale THEN 'STALE'
    WHEN v_cur.score_id IS NOT NULL THEN 'SCORED'
    WHEN array_length(v_b,1) IS NULL THEN 'READY_TO_SCORE'
    ELSE 'BLOCKED' END;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'can_score', (array_length(v_b,1) IS NULL),
    'score_state', v_state,
    'has_score', (v_cur.score_id IS NOT NULL),
    'is_stale', v_stale,
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'input_fingerprint', v_fp,
    'active_factor_count', v_active,
    'outstanding_evidence_count', v_unsat,
    'open_blocking_request_count', v_blocking,
    'configuration', CASE WHEN v_rs.rule_set_id IS NULL THEN NULL ELSE jsonb_build_object(
        'rule_set_id', v_rs.rule_set_id, 'rule_set_code', v_rs.rule_set_code,
        'name', v_rs.name, 'version_no', v_rs.version_no, 'status', v_rs.status,
        'score_scale_min', v_rs.score_scale_min, 'score_scale_max', v_rs.score_scale_max,
        'score_scale_label', v_rs.score_scale_label,
        'effective_from', v_rs.effective_from, 'effective_to', v_rs.effective_to,
        'rule_count', (SELECT count(*) FROM public.bn_risk_scoring_rule
                        WHERE rule_set_id=v_rs.rule_set_id AND is_enabled),
        'band_count', (SELECT count(*) FROM public.bn_risk_scoring_band
                        WHERE rule_set_id=v_rs.rule_set_id)) END));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_risk_score_detail_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_cur public.bn_risk_score%ROWTYPE;
  v_rs public.bn_risk_scoring_rule_set%ROWTYPE; v_fp text; v_stale boolean := false;
  v_contribs jsonb; v_history jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;

  SELECT * INTO v_cur FROM public.bn_risk_score
   WHERE assessment_id = p_assessment_id AND status='CURRENT';
  SELECT * INTO v_rs FROM public._bn_risk_active_rule_set();

  IF v_cur.score_id IS NOT NULL THEN
    IF v_rs.rule_set_id IS NULL THEN
      v_stale := true;
    ELSE
      v_fp := public._bn_risk_score_fingerprint(p_assessment_id, v_rs.rule_set_id);
      v_stale := v_cur.input_fingerprint IS DISTINCT FROM v_fp;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'contribution_id', c.contribution_id, 'sequence_no', c.sequence_no,
        'rule_id', c.rule_id, 'rule_code', c.rule_code, 'rule_name', c.rule_name,
        'factor_id', c.factor_id, 'factor_reference', c.factor_reference,
        'factor_type_code', c.factor_type_code, 'factor_type_label', c.factor_type_label,
        'direction_code', c.direction_code, 'direction_label', c.direction_label,
        'operator', c.operator, 'evaluated_input', c.evaluated_input,
        'comparison_display', c.comparison_display, 'outcome', c.outcome,
        'contribution', c.contribution, 'explanation', c.explanation)
      ORDER BY c.sequence_no), '[]'::jsonb)
      INTO v_contribs FROM public.bn_risk_score_contribution c WHERE c.score_id = v_cur.score_id;
  ELSE
    v_contribs := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'score_id', s.score_id, 'version_no', s.version_no, 'score', s.score,
      'band_code', s.band_code, 'band_label', s.band_label,
      'rule_set_code', s.rule_set_code, 'rule_set_version_no', s.rule_set_version_no,
      'calculated_at', s.calculated_at, 'calculated_by_name', s.calculated_by_name,
      'status', s.status, 'recalculation_reason', s.recalculation_reason,
      'input_fingerprint', s.input_fingerprint,
      'supersedes_score_id', s.supersedes_score_id)
    ORDER BY s.version_no DESC), '[]'::jsonb)
    INTO v_history FROM public.bn_risk_score s WHERE s.assessment_id = p_assessment_id;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'scoring_review_completed_at', v_a.scoring_review_completed_at,
    'current_score', CASE WHEN v_cur.score_id IS NULL THEN NULL ELSE jsonb_build_object(
      'score_id', v_cur.score_id, 'version_no', v_cur.version_no, 'score', v_cur.score,
      'score_scale_min', v_cur.score_scale_min, 'score_scale_max', v_cur.score_scale_max,
      'band_code', v_cur.band_code, 'band_label', v_cur.band_label,
      'rule_set_id', v_cur.rule_set_id, 'rule_set_code', v_cur.rule_set_code,
      'rule_set_name', v_cur.rule_set_name, 'rule_set_version_no', v_cur.rule_set_version_no,
      'input_fingerprint', v_cur.input_fingerprint,
      'assessment_row_version', v_cur.assessment_row_version,
      'calculated_at', v_cur.calculated_at, 'calculated_by_name', v_cur.calculated_by_name,
      'matched_rule_count', v_cur.matched_rule_count,
      'contribution_count', v_cur.contribution_count,
      'supersedes_score_id', v_cur.supersedes_score_id,
      'recalculation_reason', v_cur.recalculation_reason,
      'correlation_id', v_cur.correlation_id,
      'status', v_cur.status, 'is_stale', v_stale) END,
    'contributions', v_contribs,
    'history', v_history));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_risk_review_readiness_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_cur public.bn_risk_score%ROWTYPE;
  v_rs public.bn_risk_scoring_rule_set%ROWTYPE; v_score jsonb; v_ready jsonb;
  v_b text[] := '{}'; v_w text[] := '{}'; v_decide boolean; v_stale boolean := false;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;

  v_decide := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  SELECT * INTO v_cur FROM public.bn_risk_score
   WHERE assessment_id = p_assessment_id AND status='CURRENT';
  SELECT * INTO v_rs FROM public._bn_risk_active_rule_set();

  IF v_cur.score_id IS NULL THEN
    v_b := v_b || 'A current risk score is required before review can be completed.';
  ELSE
    IF v_rs.rule_set_id IS NULL THEN
      v_b := v_b || 'Risk scoring configuration is incomplete.';
      v_stale := true;
    ELSE
      v_stale := v_cur.input_fingerprint IS DISTINCT FROM
                 public._bn_risk_score_fingerprint(p_assessment_id, v_rs.rule_set_id);
      IF v_stale THEN
        v_b := v_b || 'The risk score is out of date and must be recalculated.';
      END IF;
      IF v_cur.rule_set_id <> v_rs.rule_set_id THEN
        v_b := v_b || 'The score was produced by a scoring configuration that is no longer in force.';
      END IF;
    END IF;
  END IF;

  IF v_a.status <> 'REVIEW' THEN
    v_b := v_b || 'Only an assessment in review can complete the scoring review step.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_risk_information_request
              WHERE assessment_id=p_assessment_id AND is_blocking
                AND status NOT IN ('RESOLVED','CANCELLED')) THEN
    v_b := v_b || 'An outstanding blocking information request must be resolved first.';
  END IF;
  IF NOT v_decide THEN
    v_b := v_b || 'You do not have permission to complete the scoring review.';
  END IF;
  IF v_cur.score_id IS NOT NULL AND v_cur.matched_rule_count = 0 THEN
    v_w := v_w || 'No configured rule contributed to this score.';
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'can_complete_review', (array_length(v_b,1) IS NULL),
    'review_completed', (v_a.scoring_review_completed_at IS NOT NULL),
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'summary', jsonb_build_object(
      'linked_signal_count', (SELECT count(*) FROM public.bn_risk_assessment_signal
                               WHERE assessment_id=p_assessment_id),
      'active_factor_count', (SELECT count(*) FROM public.bn_risk_factor
                               WHERE assessment_id=p_assessment_id AND status='ACTIVE'),
      'increasing_factor_count', (SELECT count(*) FROM public.bn_risk_factor
                               WHERE assessment_id=p_assessment_id AND status='ACTIVE'
                                 AND direction_code='INCREASES_CONCERN'),
      'reducing_factor_count', (SELECT count(*) FROM public.bn_risk_factor
                               WHERE assessment_id=p_assessment_id AND status='ACTIVE'
                                 AND direction_code='REDUCES_CONCERN'),
      'usable_evidence_count', (SELECT count(*) FROM public.bn_risk_evidence_link
                               WHERE assessment_id=p_assessment_id AND status='LINKED'
                                 AND usability_code='USABLE'),
      'open_request_count', (SELECT count(*) FROM public.bn_risk_information_request
                               WHERE assessment_id=p_assessment_id
                                 AND status NOT IN ('RESOLVED','CANCELLED')),
      'score', v_cur.score, 'band_label', v_cur.band_label, 'is_stale', v_stale)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_risk_scoring_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_reason_code text,
  p_justification text, p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload,'{}'::jsonb);
  v_a public.bn_risk_assessment%ROWTYPE; v_rs public.bn_risk_scoring_rule_set%ROWTYPE;
  v_cur public.bn_risk_score%ROWTYPE; v_ready jsonb; v_eval jsonb; v_line jsonb;
  v_score_id uuid; v_version int; v_fp text; v_result jsonb; v_event text;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED: no actor'; END IF;
  IF p_command_name NOT IN ('CALCULATE_SCORE','RECALCULATE_SCORE','COMPLETE_SCORING_REVIEW') THEN
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: %', p_command_name;
  END IF;

  IF p_command_name = 'COMPLETE_SCORING_REVIEW' THEN
    PERFORM public._bn_risk_require(p_actor_user_id, 'decide', true);
  ELSE
    PERFORM public._bn_risk_require(p_actor_user_id, 'write', true);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.bn_risk_command_idempotency
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.command_name <> p_command_name
         OR v_existing.payload_hash IS DISTINCT FROM COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH: key already used with a different request';
      END IF;
      RETURN jsonb_set(v_existing.result_json, '{status}', '"REPLAYED"'::jsonb);
    END IF;
  END IF;

  SELECT * INTO v_a FROM public.bn_risk_assessment
   WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: assessment'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_a.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_VERSION_CONFLICT: this assessment changed while you were working';
  END IF;

  IF p_command_name IN ('CALCULATE_SCORE','RECALCULATE_SCORE') THEN
    v_ready := public.bn_risk_scoring_readiness_v1(p_actor_user_id, p_assessment_id);
    IF v_ready->>'status' <> 'OK' THEN RAISE EXCEPTION 'E_DENIED: scoring readiness unavailable'; END IF;
    IF NOT COALESCE((v_ready->'data'->>'can_score')::boolean,false) THEN
      RAISE EXCEPTION 'E_INVALID_STATE: %',
        COALESCE(v_ready->'data'->'blockers'->>0,'this assessment cannot be scored');
    END IF;

    SELECT * INTO v_rs FROM public._bn_risk_active_rule_set();
    IF v_rs.rule_set_id IS NULL THEN
      RAISE EXCEPTION 'E_CONFIGURATION_REQUIRED: Risk scoring configuration is incomplete.';
    END IF;

    SELECT * INTO v_cur FROM public.bn_risk_score
     WHERE assessment_id = p_assessment_id AND status='CURRENT' FOR UPDATE;

    IF p_command_name = 'CALCULATE_SCORE' AND v_cur.score_id IS NOT NULL THEN
      RAISE EXCEPTION 'E_INVALID_STATE: a score already exists; use recalculation instead';
    END IF;
    IF p_command_name = 'RECALCULATE_SCORE' AND v_cur.score_id IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_STATE: there is no score to recalculate';
    END IF;

    v_fp := public._bn_risk_score_fingerprint(p_assessment_id, v_rs.rule_set_id);
    v_eval := public._bn_risk_score_evaluate(
      public._bn_risk_score_factor_inputs(p_assessment_id),
      public._bn_risk_rule_set_json(v_rs.rule_set_id),
      public._bn_risk_band_json(v_rs.rule_set_id),
      v_rs.score_scale_min, v_rs.score_scale_max);

    v_version := COALESCE(v_cur.version_no, 0) + 1;
    IF v_cur.score_id IS NOT NULL THEN
      UPDATE public.bn_risk_score SET status='SUPERSEDED' WHERE score_id = v_cur.score_id;
    END IF;

    INSERT INTO public.bn_risk_score(
      assessment_id, assessment_row_version, version_no, rule_set_id, rule_set_code,
      rule_set_version_no, rule_set_name, input_fingerprint, score, score_scale_min,
      score_scale_max, band_code, band_label, contribution_count, matched_rule_count,
      calculated_by_user_id, calculated_by_name, supersedes_score_id, status,
      recalculation_reason, correlation_id)
    VALUES (p_assessment_id, v_a.row_version, v_version, v_rs.rule_set_id, v_rs.rule_set_code,
      v_rs.version_no, v_rs.name, v_fp, (v_eval->>'score')::numeric,
      v_rs.score_scale_min, v_rs.score_scale_max, v_eval->>'band_code', v_eval->>'band_label',
      (v_eval->>'contribution_count')::int, (v_eval->>'matched_rule_count')::int,
      p_actor_user_id, public._bn_risk_actor_name(p_actor_user_id),
      v_cur.score_id, 'CURRENT',
      NULLIF(btrim(COALESCE(v_payload->>'recalculation_reason','')),''), p_correlation_id)
    RETURNING score_id INTO v_score_id;

    FOR v_line IN SELECT t.c FROM jsonb_array_elements(v_eval->'contributions') t(c) LOOP
      INSERT INTO public.bn_risk_score_contribution(
        score_id, sequence_no, rule_id, rule_code, rule_name, factor_id, factor_reference,
        factor_type_code, factor_type_label, direction_code, direction_label, operator,
        evaluated_input, comparison_display, outcome, contribution, explanation)
      VALUES (v_score_id, (v_line->>'sequence_no')::int,
        NULLIF(v_line->>'rule_id','')::uuid, v_line->>'rule_code', v_line->>'rule_name',
        NULLIF(v_line->>'factor_id','')::uuid, v_line->>'factor_reference',
        v_line->>'factor_type_code', v_line->>'factor_type_label',
        v_line->>'direction_code', v_line->>'direction_label', v_line->>'operator',
        v_line->>'evaluated_input', v_line->>'comparison_display', v_line->>'outcome',
        COALESCE((v_line->>'contribution')::numeric,0), v_line->>'explanation');
    END LOOP;

    UPDATE public.bn_risk_assessment SET row_version = row_version + 1
     WHERE assessment_id = p_assessment_id;

    v_event := CASE WHEN p_command_name='CALCULATE_SCORE' THEN 'SCORE_CALCULATED' ELSE 'SCORE_RECALCULATED' END;
    PERFORM public._bn_risk_assessment_event(p_assessment_id, v_event, p_command_name,
      v_a.status, v_a.status, p_reason_code, p_justification,
      jsonb_build_object('score_id', v_score_id, 'version_no', v_version,
        'score', v_eval->>'score', 'band_code', v_eval->>'band_code',
        'band_label', v_eval->>'band_label',
        'rule_set_code', v_rs.rule_set_code, 'rule_set_version_no', v_rs.version_no,
        'input_fingerprint', v_fp),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

    IF v_cur.score_id IS NOT NULL THEN
      PERFORM public._bn_risk_assessment_event(p_assessment_id, 'SCORE_SUPERSEDED', p_command_name,
        v_a.status, v_a.status, NULL, NULL,
        jsonb_build_object('superseded_score_id', v_cur.score_id,
                           'superseded_version_no', v_cur.version_no),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);
    END IF;

    v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
      'score_id', v_score_id, 'version_no', v_version, 'entity_version', v_a.row_version + 1);

  ELSE
    v_ready := public.bn_risk_review_readiness_v1(p_actor_user_id, p_assessment_id);
    IF v_ready->>'status' <> 'OK' THEN RAISE EXCEPTION 'E_DENIED: review readiness unavailable'; END IF;
    IF NOT COALESCE((v_ready->'data'->>'can_complete_review')::boolean,false) THEN
      RAISE EXCEPTION 'E_INVALID_STATE: %',
        COALESCE(v_ready->'data'->'blockers'->>0,'the scoring review cannot be completed');
    END IF;
    IF NOT public._bn_risk_assessment_can_transition(v_a.status, 'RECOMMENDATION') THEN
      RAISE EXCEPTION 'E_INVALID_STATE: this assessment cannot move to recommendation from %', v_a.status;
    END IF;

    UPDATE public.bn_risk_assessment
       SET status='RECOMMENDATION', scoring_review_completed_at = now(),
           scoring_review_completed_by_user_id = p_actor_user_id,
           row_version = row_version + 1
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_risk_assessment_event(p_assessment_id, 'SCORING_REVIEW_COMPLETED',
      p_command_name, v_a.status, 'RECOMMENDATION', p_reason_code, p_justification,
      jsonb_build_object('score_id', (SELECT score_id FROM public.bn_risk_score
                                       WHERE assessment_id=p_assessment_id AND status='CURRENT')),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
      'assessment_status','RECOMMENDATION','entity_version', v_a.row_version + 1);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
      assessment_id, entity_version, result_json, status, actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''),
      p_assessment_id, NULLIF(v_result->>'entity_version','')::bigint,
      v_result, 'COMPLETED', p_actor_user_id, now());
  END IF;

  RETURN v_result;
END; $function$;
