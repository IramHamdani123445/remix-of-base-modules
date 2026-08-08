-- ============================================================
-- BN Uprating — Epic 1 governed run boundary
-- ============================================================

CREATE OR REPLACE FUNCTION public._bn_uprating_round_minor(p_amount numeric, p_mode text)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $fn$
  SELECT CASE upper(COALESCE(p_mode,'NONE'))
    WHEN 'NONE'       THEN round(p_amount)::bigint
    WHEN 'NEAREST_1'  THEN (round(p_amount / 100.0) * 100)::bigint
    WHEN 'NEAREST_10' THEN (round(p_amount / 1000.0) * 1000)::bigint
    WHEN 'NEAREST_100'THEN (round(p_amount / 10000.0) * 10000)::bigint
    WHEN 'DOWN'       THEN (floor(p_amount / 100.0) * 100)::bigint
    WHEN 'UP'         THEN (ceil(p_amount / 100.0) * 100)::bigint
    WHEN 'HALF_EVEN'  THEN (
      CASE WHEN (p_amount / 100.0) - floor(p_amount / 100.0) = 0.5
           THEN (CASE WHEN (floor(p_amount / 100.0))::bigint % 2 = 0
                      THEN floor(p_amount / 100.0) ELSE floor(p_amount / 100.0) + 1 END)
           ELSE round(p_amount / 100.0) END * 100)::bigint
    ELSE round(p_amount)::bigint END;
$fn$;

