-- ===========================================================================
-- MEANS-TEST STABILIZATION — person identifier safety + governed policy admin
-- ===========================================================================

-- 1. Leading-zero-safe person identifier matching -------------------------
DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname = 'bn_means_person_context_v1' AND pronamespace = 'public'::regnamespace;
  v_new := replace(v_def,
    'WHERE regexp_replace(COALESCE(m.ssn,''''),''[^0-9]'','''',''g'') = p_person_id::text',
    'WHERE NULLIF(regexp_replace(COALESCE(m.ssn,''''),''[^0-9]'','''',''g''),'''')::bigint = p_person_id');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'person_context person-id predicate not found — migration must be revised';
  END IF;
  EXECUTE v_new;
END $mig$;

DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname = 'bn_means_initiation_check_v1' AND pronamespace = 'public'::regnamespace;
  v_new := replace(v_def,
    'WHERE regexp_replace(COALESCE(m.ssn,''''),''[^0-9]'','''',''g'') = v_person::text',
    'WHERE NULLIF(regexp_replace(COALESCE(m.ssn,''''),''[^0-9]'','''',''g''),'''')::bigint = v_person');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'initiation_check person-id predicate not found — migration must be revised';
  END IF;
  EXECUTE v_new;
END $mig$;

-- 2. Policy version governance columns ------------------------------------
ALTER TABLE public.bn_means_policy_version
  ADD COLUMN IF NOT EXISTS validation_state text NOT NULL DEFAULT 'NOT_VALIDATED',
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_policy_version_validation_ck') THEN
    ALTER TABLE public.bn_means_policy_version
      ADD CONSTRAINT bn_means_policy_version_validation_ck
      CHECK (validation_state IN ('NOT_VALIDATED','READY','BLOCKED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_policy_version_scale_ck') THEN
    ALTER TABLE public.bn_means_policy_version
      ADD CONSTRAINT bn_means_policy_version_scale_ck
      CHECK (rounding_scale BETWEEN 0 AND 6);
  END IF;
END $$;

ALTER TABLE public.bn_means_policy
  ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- 3. Audit + idempotency --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_means_policy_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_name text NOT NULL,
  policy_id uuid,
  policy_version_id uuid,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bn_means_policy_audit TO authenticated;
GRANT ALL ON public.bn_means_policy_audit TO service_role;
ALTER TABLE public.bn_means_policy_audit ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bn_means_policy_audit' AND policyname='means_policy_audit_no_direct_access') THEN
    CREATE POLICY "means_policy_audit_no_direct_access" ON public.bn_means_policy_audit
      FOR SELECT TO authenticated USING (false);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.bn_means_policy_idempotency (
  idempotency_key uuid NOT NULL,
  command_name text NOT NULL,
  payload_hash text NOT NULL DEFAULT '',
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idempotency_key, command_name)
);
GRANT SELECT ON public.bn_means_policy_idempotency TO authenticated;
GRANT ALL ON public.bn_means_policy_idempotency TO service_role;
ALTER TABLE public.bn_means_policy_idempotency ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bn_means_policy_idempotency' AND policyname='means_policy_idem_no_direct_access') THEN
    CREATE POLICY "means_policy_idem_no_direct_access" ON public.bn_means_policy_idempotency
      FOR SELECT TO authenticated USING (false);
  END IF;
END $$;

