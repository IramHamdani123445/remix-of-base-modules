
-- ============ validation ============
CREATE OR REPLACE FUNCTION public._bn_uprating_validate_version(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v public.bn_uprating_policy_version%ROWTYPE;
  p public.bn_uprating_policy%ROWTYPE;
  e jsonb := '[]'::jsonb; w jsonb := '[]'::jsonb;
  v_cnt int; v_bad int; v_fv public.bn_formula_version%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.bn_uprating_policy_version WHERE policy_version_id = p_version_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object(
      'code','E_NOT_FOUND','field','policy_version_id','message','The policy version could not be found.')),
      'warnings','[]'::jsonb);
  END IF;
  SELECT * INTO p FROM public.bn_uprating_policy WHERE policy_id = v.policy_id;

  IF v.effective_from IS NULL THEN
    e := e || jsonb_build_object('code','E_REQUIRED','field','effective_from','message','An effective from date is required.');
  END IF;
  IF v.effective_to IS NOT NULL AND v.effective_from IS NOT NULL AND v.effective_to < v.effective_from THEN
    e := e || jsonb_build_object('code','E_INVALID_PERIOD','field','effective_to','message','The effective to date must be on or after the effective from date.');
  END IF;
  IF v.policy_type IS DISTINCT FROM p.policy_type THEN
    e := e || jsonb_build_object('code','E_TYPE_MISMATCH','field','policy_type','message','The version policy type must match the policy master.');
  END IF;
  IF NULLIF(btrim(COALESCE(v.country_code,'')),'') IS NULL THEN
    e := e || jsonb_build_object('code','E_REQUIRED','field','country_code','message','A country must be selected for applicability.');
  END IF;
  IF NULLIF(btrim(COALESCE(v.award_component_code,'')),'') IS NULL THEN
    e := e || jsonb_build_object('code','E_REQUIRED','field','award_component_code','message','An award component must be selected for applicability.');
  END IF;
  IF v.legal_reference_id IS NULL AND NULLIF(btrim(COALESCE(v.source_reference,'')),'') IS NULL THEN
    e := e || jsonb_build_object('code','E_REQUIRED','field','legal_reference_id','message','A governed legal or source reference is required.');
  END IF;

  IF v.policy_type IN ('PERCENTAGE','PERCENTAGE_PLUS_FIXED') THEN
    IF v.percentage_bp IS NULL THEN
      e := e || jsonb_build_object('code','E_REQUIRED','field','percentage_bp','message','A percentage rate is required.');
    ELSIF v.percentage_bp <= 0 OR v.percentage_bp > 1000000 THEN
      e := e || jsonb_build_object('code','E_INVALID_VALUE','field','percentage_bp','message','The percentage rate is outside the permitted range.');
    END IF;
  END IF;
  IF v.policy_type IN ('FIXED_AMOUNT','PERCENTAGE_PLUS_FIXED') THEN
    IF v.fixed_amount_minor IS NULL THEN
      e := e || jsonb_build_object('code','E_REQUIRED','field','fixed_amount_minor','message','A fixed amount is required.');
    ELSIF v.fixed_amount_minor <= 0 THEN
      e := e || jsonb_build_object('code','E_INVALID_VALUE','field','fixed_amount_minor','message','The fixed amount must be greater than zero.');
    END IF;
    IF NULLIF(btrim(COALESCE(v.currency_code,'')),'') IS NULL THEN
      e := e || jsonb_build_object('code','E_REQUIRED','field','currency_code','message','A currency is required for a fixed amount.');
    END IF;
  END IF;
  IF v.policy_type = 'INDEX_FACTOR' THEN
    IF v.index_series_id IS NULL THEN
      e := e || jsonb_build_object('code','E_MISSING_INDEX_REFERENCE','field','index_series_id','message','A governed index series is required.');
    ELSIF NOT EXISTS (SELECT 1 FROM public.bn_uprating_index_series WHERE index_series_id = v.index_series_id AND is_active) THEN
      e := e || jsonb_build_object('code','E_INVALID_INDEX_REFERENCE','field','index_series_id','message','That index series is not active.');
    END IF;
    IF NULLIF(btrim(COALESCE(v.index_reference_period,'')),'') IS NULL THEN
      e := e || jsonb_build_object('code','E_MISSING_INDEX_REFERENCE','field','index_reference_period','message','An index reference period is required.');
    ELSIF v.index_series_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.bn_uprating_index_observation
       WHERE index_series_id = v.index_series_id AND reference_period = v.index_reference_period) THEN
      w := w || jsonb_build_object('code','W_INDEX_NOT_PUBLISHED','field','index_reference_period','message','No observation has been published yet for that reference period.');
    END IF;
  END IF;
  IF v.policy_type = 'TIERED' THEN
    SELECT count(*) INTO v_cnt FROM public.bn_uprating_policy_tier WHERE policy_version_id = p_version_id;
    IF v_cnt = 0 THEN
      e := e || jsonb_build_object('code','E_REQUIRED','field','tiers','message','At least one tier is required.');
    ELSE
      SELECT count(*) INTO v_bad FROM public.bn_uprating_policy_tier t
       WHERE t.policy_version_id = p_version_id
         AND (t.upper_bound_minor IS NOT NULL AND t.upper_bound_minor <= t.lower_bound_minor);
      IF v_bad > 0 THEN
        e := e || jsonb_build_object('code','E_INVALID_TIER_RANGE','field','tiers','message','Each tier upper bound must be greater than its lower bound.');
      END IF;
      SELECT count(*) INTO v_bad FROM public.bn_uprating_policy_tier a
        JOIN public.bn_uprating_policy_tier b
          ON b.policy_version_id = a.policy_version_id AND b.tier_id <> a.tier_id
       WHERE a.policy_version_id = p_version_id
         AND a.lower_bound_minor < COALESCE(b.upper_bound_minor, 9223372036854775807)
         AND b.lower_bound_minor < COALESCE(a.upper_bound_minor, 9223372036854775807);
      IF v_bad > 0 THEN
        e := e || jsonb_build_object('code','E_OVERLAPPING_TIERS','field','tiers','message','Tier ranges must not overlap.');
      END IF;
      SELECT count(*) INTO v_bad FROM public.bn_uprating_policy_tier
       WHERE policy_version_id = p_version_id AND upper_bound_minor IS NULL;
      IF v_bad > 1 THEN
        e := e || jsonb_build_object('code','E_UNBOUNDED_TIERS','field','tiers','message','Only the final tier may be unbounded.');
      END IF;
      IF v_bad = 0 THEN
        w := w || jsonb_build_object('code','W_NO_UNBOUNDED_TIER','field','tiers','message','No open-ended tier is defined; amounts above the highest tier will not be covered.');
      END IF;
      SELECT count(*) INTO v_bad FROM (
        SELECT sequence_no, row_number() OVER (ORDER BY sequence_no) rn
          FROM public.bn_uprating_policy_tier WHERE policy_version_id = p_version_id) s
       WHERE s.sequence_no <> s.rn;
      IF v_bad > 0 THEN
        e := e || jsonb_build_object('code','E_INVALID_TIER_SEQUENCE','field','tiers','message','Tier ordering must be a contiguous sequence starting at 1.');
      END IF;
      SELECT count(*) INTO v_bad FROM public.bn_uprating_policy_tier
       WHERE policy_version_id = p_version_id AND percentage_bp IS NULL AND fixed_amount_minor IS NULL;
      IF v_bad > 0 THEN
        e := e || jsonb_build_object('code','E_REQUIRED','field','tiers','message','Each tier must define a rate or a fixed value.');
      END IF;
    END IF;
  END IF;
  IF v.policy_type = 'FORMULA_DRIVEN' THEN
    IF v.formula_version_id IS NULL THEN
      e := e || jsonb_build_object('code','E_MISSING_FORMULA_REFERENCE','field','formula_version_id','message','A governed formula version is required.');
    ELSE
      SELECT * INTO v_fv FROM public.bn_formula_version WHERE id = v.formula_version_id;
      IF NOT FOUND THEN
        e := e || jsonb_build_object('code','E_INVALID_FORMULA_REFERENCE','field','formula_version_id','message','That formula version could not be found.');
      ELSIF COALESCE(v_fv.is_active,false) = false THEN
        w := w || jsonb_build_object('code','W_FORMULA_INACTIVE','field','formula_version_id','message','That formula version is not currently active.');
      END IF;
    END IF;
  END IF;
  IF v.policy_type = 'MANUAL_IMPORT' THEN
    IF NULLIF(btrim(COALESCE(v.manual_source_code,'')),'') IS NULL THEN
      e := e || jsonb_build_object('code','E_REQUIRED','field','manual_source_code','message','A governed source contract code is required.');
    END IF;
  END IF;

  IF v.effective_from IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bn_uprating_policy_version o
     WHERE o.policy_id = v.policy_id AND o.policy_version_id <> v.policy_version_id
       AND o.status IN ('REVIEW','APPROVED','ACTIVE')
       AND COALESCE(o.country_code,'*') = COALESCE(v.country_code,'*')
       AND COALESCE(o.award_component_code,'*') = COALESCE(v.award_component_code,'*')
       AND COALESCE(o.product_id::text,'*') = COALESCE(v.product_id::text,'*')
       AND COALESCE(o.payment_frequency,'*') = COALESCE(v.payment_frequency,'*')
       AND o.effective_from <= COALESCE(v.effective_to, DATE '9999-12-31')
       AND COALESCE(o.effective_to, DATE '9999-12-31') >= v.effective_from) THEN
    e := e || jsonb_build_object('code','E_VERSION_CONFLICT','field','effective_from','message','Another version already covers this applicability and period.');
  END IF;

  RETURN jsonb_build_object('errors', e, 'warnings', w);