-- Deterministic single-award calculation against the frozen run parameters.
CREATE OR REPLACE FUNCTION public._bn_uprating_calc_item(p_run_id uuid, p_base_minor bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $fn$
DECLARE
  r public.bn_uprating_run%ROWTYPE;
  v_unrounded numeric(20,6);
  v_pct integer; v_fixed bigint; v_factor numeric(18,8);
  v_tier jsonb; v_tier_seq integer; v_trace jsonb := '[]'::jsonb;
  v_proposed bigint;
BEGIN
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','FAILED','reason','RUN_NOT_FOUND'); END IF;
  IF p_base_minor IS NULL OR p_base_minor <= 0 THEN
    RETURN jsonb_build_object('status','FAILED','reason','INVALID_BASE_AMOUNT');
  END IF;

  v_trace := v_trace || jsonb_build_object('step','BASE','label','Current award amount',
    'value_minor', p_base_minor);

  IF r.frozen_policy_type = 'PERCENTAGE' THEN
    v_pct := COALESCE(r.frozen_percentage_bp,0);
    v_unrounded := p_base_minor::numeric * (1 + v_pct::numeric / 10000.0);
    v_trace := v_trace || jsonb_build_object('step','PERCENTAGE','label','Apply percentage increase',
      'percentage_bp', v_pct, 'value_minor', v_unrounded);

  ELSIF r.frozen_policy_type = 'FIXED_AMOUNT' THEN
    v_fixed := COALESCE(r.frozen_fixed_amount_minor,0);
    v_unrounded := p_base_minor::numeric + v_fixed;
    v_trace := v_trace || jsonb_build_object('step','FIXED_AMOUNT','label','Apply fixed increase',
      'fixed_amount_minor', v_fixed, 'value_minor', v_unrounded);

  ELSIF r.frozen_policy_type = 'PERCENTAGE_PLUS_FIXED' THEN
    v_pct := COALESCE(r.frozen_percentage_bp,0);
    v_fixed := COALESCE(r.frozen_fixed_amount_minor,0);
    v_unrounded := p_base_minor::numeric * (1 + v_pct::numeric / 10000.0) + v_fixed;
    v_trace := v_trace
      || jsonb_build_object('step','PERCENTAGE','label','Apply percentage increase','percentage_bp', v_pct)
      || jsonb_build_object('step','FIXED_AMOUNT','label','Apply fixed increase','fixed_amount_minor', v_fixed,
                            'value_minor', v_unrounded);

  ELSIF r.frozen_policy_type = 'INDEX_FACTOR' THEN
    IF COALESCE(r.frozen_index_base_value,0) = 0 OR r.frozen_index_value IS NULL THEN
      RETURN jsonb_build_object('status','FAILED','reason','INDEX_OBSERVATION_UNAVAILABLE');
    END IF;
    v_factor := (r.frozen_index_value / r.frozen_index_base_value)::numeric(18,8);
    v_unrounded := p_base_minor::numeric * v_factor;
    v_trace := v_trace || jsonb_build_object('step','INDEX_FACTOR','label','Apply published index factor',
      'index_value', r.frozen_index_value, 'index_base_value', r.frozen_index_base_value,
      'factor', v_factor, 'value_minor', v_unrounded);

  ELSIF r.frozen_policy_type = 'TIERED' THEN
    SELECT t, (t->>'sequence_no')::int INTO v_tier, v_tier_seq
      FROM jsonb_array_elements(r.frozen_tiers) t
     WHERE p_base_minor >= COALESCE((t->>'lower_bound_minor')::bigint, 0)
       AND (t->>'upper_bound_minor' IS NULL OR p_base_minor <= (t->>'upper_bound_minor')::bigint)
     ORDER BY (t->>'sequence_no')::int LIMIT 1;
    IF v_tier IS NULL THEN
      RETURN jsonb_build_object('status','FAILED','reason','NO_MATCHING_TIER');
    END IF;
    v_pct := COALESCE((v_tier->>'percentage_bp')::int, 0);
    v_fixed := COALESCE((v_tier->>'fixed_amount_minor')::bigint, 0);
    v_unrounded := p_base_minor::numeric * (1 + v_pct::numeric / 10000.0) + v_fixed;
    v_trace := v_trace || jsonb_build_object('step','TIER','label','Apply matched tier',
      'tier_sequence', v_tier_seq, 'percentage_bp', v_pct, 'fixed_amount_minor', v_fixed,
      'value_minor', v_unrounded);
  ELSE
    RETURN jsonb_build_object('status','FAILED','reason','POLICY_METHOD_NOT_SIMULATABLE');
  END IF;

  v_proposed := public._bn_uprating_round_minor(v_unrounded, r.frozen_rounding_mode);
  v_trace := v_trace || jsonb_build_object('step','ROUNDING','label','Apply rounding rule',
    'rounding_mode', r.frozen_rounding_mode, 'value_minor', v_proposed);

  RETURN jsonb_build_object(
    'status','CALCULATED', 'method', r.frozen_policy_type,
    'unrounded_minor', v_unrounded, 'proposed_minor', v_proposed,
    'delta_minor', v_proposed - p_base_minor,
    'percentage_bp', v_pct, 'fixed_amount_minor', v_fixed, 'factor', v_factor,
    'tier_sequence', v_tier_seq, 'rounding_mode', r.frozen_rounding_mode, 'trace', v_trace);
END; $fn$;

-- ---------------- Governed run command boundary -----------------------
CREATE OR REPLACE FUNCTION public.bn_uprating_run_command_v1(
  p_command_name text,
  p_actor_user_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_run_id uuid DEFAULT NULL,
  p_exception_id uuid DEFAULT NULL,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_cached jsonb; v_result jsonb; v_capability text; v_actor_name text;
  r public.bn_uprating_run%ROWTYPE;
  v_ver public.bn_uprating_policy_version%ROWTYPE;
  v_exc public.bn_uprating_run_exception%ROWTYPE;
  v_pol public.bn_uprating_exception_policy%ROWTYPE;
  v_prev text; v_new text; v_ref text; v_seq int;
  v_snapshot_id uuid; v_snap_ver int; v_sim_id uuid; v_sim_ver int;
  v_total int; v_elig int; v_excl int; v_exc_items int; v_block int;
  v_cur_total bigint; v_prop_total bigint; v_fail int;
  v_fp text; v_obs numeric(18,6); v_base_obs numeric(18,6);
  v_res text; v_just text; v_open int;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNAUTHENTICATED','message','You must be signed in as the acting user.','data',NULL);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_cached FROM public.bn_uprating_command_idempotency
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN jsonb_set(v_cached,'{status}', to_jsonb('REPLAYED'::text)); END IF;
  END IF;

  v_capability := CASE p_command_name
    WHEN 'BN_UPRATING_CREATE_RUN' THEN 'write'
    WHEN 'BN_UPRATING_UPDATE_RUN' THEN 'write'
    WHEN 'BN_UPRATING_PARAMETERISE_RUN' THEN 'write'
    WHEN 'BN_UPRATING_BUILD_POPULATION' THEN 'decide'
    WHEN 'BN_UPRATING_RESOLVE_EXCEPTION' THEN 'decide'
    WHEN 'BN_UPRATING_SIMULATE' THEN 'decide'
    ELSE NULL END;
  IF v_capability IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNKNOWN_COMMAND','message','That command is not available in this module.','data',NULL);
  END IF;

  BEGIN
    PERFORM public._bn_uprating_require(p_actor_user_id, v_capability, true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','ERROR','code','E_PERMISSION','message','You do not have permission to perform this action.','data',NULL);
  END;

  v_actor_name := public._bn_uprating_actor_name(p_actor_user_id);

  IF p_exception_id IS NOT NULL THEN
    SELECT * INTO v_exc FROM public.bn_uprating_run_exception WHERE exception_id = p_exception_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That exception could not be found.','data',NULL);
    END IF;
    p_run_id := COALESCE(p_run_id, v_exc.run_id);
  END IF;

  IF p_run_id IS NOT NULL THEN
    SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
    END IF;
    v_prev := r.status;
    IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> r.row_version THEN
      RETURN jsonb_build_object('status','ERROR','code','E_STALE_ROW_VERSION',
        'message','This run was changed by someone else. Reload and try again.','data',
        jsonb_build_object('current_row_version', r.row_version));
    END IF;
  END IF;

  -- ============ CREATE RUN ============
  IF p_command_name = 'BN_UPRATING_CREATE_RUN' THEN
    IF NULLIF(p_payload->>'policy_version_id','') IS NULL OR NULLIF(p_payload->>'target_effective_date','') IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_VALIDATION','message','A policy version and target effective date are required.','data',NULL);
    END IF;
    SELECT * INTO v_ver FROM public.bn_uprating_policy_version
     WHERE policy_version_id = (p_payload->>'policy_version_id')::uuid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That policy version could not be found.','data',NULL);
    END IF;
    IF v_ver.status <> 'ACTIVE' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_POLICY_NOT_ACTIVE',
        'message','A run can only be created from an active, approved policy version.','data',NULL);
    END IF;
    IF (p_payload->>'target_effective_date')::date < COALESCE(v_ver.effective_from,'0001-01-01'::date)
       OR (v_ver.effective_to IS NOT NULL AND (p_payload->>'target_effective_date')::date > v_ver.effective_to) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_EFFECTIVE_DATE_OUTSIDE_POLICY',
        'message','The target effective date is outside the effective period of that policy version.','data',NULL);
    END IF;
    SELECT 'UPR-' || to_char(now(),'YYYY') || '-' || lpad((COALESCE(count(*),0)+1)::text, 5, '0')
      INTO v_ref FROM public.bn_uprating_run WHERE created_at >= date_trunc('year', now());
    INSERT INTO public.bn_uprating_run(run_reference, run_name, policy_id, policy_version_id,
      country_code, target_effective_date, scope_product_id, scope_award_type_code,
      scope_award_component_code, scope_payment_frequency, scope_description,
      correlation_id, created_by, created_by_name)
    VALUES (v_ref, NULLIF(btrim(COALESCE(p_payload->>'run_name','')),''), v_ver.policy_id, v_ver.policy_version_id,
      COALESCE(NULLIF(p_payload->>'country_code',''), v_ver.country_code),
      (p_payload->>'target_effective_date')::date,
      COALESCE(NULLIF(p_payload->>'scope_product_id','')::uuid, v_ver.product_id),
      COALESCE(NULLIF(p_payload->>'scope_award_type_code',''), v_ver.award_type_code),
      COALESCE(NULLIF(p_payload->>'scope_award_component_code',''), v_ver.award_component_code),
      COALESCE(NULLIF(p_payload->>'scope_payment_frequency',''), v_ver.payment_frequency),
      NULLIF(p_payload->>'scope_description',''), p_correlation_id, p_actor_user_id, v_actor_name)
    RETURNING * INTO r;
    p_run_id := r.run_id; v_new := 'DRAFT';
    PERFORM public._bn_uprating_run_event(r.run_id,'RUN_CREATED','Run created',
      'Run ' || r.run_reference || ' created from policy version ' || v_ver.version_reference,
      NULL,'DRAFT', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Uprating run created.','data',
      jsonb_build_object('run_id', r.run_id,'run_reference', r.run_reference,'status','DRAFT'));

  -- ============ UPDATE RUN (draft only) ============
  ELSIF p_command_name = 'BN_UPRATING_UPDATE_RUN' THEN
    IF r.status <> 'DRAFT' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only a draft run can be edited.','data',NULL);
    END IF;
    UPDATE public.bn_uprating_run SET
      run_name = COALESCE(NULLIF(p_payload->>'run_name',''), run_name),
      target_effective_date = COALESCE(NULLIF(p_payload->>'target_effective_date','')::date, target_effective_date),
      scope_product_id = CASE WHEN p_payload ? 'scope_product_id' THEN NULLIF(p_payload->>'scope_product_id','')::uuid ELSE scope_product_id END,
      scope_award_type_code = CASE WHEN p_payload ? 'scope_award_type_code' THEN NULLIF(p_payload->>'scope_award_type_code','') ELSE scope_award_type_code END,
      scope_award_component_code = CASE WHEN p_payload ? 'scope_award_component_code' THEN NULLIF(p_payload->>'scope_award_component_code','') ELSE scope_award_component_code END,
      scope_payment_frequency = CASE WHEN p_payload ? 'scope_payment_frequency' THEN NULLIF(p_payload->>'scope_payment_frequency','') ELSE scope_payment_frequency END,
      scope_description = COALESCE(NULLIF(p_payload->>'scope_description',''), scope_description),
      row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    v_new := r.status;
    PERFORM public._bn_uprating_run_event(r.run_id,'RUN_UPDATED','Run parameters updated', NULL,'DRAFT','DRAFT', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Run updated.','data',
      jsonb_build_object('run_id', r.run_id,'row_version', r.row_version));

  -- ============ PARAMETERISE (freeze policy provenance) ============
  ELSIF p_command_name = 'BN_UPRATING_PARAMETERISE_RUN' THEN
    IF r.status <> 'DRAFT' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only a draft run can be parameterised.','data',NULL);
    END IF;
    SELECT * INTO v_ver FROM public.bn_uprating_policy_version WHERE policy_version_id = r.policy_version_id;
    IF v_ver.status <> 'ACTIVE' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_POLICY_NOT_ACTIVE',
        'message','The selected policy version is no longer active.','data',NULL);
    END IF;
    IF v_ver.policy_type = 'INDEX_FACTOR' THEN
      SELECT observed_value INTO v_obs FROM public.bn_uprating_index_observation
       WHERE index_series_id = v_ver.index_series_id AND reference_period = v_ver.index_reference_period
         AND status = 'PUBLISHED' LIMIT 1;
      SELECT observed_value INTO v_base_obs FROM public.bn_uprating_index_observation
       WHERE index_series_id = v_ver.index_series_id AND reference_period = v_ver.index_base_period
         AND status = 'PUBLISHED' LIMIT 1;
      IF v_obs IS NULL OR v_base_obs IS NULL OR v_base_obs = 0 THEN
        RETURN jsonb_build_object('status','ERROR','code','E_INDEX_OBSERVATION_UNAVAILABLE',
          'message','The published index observations required by this policy version are not available.','data',NULL);
      END IF;
    END IF;
    UPDATE public.bn_uprating_run SET status = 'PARAMETERISED',
      frozen_policy_type = v_ver.policy_type,
      frozen_rounding_mode = COALESCE(v_ver.rounding_mode,'NONE'),
      frozen_effective_from = v_ver.effective_from, frozen_effective_to = v_ver.effective_to,
      frozen_percentage_bp = v_ver.percentage_bp, frozen_fixed_amount_minor = v_ver.fixed_amount_minor,
      frozen_formula_version_id = v_ver.formula_version_id,
      frozen_index_series_id = v_ver.index_series_id,
      frozen_index_value = v_obs, frozen_index_base_value = v_base_obs,
      frozen_tiers = COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'sequence_no', t.sequence_no,'lower_bound_minor', t.lower_bound_minor,
          'upper_bound_minor', t.upper_bound_minor,'percentage_bp', t.percentage_bp,
          'fixed_amount_minor', t.fixed_amount_minor) ORDER BY t.sequence_no)
        FROM public.bn_uprating_policy_tier t WHERE t.policy_version_id = v_ver.policy_version_id),'[]'::jsonb),
      frozen_applicability = jsonb_build_object('country_code', v_ver.country_code,
        'product_id', v_ver.product_id, 'award_type_code', v_ver.award_type_code,
        'award_component_code', v_ver.award_component_code, 'payment_frequency', v_ver.payment_frequency),
      parameterised_at = now(), parameterised_by = p_actor_user_id,
      simulation_state = 'NONE', row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    v_new := 'PARAMETERISED';
    PERFORM public._bn_uprating_run_event(r.run_id,'PARAMETERISED','Run parameters locked',
      'Policy provenance frozen from version ' || v_ver.version_reference,'DRAFT','PARAMETERISED', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Run parameters locked.','data',
      jsonb_build_object('run_id', r.run_id,'status','PARAMETERISED'));

  -- ============ BUILD POPULATION ============
  ELSIF p_command_name = 'BN_UPRATING_BUILD_POPULATION' THEN
    IF r.status NOT IN ('PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE',
        'message','Lock the run parameters before building the population.','data',NULL);
    END IF;

    UPDATE public.bn_uprating_run_snapshot SET status='SUPERSEDED', superseded_at = now()
     WHERE run_id = r.run_id AND status='CURRENT';
    SELECT COALESCE(max(snapshot_version),0)+1 INTO v_snap_ver
      FROM public.bn_uprating_run_snapshot WHERE run_id = r.run_id;

    INSERT INTO public.bn_uprating_run_snapshot(run_id, snapshot_version, policy_version_id,
      selection_criteria, taken_by, taken_by_name, correlation_id)
    VALUES (r.run_id, v_snap_ver, r.policy_version_id,
      jsonb_build_object('country_code', r.country_code,'product_id', r.scope_product_id,
        'award_type_code', r.scope_award_type_code,'award_component_code', r.scope_award_component_code,
        'payment_frequency', r.scope_payment_frequency,'target_effective_date', r.target_effective_date),
      p_actor_user_id, v_actor_name, p_correlation_id)
    RETURNING snapshot_id INTO v_snapshot_id;

    INSERT INTO public.bn_uprating_run_snapshot_item(snapshot_id, run_id, award_id, award_reference,
      person_reference, product_id, product_code, product_name, product_version_id, award_type_code,
      award_component_code, award_status, base_amount_minor, currency_code, payment_frequency,
      award_start_date, award_end_date, source_row_version, eligibility_status, exclusion_reason_code,
      inclusion_explanation, provenance)
    SELECT v_snapshot_id, r.run_id, a.id, a.award_number,
      right(COALESCE(a.ssn,''), 4), a.bn_product_id, pr.benefit_code, pr.benefit_name,
      (SELECT pv.id FROM public.bn_product_version pv
        WHERE pv.product_id = a.bn_product_id AND pv.status = 'ACTIVE'
          AND pv.effective_from <= r.target_effective_date
          AND (pv.effective_to IS NULL OR pv.effective_to >= r.target_effective_date)
        ORDER BY pv.version_number DESC LIMIT 1),
      a.award_type, r.scope_award_component_code, a.status,
      round(COALESCE(a.base_amount,0) * 100)::bigint, COALESCE(a.currency,'XCD'), a.frequency,
      a.start_date, a.end_date, a.row_version,
      CASE WHEN x.exclusion_reason_code IS NOT NULL THEN 'EXCLUDED' ELSE 'ELIGIBLE' END,
      x.exclusion_reason_code,
      CASE WHEN x.exclusion_reason_code IS NOT NULL
           THEN public._bn_uprating_ref_label('EXCLUSION_REASON', x.exclusion_reason_code)
           ELSE 'In scope for the target effective date.' END,
      jsonb_build_object('source_table','bn_award','observed_row_version', a.row_version,
        'target_effective_date', r.target_effective_date)
    FROM public.bn_award a
    JOIN public.bn_product pr ON pr.id = a.bn_product_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM public.bn_mortality_award_impact mi
                      WHERE mi.bn_award_id = a.id
                        AND COALESCE(mi.impact_status,'OPEN') NOT IN ('REVERSED','CANCELLED'))
          THEN 'PENDING_MORTALITY'
        WHEN EXISTS (SELECT 1 FROM public.bn_appeal ap
                      WHERE ap.bn_award_id = a.id
                        AND COALESCE(ap.status,'OPEN') NOT IN ('CLOSED','WITHDRAWN','IMPLEMENTED'))
          THEN 'UNRESOLVED_APPEAL'
        WHEN EXISTS (SELECT 1 FROM public.bn_award_suspension_event se
                      WHERE se.bn_award_id = a.id
                        AND COALESCE(se.status,'') IN ('ACTIVE','APPROVED','EXECUTED')
                        AND (se.suspended_to IS NULL OR se.suspended_to >= r.target_effective_date))
          THEN 'PAYMENT_HELD'
        WHEN EXISTS (SELECT 1 FROM public.bn_risk_control_execution rc
                      WHERE rc.target_business_reference = a.award_number
                        AND COALESCE(rc.status,'') IN ('REQUESTED','ACCEPTED','IN_PROGRESS'))
          THEN 'RISK_INVESTIGATION'
        ELSE NULL END AS exclusion_reason_code
    ) x
    WHERE COALESCE(a.status,'') NOT IN ('DRAFT','CANCELLED')
      AND a.start_date <= r.target_effective_date
      AND (a.end_date IS NULL OR a.end_date >= r.target_effective_date)
      AND (r.country_code IS NULL OR pr.country_code = r.country_code)
      AND (r.scope_product_id IS NULL OR a.bn_product_id = r.scope_product_id)
      AND (r.scope_award_type_code IS NULL OR a.award_type = r.scope_award_type_code)
      AND (r.scope_payment_frequency IS NULL OR a.frequency = r.scope_payment_frequency);

    -- Exceptions (fail closed): derived from the frozen snapshot only.
    INSERT INTO public.bn_uprating_run_exception(run_id, snapshot_id, snapshot_item_id, award_reference,
      exception_code, severity, is_blocking, owning_domain, business_explanation, source_reference, correlation_id)
    SELECT r.run_id, v_snapshot_id, i.snapshot_item_id, i.award_reference, e.code,
      ep.default_severity, ep.is_blocking, ep.owning_domain, ep.business_explanation, NULL, p_correlation_id
    FROM public.bn_uprating_run_snapshot_item i
    CROSS JOIN LATERAL (
      SELECT unnest(ARRAY_REMOVE(ARRAY[
        CASE WHEN i.product_version_id IS NULL THEN 'MISSING_PRODUCT_VERSION' END,
        CASE WHEN i.base_amount_minor IS NULL OR i.base_amount_minor <= 0 THEN 'INVALID_BASE_AMOUNT' END,
        CASE WHEN COALESCE(i.payment_frequency,'') = '' THEN 'MISSING_PAYMENT_PROFILE' END,
        CASE WHEN r.scope_payment_frequency IS NOT NULL AND i.payment_frequency IS NOT NULL
                  AND i.payment_frequency <> r.scope_payment_frequency THEN 'UNSUPPORTED_FREQUENCY' END,
        CASE WHEN upper(COALESCE(i.award_status,'')) = 'SUSPENDED' THEN 'SUSPENDED_AWARD' END,
        CASE WHEN upper(COALESCE(i.award_status,'')) IN ('TERMINATED','CLOSED','CEASED') THEN 'TERMINATED_AWARD' END,
        CASE WHEN i.exclusion_reason_code = 'PENDING_MORTALITY' THEN 'PENDING_MORTALITY_EVENT' END,
        CASE WHEN i.exclusion_reason_code = 'UNRESOLVED_APPEAL' THEN 'PENDING_APPEAL' END,
        CASE WHEN i.exclusion_reason_code = 'PAYMENT_HELD' THEN 'PAYMENT_HELD' END,
        CASE WHEN i.exclusion_reason_code = 'RISK_INVESTIGATION' THEN 'RISK_OPERATIONAL_RESTRICTION' END
      ], NULL)) AS code
    ) e
    JOIN public.bn_uprating_exception_policy ep ON ep.exception_code = e.code AND ep.is_active
    WHERE i.snapshot_id = v_snapshot_id;

    UPDATE public.bn_uprating_run_snapshot_item i SET exception_status =
      CASE WHEN EXISTS (SELECT 1 FROM public.bn_uprating_run_exception x
                         WHERE x.snapshot_item_id = i.snapshot_item_id AND x.is_blocking
                           AND x.resolution_status='OPEN') THEN 'BLOCKING'
           WHEN EXISTS (SELECT 1 FROM public.bn_uprating_run_exception x
                         WHERE x.snapshot_item_id = i.snapshot_item_id) THEN 'OPEN'
           ELSE 'NONE' END
     WHERE i.snapshot_id = v_snapshot_id;

    SELECT count(*), count(*) FILTER (WHERE eligibility_status='ELIGIBLE' AND exception_status IN ('NONE','RESOLVED')),
           count(*) FILTER (WHERE eligibility_status='EXCLUDED'),
           count(*) FILTER (WHERE exception_status IN ('OPEN','BLOCKING')),
           count(*) FILTER (WHERE exception_status='BLOCKING'),
           COALESCE(sum(base_amount_minor) FILTER (WHERE eligibility_status='ELIGIBLE'),0)
      INTO v_total, v_elig, v_excl, v_exc_items, v_block, v_cur_total
      FROM public.bn_uprating_run_snapshot_item WHERE snapshot_id = v_snapshot_id;

    SELECT md5(string_agg(award_reference || ':' || COALESCE(base_amount_minor,0) || ':' ||
                          COALESCE(source_row_version,0) || ':' || eligibility_status, '|' ORDER BY award_reference))
      INTO v_fp FROM public.bn_uprating_run_snapshot_item WHERE snapshot_id = v_snapshot_id;

    UPDATE public.bn_uprating_run_snapshot SET total_items = v_total, eligible_items = v_elig,
      excluded_items = v_excl, exception_items = v_exc_items, blocking_exception_items = v_block,
      current_total_minor = v_cur_total, snapshot_fingerprint = COALESCE(v_fp, md5('EMPTY'))
     WHERE snapshot_id = v_snapshot_id;

    UPDATE public.bn_uprating_run_snapshot SET superseded_by_snapshot_id = v_snapshot_id
     WHERE run_id = r.run_id AND status='SUPERSEDED' AND superseded_by_snapshot_id IS NULL;

    UPDATE public.bn_uprating_simulation SET status='STALE'
     WHERE run_id = r.run_id AND status='CURRENT';

    UPDATE public.bn_uprating_run SET status = CASE WHEN v_exc_items > 0 OR v_excl > 0
                                                    THEN 'EXCLUSIONS_APPLIED' ELSE 'ELIGIBILITY_SNAPSHOT' END,
      current_snapshot_id = v_snapshot_id, current_snapshot_version = v_snap_ver,
      simulation_state = CASE WHEN current_simulation_id IS NULL THEN 'NONE' ELSE 'STALE' END,
      row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    v_new := r.status;

    PERFORM public._bn_uprating_run_event(r.run_id,'SNAPSHOT_TAKEN','Population snapshot taken',
      'Snapshot v' || v_snap_ver || ': ' || v_total || ' award(s), ' || v_elig || ' eligible, ' ||
      v_excl || ' excluded.', v_prev, v_new, p_actor_user_id, p_correlation_id);
    IF v_exc_items > 0 THEN
      PERFORM public._bn_uprating_run_event(r.run_id,'EXCLUSIONS_APPLIED','Exceptions detected',
        v_exc_items || ' exception(s) recorded, ' || v_block || ' blocking.', v_prev, v_new,
        p_actor_user_id, p_correlation_id);
    END IF;

    v_result := jsonb_build_object('status','OK','code',NULL,'message','Population snapshot taken.','data',
      jsonb_build_object('run_id', r.run_id,'snapshot_id', v_snapshot_id,'snapshot_version', v_snap_ver,
        'total_items', v_total,'eligible_items', v_elig,'excluded_items', v_excl,
        'exception_items', v_exc_items,'blocking_exception_items', v_block,'status', r.status));

  -- ============ RESOLVE EXCEPTION ============
  ELSIF p_command_name = 'BN_UPRATING_RESOLVE_EXCEPTION' THEN
    IF v_exc.exception_id IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_REQUIRED','message','An exception must be selected.','data',NULL);
    END IF;
    IF v_exc.resolution_status = 'RESOLVED' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','That exception has already been resolved.','data',NULL);
    END IF;
    IF v_exc.snapshot_id <> COALESCE(r.current_snapshot_id, v_exc.snapshot_id) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_SNAPSHOT_SUPERSEDED',
        'message','That exception belongs to a superseded snapshot. Rebuild the population and review again.','data',NULL);
    END IF;
    v_res := upper(NULLIF(btrim(COALESCE(p_payload->>'resolution_code','')),''));
    v_just := NULLIF(btrim(COALESCE(p_payload->>'justification','')),'');
    IF v_res IS NULL OR v_just IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_JUSTIFICATION_REQUIRED',
        'message','A resolution and a justification are required.','data',NULL);
    END IF;
    SELECT * INTO v_pol FROM public.bn_uprating_exception_policy WHERE exception_code = v_exc.exception_code;
    IF NOT (v_res = ANY (v_pol.allowed_resolutions)) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_RESOLUTION_NOT_PERMITTED',
        'message','That resolution is not permitted for this exception type.','data',
        jsonb_build_object('allowed_resolutions', to_jsonb(v_pol.allowed_resolutions)));
    END IF;

    UPDATE public.bn_uprating_run_exception SET resolution_status='RESOLVED', resolution_code = v_res,
      resolution_label = public._bn_uprating_ref_label('EXCEPTION_RESOLUTION', v_res),
      resolution_reason = NULLIF(p_payload->>'reason_code',''), justification = v_just,
      resolved_by = p_actor_user_id, resolved_by_name = v_actor_name, resolved_at = now(),
      row_version = row_version + 1
     WHERE exception_id = v_exc.exception_id RETURNING * INTO v_exc;

    SELECT COALESCE(max(sequence_no),0)+1 INTO v_seq FROM public.bn_uprating_run_exception_history
     WHERE exception_id = v_exc.exception_id;
    INSERT INTO public.bn_uprating_run_exception_history(exception_id, sequence_no, action_code,
      resolution_code, justification, actor_user_id, actor_name, correlation_id)
    VALUES (v_exc.exception_id, v_seq,'RESOLVED', v_res, v_just, p_actor_user_id, v_actor_name, p_correlation_id);

    UPDATE public.bn_uprating_run_snapshot_item SET
      eligibility_status = CASE WHEN v_res IN ('EXCLUDE','DEFER') THEN
                                 CASE WHEN v_res='DEFER' THEN 'DEFERRED' ELSE 'EXCLUDED' END
                                ELSE eligibility_status END,
      exclusion_reason_code = CASE WHEN v_res = 'EXCLUDE' THEN COALESCE(exclusion_reason_code,'MANUAL_EXCLUSION')
                                   ELSE exclusion_reason_code END,
      exception_status = CASE
        WHEN EXISTS (SELECT 1 FROM public.bn_uprating_run_exception x
                      WHERE x.snapshot_item_id = bn_uprating_run_snapshot_item.snapshot_item_id
                        AND x.is_blocking AND x.resolution_status='OPEN') THEN 'BLOCKING'
        WHEN EXISTS (SELECT 1 FROM public.bn_uprating_run_exception x
                      WHERE x.snapshot_item_id = bn_uprating_run_snapshot_item.snapshot_item_id
                        AND x.resolution_status='OPEN') THEN 'OPEN'
        ELSE 'RESOLVED' END
     WHERE snapshot_item_id = v_exc.snapshot_item_id;

    SELECT count(*) FILTER (WHERE resolution_status='OPEN'),
           count(*) FILTER (WHERE resolution_status='OPEN' AND is_blocking)
      INTO v_exc_items, v_block
      FROM public.bn_uprating_run_exception WHERE snapshot_id = v_exc.snapshot_id;
    UPDATE public.bn_uprating_run_snapshot s SET
      exception_items = v_exc_items, blocking_exception_items = v_block,
      eligible_items = (SELECT count(*) FROM public.bn_uprating_run_snapshot_item i
                         WHERE i.snapshot_id = s.snapshot_id AND i.eligibility_status='ELIGIBLE'
                           AND i.exception_status IN ('NONE','RESOLVED')),
      excluded_items = (SELECT count(*) FROM public.bn_uprating_run_snapshot_item i
                         WHERE i.snapshot_id = s.snapshot_id AND i.eligibility_status <> 'ELIGIBLE')
     WHERE s.snapshot_id = v_exc.snapshot_id;

    UPDATE public.bn_uprating_simulation SET status='STALE' WHERE run_id = r.run_id AND status='CURRENT';
    UPDATE public.bn_uprating_run SET
      simulation_state = CASE WHEN current_simulation_id IS NULL THEN 'NONE' ELSE 'STALE' END,
      row_version = row_version + 1, updated_at = now() WHERE run_id = r.run_id RETURNING * INTO r;
    v_new := r.status;

    PERFORM public._bn_uprating_run_event(r.run_id,'EXCEPTION_RESOLVED','Exception resolved',
      v_exc.exception_code || ' on ' || v_exc.award_reference || ' resolved as ' || v_res,
      v_prev, v_new, p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Exception resolved.','data',
      jsonb_build_object('exception_id', v_exc.exception_id,'resolution_code', v_res,
        'open_exceptions', v_exc_items,'blocking_exceptions', v_block));

  -- ============ SIMULATE ============
  ELSIF p_command_name = 'BN_UPRATING_SIMULATE' THEN
    IF r.current_snapshot_id IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NO_POPULATION',
        'message','Build the population snapshot before simulating.','data',NULL);
    END IF;
    IF r.frozen_policy_type IN ('FORMULA_DRIVEN','MANUAL_IMPORT') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_SIMULATABLE',
        'message','This policy method cannot be simulated automatically in this release.','data',NULL);
    END IF;
    SELECT count(*) INTO v_open FROM public.bn_uprating_run_exception
     WHERE snapshot_id = r.current_snapshot_id AND resolution_status='OPEN' AND is_blocking;
    IF v_open > 0 AND NOT COALESCE((p_payload->>'allow_open_exceptions')::boolean,false) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_BLOCKING_EXCEPTIONS',
        'message','Resolve all blocking exceptions before simulating.','data',
        jsonb_build_object('blocking_exceptions', v_open));
    END IF;

    SELECT snapshot_fingerprint INTO v_fp FROM public.bn_uprating_run_snapshot WHERE snapshot_id = r.current_snapshot_id;
    v_fp := md5(COALESCE(v_fp,'') || '|' || r.policy_version_id::text || '|' || COALESCE(r.frozen_policy_type,'') || '|' ||
                COALESCE(r.frozen_rounding_mode,'') || '|' || COALESCE(r.frozen_percentage_bp,0)::text || '|' ||
                COALESCE(r.frozen_fixed_amount_minor,0)::text || '|' || COALESCE(r.frozen_index_value,0)::text || '|' ||
                COALESCE(r.frozen_index_base_value,0)::text || '|' || COALESCE(r.frozen_tiers::text,'[]') || '|' ||
                r.target_effective_date::text);

    UPDATE public.bn_uprating_simulation SET status='SUPERSEDED', superseded_at = now()
     WHERE run_id = r.run_id AND status IN ('CURRENT','STALE');
    SELECT COALESCE(max(simulation_version),0)+1 INTO v_sim_ver FROM public.bn_uprating_simulation WHERE run_id = r.run_id;

    INSERT INTO public.bn_uprating_simulation(run_id, simulation_version, snapshot_id, policy_version_id,
      input_fingerprint, policy_type, rounding_mode, provenance, simulated_by, simulated_by_name, correlation_id)
    VALUES (r.run_id, v_sim_ver, r.current_snapshot_id, r.policy_version_id, v_fp,
      r.frozen_policy_type, r.frozen_rounding_mode,
      jsonb_build_object('percentage_bp', r.frozen_percentage_bp,'fixed_amount_minor', r.frozen_fixed_amount_minor,
        'index_value', r.frozen_index_value,'index_base_value', r.frozen_index_base_value,
        'tiers', r.frozen_tiers,'target_effective_date', r.target_effective_date),
      p_actor_user_id, v_actor_name, p_correlation_id)
    RETURNING simulation_id INTO v_sim_id;

    INSERT INTO public.bn_uprating_simulation_item(simulation_id, run_id, snapshot_item_id, award_reference,
      award_component_code, base_amount_minor, policy_method, unrounded_amount_minor, rounding_mode,
      proposed_amount_minor, delta_amount_minor, applied_percentage_bp, applied_fixed_amount_minor,
      applied_factor, matched_tier_sequence, calculation_status, exception_status, calculation_trace, input_fingerprint)
    SELECT v_sim_id, r.run_id, i.snapshot_item_id, i.award_reference, i.award_component_code,
      COALESCE(i.base_amount_minor,0), COALESCE(c.calc->>'method', r.frozen_policy_type),
      COALESCE((c.calc->>'unrounded_minor')::numeric, 0), r.frozen_rounding_mode,
      COALESCE((c.calc->>'proposed_minor')::bigint, COALESCE(i.base_amount_minor,0)),
      COALESCE((c.calc->>'delta_minor')::bigint, 0),
      NULLIF(c.calc->>'percentage_bp','')::int, NULLIF(c.calc->>'fixed_amount_minor','')::bigint,
      NULLIF(c.calc->>'factor','')::numeric, NULLIF(c.calc->>'tier_sequence','')::int,
      CASE WHEN c.calc->>'status' = 'CALCULATED' THEN 'CALCULATED' ELSE 'FAILED' END,
      i.exception_status,
      COALESCE(c.calc->'trace', jsonb_build_array(jsonb_build_object('step','FAILED','reason', c.calc->>'reason'))),
      v_fp
    FROM public.bn_uprating_run_snapshot_item i
    CROSS JOIN LATERAL (SELECT public._bn_uprating_calc_item(r.run_id, i.base_amount_minor) AS calc) c
    WHERE i.snapshot_id = r.current_snapshot_id
      AND i.eligibility_status = 'ELIGIBLE'
      AND i.exception_status IN ('NONE','RESOLVED');

    SELECT count(*), count(*) FILTER (WHERE calculation_status='FAILED'),
           count(*) FILTER (WHERE delta_amount_minor > 0), count(*) FILTER (WHERE delta_amount_minor = 0),
           count(*) FILTER (WHERE delta_amount_minor < 0),
           COALESCE(sum(base_amount_minor),0), COALESCE(sum(proposed_amount_minor),0)
      INTO v_total, v_fail, v_elig, v_excl, v_block, v_cur_total, v_prop_total
      FROM public.bn_uprating_simulation_item WHERE simulation_id = v_sim_id;

    UPDATE public.bn_uprating_simulation SET simulated_items = v_total, failed_items = v_fail,
      increase_count = v_elig, no_change_count = v_excl, decrease_count = v_block,
      current_total_minor = v_cur_total, proposed_total_minor = v_prop_total,
      delta_total_minor = v_prop_total - v_cur_total,
      exception_total = (SELECT count(*) FROM public.bn_uprating_run_exception
                          WHERE snapshot_id = r.current_snapshot_id AND resolution_status='OPEN')
     WHERE simulation_id = v_sim_id;

    UPDATE public.bn_uprating_run SET status='DRY_RUN', current_simulation_id = v_sim_id,
      current_simulation_version = v_sim_ver, simulation_state='CURRENT', input_fingerprint = v_fp,
      row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;
    v_new := 'DRY_RUN';

    PERFORM public._bn_uprating_run_event(r.run_id,'DRY_RUN_COMPLETED','Simulation completed',
      'Simulation v' || v_sim_ver || ': ' || v_total || ' award(s) calculated, ' || v_fail || ' failed.',
      v_prev, v_new, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status','OK','code',NULL,'message','Simulation completed.','data',
      jsonb_build_object('run_id', r.run_id,'simulation_id', v_sim_id,'simulation_version', v_sim_ver,
        'simulated_items', v_total,'failed_items', v_fail,'input_fingerprint', v_fp,
        'current_total_minor', v_cur_total,'proposed_total_minor', v_prop_total,
        'delta_total_minor', v_prop_total - v_cur_total,'status','DRY_RUN'));
  END IF;

  INSERT INTO public.bn_uprating_command_audit(command_name, run_id, policy_id, policy_version_id,
    previous_status, new_status, actor_user_id, actor_name, reason_code, justification,
    payload, result_status, correlation_id, idempotency_key)
  VALUES (p_command_name, p_run_id, r.policy_id, r.policy_version_id, v_prev, v_new,
    p_actor_user_id, v_actor_name, NULLIF(p_payload->>'reason_code',''),
    NULLIF(p_payload->>'justification',''), p_payload, v_result->>'status', p_correlation_id, p_idempotency_key);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_uprating_command_idempotency(idempotency_key, command_name, payload_hash,
      result_json, actor_user_id, correlation_id)
    VALUES (p_idempotency_key, p_command_name, md5(COALESCE(p_payload::text,'')), v_result,
      p_actor_user_id, p_correlation_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END; $fn$;

REVOKE ALL ON FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid) TO authenticated, service_role;
