-- =====================================================================
-- BN Medical Reviews — Phase 1: private helpers, guards and resolver.
-- =====================================================================

-- Authenticated actor or hard failure.
CREATE OR REPLACE FUNCTION public._bn_mr_actor()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;
  RETURN uid;
END $$;

-- Dark-launch gate. Mutations require is_enabled AND actions_enabled.
CREATE OR REPLACE FUNCTION public._bn_mr_assert_enabled()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  SELECT (is_enabled AND actions_enabled) INTO ok
    FROM public.app_modules WHERE name = 'bn_medical_review';
  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION 'E_FEATURE_DISABLED' USING ERRCODE='P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_require(p_actor uuid, p_action text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_permission(p_actor, 'bn_medical_review', p_action) OR public.is_admin(p_actor)) THEN
    RAISE EXCEPTION 'E_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_require_record(p_id uuid, p_label text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'E_NOT_FOUND:%', p_label USING ERRCODE='P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/St_Kitts')::date $$;

-- Audit: never carries diagnosis or clinical narrative.
CREATE OR REPLACE FUNCTION public._bn_mr_audit(
  p_event_code text, p_actor uuid, p_entity_id uuid, p_action text,
  p_before jsonb, p_after jsonb, p_reason text, p_correlation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.core_audit_log
    (event_code, event_name, event_category, severity, actor_user_id, module_code, domain_code,
     entity_type, entity_id, action, outcome, before_value, after_value, reason,
     correlation_id, source, is_system_generated)
  VALUES
    (p_event_code, p_event_code, 'BENEFITS', 'INFO', p_actor, 'bn_medical_review', 'benefits',
     'bn_medical_review', p_entity_id, p_action, 'SUCCESS', p_before, p_after, p_reason,
     p_correlation, 'RPC', true);
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_event(
  p_obligation uuid, p_entity_type text, p_entity_id uuid, p_event_code text,
  p_from text, p_to text, p_actor uuid, p_actor_category text,
  p_detail jsonb, p_correlation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.bn_medical_review_event
    (obligation_id, entity_type, entity_id, event_code, from_status, to_status,
     actor_user_id, actor_category, detail, correlation_id)
  VALUES (p_obligation, p_entity_type, p_entity_id, p_event_code, p_from, p_to,
          p_actor, p_actor_category, COALESCE(p_detail,'{}'::jsonb), p_correlation);
END $$;

-- Award-level access. Checked BEFORE any award context is returned, even when
-- the award carries no Medical Review obligation.
CREATE OR REPLACE FUNCTION public._bn_mr_can_access_award(p_actor uuid, p_award uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim uuid; v_code text;
BEGIN
  IF p_actor IS NULL OR p_award IS NULL THEN RETURN false; END IF;

  IF public.is_admin(p_actor)
     OR public.has_permission(p_actor, 'bn_medical_review', 'view_all_records') THEN
    RETURN true;
  END IF;

  SELECT a.bn_claim_id INTO v_claim FROM public.bn_award a WHERE a.id = p_award;
  IF v_claim IS NULL THEN RETURN false; END IF;

  v_code := public._bn_susp_user_code(p_actor);
  IF v_code IS NULL THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.bn_claim WHERE id = v_claim AND assigned_to = v_code) THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM public.bn_claim_queue_assignment q
              WHERE q.claim_id = v_claim AND COALESCE(q.is_active, true)
                AND (q.assigned_to = v_code
                     OR q.workbasket_id IN (SELECT workbasket_id FROM public.bn_workbaskets_for_user(p_actor)))) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

-- Provider identity bound to the signed-in portal user.
CREATE OR REPLACE FUNCTION public._bn_mr_provider_for_user(p_actor uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.bn_medical_provider
   WHERE portal_user_id = p_actor AND provider_status = 'ACTIVE'
   ORDER BY created_at LIMIT 1
$$;

-- Obligation-level access: Benefits scope, OR assigned provider, OR assigned
-- Board participant. Knowing a UUID never grants access.
CREATE OR REPLACE FUNCTION public._bn_mr_can_access(p_actor uuid, p_obligation uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_award uuid; v_provider uuid;
BEGIN
  IF p_actor IS NULL OR p_obligation IS NULL THEN RETURN false; END IF;

  SELECT bn_award_id INTO v_award FROM public.bn_medical_review_obligation WHERE id = p_obligation;
  IF v_award IS NULL THEN RETURN false; END IF;

  IF public._bn_mr_can_access_award(p_actor, v_award) THEN RETURN true; END IF;

  -- Assigned external/internal provider: assignment-scoped only.
  v_provider := public._bn_mr_provider_for_user(p_actor);
  IF v_provider IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.bn_medical_review_referral r
        WHERE r.obligation_id = p_obligation AND r.provider_id = v_provider
          AND r.status IN ('ISSUED','ACCEPTED','ASSESSMENT_IN_PROGRESS','REPORT_SUBMITTED','COMPLETED')) THEN
    RETURN true;
  END IF;

  -- Board participant: case-scoped only.
  IF EXISTS (
       SELECT 1 FROM public.bn_medical_board_case_participant p
       JOIN public.bn_medical_board_case c ON c.id = p.board_case_id
        WHERE c.obligation_id = p_obligation AND p.member_user_id = p_actor) THEN
    RETURN true;
  END IF;

  -- Board secretary manages sessions across the board's own cases only.
  IF public.has_permission(p_actor, 'bn_medical_review', 'manage_board_session')
     AND EXISTS (SELECT 1 FROM public.bn_medical_board_case c WHERE c.obligation_id = p_obligation) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._bn_mr_assert_access(p_actor uuid, p_obligation uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._bn_mr_can_access(p_actor, p_obligation) THEN
    RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
END $$;

-- Immutable policy snapshot written onto every obligation.
CREATE OR REPLACE FUNCTION public._bn_mr_policy_snapshot(p_policy uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(p) - 'created_at' - 'updated_at' - 'created_by' - 'updated_by'
    FROM public.bn_medical_review_policy p WHERE p.id = p_policy
$$;

-- Historical provider snapshot written onto every referral.
CREATE OR REPLACE FUNCTION public._bn_mr_provider_snapshot(p_provider uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'provider_id', p.id, 'provider_code', p.provider_code,
           'classification', p.classification, 'provider_type', p.provider_type,
           'practitioner_name', p.practitioner_name,
           'registration_number', p.registration_number,
           'licensing_authority', p.licensing_authority,
           'licence_expiry_date', p.licence_expiry_date,
           'specialties', p.specialties, 'facility_id', p.facility_id,
           'provider_status', p.provider_status,
           'verification_status', p.verification_status,
           'contract_status', p.contract_status,
           'snapshot_at', now())
    FROM public.bn_medical_provider p WHERE p.id = p_provider
$$;

-- Provider eligibility. Raises a specific code; never returns a soft result.
CREATE OR REPLACE FUNCTION public._bn_mr_assert_provider_eligible(
  p_provider uuid, p_product uuid, p_review_type text,
  p_required_specialties text[], p_as_of date, p_claim uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pr record; v_restrict jsonb;
BEGIN
  SELECT * INTO pr FROM public.bn_medical_provider WHERE id = p_provider;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'E_NOT_FOUND:provider' USING ERRCODE='P0001'; END IF;

  IF pr.provider_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'E_PROVIDER_NOT_ACTIVE:%', pr.provider_status USING ERRCODE='P0001';
  END IF;
  IF pr.verification_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'E_PROVIDER_NOT_VERIFIED' USING ERRCODE='P0001';
  END IF;
  IF pr.licence_expiry_date IS NOT NULL AND pr.licence_expiry_date < p_as_of THEN
    RAISE EXCEPTION 'E_PROVIDER_LICENCE_EXPIRED' USING ERRCODE='P0001';
  END IF;
  IF pr.effective_to IS NOT NULL AND pr.effective_to < p_as_of THEN
    RAISE EXCEPTION 'E_PROVIDER_NOT_EFFECTIVE' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM public.bn_medical_provider_approval a
       WHERE a.provider_id = p_provider AND a.is_active
         AND (a.bn_product_id IS NULL OR a.bn_product_id = p_product)
         AND (a.review_type IS NULL OR a.review_type = p_review_type)
         AND a.effective_from <= p_as_of
         AND (a.effective_to IS NULL OR a.effective_to >= p_as_of)) THEN
    RAISE EXCEPTION 'E_PROVIDER_NOT_APPROVED_FOR_PRODUCT' USING ERRCODE='P0001';
  END IF;

  IF COALESCE(array_length(p_required_specialties, 1), 0) > 0
     AND NOT (pr.specialties && p_required_specialties) THEN
    RAISE EXCEPTION 'E_PROVIDER_SPECIALTY_MISMATCH' USING ERRCODE='P0001';
  END IF;

  v_restrict := COALESCE(pr.conflict_restrictions, '{}'::jsonb);
  IF p_claim IS NOT NULL AND v_restrict ? 'excluded_claim_ids'
     AND (v_restrict -> 'excluded_claim_ids') @> to_jsonb(p_claim::text) THEN
    RAISE EXCEPTION 'E_PROVIDER_CONFLICT_RESTRICTED' USING ERRCODE='P0001';
  END IF;
END $$;

-- Shared communication adapter intent. Operational context only.
CREATE OR REPLACE FUNCTION public._bn_mr_comm(
  p_obligation uuid, p_award uuid, p_event_code text, p_recipient_category text,
  p_context jsonb, p_idem text, p_correlation uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_ctx jsonb;
BEGIN
  -- Defence in depth: strip anything clinical before it can leave the module.
  v_ctx := COALESCE(p_context, '{}'::jsonb)
             - 'clinical_narrative' - 'diagnosis' - 'medical_outcome'
             - 'impairment_percentage' - 'functional_limitations'
           || jsonb_build_object('dispatch_owner', 'shared_communication_facade');

  INSERT INTO public.bn_medical_review_communication_intent
    (obligation_id, bn_award_id, event_code, recipient_reference, recipient_category,
     context, idempotency_key, correlation_id)
  VALUES (p_obligation, p_award, p_event_code, p_award::text,
          COALESCE(p_recipient_category, 'CLAIMANT'), v_ctx, p_idem, p_correlation)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.bn_medical_review_communication_intent
     WHERE idempotency_key = p_idem;
  ELSIF p_obligation IS NOT NULL THEN
    UPDATE public.bn_medical_review_obligation
       SET communication_status = 'INTENT_RECORDED' WHERE id = p_obligation;
  END IF;
  RETURN v_id;
END $$;

-- Deterministic trigger evaluation. No dynamic SQL, no browser input.
CREATE OR REPLACE FUNCTION public._bn_mr_trigger_matches(
  p_rule_code text, p_condition jsonb, p_ctx jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_outcome text := p_ctx ->> 'medical_outcome';
BEGIN
  RETURN CASE
    WHEN p_rule_code = 'EMPLOYMENT_INJURY_CASE' THEN
      (p_ctx ->> 'review_type') = COALESCE(p_condition ->> 'review_type', 'EMPLOYMENT_INJURY')
    WHEN p_rule_code = 'PERMANENT_IMPAIRMENT' THEN
      v_outcome = 'PERMANENT_INCAPACITY' OR (p_ctx ->> 'incapacity_nature') = 'PERMANENT'
    WHEN p_rule_code = 'IMPAIRMENT_PERCENTAGE_REQUIRED' THEN
      v_outcome = 'IMPAIRMENT_PERCENTAGE_RECORDED'
      OR COALESCE((p_ctx ->> 'impairment_percentage')::numeric, -1)
         >= COALESCE((p_condition ->> 'min_percentage')::numeric, 0)
    WHEN p_rule_code = 'PERMANENT_INCAPACITY' THEN v_outcome = 'PERMANENT_INCAPACITY'
    WHEN p_rule_code = 'BENEFIT_DISCONTINUATION_RECOMMENDED' THEN v_outcome IN ('FIT_FOR_WORK','FIT_WITH_RESTRICTIONS')
    WHEN p_rule_code = 'CONFLICTING_MEDICAL_OPINIONS' THEN COALESCE((p_ctx ->> 'conflicting_opinions')::boolean, false)
    WHEN p_rule_code = 'REPEATED_TEMPORARY_EXTENSIONS' THEN
      COALESCE((p_ctx ->> 'temporary_extension_count')::int, 0)
        >= COALESCE((p_condition ->> 'max_extensions')::int, 3)
    WHEN p_rule_code IN ('LONG_DURATION_INCAPACITY','POLICY_DURATION_THRESHOLD') THEN
      COALESCE((p_ctx ->> 'duration_days')::int, 0)
        >= COALESCE((p_condition ->> 'threshold_days')::int, 365)
    WHEN p_rule_code = 'PROVIDER_UNABLE_TO_FORM_OPINION' THEN v_outcome IN ('UNABLE_TO_ASSESS','INSUFFICIENT_EVIDENCE')
    WHEN p_rule_code = 'SECOND_OPINION_RECEIVED' THEN v_outcome = 'SECOND_OPINION_RECOMMENDED'
    WHEN p_rule_code = 'OFFICER_DEPARTS_FROM_MEDICAL_RECOMMENDATION' THEN
      COALESCE((p_ctx ->> 'officer_departure')::boolean, false)
    WHEN p_rule_code = 'EXCEPTIONAL_OR_HIGH_RISK_CASE' THEN COALESCE((p_ctx ->> 'high_risk')::boolean, false)
    WHEN p_rule_code = 'MANUAL_REFERRAL_BY_AUTHORISED_OFFICER' THEN COALESCE((p_ctx ->> 'manual_referral')::boolean, false)
    WHEN p_rule_code = 'POLICY_PRODUCT_CONDITION' THEN
      (p_condition ->> 'review_reason') IS NOT DISTINCT FROM (p_ctx ->> 'review_reason')
    ELSE false
  END;
END $$;

-- =====================================================================
-- Deterministic Medical Board requirement resolver.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bn_medical_review_board_requirement_v1(
  p_obligation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public._bn_mr_actor();
  ob record; pol record; asr record; rule record;
  v_ctx jsonb; v_board_mode text;
BEGIN
  PERFORM public._bn_mr_require(v_actor, 'view');
  PERFORM public._bn_mr_assert_access(v_actor, p_obligation_id);

  SELECT * INTO ob FROM public.bn_medical_review_obligation WHERE id = p_obligation_id;
  PERFORM public._bn_mr_require_record(ob.id, 'obligation');
  SELECT * INTO pol FROM public.bn_medical_review_policy WHERE id = ob.policy_id;
  SELECT a.* INTO asr FROM public.bn_medical_review_assessment a
    WHERE a.obligation_id = p_obligation_id ORDER BY a.created_at DESC LIMIT 1;

  v_board_mode := COALESCE(ob.policy_snapshot ->> 'board_mode', pol.board_mode, 'NONE');

  IF v_board_mode = 'NONE' THEN
    RETURN jsonb_build_object('board_required', false, 'board_mode', v_board_mode,
                              'reason', 'POLICY_BOARD_MODE_NONE');
  END IF;

  IF v_board_mode IN ('ALWAYS_REQUIRED','MEDICAL_BOARD_DIRECT','FINAL_MEDICAL_AUTHORITY') THEN
    RETURN jsonb_build_object(
      'board_required', true, 'board_mode', v_board_mode,
      'trigger_rule_code', 'POLICY_PRODUCT_CONDITION', 'trigger_rule_id', NULL,
      'board_type', 'STANDARD',
      'required_specialties', to_jsonb(COALESCE(pol.required_specialties, '{}'::text[])),
      'required_quorum', 3,
      'determination_binding', COALESCE(pol.board_determination_binding, false),
      'required_completion_date', (public._bn_mr_today() + 30));
  END IF;

  -- CONDITIONAL / SECOND_LEVEL_REVIEW / CONFLICT_RESOLUTION: evaluate rules
  -- in deterministic order against a server-built fact context.
  v_ctx := jsonb_build_object(
    'review_reason', ob.review_reason,
    'review_type', ob.review_type,
    'medical_outcome', asr.medical_outcome,
    'incapacity_nature', asr.incapacity_nature,
    'impairment_percentage', asr.impairment_percentage,
    'specialist_required', COALESCE(asr.specialist_required, false),
    'further_evidence_required', COALESCE(asr.further_evidence_required, false),
    'duration_days', (public._bn_mr_today() - ob.review_period_start));

  FOR rule IN
    SELECT * FROM public.bn_medical_review_board_trigger_rule
     WHERE policy_id = ob.policy_id AND is_active
     ORDER BY evaluation_order, rule_code
  LOOP
    IF public._bn_mr_trigger_matches(rule.rule_code, rule.condition, v_ctx) THEN
      RETURN jsonb_build_object(
        'board_required', true, 'board_mode', v_board_mode,
        'trigger_rule_code', rule.rule_code, 'trigger_rule_id', rule.id,
        'board_type', rule.board_type,
        'required_specialties', to_jsonb(rule.required_specialties),
        'required_quorum', rule.required_quorum,
        'determination_binding', rule.determination_binding,
        'required_completion_date', (public._bn_mr_today() + rule.completion_offset_days));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('board_required', false, 'board_mode', v_board_mode,
                            'reason', 'NO_TRIGGER_MATCHED');
END $$;

-- Private helpers are never callable from a browser role.
DO $revoke$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE '\_bn\_mr\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$revoke$;

REVOKE ALL ON FUNCTION public.bn_medical_review_board_requirement_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_medical_review_board_requirement_v1(uuid) TO authenticated, service_role;