END; $fn$;

-- ============ readiness ============
CREATE OR REPLACE FUNCTION public.bn_uprating_policy_validation_readiness_v1(
  p_actor_user_id uuid, p_policy_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v public.bn_uprating_policy_version%ROWTYPE; v_perm jsonb; v_block jsonb := '[]'::jsonb;
BEGIN
  v_perm := public.bn_uprating_check_actor_permission(p_actor_user_id,'write',true);
  SELECT * INTO v FROM public.bn_uprating_policy_version WHERE policy_version_id = p_policy_version_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','data',NULL);
  END IF;
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    v_block := v_block || to_jsonb('You do not have permission to validate this policy version.'::text);
  END IF;
  IF v.status <> 'DRAFT' THEN
    v_block := v_block || to_jsonb('Only a draft version can be validated.'::text);
  END IF;
  RETURN jsonb_build_object('status','OK','code',NULL,'data', jsonb_build_object(
    'can_validate', jsonb_array_length(v_block) = 0,
    'blockers', v_block, 'status', v.status, 'validation_status', v.validation_status));
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_policy_approval_readiness_v1(
  p_actor_user_id uuid, p_policy_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v public.bn_uprating_policy_version%ROWTYPE; v_perm jsonb; v_block jsonb := '[]'::jsonb;
BEGIN
  v_perm := public.bn_uprating_check_actor_permission(p_actor_user_id,'admin',true);
  SELECT * INTO v FROM public.bn_uprating_policy_version WHERE policy_version_id = p_policy_version_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','data',NULL);
  END IF;
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    v_block := v_block || to_jsonb('You do not have permission to decide this policy version.'::text);
  END IF;
  IF v.status <> 'REVIEW' THEN
    v_block := v_block || to_jsonb('Only a version awaiting approval can be decided.'::text);
  END IF;
  IF v.created_by = p_actor_user_id OR v.submitted_by = p_actor_user_id THEN
    v_block := v_block || to_jsonb('The author or submitter of a version cannot approve it.'::text);
  END IF;
  RETURN jsonb_build_object('status','OK','code',NULL,'data', jsonb_build_object(
    'can_decide', jsonb_array_length(v_block) = 0,
    'blockers', v_block, 'status', v.status,
    'requires_justification', true,
    'independent', v.created_by IS DISTINCT FROM p_actor_user_id));
END; $fn$;

-- ============ available actions ============
CREATE OR REPLACE FUNCTION public.bn_uprating_policy_actions_v1(
  p_actor_user_id uuid, p_policy_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v public.bn_uprating_policy_version%ROWTYPE;
  v_write boolean; v_admin boolean; v_actions jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.bn_uprating_policy_version WHERE policy_version_id = p_policy_version_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','data',NULL); END IF;
  v_write := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false);
  v_admin := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);

  IF v_write AND v.status = 'DRAFT' THEN
    v_actions := v_actions || to_jsonb('edit_draft'::text) || to_jsonb('validate'::text);
    IF v.validation_status = 'VALID' THEN
      v_actions := v_actions || to_jsonb('submit_for_approval'::text);
    END IF;
  END IF;
  IF v_write AND v.status IN ('ACTIVE','APPROVED','SUPERSEDED','RETIRED','DRAFT','REVIEW') THEN
    v_actions := v_actions || to_jsonb('create_version'::text);
  END IF;
  IF v_admin AND v.status = 'REVIEW'
     AND v.created_by IS DISTINCT FROM p_actor_user_id
     AND v.submitted_by IS DISTINCT FROM p_actor_user_id THEN
    v_actions := v_actions || to_jsonb('approve'::text) || to_jsonb('return'::text) || to_jsonb('reject'::text);
  END IF;
  IF v_admin AND v.status = 'APPROVED' THEN
    v_actions := v_actions || to_jsonb('activate'::text);
  END IF;
  IF v_admin AND v.status = 'ACTIVE' THEN
    v_actions := v_actions || to_jsonb('supersede'::text);
  END IF;
  IF v_admin AND v.status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','SUPERSEDED') THEN
    v_actions := v_actions || to_jsonb('retire'::text);
  END IF;

  RETURN jsonb_build_object('status','OK','code',NULL,'data', jsonb_build_object(
    'policy_version_id', v.policy_version_id, 'status', v.status,
    'validation_status', v.validation_status, 'row_version', v.row_version,
    'actions', v_actions));
END; $fn$;
