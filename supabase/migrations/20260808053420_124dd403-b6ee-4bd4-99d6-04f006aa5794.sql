
-- ============================================================
-- BN RISK / FRAUD — EPIC 3: control recommendation + independent approval
-- ============================================================

-- 1. Governed control catalogue -------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_risk_control_type (
  control_code text PRIMARY KEY,
  label text NOT NULL,
  description text,
  control_class text NOT NULL,
  is_benefit_affecting boolean NOT NULL DEFAULT false,
  requires_independent_approval boolean NOT NULL DEFAULT true,
  requires_justification boolean NOT NULL DEFAULT true,
  requires_effective_period boolean NOT NULL DEFAULT false,
  requires_target boolean NOT NULL DEFAULT false,
  allowed_target_types text[] NOT NULL DEFAULT '{}',
  requires_supporting_evidence boolean NOT NULL DEFAULT false,
  execution_owner text,
  execution_boundary text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bn_risk_control_type ENABLE ROW LEVEL SECURITY;

-- 2. Recommendation record -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_risk_recommendation (
  recommendation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_reference text NOT NULL,
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  cycle_no integer NOT NULL,
  assessment_row_version bigint NOT NULL,
  score_id uuid,
  score_version_no integer,
  score numeric,
  band_code text,
  band_label text,
  rule_set_id uuid,
  rule_set_code text,
  rule_set_version_no integer,
  input_fingerprint text,
  control_code text NOT NULL REFERENCES public.bn_risk_control_type(control_code),
  control_label text,
  control_class text,
  is_benefit_affecting boolean NOT NULL DEFAULT false,
  target_type text,
  target_id uuid,
  target_reference text,
  reason_code text,
  reason_label text,
  justification text,
  requested_effective_from date,
  requested_effective_to date,
  scope_note text,
  supporting_factor_ids uuid[] NOT NULL DEFAULT '{}',
  supporting_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  recommended_by_user_id uuid NOT NULL,
  recommended_by_name text,
  recommended_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING_APPROVAL',
  execution_state text NOT NULL DEFAULT 'NOT_AUTHORISED',
  decided_at timestamptz,
  decided_by_user_id uuid,
  decided_by_name text,
  decision text,
  row_version bigint NOT NULL DEFAULT 1,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_recommendation_status_ck
    CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','RETURNED','WITHDRAWN')),
  CONSTRAINT bn_risk_recommendation_exec_ck
    CHECK (execution_state IN ('NOT_AUTHORISED','AUTHORISED_PENDING_EXECUTION','NOT_APPLICABLE'))
);
ALTER TABLE public.bn_risk_recommendation ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS bn_risk_recommendation_cycle_uk
  ON public.bn_risk_recommendation(assessment_id, cycle_no);
CREATE UNIQUE INDEX IF NOT EXISTS bn_risk_recommendation_one_pending_uk
  ON public.bn_risk_recommendation(assessment_id)
  WHERE status = 'PENDING_APPROVAL';

-- 3. Decision record -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_risk_recommendation_decision (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.bn_risk_recommendation(recommendation_id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL,
  decision text NOT NULL,
  reason_code text,
  reason_label text,
  decision_notes text,
  decided_by_user_id uuid NOT NULL,
  decided_by_name text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  assessment_row_version bigint,
  resulting_assessment_status text,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_recommendation_decision_ck
    CHECK (decision IN ('APPROVE','REJECT','RETURN_FOR_REVIEW'))
);
ALTER TABLE public.bn_risk_recommendation_decision ENABLE ROW LEVEL SECURITY;

-- 4. Catalogue seed --------------------------------------------------------
INSERT INTO public.bn_risk_control_type(control_code,label,description,control_class,
  is_benefit_affecting,requires_independent_approval,requires_justification,
  requires_effective_period,requires_target,allowed_target_types,
  requires_supporting_evidence,execution_owner,execution_boundary,sort_order)
VALUES
 ('NO_ACTION','No control required','The assessment is closed out with no control applied. The signal and assessment history are retained.','NONE',false,true,true,false,false,'{}',false,'Risk','None',10),
 ('ENHANCED_VERIFICATION','Enhanced verification','Additional verification of the claimant''s circumstances before further processing.','VERIFICATION',false,true,true,false,false,'{}',false,'Risk','Risk execution boundary',20),
 ('REQUEST_DOCUMENTS','Request documents','Request further supporting documents from the claimant or a third party.','VERIFICATION',false,true,true,false,false,'{}',false,'Risk','Risk execution boundary',30),
 ('SUPERVISOR_REVIEW','Supervisor review','Escalate the assessment for supervisory review.','MONITORING',false,true,true,false,false,'{}',false,'Risk','Risk execution boundary',40),
 ('TEMPORARY_PAYMENT_HOLD','Temporary payment hold','Temporarily hold payment while the concern is resolved.','PAYMENT',true,true,true,true,true,'{AWARD,PAYMENT}',true,'Payments','Payments governed execution boundary',50),
 ('PREVENT_PROFILE_CHANGE','Prevent profile change','Restrict changes to the person or profile record while the concern is resolved.','PROFILE',true,true,true,true,true,'{PERSON}',true,'Registration','Person/profile governed execution boundary',60),
 ('RECALCULATE_CLAIM','Recalculate claim','Request a governed recalculation of the claim or award.','FINANCIAL',true,true,true,false,true,'{CLAIM,AWARD}',true,'Claims','Claim/Eligibility governed execution boundary',70),
 ('CREATE_OVERPAYMENT_REVIEW','Create overpayment review','Authorise an overpayment review referral.','FINANCIAL',true,true,true,false,true,'{AWARD,CLAIM}',true,'Overpayments','Overpayment governed execution boundary',80),
 ('CORRECT_SYSTEM_ERROR','Correct system error','Record and authorise correction of a system-caused error.','CORRECTION',false,true,true,false,false,'{}',false,'Risk','Risk execution boundary',90),
 ('CORRECT_STAFF_ERROR','Correct staff error','Record and authorise correction of a staff-caused error.','CORRECTION',false,true,true,false,false,'{}',false,'Risk','Risk execution boundary',100),
 ('REFER_TO_LEGAL','Refer to Legal','Authorise a referral to the Legal module for consideration.','REFERRAL',false,true,true,false,false,'{}',true,'Legal','Legal governed handoff boundary',110),
 ('REFER_TO_INVESTIGATION','Refer to Investigation','Authorise a referral for formal investigation.','REFERRAL',false,true,true,false,false,'{}',true,'Investigation','Investigation governed handoff boundary',120)
ON CONFLICT (control_code) DO NOTHING;

INSERT INTO public.bn_risk_reference_value(domain, code, label, description, nature, sort_order, is_active)
VALUES
 ('CONTROL_REASON','EVIDENCE_INCONSISTENCY','Evidence is inconsistent','Recorded evidence conflicts with declared circumstances.','ADVERSE',10,true),
 ('CONTROL_REASON','UNVERIFIED_CIRCUMSTANCE','Circumstances remain unverified','A material circumstance could not be verified from the evidence held.','ADVERSE',20,true),
 ('CONTROL_REASON','REPEATED_CONCERN','Repeated or linked concerns','Multiple linked signals raise a continuing concern.','ADVERSE',30,true),
 ('CONTROL_REASON','PROCESS_ERROR','Processing or system error','The concern arises from a processing or system error rather than conduct.','NEUTRAL',40,true),
 ('CONTROL_REASON','CONCERN_RESOLVED','Concern satisfactorily resolved','Evidence resolves the concern; no control is required.','MITIGATING',50,true),
 ('CONTROL_REASON','PROPORTIONATE_MONITORING','Proportionate monitoring only','A lighter monitoring control is proportionate to the concern.','NEUTRAL',60,true),
 ('DECISION_REASON','SUPPORTED_BY_EVIDENCE','Supported by the evidence','The recommendation is supported by the assessment evidence.','NEUTRAL',10,true),
 ('DECISION_REASON','PROPORTIONATE','Proportionate to the concern','The control is proportionate to the concern identified.','NEUTRAL',20,true),
 ('DECISION_REASON','INSUFFICIENT_EVIDENCE','Insufficient evidence','The evidence does not support the recommended control.','NEUTRAL',30,true),
 ('DECISION_REASON','DISPROPORTIONATE','Disproportionate control','The recommended control is disproportionate to the concern.','NEUTRAL',40,true),
 ('DECISION_REASON','FURTHER_WORK_REQUIRED','Further work required','Further review, evidence or recalculation is required first.','NEUTRAL',50,true)
ON CONFLICT DO NOTHING;

-- 5. Extend the canonical assessment state machine -------------------------
CREATE OR REPLACE FUNCTION public._bn_risk_assessment_can_transition(p_from text, p_to text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE p_from
    WHEN 'DRAFT' THEN p_to IN ('OPEN','CLOSED')
    WHEN 'OPEN' THEN p_to IN ('INFORMATION_PENDING','REVIEW','CLOSED')
    WHEN 'INFORMATION_PENDING' THEN p_to IN ('REVIEW','CLOSED')
    WHEN 'REVIEW' THEN p_to IN ('RECOMMENDATION','INFORMATION_PENDING')
    WHEN 'RECOMMENDATION' THEN p_to IN ('APPROVAL_PENDING','REVIEW')
    WHEN 'APPROVAL_PENDING' THEN p_to IN ('CONTROL_ACTION','REFERRED','REVIEW','RECOMMENDATION')
    ELSE false END;
$function$;

-- 6. Helpers ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bn_risk_next_recommendation_reference()
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT 'RC-' || to_char(now(),'YYYY') || '-' ||
         lpad(((SELECT count(*) FROM public.bn_risk_recommendation
                 WHERE date_part('year', created_at) = date_part('year', now())) + 1)::text, 6, '0');
$function$;

CREATE OR REPLACE FUNCTION public._bn_risk_control_json(p_code text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(t) FROM public.bn_risk_control_type t WHERE t.control_code = p_code;
$function$;

-- 7. Recommendation readiness ---------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_recommendation_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_cur public.bn_risk_score%ROWTYPE;
  v_rs public.bn_risk_scoring_rule_set%ROWTYPE; v_pending public.bn_risk_recommendation%ROWTYPE;
  v_b text[] := '{}'; v_w text[] := '{}'; v_write boolean; v_stale boolean := false;
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
  SELECT * INTO v_cur FROM public.bn_risk_score
   WHERE assessment_id = p_assessment_id AND status='CURRENT';
  SELECT * INTO v_rs FROM public._bn_risk_active_rule_set();
  SELECT * INTO v_pending FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND status = 'PENDING_APPROVAL';

  IF v_a.status <> 'RECOMMENDATION' THEN
    v_b := v_b || 'Only an assessment at the recommendation stage can record a control recommendation.';
  END IF;
  IF v_a.scoring_review_completed_at IS NULL THEN
    v_b := v_b || 'The scoring review must be completed before a control can be recommended.';
  END IF;
  IF v_cur.score_id IS NULL THEN
    v_b := v_b || 'A current risk score is required before a control can be recommended.';
  ELSIF v_rs.rule_set_id IS NULL THEN
    v_b := v_b || 'Risk scoring configuration is incomplete.';
  ELSE
    v_stale := v_cur.input_fingerprint IS DISTINCT FROM
               public._bn_risk_score_fingerprint(p_assessment_id, v_rs.rule_set_id);
    IF v_stale THEN
      v_b := v_b || 'The risk score is out of date and must be recalculated before recommending a control.';
    END IF;
    IF v_cur.rule_set_id <> v_rs.rule_set_id THEN
      v_b := v_b || 'The score was produced by a scoring configuration that is no longer in force.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_risk_information_request
              WHERE assessment_id=p_assessment_id AND is_blocking
                AND status NOT IN ('RESOLVED','CANCELLED')) THEN
    v_b := v_b || 'An outstanding blocking information request must be resolved first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_risk_evidence_link
              WHERE assessment_id=p_assessment_id AND status='LINKED'
                AND usability_code IS NULL) THEN
    v_w := v_w || 'Some linked evidence has not been assessed for usability.';
  END IF;
  IF v_pending.recommendation_id IS NOT NULL THEN
    v_b := v_b || 'A recommendation is already awaiting independent approval.';
  END IF;
  IF NOT v_write THEN
    v_b := v_b || 'You do not have permission to recommend a control.';
  END IF;
  IF v_cur.score_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.bn_risk_factor WHERE assessment_id=p_assessment_id
        AND status='ACTIVE' AND direction_code='REDUCES_CONCERN') THEN
    v_w := v_w || 'No mitigating factor has been recorded. Consider whether one applies.';
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'can_recommend', (array_length(v_b,1) IS NULL),
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'has_pending_recommendation', (v_pending.recommendation_id IS NOT NULL),
    'pending_recommendation_id', v_pending.recommendation_id,
    'score', jsonb_build_object(
      'score_id', v_cur.score_id, 'score', v_cur.score, 'version_no', v_cur.version_no,
      'band_code', v_cur.band_code, 'band_label', v_cur.band_label,
      'rule_set_code', v_cur.rule_set_code, 'rule_set_version_no', v_cur.rule_set_version_no,
      'is_stale', v_stale),
    'control_options', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order)
        FROM public.bn_risk_control_type t WHERE t.is_active), '[]'::jsonb),
    'reason_options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', r.code,'label', r.label,
                                          'description', r.description,'nature', r.nature)
                       ORDER BY r.sort_order)
        FROM public.bn_risk_reference_value r
       WHERE r.domain='CONTROL_REASON' AND r.is_active), '[]'::jsonb),
    'supporting_factors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('factor_id', f.factor_id,
               'factor_reference', f.factor_reference, 'label', f.factor_type_label,
               'direction_code', f.direction_code, 'summary', f.summary)
             ORDER BY f.created_at)
        FROM public.bn_risk_factor f
       WHERE f.assessment_id=p_assessment_id AND f.status='ACTIVE'), '[]'::jsonb),
    'supporting_evidence', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('evidence_link_id', e.evidence_link_id,
               'label', e.evidence_label, 'usability_code', e.usability_code)
             ORDER BY e.created_at)
        FROM public.bn_risk_evidence_link e
       WHERE e.assessment_id=p_assessment_id AND e.status='LINKED'), '[]'::jsonb)));
