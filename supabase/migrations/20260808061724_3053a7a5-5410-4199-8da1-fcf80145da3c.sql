-- ===========================================================================
-- BN RISK / FRAUD — EPIC 4: approved control execution and governed handoffs.
-- Risk decides an approved control should be executed; the owning domain
-- executes its own business action through the shared cross-module handoff
-- spine; Risk records the returned reference and status. Risk never writes a
-- payment, award, claim, person, overpayment, legal or investigation record.
-- ===========================================================================

-- ---------------------------------------------------------------- target map
CREATE TABLE IF NOT EXISTS public.bn_risk_control_target_boundary (
  control_code            text PRIMARY KEY,
  execution_class         text NOT NULL,
  boundary_kind           text NOT NULL
    CHECK (boundary_kind IN ('CROSS_MODULE_HANDOFF','RISK_INTERNAL','UNAVAILABLE')),
  target_module           text,
  handoff_type            text,
  is_asynchronous         boolean NOT NULL DEFAULT true,
  requires_confirmation   boolean NOT NULL DEFAULT true,
  missing_capability      text,
  required_parameters     text[] NOT NULL DEFAULT '{}',
  permitted_runtime_fields text[] NOT NULL DEFAULT '{}',
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.bn_risk_control_target_boundary TO service_role;
REVOKE ALL ON public.bn_risk_control_target_boundary FROM anon, authenticated;
ALTER TABLE public.bn_risk_control_target_boundary ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bn_risk_control_target_boundary
  (control_code, execution_class, boundary_kind, target_module, handoff_type,
   is_asynchronous, requires_confirmation, missing_capability,
   required_parameters, permitted_runtime_fields)
VALUES
  ('TEMPORARY_PAYMENT_HOLD','PAYMENT_CONTROL','CROSS_MODULE_HANDOFF','bn_payments',
   'PAYMENT_HOLD_REQUEST', true, true, NULL,
   ARRAY['target_type','target_id','requested_effective_from'], ARRAY['operational_note']),
  ('ENHANCED_VERIFICATION','VERIFICATION','CROSS_MODULE_HANDOFF','bn_verification',
   'ENHANCED_VERIFICATION_REQUEST', true, false, NULL,
   ARRAY['reason_code'], ARRAY['operational_note']),
  ('REFER_TO_LEGAL','REFERRAL','CROSS_MODULE_HANDOFF','bn_legal',
   'LEGAL_REFERRAL', true, true, NULL,
   ARRAY['reason_code','justification'], ARRAY['operational_note']),
  ('REFER_TO_INVESTIGATION','REFERRAL','CROSS_MODULE_HANDOFF','bn_investigation',
   'INVESTIGATION_REFERRAL', true, true, NULL,
   ARRAY['reason_code','justification'], ARRAY['operational_note']),
  ('CREATE_OVERPAYMENT_REVIEW','FINANCIAL_REVIEW','CROSS_MODULE_HANDOFF','bn_overpayment',
   'OVERPAYMENT_REVIEW_REQUEST', true, true, NULL,
   ARRAY['target_type','target_id'], ARRAY['operational_note']),
  ('RECALCULATE_CLAIM','FINANCIAL_REVIEW','CROSS_MODULE_HANDOFF','bn_claim',
   'CLAIM_RECALCULATION_REQUEST', true, true, NULL,
   ARRAY['target_type','target_id'], ARRAY['operational_note']),
  ('SUPERVISOR_REVIEW','MONITORING','CROSS_MODULE_HANDOFF','bn_workflow',
   'SUPERVISOR_REVIEW_TASK', true, false, NULL,
   ARRAY['reason_code'], ARRAY['operational_note']),
  ('CORRECT_SYSTEM_ERROR','REMEDIATION','CROSS_MODULE_HANDOFF','bn_operations',
   'SYSTEM_ERROR_REMEDIATION', true, true, NULL,
   ARRAY['reason_code','justification'], ARRAY['operational_note']),
  ('CORRECT_STAFF_ERROR','REMEDIATION','CROSS_MODULE_HANDOFF','bn_operations',
   'STAFF_ERROR_REMEDIATION', true, true, NULL,
   ARRAY['reason_code','justification'], ARRAY['operational_note']),
  -- Reuses the Epic 1 Risk evidence-request engine; no second document engine.
  ('REQUEST_DOCUMENTS','VERIFICATION','RISK_INTERNAL','bn_risk',
   'RISK_EVIDENCE_REQUEST', true, false, NULL,
   ARRAY['information_request_id'], ARRAY['operational_note']),
  ('NO_ACTION','NO_EXTERNAL_CONTROL','RISK_INTERNAL', NULL, NULL,
   false, false, NULL, '{}', '{}'),
  -- No governed Person/profile change-control boundary exists in this platform.
  ('PREVENT_PROFILE_CHANGE','PROFILE_CONTROL','UNAVAILABLE','bn_registration', NULL,
   true, true,
   'A governed Person/profile change-control boundary (registration change restriction command) does not exist yet.',
   '{}', '{}')
ON CONFLICT (control_code) DO NOTHING;

-- ------------------------------------------------------------- execution log
CREATE SEQUENCE IF NOT EXISTS public.bn_risk_execution_reference_seq;

CREATE OR REPLACE FUNCTION public._bn_risk_next_execution_reference()
RETURNS text LANGUAGE sql VOLATILE SET search_path TO 'public' AS $$
  SELECT 'RXE-' || to_char(now(),'YYYY') || '-' ||
         lpad(nextval('public.bn_risk_execution_reference_seq')::text, 6, '0');
$$;

CREATE TABLE IF NOT EXISTS public.bn_risk_control_execution (
  execution_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_reference      text NOT NULL UNIQUE,
  assessment_id            uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id),
  recommendation_id        uuid NOT NULL REFERENCES public.bn_risk_recommendation(recommendation_id),
  decision_id              uuid REFERENCES public.bn_risk_recommendation_decision(decision_id),
  control_code             text NOT NULL,
  control_label            text,
  command_name             text NOT NULL,
  execution_class          text NOT NULL,
  boundary_kind            text NOT NULL,
  target_module            text,
  target_type              text,
  target_business_reference text,
  target_internal_reference text,
  target_operation_reference text,
  target_correlation_reference uuid,
  handoff_id               uuid REFERENCES public.bn_cross_module_handoff(handoff_id),
  target_status            text,
  status                   text NOT NULL,
  attempt_no               integer NOT NULL DEFAULT 1,
  approved_parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  runtime_parameters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_user_id     uuid NOT NULL,
  requested_by_name        text,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  accepted_at              timestamptz,
  completed_at             timestamptz,
  failed_at                timestamptz,
  failure_code             text,
  failure_summary          text,
  is_retryable             boolean NOT NULL DEFAULT false,
  retries_execution_id     uuid REFERENCES public.bn_risk_control_execution(execution_id),
  correlation_id           uuid,
  row_version              bigint NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bn_risk_control_execution_assessment_idx
  ON public.bn_risk_control_execution(assessment_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS bn_risk_control_execution_recommendation_idx
  ON public.bn_risk_control_execution(recommendation_id, attempt_no DESC);

GRANT ALL ON public.bn_risk_control_execution TO service_role;
REVOKE ALL ON public.bn_risk_control_execution FROM anon, authenticated;
ALTER TABLE public.bn_risk_control_execution ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_risk_control_execution_event (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id   uuid NOT NULL REFERENCES public.bn_risk_control_execution(execution_id),
  assessment_id  uuid NOT NULL,
  event_code     text NOT NULL,
  from_status    text,
  to_status      text,
  attempt_no     integer,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id  uuid,
  actor_name     text,
  actor_source   text,
  correlation_id uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bn_risk_control_execution_event_exec_idx
  ON public.bn_risk_control_execution_event(execution_id, occurred_at);

GRANT ALL ON public.bn_risk_control_execution_event TO service_role;
REVOKE ALL ON public.bn_risk_control_execution_event FROM anon, authenticated;
ALTER TABLE public.bn_risk_control_execution_event ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION public._bn_risk_exec_status_from_handoff(p_handoff_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_handoff_status
    WHEN 'RAISED'    THEN 'PENDING'
    WHEN 'PENDING'   THEN 'PENDING'
    WHEN 'ACCEPTED'  THEN 'ACCEPTED'
    WHEN 'LINKED'    THEN 'PROCESSING'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'REJECTED'  THEN 'REJECTED_BY_TARGET'
    WHEN 'FAILED'    THEN 'FAILED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE 'PENDING' END;
$$;

CREATE OR REPLACE FUNCTION public._bn_risk_exec_status_label(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_status
    WHEN 'NOT_STARTED'        THEN 'Not started'
    WHEN 'READY'              THEN 'Ready to execute'
    WHEN 'PENDING'            THEN 'Requested — awaiting the owning domain'
    WHEN 'ACCEPTED'           THEN 'Accepted by the owning domain'
    WHEN 'PROCESSING'         THEN 'Being processed by the owning domain'
    WHEN 'COMPLETED'          THEN 'Completed by the owning domain'
    WHEN 'FAILED'             THEN 'Execution failed'
    WHEN 'REJECTED_BY_TARGET' THEN 'Rejected by the owning domain'
    WHEN 'RETRY_PENDING'      THEN 'Retry requested'
    WHEN 'CANCELLED'          THEN 'Cancelled'
    ELSE 'Unknown' END;
$$;

CREATE OR REPLACE FUNCTION public._bn_risk_exec_event_label(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_code
    WHEN 'CONTROL_EXECUTION_REQUESTED'        THEN 'Approved control submitted for execution'
    WHEN 'CONTROL_EXECUTION_ACCEPTED'         THEN 'Owning domain accepted the control'
    WHEN 'CONTROL_EXECUTION_PROCESSING'       THEN 'Owning domain is processing the control'
    WHEN 'CONTROL_EXECUTION_COMPLETED'        THEN 'Control execution completed'
    WHEN 'CONTROL_EXECUTION_FAILED'           THEN 'Control execution failed'
    WHEN 'CONTROL_EXECUTION_RETRY_REQUESTED'  THEN 'Control execution retried'
    WHEN 'CONTROL_EXECUTION_REJECTED_BY_TARGET' THEN 'Owning domain rejected the control'
    WHEN 'CONTROL_EXECUTION_CANCELLED'        THEN 'Control execution cancelled'
    WHEN 'PAYMENT_HOLD_REQUESTED'             THEN 'Payment hold requested from Payments'
    WHEN 'ENHANCED_VERIFICATION_REQUESTED'    THEN 'Enhanced verification requested'
    WHEN 'LEGAL_REFERRAL_REQUESTED'           THEN 'Legal referral submitted'
    WHEN 'LEGAL_REFERRAL_ACCEPTED'            THEN 'Legal referral accepted'
    WHEN 'INVESTIGATION_REFERRAL_REQUESTED'   THEN 'Investigation referral submitted'
    WHEN 'INVESTIGATION_REFERRAL_ACCEPTED'    THEN 'Investigation referral accepted'
    ELSE initcap(replace(lower(p_code),'_',' ')) END;
$$;

/** The one command that a control code may be executed with. */
CREATE OR REPLACE FUNCTION public._bn_risk_exec_command_for_control(p_control text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_control
    WHEN 'TEMPORARY_PAYMENT_HOLD'   THEN 'BN_RISK_PLACE_PAYMENT_HOLD'
    WHEN 'ENHANCED_VERIFICATION'    THEN 'BN_RISK_REQUEST_ENH_VERIFICATION'
    WHEN 'REFER_TO_LEGAL'           THEN 'BN_RISK_REFER_TO_LEGAL'
    WHEN 'REFER_TO_INVESTIGATION'   THEN 'BN_RISK_REFER_TO_INVESTIGATION'
    ELSE 'BN_RISK_OP_EXECUTE_CONTROL' END;
$$;

/** One immutable attempt as JSON. */
CREATE OR REPLACE FUNCTION public._bn_risk_execution_json(e public.bn_risk_control_execution)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'execution_id', e.execution_id,
    'execution_reference', e.execution_reference,
    'assessment_id', e.assessment_id,
    'recommendation_id', e.recommendation_id,
    'decision_id', e.decision_id,
    'control_code', e.control_code,
    'control_label', e.control_label,
    'command_name', e.command_name,
    'execution_class', e.execution_class,
    'target_module', e.target_module,
    'target_type', e.target_type,
    'target_business_reference', e.target_business_reference,
    'target_internal_reference', e.target_internal_reference,
    'target_operation_reference', e.target_operation_reference,
    'target_correlation_reference', e.target_correlation_reference,
    'target_status', e.target_status,
    'status', e.status,
    'attempt_no', e.attempt_no,
    'requested_by_name', e.requested_by_name,
    'requested_at', e.requested_at,
    'accepted_at', e.accepted_at,
    'completed_at', e.completed_at,
    'failed_at', e.failed_at,
    'failure_code', e.failure_code,
    'failure_summary', e.failure_summary,
    'is_retryable', e.is_retryable,
    'retries_execution_id', e.retries_execution_id,
    'row_version', e.row_version);
$$;

-- ------------------------------------------------- execution readiness (read)
CREATE OR REPLACE FUNCTION public.bn_risk_control_execution_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_a public.bn_risk_assessment%ROWTYPE;
  v_r public.bn_risk_recommendation%ROWTYPE;
  v_tb public.bn_risk_control_target_boundary%ROWTYPE;
  v_ct public.bn_risk_control_type%ROWTYPE;
  v_cur public.bn_risk_control_execution%ROWTYPE;
  v_d public.bn_risk_recommendation_decision%ROWTYPE;
  v_b text[] := '{}'; v_w text[] := '{}';
  v_decide boolean; v_state text; v_status text := 'NOT_STARTED';
  v_action text := 'NONE'; v_can boolean := false; v_newer int := 0;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  SELECT * INTO v_a FROM public.bn_risk_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;

  v_decide := COALESCE((public.bn_risk_check_actor_permission(
                p_actor_user_id,'decide',true)->>'ok')::boolean,false);

  SELECT * INTO v_r FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND status = 'APPROVED'
   ORDER BY cycle_no DESC LIMIT 1;

  IF v_r.recommendation_id IS NULL THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
      'assessment_id', p_assessment_id,
      'assessment_status', v_a.status,
      'assessment_row_version', v_a.row_version,
      'state','NO_APPROVED_CONTROL',
      'can_execute', false,
      'available_action','NONE',
      'blockers', to_jsonb(ARRAY['There is no independently approved control to execute.']),
      'warnings','[]'::jsonb,
      'approval', NULL, 'target', NULL, 'command_name', NULL,
      'required_parameters','[]'::jsonb, 'permitted_runtime_fields','[]'::jsonb,
      'current_execution', NULL, 'attempts','[]'::jsonb, 'history','[]'::jsonb,
      'is_retryable', false, 'execution_status','NOT_STARTED',
      'status_label', public._bn_risk_exec_status_label('NOT_STARTED'),
      'restricted_detail_visible', v_decide));
  END IF;

  SELECT * INTO v_d FROM public.bn_risk_recommendation_decision
   WHERE recommendation_id = v_r.recommendation_id AND decision = 'APPROVE'
   ORDER BY decided_at DESC LIMIT 1;
  SELECT * INTO v_ct FROM public.bn_risk_control_type WHERE control_code = v_r.control_code;
  SELECT * INTO v_tb FROM public.bn_risk_control_target_boundary
   WHERE control_code = v_r.control_code AND is_active;
  SELECT * INTO v_cur FROM public.bn_risk_control_execution
   WHERE recommendation_id = v_r.recommendation_id
   ORDER BY attempt_no DESC LIMIT 1;

  SELECT count(*) INTO v_newer FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND cycle_no > v_r.cycle_no;

  IF v_cur.execution_id IS NOT NULL THEN v_status := v_cur.status; END IF;

  -- Standing prerequisites. Score and band never authorise anything.
  IF v_r.execution_state <> 'AUTHORISED_PENDING_EXECUTION'
     AND NOT (v_r.control_code = 'NO_ACTION' AND v_r.execution_state = 'NOT_APPLICABLE') THEN
    v_b := v_b || 'This control is not authorised for execution.';
  END IF;
  IF v_d.decision_id IS NULL THEN
    v_b := v_b || 'The independent approval decision for this control could not be found.';
  END IF;
  IF v_newer > 0 THEN
    v_b := v_b || 'A newer recommendation cycle exists. This approval is no longer current.';
  END IF;
  IF v_a.status NOT IN ('CONTROL_ACTION','REFERRED') THEN
    v_b := v_b || 'This assessment is not at the control execution stage.';
  END IF;
  IF v_ct.control_code IS NULL OR NOT v_ct.is_active THEN
    v_b := v_b || 'The approved control is no longer available.';
  END IF;
  IF NOT v_decide THEN
    v_b := v_b || 'You do not have permission to execute approved controls.';
  END IF;
  IF v_tb.control_code IS NULL OR v_tb.boundary_kind = 'UNAVAILABLE' THEN
    v_b := v_b || COALESCE(v_tb.missing_capability,
      'No governed execution boundary exists for this control.');
  END IF;
  IF v_status IN ('COMPLETED') THEN
    v_b := v_b || 'This control has already been executed successfully.';
  END IF;
  IF v_status IN ('PENDING','ACCEPTED','PROCESSING','RETRY_PENDING') THEN
    v_b := v_b || 'An execution request is already with the owning domain.';
  END IF;
  IF v_status = 'REJECTED_BY_TARGET' THEN
    v_b := v_b || 'The owning domain rejected this control. Record the outcome instead of re-executing.';
  END IF;
  IF v_status = 'FAILED' AND NOT COALESCE(v_cur.is_retryable,false) THEN
    v_b := v_b || 'This execution failed and the owning domain has not marked it retryable.';
  END IF;
  IF v_r.is_benefit_affecting THEN
    v_w := v_w || 'This control affects a benefit. The owning domain performs the business action; Risk only records the result.';
  END IF;

  -- Governed action selection.
  IF v_status IN ('PENDING','ACCEPTED','PROCESSING','RETRY_PENDING') AND v_decide THEN
    v_action := 'REFRESH';
  ELSIF v_status = 'FAILED' AND COALESCE(v_cur.is_retryable,false) AND v_decide
        AND v_tb.boundary_kind <> 'UNAVAILABLE' AND v_newer = 0 THEN
    v_action := 'RETRY';
    v_can := true;
  ELSIF array_length(v_b,1) IS NULL AND v_cur.execution_id IS NULL THEN
    v_action := 'EXECUTE';
    v_can := true;
  END IF;

  v_state := CASE
    WHEN v_tb.control_code IS NULL OR v_tb.boundary_kind = 'UNAVAILABLE' THEN 'CONTROL_EXECUTION_BLOCKED'
    WHEN NOT v_decide THEN 'DENIED'
    WHEN v_newer > 0 THEN 'STALE'
    WHEN v_status = 'COMPLETED' THEN 'COMPLETED'
    WHEN v_status = 'REJECTED_BY_TARGET' THEN 'REJECTED_BY_TARGET'
    WHEN v_status = 'FAILED' AND COALESCE(v_cur.is_retryable,false) THEN 'RETRYABLE'
    WHEN v_status = 'FAILED' THEN 'NON_RETRYABLE'
    WHEN v_status IN ('ACCEPTED','PROCESSING') THEN 'PROCESSING'
    WHEN v_status IN ('PENDING','RETRY_PENDING') THEN 'PENDING'
    WHEN v_action = 'EXECUTE' THEN 'READY'
    ELSE 'BLOCKED' END;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'assessment_row_version', v_a.row_version,
    'state', v_state,
    'can_execute', v_can,
    'available_action', v_action,
    'blockers', to_jsonb(v_b),
    'warnings', to_jsonb(v_w),
    'approval', jsonb_build_object(
      'recommendation_id', v_r.recommendation_id,
      'recommendation_reference', v_r.recommendation_reference,
      'control_code', v_r.control_code,
      'control_label', v_r.control_label,
      'is_benefit_affecting', v_r.is_benefit_affecting,
      'approved_reason_code', v_d.reason_code,
      'approved_reason_label', v_d.reason_label,
      'approved_justification', v_r.justification,
      'approved_by_name', v_r.decided_by_name,
      'approved_at', v_r.decided_at,
      'recommended_by_name', v_r.recommended_by_name,
      'decision_id', v_d.decision_id,
      'target_type', v_r.target_type,
      'target_reference', v_r.target_reference,
      'requested_effective_from', v_r.requested_effective_from,
      'requested_effective_to', v_r.requested_effective_to,
      'scope_note', v_r.scope_note,
      'score_id', v_r.score_id,
      'score_version_no', v_r.score_version_no,
      'rule_set_code', v_r.rule_set_code,
      'rule_set_version_no', v_r.rule_set_version_no),
    'target', CASE WHEN v_tb.control_code IS NULL THEN NULL ELSE jsonb_build_object(
      'control_code', v_tb.control_code,
      'control_label', v_ct.label,
      'execution_class', v_tb.execution_class,
      'boundary_kind', v_tb.boundary_kind,
      'execution_owner', v_ct.execution_owner,
      'target_module', v_tb.target_module,
      'handoff_type', v_tb.handoff_type,
      'is_asynchronous', v_tb.is_asynchronous,
      'requires_confirmation', v_tb.requires_confirmation,
      'missing_capability', v_tb.missing_capability) END,
    'command_name', public._bn_risk_exec_command_for_control(v_r.control_code),
    'required_parameters', to_jsonb(COALESCE(v_tb.required_parameters,'{}')),
    'permitted_runtime_fields', to_jsonb(COALESCE(v_tb.permitted_runtime_fields,'{}')),
    'current_execution', CASE WHEN v_cur.execution_id IS NULL THEN NULL
                              ELSE public._bn_risk_execution_json(v_cur) END,
    'attempts', COALESCE((SELECT jsonb_agg(public._bn_risk_execution_json(e) ORDER BY e.attempt_no)
                            FROM public.bn_risk_control_execution e
                           WHERE e.recommendation_id = v_r.recommendation_id),'[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'event_code', ev.event_code,
                            'label', public._bn_risk_exec_event_label(ev.event_code),
                            'occurred_at', ev.occurred_at,
                            'actor_name', ev.actor_name,
                            'attempt_no', ev.attempt_no) ORDER BY ev.occurred_at)
                           FROM public.bn_risk_control_execution_event ev
                           JOIN public.bn_risk_control_execution e2
                             ON e2.execution_id = ev.execution_id
                          WHERE e2.recommendation_id = v_r.recommendation_id),'[]'::jsonb),
    'is_retryable', COALESCE(v_cur.is_retryable,false),
    'execution_status', v_status,
    'status_label', public._bn_risk_exec_status_label(v_status),
    'restricted_detail_visible', v_decide));
