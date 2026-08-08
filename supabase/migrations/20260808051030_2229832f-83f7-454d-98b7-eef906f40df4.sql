
CREATE OR REPLACE FUNCTION public.bn_risk_scoring_configuration_v1(
  p_actor_user_id uuid, p_rule_set_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_admin boolean; v_sets jsonb; v_detail jsonb;
  v_rs public.bn_risk_scoring_rule_set%ROWTYPE;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_admin := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rule_set_id', rs.rule_set_id, 'rule_set_code', rs.rule_set_code,
      'version_no', rs.version_no, 'name', rs.name, 'description', rs.description,
      'status', rs.status,
      'status_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                 WHERE domain='SCORING_CONFIG_STATUS' AND code=rs.status), rs.status),
      'score_scale_min', rs.score_scale_min, 'score_scale_max', rs.score_scale_max,
      'score_scale_label', rs.score_scale_label,
      'effective_from', rs.effective_from, 'effective_to', rs.effective_to,
      'rule_count', (SELECT count(*) FROM public.bn_risk_scoring_rule
                      WHERE rule_set_id=rs.rule_set_id AND is_enabled),
      'band_count', (SELECT count(*) FROM public.bn_risk_scoring_band WHERE rule_set_id=rs.rule_set_id),
      'is_effective', (rs.status='ACTIVE'
                       AND (rs.effective_from IS NULL OR rs.effective_from <= now())
                       AND (rs.effective_to IS NULL OR rs.effective_to > now())),
      'score_count', (SELECT count(*) FROM public.bn_risk_score WHERE rule_set_id=rs.rule_set_id),
      'row_version', rs.row_version,
      'created_at', rs.created_at, 'activated_at', rs.activated_at)
    ORDER BY rs.rule_set_code, rs.version_no DESC), '[]'::jsonb)
    INTO v_sets FROM public.bn_risk_scoring_rule_set rs;

  IF p_rule_set_id IS NOT NULL THEN
    IF NOT v_admin THEN
      RETURN jsonb_build_object('status','DENIED','code','PERMISSION_DENIED','data', NULL);
    END IF;
    SELECT * INTO v_rs FROM public.bn_risk_scoring_rule_set WHERE rule_set_id = p_rule_set_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','NOT_FOUND','code','RULE_SET_NOT_FOUND','data', NULL);
    END IF;
    v_detail := jsonb_build_object(
      'rule_set_id', v_rs.rule_set_id, 'rule_set_code', v_rs.rule_set_code,
      'version_no', v_rs.version_no, 'name', v_rs.name, 'description', v_rs.description,
      'status', v_rs.status, 'score_scale_min', v_rs.score_scale_min,
      'score_scale_max', v_rs.score_scale_max, 'score_scale_label', v_rs.score_scale_label,
      'effective_from', v_rs.effective_from, 'effective_to', v_rs.effective_to,
      'row_version', v_rs.row_version, 'is_editable', v_rs.status IN ('DRAFT','VALIDATED'),
      'validation', public._bn_risk_rule_set_validation(v_rs.rule_set_id),
      'rules', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'rule_id', r.rule_id, 'rule_code', r.rule_code, 'name', r.name,
          'description', r.description, 'factor_type_code', r.factor_type_code,
          'factor_type_label', (SELECT ft.label FROM public.bn_risk_factor_type ft
                                 WHERE ft.factor_type_code = r.factor_type_code),
          'direction_code', r.direction_code, 'operator', r.operator,
          'operator_label', (SELECT label FROM public.bn_risk_reference_value
                              WHERE domain='SCORING_OPERATOR' AND code=r.operator),
          'comparison_numeric', r.comparison_numeric, 'comparison_code', r.comparison_code,
          'requires_usable_evidence', r.requires_usable_evidence,
          'contribution', r.contribution, 'max_contribution', r.max_contribution,
          'explanation_template', r.explanation_template,
          'sort_order', r.sort_order, 'is_enabled', r.is_enabled)
        ORDER BY r.sort_order, r.rule_code)
        FROM public.bn_risk_scoring_rule r WHERE r.rule_set_id = v_rs.rule_set_id), '[]'::jsonb),
      'bands', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'band_id', b.band_id, 'band_code', b.band_code, 'label', b.label,
          'description', b.description, 'min_score', b.min_score, 'max_score', b.max_score,
          'review_priority', b.review_priority, 'sort_order', b.sort_order)
        ORDER BY b.sort_order, b.min_score)
        FROM public.bn_risk_scoring_band b WHERE b.rule_set_id = v_rs.rule_set_id), '[]'::jsonb),
      'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'event_code', e.event_code, 'from_status', e.from_status, 'to_status', e.to_status,
          'justification', e.justification, 'created_at', e.created_at,
          'actor_name', public._bn_risk_actor_name(e.actor_user_id))
        ORDER BY e.created_at DESC)
        FROM public.bn_risk_scoring_rule_set_event e WHERE e.rule_set_id = v_rs.rule_set_id), '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'can_administer', v_admin,
    'rule_sets', v_sets,
    'detail', v_detail,
    'factor_types', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'factor_type_code', ft.factor_type_code, 'label', ft.label,
        'value_kind', ft.value_kind, 'value_domain', ft.value_domain,
        'default_direction_code', ft.default_direction_code)
      ORDER BY ft.sort_order, ft.factor_type_code)
      FROM public.bn_risk_factor_type ft WHERE ft.is_active), '[]'::jsonb),
    'operators', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', rv.code, 'label', rv.label)
      ORDER BY rv.sort_order) FROM public.bn_risk_reference_value rv
      WHERE rv.domain='SCORING_OPERATOR' AND rv.is_active), '[]'::jsonb),
    'directions', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', rv.code, 'label', rv.label)
      ORDER BY rv.sort_order) FROM public.bn_risk_reference_value rv
      WHERE rv.domain='FACTOR_DIRECTION' AND rv.is_active), '[]'::jsonb)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_risk_scoring_config_command_v1(
  p_command_name text, p_rule_set_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_justification text,
  p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload,'{}'::jsonb);
  v_rs public.bn_risk_scoring_rule_set%ROWTYPE; v_new uuid; v_valid jsonb;
  v_result jsonb; v_id uuid; v_status text;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED: no actor'; END IF;
  IF p_command_name NOT IN ('CREATE_RULE_SET_DRAFT','CREATE_NEW_VERSION','UPSERT_RULE',
      'DELETE_RULE','UPSERT_BAND','DELETE_BAND','VALIDATE_RULE_SET','ACTIVATE_RULE_SET',
      'RETIRE_RULE_SET') THEN
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: %', p_command_name;
  END IF;
  PERFORM public._bn_risk_require(p_actor_user_id, 'admin', true);

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

  IF p_command_name = 'CREATE_RULE_SET_DRAFT' THEN
    IF NULLIF(btrim(COALESCE(v_payload->>'rule_set_code','')),'') IS NULL
       OR NULLIF(btrim(COALESCE(v_payload->>'name','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: a code and name are required';
    END IF;
    INSERT INTO public.bn_risk_scoring_rule_set(rule_set_code, version_no, name, description,
      score_scale_min, score_scale_max, score_scale_label, created_by_user_id, correlation_id)
    VALUES (upper(btrim(v_payload->>'rule_set_code')),
      COALESCE((SELECT max(version_no)+1 FROM public.bn_risk_scoring_rule_set
                 WHERE rule_set_code = upper(btrim(v_payload->>'rule_set_code'))), 1),
      btrim(v_payload->>'name'), NULLIF(btrim(COALESCE(v_payload->>'description','')),''),
      COALESCE(NULLIF(v_payload->>'score_scale_min','')::numeric, 0),
      COALESCE(NULLIF(v_payload->>'score_scale_max','')::numeric, 100),
      NULLIF(btrim(COALESCE(v_payload->>'score_scale_label','')),''),
      p_actor_user_id, p_correlation_id)
    RETURNING rule_set_id INTO v_new;
    INSERT INTO public.bn_risk_scoring_rule_set_event(rule_set_id, event_code, command_name,
      to_status, justification, actor_user_id, actor_user_code, correlation_id, entity_version)
    VALUES (v_new,'SCORING_CONFIG_DRAFTED', p_command_name,'DRAFT', p_justification,
      p_actor_user_id, p_actor_user_code, p_correlation_id, 1);
    v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_new,'entity_version',1);

  ELSE
    SELECT * INTO v_rs FROM public.bn_risk_scoring_rule_set
     WHERE rule_set_id = p_rule_set_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: rule set'; END IF;
    IF p_expected_row_version IS NOT NULL AND v_rs.row_version <> p_expected_row_version THEN
      RAISE EXCEPTION 'E_VERSION_CONFLICT: this configuration changed while you were working';
    END IF;

    IF p_command_name IN ('UPSERT_RULE','DELETE_RULE','UPSERT_BAND','DELETE_BAND')
       AND v_rs.status NOT IN ('DRAFT','VALIDATED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE: an active or closed configuration cannot be edited; create a new version';
    END IF;

    IF p_command_name = 'CREATE_NEW_VERSION' THEN
      INSERT INTO public.bn_risk_scoring_rule_set(rule_set_code, version_no, name, description,
        score_scale_min, score_scale_max, score_scale_label, supersedes_rule_set_id,
        created_by_user_id, correlation_id)
      VALUES (v_rs.rule_set_code,
        (SELECT max(version_no)+1 FROM public.bn_risk_scoring_rule_set
          WHERE rule_set_code = v_rs.rule_set_code),
        COALESCE(NULLIF(btrim(COALESCE(v_payload->>'name','')),''), v_rs.name),
        v_rs.description, v_rs.score_scale_min, v_rs.score_scale_max, v_rs.score_scale_label,
        v_rs.rule_set_id, p_actor_user_id, p_correlation_id)
      RETURNING rule_set_id INTO v_new;
      INSERT INTO public.bn_risk_scoring_rule(rule_set_id, rule_code, name, description,
        factor_type_code, direction_code, operator, comparison_numeric, comparison_code,
        requires_usable_evidence, contribution, max_contribution, explanation_template,
        sort_order, is_enabled, created_by_user_id)
      SELECT v_new, rule_code, name, description, factor_type_code, direction_code, operator,
             comparison_numeric, comparison_code, requires_usable_evidence, contribution,
             max_contribution, explanation_template, sort_order, is_enabled, p_actor_user_id
        FROM public.bn_risk_scoring_rule WHERE rule_set_id = v_rs.rule_set_id;
      INSERT INTO public.bn_risk_scoring_band(rule_set_id, band_code, label, description,
        min_score, max_score, review_priority, sort_order)
      SELECT v_new, band_code, label, description, min_score, max_score, review_priority, sort_order
        FROM public.bn_risk_scoring_band WHERE rule_set_id = v_rs.rule_set_id;
      INSERT INTO public.bn_risk_scoring_rule_set_event(rule_set_id, event_code, command_name,
        to_status, justification, actor_user_id, actor_user_code, correlation_id, entity_version)
      VALUES (v_new,'SCORING_CONFIG_VERSION_CREATED', p_command_name,'DRAFT', p_justification,
        p_actor_user_id, p_actor_user_code, p_correlation_id, 1);
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_new,'entity_version',1);

    ELSIF p_command_name = 'UPSERT_RULE' THEN
      v_id := NULLIF(v_payload->>'rule_id','')::uuid;
      IF NULLIF(btrim(COALESCE(v_payload->>'rule_code','')),'') IS NULL
         OR NULLIF(btrim(COALESCE(v_payload->>'name','')),'') IS NULL
         OR NULLIF(btrim(COALESCE(v_payload->>'operator','')),'') IS NULL
         OR NULLIF(v_payload->>'contribution','') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: rule code, name, operator and contribution are required';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                      WHERE domain='SCORING_OPERATOR' AND code = v_payload->>'operator' AND is_active) THEN
        RAISE EXCEPTION 'E_INVALID_VALUE: operator';
      END IF;
      IF v_id IS NULL THEN
        INSERT INTO public.bn_risk_scoring_rule(rule_set_id, rule_code, name, description,
          factor_type_code, direction_code, operator, comparison_numeric, comparison_code,
          requires_usable_evidence, contribution, max_contribution, explanation_template,
          sort_order, is_enabled, created_by_user_id)
        VALUES (v_rs.rule_set_id, upper(btrim(v_payload->>'rule_code')), btrim(v_payload->>'name'),
          NULLIF(btrim(COALESCE(v_payload->>'description','')),''),
          NULLIF(v_payload->>'factor_type_code',''), NULLIF(v_payload->>'direction_code',''),
          v_payload->>'operator', NULLIF(v_payload->>'comparison_numeric','')::numeric,
          NULLIF(v_payload->>'comparison_code',''),
          COALESCE((v_payload->>'requires_usable_evidence')::boolean,false),
          (v_payload->>'contribution')::numeric,
          NULLIF(v_payload->>'max_contribution','')::numeric,
          NULLIF(btrim(COALESCE(v_payload->>'explanation_template','')),''),
          COALESCE(NULLIF(v_payload->>'sort_order','')::int, 100),
          COALESCE((v_payload->>'is_enabled')::boolean,true), p_actor_user_id)
        RETURNING rule_id INTO v_id;
      ELSE
        UPDATE public.bn_risk_scoring_rule
           SET rule_code = upper(btrim(v_payload->>'rule_code')), name = btrim(v_payload->>'name'),
               description = NULLIF(btrim(COALESCE(v_payload->>'description','')),''),
               factor_type_code = NULLIF(v_payload->>'factor_type_code',''),
               direction_code = NULLIF(v_payload->>'direction_code',''),
               operator = v_payload->>'operator',
               comparison_numeric = NULLIF(v_payload->>'comparison_numeric','')::numeric,
               comparison_code = NULLIF(v_payload->>'comparison_code',''),
               requires_usable_evidence = COALESCE((v_payload->>'requires_usable_evidence')::boolean,false),
               contribution = (v_payload->>'contribution')::numeric,
               max_contribution = NULLIF(v_payload->>'max_contribution','')::numeric,
               explanation_template = NULLIF(btrim(COALESCE(v_payload->>'explanation_template','')),''),
               sort_order = COALESCE(NULLIF(v_payload->>'sort_order','')::int, 100),
               is_enabled = COALESCE((v_payload->>'is_enabled')::boolean,true)
         WHERE rule_id = v_id AND rule_set_id = v_rs.rule_set_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: rule'; END IF;
      END IF;
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_rs.rule_set_id,
        'rule_id', v_id, 'entity_version', v_rs.row_version + 1);

    ELSIF p_command_name = 'DELETE_RULE' THEN
      DELETE FROM public.bn_risk_scoring_rule
       WHERE rule_id = NULLIF(v_payload->>'rule_id','')::uuid AND rule_set_id = v_rs.rule_set_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: rule'; END IF;
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_rs.rule_set_id,
        'entity_version', v_rs.row_version + 1);

    ELSIF p_command_name = 'UPSERT_BAND' THEN
      v_id := NULLIF(v_payload->>'band_id','')::uuid;
      IF NULLIF(btrim(COALESCE(v_payload->>'band_code','')),'') IS NULL
         OR NULLIF(btrim(COALESCE(v_payload->>'label','')),'') IS NULL
         OR NULLIF(v_payload->>'min_score','') IS NULL
         OR NULLIF(v_payload->>'max_score','') IS NULL THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION: band code, label and score range are required';
      END IF;
      IF v_id IS NULL THEN
        INSERT INTO public.bn_risk_scoring_band(rule_set_id, band_code, label, description,
          min_score, max_score, review_priority, sort_order)
        VALUES (v_rs.rule_set_id, upper(btrim(v_payload->>'band_code')), btrim(v_payload->>'label'),
          NULLIF(btrim(COALESCE(v_payload->>'description','')),''),
          (v_payload->>'min_score')::numeric, (v_payload->>'max_score')::numeric,
          NULLIF(v_payload->>'review_priority',''),
          COALESCE(NULLIF(v_payload->>'sort_order','')::int, 100))
        RETURNING band_id INTO v_id;
      ELSE
        UPDATE public.bn_risk_scoring_band
           SET band_code = upper(btrim(v_payload->>'band_code')), label = btrim(v_payload->>'label'),
               description = NULLIF(btrim(COALESCE(v_payload->>'description','')),''),
               min_score = (v_payload->>'min_score')::numeric,
               max_score = (v_payload->>'max_score')::numeric,
               review_priority = NULLIF(v_payload->>'review_priority',''),
               sort_order = COALESCE(NULLIF(v_payload->>'sort_order','')::int, 100)
         WHERE band_id = v_id AND rule_set_id = v_rs.rule_set_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: band'; END IF;
      END IF;
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_rs.rule_set_id,
        'band_id', v_id, 'entity_version', v_rs.row_version + 1);

    ELSIF p_command_name = 'DELETE_BAND' THEN
      DELETE FROM public.bn_risk_scoring_band
       WHERE band_id = NULLIF(v_payload->>'band_id','')::uuid AND rule_set_id = v_rs.rule_set_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: band'; END IF;
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_rs.rule_set_id,
        'entity_version', v_rs.row_version + 1);

    ELSIF p_command_name = 'VALIDATE_RULE_SET' THEN
      IF v_rs.status NOT IN ('DRAFT','VALIDATED') THEN
        RAISE EXCEPTION 'E_INVALID_STATE: only a draft configuration can be validated';
      END IF;
      v_valid := public._bn_risk_rule_set_validation(v_rs.rule_set_id);
      IF jsonb_array_length(v_valid->'blockers') > 0 THEN
        RAISE EXCEPTION 'E_INVALID_CONFIGURATION: %', v_valid->'blockers'->>0;
      END IF;
      UPDATE public.bn_risk_scoring_rule_set
         SET status='VALIDATED', validated_at = now(), validated_by_user_id = p_actor_user_id
       WHERE rule_set_id = v_rs.rule_set_id;
      INSERT INTO public.bn_risk_scoring_rule_set_event(rule_set_id, event_code, command_name,
        from_status, to_status, justification, actor_user_id, actor_user_code, correlation_id,
        entity_version)
      VALUES (v_rs.rule_set_id,'SCORING_CONFIG_VALIDATED', p_command_name, v_rs.status,'VALIDATED',
        p_justification, p_actor_user_id, p_actor_user_code, p_correlation_id, v_rs.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_rs.rule_set_id,
        'entity_version', v_rs.row_version + 1);

    ELSIF p_command_name = 'ACTIVATE_RULE_SET' THEN
      IF v_rs.status <> 'VALIDATED' THEN
        RAISE EXCEPTION 'E_INVALID_STATE: validate the configuration before activating it';
      END IF;
      v_valid := public._bn_risk_rule_set_validation(v_rs.rule_set_id);
      IF jsonb_array_length(v_valid->'blockers') > 0 THEN
        RAISE EXCEPTION 'E_INVALID_CONFIGURATION: %', v_valid->'blockers'->>0;
      END IF;
      IF EXISTS (SELECT 1 FROM public.bn_risk_scoring_rule_set
                  WHERE status='ACTIVE' AND rule_set_code <> v_rs.rule_set_code
                    AND (effective_to IS NULL OR effective_to > now())) THEN
        RAISE EXCEPTION 'E_INVALID_CONFIGURATION: another scoring configuration is already in force';
      END IF;
      UPDATE public.bn_risk_scoring_rule_set
         SET status='SUPERSEDED', effective_to = now()
       WHERE status='ACTIVE' AND rule_set_code = v_rs.rule_set_code
         AND rule_set_id <> v_rs.rule_set_id;
      UPDATE public.bn_risk_scoring_rule_set
         SET status='ACTIVE', activated_at = now(), activated_by_user_id = p_actor_user_id,
             effective_from = COALESCE(effective_from, now())
       WHERE rule_set_id = v_rs.rule_set_id;
      INSERT INTO public.bn_risk_scoring_rule_set_event(rule_set_id, event_code, command_name,
        from_status, to_status, justification, actor_user_id, actor_user_code, correlation_id,
        entity_version)
      VALUES (v_rs.rule_set_id,'SCORING_CONFIG_ACTIVATED', p_command_name, v_rs.status,'ACTIVE',
        p_justification, p_actor_user_id, p_actor_user_code, p_correlation_id, v_rs.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_rs.rule_set_id,
        'entity_version', v_rs.row_version + 1);

    ELSE
      IF NULLIF(btrim(COALESCE(p_justification,'')),'') IS NULL THEN
        RAISE EXCEPTION 'E_JUSTIFICATION_REQUIRED: a reason is required to retire a configuration';
      END IF;
      v_status := v_rs.status;
      UPDATE public.bn_risk_scoring_rule_set
         SET status='RETIRED', retired_at = now(), retired_by_user_id = p_actor_user_id,
             effective_to = COALESCE(effective_to, now())
       WHERE rule_set_id = v_rs.rule_set_id;
      INSERT INTO public.bn_risk_scoring_rule_set_event(rule_set_id, event_code, command_name,
        from_status, to_status, justification, actor_user_id, actor_user_code, correlation_id,
        entity_version)
      VALUES (v_rs.rule_set_id,'SCORING_CONFIG_RETIRED', p_command_name, v_status,'RETIRED',
        p_justification, p_actor_user_id, p_actor_user_code, p_correlation_id, v_rs.row_version + 1);
      v_result := jsonb_build_object('status','EXECUTED','rule_set_id', v_rs.rule_set_id,
        'entity_version', v_rs.row_version + 1);
    END IF;

    UPDATE public.bn_risk_scoring_rule_set SET row_version = row_version + 1
     WHERE rule_set_id = v_rs.rule_set_id;
    IF p_command_name IN ('UPSERT_RULE','DELETE_RULE','UPSERT_BAND','DELETE_BAND')
       AND v_rs.status = 'VALIDATED' THEN
      UPDATE public.bn_risk_scoring_rule_set SET status='DRAFT', validated_at=NULL,
             validated_by_user_id=NULL
       WHERE rule_set_id = v_rs.rule_set_id;
    END IF;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
      entity_version, result_json, status, actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''),
      NULLIF(v_result->>'entity_version','')::bigint, v_result, 'COMPLETED', p_actor_user_id, now());
  END IF;

  RETURN v_result;
