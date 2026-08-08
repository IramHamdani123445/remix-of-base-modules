-- ===========================================================================
-- BN RISK / FRAUD — EPIC 6: rule feedback, operational queues and reporting.
-- Feedback informs future policy review. Feedback NEVER changes scoring.
-- ===========================================================================

-- ------------------------------------------------------- 0. rule_admin action
DO $do$
DECLARE v_module uuid; v_action uuid;
BEGIN
  SELECT id INTO v_module FROM public.app_modules WHERE name = 'bn_risk_management';
  IF v_module IS NULL THEN RETURN; END IF;
  INSERT INTO public.module_actions(module_id, action_name, display_name, description, is_enabled)
  VALUES (v_module,'rule_admin','Rule administration',
          'Record structured feedback on scoring rules and signals, and review rule effectiveness.', true)
  ON CONFLICT (module_id, action_name) DO UPDATE SET is_enabled = true
  RETURNING id INTO v_action;
  IF v_action IS NULL THEN
    SELECT id INTO v_action FROM public.module_actions
     WHERE module_id = v_module AND action_name = 'rule_admin';
  END IF;
  INSERT INTO public.role_permissions(role_id, module_id, action_id, is_granted)
  SELECT r.id, v_module, v_action, true FROM public.roles r
   WHERE r.role_name IN ('Admin','Application Admin')
  ON CONFLICT DO NOTHING;
END $do$;

-- ----------------------------------------------------- 1. feedback catalogue
CREATE TABLE IF NOT EXISTS public.bn_risk_rule_feedback_type (
  feedback_code        text PRIMARY KEY,
  label                text NOT NULL,
  description          text,
  target_kind          text NOT NULL,
  classification       text NOT NULL,
  sentiment            text NOT NULL DEFAULT 'NEUTRAL',
  requires_reason      boolean NOT NULL DEFAULT true,
  requires_notes       boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  sort_order           integer NOT NULL DEFAULT 100,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_rule_feedback_type_target_ck
    CHECK (target_kind IN ('RULE','SIGNAL','FACTOR','ASSESSMENT')),
  CONSTRAINT bn_risk_rule_feedback_type_class_ck
    CHECK (classification IN ('USEFUL','FALSE_POSITIVE','DUPLICATE','SENSITIVITY',
                              'CONTEXT','EVIDENCE','CONTROL','OUTCOME','OTHER')),
  CONSTRAINT bn_risk_rule_feedback_type_sentiment_ck
    CHECK (sentiment IN ('POSITIVE','NEGATIVE','NEUTRAL'))
);
GRANT ALL ON public.bn_risk_rule_feedback_type TO service_role;
REVOKE ALL ON public.bn_risk_rule_feedback_type FROM anon, authenticated;
ALTER TABLE public.bn_risk_rule_feedback_type ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bn_risk_rule_feedback_type(feedback_code,label,description,target_kind,
  classification,sentiment,requires_reason,requires_notes,sort_order) VALUES
 ('RULE_MATCH_USEFUL','Rule match was useful',
  'The rule matched and the match genuinely helped the review.','RULE','USEFUL','POSITIVE',true,false,10),
 ('RULE_MATCH_MISLEADING','Rule match was misleading',
  'The rule matched but the match pointed the review in the wrong direction.','RULE','FALSE_POSITIVE','NEGATIVE',true,true,20),
 ('RULE_FALSE_POSITIVE','Rule produced a false positive',
  'The rule raised concern where the outcome showed no issue.','RULE','FALSE_POSITIVE','NEGATIVE',true,true,30),
 ('RULE_TOO_SENSITIVE','Rule is too sensitive',
  'The rule matches too readily for the concern it is meant to detect.','RULE','SENSITIVITY','NEGATIVE',true,true,40),
 ('RULE_TOO_INSENSITIVE','Rule is not sensitive enough',
  'The rule did not match a case where the concern was present.','RULE','SENSITIVITY','NEGATIVE',true,true,50),
 ('RULE_CONTRIBUTION_DISPROPORTIONATE','Rule contribution was disproportionate',
  'The weight the rule contributed did not reflect its importance in this case.','RULE','SENSITIVITY','NEGATIVE',true,true,60),
 ('SIGNAL_MATERIALLY_CONTRIBUTED','Signal materially contributed',
  'The signal materially contributed to the review.','SIGNAL','USEFUL','POSITIVE',true,false,70),
 ('SIGNAL_DUPLICATE_NOISE','Signal was duplicate or noise',
  'The signal duplicated an existing concern or added no information.','SIGNAL','DUPLICATE','NEGATIVE',true,false,80),
 ('SIGNAL_UNSUBSTANTIATED','Signal was ultimately unsubstantiated',
  'The concern the signal raised was not substantiated by the evidence.','SIGNAL','FALSE_POSITIVE','NEGATIVE',true,false,90),
 ('SIGNAL_OPERATIONAL_ERROR','Signal reflected an operational error',
  'The signal reflected a system, staff or data problem rather than a claimant concern.','SIGNAL','CONTEXT','NEUTRAL',true,true,100),
 ('FACTOR_USEFUL','Factor was useful',
  'The recorded factor was material to the conclusion.','FACTOR','USEFUL','POSITIVE',true,false,110),
 ('FACTOR_MISLEADING','Factor was misleading',
  'The recorded factor pointed the review in the wrong direction.','FACTOR','CONTEXT','NEGATIVE',true,true,120),
 ('MITIGATING_FACTOR_IMPORTANT','Mitigating factor was important',
  'A mitigating factor was decisive and deserves more weight in policy review.','FACTOR','CONTEXT','NEUTRAL',true,false,130),
 ('EVIDENCE_CHANGED_ASSESSMENT','Evidence changed the assessment',
  'Evidence gathered during the review changed the conclusion the score suggested.','ASSESSMENT','EVIDENCE','NEUTRAL',true,true,140),
 ('CONTROL_EFFECTIVE','Control was effective',
  'The approved control addressed the concern.','ASSESSMENT','CONTROL','POSITIVE',true,false,150),
 ('CONTROL_UNNECESSARY','Control was unnecessary',
  'The control applied was not needed for this concern.','ASSESSMENT','CONTROL','NEGATIVE',true,true,160),
 ('OUTCOME_NOT_PREDICTED','Outcome was not predicted by the score',
  'The recorded outcome differed materially from what the score suggested.','ASSESSMENT','OUTCOME','NEUTRAL',true,true,170),
 ('OTHER_POLICY_OBSERVATION','Other policy observation',
  'Another observation for policy review, described in the notes.','ASSESSMENT','OTHER','NEUTRAL',true,true,180)
ON CONFLICT (feedback_code) DO NOTHING;

