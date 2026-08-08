
-- Effective ACTIVE rule set (exactly one may be effective at a time).
CREATE OR REPLACE FUNCTION public._bn_risk_active_rule_set()
RETURNS public.bn_risk_scoring_rule_set
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT rs.* FROM public.bn_risk_scoring_rule_set rs
   WHERE rs.status = 'ACTIVE'
     AND (rs.effective_from IS NULL OR rs.effective_from <= now())
     AND (rs.effective_to IS NULL OR rs.effective_to > now())
   ORDER BY rs.effective_from DESC NULLS LAST, rs.version_no DESC
   LIMIT 1;
$function$;

-- Governed scoring inputs for an assessment (deterministic order).
CREATE OR REPLACE FUNCTION public._bn_risk_score_factor_inputs(p_assessment uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'factor_reference'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'factor_id', f.factor_id,
      'factor_reference', f.factor_reference,
      'factor_version', f.factor_version,
      'factor_type_code', f.factor_type_code,
      'factor_type_label', COALESCE(ft.label, f.factor_type_code),
      'direction_code', f.direction_code,
      'direction_label', COALESCE((SELECT rv.label FROM public.bn_risk_reference_value rv
                                    WHERE rv.domain='FACTOR_DIRECTION' AND rv.code=f.direction_code),
                                  f.direction_code),
      'materiality_code', f.materiality_code,
      'value_numeric', f.value_numeric,
      'value_code', f.value_code,
      'value_date', f.value_date,
      'value_text', f.value_text,
      'provenance_code', f.provenance_code,
      'evidence_requirement_code', f.evidence_requirement_code,
      'evidence_usable', EXISTS (
        SELECT 1 FROM public.bn_risk_evidence_link e
         WHERE e.assessment_id = f.assessment_id AND e.factor_id = f.factor_id
           AND e.status = 'LINKED' AND e.usability_code = 'USABLE')
    ) AS x
    FROM public.bn_risk_factor f
    LEFT JOIN public.bn_risk_factor_type ft ON ft.factor_type_code = f.factor_type_code
   WHERE f.assessment_id = p_assessment AND f.status = 'ACTIVE'
  ) s;
$function$;