END; $function$;

-- Assessment actions now recognise the scoring and review stage.
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_actions_v1(p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_write boolean; v_decide boolean; v_early boolean; v_ready jsonb; v_actions jsonb;
  v_score jsonb; v_review jsonb;
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
  v_decide := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  v_early := v_a.status IN ('DRAFT','OPEN','INFORMATION_PENDING');
  v_ready := public.bn_risk_assessment_readiness_v1(p_actor_user_id, p_assessment_id);
  v_score := public.bn_risk_scoring_readiness_v1(p_actor_user_id, p_assessment_id);
  v_review := public.bn_risk_review_readiness_v1(p_actor_user_id, p_assessment_id);

  v_actions := jsonb_build_array(
    jsonb_build_object('action','ADD_FACTOR','label','Record factor',
      'command','BN_RISK_ADD_FACTOR','enabled', v_write AND v_early),
    jsonb_build_object('action','CORRECT_FACTOR','label','Correct factor',
      'command','BN_RISK_OP_CORRECT_FACTOR','enabled', v_write AND v_early),
    jsonb_build_object('action','VOID_FACTOR','label','Void factor',
      'command','BN_RISK_OP_VOID_FACTOR','enabled', v_decide AND v_early),
    jsonb_build_object('action','LINK_EVIDENCE','label','Link evidence',
      'command','BN_RISK_OP_LINK_EVIDENCE','enabled', v_write AND v_early),
    jsonb_build_object('action','RECORD_EVIDENCE_USABILITY','label','Record evidence usability',
      'command','BN_RISK_OP_RECORD_EVIDENCE_USABILITY','enabled', v_write AND v_early),
    jsonb_build_object('action','REQUEST_EVIDENCE','label','Request information',
      'command','BN_RISK_REQUEST_EVIDENCE','enabled', v_write AND v_early),
    jsonb_build_object('action','RECORD_RESPONSE','label','Record response',
      'command','BN_RISK_OP_RECORD_REQUEST_RESPONSE','enabled', v_write AND v_early),
    jsonb_build_object('action','CLOSE_REQUEST','label','Close request',
      'command','BN_RISK_OP_CLOSE_REQUEST','enabled', v_write AND v_early),
    jsonb_build_object('action','ADD_SIGNAL','label','Add signal',
      'command','BN_RISK_OP_ADD_SIGNAL','enabled', v_write AND v_early),
    jsonb_build_object('action','COMPLETE_INFORMATION_GATHERING','label','Complete information gathering',
      'command','BN_RISK_OP_COMPLETE_INFORMATION_GATHERING',
      'enabled', v_decide AND v_early AND COALESCE((v_ready->'data'->>'can_review')::boolean,false)),
    jsonb_build_object('action','CALCULATE_SCORE','label','Calculate risk score',
      'command','CALCULATE_SCORE',
      'enabled', COALESCE((v_score->'data'->>'can_score')::boolean,false)
                 AND NOT COALESCE((v_score->'data'->>'has_score')::boolean,false)),
    jsonb_build_object('action','RECALCULATE_SCORE','label','Recalculate risk score',
      'command','RECALCULATE_SCORE',
      'enabled', COALESCE((v_score->'data'->>'can_score')::boolean,false)
                 AND COALESCE((v_score->'data'->>'has_score')::boolean,false)),
    jsonb_build_object('action','COMPLETE_SCORING_REVIEW','label','Complete scoring and review',
      'command','COMPLETE_SCORING_REVIEW',
      'enabled', COALESCE((v_review->'data'->>'can_complete_review')::boolean,false)));

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'row_version', v_a.row_version,
    'actions', v_actions,
    'notice', CASE
      WHEN v_a.status = 'RECOMMENDATION'
        THEN 'Scoring and review are complete. Control recommendation is not available in this release.'
      WHEN NOT v_early AND v_a.status <> 'REVIEW'
        THEN 'This assessment has left the scoring and review stage. Later stages are not available in this release.'
      ELSE NULL END));