INSERT INTO public.bn_risk_reference_value(domain, code, label, description, nature, sort_order, is_active) VALUES
 ('RULE_FEEDBACK_REASON','OUTCOME_CONTRADICTED_SCORE','Outcome contradicted the score','The recorded outcome did not match what the score suggested.',NULL,10,true),
 ('RULE_FEEDBACK_REASON','EVIDENCE_EXPLAINED_CONCERN','Evidence explained the concern','Evidence gathered explains the circumstance the rule detected.',NULL,20,true),
 ('RULE_FEEDBACK_REASON','KNOWN_DATA_QUALITY_ISSUE','Known data quality issue','The match arose from a known data quality problem.',NULL,30,true),
 ('RULE_FEEDBACK_REASON','PROCESS_OR_SYSTEM_ERROR','Process or system error','The match arose from a process or system error.',NULL,40,true),
 ('RULE_FEEDBACK_REASON','DUPLICATE_OF_EXISTING_CONCERN','Duplicate of an existing concern','The same concern was already under review.',NULL,50,true),
 ('RULE_FEEDBACK_REASON','THRESHOLD_APPEARS_MISALIGNED','Threshold appears misaligned','The threshold does not appear aligned to operational reality.',NULL,60,true),
 ('RULE_FEEDBACK_REASON','MATCH_DIRECTED_REVIEW_WELL','Match directed the review well','The match directed the review to the right question.',NULL,70,true),
 ('RULE_FEEDBACK_REASON','OTHER_POLICY_REASON','Other policy reason','Another reason, described in the notes.',NULL,80,true),
 ('RULE_FEEDBACK_CORRECTION_REASON','RECORDED_AGAINST_WRONG_TARGET','Recorded against the wrong target','The feedback was recorded against the wrong rule, signal or factor.',NULL,10,true),
 ('RULE_FEEDBACK_CORRECTION_REASON','CLASSIFICATION_INCORRECT','Classification was incorrect','The feedback classification does not reflect the reviewer''s view.',NULL,20,true),
 ('RULE_FEEDBACK_CORRECTION_REASON','FURTHER_INFORMATION_RECEIVED','Further information received','Information received after recording changes the feedback.',NULL,30,true)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------- 2. feedback record
CREATE TABLE IF NOT EXISTS public.bn_risk_rule_feedback (
  feedback_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_reference      text NOT NULL,
  assessment_id           uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  sequence_no             integer NOT NULL,
  outcome_id              uuid REFERENCES public.bn_risk_outcome(outcome_id),
  outcome_code            text,
  finding_classification  text,
  score_id                uuid REFERENCES public.bn_risk_score(score_id),
  score_version_no        integer,
  rule_set_id             uuid REFERENCES public.bn_risk_scoring_rule_set(rule_set_id),
  rule_set_code           text,
  rule_set_version_no     integer,
  rule_id                 uuid,
  rule_code               text,
  rule_name               text,
  contribution_id         uuid,
  contribution_outcome    text,
  contribution_value      numeric(12,2),
  factor_id               uuid,
  factor_type_code        text,
  signal_id               uuid,
  target_kind             text NOT NULL,
  target_key              text NOT NULL,
  target_label            text,
  feedback_code           text NOT NULL REFERENCES public.bn_risk_rule_feedback_type(feedback_code),
  feedback_label          text NOT NULL,
  classification          text NOT NULL,
  sentiment               text NOT NULL,
  reason_code             text,
  reason_label            text,
  notes                   text,
  status                  text NOT NULL DEFAULT 'CURRENT',
  supersedes_feedback_id  uuid REFERENCES public.bn_risk_rule_feedback(feedback_id),
  superseded_by_feedback_id uuid REFERENCES public.bn_risk_rule_feedback(feedback_id),
  superseded_at           timestamptz,
  correction_reason_code  text,
  correction_reason_label text,
  correction_justification text,
  recorded_by_user_id     uuid,
  recorded_by_name        text,
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  correlation_id          uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_rule_feedback_target_ck
    CHECK (target_kind IN ('RULE','SIGNAL','FACTOR','ASSESSMENT')),
  CONSTRAINT bn_risk_rule_feedback_status_ck
    CHECK (status IN ('CURRENT','SUPERSEDED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bn_risk_rule_feedback_dedupe_uq
  ON public.bn_risk_rule_feedback(assessment_id, target_kind, target_key, feedback_code)
  WHERE status = 'CURRENT';
CREATE INDEX IF NOT EXISTS bn_risk_rule_feedback_assessment_idx
  ON public.bn_risk_rule_feedback(assessment_id, sequence_no);
CREATE INDEX IF NOT EXISTS bn_risk_rule_feedback_rule_idx
  ON public.bn_risk_rule_feedback(rule_set_code, rule_set_version_no, rule_code);
GRANT ALL ON public.bn_risk_rule_feedback TO service_role;
REVOKE ALL ON public.bn_risk_rule_feedback FROM anon, authenticated;
ALTER TABLE public.bn_risk_rule_feedback ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._bn_risk_next_feedback_reference()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT 'RF-' || to_char(now(),'YYYY') || '-' ||
         lpad(((SELECT count(*) FROM public.bn_risk_rule_feedback) + 1)::text, 6, '0');
$fn$;

-- --------------------------------------------------- 3. feedback readiness v1
CREATE OR REPLACE FUNCTION public.bn_risk_rule_feedback_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_rule_admin boolean; v_b text[] := '{}'; v_w text[] := '{}';
  v_score public.bn_risk_score%ROWTYPE; v_outcome public.bn_risk_outcome%ROWTYPE;
  v_rules jsonb; v_signals jsonb; v_factors jsonb; v_catalogue jsonb;
  v_existing jsonb; v_state text; v_can boolean; v_reasons jsonb; v_corr jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;
  v_rule_admin := COALESCE(
    (public.bn_risk_check_actor_permission(p_actor_user_id,'rule_admin',true)->>'ok')::boolean,false);

  SELECT * INTO v_score FROM public.bn_risk_score
   WHERE assessment_id = p_assessment_id AND status = 'CURRENT';
  SELECT * INTO v_outcome FROM public.bn_risk_outcome
   WHERE assessment_id = p_assessment_id AND status = 'CURRENT';

  -- eligible rules come from the contributions of the score that was produced,
  -- never from the current definition of the rule.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'rule_id', c.rule_id, 'rule_code', c.rule_code, 'rule_name', c.rule_name,
           'contribution_id', c.contribution_id, 'contribution', c.contribution,
           'outcome', c.outcome, 'direction_code', c.direction_code,
           'direction_label', c.direction_label,
           'factor_id', c.factor_id, 'factor_type_code', c.factor_type_code,
           'rule_set_id', v_score.rule_set_id, 'rule_set_code', v_score.rule_set_code,
           'rule_set_version_no', v_score.rule_set_version_no,
           'score_id', v_score.score_id, 'score_version_no', v_score.version_no
         ) ORDER BY c.sequence_no), '[]'::jsonb)
    INTO v_rules FROM public.bn_risk_score_contribution c
   WHERE v_score.score_id IS NOT NULL AND c.score_id = v_score.score_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'signal_id', s.signal_id, 'signal_reference', s.signal_reference,
           'source_module', s.source_module, 'category_code', s.category_code,
           'rule_code', s.rule_code, 'status', s.status
         ) ORDER BY s.created_at), '[]'::jsonb)
    INTO v_signals FROM public.bn_risk_signal s
   WHERE s.signal_id IN (
     SELECT asg.signal_id FROM public.bn_risk_assessment_signal asg
      WHERE asg.assessment_id = p_assessment_id)
      OR s.signal_id = v_a.primary_signal_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'factor_id', f.factor_id, 'factor_type_code', f.factor_type_code,
           'factor_type_label', t.label, 'direction_code', f.direction_code
         ) ORDER BY f.created_at), '[]'::jsonb)
    INTO v_factors FROM public.bn_risk_factor f
    LEFT JOIN public.bn_risk_factor_type t ON t.factor_type_code = f.factor_type_code
   WHERE f.assessment_id = p_assessment_id AND COALESCE(f.status,'ACTIVE') <> 'VOID';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'feedback_code', t.feedback_code, 'label', t.label, 'description', t.description,
           'target_kind', t.target_kind, 'classification', t.classification,
           'sentiment', t.sentiment, 'requires_reason', t.requires_reason,
           'requires_notes', t.requires_notes) ORDER BY t.sort_order), '[]'::jsonb)
    INTO v_catalogue FROM public.bn_risk_rule_feedback_type t WHERE t.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'domain', r.domain, 'code', r.code, 'label', r.label,
           'description', r.description) ORDER BY r.sort_order), '[]'::jsonb)
    INTO v_reasons FROM public.bn_risk_reference_value r
   WHERE r.domain = 'RULE_FEEDBACK_REASON' AND r.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'domain', r.domain, 'code', r.code, 'label', r.label,
           'description', r.description) ORDER BY r.sort_order), '[]'::jsonb)
    INTO v_corr FROM public.bn_risk_reference_value r
   WHERE r.domain = 'RULE_FEEDBACK_CORRECTION_REASON' AND r.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'feedback_id', f.feedback_id, 'feedback_reference', f.feedback_reference,
           'sequence_no', f.sequence_no, 'target_kind', f.target_kind,
           'target_label', f.target_label, 'rule_code', f.rule_code,
           'rule_name', f.rule_name, 'rule_set_code', f.rule_set_code,
           'rule_set_version_no', f.rule_set_version_no,
           'score_version_no', f.score_version_no,
           'signal_id', f.signal_id, 'factor_id', f.factor_id,
           'feedback_code', f.feedback_code, 'feedback_label', f.feedback_label,
           'classification', f.classification, 'sentiment', f.sentiment,
           'reason_code', f.reason_code, 'reason_label', f.reason_label,
           'notes', f.notes, 'status', f.status,
           'supersedes_feedback_id', f.supersedes_feedback_id,
           'superseded_by_feedback_id', f.superseded_by_feedback_id,
           'correction_reason_label', f.correction_reason_label,
           'recorded_by_name', f.recorded_by_name, 'recorded_at', f.recorded_at
         ) ORDER BY f.sequence_no), '[]'::jsonb)
    INTO v_existing FROM public.bn_risk_rule_feedback f
   WHERE f.assessment_id = p_assessment_id;

  IF NOT v_rule_admin THEN
    v_b := v_b || 'You do not have permission to record Risk rule feedback.';
  END IF;
  IF v_a.status NOT IN ('COMPLETED','CLOSED') THEN
    v_b := v_b || 'Feedback can only be recorded once the assessment is complete or closed.';
  END IF;
  IF v_outcome.outcome_id IS NULL AND v_a.status IN ('COMPLETED','CLOSED') THEN
    v_b := v_b || 'No governed outcome is recorded for this assessment.';
  END IF;
  IF v_score.score_id IS NULL THEN
    v_w := v_w || 'This assessment has no current score, so no scoring rule can be given feedback.';
  END IF;

  v_can := (array_length(v_b,1) IS NULL);
  v_state := CASE
    WHEN NOT v_rule_admin THEN 'DENIED'
    WHEN v_a.status NOT IN ('COMPLETED','CLOSED') THEN 'NOT_ELIGIBLE'
    WHEN v_can THEN 'READY'
    ELSE 'BLOCKED' END;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'assessment_status', v_a.status,
    'state', v_state,
    'can_record_feedback', v_can,
    'can_correct_feedback', (v_can AND jsonb_array_length(v_existing) > 0),
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'scoring_provenance', CASE WHEN v_score.score_id IS NULL THEN NULL ELSE jsonb_build_object(
      'score_id', v_score.score_id, 'score_version_no', v_score.version_no,
      'score', v_score.score, 'band_code', v_score.band_code, 'band_label', v_score.band_label,
      'rule_set_id', v_score.rule_set_id, 'rule_set_code', v_score.rule_set_code,
      'rule_set_version_no', v_score.rule_set_version_no,
      'rule_set_name', v_score.rule_set_name,
      'input_fingerprint', v_score.input_fingerprint,
      'calculated_at', v_score.calculated_at) END,
    'outcome_context', CASE WHEN v_outcome.outcome_id IS NULL THEN NULL ELSE jsonb_build_object(
      'outcome_id', v_outcome.outcome_id, 'outcome_code', v_outcome.outcome_code,
      'outcome_label', v_outcome.outcome_label,
      'finding_classification', v_outcome.finding_classification,
      'is_fraud_related', v_outcome.is_fraud_related,
      'recorded_at', v_outcome.recorded_at) END,
    'eligible_rules', v_rules,
    'eligible_signals', v_signals,
    'eligible_factors', v_factors,
    'feedback_catalogue', v_catalogue,
    'reason_catalogue', v_reasons,
    'correction_reason_catalogue', v_corr,
    'existing_feedback', v_existing,
    'requires_reopen_for_feedback', false,
    'scoring_effect', 'NONE'));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_rule_feedback_readiness_v1(uuid,uuid) TO authenticated, service_role;

