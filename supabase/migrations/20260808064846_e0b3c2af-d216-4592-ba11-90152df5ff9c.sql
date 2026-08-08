-- ===========================================================================
-- BN RISK / FRAUD — EPIC 5: outcome recording, completion, closure, reopening.
-- Outcome records what happened. Outcome does not rewrite history.
-- ===========================================================================

-- ------------------------------------------------------------ 1. catalogue
CREATE TABLE IF NOT EXISTS public.bn_risk_outcome_type (
  outcome_code                  text PRIMARY KEY,
  label                         text NOT NULL,
  description                   text,
  outcome_class                 text NOT NULL,
  finding_classification        text NOT NULL,
  is_fraud_related              boolean NOT NULL DEFAULT false,
  asserts_legal_conclusion      boolean NOT NULL DEFAULT false,
  requires_reason               boolean NOT NULL DEFAULT true,
  requires_justification        boolean NOT NULL DEFAULT true,
  requires_external_reference   boolean NOT NULL DEFAULT false,
  requires_settled_controls     boolean NOT NULL DEFAULT true,
  allows_unresolved_control     boolean NOT NULL DEFAULT false,
  permits_closure               boolean NOT NULL DEFAULT true,
  is_active                     boolean NOT NULL DEFAULT true,
  sort_order                    integer NOT NULL DEFAULT 100,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_outcome_type_class_ck CHECK (outcome_class IN
    ('NO_ISSUE','ERROR','DATA_ISSUE','FRAUD_REFERRAL','CONTROL_COMPLETED',
     'EXTERNAL_CONTINUING','INDETERMINATE','OTHER')),
  CONSTRAINT bn_risk_outcome_type_finding_ck CHECK (finding_classification IN
    ('LEGITIMATE_ACTIVITY','CONCERN_NOT_SUBSTANTIATED','SYSTEM_ERROR','STAFF_ERROR',
     'DATA_INCONSISTENCY','SUSPECTED_FRAUD_REFERRED','CONTROL_APPLIED',
     'EXTERNAL_REVIEW_CONTINUING','NOT_DETERMINED','OTHER'))
);
GRANT ALL ON public.bn_risk_outcome_type TO service_role;
REVOKE ALL ON public.bn_risk_outcome_type FROM anon, authenticated;
ALTER TABLE public.bn_risk_outcome_type ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bn_risk_outcome_type(outcome_code,label,description,outcome_class,
  finding_classification,is_fraud_related,requires_external_reference,
  requires_settled_controls,allows_unresolved_control,permits_closure,sort_order)
VALUES
 ('NO_ISSUE_IDENTIFIED','No issue identified',
  'The assessment found no issue with the claimant''s circumstances.',
  'NO_ISSUE','LEGITIMATE_ACTIVITY',false,false,true,false,true,10),
 ('CONCERN_NOT_SUBSTANTIATED','Concern not substantiated',
  'The concern that generated the signal was not substantiated by the evidence.',
  'NO_ISSUE','CONCERN_NOT_SUBSTANTIATED',false,false,true,false,true,20),
 ('LEGITIMATE_ACTIVITY','Legitimate activity confirmed',
  'The activity that generated the concern is legitimate and correctly recorded.',
  'NO_ISSUE','LEGITIMATE_ACTIVITY',false,false,true,false,true,30),
 ('SYSTEM_ERROR_CONFIRMED','System or configuration error confirmed',
  'The discrepancy arose from a system or configuration error, not from conduct.',
  'ERROR','SYSTEM_ERROR',false,false,true,false,true,40),
 ('STAFF_ERROR_CONFIRMED','Staff processing error confirmed',
  'The discrepancy arose from a staff processing error, not from conduct.',
  'ERROR','STAFF_ERROR',false,false,true,false,true,50),
 ('CLAIMANT_INFORMATION_INCONSISTENCY','Claimant information inconsistency',
  'The information held is inconsistent and has been corrected or clarified. No conduct finding is made.',
  'DATA_ISSUE','DATA_INCONSISTENCY',false,false,true,false,true,60),
 ('SUSPECTED_FRAUD_REFERRED','Suspected fraud referred',
  'The concern is unresolved and has been referred to the authorised module for consideration. This is a referral, not a proven finding.',
  'FRAUD_REFERRAL','SUSPECTED_FRAUD_REFERRED',true,true,false,false,true,70),
 ('CONTROL_ACTION_COMPLETED','Control action completed',
  'The approved control was executed by the owning domain and the matter is concluded for Risk.',
  'CONTROL_COMPLETED','CONTROL_APPLIED',false,false,true,false,true,80),
 ('EXTERNAL_REVIEW_CONTINUING','External review or referral continuing',
  'The owning module accepted the referral and continues its own lifecycle. Risk''s involvement is concluded.',
  'EXTERNAL_CONTINUING','EXTERNAL_REVIEW_CONTINUING',false,true,false,false,true,90),
 ('UNABLE_TO_DETERMINE','Unable to determine — insufficient evidence',
  'The available evidence does not allow a determination to be made.',
  'INDETERMINATE','NOT_DETERMINED',false,false,false,true,true,100),
 ('CONTROL_UNRESOLVED_DOCUMENTED','Control unresolved — documented',
  'The control could not be completed by the owning domain. The failure is documented and the matter is concluded for Risk.',
  'OTHER','OTHER',false,false,false,true,true,110),
 ('OTHER_GOVERNED_OUTCOME','Other governed outcome',
  'Another governed outcome, described in the justification.',
  'OTHER','OTHER',false,false,true,false,true,120)
ON CONFLICT (outcome_code) DO NOTHING;

INSERT INTO public.bn_risk_reference_value(domain, code, label, description, nature, sort_order, is_active)
VALUES
 ('OUTCOME_REASON','EVIDENCE_RESOLVED_CONCERN','Evidence resolved the concern','The evidence gathered resolves the concern raised.','MITIGATING',10,true),
 ('OUTCOME_REASON','RECORDS_CORRECTED','Records corrected','The underlying records have been corrected.','NEUTRAL',20,true),
 ('OUTCOME_REASON','ERROR_ATTRIBUTED','Error attributed to process or system','The discrepancy is attributed to a process or system error.','NEUTRAL',30,true),
 ('OUTCOME_REASON','CONCERN_UNRESOLVED_REFERRED','Concern unresolved and referred','The concern remains unresolved and has been referred for consideration.','ADVERSE',40,true),
 ('OUTCOME_REASON','CONTROL_EXECUTED','Control executed by the owning domain','The approved control was executed by the domain that owns it.','NEUTRAL',50,true),
 ('OUTCOME_REASON','EXTERNAL_LIFECYCLE_CONTINUES','Owning module continues its own lifecycle','The owning module accepted the handoff and continues its own process.','NEUTRAL',60,true),
 ('OUTCOME_REASON','INSUFFICIENT_EVIDENCE_OUTCOME','Insufficient evidence to determine','A determination cannot be made on the evidence held.','NEUTRAL',70,true),
 ('OUTCOME_REASON','CONTROL_NOT_COMPLETED','Control could not be completed','The owning domain could not complete the control.','NEUTRAL',80,true),
 ('OUTCOME_DISPOSITION','NO_FURTHER_ACTION','No further action','Risk takes no further action on this assessment.',NULL,10,true),
 ('OUTCOME_DISPOSITION','CORRECTION_APPLIED','Correction applied','A correction has been applied by the responsible area.',NULL,20,true),
 ('OUTCOME_DISPOSITION','CONTROL_IN_FORCE','Control in force','A governed control is in force with the owning domain.',NULL,30,true),
 ('OUTCOME_DISPOSITION','REFERRED_AND_ACCEPTED','Referred and accepted','A referral was accepted by the owning module.',NULL,40,true),
 ('OUTCOME_DISPOSITION','MONITOR_ONLY','Monitoring only','The person or account remains subject to ordinary monitoring only.',NULL,50,true),
 ('OUTCOME_DISPOSITION','UNRESOLVED_CONTROL_DOCUMENTED','Unresolved control documented','A control could not be completed; the position is documented.',NULL,60,true),
 ('OUTCOME_CORRECTION_REASON','RECORDING_ERROR','Recording error','The recorded outcome does not reflect the decision taken.',NULL,10,true),
 ('OUTCOME_CORRECTION_REASON','NEW_GOVERNED_INFORMATION','New governed information','Governed information received after recording changes the outcome.',NULL,20,true),
 ('CLOSURE_REASON','OUTCOME_RECORDED_NO_FURTHER_WORK','Outcome recorded — no further Risk work','The outcome is recorded and no Risk work remains.',NULL,10,true),
 ('CLOSURE_REASON','HANDED_TO_OWNING_MODULE','Handed to the owning module','The matter now sits with the owning module.',NULL,20,true),
 ('CLOSURE_REASON','CONCLUDED_NO_CONTROL','Concluded — no control required','The assessment concluded without a control.',NULL,30,true),
 ('REOPEN_REASON','NEW_MATERIAL_INFORMATION','New material information','Material new information requires a fresh review.',NULL,10,true),
 ('REOPEN_REASON','OUTCOME_RECORDED_IN_ERROR','Outcome recorded in error','The recorded outcome was wrong and the case must be reviewed again.',NULL,20,true),
 ('REOPEN_REASON','GOVERNANCE_REVIEW','Governance or quality review','A governance or quality review requires the case to be reopened.',NULL,30,true),
 ('REOPEN_REASON','EXTERNAL_MODULE_RESULT','Result returned by an owning module','An owning module returned a result that requires further Risk review.',NULL,40,true)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------- 2. outcome record