END; $function$;

-- 8. Approval readiness ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_control_approval_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_r public.bn_risk_recommendation%ROWTYPE;
  v_cur public.bn_risk_score%ROWTYPE; v_rs public.bn_risk_scoring_rule_set%ROWTYPE;
  v_b text[] := '{}'; v_w text[] := '{}'; v_decide boolean; v_self boolean := false;
  v_stale boolean := false; v_state text;
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
  SELECT * INTO v_r FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND status='PENDING_APPROVAL';
  SELECT * INTO v_cur FROM public.bn_risk_score
   WHERE assessment_id = p_assessment_id AND status='CURRENT';
  SELECT * INTO v_rs FROM public._bn_risk_active_rule_set();

  IF v_r.recommendation_id IS NULL THEN
    v_state := 'NO_PENDING_DECISION';
    v_b := v_b || 'There is no recommendation awaiting a decision.';
  ELSE
    v_self := (v_r.recommended_by_user_id = p_actor_user_id);
    IF v_a.status <> 'APPROVAL_PENDING' THEN
      v_b := v_b || 'This assessment is not awaiting an approval decision.';
    END IF;
    IF v_a.row_version <> v_r.assessment_row_version THEN
      v_stale := true;
      v_b := v_b || 'Assessment information changed after this recommendation. Return it for review and submit a new recommendation.';
    END IF;
    IF v_cur.score_id IS NULL OR v_cur.score_id <> v_r.score_id THEN
      v_stale := true;
      v_b := v_b || 'The risk score changed after this recommendation was made.';
    ELSIF v_rs.rule_set_id IS NULL
       OR v_cur.input_fingerprint IS DISTINCT FROM
          public._bn_risk_score_fingerprint(p_assessment_id, v_rs.rule_set_id) THEN
      v_stale := true;
      v_b := v_b || 'The risk score is out of date. Return the recommendation for review.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bn_risk_control_type
                    WHERE control_code = v_r.control_code AND is_active) THEN
      v_b := v_b || 'The recommended control is no longer available.';
    END IF;
    IF v_self THEN
      v_b := v_b || 'Independent approval is required. You cannot approve your own recommendation.';
    END IF;
    IF NOT v_decide THEN
      v_b := v_b || 'You do not have permission to decide control recommendations.';
    END IF;
    v_state := CASE
      WHEN v_self THEN 'SELF_APPROVAL_DENIED'
      WHEN v_stale THEN 'STALE'
      WHEN array_length(v_b,1) IS NULL THEN 'READY_TO_DECIDE'
      ELSE 'PENDING_APPROVAL' END;
    IF v_r.is_benefit_affecting THEN
      v_w := v_w || 'Approval authorises the control for later governed execution. This screen does not execute the benefit action.';
    END IF;
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'state', v_state,
    'can_decide', (v_r.recommendation_id IS NOT NULL AND array_length(v_b,1) IS NULL),
    'can_approve', (v_r.recommendation_id IS NOT NULL AND array_length(v_b,1) IS NULL),
    'can_reject', (v_r.recommendation_id IS NOT NULL AND v_decide AND NOT v_self),
    'can_return', (v_r.recommendation_id IS NOT NULL AND v_decide AND NOT v_self),
    'is_self_recommendation', v_self,
    'is_stale', v_stale,
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'recommendation_id', v_r.recommendation_id,
    'recommendation_row_version', v_r.row_version,
    'decision_options', jsonb_build_array(
      jsonb_build_object('decision','APPROVE','label','Approve control'),
      jsonb_build_object('decision','REJECT','label','Reject control'),
      jsonb_build_object('decision','RETURN_FOR_REVIEW','label','Return for review')),
    'reason_options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', r.code,'label', r.label,'nature', r.nature)
                       ORDER BY r.sort_order)
        FROM public.bn_risk_reference_value r
       WHERE r.domain='DECISION_REASON' AND r.is_active), '[]'::jsonb)));
