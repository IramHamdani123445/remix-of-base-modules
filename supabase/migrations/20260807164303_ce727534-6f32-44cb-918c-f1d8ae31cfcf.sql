-- =====================================================================
-- MEANS-TEST EPIC 11 — Activation and Eligibility Integration
-- Extends (never duplicates) the delivered activation foundation:
--   * bn_means_fact_publication          = canonical Means fact publication
--   * bn_cross_module_handoff            = governed Eligibility / Award Review boundary
--   * bn_means_event                     = business audit timeline
--   * bn_means_communication_intent      = Communication Hub boundary
-- No second eligibility engine, no award mutation, no bespoke queue.
-- =====================================================================

ALTER TABLE public.bn_means_fact_publication
  ADD COLUMN IF NOT EXISTS assessment_version_id uuid,
  ADD COLUMN IF NOT EXISTS publication_reference text,
  ADD COLUMN IF NOT EXISTS publication_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS eligibility_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN IF NOT EXISTS eligibility_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS eligibility_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS determination_status text,
  ADD COLUMN IF NOT EXISTS award_review_handoff_id uuid,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_detail text,
  ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_by uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_fact_publication_elig_ck') THEN
    ALTER TABLE public.bn_means_fact_publication
      ADD CONSTRAINT bn_means_fact_publication_elig_ck
      CHECK (eligibility_status IN ('NOT_REQUESTED','PENDING','PROCESSING','COMPLETED','FAILED','UNAVAILABLE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_bn_means_fact_publication_assessment
  ON public.bn_means_fact_publication(assessment_id, created_at DESC);

-- ---------------------------------------------------------------
-- 1. Canonical Means fact bundle (authoritative contract only)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_fact_bundle(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a  public.bn_means_assessment%ROWTYPE;
  v_c  public.bn_means_calculation%ROWTYPE;
  v_pv public.bn_means_policy_version%ROWTYPE;
  v_b  jsonb;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'refusal_reason','NO_APPROVED_ASSESSMENT');
  END IF;
  v_c := public._bn_means_latest_calculation(p_assessment_id);
  SELECT * INTO v_pv FROM public.bn_means_policy_version
   WHERE policy_version_id = v_a.policy_version_id;
  IF v_c.calculation_id IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'refusal_reason','APPROVED_CALCULATION_MISSING');
  END IF;
  IF COALESCE(v_a.valid_until, v_c.valid_until) IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'refusal_reason','VALIDITY_DATES_MISSING');
  END IF;

  -- Values come exclusively from the approved calculation + bound policy.
  v_b := jsonb_build_object(
    'means.assessment_id',     v_a.assessment_id,
    'means.assessment_status', 'ACTIVE',
    'means.policy_version',    COALESCE(v_pv.version_label, v_a.policy_version_id::text),
    'means.assessable_income', v_c.assessable_income,
    'means.assessable_assets', v_c.assessable_assets,
    'means.household_size',    v_c.household_size,
    'means.threshold',         COALESCE(v_c.threshold_amount, 0),
    'means.excess_amount',     COALESCE(v_c.excess_amount, 0),
    'means.passed',            (v_c.result = 'PASS'),
    'means.valid_until',       COALESCE(v_a.valid_until, v_c.valid_until),
    'means.reassessment_due',  COALESCE(v_a.reassessment_due, v_c.reassessment_due));

  RETURN jsonb_build_object(
    'ready', true,
    'bundle', v_b,
    'bundle_hash', encode(digest(v_b::text,'sha256'),'hex'),
    'calculation_id', v_c.calculation_id,
    'assessment_version_id', v_c.assessment_version_id,
    'result', v_c.result);
END;
$fn$;