CREATE TABLE IF NOT EXISTS public.bn_risk_outcome (
  outcome_id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_reference            text NOT NULL,
  assessment_id                uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  sequence_no                  integer NOT NULL,
  phase_no                     integer NOT NULL DEFAULT 1,
  outcome_code                 text NOT NULL REFERENCES public.bn_risk_outcome_type(outcome_code),
  outcome_label                text NOT NULL,
  outcome_class                text NOT NULL,
  finding_classification       text NOT NULL,
  is_fraud_related             boolean NOT NULL DEFAULT false,
  disposition_code             text,
  disposition_label            text,
  reason_code                  text,
  reason_label                 text,
  justification                text,
  control_execution_summary    jsonb NOT NULL DEFAULT '[]'::jsonb,
  referral_summary             jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_control_disposition text,
  financial_impact_module      text,
  financial_impact_reference   text,
  external_outcome_reference   text,
  external_outcome_summary     text,
  supporting_factor_ids        uuid[] NOT NULL DEFAULT '{}',
  supporting_evidence_ids      uuid[] NOT NULL DEFAULT '{}',
  recommendation_id            uuid,
  decision_id                  uuid,
  score_id                     uuid,
  score_version_no             integer,
  status                       text NOT NULL DEFAULT 'CURRENT',
  supersedes_outcome_id        uuid,
  superseded_by_outcome_id     uuid,
  superseded_at                timestamptz,
  correction_reason_code       text,
  correction_reason_label      text,
  correction_justification     text,
  recorded_by_user_id          uuid NOT NULL,
  recorded_by_name             text,
  recorded_at                  timestamptz NOT NULL DEFAULT now(),
  assessment_row_version       bigint NOT NULL,
  row_version                  bigint NOT NULL DEFAULT 1,
  correlation_id               uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_outcome_status_ck
    CHECK (status IN ('CURRENT','SUPERSEDED','HISTORICAL_AFTER_REOPEN'))
);
GRANT ALL ON public.bn_risk_outcome TO service_role;
REVOKE ALL ON public.bn_risk_outcome FROM anon, authenticated;
ALTER TABLE public.bn_risk_outcome ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS bn_risk_outcome_sequence_uk
  ON public.bn_risk_outcome(assessment_id, sequence_no);
CREATE UNIQUE INDEX IF NOT EXISTS bn_risk_outcome_one_current_uk
  ON public.bn_risk_outcome(assessment_id) WHERE status = 'CURRENT';

-- ------------------------------------------------------- 3. closure record
CREATE TABLE IF NOT EXISTS public.bn_risk_assessment_closure (
  closure_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id              uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  phase_no                   integer NOT NULL DEFAULT 1,
  outcome_id                 uuid NOT NULL REFERENCES public.bn_risk_outcome(outcome_id),
  outcome_code               text NOT NULL,
  outcome_label              text NOT NULL,
  closure_reason_code        text,
  closure_reason_label       text,
  closure_note               text,
  closed_by_user_id          uuid NOT NULL,
  closed_by_name             text,
  closed_at                  timestamptz NOT NULL DEFAULT now(),
  assessment_row_version     bigint NOT NULL,
  status                     text NOT NULL DEFAULT 'CLOSED',
  reopened_at                timestamptz,
  reopened_by_user_id        uuid,
  reopened_by_name           text,
  reopen_reason_code         text,
  reopen_reason_label        text,
  reopen_justification       text,
  reopen_destination_status  text,
  correlation_id             uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_closure_status_ck CHECK (status IN ('CLOSED','REOPENED'))
);
GRANT ALL ON public.bn_risk_assessment_closure TO service_role;
REVOKE ALL ON public.bn_risk_assessment_closure FROM anon, authenticated;
ALTER TABLE public.bn_risk_assessment_closure ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS bn_risk_closure_phase_uk
  ON public.bn_risk_assessment_closure(assessment_id, phase_no);

ALTER TABLE public.bn_risk_assessment
  ADD COLUMN IF NOT EXISTS phase_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ------------------------------------------------- 4. immutability triggers
CREATE OR REPLACE FUNCTION public._bn_risk_outcome_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'E_IMMUTABLE_OUTCOME: a recorded Risk outcome cannot be deleted.';
  END IF;
  IF NEW.outcome_code IS DISTINCT FROM OLD.outcome_code
     OR NEW.finding_classification IS DISTINCT FROM OLD.finding_classification
     OR NEW.justification IS DISTINCT FROM OLD.justification
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.disposition_code IS DISTINCT FROM OLD.disposition_code
     OR NEW.recorded_by_user_id IS DISTINCT FROM OLD.recorded_by_user_id
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
     OR NEW.sequence_no IS DISTINCT FROM OLD.sequence_no THEN
    RAISE EXCEPTION 'E_IMMUTABLE_OUTCOME: a recorded Risk outcome cannot be edited. Record a superseding outcome instead.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS bn_risk_outcome_immutable_trg ON public.bn_risk_outcome;
CREATE TRIGGER bn_risk_outcome_immutable_trg
  BEFORE UPDATE OR DELETE ON public.bn_risk_outcome
  FOR EACH ROW EXECUTE FUNCTION public._bn_risk_outcome_immutable();

CREATE OR REPLACE FUNCTION public._bn_risk_closure_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'E_IMMUTABLE_CLOSURE: a Risk closure record cannot be deleted.';
  END IF;
  IF NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by_user_id IS DISTINCT FROM OLD.closed_by_user_id
     OR NEW.outcome_id IS DISTINCT FROM OLD.outcome_id
     OR NEW.closure_reason_code IS DISTINCT FROM OLD.closure_reason_code THEN
    RAISE EXCEPTION 'E_IMMUTABLE_CLOSURE: the original closure is retained and cannot be rewritten.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS bn_risk_closure_immutable_trg ON public.bn_risk_assessment_closure;
CREATE TRIGGER bn_risk_closure_immutable_trg
  BEFORE UPDATE OR DELETE ON public.bn_risk_assessment_closure
  FOR EACH ROW EXECUTE FUNCTION public._bn_risk_closure_immutable();