-- ----------------------------------------------------- 4. feedback command v1
CREATE OR REPLACE FUNCTION public.bn_risk_rule_feedback_command_v1(
  p_command_name text,
  p_actor_user_id uuid,
  p_assessment_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key uuid DEFAULT NULL,
  p_payload_hash text DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_a public.bn_risk_assessment%ROWTYPE;
  v_t public.bn_risk_rule_feedback_type%ROWTYPE;
  v_prev public.bn_risk_rule_feedback%ROWTYPE;
  v_score public.bn_risk_score%ROWTYPE;
  v_outcome public.bn_risk_outcome%ROWTYPE;
  v_contrib public.bn_risk_score_contribution%ROWTYPE;
  v_ready jsonb; v_actor text; v_id uuid; v_seq int; v_result jsonb;
  v_kind text; v_key text; v_label text; v_reason text; v_notes text;
  v_rule_id uuid; v_signal_id uuid; v_factor_id uuid; v_contrib_id uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED: you must be signed in to perform this action.';
  END IF;
  IF p_command_name NOT IN ('BN_RISK_UPDATE_RULE_FEEDBACK','BN_RISK_OP_CORRECT_RULE_FEEDBACK') THEN
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: that command is not part of the rule-feedback boundary.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.bn_risk_command_idempotency
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.command_name IS DISTINCT FROM p_command_name
         OR v_existing.payload_hash IS DISTINCT FROM COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH: this request key was already used with different details.';
      END IF;
      RETURN jsonb_set(v_existing.result_json,'{status}','"REPLAYED"'::jsonb);
    END IF;
  END IF;

  PERFORM public._bn_risk_require(p_actor_user_id,'rule_admin',true);

  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_NOT_FOUND: the Risk assessment could not be found.';
  END IF;

  v_ready := public.bn_risk_rule_feedback_readiness_v1(p_actor_user_id, p_assessment_id);
  IF NOT COALESCE((v_ready->'data'->>'can_record_feedback')::boolean,false) THEN
    RAISE EXCEPTION 'E_FEEDBACK_BLOCKED: %',
      COALESCE(v_ready->'data'->'blockers'->>0,'feedback cannot be recorded for this assessment.');
  END IF;

  SELECT * INTO v_t FROM public.bn_risk_rule_feedback_type
   WHERE feedback_code = NULLIF(btrim(COALESCE(p_payload->>'feedback_code','')),'') AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_INVALID_FEEDBACK: that feedback type is not in the governed catalogue.';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_payload->>'reason_code','')),'');
  v_notes  := NULLIF(btrim(COALESCE(p_payload->>'notes','')),'');
  IF v_t.requires_reason AND v_reason IS NULL THEN
    RAISE EXCEPTION 'E_INVALID_INPUT: a governed feedback reason is required.';
  END IF;
  IF v_reason IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.bn_risk_reference_value
        WHERE domain='RULE_FEEDBACK_REASON' AND code=v_reason AND is_active) THEN
    RAISE EXCEPTION 'E_INVALID_INPUT: that feedback reason is not in the governed catalogue.';
  END IF;
  IF v_t.requires_notes AND v_notes IS NULL THEN
    RAISE EXCEPTION 'E_INVALID_INPUT: structured notes are required for this feedback type.';
  END IF;

  v_kind := v_t.target_kind;
  v_rule_id   := NULLIF(btrim(COALESCE(p_payload->>'rule_id','')),'')::uuid;
  v_signal_id := NULLIF(btrim(COALESCE(p_payload->>'signal_id','')),'')::uuid;
  v_factor_id := NULLIF(btrim(COALESCE(p_payload->>'factor_id','')),'')::uuid;
  v_contrib_id := NULLIF(btrim(COALESCE(p_payload->>'contribution_id','')),'')::uuid;

  SELECT * INTO v_score FROM public.bn_risk_score
   WHERE assessment_id = p_assessment_id AND status = 'CURRENT';
  SELECT * INTO v_outcome FROM public.bn_risk_outcome
   WHERE assessment_id = p_assessment_id AND status = 'CURRENT';

  IF v_kind = 'RULE' THEN
    IF v_score.score_id IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: this assessment has no score, so rule feedback cannot be recorded.';
    END IF;
    IF v_contrib_id IS NOT NULL THEN
      SELECT * INTO v_contrib FROM public.bn_risk_score_contribution
       WHERE contribution_id = v_contrib_id AND score_id = v_score.score_id;
    ELSIF v_rule_id IS NOT NULL THEN
      SELECT * INTO v_contrib FROM public.bn_risk_score_contribution
       WHERE score_id = v_score.score_id AND rule_id = v_rule_id
       ORDER BY sequence_no LIMIT 1;
    END IF;
    IF v_contrib.contribution_id IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_RULE_REFERENCE: that rule did not contribute to the score this assessment was given.';
    END IF;
    v_rule_id := v_contrib.rule_id;
    v_contrib_id := v_contrib.contribution_id;
    v_key := COALESCE(v_rule_id::text, v_contrib.rule_code);
    v_label := v_contrib.rule_name;
  ELSIF v_kind = 'SIGNAL' THEN
    IF v_signal_id IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a signal must be selected for this feedback type.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bn_risk_assessment_signal
       WHERE assessment_id = p_assessment_id AND signal_id = v_signal_id
      UNION ALL
      SELECT 1 WHERE v_a.primary_signal_id = v_signal_id) THEN
      RAISE EXCEPTION 'E_INVALID_SIGNAL_REFERENCE: that signal is not linked to this assessment.';
    END IF;
    v_key := v_signal_id::text;
    SELECT signal_reference INTO v_label FROM public.bn_risk_signal WHERE signal_id = v_signal_id;
  ELSIF v_kind = 'FACTOR' THEN
    IF v_factor_id IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a factor must be selected for this feedback type.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bn_risk_factor
                    WHERE factor_id = v_factor_id AND assessment_id = p_assessment_id) THEN
      RAISE EXCEPTION 'E_INVALID_FACTOR_REFERENCE: that factor does not belong to this assessment.';
    END IF;
    v_key := v_factor_id::text;
    SELECT factor_type_code INTO v_label FROM public.bn_risk_factor WHERE factor_id = v_factor_id;
  ELSE
    v_key := 'ASSESSMENT';
    v_label := v_a.assessment_reference;
  END IF;

  v_actor := public._bn_risk_actor_name(p_actor_user_id);

  IF p_command_name = 'BN_RISK_OP_CORRECT_RULE_FEEDBACK' THEN
    SELECT * INTO v_prev FROM public.bn_risk_rule_feedback
     WHERE feedback_id = NULLIF(btrim(COALESCE(p_payload->>'feedback_id','')),'')::uuid
       AND assessment_id = p_assessment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_NOT_FOUND: the feedback record could not be found.';
    END IF;
    IF v_prev.status <> 'CURRENT' THEN
      RAISE EXCEPTION 'E_INVALID_STATE: that feedback record has already been superseded.';
    END IF;
    IF NULLIF(btrim(COALESCE(p_payload->>'correction_reason_code','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a correction reason is required.';
    END IF;
    UPDATE public.bn_risk_rule_feedback
       SET status = 'SUPERSEDED', superseded_at = now()
     WHERE feedback_id = v_prev.feedback_id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.bn_risk_rule_feedback
                WHERE assessment_id = p_assessment_id AND target_kind = v_kind
                  AND target_key = v_key AND feedback_code = v_t.feedback_code
                  AND status = 'CURRENT') THEN
      RAISE EXCEPTION 'E_DUPLICATE_FEEDBACK: that feedback has already been recorded for this target.';
    END IF;
  END IF;

  SELECT COALESCE(max(sequence_no),0) + 1 INTO v_seq
    FROM public.bn_risk_rule_feedback WHERE assessment_id = p_assessment_id;

  INSERT INTO public.bn_risk_rule_feedback(
    feedback_reference, assessment_id, sequence_no,
    outcome_id, outcome_code, finding_classification,
    score_id, score_version_no, rule_set_id, rule_set_code, rule_set_version_no,
    rule_id, rule_code, rule_name, contribution_id, contribution_outcome, contribution_value,
    factor_id, factor_type_code, signal_id,
    target_kind, target_key, target_label,
    feedback_code, feedback_label, classification, sentiment,
    reason_code, reason_label, notes, status, supersedes_feedback_id,
    correction_reason_code, correction_reason_label, correction_justification,
    recorded_by_user_id, recorded_by_name, correlation_id)
  VALUES (
    public._bn_risk_next_feedback_reference(), p_assessment_id, v_seq,
    v_outcome.outcome_id, v_outcome.outcome_code, v_outcome.finding_classification,
    v_score.score_id, v_score.version_no, v_score.rule_set_id, v_score.rule_set_code,
    v_score.rule_set_version_no,
    v_rule_id, v_contrib.rule_code, v_contrib.rule_name, v_contrib_id,
    v_contrib.outcome, v_contrib.contribution,
    v_factor_id,
    COALESCE(v_contrib.factor_type_code,
             (SELECT factor_type_code FROM public.bn_risk_factor WHERE factor_id = v_factor_id)),
    v_signal_id,
    v_kind, v_key, v_label,
    v_t.feedback_code, v_t.label, v_t.classification, v_t.sentiment,
    v_reason, public._bn_risk_ref_label('RULE_FEEDBACK_REASON', v_reason), v_notes,
    'CURRENT', v_prev.feedback_id,
    NULLIF(btrim(COALESCE(p_payload->>'correction_reason_code','')),''),
    public._bn_risk_ref_label('RULE_FEEDBACK_CORRECTION_REASON', p_payload->>'correction_reason_code'),
    NULLIF(btrim(COALESCE(p_payload->>'correction_justification','')),''),
    p_actor_user_id, v_actor, COALESCE(p_correlation_id, v_a.correlation_id))
  RETURNING feedback_id INTO v_id;

  IF v_prev.feedback_id IS NOT NULL THEN
    UPDATE public.bn_risk_rule_feedback SET superseded_by_feedback_id = v_id
     WHERE feedback_id = v_prev.feedback_id;
  END IF;

  -- Audit only. No scoring rule, band, weight, configuration version or score
  -- is created, activated or changed by this command, and no case is rescored.
  PERFORM public._bn_risk_assessment_event(p_assessment_id,
    CASE WHEN v_prev.feedback_id IS NULL THEN 'RULE_FEEDBACK_RECORDED' ELSE 'RULE_FEEDBACK_CORRECTED' END,
    p_command_name, v_a.status, v_a.status, v_reason, v_notes,
    jsonb_build_object('feedback_id', v_id, 'feedback_code', v_t.feedback_code,
      'classification', v_t.classification, 'target_kind', v_kind,
      'rule_code', v_contrib.rule_code, 'rule_set_code', v_score.rule_set_code,
      'rule_set_version_no', v_score.rule_set_version_no,
      'score_version_no', v_score.version_no, 'outcome_id', v_outcome.outcome_id,
      'previous_feedback_id', v_prev.feedback_id, 'scoring_effect','NONE'),
    p_actor_user_id, NULL, 'OFFICER', COALESCE(p_correlation_id, v_a.correlation_id), v_a.row_version);

  v_result := jsonb_build_object('status','EXECUTED','command', p_command_name,
    'feedback_id', v_id, 'assessment_status', v_a.status, 'scoring_effect','NONE',
    'business_message', CASE WHEN v_prev.feedback_id IS NULL
      THEN 'Feedback recorded for policy review. No scoring rule has changed.'
      ELSE 'Corrected feedback recorded. The previous feedback is retained.' END);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_risk_command_idempotency(
      idempotency_key, command_name, payload_hash, result_json, status,
      actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''),
            v_result, 'COMPLETED', p_actor_user_id, now())
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_rule_feedback_command_v1(text,uuid,uuid,jsonb,uuid,text,uuid)
  TO authenticated, service_role;

-- ------------------------------------------------------------ 5. period helper
CREATE OR REPLACE FUNCTION public._bn_risk_report_period(p_filters jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT CASE COALESCE(p_filters->>'period','LAST_30_DAYS')
    WHEN 'TODAY' THEN jsonb_build_object('period','TODAY','label','Today',
      'from', date_trunc('day', now()), 'to', now())
    WHEN 'LAST_7_DAYS' THEN jsonb_build_object('period','LAST_7_DAYS','label','Last 7 days',
      'from', date_trunc('day', now()) - interval '6 days', 'to', now())
    WHEN 'QUARTER' THEN jsonb_build_object('period','QUARTER','label','Current quarter',
      'from', date_trunc('quarter', now()), 'to', now())
    WHEN 'CUSTOM' THEN jsonb_build_object('period','CUSTOM','label','Selected period',
      'from', COALESCE(NULLIF(p_filters->>'from','')::timestamptz, now() - interval '30 days'),
      'to',   COALESCE(NULLIF(p_filters->>'to','')::timestamptz, now()))
    ELSE jsonb_build_object('period','LAST_30_DAYS','label','Last 30 days',
      'from', date_trunc('day', now()) - interval '29 days', 'to', now())
  END;
$fn$;

-- -------------------------------------------- 6. operational metrics v1
CREATE OR REPLACE FUNCTION public.bn_risk_operational_metrics_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_period jsonb; v_from timestamptz; v_to timestamptz;
  v_cards jsonb; v_funnel jsonb; v_signals jsonb; v_ageing jsonb; v_trend jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_period := public._bn_risk_report_period(p_filters);
  v_from := (v_period->>'from')::timestamptz;
  v_to   := (v_period->>'to')::timestamptz;

  SELECT jsonb_build_array(
    jsonb_build_object('key','NEW_SIGNALS','label','New signals','queue_key','signals',
      'value', (SELECT count(*) FROM public.bn_risk_signal WHERE status = 'NEW')),
    jsonb_build_object('key','AWAITING_TRIAGE','label','Awaiting triage','queue_key','signals',
      'value', (SELECT count(*) FROM public.bn_risk_signal WHERE status = 'NEW')),
    jsonb_build_object('key','OPEN_ASSESSMENTS','label','Open assessments','queue_key','assessments',
      'value', (SELECT count(*) FROM public.bn_risk_assessment
                 WHERE status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW','RECOMMENDATION'))),
    jsonb_build_object('key','AWAITING_INFORMATION','label','Awaiting information','queue_key','assessments',
      'value', (SELECT count(*) FROM public.bn_risk_assessment WHERE status = 'INFORMATION_PENDING')),
    jsonb_build_object('key','READY_FOR_SCORING','label','Ready for scoring','queue_key','assessments',
      'value', (SELECT count(*) FROM public.bn_risk_assessment a
                 WHERE a.status = 'REVIEW'
                   AND NOT EXISTS (SELECT 1 FROM public.bn_risk_score s
                                    WHERE s.assessment_id = a.assessment_id AND s.status='CURRENT'))),
    jsonb_build_object('key','SCORE_STALE','label','Score stale','queue_key','assessments',
      'value', (SELECT count(*) FROM public.bn_risk_assessment a
                 JOIN public.bn_risk_score s ON s.assessment_id = a.assessment_id AND s.status='CURRENT'
                 WHERE s.assessment_row_version <> a.row_version
                   AND a.status IN ('REVIEW','RECOMMENDATION'))),
    jsonb_build_object('key','RECOMMENDATION_REQUIRED','label','Recommendation required','queue_key','assessments',
      'value', (SELECT count(*) FROM public.bn_risk_assessment a
                 JOIN public.bn_risk_score s ON s.assessment_id = a.assessment_id AND s.status='CURRENT'
                 WHERE a.status IN ('REVIEW','RECOMMENDATION')
                   AND NOT EXISTS (SELECT 1 FROM public.bn_risk_recommendation r
                                    WHERE r.assessment_id = a.assessment_id
                                      AND r.status IN ('PENDING_APPROVAL','APPROVED')))),
    jsonb_build_object('key','AWAITING_APPROVAL','label','Awaiting independent approval','queue_key','control-decisions',
      'value', (SELECT count(*) FROM public.bn_risk_recommendation WHERE status = 'PENDING_APPROVAL')),
    jsonb_build_object('key','AWAITING_EXECUTION','label','Approved control awaiting execution','queue_key','control-execution',
      'value', (SELECT count(*) FROM public.bn_risk_recommendation r
                 WHERE r.status = 'APPROVED' AND r.control_code <> 'NO_ACTION'
                   AND NOT EXISTS (SELECT 1 FROM public.bn_risk_control_execution x
                                    WHERE x.recommendation_id = r.recommendation_id
                                      AND x.status IN ('PENDING','PROCESSING','ACCEPTED','COMPLETED')))),
    jsonb_build_object('key','EXECUTION_FAILED','label','Execution failed or retry required','queue_key','control-execution',
      'value', (SELECT count(*) FROM public.bn_risk_control_execution
                 WHERE status IN ('FAILED','RETRY_PENDING'))),
    jsonb_build_object('key','READY_FOR_OUTCOME','label','Ready for outcome','queue_key','outcomes',
      'value', (SELECT count(*) FROM public.bn_risk_assessment WHERE status IN ('CONTROL_ACTION','REFERRED'))),
    jsonb_build_object('key','READY_FOR_CLOSURE','label','Ready to close','queue_key','outcomes',
      'value', (SELECT count(*) FROM public.bn_risk_assessment WHERE status = 'COMPLETED'))
  ) INTO v_cards;

  SELECT jsonb_build_array(
    jsonb_build_object('stage','SIGNALS','label','Signals',
      'value', (SELECT count(*) FROM public.bn_risk_signal WHERE created_at BETWEEN v_from AND v_to)),
    jsonb_build_object('stage','ASSESSMENTS','label','Assessments',
      'value', (SELECT count(*) FROM public.bn_risk_assessment WHERE created_at BETWEEN v_from AND v_to)),
    jsonb_build_object('stage','SCORED','label','Scored',
      'value', (SELECT count(DISTINCT s.assessment_id) FROM public.bn_risk_score s
                 JOIN public.bn_risk_assessment a ON a.assessment_id = s.assessment_id
                WHERE a.created_at BETWEEN v_from AND v_to)),
    jsonb_build_object('stage','RECOMMENDED','label','Recommended',
      'value', (SELECT count(DISTINCT r.assessment_id) FROM public.bn_risk_recommendation r
                 JOIN public.bn_risk_assessment a ON a.assessment_id = r.assessment_id
                WHERE a.created_at BETWEEN v_from AND v_to)),
    jsonb_build_object('stage','APPROVED','label','Approved',
      'value', (SELECT count(DISTINCT r.assessment_id) FROM public.bn_risk_recommendation r
                 JOIN public.bn_risk_assessment a ON a.assessment_id = r.assessment_id
                WHERE r.status = 'APPROVED' AND a.created_at BETWEEN v_from AND v_to)),
    jsonb_build_object('stage','EXECUTED','label','Executed',
      'value', (SELECT count(DISTINCT x.assessment_id) FROM public.bn_risk_control_execution x
                 JOIN public.bn_risk_assessment a ON a.assessment_id = x.assessment_id
                WHERE x.status = 'COMPLETED' AND a.created_at BETWEEN v_from AND v_to)),
    jsonb_build_object('stage','OUTCOME_RECORDED','label','Outcome recorded',
      'value', (SELECT count(DISTINCT o.assessment_id) FROM public.bn_risk_outcome o
                 JOIN public.bn_risk_assessment a ON a.assessment_id = o.assessment_id
                WHERE o.status = 'CURRENT' AND a.created_at BETWEEN v_from AND v_to)),
    jsonb_build_object('stage','CLOSED','label','Closed',
      'value', (SELECT count(*) FROM public.bn_risk_assessment
                 WHERE status = 'CLOSED' AND created_at BETWEEN v_from AND v_to))
  ) INTO v_funnel;

  SELECT jsonb_build_object(
    'generated', (SELECT count(*) FROM public.bn_risk_signal
                   WHERE created_at BETWEEN v_from AND v_to AND COALESCE(created_by_source,'SYSTEM') <> 'MANUAL'),
    'manual', (SELECT count(*) FROM public.bn_risk_signal
                WHERE created_at BETWEEN v_from AND v_to AND created_by_source = 'MANUAL'),
    'triaged', (SELECT count(*) FROM public.bn_risk_signal
                 WHERE triaged_at BETWEEN v_from AND v_to),
    'dismissed', (SELECT count(*) FROM public.bn_risk_signal
                   WHERE dismissed_at BETWEEN v_from AND v_to),
    'by_source', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', source_module,
        'label', source_module, 'value', n) ORDER BY n DESC) FROM (
        SELECT COALESCE(source_module,'UNKNOWN') source_module, count(*) n
          FROM public.bn_risk_signal WHERE created_at BETWEEN v_from AND v_to
         GROUP BY 1) q), '[]'::jsonb),
    'by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', category_code,
        'label', category_code, 'value', n) ORDER BY n DESC) FROM (
        SELECT COALESCE(category_code,'UNCATEGORISED') category_code, count(*) n
          FROM public.bn_risk_signal WHERE created_at BETWEEN v_from AND v_to
         GROUP BY 1) q), '[]'::jsonb),
    'by_triage', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', status,
        'label', status, 'value', n) ORDER BY n DESC) FROM (
        SELECT status, count(*) n FROM public.bn_risk_signal
         WHERE created_at BETWEEN v_from AND v_to GROUP BY 1) q), '[]'::jsonb)
  ) INTO v_signals;

  SELECT jsonb_build_object(
    'definition','Age is measured in whole days from the moment the record entered its current operational position, to now, in the database time zone.',
    'signal_age_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (now()-created_at))/86400))::int,0)
                          FROM public.bn_risk_signal WHERE status = 'NEW'),
    'assessment_age_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (now()-created_at))/86400))::int,0)
                          FROM public.bn_risk_assessment
                         WHERE status IN ('DRAFT','OPEN','INFORMATION_PENDING','REVIEW','RECOMMENDATION')),
    'awaiting_information_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (now()-created_at))/86400))::int,0)
                          FROM public.bn_risk_information_request WHERE status IN ('OPEN','SENT','OVERDUE')),
    'awaiting_approval_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (now()-recommended_at))/86400))::int,0)
                          FROM public.bn_risk_recommendation WHERE status = 'PENDING_APPROVAL'),
    'execution_age_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (now()-requested_at))/86400))::int,0)
                          FROM public.bn_risk_control_execution WHERE status IN ('PENDING','PROCESSING','ACCEPTED','RETRY_PENDING')),
    'closure_age_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (now()-completed_at))/86400))::int,0)
                          FROM public.bn_risk_assessment WHERE status = 'COMPLETED' AND completed_at IS NOT NULL),
    'sla_configured', false,
    'sla_note','No governed Risk service-level policy is configured, so age is shown without breach semantics.'
  ) INTO v_ageing;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', d, 'signals', sc, 'assessments', ac)
           ORDER BY d), '[]'::jsonb) INTO v_trend
    FROM (
      SELECT date_trunc('day', g)::date AS d,
             (SELECT count(*) FROM public.bn_risk_signal s
               WHERE s.created_at >= g AND s.created_at < g + interval '1 day') AS sc,
             (SELECT count(*) FROM public.bn_risk_assessment a
               WHERE a.created_at >= g AND a.created_at < g + interval '1 day') AS ac
        FROM generate_series(date_trunc('day', v_from), date_trunc('day', v_to), interval '1 day') g
    ) t;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'period', v_period, 'cards', v_cards, 'funnel', v_funnel,
    'signals', v_signals, 'ageing', v_ageing, 'trend', v_trend,
    'privacy_note','Aggregate operational figures only. No claimant identity, narrative or individual score explanation is included.'));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_operational_metrics_v1(uuid,jsonb) TO authenticated, service_role;