END; $function$;

-- Privacy-safe person summary: stage label only, never a score or band.
CREATE OR REPLACE FUNCTION public.bn_risk_person_safe_summary_v1(p_actor_user_id uuid, p_person_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_state text; v_label text;
  v_a public.bn_risk_assessment%ROWTYPE; v_open int;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  SELECT * INTO v_a FROM public.bn_risk_assessment
   WHERE person_id = p_person_id
     AND status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW','RECOMMENDATION')
   ORDER BY opened_at DESC LIMIT 1;

  IF FOUND THEN
    v_state := CASE WHEN v_a.status = 'INFORMATION_PENDING'
                    THEN 'AWAITING_INFORMATION' ELSE 'REVIEW_IN_PROGRESS' END;
    v_label := CASE
      WHEN v_a.status = 'INFORMATION_PENDING' THEN 'Risk review — awaiting information'
      WHEN v_a.status = 'REVIEW' THEN 'Risk review — scoring'
      WHEN v_a.status = 'RECOMMENDATION' THEN 'Risk review — recommendation pending'
      ELSE 'Risk review in progress' END;
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
      'person_id', p_person_id, 'review_state', v_state, 'review_state_label', v_label,
      'assessment_id', v_a.assessment_id,
      'assessment_reference', v_a.assessment_reference,
      'stage_label', COALESCE((SELECT label FROM public.bn_risk_reference_value
                                WHERE domain='ASSESSMENT_STATUS' AND code=v_a.status), v_a.status)));
  END IF;

  SELECT count(*) INTO v_open FROM public.bn_risk_signal
   WHERE person_id = p_person_id AND status IN ('NEW','TRIAGED','LINKED','UNDER_REVIEW','CONFIRMED');
  IF v_open > 0 THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
      'person_id', p_person_id, 'review_state','ACTION_REQUIRED',
      'review_state_label','Risk review pending', 'assessment_id', NULL,
      'assessment_reference', NULL, 'stage_label', NULL));
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'person_id', p_person_id, 'review_state','NO_ACTIVE_REVIEW',
    'review_state_label','No active review', 'assessment_id', NULL,
    'assessment_reference', NULL, 'stage_label', NULL));
END; $function$;