-- ------------------------------------------------- 5. state machine + refs
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
    WHEN 'CONTROL_ACTION' THEN p_to IN ('COMPLETED')
    WHEN 'REFERRED' THEN p_to IN ('COMPLETED')
    WHEN 'COMPLETED' THEN p_to IN ('CLOSED')
    WHEN 'CLOSED' THEN p_to IN ('OPEN','REVIEW')
    ELSE false END;
$function$;

CREATE OR REPLACE FUNCTION public._bn_risk_next_outcome_reference()
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT 'RO-' || to_char(now(),'YYYY') || '-' ||
         lpad(((SELECT count(*) FROM public.bn_risk_outcome) + 1)::text, 6, '0');
$function$;

CREATE OR REPLACE FUNCTION public._bn_risk_ref_label(p_domain text, p_code text)
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT label FROM public.bn_risk_reference_value
   WHERE domain = p_domain AND code = p_code AND is_active LIMIT 1;
$function$;

-- ---------------------------------------------- 6. execution/referral facts
CREATE OR REPLACE FUNCTION public._bn_risk_outcome_control_facts(p_assessment uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'recommendation_id', r.recommendation_id,
      'recommendation_reference', r.recommendation_reference,
      'control_code', r.control_code,
      'control_label', r.control_label,
      'control_class', r.control_class,
      'is_benefit_affecting', r.is_benefit_affecting,
      'approved_at', r.decided_at,
      'execution_id', e.execution_id,
      'execution_reference', e.execution_reference,
      'execution_status', COALESCE(e.status,'NOT_STARTED'),
      'execution_status_label', public._bn_risk_exec_status_label(COALESCE(e.status,'NOT_STARTED')),
      'target_module', e.target_module,
      'target_business_reference', e.target_business_reference,
      'target_operation_reference', e.target_operation_reference,
      'failure_code', e.failure_code,
      'failure_summary', e.failure_summary,
      'is_retryable', COALESCE(e.is_retryable,false),
      'attempt_no', e.attempt_no
    ) ORDER BY r.decided_at), '[]'::jsonb)
    FROM public.bn_risk_recommendation r
    LEFT JOIN LATERAL (
      SELECT * FROM public.bn_risk_control_execution x
       WHERE x.recommendation_id = r.recommendation_id
       ORDER BY x.attempt_no DESC LIMIT 1) e ON true
   WHERE r.assessment_id = p_assessment AND r.status = 'APPROVED';
$function$;

-- ------------------------------------------------- 7. outcome readiness v1
CREATE OR REPLACE FUNCTION public.bn_risk_outcome_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_decide boolean; v_restricted boolean;
  v_b text[] := '{}'; v_w text[] := '{}';
  v_facts jsonb; v_outstanding jsonb; v_outstanding_ref jsonb;
  v_approved int; v_pending int; v_failed int; v_awaiting int;
  v_open_req int; v_pending_rec int; v_state text; v_current jsonb; v_history jsonb;
  v_catalogue jsonb; v_can boolean; v_closure jsonb;
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
  v_restricted := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'restricted_notes',false)->>'ok')::boolean,false)
                  OR v_decide;

  v_facts := public._bn_risk_outcome_control_facts(p_assessment_id);

  SELECT count(*) INTO v_approved FROM jsonb_array_elements(v_facts) f;
  SELECT count(*) INTO v_pending FROM jsonb_array_elements(v_facts) f
   WHERE f->>'execution_status' IN ('PENDING','RETRY_PENDING');
  SELECT count(*) INTO v_failed FROM jsonb_array_elements(v_facts) f
   WHERE f->>'execution_status' = 'FAILED';
  -- Policy: an approved control with no execution attempt, other than NO_ACTION,
  -- is outstanding. A referral is settled once the owning module accepted it.
  SELECT count(*) INTO v_awaiting FROM jsonb_array_elements(v_facts) f
   WHERE f->>'control_code' <> 'NO_ACTION'
     AND f->>'execution_status' NOT IN
       ('COMPLETED','REJECTED_BY_TARGET','CANCELLED','ACCEPTED','PROCESSING','FAILED');
  SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) INTO v_outstanding
    FROM jsonb_array_elements(v_facts) f
   WHERE f->>'control_code' <> 'NO_ACTION'
     AND f->>'execution_status' NOT IN
       ('COMPLETED','REJECTED_BY_TARGET','CANCELLED','ACCEPTED','PROCESSING');
  SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) INTO v_outstanding_ref
    FROM jsonb_array_elements(v_facts) f
   WHERE f->>'control_class' = 'REFERRAL'
     AND f->>'execution_status' NOT IN ('ACCEPTED','PROCESSING','COMPLETED','REJECTED_BY_TARGET');

  SELECT count(*) INTO v_open_req FROM public.bn_risk_information_request
   WHERE assessment_id = p_assessment_id AND status IN ('OPEN','SENT','OVERDUE');
  SELECT count(*) INTO v_pending_rec FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND status = 'PENDING_APPROVAL';

  SELECT to_jsonb(o) INTO v_current FROM (
    SELECT o.outcome_id, o.outcome_reference, o.outcome_code, o.outcome_label,
           o.outcome_class, o.finding_classification, o.is_fraud_related,
           o.disposition_code, o.disposition_label, o.reason_code, o.reason_label,
           CASE WHEN v_restricted THEN o.justification ELSE NULL END AS justification,
           o.unresolved_control_disposition, o.financial_impact_module,
           o.financial_impact_reference, o.external_outcome_reference,
           CASE WHEN v_restricted THEN o.external_outcome_summary ELSE NULL END AS external_outcome_summary,
           o.control_execution_summary, o.referral_summary,
           o.supporting_factor_ids, o.supporting_evidence_ids,
           o.recorded_by_name, o.recorded_at, o.sequence_no, o.phase_no,
           o.status, o.supersedes_outcome_id, o.assessment_row_version, o.row_version
      FROM public.bn_risk_outcome o
     WHERE o.assessment_id = p_assessment_id AND o.status = 'CURRENT') o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'outcome_id', h.outcome_id, 'outcome_reference', h.outcome_reference,
           'outcome_code', h.outcome_code, 'outcome_label', h.outcome_label,
           'finding_classification', h.finding_classification,
           'status', h.status, 'sequence_no', h.sequence_no, 'phase_no', h.phase_no,
           'recorded_by_name', h.recorded_by_name, 'recorded_at', h.recorded_at,
           'correction_reason_label', h.correction_reason_label,
           'superseded_at', h.superseded_at) ORDER BY h.sequence_no), '[]'::jsonb)
    INTO v_history FROM public.bn_risk_outcome h WHERE h.assessment_id = p_assessment_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'outcome_code', t.outcome_code, 'label', t.label, 'description', t.description,
           'outcome_class', t.outcome_class, 'finding_classification', t.finding_classification,
           'is_fraud_related', t.is_fraud_related,
           'requires_reason', t.requires_reason,
           'requires_justification', t.requires_justification,
           'requires_external_reference', t.requires_external_reference,
           'requires_settled_controls', t.requires_settled_controls,
           'allows_unresolved_control', t.allows_unresolved_control,
           'permits_closure', t.permits_closure) ORDER BY t.sort_order), '[]'::jsonb)
    INTO v_catalogue FROM public.bn_risk_outcome_type t WHERE t.is_active;

  SELECT to_jsonb(c) INTO v_closure FROM (
    SELECT c.closure_id, c.phase_no, c.outcome_code, c.outcome_label,
           c.closure_reason_code, c.closure_reason_label, c.closure_note,
           c.closed_by_name, c.closed_at, c.status,
           c.reopened_at, c.reopened_by_name, c.reopen_reason_code,
           c.reopen_reason_label, c.reopen_destination_status
      FROM public.bn_risk_assessment_closure c
     WHERE c.assessment_id = p_assessment_id
     ORDER BY c.phase_no DESC LIMIT 1) c;

  -- blockers -----------------------------------------------------------
  IF v_a.status = 'CLOSED' THEN
    v_b := v_b || 'This assessment is closed. No further outcome can be recorded.';
  ELSIF v_a.status = 'COMPLETED' THEN
    NULL;
  ELSIF v_a.status NOT IN ('CONTROL_ACTION','REFERRED') THEN
    v_b := v_b || 'The assessment has not reached the outcome stage.';
  END IF;
  IF v_pending_rec > 0 THEN
    v_b := v_b || 'A recommendation is still awaiting independent approval.';
  END IF;
  IF v_approved = 0 AND v_a.status IN ('CONTROL_ACTION','REFERRED') THEN
    v_b := v_b || 'No approved control has been resolved for this assessment.';
  END IF;
  IF v_awaiting > 0 THEN
    v_b := v_b || 'An approved control is still awaiting execution.';
  END IF;
  IF v_pending > 0 THEN
    v_b := v_b || 'An execution request is still with an owning domain.';
  END IF;
  IF v_failed > 0 THEN
    v_b := v_b || 'A control execution failed and is unresolved. Only an outcome that documents the unresolved control may be recorded.';
  END IF;
  IF jsonb_array_length(v_outstanding_ref) > 0 THEN
    v_b := v_b || 'A referral has not yet been accepted by the owning module.';
  END IF;
  IF NOT v_decide THEN
    v_b := v_b || 'You do not have permission to record a Risk outcome.';
  END IF;
  IF v_open_req > 0 THEN
    v_w := v_w || 'An information request is still open.';
  END IF;
  IF v_current IS NOT NULL AND v_a.status = 'COMPLETED' THEN
    v_w := v_w || 'An outcome is already recorded. A correction is retained as a superseding outcome.';
  END IF;

  -- Failed executions block only the ordinary outcome path: an outcome that
  -- explicitly documents the unresolved control remains available.
  v_can := (array_length(v_b,1) IS NULL) OR
           (v_failed > 0 AND v_decide AND array_length(v_b,1) = 1
            AND v_a.status IN ('CONTROL_ACTION','REFERRED'));

  v_state := CASE
    WHEN NOT v_decide THEN 'DENIED'
    WHEN v_a.status = 'CLOSED' THEN 'COMPLETED'
    WHEN v_a.status = 'COMPLETED' AND v_current IS NOT NULL THEN 'OUTCOME_RECORDED'
    WHEN v_a.status NOT IN ('CONTROL_ACTION','REFERRED','COMPLETED') THEN 'NOT_READY'
    WHEN v_can THEN 'READY'
    ELSE 'BLOCKED' END;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_reference', v_a.assessment_reference,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'phase_no', v_a.phase_no,
    'state', v_state,
    'can_record_outcome', (v_can AND v_a.status IN ('CONTROL_ACTION','REFERRED')),
    'can_correct_outcome', (v_decide AND v_a.status = 'COMPLETED' AND v_current IS NOT NULL),
    'available_actions', (
      CASE WHEN v_can AND v_a.status IN ('CONTROL_ACTION','REFERRED')
             THEN jsonb_build_array('RECORD_OUTCOME')
           WHEN v_decide AND v_a.status = 'COMPLETED' AND v_current IS NOT NULL
             THEN jsonb_build_array('CORRECT_OUTCOME')
           ELSE '[]'::jsonb END),
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'outstanding_controls', v_outstanding,
    'outstanding_referrals', v_outstanding_ref,
    'execution_summary', v_facts,
    'failed_executions', v_failed,
    'pending_attempts', v_pending,
    'requires_unresolved_control_disposition', (v_failed > 0),
    'all_controls_executed', (v_awaiting = 0 AND v_pending = 0),
    'all_referrals_settled', (jsonb_array_length(v_outstanding_ref) = 0),
    'ready_for_outcome', (v_can AND v_a.status IN ('CONTROL_ACTION','REFERRED')),
    'outcome_catalogue', v_catalogue,
    'current_outcome', v_current,
    'outcome_history', v_history,
    'closure', v_closure,
    'restricted_detail_visible', v_restricted));