-- ------------------------------------------------- 7. outcome metrics v1
CREATE OR REPLACE FUNCTION public.bn_risk_outcome_metrics_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_period jsonb; v_from timestamptz; v_to timestamptz;
  v_by_outcome jsonb; v_by_finding jsonb; v_controls jsonb; v_exec jsonb;
  v_maker jsonb; v_bands jsonb; v_totals jsonb; v_restricted boolean;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_restricted := COALESCE(
    (public.bn_risk_check_actor_permission(p_actor_user_id,'decide',false)->>'ok')::boolean,false);
  v_period := public._bn_risk_report_period(p_filters);
  v_from := (v_period->>'from')::timestamptz;
  v_to   := (v_period->>'to')::timestamptz;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', outcome_code, 'label', outcome_label,
           'outcome_class', outcome_class, 'is_fraud_related', is_fraud_related,
           'value', n) ORDER BY n DESC), '[]'::jsonb) INTO v_by_outcome
    FROM (SELECT o.outcome_code, o.outcome_label, o.outcome_class, o.is_fraud_related, count(*) n
            FROM public.bn_risk_outcome o
           WHERE o.status = 'CURRENT' AND o.recorded_at BETWEEN v_from AND v_to
           GROUP BY 1,2,3,4) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', finding_classification,
           'label', finding_classification, 'value', n,
           'is_error', finding_classification IN ('SYSTEM_ERROR','STAFF_ERROR'),
           'is_data_issue', finding_classification = 'DATA_INCONSISTENCY',
           'is_referral', finding_classification IN ('SUSPECTED_FRAUD_REFERRED','EXTERNAL_REVIEW_CONTINUING')
         ) ORDER BY n DESC), '[]'::jsonb) INTO v_by_finding
    FROM (SELECT o.finding_classification, count(*) n FROM public.bn_risk_outcome o
           WHERE o.status = 'CURRENT' AND o.recorded_at BETWEEN v_from AND v_to
           GROUP BY 1) q;

  SELECT jsonb_build_object(
    'recommended', (SELECT count(*) FROM public.bn_risk_recommendation
                     WHERE recommended_at BETWEEN v_from AND v_to),
    'approved', (SELECT count(*) FROM public.bn_risk_recommendation_decision
                  WHERE decision = 'APPROVED' AND decided_at BETWEEN v_from AND v_to),
    'rejected', (SELECT count(*) FROM public.bn_risk_recommendation_decision
                  WHERE decision = 'REJECTED' AND decided_at BETWEEN v_from AND v_to),
    'returned', (SELECT count(*) FROM public.bn_risk_recommendation_decision
                  WHERE decision = 'RETURNED' AND decided_at BETWEEN v_from AND v_to),
    'by_control_class', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', control_class,
        'label', control_class, 'value', n) ORDER BY n DESC) FROM (
        SELECT COALESCE(control_class,'UNCLASSIFIED') control_class, count(*) n
          FROM public.bn_risk_recommendation WHERE recommended_at BETWEEN v_from AND v_to
         GROUP BY 1) q), '[]'::jsonb)
  ) INTO v_controls;

  SELECT jsonb_build_object(
    'executed', (SELECT count(*) FROM public.bn_risk_control_execution
                  WHERE status = 'COMPLETED' AND requested_at BETWEEN v_from AND v_to),
    'failed', (SELECT count(*) FROM public.bn_risk_control_execution
                WHERE status IN ('FAILED','RETRY_PENDING') AND requested_at BETWEEN v_from AND v_to),
    'rejected_by_target', (SELECT count(*) FROM public.bn_risk_control_execution
                WHERE status = 'REJECTED_BY_TARGET' AND requested_at BETWEEN v_from AND v_to),
    'pending', (SELECT count(*) FROM public.bn_risk_control_execution
                WHERE status IN ('PENDING','PROCESSING','ACCEPTED')),
    'retries', (SELECT count(*) FROM public.bn_risk_control_execution
                WHERE attempt_no > 1 AND requested_at BETWEEN v_from AND v_to),
    'by_target_module', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', target_module,
        'label', target_module, 'value', n) ORDER BY n DESC) FROM (
        SELECT COALESCE(target_module,'UNKNOWN') target_module, count(*) n
          FROM public.bn_risk_control_execution WHERE requested_at BETWEEN v_from AND v_to
         GROUP BY 1) q), '[]'::jsonb)
  ) INTO v_exec;

  SELECT jsonb_build_object(
    'awaiting_decision', (SELECT count(*) FROM public.bn_risk_recommendation
                           WHERE status = 'PENDING_APPROVAL'),
    'turnaround_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (d.decided_at - r.recommended_at))/86400)::numeric,1),0)
                          FROM public.bn_risk_recommendation_decision d
                          JOIN public.bn_risk_recommendation r ON r.recommendation_id = d.recommendation_id
                         WHERE d.decided_at BETWEEN v_from AND v_to),
    'returned_rate', (SELECT CASE WHEN count(*) = 0 THEN 0
                        ELSE round(100.0 * count(*) FILTER (WHERE decision IN ('RETURNED','REJECTED')) / count(*), 1) END
                        FROM public.bn_risk_recommendation_decision
                       WHERE decided_at BETWEEN v_from AND v_to),
    'note','Governance turnaround only. No individual staff ranking is produced.'
  ) INTO v_maker;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', band_code,
           'label', COALESCE(band_label, band_code), 'value', n) ORDER BY band_code), '[]'::jsonb)
    INTO v_bands FROM (
      SELECT COALESCE(band_code,'UNBANDED') band_code, max(band_label) band_label, count(*) n
        FROM public.bn_risk_score WHERE status = 'CURRENT' AND calculated_at BETWEEN v_from AND v_to
       GROUP BY 1) q;

  SELECT jsonb_build_object(
    'outcomes_recorded', (SELECT count(*) FROM public.bn_risk_outcome
                           WHERE status='CURRENT' AND recorded_at BETWEEN v_from AND v_to),
    'assessments_closed', (SELECT count(*) FROM public.bn_risk_assessment_closure
                            WHERE closed_at BETWEEN v_from AND v_to),
    'assessments_reopened', (SELECT count(*) FROM public.bn_risk_assessment_closure
                              WHERE reopened_at BETWEEN v_from AND v_to),
    'fraud_related', (SELECT count(*) FROM public.bn_risk_outcome
                       WHERE status='CURRENT' AND is_fraud_related
                         AND recorded_at BETWEEN v_from AND v_to)
  ) INTO v_totals;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'period', v_period, 'totals', v_totals,
    'by_outcome', v_by_outcome, 'by_finding', v_by_finding,
    'controls', v_controls, 'executions', v_exec, 'maker_checker', v_maker,
    'score_bands', CASE WHEN v_restricted THEN v_bands ELSE '[]'::jsonb END,
    'score_bands_visible', v_restricted,
    'interpretation_note','A referral is not a finding of fraud. Error, staff error and data outcomes are reported separately from referrals.'));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_outcome_metrics_v1(uuid,jsonb) TO authenticated, service_role;

