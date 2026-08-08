
CREATE OR REPLACE FUNCTION public._bn_uprating_apply_version_payload(
  p_version_id uuid, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE t jsonb; i int := 0;
BEGIN
  UPDATE public.bn_uprating_policy_version v SET
    version_reference = COALESCE(NULLIF(p_payload->>'version_reference',''), v.version_reference),
    effective_from = COALESCE((p_payload->>'effective_from')::date, v.effective_from),
    effective_to = CASE WHEN p_payload ? 'effective_to'
                        THEN NULLIF(p_payload->>'effective_to','')::date ELSE v.effective_to END,
    rounding_mode = COALESCE(NULLIF(p_payload->>'rounding_mode',''), v.rounding_mode),
    percentage_bp = CASE WHEN p_payload ? 'percentage_bp' THEN NULLIF(p_payload->>'percentage_bp','')::int ELSE v.percentage_bp END,
    fixed_amount_minor = CASE WHEN p_payload ? 'fixed_amount_minor' THEN NULLIF(p_payload->>'fixed_amount_minor','')::bigint ELSE v.fixed_amount_minor END,
    currency_code = CASE WHEN p_payload ? 'currency_code' THEN NULLIF(p_payload->>'currency_code','') ELSE v.currency_code END,
    index_series_id = CASE WHEN p_payload ? 'index_series_id' THEN NULLIF(p_payload->>'index_series_id','')::uuid ELSE v.index_series_id END,
    index_reference_period = CASE WHEN p_payload ? 'index_reference_period' THEN NULLIF(p_payload->>'index_reference_period','') ELSE v.index_reference_period END,
    index_base_period = CASE WHEN p_payload ? 'index_base_period' THEN NULLIF(p_payload->>'index_base_period','') ELSE v.index_base_period END,
    formula_template_id = CASE WHEN p_payload ? 'formula_template_id' THEN NULLIF(p_payload->>'formula_template_id','')::uuid ELSE v.formula_template_id END,
    formula_version_id = CASE WHEN p_payload ? 'formula_version_id' THEN NULLIF(p_payload->>'formula_version_id','')::uuid ELSE v.formula_version_id END,
    manual_source_code = CASE WHEN p_payload ? 'manual_source_code' THEN NULLIF(p_payload->>'manual_source_code','') ELSE v.manual_source_code END,
    manual_source_description = CASE WHEN p_payload ? 'manual_source_description' THEN NULLIF(p_payload->>'manual_source_description','') ELSE v.manual_source_description END,
    country_code = CASE WHEN p_payload ? 'country_code' THEN NULLIF(p_payload->>'country_code','') ELSE v.country_code END,
    product_id = CASE WHEN p_payload ? 'product_id' THEN NULLIF(p_payload->>'product_id','')::uuid ELSE v.product_id END,
    product_version_id = CASE WHEN p_payload ? 'product_version_id' THEN NULLIF(p_payload->>'product_version_id','')::uuid ELSE v.product_version_id END,
    award_type_code = CASE WHEN p_payload ? 'award_type_code' THEN NULLIF(p_payload->>'award_type_code','') ELSE v.award_type_code END,
    award_component_code = CASE WHEN p_payload ? 'award_component_code' THEN NULLIF(p_payload->>'award_component_code','') ELSE v.award_component_code END,
    payment_frequency = CASE WHEN p_payload ? 'payment_frequency' THEN NULLIF(p_payload->>'payment_frequency','') ELSE v.payment_frequency END,
    legal_reference_id = CASE WHEN p_payload ? 'legal_reference_id' THEN NULLIF(p_payload->>'legal_reference_id','')::uuid ELSE v.legal_reference_id END,
    source_reference = CASE WHEN p_payload ? 'source_reference' THEN NULLIF(p_payload->>'source_reference','') ELSE v.source_reference END,
    validation_status = 'NOT_VALIDATED',
    validation_errors = '[]'::jsonb,
    validation_warnings = '[]'::jsonb,
    validated_at = NULL, validated_by = NULL, validated_by_name = NULL,
    updated_at = now()
  WHERE v.policy_version_id = p_version_id;

  IF p_payload ? 'tiers' THEN
    DELETE FROM public.bn_uprating_policy_tier WHERE policy_version_id = p_version_id;
    FOR t IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'tiers','[]'::jsonb)) LOOP
      i := i + 1;
      INSERT INTO public.bn_uprating_policy_tier(policy_version_id, sequence_no,
        lower_bound_minor, upper_bound_minor, percentage_bp, fixed_amount_minor)
      VALUES (p_version_id, COALESCE(NULLIF(t->>'sequence_no','')::int, i),
        COALESCE(NULLIF(t->>'lower_bound_minor','')::bigint, 0),
        NULLIF(t->>'upper_bound_minor','')::bigint,
        NULLIF(t->>'percentage_bp','')::int,
        NULLIF(t->>'fixed_amount_minor','')::bigint);
    END LOOP;
  END IF;
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_policy_command_v1(
  p_command_name text,
  p_actor_user_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_policy_id uuid DEFAULT NULL,
  p_policy_version_id uuid DEFAULT NULL,
  p_expected_row_version integer DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_cached jsonb; v_result jsonb; v_capability text; v_mutation boolean := true;
  v_policy public.bn_uprating_policy%ROWTYPE;
  v_ver public.bn_uprating_policy_version%ROWTYPE;
  v_prev_status text; v_new_status text; v_next int; v_val jsonb;
  v_decision text; v_reason text; v_just text; v_actor_name text;
  v_new_id uuid; v_seq int;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNAUTHENTICATED','message','You must be signed in as the acting user.','data',NULL);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_cached FROM public.bn_uprating_command_idempotency
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_set(v_cached, '{status}', to_jsonb('REPLAYED'::text));
    END IF;
  END IF;

  v_capability := CASE p_command_name
    WHEN 'BN_UPRATING_CREATE_POLICY' THEN 'write'
    WHEN 'BN_UPRATING_CREATE_POLICY_VERSION' THEN 'write'
    WHEN 'BN_UPRATING_UPDATE_POLICY_VERSION' THEN 'write'
    WHEN 'BN_UPRATING_VALIDATE_POLICY' THEN 'write'
    WHEN 'BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL' THEN 'write'
    WHEN 'BN_UPRATING_APPROVE_POLICY' THEN 'admin'
    WHEN 'BN_UPRATING_ACTIVATE_POLICY_VERSION' THEN 'admin'
    WHEN 'BN_UPRATING_SUPERSEDE_POLICY_VERSION' THEN 'admin'
    WHEN 'BN_UPRATING_RETIRE_POLICY_VERSION' THEN 'admin'
    ELSE NULL END;

  IF v_capability IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNKNOWN_COMMAND','message','That command is not available in this module.','data',NULL);
  END IF;

  BEGIN
    PERFORM public._bn_uprating_require(p_actor_user_id, v_capability, v_mutation);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','ERROR','code','E_PERMISSION','message','You do not have permission to perform this action.','data',NULL);
  END;

  v_actor_name := public._bn_uprating_actor_name(p_actor_user_id);

  IF p_policy_version_id IS NOT NULL THEN
    SELECT * INTO v_ver FROM public.bn_uprating_policy_version
     WHERE policy_version_id = p_policy_version_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That policy version could not be found.','data',NULL);
    END IF;
    v_prev_status := v_ver.status;
    IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_ver.row_version THEN
      RETURN jsonb_build_object('status','ERROR','code','E_STALE_ROW_VERSION',
        'message','This version was changed by someone else. Reload and try again.','data',
        jsonb_build_object('current_row_version', v_ver.row_version));
    END IF;
    SELECT * INTO v_policy FROM public.bn_uprating_policy WHERE policy_id = v_ver.policy_id;
  ELSIF p_policy_id IS NOT NULL THEN
    SELECT * INTO v_policy FROM public.bn_uprating_policy WHERE policy_id = p_policy_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That policy could not be found.','data',NULL);
    END IF;
  END IF;

  IF p_command_name = 'BN_UPRATING_CREATE_POLICY' THEN
    IF NULLIF(btrim(COALESCE(p_payload->>'policy_code','')),'') IS NULL
       OR NULLIF(btrim(COALESCE(p_payload->>'policy_name','')),'') IS NULL
       OR NULLIF(btrim(COALESCE(p_payload->>'policy_type','')),'') IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_VALIDATION','message','A policy code, name and type are required.','data',NULL);
    END IF;
    IF EXISTS (SELECT 1 FROM public.bn_uprating_policy WHERE policy_code = upper(btrim(p_payload->>'policy_code'))) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_DUPLICATE_CODE','message','That policy code is already in use.','data',NULL);
    END IF;
    INSERT INTO public.bn_uprating_policy(policy_code, policy_name, description, country_code,
      product_id, award_component_code, policy_type, owner_user_id, owner_name,
      created_by, created_by_name)
    VALUES (upper(btrim(p_payload->>'policy_code')), btrim(p_payload->>'policy_name'),
      NULLIF(p_payload->>'description',''), NULLIF(p_payload->>'country_code',''),
      NULLIF(p_payload->>'product_id','')::uuid, NULLIF(p_payload->>'award_component_code',''),
      p_payload->>'policy_type', COALESCE(NULLIF(p_payload->>'owner_user_id','')::uuid, p_actor_user_id),
      COALESCE(NULLIF(p_payload->>'owner_name',''), v_actor_name), p_actor_user_id, v_actor_name)
    RETURNING * INTO v_policy;
    PERFORM public._bn_uprating_event(v_policy.policy_id, NULL,'POLICY_CREATED','Policy created',
      v_policy.policy_code, NULL, 'ACTIVE', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Policy created.','data',
      jsonb_build_object('policy_id', v_policy.policy_id, 'policy_code', v_policy.policy_code));

  ELSIF p_command_name = 'BN_UPRATING_CREATE_POLICY_VERSION' THEN
    IF v_policy.policy_id IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_REQUIRED','message','A policy must be selected.','data',NULL);
    END IF;
    IF EXISTS (SELECT 1 FROM public.bn_uprating_policy_version
                WHERE policy_id = v_policy.policy_id AND status IN ('DRAFT','REVIEW')) THEN
      RETURN jsonb_build_object('status','ERROR','code','E_OPEN_VERSION_EXISTS',
        'message','This policy already has a version in progress. Complete or retire it first.','data',NULL);
    END IF;
    SELECT COALESCE(max(version_no),0)+1 INTO v_next FROM public.bn_uprating_policy_version WHERE policy_id = v_policy.policy_id;
    INSERT INTO public.bn_uprating_policy_version(policy_id, version_no, version_reference, status,
      policy_type, country_code, product_id, award_component_code, created_by, created_by_name)
    VALUES (v_policy.policy_id, v_next,
      COALESCE(NULLIF(p_payload->>'version_reference',''), v_policy.policy_code || '-V' || v_next),
      'DRAFT', v_policy.policy_type, v_policy.country_code, v_policy.product_id,
      v_policy.award_component_code, p_actor_user_id, v_actor_name)
    RETURNING policy_version_id INTO v_new_id;
    PERFORM public._bn_uprating_apply_version_payload(v_new_id, p_payload);
    PERFORM public._bn_uprating_event(v_policy.policy_id, v_new_id,'VERSION_CREATED',
      'Version ' || v_next || ' created', NULL, NULL, 'DRAFT', p_actor_user_id, p_correlation_id);
    p_policy_version_id := v_new_id; v_new_status := 'DRAFT';
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Draft version created.','data',
      jsonb_build_object('policy_version_id', v_new_id, 'version_no', v_next));

  ELSIF p_command_name = 'BN_UPRATING_UPDATE_POLICY_VERSION' THEN
    IF v_ver.status <> 'DRAFT' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_IMMUTABLE_VERSION',
        'message','Only a draft version can be edited.','data',NULL);
    END IF;
    PERFORM public._bn_uprating_apply_version_payload(v_ver.policy_version_id, p_payload);
    UPDATE public.bn_uprating_policy_version SET row_version = row_version + 1
     WHERE policy_version_id = v_ver.policy_version_id;
    PERFORM public._bn_uprating_event(v_ver.policy_id, v_ver.policy_version_id,'VERSION_UPDATED',
      'Draft configuration updated', NULL,'DRAFT','DRAFT', p_actor_user_id, p_correlation_id);
    v_new_status := 'DRAFT';
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Draft updated.','data',
      jsonb_build_object('policy_version_id', v_ver.policy_version_id));

  ELSIF p_command_name = 'BN_UPRATING_VALIDATE_POLICY' THEN
    IF v_ver.status <> 'DRAFT' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only a draft version can be validated.','data',NULL);
    END IF;
    v_val := public._bn_uprating_validate_version(v_ver.policy_version_id);
    v_new_status := v_ver.status;
    SELECT COALESCE(max(attempt_no),0)+1 INTO v_seq FROM public.bn_uprating_policy_validation
     WHERE policy_version_id = v_ver.policy_version_id;
    INSERT INTO public.bn_uprating_policy_validation(policy_version_id, attempt_no, validation_status,
      errors, warnings, validated_by, validated_by_name, correlation_id)
    VALUES (v_ver.policy_version_id, v_seq,
      CASE WHEN jsonb_array_length(v_val->'errors') = 0 THEN 'VALID' ELSE 'INVALID' END,
      v_val->'errors', v_val->'warnings', p_actor_user_id, v_actor_name, p_correlation_id);
    UPDATE public.bn_uprating_policy_version SET
      validation_status = CASE WHEN jsonb_array_length(v_val->'errors') = 0 THEN 'VALID' ELSE 'INVALID' END,
      validation_errors = v_val->'errors', validation_warnings = v_val->'warnings',
      validated_at = now(), validated_by = p_actor_user_id, validated_by_name = v_actor_name,
      row_version = row_version + 1, updated_at = now()
     WHERE policy_version_id = v_ver.policy_version_id;
    PERFORM public._bn_uprating_event(v_ver.policy_id, v_ver.policy_version_id,'VERSION_VALIDATED',
      'Validation attempt ' || v_seq,
      CASE WHEN jsonb_array_length(v_val->'errors') = 0 THEN 'Valid' ELSE 'Invalid' END,
      'DRAFT','DRAFT', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,
      'message', CASE WHEN jsonb_array_length(v_val->'errors') = 0
                      THEN 'Validation passed.' ELSE 'Validation found issues that must be corrected.' END,
      'data', jsonb_build_object('policy_version_id', v_ver.policy_version_id,
        'validation_status', CASE WHEN jsonb_array_length(v_val->'errors') = 0 THEN 'VALID' ELSE 'INVALID' END,
        'errors', v_val->'errors', 'warnings', v_val->'warnings'));

  ELSIF p_command_name = 'BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL' THEN
    IF v_ver.status <> 'DRAFT' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only a draft version can be submitted.','data',NULL);
    END IF;
    v_val := public._bn_uprating_validate_version(v_ver.policy_version_id);
    IF jsonb_array_length(v_val->'errors') > 0 THEN
      UPDATE public.bn_uprating_policy_version SET validation_status='INVALID',
        validation_errors = v_val->'errors', validation_warnings = v_val->'warnings', updated_at = now()
       WHERE policy_version_id = v_ver.policy_version_id;
      RETURN jsonb_build_object('status','ERROR','code','E_NOT_VALIDATED',
        'message','This version cannot be submitted until validation passes.','data', v_val);
    END IF;
    UPDATE public.bn_uprating_policy_version SET status='REVIEW', submitted_by = p_actor_user_id,
      submitted_by_name = v_actor_name, submitted_at = now(), validation_status='VALID',
      validation_errors = v_val->'errors', validation_warnings = v_val->'warnings',
      row_version = row_version + 1, updated_at = now()
     WHERE policy_version_id = v_ver.policy_version_id;
    v_new_status := 'REVIEW';
    PERFORM public._bn_uprating_event(v_ver.policy_id, v_ver.policy_version_id,'VERSION_SUBMITTED',
      'Submitted for independent approval', NULL,'DRAFT','REVIEW', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Submitted for approval.','data',
      jsonb_build_object('policy_version_id', v_ver.policy_version_id,'status','REVIEW'));

  ELSIF p_command_name = 'BN_UPRATING_APPROVE_POLICY' THEN
    v_decision := upper(COALESCE(p_payload->>'decision',''));
    v_reason := NULLIF(p_payload->>'reason_code','');
    v_just := NULLIF(btrim(COALESCE(p_payload->>'justification','')),'');
    IF v_decision NOT IN ('APPROVE','RETURN_TO_DRAFT','REJECT') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_VALIDATION','message','A valid decision is required.','data',NULL);
    END IF;
    IF v_ver.status <> 'REVIEW' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only a version awaiting approval can be decided.','data',NULL);
    END IF;
    IF v_ver.created_by = p_actor_user_id OR v_ver.submitted_by = p_actor_user_id THEN
      RETURN jsonb_build_object('status','ERROR','code','E_SELF_APPROVAL',
        'message','The author or submitter of a version cannot decide it.','data',NULL);
    END IF;
    IF v_just IS NULL OR v_reason IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_JUSTIFICATION_REQUIRED',
        'message','A reason and justification are required for every decision.','data',NULL);
    END IF;
    v_new_status := CASE v_decision WHEN 'APPROVE' THEN 'APPROVED'
                                    WHEN 'RETURN_TO_DRAFT' THEN 'DRAFT' ELSE 'RETIRED' END;
    SELECT COALESCE(max(sequence_no),0)+1 INTO v_seq FROM public.bn_uprating_policy_approval
     WHERE policy_version_id = v_ver.policy_version_id;
    INSERT INTO public.bn_uprating_policy_approval(policy_version_id, sequence_no, decision,
      reason_code, reason_label, justification, decided_by, decided_by_name,
      submitted_by, submitted_at, correlation_id)
    VALUES (v_ver.policy_version_id, v_seq, v_decision, v_reason,
      COALESCE(public._bn_uprating_ref_label('APPROVAL_REASON', v_reason),
               public._bn_uprating_ref_label('RETURN_REASON', v_reason)),
      v_just, p_actor_user_id, v_actor_name, v_ver.submitted_by, v_ver.submitted_at, p_correlation_id);
    UPDATE public.bn_uprating_policy_version SET status = v_new_status,
      approval_decision = v_decision, approved_by = p_actor_user_id, approved_by_name = v_actor_name,
      approved_at = now(), decision_reason_code = v_reason, decision_justification = v_just,
      retired_at = CASE WHEN v_new_status='RETIRED' THEN now() ELSE retired_at END,
      row_version = row_version + 1, updated_at = now()
     WHERE policy_version_id = v_ver.policy_version_id;
    PERFORM public._bn_uprating_event(v_ver.policy_id, v_ver.policy_version_id,'VERSION_DECISION',
      'Decision recorded: ' || v_decision, v_just, 'REVIEW', v_new_status, p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Decision recorded.','data',
      jsonb_build_object('policy_version_id', v_ver.policy_version_id,'status', v_new_status,'decision', v_decision));

  ELSIF p_command_name = 'BN_UPRATING_ACTIVATE_POLICY_VERSION' THEN
    IF v_ver.status <> 'APPROVED' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only an approved version can be activated.','data',NULL);
    END IF;
    UPDATE public.bn_uprating_policy_version SET status='SUPERSEDED', superseded_at = now(),
      superseded_by_version_id = v_ver.policy_version_id, row_version = row_version + 1, updated_at = now()
     WHERE policy_id = v_ver.policy_id AND status = 'ACTIVE'
       AND COALESCE(country_code,'*') = COALESCE(v_ver.country_code,'*')
       AND COALESCE(award_component_code,'*') = COALESCE(v_ver.award_component_code,'*');
    UPDATE public.bn_uprating_policy_version SET status='ACTIVE', activated_by = p_actor_user_id,
      activated_at = now(), row_version = row_version + 1, updated_at = now()
     WHERE policy_version_id = v_ver.policy_version_id;
    v_new_status := 'ACTIVE';
    PERFORM public._bn_uprating_event(v_ver.policy_id, v_ver.policy_version_id,'VERSION_ACTIVATED',
      'Version activated', NULL,'APPROVED','ACTIVE', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Version activated.','data',
      jsonb_build_object('policy_version_id', v_ver.policy_version_id,'status','ACTIVE'));

  ELSIF p_command_name = 'BN_UPRATING_SUPERSEDE_POLICY_VERSION' THEN
    IF v_ver.status <> 'ACTIVE' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','Only an active version can be superseded.','data',NULL);
    END IF;
    UPDATE public.bn_uprating_policy_version SET status='SUPERSEDED', superseded_at = now(),
      superseded_by_version_id = NULLIF(p_payload->>'superseded_by_version_id','')::uuid,
      row_version = row_version + 1, updated_at = now()
     WHERE policy_version_id = v_ver.policy_version_id;
    v_new_status := 'SUPERSEDED';
    PERFORM public._bn_uprating_event(v_ver.policy_id, v_ver.policy_version_id,'VERSION_SUPERSEDED',
      'Version superseded', NULLIF(p_payload->>'justification',''),'ACTIVE','SUPERSEDED', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Version superseded.','data',
      jsonb_build_object('policy_version_id', v_ver.policy_version_id,'status','SUPERSEDED'));

  ELSIF p_command_name = 'BN_UPRATING_RETIRE_POLICY_VERSION' THEN
    IF v_ver.status = 'RETIRED' THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE','message','That version is already retired.','data',NULL);
    END IF;
    IF NULLIF(btrim(COALESCE(p_payload->>'justification','')),'') IS NULL
       OR NULLIF(p_payload->>'reason_code','') IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_JUSTIFICATION_REQUIRED',
        'message','A reason and justification are required to retire a version.','data',NULL);
    END IF;
    UPDATE public.bn_uprating_policy_version SET status='RETIRED', retired_at = now(),
      retirement_reason_code = p_payload->>'reason_code',
      decision_justification = p_payload->>'justification',
      row_version = row_version + 1, updated_at = now()
     WHERE policy_version_id = v_ver.policy_version_id;
    v_new_status := 'RETIRED';
    PERFORM public._bn_uprating_event(v_ver.policy_id, v_ver.policy_version_id,'VERSION_RETIRED',
      'Version retired', p_payload->>'justification', v_prev_status,'RETIRED', p_actor_user_id, p_correlation_id);
    v_result := jsonb_build_object('status','OK','code',NULL,'message','Version retired.','data',
      jsonb_build_object('policy_version_id', v_ver.policy_version_id,'status','RETIRED'));
  END IF;

  INSERT INTO public.bn_uprating_command_audit(command_name, policy_id, policy_version_id,
    previous_status, new_status, actor_user_id, actor_name, reason_code, justification,
    payload, result_status, correlation_id, idempotency_key)
  VALUES (p_command_name, COALESCE(v_policy.policy_id, p_policy_id), p_policy_version_id,
    v_prev_status, v_new_status, p_actor_user_id, v_actor_name,
    NULLIF(p_payload->>'reason_code',''), NULLIF(p_payload->>'justification',''),
    p_payload, v_result->>'status', p_correlation_id, p_idempotency_key);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_uprating_command_idempotency(idempotency_key, command_name,
      payload_hash, result_json, actor_user_id, correlation_id)
    VALUES (p_idempotency_key, p_command_name, md5(COALESCE(p_payload::text,'')), v_result,
      p_actor_user_id, p_correlation_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END; $fn$;

-- ============ reads ============
CREATE OR REPLACE FUNCTION public.bn_uprating_policy_list_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_rows jsonb; v_total int; v_search text; v_status text; v_type text;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  v_search := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  v_status := NULLIF(p_filters->>'version_status','');
  v_type := NULLIF(p_filters->>'policy_type','');

  WITH base AS (
    SELECT p.*,
      (SELECT to_jsonb(x) FROM (
         SELECT v.policy_version_id, v.version_no, v.version_reference, v.status,
                v.effective_from, v.effective_to, v.validation_status
           FROM public.bn_uprating_policy_version v
          WHERE v.policy_id = p.policy_id AND v.status = 'ACTIVE'
          ORDER BY v.effective_from DESC NULLS LAST LIMIT 1) x) AS active_version,
      (SELECT count(*) FROM public.bn_uprating_policy_version v WHERE v.policy_id = p.policy_id) AS version_count,
      (SELECT count(*) FROM public.bn_uprating_policy_version v
        WHERE v.policy_id = p.policy_id AND v.status IN ('DRAFT','REVIEW')) AS open_version_count
      FROM public.bn_uprating_policy p
     WHERE (v_type IS NULL OR p.policy_type = v_type)
       AND (v_search IS NULL OR p.policy_code ILIKE '%'||v_search||'%' OR p.policy_name ILIKE '%'||v_search||'%')
       AND (v_status IS NULL OR EXISTS (
             SELECT 1 FROM public.bn_uprating_policy_version v
              WHERE v.policy_id = p.policy_id AND v.status = v_status))
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.policy_code), '[]'::jsonb), count(*) OVER ()
    INTO v_rows, v_total
    FROM (SELECT * FROM base ORDER BY policy_code LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) b;

  SELECT count(*) INTO v_total FROM public.bn_uprating_policy p
   WHERE (v_type IS NULL OR p.policy_type = v_type)
     AND (v_search IS NULL OR p.policy_code ILIKE '%'||v_search||'%' OR p.policy_name ILIKE '%'||v_search||'%')
     AND (v_status IS NULL OR EXISTS (SELECT 1 FROM public.bn_uprating_policy_version v
            WHERE v.policy_id = p.policy_id AND v.status = v_status));

  RETURN jsonb_build_object('status','OK','code',NULL,'data',
    jsonb_build_object('rows', COALESCE(v_rows,'[]'::jsonb), 'total', COALESCE(v_total,0)));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','ERROR','code','E_PERMISSION','message','You do not have permission to view uprating policies.','data',NULL);
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_policy_detail_v1(
  p_actor_user_id uuid, p_policy_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_policy jsonb; v_versions jsonb; v_events jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT to_jsonb(p) INTO v_policy FROM public.bn_uprating_policy p WHERE p.policy_id = p_policy_id;
  IF v_policy IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That policy could not be found.','data',NULL);
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(v) || jsonb_build_object(
      'tiers', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sequence_no)
                           FROM public.bn_uprating_policy_tier t
                          WHERE t.policy_version_id = v.policy_version_id),'[]'::jsonb),
      'approvals', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.sequence_no)
                           FROM public.bn_uprating_policy_approval a
                          WHERE a.policy_version_id = v.policy_version_id),'[]'::jsonb)
    ) ORDER BY v.version_no DESC), '[]'::jsonb)
    INTO v_versions FROM public.bn_uprating_policy_version v WHERE v.policy_id = p_policy_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at DESC), '[]'::jsonb)
    INTO v_events FROM public.bn_uprating_policy_event e WHERE e.policy_id = p_policy_id;
  RETURN jsonb_build_object('status','OK','code',NULL,'data',
    jsonb_build_object('policy', v_policy, 'versions', v_versions, 'events', v_events));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','ERROR','code','E_PERMISSION','message','You do not have permission to view this policy.','data',NULL);
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_policy_approval_queue_v1(
  p_actor_user_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.submitted_at), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT v.policy_version_id, v.policy_id, v.version_no, v.version_reference, v.status,
             v.effective_from, v.effective_to, v.policy_type, v.submitted_at, v.submitted_by,
             v.submitted_by_name, v.created_by, v.row_version,
             p.policy_code, p.policy_name,
             (v.created_by IS DISTINCT FROM p_actor_user_id
              AND v.submitted_by IS DISTINCT FROM p_actor_user_id) AS can_decide
        FROM public.bn_uprating_policy_version v
        JOIN public.bn_uprating_policy p ON p.policy_id = v.policy_id
       WHERE v.status = 'REVIEW'
       ORDER BY v.submitted_at
       LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) r;
  RETURN jsonb_build_object('status','OK','code',NULL,'data', jsonb_build_object('rows', v_rows));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','ERROR','code','E_PERMISSION','message','You do not have permission to view the approval queue.','data',NULL);
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_reference_data_v1(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ref jsonb; v_series jsonb; v_products jsonb; v_formulas jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT COALESCE(jsonb_object_agg(domain, items), '{}'::jsonb) INTO v_ref FROM (
    SELECT domain, jsonb_agg(jsonb_build_object('code',code,'label',label,'description',description)
             ORDER BY sort_order, label) items
      FROM public.bn_uprating_reference_value WHERE is_active GROUP BY domain) s;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('index_series_id',index_series_id,'series_code',series_code,
           'series_name',series_name,'unit',unit) ORDER BY series_code), '[]'::jsonb)
    INTO v_series FROM public.bn_uprating_index_series WHERE is_active;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name), '[]'::jsonb)
    INTO v_products FROM public.bn_product;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fv.id,'label',
           COALESCE(ft.name,'Formula') || ' v' || COALESCE(fv.version_number::text,'?')) ORDER BY ft.name), '[]'::jsonb)
    INTO v_formulas FROM public.bn_formula_version fv
    LEFT JOIN public.bn_formula_template ft ON ft.id = fv.template_id;
  RETURN jsonb_build_object('status','OK','code',NULL,'data', jsonb_build_object(
    'reference', v_ref, 'index_series', v_series, 'products', v_products, 'formula_versions', v_formulas));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','ERROR','code','E_PERMISSION','message','You do not have permission to view uprating reference data.','data',NULL);
END; $fn$;