END; $$;

-- ------------------------------------------------- 8. closure readiness v1
CREATE OR REPLACE FUNCTION public.bn_risk_closure_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE; v_decide boolean; v_admin boolean;
  v_b text[] := '{}'; v_w text[] := '{}'; v_o public.bn_risk_outcome%ROWTYPE;
  v_t public.bn_risk_outcome_type%ROWTYPE; v_pending int; v_open_req int; v_pending_rec int;
  v_state text; v_closure jsonb; v_can boolean;
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
  v_admin  := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);

  SELECT * INTO v_o FROM public.bn_risk_outcome
   WHERE assessment_id = p_assessment_id AND status = 'CURRENT';
  IF FOUND THEN
    SELECT * INTO v_t FROM public.bn_risk_outcome_type WHERE outcome_code = v_o.outcome_code;
  END IF;

  SELECT count(*) INTO v_pending FROM public.bn_risk_control_execution
   WHERE assessment_id = p_assessment_id
     AND status IN ('PENDING','RETRY_PENDING');
  SELECT count(*) INTO v_open_req FROM public.bn_risk_information_request
   WHERE assessment_id = p_assessment_id AND status IN ('OPEN','SENT','OVERDUE');
  SELECT count(*) INTO v_pending_rec FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND status = 'PENDING_APPROVAL';

  SELECT to_jsonb(c) INTO v_closure FROM (
    SELECT c.closure_id, c.phase_no, c.outcome_code, c.outcome_label,
           c.closure_reason_code, c.closure_reason_label, c.closure_note,
           c.closed_by_name, c.closed_at, c.status, c.reopened_at,
           c.reopened_by_name, c.reopen_reason_label, c.reopen_destination_status
      FROM public.bn_risk_assessment_closure c
     WHERE c.assessment_id = p_assessment_id
     ORDER BY c.phase_no DESC LIMIT 1) c;

  IF v_a.status = 'CLOSED' THEN
    v_b := v_b || 'This assessment is already closed.';
  ELSIF v_a.status <> 'COMPLETED' THEN
    v_b := v_b || 'The assessment is not complete. Record a governed outcome first.';
  END IF;
  IF v_o.outcome_id IS NULL THEN
    v_b := v_b || 'No current outcome is recorded for this assessment.';
  ELSIF v_o.assessment_row_version IS DISTINCT FROM v_a.row_version
        AND v_a.status = 'COMPLETED' THEN
    v_w := v_w || 'The assessment has changed since the outcome was recorded.';
  END IF;
  IF v_t.outcome_code IS NOT NULL AND NOT v_t.permits_closure THEN
    v_b := v_b || 'The recorded outcome does not permit closure.';
  END IF;
  IF v_pending > 0 THEN
    v_b := v_b || 'A control execution is still with an owning domain.';
  END IF;
  IF v_pending_rec > 0 THEN
    v_b := v_b || 'A recommendation is still awaiting independent approval.';
  END IF;
  IF v_open_req > 0 THEN
    v_b := v_b || 'An information request is still open.';
  END IF;
  IF NOT v_decide THEN
    v_b := v_b || 'You do not have permission to close a Risk assessment.';
  END IF;

  v_can := (array_length(v_b,1) IS NULL);
  v_state := CASE
    WHEN NOT v_decide THEN 'DENIED'
    WHEN v_a.status = 'CLOSED' THEN 'ALREADY_CLOSED'
    WHEN v_can THEN 'READY_FOR_CLOSURE'
    WHEN v_o.outcome_id IS NULL THEN 'OUTCOME_NOT_READY'
    ELSE 'OUTCOME_BLOCKED' END;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'state', v_state,
    'can_close', v_can,
    'can_reopen', (v_a.status = 'CLOSED' AND v_admin),
    'reopen_requires_capability', 'admin',
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'outcome', CASE WHEN v_o.outcome_id IS NULL THEN NULL ELSE jsonb_build_object(
      'outcome_id', v_o.outcome_id, 'outcome_code', v_o.outcome_code,
      'outcome_label', v_o.outcome_label, 'finding_classification', v_o.finding_classification,
      'recorded_by_name', v_o.recorded_by_name, 'recorded_at', v_o.recorded_at) END,
    'closure', v_closure,
    'reopen_count', v_a.reopen_count,
    'available_actions', (
      CASE WHEN v_can THEN jsonb_build_array('CLOSE')
           WHEN v_a.status='CLOSED' AND v_admin THEN jsonb_build_array('REOPEN')
           ELSE '[]'::jsonb END)));