END; $$;

-- --------------------------------------------------------- outcome readiness
CREATE OR REPLACE FUNCTION public.bn_risk_outcome_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perm jsonb; v_b text[] := '{}';
  v_approved int; v_settled int; v_pending int; v_failed int; v_referrals int; v_ref_settled int;
BEGIN
  v_perm := public.bn_risk_check_actor_permission(p_actor_user_id,'read',false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  SELECT count(*) INTO v_approved FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND status='APPROVED';
  SELECT count(*) INTO v_settled FROM public.bn_risk_recommendation r
   WHERE r.assessment_id = p_assessment_id AND r.status='APPROVED'
     AND (r.control_code = 'NO_ACTION'
          OR EXISTS (SELECT 1 FROM public.bn_risk_control_execution e
                      WHERE e.recommendation_id = r.recommendation_id
                        AND e.status IN ('COMPLETED','REJECTED_BY_TARGET','CANCELLED')));
  SELECT count(*) INTO v_pending FROM public.bn_risk_control_execution e
   WHERE e.assessment_id = p_assessment_id
     AND e.status IN ('PENDING','ACCEPTED','PROCESSING','RETRY_PENDING');
  SELECT count(*) INTO v_failed FROM public.bn_risk_control_execution e
   WHERE e.assessment_id = p_assessment_id AND e.status = 'FAILED';
  SELECT count(*) INTO v_referrals FROM public.bn_risk_recommendation r
   WHERE r.assessment_id = p_assessment_id AND r.status='APPROVED' AND r.control_class='REFERRAL';
  SELECT count(*) INTO v_ref_settled FROM public.bn_risk_recommendation r
   WHERE r.assessment_id = p_assessment_id AND r.status='APPROVED' AND r.control_class='REFERRAL'
     AND EXISTS (SELECT 1 FROM public.bn_risk_control_execution e
                  WHERE e.recommendation_id = r.recommendation_id
                    AND e.status IN ('ACCEPTED','PROCESSING','COMPLETED','REJECTED_BY_TARGET'));

  IF v_approved > v_settled THEN v_b := v_b || 'Approved controls are still awaiting execution.'; END IF;
  IF v_pending > 0 THEN v_b := v_b || 'An execution request is still with an owning domain.'; END IF;
  IF v_failed > 0 THEN v_b := v_b || 'A control execution has failed and needs attention.'; END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment_id', p_assessment_id,
    'all_controls_executed', (v_approved = v_settled),
    'all_referrals_settled', (v_referrals = v_ref_settled),
    'pending_attempts', v_pending,
    'failed_attempts', v_failed,
    'ready_for_outcome', (array_length(v_b,1) IS NULL AND v_approved > 0),
    'blockers', to_jsonb(v_b)));