-- Deterministic fingerprint over the authoritative scoring inputs.
CREATE OR REPLACE FUNCTION public._bn_risk_score_fingerprint(p_assessment uuid, p_rule_set uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factors text; v_signals text; v_rules text; v_set text;
BEGIN
  v_factors := COALESCE(public._bn_risk_score_factor_inputs(p_assessment)::text, '[]');

  SELECT COALESCE(string_agg(s.signal_id::text || ':' || sg.status || ':' || s.role_code, '|'
                             ORDER BY s.signal_id::text), '')
    INTO v_signals
    FROM public.bn_risk_assessment_signal s
    JOIN public.bn_risk_signal sg ON sg.signal_id = s.signal_id
   WHERE s.assessment_id = p_assessment;

  SELECT COALESCE(rs.rule_set_code || ':' || rs.version_no::text || ':' || rs.rule_set_id::text, '')
    INTO v_set FROM public.bn_risk_scoring_rule_set rs WHERE rs.rule_set_id = p_rule_set;

  SELECT COALESCE(string_agg(r.rule_code || ':' || r.operator || ':' ||
                             COALESCE(r.comparison_code,'') || ':' ||
                             COALESCE(r.comparison_numeric::text,'') || ':' ||
                             r.contribution::text || ':' || r.is_enabled::text, '|'
                             ORDER BY r.rule_code), '')
    INTO v_rules FROM public.bn_risk_scoring_rule r WHERE r.rule_set_id = p_rule_set;

  RETURN 'md5:' || md5(v_set || '#' || v_rules || '#' || v_factors || '#' || v_signals);
END; $function$;

-- Pure, deterministic evaluation. No clock, no randomness, no external reads.
CREATE OR REPLACE FUNCTION public._bn_risk_score_evaluate(
  p_factors jsonb, p_rules jsonb, p_bands jsonb,
  p_scale_min numeric, p_scale_max numeric)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_rule jsonb; v_factor jsonb; v_cands jsonb; v_lines jsonb := '[]'::jsonb;
  v_seq int := 0; v_total numeric := 0; v_rule_total numeric; v_matched int := 0;
  v_cap numeric; v_contrib numeric; v_match boolean; v_count int;
  v_input text; v_cmp text; v_outcome text; v_expl text; v_capped boolean;
  v_score numeric; v_band_code text; v_band_label text; v_op text;
BEGIN
  FOR v_rule IN
    SELECT t.r FROM jsonb_array_elements(COALESCE(p_rules,'[]'::jsonb)) t(r)
     WHERE COALESCE((t.r->>'is_enabled')::boolean, true)
     ORDER BY COALESCE((t.r->>'sort_order')::int, 100), t.r->>'rule_code'
  LOOP
    v_op := v_rule->>'operator';
    v_cap := NULLIF(v_rule->>'max_contribution','')::numeric;
    v_rule_total := 0;
    v_capped := false;
    v_cmp := CASE
      WHEN v_rule->>'comparison_code' IS NOT NULL THEN v_rule->>'comparison_code'
      WHEN v_rule->>'comparison_numeric' IS NOT NULL THEN v_rule->>'comparison_numeric'
      ELSE '—' END;

    SELECT COALESCE(jsonb_agg(t.f ORDER BY t.f->>'factor_reference'), '[]'::jsonb) INTO v_cands
      FROM jsonb_array_elements(COALESCE(p_factors,'[]'::jsonb)) t(f)
     WHERE (v_rule->>'factor_type_code' IS NULL
            OR t.f->>'factor_type_code' = v_rule->>'factor_type_code')
       AND (v_rule->>'direction_code' IS NULL
            OR t.f->>'direction_code' = v_rule->>'direction_code')
       AND (NOT COALESCE((v_rule->>'requires_usable_evidence')::boolean,false)
            OR COALESCE((t.f->>'evidence_usable')::boolean,false));

    IF jsonb_array_length(v_cands) = 0 THEN
      v_seq := v_seq + 1;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sequence_no', v_seq, 'rule_id', v_rule->>'rule_id', 'rule_code', v_rule->>'rule_code',
        'rule_name', v_rule->>'name', 'factor_id', NULL, 'factor_reference', NULL,
        'factor_type_code', v_rule->>'factor_type_code', 'factor_type_label', NULL,
        'direction_code', v_rule->>'direction_code', 'direction_label', NULL,
        'operator', v_op, 'evaluated_input', 'No matching factor recorded',
        'comparison_display', v_cmp, 'outcome', 'SKIPPED', 'contribution', 0,
        'explanation', 'No factor on this assessment is in scope for this rule.'));
      CONTINUE;
    END IF;

    IF v_op = 'FACTOR_COUNT_AT_LEAST' THEN
      v_count := jsonb_array_length(v_cands);
      v_match := v_count >= COALESCE(NULLIF(v_rule->>'comparison_numeric','')::numeric, 1);
      v_contrib := CASE WHEN v_match THEN (v_rule->>'contribution')::numeric ELSE 0 END;
      IF v_cap IS NOT NULL AND abs(v_contrib) > v_cap THEN
        v_contrib := sign(v_contrib) * v_cap; v_capped := true;
      END IF;
      v_rule_total := v_contrib;
      v_seq := v_seq + 1;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sequence_no', v_seq, 'rule_id', v_rule->>'rule_id', 'rule_code', v_rule->>'rule_code',
        'rule_name', v_rule->>'name', 'factor_id', NULL, 'factor_reference', NULL,
        'factor_type_code', v_rule->>'factor_type_code', 'factor_type_label', NULL,
        'direction_code', v_rule->>'direction_code', 'direction_label', NULL,
        'operator', v_op, 'evaluated_input', v_count::text || ' matching factor(s)',
        'comparison_display', v_cmp,
        'outcome', CASE WHEN v_capped THEN 'CAPPED' WHEN v_match THEN 'MATCHED' ELSE 'NOT_MATCHED' END,
        'contribution', v_contrib,
        'explanation', COALESCE(NULLIF(v_rule->>'explanation_template',''),
          CASE WHEN v_match
            THEN format('%s matching factor(s) were recorded, which meets the configured threshold of %s.', v_count, v_cmp)
            ELSE format('%s matching factor(s) were recorded, below the configured threshold of %s.', v_count, v_cmp) END)));
    ELSE
      FOR v_factor IN SELECT t.f FROM jsonb_array_elements(v_cands) t(f)
                       ORDER BY t.f->>'factor_reference'
      LOOP
        v_input := NULL;
        IF v_op = 'FACTOR_PRESENT' THEN
          v_match := true;
          v_input := COALESCE(v_factor->>'value_text', v_factor->>'value_code',
                              v_factor->>'value_numeric', v_factor->>'value_date', 'recorded');
        ELSIF v_op = 'VALUE_EQUALS_CODE' THEN
          v_input := COALESCE(v_factor->>'value_code','(none)');
          v_match := v_factor->>'value_code' IS NOT NULL
                     AND v_factor->>'value_code' = v_rule->>'comparison_code';
        ELSIF v_op = 'VALUE_AT_LEAST' THEN
          v_input := COALESCE(v_factor->>'value_numeric','(none)');
          v_match := (v_factor->>'value_numeric') IS NOT NULL
                     AND (v_factor->>'value_numeric')::numeric
                         >= COALESCE(NULLIF(v_rule->>'comparison_numeric','')::numeric, 0);
        ELSIF v_op = 'VALUE_LESS_THAN' THEN
          v_input := COALESCE(v_factor->>'value_numeric','(none)');
          v_match := (v_factor->>'value_numeric') IS NOT NULL
                     AND (v_factor->>'value_numeric')::numeric
                         < COALESCE(NULLIF(v_rule->>'comparison_numeric','')::numeric, 0);
        ELSIF v_op = 'MATERIALITY_AT_LEAST' THEN
          v_input := COALESCE(v_factor->>'materiality_code','(not stated)');
          v_match := (CASE COALESCE(v_factor->>'materiality_code','')
                        WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'HIGH' THEN 3 ELSE 0 END)
                     >= (CASE COALESCE(v_rule->>'comparison_code','')
                        WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'HIGH' THEN 3 ELSE 4 END);
        ELSIF v_op = 'EVIDENCE_USABLE' THEN
          v_match := COALESCE((v_factor->>'evidence_usable')::boolean,false);
          v_input := CASE WHEN v_match THEN 'Usable evidence linked' ELSE 'No usable evidence' END;
        ELSIF v_op = 'EVIDENCE_NOT_USABLE' THEN
          v_match := NOT COALESCE((v_factor->>'evidence_usable')::boolean,false);
          v_input := CASE WHEN v_match THEN 'No usable evidence' ELSE 'Usable evidence linked' END;
        ELSE
          v_match := false; v_input := '(unsupported operator)';
        END IF;

        v_contrib := CASE WHEN v_match THEN (v_rule->>'contribution')::numeric ELSE 0 END;
        IF v_cap IS NOT NULL AND abs(v_rule_total + v_contrib) > v_cap THEN
          v_contrib := sign(COALESCE(NULLIF(v_contrib,0), 1)) * greatest(v_cap - abs(v_rule_total), 0);
          v_capped := true;
        END IF;
        v_rule_total := v_rule_total + v_contrib;

        v_outcome := CASE WHEN v_capped AND v_match THEN 'CAPPED'
                          WHEN v_match THEN 'MATCHED' ELSE 'NOT_MATCHED' END;
        v_expl := COALESCE(NULLIF(v_rule->>'explanation_template',''),
          CASE WHEN v_match
            THEN format('%s: recorded value "%s" satisfied the rule condition (%s %s).',
                        COALESCE(v_factor->>'factor_type_label','Factor'), v_input, v_op, v_cmp)
            ELSE format('%s: recorded value "%s" did not satisfy the rule condition (%s %s).',
                        COALESCE(v_factor->>'factor_type_label','Factor'), v_input, v_op, v_cmp) END);

        v_seq := v_seq + 1;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'sequence_no', v_seq, 'rule_id', v_rule->>'rule_id', 'rule_code', v_rule->>'rule_code',
          'rule_name', v_rule->>'name',
          'factor_id', v_factor->>'factor_id', 'factor_reference', v_factor->>'factor_reference',
          'factor_type_code', v_factor->>'factor_type_code',
          'factor_type_label', v_factor->>'factor_type_label',
          'direction_code', v_factor->>'direction_code',
          'direction_label', v_factor->>'direction_label',
          'operator', v_op, 'evaluated_input', v_input, 'comparison_display', v_cmp,
          'outcome', v_outcome, 'contribution', v_contrib, 'explanation', v_expl));
      END LOOP;
    END IF;

    IF v_rule_total <> 0 THEN v_matched := v_matched + 1; END IF;
    v_total := v_total + v_rule_total;
  END LOOP;

  v_score := least(greatest(v_total, p_scale_min), p_scale_max);

  SELECT t.b->>'band_code', t.b->>'label' INTO v_band_code, v_band_label
    FROM jsonb_array_elements(COALESCE(p_bands,'[]'::jsonb)) t(b)
   WHERE v_score >= (t.b->>'min_score')::numeric AND v_score <= (t.b->>'max_score')::numeric
   ORDER BY COALESCE((t.b->>'sort_order')::int, 100), (t.b->>'min_score')::numeric
   LIMIT 1;

  RETURN jsonb_build_object(
    'raw_total', v_total,
    'score', v_score,
    'score_scale_min', p_scale_min,
    'score_scale_max', p_scale_max,
    'band_code', v_band_code,
    'band_label', v_band_label,
    'matched_rule_count', v_matched,
    'contribution_count', jsonb_array_length(v_lines),
    'contributions', v_lines);
END; $function$;