END; $$;

-- --------------------------------------------------------- 9. the command
CREATE OR REPLACE FUNCTION public.bn_risk_outcome_command_v1(
  p_command_name text,
  p_actor_user_id uuid,
  p_assessment_id uuid,
  p_expected_row_version bigint,
  p_payload jsonb,
  p_idempotency_key uuid DEFAULT NULL,
  p_payload_hash text DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_a public.bn_risk_assessment%ROWTYPE;
  v_t public.bn_risk_outcome_type%ROWTYPE;
  v_prev public.bn_risk_outcome%ROWTYPE;
  v_ready jsonb; v_close jsonb; v_facts jsonb; v_refs jsonb;
  v_id uuid; v_seq int; v_result jsonb; v_actor text;
  v_reason text; v_just text; v_code text; v_dest text; v_closure public.bn_risk_assessment_closure%ROWTYPE;
  v_rec public.bn_risk_recommendation%ROWTYPE; v_new_version bigint;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED: you must be signed in to perform this action.';
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

  IF p_command_name = 'BN_RISK_REOPEN_ASSESSMENT' THEN
    PERFORM public._bn_risk_require(p_actor_user_id,'admin',true);
  ELSE
    PERFORM public._bn_risk_require(p_actor_user_id,'decide',true);
  END IF;

  SELECT * INTO v_a FROM public.bn_risk_assessment
   WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_NOT_FOUND: the Risk assessment could not be found.';
  END IF;
  IF p_expected_row_version IS NOT NULL AND v_a.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_VERSION_CONFLICT: this assessment changed while you were working. Reload and try again.';
  END IF;

  v_actor := public._bn_risk_actor_name(p_actor_user_id);
  v_new_version := v_a.row_version + 1;

  -- ------------------------------------------------ RECORD / CORRECT OUTCOME
  IF p_command_name IN ('BN_RISK_RECORD_OUTCOME','BN_RISK_OP_CORRECT_OUTCOME') THEN
    v_code := NULLIF(btrim(COALESCE(p_payload->>'outcome_code','')),'');
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a governed outcome must be selected.';
    END IF;
    SELECT * INTO v_t FROM public.bn_risk_outcome_type
     WHERE outcome_code = v_code AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_INVALID_OUTCOME: that outcome is not in the governed outcome catalogue.';
    END IF;
    IF v_t.asserts_legal_conclusion THEN
      RAISE EXCEPTION 'E_INVALID_OUTCOME: Risk cannot record a legal or criminal conclusion.';
    END IF;

    v_ready := public.bn_risk_outcome_readiness_v1(p_actor_user_id, p_assessment_id);
    IF p_command_name = 'BN_RISK_RECORD_OUTCOME' THEN
      IF NOT COALESCE((v_ready->'data'->>'can_record_outcome')::boolean,false) THEN
        RAISE EXCEPTION 'E_OUTCOME_BLOCKED: %',
          COALESCE(v_ready->'data'->'blockers'->>0,
                   'an outcome cannot be recorded for this assessment yet.');
      END IF;
    ELSE
      IF NOT COALESCE((v_ready->'data'->>'can_correct_outcome')::boolean,false) THEN
        RAISE EXCEPTION 'E_OUTCOME_BLOCKED: this outcome cannot be corrected.';
      END IF;
      IF NULLIF(btrim(COALESCE(p_payload->>'correction_reason_code','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_INVALID_INPUT: a correction reason is required.';
      END IF;
    END IF;

    -- fail closed on unresolved controls unless the outcome documents them
    IF COALESCE((v_ready->'data'->>'failed_executions')::int,0) > 0 THEN
      IF NOT v_t.allows_unresolved_control THEN
        RAISE EXCEPTION 'E_OUTCOME_BLOCKED: a control execution failed. Record an outcome that documents the unresolved control.';
      END IF;
      IF NULLIF(btrim(COALESCE(p_payload->>'unresolved_control_disposition','')),'') IS NULL THEN
        RAISE EXCEPTION 'E_INVALID_INPUT: describe how the unresolved control is being handled.';
      END IF;
    END IF;
    IF v_t.requires_settled_controls
       AND jsonb_array_length(COALESCE(v_ready->'data'->'outstanding_controls','[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'E_OUTCOME_BLOCKED: an approved control is still outstanding.';
    END IF;
    IF v_t.requires_justification
       AND NULLIF(btrim(COALESCE(p_payload->>'justification','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a justification is required for this outcome.';
    END IF;
    IF v_t.requires_reason
       AND NULLIF(btrim(COALESCE(p_payload->>'reason_code','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a governed outcome reason is required.';
    END IF;
    IF v_t.requires_external_reference
       AND NULLIF(btrim(COALESCE(p_payload->>'external_outcome_reference','')),'') IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: the reference returned by the owning module is required.';
    END IF;

    v_facts := public._bn_risk_outcome_control_facts(p_assessment_id);
    SELECT COALESCE(jsonb_agg(f),'[]'::jsonb) INTO v_refs
      FROM jsonb_array_elements(v_facts) f WHERE f->>'control_class' = 'REFERRAL';

    SELECT COALESCE(max(sequence_no),0) + 1 INTO v_seq
      FROM public.bn_risk_outcome WHERE assessment_id = p_assessment_id;
    SELECT * INTO v_prev FROM public.bn_risk_outcome
     WHERE assessment_id = p_assessment_id AND status = 'CURRENT' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.bn_risk_outcome
         SET status = 'SUPERSEDED', superseded_at = now()
       WHERE outcome_id = v_prev.outcome_id;
    END IF;

    SELECT * INTO v_rec FROM public.bn_risk_recommendation
     WHERE assessment_id = p_assessment_id AND status = 'APPROVED'
     ORDER BY cycle_no DESC LIMIT 1;

    INSERT INTO public.bn_risk_outcome(
      outcome_reference, assessment_id, sequence_no, phase_no,
      outcome_code, outcome_label, outcome_class, finding_classification, is_fraud_related,
      disposition_code, disposition_label, reason_code, reason_label, justification,
      control_execution_summary, referral_summary, unresolved_control_disposition,
      financial_impact_module, financial_impact_reference,
      external_outcome_reference, external_outcome_summary,
      supporting_factor_ids, supporting_evidence_ids,
      recommendation_id, decision_id, score_id, score_version_no,
      status, supersedes_outcome_id,
      correction_reason_code, correction_reason_label, correction_justification,
      recorded_by_user_id, recorded_by_name, assessment_row_version, correlation_id)
    VALUES (
      public._bn_risk_next_outcome_reference(), p_assessment_id, v_seq, v_a.phase_no,
      v_t.outcome_code, v_t.label, v_t.outcome_class, v_t.finding_classification, v_t.is_fraud_related,
      NULLIF(btrim(COALESCE(p_payload->>'disposition_code','')),''),
      public._bn_risk_ref_label('OUTCOME_DISPOSITION', p_payload->>'disposition_code'),
      NULLIF(btrim(COALESCE(p_payload->>'reason_code','')),''),
      public._bn_risk_ref_label('OUTCOME_REASON', p_payload->>'reason_code'),
      NULLIF(btrim(COALESCE(p_payload->>'justification','')),''),
      v_facts, v_refs,
      NULLIF(btrim(COALESCE(p_payload->>'unresolved_control_disposition','')),''),
      NULLIF(btrim(COALESCE(p_payload->>'financial_impact_module','')),''),
      NULLIF(btrim(COALESCE(p_payload->>'financial_impact_reference','')),''),
      NULLIF(btrim(COALESCE(p_payload->>'external_outcome_reference','')),''),
      NULLIF(btrim(COALESCE(p_payload->>'external_outcome_summary','')),''),
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(p_payload->'supporting_factor_ids','[]'::jsonb)) x),'{}'),
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(p_payload->'supporting_evidence_ids','[]'::jsonb)) x),'{}'),
      v_rec.recommendation_id, NULL,
      v_rec.score_id, v_rec.score_version_no,
      'CURRENT', v_prev.outcome_id,
      NULLIF(btrim(COALESCE(p_payload->>'correction_reason_code','')),''),
      public._bn_risk_ref_label('OUTCOME_CORRECTION_REASON', p_payload->>'correction_reason_code'),
      NULLIF(btrim(COALESCE(p_payload->>'correction_justification','')),''),
      p_actor_user_id, v_actor, v_a.row_version, COALESCE(p_correlation_id, v_a.correlation_id))
    RETURNING outcome_id INTO v_id;

    IF v_prev.outcome_id IS NOT NULL THEN
      UPDATE public.bn_risk_outcome SET superseded_by_outcome_id = v_id
       WHERE outcome_id = v_prev.outcome_id;
    END IF;

    UPDATE public.bn_risk_assessment
       SET status = CASE WHEN status IN ('CONTROL_ACTION','REFERRED') THEN 'COMPLETED' ELSE status END,
           completed_at = COALESCE(completed_at, now()),
           row_version = v_new_version, updated_at = now()
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_risk_assessment_event(p_assessment_id,
      CASE WHEN v_prev.outcome_id IS NULL THEN 'RISK_OUTCOME_RECORDED' ELSE 'RISK_OUTCOME_CORRECTED' END,
      p_command_name, v_a.status,
      CASE WHEN v_a.status IN ('CONTROL_ACTION','REFERRED') THEN 'COMPLETED' ELSE v_a.status END,
      p_payload->>'reason_code', p_payload->>'justification',
      jsonb_build_object('outcome_id', v_id, 'outcome_code', v_t.outcome_code,
        'finding_classification', v_t.finding_classification,
        'previous_outcome_id', v_prev.outcome_id),
      p_actor_user_id, NULL, 'OFFICER', COALESCE(p_correlation_id, v_a.correlation_id), v_new_version);

    IF v_a.status IN ('CONTROL_ACTION','REFERRED') THEN
      PERFORM public._bn_risk_assessment_event(p_assessment_id,'RISK_ASSESSMENT_COMPLETED',
        p_command_name, v_a.status, 'COMPLETED', NULL, NULL,
        jsonb_build_object('outcome_id', v_id),
        p_actor_user_id, NULL, 'OFFICER', COALESCE(p_correlation_id, v_a.correlation_id), v_new_version);
    END IF;

    v_result := jsonb_build_object('status','EXECUTED','command', p_command_name,
      'outcome_id', v_id, 'assessment_status','COMPLETED',
      'entity_version', v_new_version,
      'business_message', CASE WHEN v_prev.outcome_id IS NULL
        THEN 'Outcome recorded. The assessment is complete and ready for closure review.'
        ELSE 'Corrected outcome recorded. The previous outcome is retained.' END);

  -- ------------------------------------------------------------- CLOSE
  ELSIF p_command_name = 'BN_RISK_CLOSE_ASSESSMENT' THEN
    v_close := public.bn_risk_closure_readiness_v1(p_actor_user_id, p_assessment_id);
    IF NOT COALESCE((v_close->'data'->>'can_close')::boolean,false) THEN
      RAISE EXCEPTION 'E_CLOSURE_BLOCKED: %',
        COALESCE(v_close->'data'->'blockers'->>0,'this assessment cannot be closed yet.');
    END IF;
    v_reason := NULLIF(btrim(COALESCE(p_payload->>'closure_reason_code','')),'');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a governed closure reason is required.';
    END IF;
    SELECT * INTO v_prev FROM public.bn_risk_outcome
     WHERE assessment_id = p_assessment_id AND status='CURRENT';

    INSERT INTO public.bn_risk_assessment_closure(
      assessment_id, phase_no, outcome_id, outcome_code, outcome_label,
      closure_reason_code, closure_reason_label, closure_note,
      closed_by_user_id, closed_by_name, assessment_row_version, correlation_id)
    VALUES (p_assessment_id, v_a.phase_no, v_prev.outcome_id, v_prev.outcome_code,
      v_prev.outcome_label, v_reason,
      public._bn_risk_ref_label('CLOSURE_REASON', v_reason),
      NULLIF(btrim(COALESCE(p_payload->>'closure_note','')),''),
      p_actor_user_id, v_actor, v_a.row_version, COALESCE(p_correlation_id, v_a.correlation_id))
    RETURNING closure_id INTO v_id;

    UPDATE public.bn_risk_assessment
       SET status = 'CLOSED', last_closed_at = now(),
           row_version = v_new_version, updated_at = now()
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_risk_assessment_event(p_assessment_id,'RISK_ASSESSMENT_CLOSED',
      p_command_name, v_a.status, 'CLOSED', v_reason,
      NULLIF(btrim(COALESCE(p_payload->>'closure_note','')),''),
      jsonb_build_object('closure_id', v_id, 'outcome_id', v_prev.outcome_id,
        'outcome_code', v_prev.outcome_code),
      p_actor_user_id, NULL, 'OFFICER', COALESCE(p_correlation_id, v_a.correlation_id), v_new_version);

    v_result := jsonb_build_object('status','EXECUTED','command', p_command_name,
      'closure_id', v_id, 'assessment_status','CLOSED', 'entity_version', v_new_version,
      'business_message','Risk assessment closed. The full case history is retained.');

  -- ------------------------------------------------------------ REOPEN
  ELSIF p_command_name = 'BN_RISK_REOPEN_ASSESSMENT' THEN
    IF v_a.status <> 'CLOSED' THEN
      RAISE EXCEPTION 'E_REOPEN_NOT_ALLOWED: only a closed Risk assessment can be reopened.';
    END IF;
    v_reason := NULLIF(btrim(COALESCE(p_payload->>'reopen_reason_code','')),'');
    v_just := NULLIF(btrim(COALESCE(p_payload->>'justification','')),'');
    IF v_reason IS NULL OR v_just IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: a governed reopen reason and a justification are required.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bn_risk_reference_value
                    WHERE domain='REOPEN_REASON' AND code = v_reason AND is_active) THEN
      RAISE EXCEPTION 'E_INVALID_INPUT: that reopen reason is not in the governed catalogue.';
    END IF;

    -- The backend owns the destination state: material new information starts a
    -- fresh information phase; a governance or recording problem returns to review.
    v_dest := CASE WHEN v_reason IN ('NEW_MATERIAL_INFORMATION','EXTERNAL_MODULE_RESULT')
                   THEN 'OPEN' ELSE 'REVIEW' END;
    IF NOT public._bn_risk_assessment_can_transition('CLOSED', v_dest) THEN
      RAISE EXCEPTION 'E_INVALID_STATE: the reopen destination state is not permitted.';
    END IF;

    SELECT * INTO v_closure FROM public.bn_risk_assessment_closure
     WHERE assessment_id = p_assessment_id AND status = 'CLOSED'
     ORDER BY phase_no DESC LIMIT 1 FOR UPDATE;

    UPDATE public.bn_risk_assessment_closure
       SET status='REOPENED', reopened_at = now(), reopened_by_user_id = p_actor_user_id,
           reopened_by_name = v_actor, reopen_reason_code = v_reason,
           reopen_reason_label = public._bn_risk_ref_label('REOPEN_REASON', v_reason),
           reopen_justification = v_just, reopen_destination_status = v_dest
     WHERE closure_id = v_closure.closure_id;

    -- prior decisions become historical; nothing in a target domain is reversed
    UPDATE public.bn_risk_outcome SET status = 'HISTORICAL_AFTER_REOPEN'
     WHERE assessment_id = p_assessment_id AND status = 'CURRENT';
    UPDATE public.bn_risk_recommendation SET execution_state = 'NOT_APPLICABLE'
     WHERE assessment_id = p_assessment_id AND execution_state = 'AUTHORISED_PENDING_EXECUTION';

    UPDATE public.bn_risk_assessment
       SET status = v_dest,
           phase_no = phase_no + 1,
           reopen_count = reopen_count + 1,
           last_reopened_at = now(),
           completed_at = NULL,
           information_gathering_complete = CASE WHEN v_dest = 'OPEN' THEN false
                                                 ELSE information_gathering_complete END,
           information_complete_at = CASE WHEN v_dest = 'OPEN' THEN NULL
                                          ELSE information_complete_at END,
           scoring_review_completed_at = NULL,
           scoring_review_completed_by_user_id = NULL,
           row_version = v_new_version, updated_at = now()
     WHERE assessment_id = p_assessment_id;

    PERFORM public._bn_risk_assessment_event(p_assessment_id,'RISK_ASSESSMENT_REOPENED',
      p_command_name,'CLOSED', v_dest, v_reason, v_just,
      jsonb_build_object('closure_id', v_closure.closure_id,
        'previous_closed_at', v_closure.closed_at,
        'previous_closed_by', v_closure.closed_by_name,
        'previous_outcome_code', v_closure.outcome_code,
        'destination_status', v_dest,
        'external_effects','Reopening does not reverse any control, referral or owning-domain effect.'),
      p_actor_user_id, NULL,'OFFICER', COALESCE(p_correlation_id, v_a.correlation_id), v_new_version);

    v_result := jsonb_build_object('status','EXECUTED','command', p_command_name,
      'closure_id', v_closure.closure_id, 'assessment_status', v_dest,
      'entity_version', v_new_version,
      'business_message','Risk assessment reopened for a new review phase. The original closure is retained and no external control has been reversed.');
  ELSE
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: % is not a governed Risk outcome command.', p_command_name;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
      assessment_id, entity_version, result_json, status, actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''),
      p_assessment_id, v_new_version, v_result, 'COMPLETED', p_actor_user_id, now());
  END IF;

  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.bn_risk_outcome_command_v1(
  text,uuid,uuid,bigint,jsonb,uuid,text,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bn_risk_outcome_command_v1(
  text,uuid,uuid,bigint,jsonb,uuid,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_risk_outcome_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_risk_closure_readiness_v1(uuid,uuid) TO authenticated, service_role;

-- --------------------------------------------------------- 10. queue
CREATE OR REPLACE FUNCTION public.bn_risk_outcome_queue_v1(
  p_actor_user_id uuid, p_filters jsonb, p_page integer, p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_restricted boolean; v_bucket text; v_page int; v_size int;
  v_rows jsonb; v_total int; v_counts jsonb;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  v_restricted := COALESCE((public.bn_risk_check_actor_permission(
                    p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  v_bucket := NULLIF(btrim(COALESCE(p_filters->>'bucket','')),'');
  v_page := GREATEST(COALESCE(p_page,1),1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size,20),1),100);

  WITH base AS (
    SELECT a.assessment_id, a.assessment_reference, a.person_ssn, a.status,
           a.assigned_owner_user_id, a.assigned_team_code, a.reopen_count,
           a.completed_at, a.last_closed_at, a.last_reopened_at, a.updated_at,
           o.outcome_code, o.outcome_label, o.finding_classification, o.recorded_at,
           c.closed_at, c.closed_by_name, c.status AS closure_status,
           (SELECT count(*) FROM public.bn_risk_control_execution e
             WHERE e.assessment_id = a.assessment_id
               AND e.status IN ('PENDING','RETRY_PENDING','FAILED')) AS unsettled
      FROM public.bn_risk_assessment a
      LEFT JOIN public.bn_risk_outcome o
        ON o.assessment_id = a.assessment_id AND o.status = 'CURRENT'
      LEFT JOIN LATERAL (
        SELECT * FROM public.bn_risk_assessment_closure x
         WHERE x.assessment_id = a.assessment_id
         ORDER BY x.phase_no DESC LIMIT 1) c ON true
     WHERE a.status IN ('CONTROL_ACTION','REFERRED','COMPLETED','CLOSED')
        OR a.reopen_count > 0
  ), bucketed AS (
    SELECT b.*, CASE
      WHEN b.status = 'CLOSED' THEN 'CLOSED'
      WHEN b.reopen_count > 0 AND b.status <> 'CLOSED' THEN 'REOPENED'
      WHEN b.status = 'COMPLETED' THEN 'READY_TO_CLOSE'
      WHEN b.unsettled > 0 THEN 'OUTCOME_BLOCKED'
      ELSE 'READY_FOR_OUTCOME' END AS bucket FROM base b
  ), filtered AS (
    SELECT * FROM bucketed WHERE v_bucket IS NULL OR bucket = v_bucket
  ), page_rows AS (
    SELECT f.updated_at, jsonb_build_object(
      'assessment_id', f.assessment_id,
      'assessment_reference', f.assessment_reference,
      'person_name', public._bn_risk_person_display_name(f.person_ssn),
      'person_masked_identifier', public._bn_risk_mask_ssn(f.person_ssn),
      'assessment_status', f.status,
      'bucket', f.bucket,
      'stage_label', CASE f.bucket
        WHEN 'READY_FOR_OUTCOME' THEN 'Ready for outcome'
        WHEN 'OUTCOME_BLOCKED'   THEN 'Outcome blocked'
        WHEN 'READY_TO_CLOSE'    THEN 'Ready to close'
        WHEN 'CLOSED'            THEN 'Closed'
        ELSE 'Reopened' END,
      'action_required', CASE f.bucket
        WHEN 'READY_FOR_OUTCOME' THEN 'Record the governed outcome'
        WHEN 'OUTCOME_BLOCKED'   THEN 'Resolve the outstanding control'
        WHEN 'READY_TO_CLOSE'    THEN 'Review and close the assessment'
        WHEN 'CLOSED'            THEN 'No action required'
        ELSE 'Complete the new review phase' END,
      'outcome_code',  CASE WHEN v_restricted THEN f.outcome_code ELSE NULL END,
      'outcome_label', CASE WHEN v_restricted THEN f.outcome_label ELSE NULL END,
      'finding_classification', CASE WHEN v_restricted THEN f.finding_classification ELSE NULL END,
      'outcome_recorded_at', f.recorded_at,
      'closed_at', f.closed_at,
      'closed_by_name', f.closed_by_name,
      'reopen_count', f.reopen_count,
      'assigned_owner_name', public._bn_risk_actor_name(f.assigned_owner_user_id),
      'assigned_team_code', f.assigned_team_code,
      'age_days', GREATEST(0,(EXTRACT(EPOCH FROM (now() - f.updated_at))/86400)::int)
    ) AS row_json FROM filtered f
     ORDER BY f.updated_at DESC
     OFFSET (v_page-1)*v_size LIMIT v_size
  )
  SELECT COALESCE((SELECT jsonb_agg(row_json ORDER BY updated_at DESC) FROM page_rows),'[]'::jsonb),
         (SELECT count(*) FROM filtered),
         COALESCE((SELECT jsonb_object_agg(bucket, n) FROM (
            SELECT bucket, count(*) n FROM bucketed GROUP BY 1) c),'{}'::jsonb)
    INTO v_rows, v_total, v_counts;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', v_rows, 'total', COALESCE(v_total,0), 'page', v_page, 'page_size', v_size,
    'bucket_counts', v_counts, 'restricted_detail_visible', v_restricted));
END; $$;
GRANT EXECUTE ON FUNCTION public.bn_risk_outcome_queue_v1(uuid,jsonb,integer,integer) TO authenticated, service_role;

-- --------------------------------- 11. available actions incl. closed lockdown
CREATE OR REPLACE FUNCTION public.bn_risk_assessment_actions_v1(p_actor_user_id uuid, p_assessment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_write boolean; v_decide boolean; v_admin boolean; v_early boolean; v_closed boolean;
  v_ready jsonb; v_actions jsonb; v_score jsonb; v_review jsonb; v_rec jsonb; v_appr jsonb;
  v_out jsonb; v_close jsonb; v_pending boolean;
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
  v_admin := COALESCE((public.bn_risk_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);
  v_closed := v_a.status = 'CLOSED';
  v_early := v_a.status IN ('DRAFT','OPEN','INFORMATION_PENDING');
  v_ready := public.bn_risk_assessment_readiness_v1(p_actor_user_id, p_assessment_id);
  v_score := public.bn_risk_scoring_readiness_v1(p_actor_user_id, p_assessment_id);
  v_review := public.bn_risk_review_readiness_v1(p_actor_user_id, p_assessment_id);
  v_rec := public.bn_risk_recommendation_readiness_v1(p_actor_user_id, p_assessment_id);
  v_appr := public.bn_risk_control_approval_readiness_v1(p_actor_user_id, p_assessment_id);
  v_out := public.bn_risk_outcome_readiness_v1(p_actor_user_id, p_assessment_id);
  v_close := public.bn_risk_closure_readiness_v1(p_actor_user_id, p_assessment_id);
  v_pending := EXISTS (SELECT 1 FROM public.bn_risk_recommendation
                        WHERE assessment_id=p_assessment_id AND status='PENDING_APPROVAL'
                          AND recommended_by_user_id = p_actor_user_id);

  v_actions := jsonb_build_array(
    jsonb_build_object('action','ADD_FACTOR','label','Record factor',
      'command','BN_RISK_ADD_FACTOR','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','CORRECT_FACTOR','label','Correct factor',
      'command','BN_RISK_OP_CORRECT_FACTOR','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','VOID_FACTOR','label','Void factor',
      'command','BN_RISK_OP_VOID_FACTOR','enabled', v_decide AND v_early AND NOT v_closed),
    jsonb_build_object('action','LINK_EVIDENCE','label','Link evidence',
      'command','BN_RISK_OP_LINK_EVIDENCE','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','RECORD_EVIDENCE_USABILITY','label','Record evidence usability',
      'command','BN_RISK_OP_RECORD_EVIDENCE_USABILITY','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','REQUEST_EVIDENCE','label','Request information',
      'command','BN_RISK_REQUEST_EVIDENCE','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','RECORD_RESPONSE','label','Record response',
      'command','BN_RISK_OP_RECORD_REQUEST_RESPONSE','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','CLOSE_REQUEST','label','Close request',
      'command','BN_RISK_OP_CLOSE_REQUEST','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','ADD_SIGNAL','label','Add signal',
      'command','BN_RISK_OP_ADD_SIGNAL','enabled', v_write AND v_early AND NOT v_closed),
    jsonb_build_object('action','COMPLETE_INFORMATION_GATHERING','label','Complete information gathering',
      'command','BN_RISK_OP_COMPLETE_INFORMATION_GATHERING',
      'enabled', v_decide AND v_early AND NOT v_closed
                 AND COALESCE((v_ready->'data'->>'can_review')::boolean,false)),
    jsonb_build_object('action','CALCULATE_SCORE','label','Calculate risk score',
      'command','CALCULATE_SCORE',
      'enabled', NOT v_closed AND COALESCE((v_score->'data'->>'can_score')::boolean,false)
                 AND NOT COALESCE((v_score->'data'->>'has_score')::boolean,false)),
    jsonb_build_object('action','RECALCULATE_SCORE','label','Recalculate risk score',
      'command','RECALCULATE_SCORE',
      'enabled', NOT v_closed AND COALESCE((v_score->'data'->>'can_score')::boolean,false)
                 AND COALESCE((v_score->'data'->>'has_score')::boolean,false)),
    jsonb_build_object('action','COMPLETE_SCORING_REVIEW','label','Complete scoring and review',
      'command','COMPLETE_SCORING_REVIEW',
      'enabled', NOT v_closed AND COALESCE((v_review->'data'->>'can_complete_review')::boolean,false)),
    jsonb_build_object('action','RECOMMEND_CONTROL','label','Recommend control',
      'command','BN_RISK_RECOMMEND_CONTROL',
      'enabled', NOT v_closed AND COALESCE((v_rec->'data'->>'can_recommend')::boolean,false)),
    jsonb_build_object('action','WITHDRAW_RECOMMENDATION','label','Withdraw recommendation',
      'command','BN_RISK_OP_WITHDRAW_RECOMMENDATION',
      'enabled', v_write AND v_pending AND NOT v_closed),
    jsonb_build_object('action','APPROVE_CONTROL','label','Approve control',
      'command','BN_RISK_APPROVE_CONTROL',
      'enabled', NOT v_closed AND COALESCE((v_appr->'data'->>'can_approve')::boolean,false)),
    jsonb_build_object('action','REJECT_CONTROL','label','Reject control',
      'command','BN_RISK_APPROVE_CONTROL',
      'enabled', NOT v_closed AND COALESCE((v_appr->'data'->>'can_reject')::boolean,false)),
    jsonb_build_object('action','RETURN_CONTROL','label','Return for review',
      'command','BN_RISK_APPROVE_CONTROL',
      'enabled', NOT v_closed AND COALESCE((v_appr->'data'->>'can_return')::boolean,false)),
    jsonb_build_object('action','RECORD_OUTCOME','label','Record outcome',
      'command','BN_RISK_RECORD_OUTCOME',
      'enabled', NOT v_closed AND COALESCE((v_out->'data'->>'can_record_outcome')::boolean,false)),
    jsonb_build_object('action','CORRECT_OUTCOME','label','Correct outcome',
      'command','BN_RISK_OP_CORRECT_OUTCOME',
      'enabled', NOT v_closed AND COALESCE((v_out->'data'->>'can_correct_outcome')::boolean,false)),
    jsonb_build_object('action','CLOSE_ASSESSMENT','label','Close Risk assessment',
      'command','BN_RISK_CLOSE_ASSESSMENT',
      'enabled', NOT v_closed AND COALESCE((v_close->'data'->>'can_close')::boolean,false)),
    jsonb_build_object('action','REOPEN_ASSESSMENT','label','Reopen Risk assessment',
      'command','BN_RISK_REOPEN_ASSESSMENT',
      'enabled', v_closed AND v_admin AND COALESCE((v_close->'data'->>'can_reopen')::boolean,false)));

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'row_version', v_a.row_version,
    'is_closed', v_closed,
    'can_recommend', COALESCE((v_rec->'data'->>'can_recommend')::boolean,false),
    'can_approve', COALESCE((v_appr->'data'->>'can_approve')::boolean,false),
    'can_reject', COALESCE((v_appr->'data'->>'can_reject')::boolean,false),
    'can_return', COALESCE((v_appr->'data'->>'can_return')::boolean,false),
    'can_record_outcome', COALESCE((v_out->'data'->>'can_record_outcome')::boolean,false),
    'can_close', COALESCE((v_close->'data'->>'can_close')::boolean,false),
    'can_reopen', COALESCE((v_close->'data'->>'can_reopen')::boolean,false),
    'actions', v_actions,
    'notice', CASE
      WHEN v_closed THEN 'This Risk assessment is closed. The case history is read-only.'
      WHEN v_a.status = 'COMPLETED' THEN 'The outcome is recorded. The assessment is ready for closure review.'
      WHEN v_a.status IN ('CONTROL_ACTION','REFERRED')
        THEN 'The approved control is with its owning domain. Record the governed outcome once the control or referral is settled.'
      ELSE NULL END));
END; $function$;