-- ---------------------------------------------------------------
-- 2. Backend-owned activation readiness
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_activation_readiness(
  p_assessment_id uuid, p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_a    public.bn_means_assessment%ROWTYPE;
  v_av   public.bn_means_assessment_version%ROWTYPE;
  v_c    public.bn_means_calculation%ROWTYPE;
  v_pv   public.bn_means_policy_version%ROWTYPE;
  v_ap   public.bn_means_approval%ROWTYPE;
  v_pub  public.bn_means_fact_publication%ROWTYPE;
  v_ready jsonb;
  v_fact  jsonb;
  v_block jsonb := '[]'::jsonb;
  v_warn  jsonb := '[]'::jsonb;
  v_codes jsonb := '[]'::jsonb;
  v_open int := 0; v_pending int := 0;
  v_perm jsonb;
  v_state text;
  v_handoff public.bn_cross_module_handoff%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_activate', false, 'state','FAILED',
      'blockers', jsonb_build_array(jsonb_build_object('code','NOT_FOUND',
        'message','This assessment could not be found.')),
      'warnings','[]'::jsonb, 'reason_codes', jsonb_build_array('NOT_FOUND'));
  END IF;

  v_perm  := public.bn_means_check_actor_permission(p_actor_user_id, 'approve', false);
  v_av    := public._bn_means_frozen_version(p_assessment_id);
  v_c     := public._bn_means_latest_calculation(p_assessment_id);
  v_ready := public._bn_means_calculation_readiness(p_assessment_id);
  v_fact  := public._bn_means_fact_bundle(p_assessment_id);
  SELECT o.requested, o.pending_application INTO v_open, v_pending
    FROM public._bn_means_open_adjustments(p_assessment_id) o;
  SELECT * INTO v_pv FROM public.bn_means_policy_version
   WHERE policy_version_id = v_a.policy_version_id;
  SELECT * INTO v_ap FROM public.bn_means_approval
   WHERE assessment_id = p_assessment_id AND decision = 'APPROVED'
   ORDER BY decided_at DESC LIMIT 1;
  SELECT * INTO v_pub FROM public.bn_means_fact_publication
   WHERE assessment_id = p_assessment_id AND status = 'PUBLISHED'
   ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_handoff FROM public.bn_cross_module_handoff
   WHERE source_module = 'bn_means_tests' AND handoff_type = 'ELIGIBILITY_RERUN'
     AND source_record_id = v_pub.publication_id
   ORDER BY created_at DESC LIMIT 1;

  IF v_a.status IN ('ACTIVE','REASSESSMENT_DUE') THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','ALREADY_ACTIVE',
      'message','This assessment is already active.'));
    v_codes := v_codes || '"ALREADY_ACTIVE"'::jsonb;
  ELSIF v_a.status = 'UNDER_APPEAL' THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','APPEAL_IN_PROGRESS',
      'message','An appeal is in progress, so activation is not available.'));
    v_codes := v_codes || '"APPEAL_IN_PROGRESS"'::jsonb;
  ELSIF v_a.status <> 'APPROVED' THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','ASSESSMENT_NOT_APPROVED',
      'message','The assessment has not been independently approved yet.'));
    v_codes := v_codes || '"ASSESSMENT_NOT_APPROVED"'::jsonb;
  END IF;

  IF v_ap.approval_id IS NULL THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','ASSESSMENT_NOT_APPROVED',
      'message','No independent approval decision is recorded for this assessment.'));
    v_codes := v_codes || '"ASSESSMENT_NOT_APPROVED"'::jsonb;
  END IF;

  IF v_c.calculation_id IS NULL THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','APPROVED_CALCULATION_MISSING',
      'message','There is no approved calculation to publish.'));
    v_codes := v_codes || '"APPROVED_CALCULATION_MISSING"'::jsonb;
  ELSE
    IF NOT COALESCE(v_c.is_current, true) THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','APPROVED_CALCULATION_STALE',
        'message','The approved calculation is no longer the current one.'));
      v_codes := v_codes || '"APPROVED_CALCULATION_STALE"'::jsonb;
    END IF;
    IF COALESCE((v_ready->>'calculation_stale')::boolean,false) THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','APPROVED_CALCULATION_STALE',
        'message','Verification changed after the approved calculation. It must be recalculated and approved again.'));
      v_codes := v_codes || '"APPROVED_CALCULATION_STALE"'::jsonb;
    END IF;
    IF v_ap.approval_id IS NOT NULL AND v_ap.calculation_id IS NOT NULL
       AND v_ap.calculation_id IS DISTINCT FROM v_c.calculation_id THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','APPROVAL_CALCULATION_MISMATCH',
        'message','The approval does not apply to the current calculation.'));
      v_codes := v_codes || '"APPROVAL_CALCULATION_MISMATCH"'::jsonb;
    END IF;
    IF v_av.assessment_version_id IS NULL
       OR v_c.assessment_version_id IS DISTINCT FROM v_av.assessment_version_id THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','FROZEN_VERSION_TAMPERED',
        'message','The approved calculation does not belong to the frozen submitted version.'));
      v_codes := v_codes || '"FROZEN_VERSION_TAMPERED"'::jsonb;
    ELSIF v_av.snapshot_hash IS DISTINCT FROM encode(digest(v_av.snapshot::text,'sha256'),'hex') THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','FROZEN_VERSION_TAMPERED',
        'message','The frozen submitted declaration failed its integrity check.'));
      v_codes := v_codes || '"FROZEN_VERSION_TAMPERED"'::jsonb;
    END IF;
    IF v_c.result_hash IS NOT NULL
       AND v_c.result_hash <> encode(digest(jsonb_build_object(
             'input_hash', v_c.input_hash, 'engine_version', v_c.engine_version,
             'assessable_income', v_c.assessable_income,
             'assessable_assets', v_c.assessable_assets,
             'approved_deductions', v_c.approved_deductions,
             'household_size', v_c.household_size,
             'threshold_amount', v_c.threshold_amount,
             'excess_amount', v_c.excess_amount,
             'result', v_c.result,
             'currency_code', v_c.currency_code)::text,'sha256'),'hex') THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object('code','CALCULATION_HASH_MISMATCH',
        'message','The approved calculation failed its integrity check.'));
      v_codes := v_codes || '"CALCULATION_HASH_MISMATCH"'::jsonb;
    END IF;
  END IF;

  IF NOT COALESCE((v_ready->>'verification_complete')::boolean,false) THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','VERIFICATION_NO_LONGER_VALID',
      'message','Verification is no longer complete for this assessment.'));
    v_codes := v_codes || '"VERIFICATION_NO_LONGER_VALID"'::jsonb;
  END IF;

  IF COALESCE(v_open,0) > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','OPEN_ADJUSTMENT_EXISTS',
      'message', v_open || ' correction request(s) await an independent decision.'));
    v_codes := v_codes || '"OPEN_ADJUSTMENT_EXISTS"'::jsonb;
  END IF;
  IF COALESCE(v_pending,0) > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','ADJUSTMENT_APPLICATION_PENDING',
      'message', v_pending || ' approved correction(s) have not produced a calculation yet.'));
    v_codes := v_codes || '"ADJUSTMENT_APPLICATION_PENDING"'::jsonb;
  END IF;

  IF v_pv.policy_version_id IS NULL THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','POLICY_NOT_EFFECTIVE',
      'message','The means-test policy version bound to this assessment is missing.'));
    v_codes := v_codes || '"POLICY_NOT_EFFECTIVE"'::jsonb;
  ELSIF v_pv.status = 'RETIRED' THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','POLICY_RETIRED',
      'message','The policy version used for this assessment has been retired.'));
    v_codes := v_codes || '"POLICY_RETIRED"'::jsonb;
  ELSIF v_pv.status NOT IN ('ACTIVE','SUPERSEDED') THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','POLICY_NOT_EFFECTIVE',
      'message','The policy version used for this assessment is not effective.'));
    v_codes := v_codes || '"POLICY_NOT_EFFECTIVE"'::jsonb;
  ELSIF v_pv.status = 'SUPERSEDED' THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','POLICY_SUPERSEDED',
      'message','A newer policy version exists. This assessment stays bound to the version it was assessed under.'));
  END IF;

  IF NOT COALESCE((v_fact->>'ready')::boolean,false) THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','FACT_PUBLICATION_NOT_READY',
      'message','The means-test facts required by eligibility cannot be assembled yet.'));
    v_codes := v_codes || '"FACT_PUBLICATION_NOT_READY"'::jsonb;
  END IF;

  IF COALESCE(v_a.valid_until, v_c.valid_until) IS NOT NULL
     AND COALESCE(v_a.valid_until, v_c.valid_until) < CURRENT_DATE THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','VALIDITY_EXPIRED',
      'message','The approved validity period has already ended.'));
    v_codes := v_codes || '"VALIDITY_EXPIRED"'::jsonb;
  END IF;

  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object('code','PERMISSION_DENIED',
      'message','You do not have permission to activate a means-test assessment.'));
    v_codes := v_codes || '"PERMISSION_DENIED"'::jsonb;
  END IF;

  IF v_c.result IS DISTINCT FROM 'PASS' THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','RESULT_NOT_PASS',
      'message','The approved result is not a pass. Eligibility will consume the published facts and decide the outcome.'));
  END IF;

  v_state := CASE
    WHEN v_a.status IN ('ACTIVE','REASSESSMENT_DUE') THEN 'ACTIVE'
    WHEN NOT COALESCE((v_perm->>'ok')::boolean,false) THEN 'DENIED'
    WHEN jsonb_array_length(v_block) > 0 THEN 'BLOCKED'
    ELSE 'READY' END;

  RETURN jsonb_build_object(
    'assessment_id', v_a.assessment_id,
    'assessment_version_id', v_av.assessment_version_id,
    'approved_calculation_id', v_c.calculation_id,
    'approved_calculation_current', COALESCE(v_c.is_current,false),
    'approval_valid', (v_ap.approval_id IS NOT NULL
                       AND (v_ap.calculation_id IS NULL OR v_ap.calculation_id = v_c.calculation_id)),
    'approved_result', v_c.result,
    'policy_version', COALESCE(v_pv.version_label, v_a.policy_version_id::text),
    'policy_status', v_pv.status,
    'snapshot_hash_valid', (v_av.assessment_version_id IS NOT NULL
      AND v_av.snapshot_hash = encode(digest(v_av.snapshot::text,'sha256'),'hex')),
    'calculation_hash_valid', NOT (v_codes @> '["CALCULATION_HASH_MISMATCH"]'::jsonb),
    'valid_from', COALESCE(v_a.valid_from, v_c.valid_from, v_a.effective_from),
    'valid_until', COALESCE(v_a.valid_until, v_c.valid_until),
    'reassessment_due', COALESCE(v_a.reassessment_due, v_c.reassessment_due),
    'fact_publication_ready', COALESCE((v_fact->>'ready')::boolean,false),
    'eligibility_boundary_available', to_regclass('public.bn_cross_module_handoff') IS NOT NULL,
    'existing_publication', CASE WHEN v_pub.publication_id IS NULL THEN NULL ELSE jsonb_build_object(
        'publication_id', v_pub.publication_id,
        'publication_reference', v_pub.publication_reference,
        'publication_version', v_pub.publication_version,
        'bundle_hash', v_pub.bundle_hash,
        'status', v_pub.status,
        'published_at', v_pub.published_at) END,
    'existing_eligibility_request', CASE WHEN v_handoff.handoff_id IS NULL THEN NULL ELSE jsonb_build_object(
        'handoff_id', v_handoff.handoff_id,
        'status', v_handoff.status,
        'target_reference', v_handoff.target_reference) END,
    'state', v_state,
    'can_activate', (v_state = 'READY'),
    'blockers', v_block,
    'warnings', v_warn,
    'reason_codes', v_codes);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bn_means_activation_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code',COALESCE(v_perm->>'code','FORBIDDEN'),'data',NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data',
    public._bn_means_activation_readiness(p_assessment_id, p_actor_user_id));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.bn_means_activation_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._bn_means_activation_readiness(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._bn_means_fact_bundle(uuid) TO authenticated, service_role;