END; $$;

-- ------------------------------------------------------------ execution queue
CREATE OR REPLACE FUNCTION public.bn_risk_control_execution_queue_v1(
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

  CREATE TEMP TABLE IF NOT EXISTS _bn_risk_exec_q (LIKE public.bn_risk_assessment) ON COMMIT DROP;

  WITH base AS (
    SELECT a.assessment_id, a.assessment_reference, a.person_id, a.person_ssn, a.status,
           a.assigned_team_code, a.assigned_owner_user_id,
           r.recommendation_id, r.control_code, r.control_label, r.control_class,
           r.decided_at,
           e.status AS exec_status, e.target_module, e.is_retryable
      FROM public.bn_risk_assessment a
      JOIN public.bn_risk_recommendation r
        ON r.assessment_id = a.assessment_id AND r.status = 'APPROVED'
      LEFT JOIN LATERAL (
        SELECT * FROM public.bn_risk_control_execution x
         WHERE x.recommendation_id = r.recommendation_id
         ORDER BY x.attempt_no DESC LIMIT 1) e ON true
     WHERE a.status IN ('CONTROL_ACTION','REFERRED')
  ), bucketed AS (
    SELECT b.*, CASE
      WHEN b.exec_status IS NULL THEN 'AWAITING_EXECUTION'
      WHEN b.exec_status = 'FAILED' AND b.is_retryable THEN 'RETRY_AVAILABLE'
      WHEN b.exec_status = 'FAILED' THEN 'FAILED'
      WHEN b.exec_status = 'REJECTED_BY_TARGET' THEN 'REJECTED_BY_TARGET'
      WHEN b.exec_status = 'COMPLETED' THEN 'AWAITING_OUTCOME'
      WHEN b.control_class = 'REFERRAL' THEN 'REFERRAL_PENDING'
      ELSE 'IN_PROGRESS' END AS bucket
      FROM base b
  ), filtered AS (
    SELECT * FROM bucketed WHERE v_bucket IS NULL OR bucket = v_bucket
  )
  SELECT
    COALESCE(jsonb_agg(row_json ORDER BY decided_at NULLS LAST), '[]'::jsonb),
    (SELECT count(*) FROM filtered)
  INTO v_rows, v_total
  FROM (
    SELECT f.decided_at, jsonb_build_object(
      'assessment_id', f.assessment_id,
      'assessment_reference', f.assessment_reference,
      'person_name', public._bn_risk_person_display_name(f.person_ssn),
      'person_masked_identifier', public._bn_risk_mask_ssn(f.person_ssn),
      'current_stage', CASE WHEN f.status='REFERRED' THEN 'Referral' ELSE 'Control execution' END,
      'execution_status', COALESCE(f.exec_status,'NOT_STARTED'),
      'execution_status_label', public._bn_risk_exec_status_label(COALESCE(f.exec_status,'NOT_STARTED')),
      'target_module', f.target_module,
      'approved_at', f.decided_at,
      'age_days', GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(f.decided_at, now())))/86400)::int),
      'assigned_owner_name', public._bn_risk_actor_name(f.assigned_owner_user_id),
      'assigned_team_code', f.assigned_team_code,
      'action_required', CASE f.bucket
        WHEN 'AWAITING_EXECUTION' THEN 'Control execution required'
        WHEN 'RETRY_AVAILABLE'    THEN 'Execution failed — retry available'
        WHEN 'FAILED'             THEN 'Execution failed'
        WHEN 'REJECTED_BY_TARGET' THEN 'Owning domain rejected the control'
        WHEN 'AWAITING_OUTCOME'   THEN 'Execution complete — awaiting outcome'
        WHEN 'REFERRAL_PENDING'   THEN 'Referral handoff pending'
        ELSE 'Execution in progress' END,
      'control_code',  CASE WHEN v_restricted THEN f.control_code ELSE NULL END,
      'control_label', CASE WHEN v_restricted THEN f.control_label ELSE NULL END
    ) AS row_json
      FROM filtered f
     ORDER BY f.decided_at NULLS LAST
     OFFSET (v_page-1)*v_size LIMIT v_size) page_rows;

  WITH base AS (
    SELECT r.recommendation_id, r.control_class,
           e.status AS exec_status, e.is_retryable
      FROM public.bn_risk_assessment a
      JOIN public.bn_risk_recommendation r
        ON r.assessment_id = a.assessment_id AND r.status='APPROVED'
      LEFT JOIN LATERAL (
        SELECT * FROM public.bn_risk_control_execution x
         WHERE x.recommendation_id = r.recommendation_id
         ORDER BY x.attempt_no DESC LIMIT 1) e ON true
     WHERE a.status IN ('CONTROL_ACTION','REFERRED'))
  SELECT COALESCE(jsonb_object_agg(bucket, n),'{}'::jsonb) INTO v_counts FROM (
    SELECT CASE
      WHEN exec_status IS NULL THEN 'AWAITING_EXECUTION'
      WHEN exec_status = 'FAILED' AND is_retryable THEN 'RETRY_AVAILABLE'
      WHEN exec_status = 'FAILED' THEN 'FAILED'
      WHEN exec_status = 'REJECTED_BY_TARGET' THEN 'REJECTED_BY_TARGET'
      WHEN exec_status = 'COMPLETED' THEN 'AWAITING_OUTCOME'
      WHEN control_class = 'REFERRAL' THEN 'REFERRAL_PENDING'
      ELSE 'IN_PROGRESS' END AS bucket, count(*) n
      FROM base GROUP BY 1) c;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'rows', v_rows, 'total', COALESCE(v_total,0), 'page', v_page, 'page_size', v_size,
    'bucket_counts', v_counts, 'restricted_detail_visible', v_restricted));