-- -------------------------------------------- 8. rule feedback metrics v1
CREATE OR REPLACE FUNCTION public.bn_risk_rule_feedback_metrics_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_rule_admin boolean; v_period jsonb;
  v_from timestamptz; v_to timestamptz; v_rules jsonb; v_class jsonb; v_totals jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_rule_admin := COALESCE(
    (public.bn_risk_check_actor_permission(p_actor_user_id,'rule_admin',false)->>'ok')::boolean,false)
    OR COALESCE(
    (public.bn_risk_check_actor_permission(p_actor_user_id,'admin',false)->>'ok')::boolean,false);
  IF NOT v_rule_admin THEN
    RETURN jsonb_build_object('status','DENIED','code','PERMISSION_DENIED','data', NULL);
  END IF;

  v_period := public._bn_risk_report_period(p_filters);
  v_from := (v_period->>'from')::timestamptz;
  v_to   := (v_period->>'to')::timestamptz;

  -- Rule effectiveness is always version aware: rule A v1 and rule A v2 are
  -- never combined into a single historical figure.
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'rule_code', (r->>'rule_set_version_no')::int), '[]'::jsonb)
    INTO v_rules FROM (
    SELECT jsonb_build_object(
      'rule_set_code', e.rule_set_code,
      'rule_set_version_no', e.rule_set_version_no,
      'rule_code', e.rule_code,
      'rule_name', e.rule_name,
      'evaluations', e.evaluations,
      'matches', e.matches,
      'match_rate', CASE WHEN e.evaluations = 0 THEN 0
                         ELSE round(100.0 * e.matches / e.evaluations, 1) END,
      'cases_matched', e.cases_matched,
      'total_contribution', e.total_contribution,
      'feedback_total', COALESCE(f.total,0),
      'false_positive_feedback', COALESCE(f.false_positive,0),
      'useful_feedback', COALESCE(f.useful,0),
      'sensitivity_feedback', COALESCE(f.sensitivity,0),
      'false_positive_feedback_rate', CASE WHEN COALESCE(f.total,0) = 0 THEN NULL
                         ELSE round(100.0 * f.false_positive / f.total, 1) END,
      'useful_feedback_rate', CASE WHEN COALESCE(f.total,0) = 0 THEN NULL
                         ELSE round(100.0 * f.useful / f.total, 1) END,
      'outcome_distribution', COALESCE(o.dist, '[]'::jsonb),
      'evidence_note','Aggregate evidence for human policy review only. No rule is judged effective or ineffective by a single figure.'
    ) AS r
    FROM (
      SELECT s.rule_set_code, s.rule_set_version_no, c.rule_code, max(c.rule_name) rule_name,
             count(*) evaluations,
             count(*) FILTER (WHERE c.outcome = 'MATCHED') matches,
             count(DISTINCT s.assessment_id) FILTER (WHERE c.outcome = 'MATCHED') cases_matched,
             COALESCE(sum(c.contribution) FILTER (WHERE c.outcome = 'MATCHED'),0) total_contribution
        FROM public.bn_risk_score_contribution c
        JOIN public.bn_risk_score s ON s.score_id = c.score_id
       WHERE s.calculated_at BETWEEN v_from AND v_to
       GROUP BY 1,2,3) e
    LEFT JOIN (
      SELECT rule_set_code, rule_set_version_no, rule_code,
             count(*) total,
             count(*) FILTER (WHERE classification = 'FALSE_POSITIVE') false_positive,
             count(*) FILTER (WHERE classification = 'USEFUL') useful,
             count(*) FILTER (WHERE classification = 'SENSITIVITY') sensitivity
        FROM public.bn_risk_rule_feedback
       WHERE status = 'CURRENT' AND target_kind = 'RULE'
       GROUP BY 1,2,3) f
      ON f.rule_set_code = e.rule_set_code
     AND f.rule_set_version_no = e.rule_set_version_no
     AND f.rule_code = e.rule_code
    LEFT JOIN (
      SELECT fb.rule_set_code, fb.rule_set_version_no, fb.rule_code,
             jsonb_agg(jsonb_build_object('key', fb.finding_classification,
               'label', fb.finding_classification, 'value', fb.n) ORDER BY fb.n DESC) dist
        FROM (SELECT rule_set_code, rule_set_version_no, rule_code,
                     COALESCE(finding_classification,'NOT_RECORDED') finding_classification, count(*) n
                FROM public.bn_risk_rule_feedback
               WHERE status = 'CURRENT' AND target_kind = 'RULE'
               GROUP BY 1,2,3,4) fb
       GROUP BY 1,2,3) o
      ON o.rule_set_code = e.rule_set_code
     AND o.rule_set_version_no = e.rule_set_version_no
     AND o.rule_code = e.rule_code
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', classification, 'label', classification,
           'value', n) ORDER BY n DESC), '[]'::jsonb) INTO v_class
    FROM (SELECT classification, count(*) n FROM public.bn_risk_rule_feedback
           WHERE status = 'CURRENT' AND recorded_at BETWEEN v_from AND v_to
           GROUP BY 1) q;

  SELECT jsonb_build_object(
    'feedback_recorded', (SELECT count(*) FROM public.bn_risk_rule_feedback
                           WHERE recorded_at BETWEEN v_from AND v_to),
    'feedback_current', (SELECT count(*) FROM public.bn_risk_rule_feedback
                          WHERE status = 'CURRENT' AND recorded_at BETWEEN v_from AND v_to),
    'feedback_corrected', (SELECT count(*) FROM public.bn_risk_rule_feedback
                            WHERE supersedes_feedback_id IS NOT NULL
                              AND recorded_at BETWEEN v_from AND v_to),
    'cases_reviewed', (SELECT count(DISTINCT assessment_id) FROM public.bn_risk_rule_feedback
                        WHERE recorded_at BETWEEN v_from AND v_to),
    'signal_feedback', (SELECT count(*) FROM public.bn_risk_rule_feedback
                         WHERE target_kind = 'SIGNAL' AND status='CURRENT'
                           AND recorded_at BETWEEN v_from AND v_to),
    'factor_feedback', (SELECT count(*) FROM public.bn_risk_rule_feedback
                         WHERE target_kind = 'FACTOR' AND status='CURRENT'
                           AND recorded_at BETWEEN v_from AND v_to)
  ) INTO v_totals;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'period', v_period, 'totals', v_totals, 'by_classification', v_class,
    'rules', v_rules,
    'governance_note','Feedback informs a separate, versioned and authorised scoring-configuration change. It never changes a rule, weight, band or configuration on its own.'));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_rule_feedback_metrics_v1(uuid,jsonb) TO authenticated, service_role;