END; $function$;

-- 9. Recommendation history -----------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_recommendation_history_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'current', (SELECT to_jsonb(r) FROM public.bn_risk_recommendation r
                 WHERE r.assessment_id=p_assessment_id
                 ORDER BY r.cycle_no DESC LIMIT 1),
    'cycles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'recommendation', to_jsonb(r),
               'decisions', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.decided_at)
                                        FROM public.bn_risk_recommendation_decision d
                                       WHERE d.recommendation_id = r.recommendation_id),'[]'::jsonb))
             ORDER BY r.cycle_no DESC)
        FROM public.bn_risk_recommendation r
       WHERE r.assessment_id = p_assessment_id), '[]'::jsonb)));
END; $function$;

-- 10. Approval queue -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_control_approval_queue_v1(
  p_actor_user_id uuid, p_filters jsonb, p_page integer, p_page_size integer)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_decide boolean; v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,20),1),100);
  v_search text := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  v_total int; v_rows jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_decide := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);

  SELECT count(*) INTO v_total
    FROM public.bn_risk_recommendation r
    JOIN public.bn_risk_assessment a ON a.assessment_id = r.assessment_id
   WHERE r.status = 'PENDING_APPROVAL'
     AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%');

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'recommended_at'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'assessment_id', a.assessment_id,
      'assessment_reference', a.assessment_reference,
      'person_name', public._bn_risk_person_display_name(a.person_ssn),
      'person_ssn_masked', public._bn_risk_mask_ssn(a.person_ssn),
      'programme_context', COALESCE(a.award_reference, a.claim_reference, a.primary_category_code),
      'recommended_at', r.recommended_at,
      'recommended_by_name', r.recommended_by_name,
      'is_own_recommendation', (r.recommended_by_user_id = p_actor_user_id),
      'decision_age_days', GREATEST(0, date_part('day', now() - r.recommended_at)::int),
      'assigned_team_code', a.assigned_team_code,
      'action_required', 'Control decision required',
      'action_label', CASE WHEN r.recommended_by_user_id = p_actor_user_id
                           THEN 'Awaiting independent approval'
                           ELSE 'Control decision required' END,
      -- restricted detail only for actors holding the decide permission
      'control_code', CASE WHEN v_decide THEN r.control_code ELSE NULL END,
      'control_label', CASE WHEN v_decide THEN r.control_label ELSE NULL END,
      'is_benefit_affecting', CASE WHEN v_decide THEN r.is_benefit_affecting ELSE NULL END,
      'recommendation_id', r.recommendation_id
    ) AS x
      FROM public.bn_risk_recommendation r
      JOIN public.bn_risk_assessment a ON a.assessment_id = r.assessment_id
     WHERE r.status='PENDING_APPROVAL'
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%')
     ORDER BY r.recommended_at
     LIMIT v_size OFFSET (v_page-1)*v_size
  ) s;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
    'can_decide', v_decide));