END; $$;

-- ------------------------------------------------------- execution command
CREATE OR REPLACE FUNCTION public.bn_risk_control_execution_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_reason_code text,
  p_justification text, p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_existing public.bn_risk_command_idempotency%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload,'{}'::jsonb);
  v_a public.bn_risk_assessment%ROWTYPE;
  v_r public.bn_risk_recommendation%ROWTYPE;
  v_d public.bn_risk_recommendation_decision%ROWTYPE;
  v_tb public.bn_risk_control_target_boundary%ROWTYPE;
  v_prev public.bn_risk_control_execution%ROWTYPE;
  v_e public.bn_risk_control_execution%ROWTYPE;
  v_h public.bn_cross_module_handoff%ROWTYPE;
  v_ready jsonb; v_result jsonb; v_ctx jsonb; v_exp text;
  v_handoff uuid; v_attempt int := 1; v_status text; v_new_status text;
  v_event text; v_actor_name text; v_req_id uuid; v_req_status text;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED: no actor'; END IF;
  IF p_command_name NOT IN ('BN_RISK_PLACE_PAYMENT_HOLD','BN_RISK_REQUEST_ENH_VERIFICATION',
        'BN_RISK_REFER_TO_LEGAL','BN_RISK_REFER_TO_INVESTIGATION',
        'BN_RISK_OP_EXECUTE_CONTROL','BN_RISK_OP_RETRY_CONTROL_EXECUTION',
        'BN_RISK_OP_REFRESH_CONTROL_EXECUTION') THEN
    RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED: %', p_command_name;
  END IF;

  IF p_command_name = 'BN_RISK_OP_REFRESH_CONTROL_EXECUTION' THEN
    PERFORM public._bn_risk_require(p_actor_user_id,'read',false);
  ELSE
    PERFORM public._bn_risk_require(p_actor_user_id,'decide',true);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.bn_risk_command_idempotency
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.command_name <> p_command_name
         OR v_existing.payload_hash IS DISTINCT FROM COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH: key already used with a different request';
      END IF;
      RETURN jsonb_set(v_existing.result_json,'{status}','"REPLAYED"'::jsonb);
    END IF;
  END IF;

  SELECT * INTO v_a FROM public.bn_risk_assessment
   WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND: assessment'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_a.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_VERSION_CONFLICT: this assessment changed while you were working';
  END IF;

  SELECT * INTO v_r FROM public.bn_risk_recommendation
   WHERE assessment_id = p_assessment_id AND status='APPROVED'
   ORDER BY cycle_no DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E_INVALID_STATE: there is no independently approved control to execute';
  END IF;
  SELECT * INTO v_d FROM public.bn_risk_recommendation_decision
   WHERE recommendation_id = v_r.recommendation_id AND decision='APPROVE'
   ORDER BY decided_at DESC LIMIT 1;
  SELECT * INTO v_tb FROM public.bn_risk_control_target_boundary
   WHERE control_code = v_r.control_code AND is_active;
  SELECT * INTO v_prev FROM public.bn_risk_control_execution
   WHERE recommendation_id = v_r.recommendation_id ORDER BY attempt_no DESC LIMIT 1;

  v_actor_name := public._bn_risk_actor_name(p_actor_user_id);

  -- Command-time revalidation. An earlier readiness response is never trusted.
  v_ready := public.bn_risk_control_execution_readiness_v1(p_actor_user_id, p_assessment_id);
  IF v_ready->>'status' <> 'OK' THEN RAISE EXCEPTION 'E_DENIED: execution readiness unavailable'; END IF;

  IF v_tb.control_code IS NULL OR v_tb.boundary_kind = 'UNAVAILABLE' THEN
    RAISE EXCEPTION 'E_CONTROL_EXECUTION_BLOCKED: %',
      COALESCE(v_tb.missing_capability,'no governed execution boundary exists for this control');
  END IF;

  -- ---------------------------------------------------------------- REFRESH
  IF p_command_name = 'BN_RISK_OP_REFRESH_CONTROL_EXECUTION' THEN
    IF v_prev.execution_id IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_STATE: there is no execution attempt to refresh';
    END IF;
    v_status := v_prev.status;

    IF v_prev.handoff_id IS NOT NULL THEN
      SELECT * INTO v_h FROM public.bn_cross_module_handoff WHERE handoff_id = v_prev.handoff_id;
      v_new_status := public._bn_risk_exec_status_from_handoff(v_h.status);
      UPDATE public.bn_risk_control_execution SET
        status = v_new_status,
        target_status = v_h.status,
        target_business_reference = COALESCE(v_h.target_reference, target_business_reference),
        target_internal_reference = COALESCE(v_h.target_record_id, target_internal_reference),
        accepted_at  = COALESCE(v_h.accepted_at, accepted_at),
        completed_at = COALESCE(v_h.completed_at, completed_at),
        failed_at    = CASE WHEN v_new_status IN ('FAILED','REJECTED_BY_TARGET')
                            THEN COALESCE(failed_at, now()) ELSE failed_at END,
        failure_code = CASE WHEN v_new_status IN ('FAILED','REJECTED_BY_TARGET')
                            THEN COALESCE(v_h.failure_reason, v_h.closed_reason_code, failure_code)
                            ELSE failure_code END,
        failure_summary = CASE WHEN v_new_status = 'REJECTED_BY_TARGET'
                            THEN 'The owning domain rejected this control request.'
                          WHEN v_new_status = 'FAILED'
                            THEN 'The owning domain could not complete this control request.'
                          ELSE failure_summary END,
        is_retryable = (v_new_status = 'FAILED'),
        row_version = row_version + 1, updated_at = now()
       WHERE execution_id = v_prev.execution_id
       RETURNING * INTO v_e;
    ELSIF v_prev.target_module = 'bn_risk' AND v_prev.target_internal_reference IS NOT NULL THEN
      -- Reuses the Epic 1 Risk evidence-request engine; no second document engine.
      SELECT status INTO v_req_status FROM public.bn_risk_information_request
       WHERE request_id = v_prev.target_internal_reference::uuid;
      v_new_status := CASE v_req_status
        WHEN 'RESOLVED' THEN 'COMPLETED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        WHEN 'RESPONSE_RECEIVED' THEN 'PROCESSING'
        ELSE 'PENDING' END;
      UPDATE public.bn_risk_control_execution SET
        status = v_new_status, target_status = v_req_status,
        completed_at = CASE WHEN v_new_status='COMPLETED' THEN COALESCE(completed_at, now()) ELSE completed_at END,
        row_version = row_version + 1, updated_at = now()
       WHERE execution_id = v_prev.execution_id RETURNING * INTO v_e;
    ELSE
      v_e := v_prev; v_new_status := v_prev.status;
    END IF;

    IF v_new_status IS DISTINCT FROM v_status THEN
      v_event := CASE v_new_status
        WHEN 'ACCEPTED' THEN 'CONTROL_EXECUTION_ACCEPTED'
        WHEN 'PROCESSING' THEN 'CONTROL_EXECUTION_PROCESSING'
        WHEN 'COMPLETED' THEN 'CONTROL_EXECUTION_COMPLETED'
        WHEN 'FAILED' THEN 'CONTROL_EXECUTION_FAILED'
        WHEN 'REJECTED_BY_TARGET' THEN 'CONTROL_EXECUTION_REJECTED_BY_TARGET'
        WHEN 'CANCELLED' THEN 'CONTROL_EXECUTION_CANCELLED'
        ELSE 'CONTROL_EXECUTION_REFRESHED' END;
      INSERT INTO public.bn_risk_control_execution_event(
        execution_id, assessment_id, event_code, from_status, to_status, attempt_no,
        detail, actor_user_id, actor_name, actor_source, correlation_id)
      VALUES (v_e.execution_id, p_assessment_id, v_event, v_status, v_new_status, v_e.attempt_no,
        jsonb_build_object('target_status', v_e.target_status,
                           'target_reference', v_e.target_business_reference),
        p_actor_user_id, v_actor_name, 'OFFICER', p_correlation_id);

      IF v_new_status IN ('ACCEPTED','COMPLETED','FAILED','REJECTED_BY_TARGET') THEN
        PERFORM public._bn_risk_assessment_event(p_assessment_id,
          CASE WHEN v_r.control_code='REFER_TO_LEGAL' AND v_new_status='ACCEPTED'
                 THEN 'LEGAL_REFERRAL_ACCEPTED'
               WHEN v_r.control_code='REFER_TO_INVESTIGATION' AND v_new_status='ACCEPTED'
                 THEN 'INVESTIGATION_REFERRAL_ACCEPTED'
               ELSE v_event END,
          p_command_name, v_a.status, v_a.status, NULL, NULL,
          jsonb_build_object('execution_id', v_e.execution_id,
            'recommendation_id', v_r.recommendation_id, 'control_code', v_r.control_code,
            'target_module', v_e.target_module, 'attempt_no', v_e.attempt_no,
            'target_reference', v_e.target_business_reference),
          p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version);
      END IF;
    END IF;

  -- --------------------------------------------------------- EXECUTE / RETRY
  ELSE
    IF p_command_name = 'BN_RISK_OP_RETRY_CONTROL_EXECUTION' THEN
      IF COALESCE((v_ready->'data'->>'available_action'),'NONE') <> 'RETRY' THEN
        RAISE EXCEPTION 'E_INVALID_STATE: %', COALESCE(v_ready->'data'->'blockers'->>0,
          'this execution cannot be retried');
      END IF;
      v_attempt := v_prev.attempt_no + 1;
    ELSE
      v_exp := public._bn_risk_exec_command_for_control(v_r.control_code);
      IF p_command_name <> v_exp THEN
        RAISE EXCEPTION 'E_INVALID_INPUT: % cannot execute an approved % control',
          p_command_name, v_r.control_code;
      END IF;
      IF NOT COALESCE((v_ready->'data'->>'can_execute')::boolean,false) THEN
        RAISE EXCEPTION 'E_INVALID_STATE: %', COALESCE(v_ready->'data'->'blockers'->>0,
          'this approved control cannot be executed');
      END IF;
      IF v_prev.execution_id IS NOT NULL THEN
        RAISE EXCEPTION 'E_INVALID_STATE: this control already has an execution attempt';
      END IF;
    END IF;

    -- Approved parameters are carried; they are never taken from the request.
    IF jsonb_typeof(v_payload->'control_code') = 'string'
       AND v_payload->>'control_code' <> v_r.control_code THEN
      RAISE EXCEPTION 'E_PARAMETER_DRIFT: the approved control cannot be changed at execution';
    END IF;
    IF jsonb_typeof(v_payload->'target_id') = 'string'
       AND COALESCE(v_payload->>'target_id','') IS DISTINCT FROM COALESCE(v_r.target_id::text,'') THEN
      RAISE EXCEPTION 'E_PARAMETER_DRIFT: the approved target cannot be changed at execution';
    END IF;
    IF jsonb_typeof(v_payload->'requested_effective_from') = 'string'
       AND COALESCE(v_payload->>'requested_effective_from','')
           IS DISTINCT FROM COALESCE(v_r.requested_effective_from::text,'') THEN
      RAISE EXCEPTION 'E_PARAMETER_DRIFT: the approved effective period cannot be changed at execution';
    END IF;
    IF jsonb_typeof(v_payload->'scope_note') = 'string'
       AND COALESCE(v_payload->>'scope_note','') IS DISTINCT FROM COALESCE(v_r.scope_note,'') THEN
      RAISE EXCEPTION 'E_PARAMETER_DRIFT: the approved scope cannot be changed at execution';
    END IF;

    -- Minimal, purpose-bound handoff package. No Risk narrative dump.
    v_ctx := jsonb_build_object(
      'risk_assessment_reference', v_a.assessment_reference,
      'risk_recommendation_reference', v_r.recommendation_reference,
      'approved_control_code', v_r.control_code,
      'approved_reason_code', v_d.reason_code,
      'approved_reason_label', v_d.reason_label,
      'approved_by', v_r.decided_by_name,
      'approved_at', v_r.decided_at,
      'target_type', v_r.target_type,
      'target_id', v_r.target_id,
      'target_reference', v_r.target_reference,
      'effective_from', v_r.requested_effective_from,
      'effective_to', v_r.requested_effective_to,
      'scope_note', v_r.scope_note,
      'supporting_evidence_ids', to_jsonb(COALESCE(v_r.supporting_evidence_ids,'{}')),
      'decision_provenance', jsonb_build_object(
        'recommendation_id', v_r.recommendation_id,
        'decision_id', v_d.decision_id,
        'score_version_no', v_r.score_version_no,
        'rule_set_code', v_r.rule_set_code,
        'rule_set_version_no', v_r.rule_set_version_no));
    -- Referrals carry the approved summary only; unrelated signals, factor
    -- narrative, household finances and scoring configuration are excluded.
    IF v_r.control_class = 'REFERRAL' THEN
      v_ctx := v_ctx || jsonb_build_object('referral_summary', v_r.justification);
    END IF;

    IF v_tb.boundary_kind = 'RISK_INTERNAL' THEN
      IF v_r.control_code = 'NO_ACTION' THEN
        v_status := 'COMPLETED';
      ELSE
        v_req_id := NULLIF(btrim(COALESCE(v_payload->>'information_request_id','')),'')::uuid;
        IF v_req_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.bn_risk_information_request
                                            WHERE request_id = v_req_id
                                              AND assessment_id = p_assessment_id) THEN
          RAISE EXCEPTION 'E_INVALID_INPUT: a governed Risk evidence request must be provided';
        END IF;
        v_status := 'PENDING';
      END IF;
    ELSE
      -- Idempotency at the target: one live handoff per approved control.
      SELECT * INTO v_h FROM public.bn_cross_module_handoff
       WHERE source_module = 'bn_risk'
         AND source_record_id = v_r.recommendation_id
         AND handoff_type = v_tb.handoff_type
         AND status IN ('RAISED','PENDING','ACCEPTED','LINKED','COMPLETED');
      IF FOUND THEN
        SELECT * INTO v_e FROM public.bn_risk_control_execution
         WHERE handoff_id = v_h.handoff_id ORDER BY attempt_no DESC LIMIT 1;
        v_result := jsonb_build_object('status','REPLAYED','execution_id', v_e.execution_id,
          'execution_status', v_e.status, 'target_reference', v_e.target_business_reference,
          'target_status', v_h.status, 'attempt_no', v_e.attempt_no,
          'is_retryable', v_e.is_retryable, 'entity_version', v_a.row_version);
        RETURN v_result;
      END IF;

      INSERT INTO public.bn_cross_module_handoff(
        source_module, source_record_id, target_module, handoff_type,
        person_id, claim_id, award_id, reason_code, structured_context,
        status, correlation_id, created_by)
      VALUES ('bn_risk', v_r.recommendation_id, v_tb.target_module, v_tb.handoff_type,
        v_a.person_id, v_a.claim_id, v_a.award_id, COALESCE(v_d.reason_code, p_reason_code),
        v_ctx, 'RAISED', p_correlation_id, p_actor_user_id)
      RETURNING handoff_id INTO v_handoff;

      INSERT INTO public.bn_cross_module_handoff_event(
        handoff_id, from_status, to_status, command_name, actor_module, actor_user_id, reason_code)
      VALUES (v_handoff, NULL, 'RAISED', 'RAISE', 'bn_risk', p_actor_user_id,
              COALESCE(v_d.reason_code, p_reason_code));

      v_status := 'PENDING';
    END IF;

    INSERT INTO public.bn_risk_control_execution(
      execution_reference, assessment_id, recommendation_id, decision_id,
      control_code, control_label, command_name, execution_class, boundary_kind,
      target_module, target_type, target_business_reference, target_internal_reference,
      target_correlation_reference, handoff_id, target_status, status, attempt_no,
      approved_parameters, runtime_parameters, requested_by_user_id, requested_by_name,
      completed_at, is_retryable, retries_execution_id, correlation_id)
    VALUES (
      public._bn_risk_next_execution_reference(), p_assessment_id, v_r.recommendation_id,
      v_d.decision_id, v_r.control_code, v_r.control_label, p_command_name,
      v_tb.execution_class, v_tb.boundary_kind, v_tb.target_module, v_r.target_type,
      v_r.target_reference,
      CASE WHEN v_tb.boundary_kind='RISK_INTERNAL' THEN v_req_id::text ELSE NULL END,
      p_correlation_id, v_handoff,
      CASE WHEN v_handoff IS NOT NULL THEN 'RAISED' ELSE NULL END,
      v_status, v_attempt,
      jsonb_build_object('control_code', v_r.control_code, 'target_type', v_r.target_type,
        'target_id', v_r.target_id, 'target_reference', v_r.target_reference,
        'effective_from', v_r.requested_effective_from, 'effective_to', v_r.requested_effective_to,
        'scope_note', v_r.scope_note, 'reason_code', v_d.reason_code),
      jsonb_strip_nulls(jsonb_build_object('operational_note',
        NULLIF(btrim(COALESCE(v_payload->>'operational_note','')),''))),
      p_actor_user_id, v_actor_name,
      CASE WHEN v_status='COMPLETED' THEN now() ELSE NULL END,
      false,
      CASE WHEN p_command_name='BN_RISK_OP_RETRY_CONTROL_EXECUTION'
           THEN v_prev.execution_id ELSE NULL END,
      p_correlation_id)
    RETURNING * INTO v_e;

    v_event := CASE
      WHEN p_command_name='BN_RISK_OP_RETRY_CONTROL_EXECUTION' THEN 'CONTROL_EXECUTION_RETRY_REQUESTED'
      WHEN v_status='COMPLETED' THEN 'CONTROL_EXECUTION_COMPLETED'
      ELSE 'CONTROL_EXECUTION_REQUESTED' END;

    INSERT INTO public.bn_risk_control_execution_event(
      execution_id, assessment_id, event_code, from_status, to_status, attempt_no,
      detail, actor_user_id, actor_name, actor_source, correlation_id)
    VALUES (v_e.execution_id, p_assessment_id, v_event, 'NOT_STARTED', v_status, v_attempt,
      jsonb_build_object('target_module', v_tb.target_module, 'handoff_id', v_handoff,
        'control_code', v_r.control_code), p_actor_user_id, v_actor_name, 'OFFICER',
      p_correlation_id);

    PERFORM public._bn_risk_assessment_event(p_assessment_id, v_event, p_command_name,
      v_a.status, v_a.status, COALESCE(v_d.reason_code, p_reason_code), p_justification,
      jsonb_build_object('execution_id', v_e.execution_id, 'recommendation_id', v_r.recommendation_id,
        'control_code', v_r.control_code, 'target_module', v_tb.target_module,
        'attempt_no', v_attempt, 'executed_by_risk', false),
      p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version);

    IF p_command_name IN ('BN_RISK_PLACE_PAYMENT_HOLD','BN_RISK_REQUEST_ENH_VERIFICATION',
                          'BN_RISK_REFER_TO_LEGAL','BN_RISK_REFER_TO_INVESTIGATION') THEN
      PERFORM public._bn_risk_assessment_event(p_assessment_id,
        CASE p_command_name
          WHEN 'BN_RISK_PLACE_PAYMENT_HOLD' THEN 'PAYMENT_HOLD_REQUESTED'
          WHEN 'BN_RISK_REQUEST_ENH_VERIFICATION' THEN 'ENHANCED_VERIFICATION_REQUESTED'
          WHEN 'BN_RISK_REFER_TO_LEGAL' THEN 'LEGAL_REFERRAL_REQUESTED'
          ELSE 'INVESTIGATION_REFERRAL_REQUESTED' END,
        p_command_name, v_a.status, v_a.status, NULL, NULL,
        jsonb_build_object('execution_id', v_e.execution_id,
          'target_module', v_tb.target_module, 'handoff_id', v_handoff),
        p_actor_user_id, p_actor_user_code, 'OFFICER', p_correlation_id, v_a.row_version);
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'status','EXECUTED',
    'assessment_id', p_assessment_id,
    'assessment_status', v_a.status,
    'recommendation_id', v_r.recommendation_id,
    'execution_id', v_e.execution_id,
    'execution_status', v_e.status,
    'target_module', v_e.target_module,
    'target_reference', v_e.target_business_reference,
    'target_status', v_e.target_status,
    'attempt_no', v_e.attempt_no,
    'is_retryable', v_e.is_retryable,
    'business_message', public._bn_risk_exec_status_label(v_e.status),
    'entity_version', v_a.row_version);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_risk_command_idempotency(idempotency_key, command_name, payload_hash,
      assessment_id, entity_version, result_json, status, actor_user_id, completed_at)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''),
      p_assessment_id, v_a.row_version, v_result, 'COMPLETED', p_actor_user_id, now());
  END IF;

  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.bn_risk_control_execution_command_v1(
  text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bn_risk_control_execution_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_risk_control_execution_queue_v1(uuid,jsonb,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_risk_outcome_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_risk_control_execution_command_v1(
  text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;