-- 4. Validation gate ------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_policy_validate(p_policy_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v        public.bn_means_policy_version%ROWTYPE;
  p        public.bn_means_policy%ROWTYPE;
  blockers jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  codes    text[] := ARRAY[]::text[];
  v_params jsonb;
  v_overlap int;
  v_cats   int;

  PROCEDURE_placeholder int;
BEGIN
  SELECT * INTO v FROM public.bn_means_policy_version WHERE policy_version_id = p_policy_version_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_activate', false, 'reason_codes', to_jsonb(ARRAY['VERSION_NOT_FOUND']),
      'blockers', jsonb_build_array(jsonb_build_object('code','VERSION_NOT_FOUND','message','The policy version could not be found.')),
      'warnings','[]'::jsonb);
  END IF;
  SELECT * INTO p FROM public.bn_means_policy WHERE policy_id = v.policy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_activate', false, 'reason_codes', to_jsonb(ARRAY['POLICY_NOT_FOUND']),
      'blockers', jsonb_build_array(jsonb_build_object('code','POLICY_NOT_FOUND','message','The parent policy could not be found.')),
      'warnings','[]'::jsonb);
  END IF;

  IF p.status = 'RETIRED' THEN
    codes := codes || 'POLICY_RETIRED';
    blockers := blockers || jsonb_build_object('code','POLICY_RETIRED','message','The policy is retired and cannot be activated.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bn_product pr WHERE pr.benefit_code = p.benefit_programme) THEN
    codes := codes || 'PROGRAMME_UNKNOWN';
    blockers := blockers || jsonb_build_object('code','PROGRAMME_UNKNOWN',
      'message','The benefit programme on this policy is not a registered benefit product.');
  END IF;

  IF v.status NOT IN ('DRAFT') THEN
    codes := codes || 'VERSION_NOT_ACTIVATABLE';
    blockers := blockers || jsonb_build_object('code','VERSION_NOT_ACTIVATABLE',
      'message','Only a draft version can be activated. Create a new version instead.');
  END IF;

  IF COALESCE(btrim(v.version_label),'') = '' THEN
    codes := codes || 'VERSION_LABEL_REQUIRED';
    blockers := blockers || jsonb_build_object('code','VERSION_LABEL_REQUIRED','message','A version label is required.');
  END IF;

  IF v.effective_from IS NULL THEN
    codes := codes || 'EFFECTIVE_FROM_REQUIRED';
    blockers := blockers || jsonb_build_object('code','EFFECTIVE_FROM_REQUIRED','message','An effective-from date is required.');
  ELSIF v.effective_to IS NOT NULL AND v.effective_to < v.effective_from THEN
    codes := codes || 'EFFECTIVE_RANGE_INVALID';
    blockers := blockers || jsonb_build_object('code','EFFECTIVE_RANGE_INVALID','message','The effective-to date is before the effective-from date.');
  END IF;

  IF COALESCE(btrim(v.currency_code),'') = '' OR length(btrim(v.currency_code)) <> 3 THEN
    codes := codes || 'CURRENCY_INVALID';
    blockers := blockers || jsonb_build_object('code','CURRENCY_INVALID','message','A three-letter currency code is required.');
  END IF;

  IF v.rounding_method NOT IN ('HALF_UP','HALF_EVEN','DOWN','UP') THEN
    codes := codes || 'ROUNDING_METHOD_INVALID';
    blockers := blockers || jsonb_build_object('code','ROUNDING_METHOD_INVALID','message','The rounding method is not supported.');
  END IF;
  IF v.rounding_scale IS NULL OR v.rounding_scale < 0 OR v.rounding_scale > 6 THEN
    codes := codes || 'ROUNDING_SCALE_INVALID';
    blockers := blockers || jsonb_build_object('code','ROUNDING_SCALE_INVALID','message','The rounding scale must be between 0 and 6.');
  END IF;

  -- calculation threshold parameters (the calculator is the source of truth)
  v_params := public._bn_means_calc_parameters(v.threshold_parameters);
  IF jsonb_array_length(COALESCE(v_params->'missing','[]'::jsonb)) > 0 THEN
    codes := codes || 'THRESHOLD_PARAMETER_MISSING';
    blockers := blockers || (v_params->'missing');
  END IF;
  IF COALESCE(upper(v.threshold_parameters->>'threshold_basis'),'ANNUAL') NOT IN ('ANNUAL','MONTHLY','WEEKLY') THEN
    codes := codes || 'THRESHOLD_BASIS_INVALID';
    blockers := blockers || jsonb_build_object('code','THRESHOLD_BASIS_INVALID','message','The threshold basis must be annual, monthly or weekly.');
  END IF;

  -- structural rule groups
  IF jsonb_typeof(v.household_rules)  <> 'object' OR jsonb_typeof(v.income_rules) <> 'object'
     OR jsonb_typeof(v.asset_rules)   <> 'object' OR jsonb_typeof(v.deduction_rules) <> 'object'
     OR jsonb_typeof(v.decision_rules) <> 'object' THEN
    codes := codes || 'RULE_GROUP_INVALID';
    blockers := blockers || jsonb_build_object('code','RULE_GROUP_INVALID','message','One or more rule groups are structurally invalid.');
  END IF;

  IF jsonb_typeof(v.required_evidence) <> 'array' THEN
    codes := codes || 'EVIDENCE_CONFIG_INVALID';
    blockers := blockers || jsonb_build_object('code','EVIDENCE_CONFIG_INVALID','message','The evidence requirement list is structurally invalid.');
  ELSIF jsonb_array_length(v.required_evidence) = 0 THEN
    warnings := warnings || jsonb_build_object('code','NO_REQUIRED_EVIDENCE','message','No evidence requirements are configured for this version.');
  END IF;

  IF v.validity_months IS NOT NULL AND v.validity_months <= 0 THEN
    codes := codes || 'VALIDITY_INVALID';
    blockers := blockers || jsonb_build_object('code','VALIDITY_INVALID','message','The validity period must be a positive number of months.');
  END IF;
  IF v.reassessment_months IS NOT NULL AND v.reassessment_months <= 0 THEN
    codes := codes || 'REASSESSMENT_INVALID';
    blockers := blockers || jsonb_build_object('code','REASSESSMENT_INVALID','message','The reassessment period must be a positive number of months.');
  END IF;
  IF v.reassessment_months IS NULL AND v.validity_months IS NULL THEN
    warnings := warnings || jsonb_build_object('code','NO_REVIEW_PERIOD','message','Neither a validity nor a reassessment period is configured.');
  END IF;

  SELECT count(*) INTO v_cats FROM public.bn_means_policy_category c
   WHERE c.policy_version_id = v.policy_version_id;
  IF v_cats = 0 THEN
    warnings := warnings || jsonb_build_object('code','NO_CATEGORIES','message','No income, asset or deduction categories are configured; the governed default catalogue will apply.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_means_policy_category c
              WHERE c.policy_version_id = v.policy_version_id
                AND (COALESCE(btrim(c.category_code),'') = '' OR COALESCE(btrim(c.category_name),'') = ''
                     OR jsonb_typeof(c.disregard_rule) <> 'object')) THEN
    codes := codes || 'CATEGORY_INVALID';
    blockers := blockers || jsonb_build_object('code','CATEGORY_INVALID','message','One or more configured categories are incomplete.');
  END IF;

  -- overlapping active effective period for the same programme
  SELECT count(*) INTO v_overlap
    FROM public.bn_means_policy p2
    JOIN public.bn_means_policy_version v2 ON v2.policy_id = p2.policy_id
   WHERE p2.benefit_programme = p.benefit_programme
     AND p2.status = 'ACTIVE'
     AND v2.status = 'ACTIVE'
     AND v2.policy_version_id <> v.policy_version_id
     AND v.effective_from IS NOT NULL
     AND (v2.effective_to IS NULL OR v2.effective_to >= v.effective_from)
     AND (v.effective_to IS NULL OR v2.effective_from <= v.effective_to);
  IF v_overlap > 0 THEN
    codes := codes || 'OVERLAPPING_ACTIVE_VERSION';
    blockers := blockers || jsonb_build_object('code','OVERLAPPING_ACTIVE_VERSION',
      'message','Another active policy version already covers this programme for the same period. Supersede it first or narrow the effective period.');
  END IF;

  RETURN jsonb_build_object(
    'policy_version_id', v.policy_version_id,
    'policy_id', v.policy_id,
    'benefit_programme', p.benefit_programme,
    'can_activate', (jsonb_array_length(blockers) = 0),
    'reason_codes', to_jsonb(codes),
    'blockers', blockers,
    'warnings', warnings,
    'evaluated_at', now());
END;
$fn$;

-- 5. Governed reads -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_policy_admin_list_v1(
  p_actor_user_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
  v_can_config boolean;
  v_search text := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  v_prog   text := NULLIF(btrim(COALESCE(p_filters->>'benefit_programme','')),'');
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_can_config := COALESCE((public.bn_means_check_actor_permission(p_actor_user_id,'config',false)->>'ok')::boolean,false);

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'benefit_programme', r->>'policy_code', r->>'effective_from'), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'policy_id', p.policy_id,
      'policy_code', p.policy_code,
      'policy_name', p.policy_name,
      'benefit_programme', p.benefit_programme,
      'programme_label', COALESCE(pr.benefit_name, p.benefit_programme),
      'authority_reference', p.authority_reference,
      'policy_status', p.status,
      'policy_row_version', p.row_version,
      'policy_version_id', v.policy_version_id,
      'version_label', v.version_label,
      'version_status', v.status,
      'validation_state', v.validation_state,
      'validated_at', v.validated_at,
      'effective_from', v.effective_from,
      'effective_to', v.effective_to,
      'currency_code', v.currency_code,
      'row_version', v.row_version,
      'assessment_count', (SELECT count(*) FROM public.bn_means_assessment a
                            WHERE a.policy_version_id = v.policy_version_id),
      'is_in_force', (p.status = 'ACTIVE' AND v.status = 'ACTIVE'
                      AND v.effective_from <= CURRENT_DATE
                      AND (v.effective_to IS NULL OR v.effective_to >= CURRENT_DATE))
    ) AS r
    FROM public.bn_means_policy p
    LEFT JOIN public.bn_means_policy_version v ON v.policy_id = p.policy_id
    LEFT JOIN public.bn_product pr ON pr.benefit_code = p.benefit_programme
   WHERE (v_prog IS NULL OR p.benefit_programme = v_prog)
     AND (v_search IS NULL
          OR p.policy_code ILIKE '%'||v_search||'%'
          OR p.policy_name ILIKE '%'||v_search||'%'
          OR p.benefit_programme ILIKE '%'||v_search||'%')
  ) s;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', v_rows,
    'can_configure', v_can_config,
    'summary', jsonb_build_object(
      'programmes', (SELECT count(DISTINCT benefit_programme) FROM public.bn_means_policy),
      'policies', (SELECT count(*) FROM public.bn_means_policy),
      'in_force', (SELECT count(*) FROM public.bn_means_policy p2
                    JOIN public.bn_means_policy_version v2 ON v2.policy_id = p2.policy_id
                   WHERE p2.status='ACTIVE' AND v2.status='ACTIVE'
                     AND v2.effective_from <= CURRENT_DATE
                     AND (v2.effective_to IS NULL OR v2.effective_to >= CURRENT_DATE)),
      'requires_configuration', (SELECT count(*) FROM public.bn_means_policy p3
                                  WHERE NOT EXISTS (
                                    SELECT 1 FROM public.bn_means_policy_version v3
                                     WHERE v3.policy_id = p3.policy_id AND v3.status='ACTIVE'))),
    'programme_catalogue', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'code', pr.benefit_code, 'label', COALESCE(pr.benefit_name, pr.benefit_code))
                              ORDER BY pr.benefit_code), '[]'::jsonb)
                            FROM public.bn_product pr WHERE pr.benefit_code IS NOT NULL)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_policy_admin_detail_v1(
  p_actor_user_id uuid,
  p_policy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_perm jsonb;
  p public.bn_means_policy%ROWTYPE;
  v_versions jsonb;
  v_can_config boolean;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_can_config := COALESCE((public.bn_means_check_actor_permission(p_actor_user_id,'config',false)->>'ok')::boolean,false);

  SELECT * INTO p FROM public.bn_means_policy WHERE policy_id = p_policy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','POLICY_NOT_FOUND','data', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'policy_version_id', v.policy_version_id,
           'version_label', v.version_label,
           'status', v.status,
           'validation_state', v.validation_state,
           'validated_at', v.validated_at,
           'validation_report', v.validation_report,
           'effective_from', v.effective_from,
           'effective_to', v.effective_to,
           'currency_code', v.currency_code,
           'rounding_method', v.rounding_method,
           'rounding_scale', v.rounding_scale,
           'validity_months', v.validity_months,
           'reassessment_months', v.reassessment_months,
           'authority_reference', v.authority_reference,
           'household_rules', v.household_rules,
           'income_rules', v.income_rules,
           'asset_rules', v.asset_rules,
           'deduction_rules', v.deduction_rules,
           'decision_rules', v.decision_rules,
           'threshold_parameters', v.threshold_parameters,
           'required_evidence', v.required_evidence,
           'row_version', v.row_version,
           'superseded_by', v.superseded_by,
           'assessment_count', (SELECT count(*) FROM public.bn_means_assessment a
                                 WHERE a.policy_version_id = v.policy_version_id),
           'categories', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                             'category_id', c.category_id,
                             'category_kind', c.category_kind,
                             'category_code', c.category_code,
                             'category_name', c.category_name,
                             'is_assessable', c.is_assessable,
                             'requires_evidence', c.requires_evidence,
                             'disregard_rule', c.disregard_rule,
                             'display_order', c.display_order)
                             ORDER BY c.category_kind, c.display_order, c.category_code), '[]'::jsonb)
                          FROM public.bn_means_policy_category c
                          WHERE c.policy_version_id = v.policy_version_id)
         ) ORDER BY v.effective_from DESC, v.created_at DESC), '[]'::jsonb)
    INTO v_versions
    FROM public.bn_means_policy_version v
   WHERE v.policy_id = p.policy_id;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'policy', jsonb_build_object(
      'policy_id', p.policy_id,
      'policy_code', p.policy_code,
      'policy_name', p.policy_name,
      'benefit_programme', p.benefit_programme,
      'programme_label', (SELECT COALESCE(pr.benefit_name, p.benefit_programme)
                            FROM public.bn_product pr WHERE pr.benefit_code = p.benefit_programme LIMIT 1),
      'authority_reference', p.authority_reference,
      'status', p.status,
      'row_version', p.row_version),
    'versions', v_versions,
    'can_configure', v_can_config));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_policy_validation_v1(
  p_actor_user_id uuid,
  p_policy_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_perm jsonb; v_report jsonb; v_can_config boolean;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_can_config := COALESCE((public.bn_means_check_actor_permission(p_actor_user_id,'config',false)->>'ok')::boolean,false);
  v_report := public._bn_means_policy_validate(p_policy_version_id);
  RETURN jsonb_build_object('status','OK','data',
    v_report || jsonb_build_object('actor_can_configure', v_can_config,
      'can_activate', COALESCE((v_report->>'can_activate')::boolean,false) AND v_can_config));
END;
$fn$;

-- 6. Governed policy administration commands ------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_policy_command_v1(
  p_command_name text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_policy_id uuid DEFAULT NULL,
  p_policy_version_id uuid DEFAULT NULL,
  p_expected_row_version bigint DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_payload_hash text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_perm  jsonb;
  v_prior public.bn_means_policy_idempotency%ROWTYPE;
  p       public.bn_means_policy%ROWTYPE;
  v       public.bn_means_policy_version%ROWTYPE;
  v_id    uuid;
  v_report jsonb;
  v_result jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'config', true);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'E_%:%', v_perm->>'code', p_command_name;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.bn_means_policy_idempotency
     WHERE idempotency_key = p_idempotency_key AND command_name = p_command_name;
    IF FOUND THEN
      IF v_prior.payload_hash <> COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH:%', p_command_name;
      END IF;
      RETURN v_prior.result_json || jsonb_build_object('status','REPLAYED');
    END IF;
  END IF;

  IF p_policy_id IS NOT NULL THEN
    SELECT * INTO p FROM public.bn_means_policy WHERE policy_id = p_policy_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:policy'; END IF;
  END IF;
  IF p_policy_version_id IS NOT NULL THEN
    SELECT * INTO v FROM public.bn_means_policy_version WHERE policy_version_id = p_policy_version_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:policy version'; END IF;
    IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v.row_version THEN
      RAISE EXCEPTION 'E_STALE_ROW_VERSION:expected=% actual=%', p_expected_row_version, v.row_version;
    END IF;
    IF p.policy_id IS NULL THEN
      SELECT * INTO p FROM public.bn_means_policy WHERE policy_id = v.policy_id FOR UPDATE;
    END IF;
  ELSIF p_policy_id IS NOT NULL AND p_expected_row_version IS NOT NULL
        AND p_expected_row_version <> p.row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION:expected=% actual=%', p_expected_row_version, p.row_version;
  END IF;

  IF p_command_name = 'CREATE_POLICY' THEN
    IF COALESCE(btrim(p_payload->>'policy_code'),'') = ''
       OR COALESCE(btrim(p_payload->>'policy_name'),'') = ''
       OR COALESCE(btrim(p_payload->>'benefit_programme'),'') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:policy code, name and benefit programme are required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bn_product pr WHERE pr.benefit_code = p_payload->>'benefit_programme') THEN
      RAISE EXCEPTION 'E_PROGRAMME_UNKNOWN:%', p_payload->>'benefit_programme';
    END IF;
    BEGIN
      INSERT INTO public.bn_means_policy(policy_code, policy_name, benefit_programme,
        authority_reference, status, created_by, updated_by)
      VALUES (upper(btrim(p_payload->>'policy_code')), btrim(p_payload->>'policy_name'),
        p_payload->>'benefit_programme', NULLIF(btrim(COALESCE(p_payload->>'authority_reference','')),''),
        'DRAFT', p_actor_user_id, p_actor_user_id)
      RETURNING policy_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'E_DUPLICATE_POLICY_CODE:%', p_payload->>'policy_code';
    END;
    v_result := jsonb_build_object('policy_id', v_id);

  ELSIF p_command_name = 'UPDATE_DRAFT_POLICY' THEN
    IF p.policy_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy'; END IF;
    IF p.status = 'RETIRED' THEN RAISE EXCEPTION 'E_INVALID_STATE:the policy is retired'; END IF;
    UPDATE public.bn_means_policy SET
      policy_name = COALESCE(NULLIF(btrim(p_payload->>'policy_name'),''), policy_name),
      authority_reference = CASE WHEN p_payload ? 'authority_reference'
                                 THEN NULLIF(btrim(COALESCE(p_payload->>'authority_reference','')),'')
                                 ELSE authority_reference END,
      benefit_programme = CASE
        WHEN p.status = 'DRAFT' AND NULLIF(btrim(COALESCE(p_payload->>'benefit_programme','')),'') IS NOT NULL
        THEN p_payload->>'benefit_programme' ELSE benefit_programme END,
      row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_id = p.policy_id;
    v_result := jsonb_build_object('policy_id', p.policy_id);

  ELSIF p_command_name = 'ACTIVATE_POLICY' THEN
    IF p.policy_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy'; END IF;
    IF p.status = 'RETIRED' THEN RAISE EXCEPTION 'E_INVALID_STATE:the policy is retired'; END IF;
    UPDATE public.bn_means_policy SET status='ACTIVE', row_version = row_version + 1,
      updated_at = now(), updated_by = p_actor_user_id WHERE policy_id = p.policy_id;
    v_result := jsonb_build_object('policy_id', p.policy_id, 'status','ACTIVE');

  ELSIF p_command_name = 'RETIRE_POLICY' THEN
    IF p.policy_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy'; END IF;
    IF EXISTS (SELECT 1 FROM public.bn_means_policy_version v2
                WHERE v2.policy_id = p.policy_id AND v2.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:supersede or retire the active version first';
    END IF;
    UPDATE public.bn_means_policy SET status='RETIRED', row_version = row_version + 1,
      updated_at = now(), updated_by = p_actor_user_id WHERE policy_id = p.policy_id;
    v_result := jsonb_build_object('policy_id', p.policy_id, 'status','RETIRED');

  ELSIF p_command_name = 'CREATE_POLICY_VERSION' THEN
    IF p.policy_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy'; END IF;
    IF p.status = 'RETIRED' THEN RAISE EXCEPTION 'E_INVALID_STATE:the policy is retired'; END IF;
    IF COALESCE(btrim(p_payload->>'version_label'),'') = '' OR NULLIF(p_payload->>'effective_from','') IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:version label and effective-from date are required';
    END IF;
    BEGIN
      INSERT INTO public.bn_means_policy_version(
        policy_id, version_label, effective_from, effective_to, currency_code,
        rounding_method, rounding_scale, validity_months, reassessment_months,
        authority_reference, household_rules, income_rules, asset_rules, deduction_rules,
        decision_rules, threshold_parameters, required_evidence, status, created_by, updated_by)
      VALUES (
        p.policy_id, btrim(p_payload->>'version_label'),
        (p_payload->>'effective_from')::date,
        NULLIF(p_payload->>'effective_to','')::date,
        upper(COALESCE(NULLIF(btrim(COALESCE(p_payload->>'currency_code','')),''),'XCD')),
        COALESCE(NULLIF(p_payload->>'rounding_method',''),'HALF_UP'),
        COALESCE(NULLIF(p_payload->>'rounding_scale','')::int, 2),
        NULLIF(p_payload->>'validity_months','')::int,
        NULLIF(p_payload->>'reassessment_months','')::int,
        NULLIF(btrim(COALESCE(p_payload->>'authority_reference','')),''),
        COALESCE(p_payload->'household_rules','{}'::jsonb),
        COALESCE(p_payload->'income_rules','{}'::jsonb),
        COALESCE(p_payload->'asset_rules','{}'::jsonb),
        COALESCE(p_payload->'deduction_rules','{}'::jsonb),
        COALESCE(p_payload->'decision_rules','{}'::jsonb),
        COALESCE(p_payload->'threshold_parameters','{}'::jsonb),
        COALESCE(p_payload->'required_evidence','[]'::jsonb),
        'DRAFT', p_actor_user_id, p_actor_user_id)
      RETURNING policy_version_id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'E_DUPLICATE_VERSION_LABEL:%', p_payload->>'version_label';
    END;
    -- optional controlled copy of an existing version's categories
    IF NULLIF(p_payload->>'copy_from_version_id','') IS NOT NULL THEN
      INSERT INTO public.bn_means_policy_category(policy_version_id, category_kind, category_code,
        category_name, is_assessable, disregard_rule, requires_evidence, display_order)
      SELECT v_id, c.category_kind, c.category_code, c.category_name, c.is_assessable,
             c.disregard_rule, c.requires_evidence, c.display_order
        FROM public.bn_means_policy_category c
       WHERE c.policy_version_id = (p_payload->>'copy_from_version_id')::uuid;
    END IF;
    v_result := jsonb_build_object('policy_version_id', v_id, 'policy_id', p.policy_id);

  ELSIF p_command_name = 'UPDATE_DRAFT_VERSION' THEN
    IF v.policy_version_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy version'; END IF;
    IF v.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'E_VERSION_NOT_EDITABLE:an active or closed version cannot be edited — create a new version';
    END IF;
    UPDATE public.bn_means_policy_version SET
      version_label = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'version_label','')),''), version_label),
      effective_from = COALESCE(NULLIF(p_payload->>'effective_from','')::date, effective_from),
      effective_to = CASE WHEN p_payload ? 'effective_to'
                          THEN NULLIF(p_payload->>'effective_to','')::date ELSE effective_to END,
      currency_code = COALESCE(upper(NULLIF(btrim(COALESCE(p_payload->>'currency_code','')),'')), currency_code),
      rounding_method = COALESCE(NULLIF(p_payload->>'rounding_method',''), rounding_method),
      rounding_scale = COALESCE(NULLIF(p_payload->>'rounding_scale','')::int, rounding_scale),
      validity_months = CASE WHEN p_payload ? 'validity_months'
                             THEN NULLIF(p_payload->>'validity_months','')::int ELSE validity_months END,
      reassessment_months = CASE WHEN p_payload ? 'reassessment_months'
                             THEN NULLIF(p_payload->>'reassessment_months','')::int ELSE reassessment_months END,
      authority_reference = CASE WHEN p_payload ? 'authority_reference'
                             THEN NULLIF(btrim(COALESCE(p_payload->>'authority_reference','')),'') ELSE authority_reference END,
      household_rules = COALESCE(p_payload->'household_rules', household_rules),
      income_rules = COALESCE(p_payload->'income_rules', income_rules),
      asset_rules = COALESCE(p_payload->'asset_rules', asset_rules),
      deduction_rules = COALESCE(p_payload->'deduction_rules', deduction_rules),
      decision_rules = COALESCE(p_payload->'decision_rules', decision_rules),
      threshold_parameters = COALESCE(p_payload->'threshold_parameters', threshold_parameters),
      required_evidence = COALESCE(p_payload->'required_evidence', required_evidence),
      validation_state = 'NOT_VALIDATED', validated_at = NULL, validation_report = '{}'::jsonb,
      row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_version_id = v.policy_version_id;
    v_result := jsonb_build_object('policy_version_id', v.policy_version_id);

  ELSIF p_command_name = 'UPSERT_CATEGORY' THEN
    IF v.policy_version_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy version'; END IF;
    IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'E_VERSION_NOT_EDITABLE:categories can only be changed on a draft version'; END IF;
    IF COALESCE(p_payload->>'category_kind','') NOT IN ('INCOME','ASSET','DEDUCTION')
       OR COALESCE(btrim(p_payload->>'category_code'),'') = ''
       OR COALESCE(btrim(p_payload->>'category_name'),'') = '' THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:category kind, code and name are required';
    END IF;
    INSERT INTO public.bn_means_policy_category(policy_version_id, category_kind, category_code,
      category_name, is_assessable, disregard_rule, requires_evidence, display_order)
    VALUES (v.policy_version_id, p_payload->>'category_kind', upper(btrim(p_payload->>'category_code')),
      btrim(p_payload->>'category_name'), COALESCE((p_payload->>'is_assessable')::boolean, true),
      COALESCE(p_payload->'disregard_rule','{}'::jsonb),
      COALESCE((p_payload->>'requires_evidence')::boolean, false),
      COALESCE(NULLIF(p_payload->>'display_order','')::int, 0))
    ON CONFLICT (policy_version_id, category_kind, category_code) DO UPDATE SET
      category_name = EXCLUDED.category_name,
      is_assessable = EXCLUDED.is_assessable,
      disregard_rule = EXCLUDED.disregard_rule,
      requires_evidence = EXCLUDED.requires_evidence,
      display_order = EXCLUDED.display_order
    RETURNING category_id INTO v_id;
    UPDATE public.bn_means_policy_version
       SET validation_state='NOT_VALIDATED', validated_at=NULL, validation_report='{}'::jsonb,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_version_id = v.policy_version_id;
    v_result := jsonb_build_object('category_id', v_id, 'policy_version_id', v.policy_version_id);

  ELSIF p_command_name = 'DELETE_CATEGORY' THEN
    IF v.policy_version_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy version'; END IF;
    IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'E_VERSION_NOT_EDITABLE:categories can only be changed on a draft version'; END IF;
    DELETE FROM public.bn_means_policy_category
     WHERE policy_version_id = v.policy_version_id
       AND category_id = NULLIF(p_payload->>'category_id','')::uuid;
    UPDATE public.bn_means_policy_version
       SET validation_state='NOT_VALIDATED', validated_at=NULL, validation_report='{}'::jsonb,
           row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_version_id = v.policy_version_id;
    v_result := jsonb_build_object('policy_version_id', v.policy_version_id);

  ELSIF p_command_name = 'VALIDATE_VERSION' THEN
    IF v.policy_version_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy version'; END IF;
    v_report := public._bn_means_policy_validate(v.policy_version_id);
    UPDATE public.bn_means_policy_version SET
      validation_state = CASE WHEN COALESCE((v_report->>'can_activate')::boolean,false) THEN 'READY' ELSE 'BLOCKED' END,
      validated_at = now(), validation_report = v_report,
      row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_version_id = v.policy_version_id;
    v_result := jsonb_build_object('policy_version_id', v.policy_version_id, 'validation', v_report);

  ELSIF p_command_name = 'ACTIVATE_VERSION' THEN
    IF v.policy_version_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy version'; END IF;
    v_report := public._bn_means_policy_validate(v.policy_version_id);
    IF NOT COALESCE((v_report->>'can_activate')::boolean,false) THEN
      UPDATE public.bn_means_policy_version SET validation_state='BLOCKED', validated_at=now(),
             validation_report = v_report, row_version = row_version + 1, updated_at = now()
       WHERE policy_version_id = v.policy_version_id;
      RAISE EXCEPTION 'E_ACTIVATION_BLOCKED:%', COALESCE(v_report->'blockers'->0->>'code','UNKNOWN');
    END IF;
    UPDATE public.bn_means_policy_version SET status='ACTIVE', validation_state='READY',
      validated_at = now(), validation_report = v_report,
      row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_version_id = v.policy_version_id;
    UPDATE public.bn_means_policy SET status='ACTIVE', row_version = row_version + 1,
      updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_id = v.policy_id AND status <> 'ACTIVE';
    v_result := jsonb_build_object('policy_version_id', v.policy_version_id, 'status','ACTIVE',
      'validation', v_report);

  ELSIF p_command_name IN ('SUPERSEDE_VERSION','RETIRE_VERSION') THEN
    IF v.policy_version_id IS NULL THEN RAISE EXCEPTION 'E_ENTITY_REQUIRED:policy version'; END IF;
    IF v.status NOT IN ('ACTIVE','DRAFT') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is already closed', v.status;
    END IF;
    IF p_command_name = 'SUPERSEDE_VERSION' AND NULLIF(p_payload->>'successor_version_id','') IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:a successor version is required';
    END IF;
    UPDATE public.bn_means_policy_version SET
      status = CASE WHEN p_command_name = 'SUPERSEDE_VERSION' THEN 'SUPERSEDED' ELSE 'RETIRED' END,
      superseded_by = NULLIF(p_payload->>'successor_version_id','')::uuid,
      effective_to = COALESCE(NULLIF(p_payload->>'effective_to','')::date, effective_to),
      row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
     WHERE policy_version_id = v.policy_version_id;
    v_result := jsonb_build_object('policy_version_id', v.policy_version_id,
      'status', CASE WHEN p_command_name = 'SUPERSEDE_VERSION' THEN 'SUPERSEDED' ELSE 'RETIRED' END);

  ELSE
    RAISE EXCEPTION 'E_UNKNOWN_COMMAND:%', p_command_name;
  END IF;

  v_result := COALESCE(v_result,'{}'::jsonb) || jsonb_build_object('status','EXECUTED','command', p_command_name);

  INSERT INTO public.bn_means_policy_audit(command_name, policy_id, policy_version_id,
    actor_user_id, payload, result)
  VALUES (p_command_name, COALESCE(p.policy_id, NULLIF(v_result->>'policy_id','')::uuid),
    COALESCE(v.policy_version_id, NULLIF(v_result->>'policy_version_id','')::uuid),
    p_actor_user_id, COALESCE(p_payload,'{}'::jsonb), v_result);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_means_policy_idempotency(idempotency_key, command_name, payload_hash, result_json)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), v_result)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bn_means_policy_command_v1(text,jsonb,uuid,uuid,bigint,uuid,uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.bn_means_policy_command_v1(text,jsonb,uuid,uuid,bigint,uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_policy_admin_list_v1(uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_policy_admin_detail_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_policy_validation_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._bn_means_policy_validate(uuid) TO authenticated, service_role;