END; $function$;

-- 11. Governed control command --------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_control_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_reason_code text,
  p_justification text, p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload,'{}'::jsonb);
  v_a public.bn_risk_assessment%ROWTYPE; v_r public.bn_risk_recommendation%ROWTYPE;
  v_cur public.bn_risk_score%ROWTYPE; v_ct public.bn_risk_control_type%ROWTYPE;
  v_ready jsonb; v_result jsonb; v_rec_id uuid; v_cycle int; v_target_type text;
  v_decision text; v_next text; v_reason_label text; v_exec text;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED: no actor'; END IF;
  IF p_command_name NOT IN ('BN_RISK_RECOMMEND_CONTROL','BN_RISK_APPROVE_CONTROL',
                            'BN_RISK_OP_WITHDRAW_RECOMMENDATION') THEN
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: %', p_command_name;
  END IF;

  IF p_command_name = 'BN_RISK_APPROVE_CONTROL' THEN
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

  -- ---------- RECOMMEND ----------
  IF p_command_name = 'BN_RISK_RECOMMEND_CONTROL' THEN
    v_ready := public.bn_risk_recommendation_readiness_v1(p_actor_user_id, p_assessment_id);
    IF v_ready->>'status' <> 'OK' THEN RAISE EXCEPTION 'E_DENIED: recommendation readiness unavailable'; END IF;
    IF NOT COALESCE((v_ready->'data'->>'can_recommend')::boolean,false) THEN
      RAISE EXCEPTION 'E_INVALID_STATE: %',
        COALESCE(v_ready->'data'->'blockers'->>0,'a control cannot be recommended for this assessment');
    END IF;

    SELECT * INTO v_ct FROM public.bn_risk_control_type
     WHERE control_code = NULLIF(btrim(COALESCE(v_payload->>'control_code','')),'') AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_INVALID_INPUT: a valid control must be selected'; END IF;

    IF v_ct.requires_justification AND btrim(COALESCE(p_justification,'')) = '' THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a justification is required for this control';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason_code,'')),'') IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a recommendation reason is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                    WHERE domain='CONTROL_REASON' AND code=p_reason_code AND is_active) THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: the recommendation reason is not recognised';
    END IF;

    v_target_type := NULLIF(btrim(COALESCE(v_payload->>'target_type','')),'');
    IF v_ct.requires_target THEN
      IF v_target_type IS NULL OR NOT (v_target_type = ANY (v_ct.allowed_target_types)) THEN
        RAISE EXCEPTION 'E_INVALID_INPUT: this control requires a valid target record';
      END IF;
      IF NULLIF(btrim(COALESCE(v_payload->>'target_id','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_INVALID_INPUT: this control requires a target record';
      END IF;
    ELSIF v_target_type IS NOT NULL AND NOT (v_target_type = ANY (v_ct.allowed_target_types)) THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: the selected target is not compatible with this control';
    END IF;
    IF v_ct.requires_effective_period
       AND NULLIF(btrim(COALESCE(v_payload->>'requested_effective_from','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: this control requires a requested effective period';
    END IF;
    IF v_ct.requires_supporting_evidence
       AND COALESCE(jsonb_array_length(COALESCE(v_payload->'supporting_evidence_ids','[]'::jsonb)),0) = 0 THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: this control requires supporting evidence references';
    END IF;

    SELECT * INTO v_cur FROM public.bn_risk_score
     WHERE assessment_id = p_assessment_id AND status='CURRENT';
    SELECT COALESCE(max(cycle_no),0)+1 INTO v_cycle FROM public.bn_risk_recommendation
     WHERE assessment_id = p_assessment_id;
    SELECT label INTO v_reason_label FROM public.bn_risk_reference_value
     WHERE domain='CONTROL_REASON' AND code=p_reason_code;

    INSERT INTO public.bn_risk_recommendation(
      recommendation_reference, assessment_id, cycle_no, assessment_row_version,
      score_id, score_version_no, score, band_code, band_label, rule_set_id, rule_set_code,
      rule_set_version_no, input_fingerprint, control_code, control_label, control_class,
      is_benefit_affecting, target_type, target_id, target_reference, reason_code, reason_label,
      justification, requested_effective_from, requested_effective_to, scope_note,
      supporting_factor_ids, supporting_evidence_ids, recommended_by_user_id, recommended_by_name,
      status, execution_state, correlation_id)
    VALUES (
      public._bn_risk_next_recommendation_reference(), p_assessment_id, v_cycle, v_a.row_version + 1,
      v_cur.score_id, v_cur.version_no, v_cur.score, v_cur.band_code, v_cur.band_label,
      v_cur.rule_set_id, v_cur.rule_set_code, v_cur.rule_set_version_no, v_cur.input_fingerprint,
      v_ct.control_code, v_ct.label, v_ct.control_class, v_ct.is_benefit_affecting,
      v_target_type, NULLIF(btrim(COALESCE(v_payload->>'target_id','')),'')::uuid,
      NULLIF(btrim(COALESCE(v_payload->>'target_reference','')),''),
      p_reason_code, v_reason_label, NULLIF(btrim(COALESCE(p_justification,'')),''),
      NULLIF(btrim(COALESCE(v_payload->>'requested_effective_from','')),'')::date,
      NULLIF(btrim(COALESCE(v_payload->>'requested_effective_to','')),'')::date,
      NULLIF(btrim(COALESCE(v_payload->>'scope_note','')),''),
      COALESCE((SELECT array_agg((e)::uuid) FROM jsonb_array_elements_text(
                  COALESCE(v_payload->'supporting_factor_ids','[]'::jsonb)) e), '{}'),
      COALESCE((SELECT array_agg((e)::uuid) FROM jsonb_array_elements_text(
                  COALESCE(v_payload->'supporting_evidence_ids','[]'::jsonb)) e), '{}'),
      p_actor_user_id, public._bn_risk_actor_name(p_actor_user_id),
      'PENDING_APPROVAL', 'NOT_AUTHORISED', p_correlation_id)
    RETURNING recommendation_id INTO v_rec_id;

    UPDATE public.bn_risk_assessment
       SET status = 'APPROVAL_PENDING', row_version = row_version + 1
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_risk_assessment_event(p_assessment_id,'CONTROL_RECOMMENDED',
      p_command_name, v_a.status, 'APPROVAL_PENDING', p_reason_code, p_justification,
      jsonb_build_object('recommendation_id', v_rec_id, 'cycle_no', v_cycle,
        'control_code', v_ct.control_code, 'score_id', v_cur.score_id,
        'score_version_no', v_cur.version_no, 'rule_set_code', v_cur.rule_set_code,
        'rule_set_version_no', v_cur.rule_set_version_no, 'executed', false),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

    PERFORM public._bn_risk_assessment_event(p_assessment_id,'CONTROL_APPROVAL_REQUESTED',
      p_command_name, 'APPROVAL_PENDING', 'APPROVAL_PENDING', NULL, NULL,
      jsonb_build_object('recommendation_id', v_rec_id),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
      'assessment_status','APPROVAL_PENDING','recommendation_id', v_rec_id,
      'cycle_no', v_cycle, 'executed', false, 'entity_version', v_a.row_version + 1);

  -- ---------- WITHDRAW (supporting operation) ----------
  ELSIF p_command_name = 'BN_RISK_OP_WITHDRAW_RECOMMENDATION' THEN
    SELECT * INTO v_r FROM public.bn_risk_recommendation
     WHERE assessment_id = p_assessment_id AND status='PENDING_APPROVAL' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_INVALID_STATE: there is no pending recommendation to withdraw'; END IF;
    IF v_r.recommended_by_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'E_DENIED: only the recommending officer may withdraw this recommendation';
    END IF;

    UPDATE public.bn_risk_recommendation
       SET status='WITHDRAWN', row_version = row_version + 1
     WHERE recommendation_id = v_r.recommendation_id;
    UPDATE public.bn_risk_assessment
       SET status='RECOMMENDATION', row_version = row_version + 1
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_risk_assessment_event(p_assessment_id,'RECOMMENDATION_WITHDRAWN',
      p_command_name, v_a.status, 'RECOMMENDATION', p_reason_code, p_justification,
      jsonb_build_object('recommendation_id', v_r.recommendation_id),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
      'assessment_status','RECOMMENDATION','recommendation_id', v_r.recommendation_id,
      'entity_version', v_a.row_version + 1);

  -- ---------- APPROVE / REJECT / RETURN ----------
  ELSE
    v_decision := upper(NULLIF(btrim(COALESCE(v_payload->>'decision','')),''));
    IF v_decision NOT IN ('APPROVE','REJECT','RETURN_FOR_REVIEW') THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a supported decision must be selected';
    END IF;

    SELECT * INTO v_r FROM public.bn_risk_recommendation
     WHERE assessment_id = p_assessment_id AND status='PENDING_APPROVAL' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_INVALID_STATE: there is no recommendation awaiting a decision';
    END IF;
    IF v_r.recommended_by_user_id = p_actor_user_id THEN
      RAISE EXCEPTION 'E_DENIED: independent approval is required; you cannot decide your own recommendation';
    END IF;

    v_ready := public.bn_risk_control_approval_readiness_v1(p_actor_user_id, p_assessment_id);
    IF v_ready->>'status' <> 'OK' THEN RAISE EXCEPTION 'E_DENIED: approval readiness unavailable'; END IF;
    IF v_decision = 'APPROVE'
       AND NOT COALESCE((v_ready->'data'->>'can_approve')::boolean,false) THEN
      RAISE EXCEPTION 'E_INVALID_STATE: %',
        COALESCE(v_ready->'data'->'blockers'->>0,'this recommendation cannot be approved');
    END IF;
    IF v_decision <> 'APPROVE' AND COALESCE((v_ready->'data'->>'is_self_recommendation')::boolean,false) THEN
      RAISE EXCEPTION 'E_DENIED: independent approval is required';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason_code,'')),'') IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a decision reason is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                    WHERE domain='DECISION_REASON' AND code=p_reason_code AND is_active) THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: the decision reason is not recognised';
    END IF;
    SELECT * INTO v_ct FROM public.bn_risk_control_type WHERE control_code = v_r.control_code;

    v_next := CASE v_decision
      WHEN 'APPROVE' THEN CASE WHEN v_ct.control_class = 'REFERRAL' THEN 'REFERRED' ELSE 'CONTROL_ACTION' END
      WHEN 'REJECT' THEN 'REVIEW'
      ELSE 'RECOMMENDATION' END;
    IF NOT public._bn_risk_assessment_can_transition(v_a.status, v_next) THEN
      RAISE EXCEPTION 'E_INVALID_STATE: this assessment cannot move to % from %', v_next, v_a.status;
    END IF;

    v_exec := CASE
      WHEN v_decision <> 'APPROVE' THEN 'NOT_AUTHORISED'
      WHEN v_ct.control_code = 'NO_ACTION' THEN 'NOT_APPLICABLE'
      ELSE 'AUTHORISED_PENDING_EXECUTION' END;
    SELECT label INTO v_reason_label FROM public.bn_risk_reference_value
     WHERE domain='DECISION_REASON' AND code=p_reason_code;

    UPDATE public.bn_risk_recommendation
       SET status = CASE v_decision WHEN 'APPROVE' THEN 'APPROVED'
                                    WHEN 'REJECT' THEN 'REJECTED' ELSE 'RETURNED' END,
           execution_state = v_exec,
           decision = v_decision,
           decided_at = now(),
           decided_by_user_id = p_actor_user_id,
           decided_by_name = public._bn_risk_actor_name(p_actor_user_id),
           row_version = row_version + 1
     WHERE recommendation_id = v_r.recommendation_id;

    INSERT INTO public.bn_risk_recommendation_decision(
      recommendation_id, assessment_id, decision, reason_code, reason_label, decision_notes,
      decided_by_user_id, decided_by_name, assessment_row_version,
      resulting_assessment_status, correlation_id)
    VALUES (v_r.recommendation_id, p_assessment_id, v_decision, p_reason_code, v_reason_label,
      NULLIF(btrim(COALESCE(p_justification,'')),''), p_actor_user_id,
      public._bn_risk_actor_name(p_actor_user_id), v_a.row_version + 1, v_next, p_correlation_id);

    UPDATE public.bn_risk_assessment
       SET status = v_next, row_version = row_version + 1
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_risk_assessment_event(p_assessment_id,
      CASE v_decision WHEN 'APPROVE' THEN 'CONTROL_APPROVED'
                      WHEN 'REJECT' THEN 'CONTROL_REJECTED'
                      ELSE 'CONTROL_RETURNED_FOR_REVIEW' END,
      p_command_name, v_a.status, v_next, p_reason_code, p_justification,
      jsonb_build_object('recommendation_id', v_r.recommendation_id,
        'control_code', v_r.control_code, 'decision', v_decision,
        'score_id', v_r.score_id, 'score_version_no', v_r.score_version_no,
        'rule_set_code', v_r.rule_set_code, 'rule_set_version_no', v_r.rule_set_version_no,
        'execution_state', v_exec, 'executed', false),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version + 1);

    v_result := jsonb_build_object('status','EXECUTED','assessment_id', p_assessment_id,
      'assessment_status', v_next, 'recommendation_id', v_r.recommendation_id,
      'decision', v_decision, 'execution_state', v_exec, 'executed', false,
      'entity_version', v_a.row_version + 1);
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

-- 12. Extend governed actions ---------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_actions_v1(p_actor_user_id uuid, p_assessment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_write boolean; v_decide boolean; v_early boolean; v_ready jsonb; v_actions jsonb;
  v_score jsonb; v_review jsonb; v_rec jsonb; v_appr jsonb; v_pending boolean;
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
  v_rec := public.bn_risk_recommendation_readiness_v1(p_actor_user_id, p_assessment_id);
  v_appr := public.bn_risk_control_approval_readiness_v1(p_actor_user_id, p_assessment_id);
  v_pending := EXISTS (SELECT 1 FROM public.bn_risk_recommendation
                        WHERE assessment_id=p_assessment_id AND status='PENDING_APPROVAL'
                          AND recommended_by_user_id = p_actor_user_id);

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
      'enabled', COALESCE((v_review->'data'->>'can_complete_review')::boolean,false)),
    jsonb_build_object('action','RECOMMEND_CONTROL','label','Recommend control',
      'command','BN_RISK_RECOMMEND_CONTROL',
      'enabled', COALESCE((v_rec->'data'->>'can_recommend')::boolean,false)),
    jsonb_build_object('action','WITHDRAW_RECOMMENDATION','label','Withdraw recommendation',
      'command','BN_RISK_OP_WITHDRAW_RECOMMENDATION',
      'enabled', v_write AND v_pending),
    jsonb_build_object('action','APPROVE_CONTROL','label','Approve control',
      'command','BN_RISK_APPROVE_CONTROL',
      'enabled', COALESCE((v_appr->'data'->>'can_approve')::boolean,false)),
    jsonb_build_object('action','REJECT_CONTROL','label','Reject control',
      'command','BN_RISK_APPROVE_CONTROL',
      'enabled', COALESCE((v_appr->'data'->>'can_reject')::boolean,false)),
    jsonb_build_object('action','RETURN_CONTROL','label','Return for review',
      'command','BN_RISK_APPROVE_CONTROL',
      'enabled', COALESCE((v_appr->'data'->>'can_return')::boolean,false)));

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'row_version', v_a.row_version,
    'can_recommend', COALESCE((v_rec->'data'->>'can_recommend')::boolean,false),
    'can_approve', COALESCE((v_appr->'data'->>'can_approve')::boolean,false),
    'can_reject', COALESCE((v_appr->'data'->>'can_reject')::boolean,false),
    'can_return', COALESCE((v_appr->'data'->>'can_return')::boolean,false),
    'actions', v_actions,
    'notice', CASE
      WHEN v_a.status IN ('CONTROL_ACTION','REFERRED')
        THEN 'The control is approved and awaiting governed execution. Execution is not available in this release.'
      WHEN v_a.status NOT IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW','RECOMMENDATION','APPROVAL_PENDING')
        THEN 'This assessment has left the stages available in this release.'
      ELSE NULL END));
END; $function$;
