-- ============================================================
-- BN Uprating Epic 4 — Reconciliation, rollback and operational
-- completion. Post-execution schedule consequences, Communication
-- Hub issuance, authoritative reconciliation and controlled
-- compensating rollback. Epic 4 never closes a run.
-- ============================================================

-- ---------- Run lifecycle extension (Epic 4 states) ----------
ALTER TABLE public.bn_uprating_run DROP CONSTRAINT IF EXISTS bn_uprating_run_status_ck;
ALTER TABLE public.bn_uprating_run ADD CONSTRAINT bn_uprating_run_status_ck
  CHECK (status = ANY (ARRAY['DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED',
    'DRY_RUN','AWAITING_APPROVAL','APPROVED','EXECUTING','COMPLETED','PARTIAL','FAILED',
    'SCHEDULES_REBUILT','COMMUNICATIONS_ISSUED','RECONCILED','ROLLED_BACK']));

ALTER TABLE public.bn_uprating_run
  ADD COLUMN IF NOT EXISTS execution_finalised_at   timestamptz,
  ADD COLUMN IF NOT EXISTS schedules_rebuilt_at     timestamptz,
  ADD COLUMN IF NOT EXISTS communications_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_at            timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at                timestamptz,
  ADD COLUMN IF NOT EXISTS rolled_back_at           timestamptz,
  ADD COLUMN IF NOT EXISTS current_reconciliation_id uuid,
  ADD COLUMN IF NOT EXISTS current_rollback_id       uuid;

-- ---------- Reference data ----------
INSERT INTO public.bn_uprating_reference_value(domain, code, label, description, sort_order) VALUES
 ('RUN_STATUS','SCHEDULES_REBUILT','Schedules rebuilt','Downstream payment schedule consequences were rebuilt by the owning domain.',120),
 ('RUN_STATUS','COMMUNICATIONS_ISSUED','Communications issued','Claimant communication intents were accepted by the Communication Hub.',130),
 ('RUN_STATUS','RECONCILED','Reconciled','Approved, executed, scheduled and communicated facts reconcile.',140),
 ('RUN_STATUS','ROLLED_BACK','Rolled back','Eligible award changes were reversed by a governed compensating rollback.',150),

 ('SCHEDULE_REBUILD_STATUS','PENDING','Pending','Rebuild requested from the schedule owner; not yet processed.',10),
 ('SCHEDULE_REBUILD_STATUS','COMPLETED','Completed','The schedule owner rebuilt the affected schedule consequences.',20),
 ('SCHEDULE_REBUILD_STATUS','FAILED','Failed','The schedule owner could not rebuild the affected consequences.',30),
 ('SCHEDULE_REBUILD_STATUS','NOT_REQUIRED','Not required','No schedule consequence was required for this item.',40),

 ('SCHEDULE_REBUILD_FAILURE_CODE','AWARD_NOT_FOUND','Award not found','The award could not be read by the schedule owner.',10),
 ('SCHEDULE_REBUILD_FAILURE_CODE','BUSINESS_INVALID_SCHEDULE_STATE','Schedule state not valid','The downstream schedule is in a state that cannot be rebuilt automatically.',20),
 ('SCHEDULE_REBUILD_FAILURE_CODE','TRANSIENT_ERROR','Temporary problem','A temporary problem prevented the schedule rebuild.',30),

 ('COMMUNICATION_INTENT_STATUS','PENDING','Pending','Intent recorded; not yet submitted to the Communication Hub.',10),
 ('COMMUNICATION_INTENT_STATUS','REQUESTED','Requested','Submitted to the Communication Hub and accepted as a request.',20),
 ('COMMUNICATION_INTENT_STATUS','FAILED','Failed','The Communication Hub did not accept the request.',30),

 ('COMMUNICATION_FAILURE_CODE','E_NO_APPROVED_CONTACT','No approved contact','No approved contact point is held for this claimant.',10),
 ('COMMUNICATION_FAILURE_CODE','E_HUB_UNAVAILABLE','Hub unavailable','The Communication Hub could not be reached.',20),

 ('RECONCILIATION_STATUS','PASS','Pass','Approved, executed, scheduled and communicated facts agree.',10),
 ('RECONCILIATION_STATUS','PASS_WITH_WARNINGS','Pass with warnings','Reconciled with non-blocking observations.',20),
 ('RECONCILIATION_STATUS','BLOCKED','Blocked','Material differences prevent reconciliation.',30),

 ('RECONCILIATION_FINDING','EXECUTION_COUNT_MISMATCH','Execution count mismatch','The number of applied award changes does not match the approved package.',10),
 ('RECONCILIATION_FINDING','EXECUTION_AMOUNT_MISMATCH','Execution amount mismatch','The applied award total does not match the approved simulated total.',20),
 ('RECONCILIATION_FINDING','MISSING_SCHEDULE_REBUILD','Missing schedule consequence','An applied award has no completed schedule rebuild.',30),
 ('RECONCILIATION_FINDING','DUPLICATE_SCHEDULE_REBUILD','Duplicate schedule consequence','More than one completed schedule rebuild exists for an award change.',40),
 ('RECONCILIATION_FINDING','FAILED_SCHEDULE_REBUILD','Failed schedule consequence','A required schedule rebuild failed.',50),
 ('RECONCILIATION_FINDING','UNEXPECTED_SCHEDULE_REBUILD','Unexpected schedule consequence','A schedule rebuild exists for an award change that was not applied.',60),
 ('RECONCILIATION_FINDING','MISSING_COMMUNICATION_INTENT','Missing communication intent','A communication-required award change has no Hub issuance record.',70),
 ('RECONCILIATION_FINDING','DUPLICATE_COMMUNICATION_INTENT','Duplicate communication intent','More than one Hub issuance record exists for an award change.',80),
 ('RECONCILIATION_FINDING','UNEXPECTED_COMMUNICATION_INTENT','Unexpected communication intent','A Hub issuance record exists for an award change that was not applied.',90),
 ('RECONCILIATION_FINDING','FAILED_COMMUNICATION_INTENT','Failed communication intent','A required communication intent was not accepted by the Hub.',100),
 ('RECONCILIATION_FINDING','OUTSTANDING_EXECUTION_WORK','Outstanding execution work','Execution is not complete.',110),
 ('RECONCILIATION_FINDING','SOURCE_UNAVAILABLE','Source unavailable','An authoritative source could not be read; reconciliation failed closed.',120),

 ('ROLLBACK_ELIGIBILITY','ELIGIBLE','Eligible','This award change can be reversed by a compensating adjustment.',10),
 ('ROLLBACK_ELIGIBILITY','INELIGIBLE','Not eligible','This award change cannot be reversed automatically.',20),

 ('ROLLBACK_BLOCKER','PAYMENT_ALREADY_ISSUED','Payment already issued','Payment has already been issued for an affected period; financial correction is owned elsewhere.',10),
 ('ROLLBACK_BLOCKER','LATER_AWARD_AMENDMENT','Later award amendment','The award changed after the uprating was applied.',20),
 ('ROLLBACK_BLOCKER','AWARD_STATE_MISMATCH','Award state does not match','The award no longer matches its expected post-uprating state.',30),
 ('ROLLBACK_BLOCKER','ORIGINAL_ADJUSTMENT_UNIDENTIFIABLE','Original adjustment not identifiable','The original uprating adjustment cannot be identified.',40),
 ('ROLLBACK_BLOCKER','PRIOR_AMOUNT_UNKNOWN','Prior amount unknown','The amount held before the uprating is not known.',50),
 ('ROLLBACK_BLOCKER','AWARD_NOT_FOUND','Award not found','The award could not be read.',60),
 ('ROLLBACK_BLOCKER','DOWNSTREAM_STATE_UNAVAILABLE','Downstream state unavailable','Downstream payment state could not be read; the item fails closed.',70),

 ('ROLLBACK_STATUS','ASSESSED','Assessed','Eligibility has been assessed; no compensation applied yet.',10),
 ('ROLLBACK_STATUS','COMPLETED','Completed','Every eligible award change was compensated.',20),
 ('ROLLBACK_STATUS','PARTIAL','Partial','Some award changes could not be compensated.',30),
 ('ROLLBACK_STATUS','BLOCKED','Blocked','No award change could be compensated.',40),

 ('EPIC4_CONFIG','RECONCILIATION_TOLERANCE_MINOR','0','Permitted unexplained reconciliation variance in minor units. Governed configuration; zero means exact.',10),
 ('EPIC4_CONFIG','COMMUNICATION_EVENT_CODE','BN_UPRATING_AWARD_UPRATED','Approved communication event code used for uprating claimant notices.',20),
 ('EPIC4_CONFIG','COMMUNICATION_ISSUED_CRITERION','REQUESTED','Authoritative Communication Hub criterion for "issued". Acceptance of the request, not delivery.',30),
 ('EPIC4_CONFIG','ROLLBACK_EVENT_CODE','BN_UPRATING_AWARD_UPRATING_REVERSED','Approved communication event code used for corrective notices after a rollback.',40),
 ('EPIC4_CONFIG','ROLLBACK_REQUIRES_FULL_ELIGIBILITY','TRUE','ROLLED_BACK requires every applied award change to be compensated.',50)
ON CONFLICT (domain, code) DO NOTHING;

-- ---------- Epic 4 transition guard ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_epic4_can_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE p_from
    WHEN 'EXECUTING'            THEN p_to IN ('COMPLETED','PARTIAL','FAILED','SCHEDULES_REBUILT')
    WHEN 'COMPLETED'            THEN p_to IN ('SCHEDULES_REBUILT','FAILED')
    WHEN 'PARTIAL'              THEN p_to IN ('EXECUTING','FAILED')
    WHEN 'FAILED'               THEN p_to IN ('ROLLED_BACK')
    WHEN 'SCHEDULES_REBUILT'    THEN p_to IN ('COMMUNICATIONS_ISSUED')
    WHEN 'COMMUNICATIONS_ISSUED' THEN p_to IN ('RECONCILED')
    WHEN 'RECONCILED'           THEN false
    WHEN 'ROLLED_BACK'          THEN false
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public._bn_uprating_epic4_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(jsonb_object_agg(code, label), '{}'::jsonb)
    FROM public.bn_uprating_reference_value
   WHERE domain = 'EPIC4_CONFIG' AND is_active;
$function$;

-- ---------- Schedule rebuild ledger ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_schedule_rebuild (
  rebuild_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  session_id          uuid NOT NULL REFERENCES public.bn_uprating_execution_session(session_id) ON DELETE CASCADE,
  package_id          uuid,
  execution_item_id   uuid NOT NULL REFERENCES public.bn_uprating_execution_item(execution_item_id) ON DELETE CASCADE,
  award_id            uuid,
  award_reference     text NOT NULL,
  effective_date      date NOT NULL,
  award_rate_history_id uuid,
  applied_amount_minor  bigint NOT NULL,
  request_key         text NOT NULL,
  schedule_owner      text NOT NULL DEFAULT 'BN_PAYMENT_SCHEDULE',
  status              text NOT NULL DEFAULT 'PENDING'
    CHECK (status = ANY (ARRAY['PENDING','COMPLETED','FAILED','NOT_REQUIRED'])),
  attempt_no          integer NOT NULL DEFAULT 1,
  schedule_rows_rebuilt integer NOT NULL DEFAULT 0,
  schedule_reference  text,
  failure_code        text,
  failure_reason      text,
  is_retryable        boolean NOT NULL DEFAULT false,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  correlation_id      uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_schedule_rebuild_item_uk
  ON public.bn_uprating_schedule_rebuild(execution_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_schedule_rebuild_key_uk
  ON public.bn_uprating_schedule_rebuild(request_key);
CREATE INDEX IF NOT EXISTS bn_uprating_schedule_rebuild_run_idx
  ON public.bn_uprating_schedule_rebuild(run_id, status);
GRANT ALL ON public.bn_uprating_schedule_rebuild TO service_role;
REVOKE ALL ON public.bn_uprating_schedule_rebuild FROM anon, authenticated;
ALTER TABLE public.bn_uprating_schedule_rebuild ENABLE ROW LEVEL SECURITY;

-- ---------- Communication intent ledger (Hub-facing, no message bodies) ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_communication_intent (
  intent_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  session_id          uuid NOT NULL REFERENCES public.bn_uprating_execution_session(session_id) ON DELETE CASCADE,
  execution_item_id   uuid NOT NULL REFERENCES public.bn_uprating_execution_item(execution_item_id) ON DELETE CASCADE,
  award_id            uuid,
  award_reference     text NOT NULL,
  intent_kind         text NOT NULL DEFAULT 'UPRATING_APPLIED'
    CHECK (intent_kind = ANY (ARRAY['UPRATING_APPLIED','UPRATING_REVERSED'])),
  event_code          text NOT NULL,
  template_mapping_code text,
  dispatch_key        text NOT NULL,
  context             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'PENDING'
    CHECK (status = ANY (ARRAY['PENDING','REQUESTED','FAILED'])),
  hub_status          text,
  hub_delivery_status text,
  communication_request_id uuid,
  attempts            integer NOT NULL DEFAULT 0,
  requested_at        timestamptz,
  accepted_at         timestamptz,
  failure_code        text,
  failure_reason      text,
  is_retryable        boolean NOT NULL DEFAULT false,
  correlation_id      uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_comm_intent_item_uk
  ON public.bn_uprating_communication_intent(execution_item_id, intent_kind);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_comm_intent_key_uk
  ON public.bn_uprating_communication_intent(dispatch_key);
CREATE INDEX IF NOT EXISTS bn_uprating_comm_intent_run_idx
  ON public.bn_uprating_communication_intent(run_id, status);
GRANT ALL ON public.bn_uprating_communication_intent TO service_role;
REVOKE ALL ON public.bn_uprating_communication_intent FROM anon, authenticated;
ALTER TABLE public.bn_uprating_communication_intent ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bn_communication_adapter_source (source_module, source_table, is_enabled, notes)
VALUES ('BN_UPRATING','bn_uprating_communication_intent', true,
        'Uprating claimant notices. Issuance is requested through the Communication Hub request spine only.')
ON CONFLICT (source_module) DO UPDATE
  SET source_table = EXCLUDED.source_table, updated_at = now();

-- ---------- Reconciliation (immutable, versioned) ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_reconciliation (
  reconciliation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  reconciliation_no   integer NOT NULL,
  package_id          uuid,
  session_id          uuid,
  status              text NOT NULL
    CHECK (status = ANY (ARRAY['PASS','PASS_WITH_WARNINGS','BLOCKED'])),
  is_current          boolean NOT NULL DEFAULT true,
  expected_item_count integer NOT NULL DEFAULT 0,
  actual_executed_item_count integer NOT NULL DEFAULT 0,
  actual_applied_item_count  integer NOT NULL DEFAULT 0,
  actual_failed_item_count   integer NOT NULL DEFAULT 0,
  expected_current_total_minor  bigint NOT NULL DEFAULT 0,
  expected_proposed_total_minor bigint NOT NULL DEFAULT 0,
  expected_delta_total_minor    bigint NOT NULL DEFAULT 0,
  actual_prior_total_minor      bigint NOT NULL DEFAULT 0,
  actual_new_total_minor        bigint NOT NULL DEFAULT 0,
  actual_delta_total_minor      bigint NOT NULL DEFAULT 0,
  variance_amount_minor         bigint NOT NULL DEFAULT 0,
  variance_count                integer NOT NULL DEFAULT 0,
  tolerance_amount_minor        bigint NOT NULL DEFAULT 0,
  schedule_required_count  integer NOT NULL DEFAULT 0,
  schedule_completed_count integer NOT NULL DEFAULT 0,
  schedule_failed_count    integer NOT NULL DEFAULT 0,
  schedule_pending_count   integer NOT NULL DEFAULT 0,
  communication_required_count  integer NOT NULL DEFAULT 0,
  communication_requested_count integer NOT NULL DEFAULT 0,
  communication_failed_count    integer NOT NULL DEFAULT 0,
  communication_pending_count   integer NOT NULL DEFAULT 0,
  communication_delivered_count integer NOT NULL DEFAULT 0,
  finance_confirmation_available boolean NOT NULL DEFAULT false,
  finding_count       integer NOT NULL DEFAULT 0,
  blocking_finding_count integer NOT NULL DEFAULT 0,
  performed_by        uuid NOT NULL,
  performed_by_name   text,
  performed_at        timestamptz NOT NULL DEFAULT now(),
  correlation_id      uuid,
  idempotency_key     uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, reconciliation_no)
);
CREATE INDEX IF NOT EXISTS bn_uprating_reconciliation_run_idx
  ON public.bn_uprating_reconciliation(run_id, reconciliation_no DESC);
GRANT ALL ON public.bn_uprating_reconciliation TO service_role;
REVOKE ALL ON public.bn_uprating_reconciliation FROM anon, authenticated;
ALTER TABLE public.bn_uprating_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_reconciliation_finding (
  finding_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.bn_uprating_reconciliation(reconciliation_id) ON DELETE CASCADE,
  run_id            uuid NOT NULL,
  finding_code      text NOT NULL,
  severity          text NOT NULL DEFAULT 'BLOCKING'
    CHECK (severity = ANY (ARRAY['BLOCKING','WARNING','INFORMATION'])),
  subject_type      text,
  subject_reference text,
  expected_value    text,
  actual_value      text,
  detail            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bn_uprating_reconciliation_finding_idx
  ON public.bn_uprating_reconciliation_finding(reconciliation_id);
GRANT ALL ON public.bn_uprating_reconciliation_finding TO service_role;
REVOKE ALL ON public.bn_uprating_reconciliation_finding FROM anon, authenticated;
ALTER TABLE public.bn_uprating_reconciliation_finding ENABLE ROW LEVEL SECURITY;

-- ---------- Rollback ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_rollback_operation (
  rollback_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  session_id        uuid NOT NULL,
  rollback_no       integer NOT NULL,
  status            text NOT NULL DEFAULT 'ASSESSED'
    CHECK (status = ANY (ARRAY['ASSESSED','COMPLETED','PARTIAL','BLOCKED'])),
  applied_item_count    integer NOT NULL DEFAULT 0,
  eligible_count        integer NOT NULL DEFAULT 0,
  ineligible_count      integer NOT NULL DEFAULT 0,
  compensated_count     integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  compensated_delta_minor bigint NOT NULL DEFAULT 0,
  reason_code       text,
  justification     text,
  assessed_by       uuid NOT NULL,
  assessed_by_name  text,
  assessed_at       timestamptz NOT NULL DEFAULT now(),
  authorised_by     uuid,
  authorised_by_name text,
  authorised_at     timestamptz,
  completed_at      timestamptz,
  row_version       integer NOT NULL DEFAULT 1,
  correlation_id    uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, rollback_no)
);
GRANT ALL ON public.bn_uprating_rollback_operation TO service_role;
REVOKE ALL ON public.bn_uprating_rollback_operation FROM anon, authenticated;
ALTER TABLE public.bn_uprating_rollback_operation ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_rollback_item (
  rollback_item_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rollback_id       uuid NOT NULL REFERENCES public.bn_uprating_rollback_operation(rollback_id) ON DELETE CASCADE,
  run_id            uuid NOT NULL,
  execution_item_id uuid NOT NULL REFERENCES public.bn_uprating_execution_item(execution_item_id) ON DELETE CASCADE,
  award_id          uuid,
  award_reference   text NOT NULL,
  applied_amount_minor  bigint NOT NULL,
  restore_amount_minor  bigint NOT NULL,
  expected_row_version  integer,
  observed_row_version  integer,
  eligibility_status text NOT NULL DEFAULT 'ELIGIBLE'
    CHECK (eligibility_status = ANY (ARRAY['ELIGIBLE','INELIGIBLE'])),
  blocker_code      text,
  blocker_reason    text,
  status            text NOT NULL DEFAULT 'PENDING'
    CHECK (status = ANY (ARRAY['PENDING','APPLIED','FAILED','SKIPPED','BLOCKED'])),
  attempt_no        integer NOT NULL DEFAULT 0,
  request_key       text NOT NULL,
  compensating_rate_history_id uuid,
  failure_code      text,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  correlation_id    uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_rollback_item_uk
  ON public.bn_uprating_rollback_item(rollback_id, execution_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_rollback_item_applied_uk
  ON public.bn_uprating_rollback_item(run_id, execution_item_id)
  WHERE status = 'APPLIED';
CREATE INDEX IF NOT EXISTS bn_uprating_rollback_item_op_idx
  ON public.bn_uprating_rollback_item(rollback_id, status);
GRANT ALL ON public.bn_uprating_rollback_item TO service_role;
REVOKE ALL ON public.bn_uprating_rollback_item FROM anon, authenticated;
ALTER TABLE public.bn_uprating_rollback_item ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Owning-domain boundary: payment schedule rebuild.
-- Owned by the Award/Payment scheduling domain. Uprating never
-- writes bn_payment_schedule directly and never issues payment.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bn_payment_schedule_rebuild_for_award_v1(
  p_award_id uuid,
  p_effective_date date,
  p_source_module text,
  p_source_reference text,
  p_request_key text,
  p_actor_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  aw public.bn_award%ROWTYPE;
  v_rebuilt int := 0;
BEGIN
  IF p_award_id IS NULL OR p_effective_date IS NULL THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','BUSINESS_INVALID_SCHEDULE_STATE',
      'failure_reason','A schedule rebuild needs an award and an effective date.','is_retryable',false,
      'rows_rebuilt',0);
  END IF;

  SELECT * INTO aw FROM public.bn_award WHERE id = p_award_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','AWARD_NOT_FOUND',
      'failure_reason','The award could not be found by the schedule owner.','is_retryable',false,
      'rows_rebuilt',0);
  END IF;

  UPDATE public.bn_payment_schedule s
     SET gross_amount = aw.base_amount,
         net_amount   = GREATEST(aw.base_amount - COALESCE(s.deductions,0), 0),
         notes        = left(COALESCE('Rebuilt after '||p_source_module||' '||COALESCE(p_source_reference,''),''),400),
         modified_by  = left(COALESCE(p_actor_user_id::text,''),50),
         modified_at  = now()
   WHERE s.bn_award_id = aw.id
     AND s.schedule_period >= p_effective_date
     AND s.paid_at IS NULL
     AND upper(COALESCE(s.status,'PENDING')) IN ('PENDING','SCHEDULED','PLANNED','DUE');
  GET DIAGNOSTICS v_rebuilt = ROW_COUNT;

  RETURN jsonb_build_object('status','COMPLETED','failure_code',NULL,'failure_reason',NULL,
    'is_retryable',false,'rows_rebuilt', v_rebuilt,
    'schedule_reference', p_request_key,
    'effective_date', p_effective_date,
    'award_amount', aw.base_amount);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','FAILED','failure_code','TRANSIENT_ERROR',
    'failure_reason','A temporary problem prevented the schedule rebuild.','is_retryable',true,
    'rows_rebuilt',0);
END; $function$;
REVOKE ALL ON FUNCTION public.bn_payment_schedule_rebuild_for_award_v1(uuid,date,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_payment_schedule_rebuild_for_award_v1(uuid,date,text,text,text,uuid)
  TO service_role;

-- ============================================================
-- Owning-domain boundary: award compensation after a rollback.
-- Creates NEW history. Never deletes the uprating rate record.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bn_award_apply_uprating_compensation_v1(
  p_award_id uuid,
  p_expected_row_version integer,
  p_expected_amount_minor bigint,
  p_restore_amount_minor bigint,
  p_effective_date date,
  p_reference text,
  p_request_key text,
  p_actor_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  aw public.bn_award%ROWTYPE;
  v_rate_id uuid;
  v_restore numeric(18,2);
BEGIN
  SELECT id INTO v_rate_id FROM public.bn_award_rate_history
   WHERE bn_award_id = p_award_id AND reference_doc = p_request_key
     AND change_reason = 'UPRATING_ROLLBACK' LIMIT 1;
  IF v_rate_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','REPLAYED','award_rate_history_id', v_rate_id,
      'failure_code',NULL,'failure_reason',NULL);
  END IF;

  SELECT * INTO aw FROM public.bn_award WHERE id = p_award_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','AWARD_NOT_FOUND',
      'failure_reason','The award could not be found.');
  END IF;

  IF p_expected_row_version IS NOT NULL AND aw.row_version IS DISTINCT FROM p_expected_row_version THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','LATER_AWARD_AMENDMENT',
      'failure_reason','The award changed after the uprating was applied, so it was not overwritten.',
      'observed_row_version', aw.row_version);
  END IF;

  IF round(COALESCE(aw.base_amount,0) * 100)::bigint IS DISTINCT FROM p_expected_amount_minor THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','AWARD_STATE_MISMATCH',
      'failure_reason','The award no longer matches its expected post-uprating amount.',
      'observed_row_version', aw.row_version);
  END IF;

  v_restore := (p_restore_amount_minor::numeric / 100);

  UPDATE public.bn_award_rate_history
     SET effective_to = p_effective_date - 1, modified_at = now(),
         modified_by = left(COALESCE(p_actor_user_id::text,''),50)
   WHERE bn_award_id = aw.id AND effective_to IS NULL AND effective_from <= p_effective_date;

  INSERT INTO public.bn_award_rate_history(bn_award_id, effective_from, rate_amount, currency,
    change_reason, reference_doc, entered_by)
  VALUES (aw.id, p_effective_date, v_restore, COALESCE(aw.currency,'XCD'),
    'UPRATING_ROLLBACK', p_request_key, left(COALESCE(p_actor_user_id::text,''),50))
  RETURNING id INTO v_rate_id;

  UPDATE public.bn_award
     SET base_amount = v_restore,
         row_version = COALESCE(row_version,1) + 1,
         modified_by = left(COALESCE(p_actor_user_id::text,''),50),
         modified_at = now()
   WHERE id = aw.id RETURNING * INTO aw;

  RETURN jsonb_build_object('status','APPLIED','award_rate_history_id', v_rate_id,
    'applied_row_version', aw.row_version,'failure_code',NULL,'failure_reason',NULL);
END; $function$;
REVOKE ALL ON FUNCTION public.bn_award_apply_uprating_compensation_v1(uuid,integer,bigint,bigint,date,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_award_apply_uprating_compensation_v1(uuid,integer,bigint,bigint,date,text,text,uuid)
  TO service_role;

-- ============================================================
-- Communication Hub boundary: request an uprating intent.
-- Writes only the Hub request spine; never bn_communication_log,
-- bn_letter, notification_templates or template versions.
-- ============================================================
CREATE OR REPLACE FUNCTION public._bn_uprating_request_communication(p_intent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_intent public.bn_uprating_communication_intent%ROWTYPE;
  v_src public.bn_communication_adapter_source%ROWTYPE;
  v_claim uuid; v_email text; v_phone text; v_name text;
  v_channels text[]; v_req_id uuid;
BEGIN
  SELECT * INTO v_intent FROM public.bn_uprating_communication_intent
   WHERE intent_id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','E_INTENT_NOT_FOUND',
      'failure_reason','The communication intent could not be read.','is_retryable',false);
  END IF;

  IF v_intent.status = 'REQUESTED' AND v_intent.communication_request_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','REPLAYED','communication_request_id', v_intent.communication_request_id,
      'hub_status','REQUESTED');
  END IF;

  SELECT * INTO v_src FROM public.bn_communication_adapter_source
   WHERE source_module = 'BN_UPRATING' AND is_enabled;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','E_HUB_UNAVAILABLE',
      'failure_reason','The Communication Hub source registration is not enabled.','is_retryable',true);
  END IF;

  SELECT a.bn_claim_id INTO v_claim FROM public.bn_award a WHERE a.id = v_intent.award_id;
  SELECT c.contact_email, c.contact_phone INTO v_email, v_phone
    FROM public.bn_claim c WHERE c.id = v_claim;
  IF v_email IS NULL AND v_phone IS NULL THEN
    SELECT p.email, p.phone, p.display_name INTO v_email, v_phone, v_name
      FROM public.bn_claim_participant p
     WHERE p.claim_id = v_claim AND COALESCE(p.is_primary_applicant,false)
     ORDER BY p.created_at LIMIT 1;
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','E_NO_APPROVED_CONTACT',
      'failure_reason','No approved contact point is held for this claimant.','is_retryable',false);
  END IF;
  v_channels := CASE WHEN v_email IS NOT NULL THEN ARRAY['email'] ELSE ARRAY['sms'] END;

  INSERT INTO public.communication_request
    (request_no, module_code, department_code, event_code, entity_type, entity_id,
     reference_no, channels, priority, status, payload, context, idempotency_key,
     business_event_id, business_event_type)
  VALUES ('BNUPR-'||to_char(now(),'YYYYMMDDHH24MISS')||'-'||substr(md5(v_intent.dispatch_key),1,8),
          'BENEFITS','BENEFITS', v_intent.event_code,
          'BN_UPRATING', v_intent.award_id::text,
          COALESCE(v_intent.correlation_id::text, v_intent.dispatch_key),
          v_channels, 'normal', 'pending',
          jsonb_build_object('event_code', v_intent.event_code,
                             'source_module','BN_UPRATING',
                             'source_entity_id', v_intent.award_id,
                             'context', COALESCE(v_intent.context,'{}'::jsonb)),
          jsonb_build_object('source_module','BN_UPRATING',
                             'source_table', v_src.source_table,
                             'source_intent_id', v_intent.intent_id,
                             'template_mapping_code', v_intent.template_mapping_code,
                             'correlation_id', v_intent.correlation_id),
          v_intent.dispatch_key, v_intent.correlation_id, v_intent.event_code)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_req_id;

  IF v_req_id IS NULL THEN
    SELECT id INTO v_req_id FROM public.communication_request
     WHERE idempotency_key = v_intent.dispatch_key;
  ELSE
    INSERT INTO public.communication_recipient (request_id, role, recipient_type, name, email, phone)
    VALUES (v_req_id, 'to', 'CLAIMANT', v_name, v_email, v_phone);
  END IF;

  IF v_req_id IS NULL THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','E_HUB_UNAVAILABLE',
      'failure_reason','The Communication Hub did not accept the request.','is_retryable',true);
  END IF;

  INSERT INTO public.bn_communication_dispatch
    (source_module, source_table, source_intent_id, source_entity_id, event_code,
     correlation_id, dispatch_key, communication_request_id, status, attempts)
  VALUES ('BN_UPRATING', v_src.source_table, v_intent.intent_id, v_intent.award_id,
          v_intent.event_code, v_intent.correlation_id, v_intent.dispatch_key, v_req_id, 'REQUESTED', 1)
  ON CONFLICT (source_module, source_intent_id) DO UPDATE
    SET communication_request_id = COALESCE(public.bn_communication_dispatch.communication_request_id, EXCLUDED.communication_request_id),
        attempts = public.bn_communication_dispatch.attempts + 1,
        status = 'REQUESTED', last_error_code = NULL, updated_at = now();

  RETURN jsonb_build_object('status','REQUESTED','communication_request_id', v_req_id,
    'hub_status','REQUESTED','failure_code',NULL,'failure_reason',NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','FAILED','failure_code','E_HUB_UNAVAILABLE',
    'failure_reason','The Communication Hub could not be reached.','is_retryable',true);
END; $function$;

-- ============================================================
-- Authoritative execution completion + post-execution readiness
-- ============================================================
CREATE OR REPLACE FUNCTION public._bn_uprating_execution_completion(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  es public.bn_uprating_execution_session%ROWTYPE;
  p public.bn_uprating_run_approval_package%ROWTYPE;
  r public.bn_uprating_run%ROWTYPE;
  v_planned int := 0; v_applied int := 0; v_pending int := 0;
  v_retryable int := 0; v_final int := 0; v_active int := 0;
BEGIN
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  SELECT * INTO es FROM public.bn_uprating_execution_session WHERE run_id = p_run_id;
  SELECT * INTO p FROM public.bn_uprating_run_approval_package WHERE package_id = r.current_approval_package_id;

  IF es.session_id IS NULL THEN
    RETURN jsonb_build_object('has_session', false,'execution_complete', false,
      'approved_executable_count', COALESCE(p.included_count,0),
      'applied_count',0,'pending_count',0,'retryable_failure_count',0,
      'final_failure_count',0,'active_batch_count',0,
      'source_available', false);
  END IF;

  SELECT count(*) INTO v_active FROM public.bn_uprating_execution_batch
   WHERE session_id = es.session_id AND status = 'PENDING';

  WITH latest AS (
    SELECT DISTINCT ON (simulation_item_id) *
      FROM public.bn_uprating_execution_item
     WHERE session_id = es.session_id
     ORDER BY simulation_item_id, (status='APPLIED') DESC, attempt_no DESC, created_at DESC
  )
  SELECT count(*),
         count(*) FILTER (WHERE status='APPLIED'),
         count(*) FILTER (WHERE status='PENDING'),
         count(*) FILTER (WHERE status='FAILED' AND is_retryable),
         count(*) FILTER (WHERE status='FAILED' AND NOT is_retryable)
    INTO v_planned, v_applied, v_pending, v_retryable, v_final
    FROM latest;

  RETURN jsonb_build_object(
    'has_session', true,
    'session_id', es.session_id,
    'session_status', es.status,
    'package_id', es.package_id,
    'approved_executable_count', v_planned,
    'applied_count', v_applied,
    'pending_count', v_pending,
    'retryable_failure_count', v_retryable,
    'final_failure_count', v_final,
    'active_batch_count', v_active,
    'applied_delta_total_minor', COALESCE(es.applied_delta_total_minor,0),
    'approved_delta_total_minor', COALESCE(es.approved_delta_total_minor,0),
    'execution_complete', v_active = 0 AND v_pending = 0 AND v_retryable = 0,
    'execution_successful', v_active = 0 AND v_pending = 0 AND v_retryable = 0 AND v_final = 0
                            AND v_planned > 0 AND v_applied = v_planned,
    'execution_failed', v_active = 0 AND v_pending = 0 AND v_retryable = 0 AND v_final > 0,
    'source_available', true);
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_uprating_post_execution_readiness(p_run_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r public.bn_uprating_run%ROWTYPE;
  v_comp jsonb; v_decide boolean; v_admin boolean;
  v_blockers jsonb := '[]'::jsonb;
  v_sched_required int := 0; v_sched_done int := 0; v_sched_failed int := 0; v_sched_pending int := 0;
  v_comm_required int := 0; v_comm_req int := 0; v_comm_failed int := 0; v_comm_pending int := 0;
  v_comm_delivered int := 0;
BEGIN
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('run_id', p_run_id,'source_available', false,
      'can_finalise_execution', false,'can_rebuild_schedules', false,
      'can_issue_communications', false,'blockers',
      jsonb_build_array(jsonb_build_object('code','E_NOT_FOUND','message','That uprating run could not be found.')));
  END IF;

  v_decide := COALESCE((public.bn_uprating_check_actor_permission(p_actor,'decide',true)->>'ok')::boolean,false);
  v_admin  := COALESCE((public.bn_uprating_check_actor_permission(p_actor,'admin',true)->>'ok')::boolean,false);
  v_comp := public._bn_uprating_execution_completion(p_run_id);

  SELECT count(*) FILTER (WHERE true),
         count(*) FILTER (WHERE status='COMPLETED'),
         count(*) FILTER (WHERE status='FAILED'),
         count(*) FILTER (WHERE status='PENDING')
    INTO v_sched_required, v_sched_done, v_sched_failed, v_sched_pending
    FROM public.bn_uprating_schedule_rebuild WHERE run_id = p_run_id;

  SELECT count(*) FILTER (WHERE true),
         count(*) FILTER (WHERE status='REQUESTED'),
         count(*) FILTER (WHERE status='FAILED'),
         count(*) FILTER (WHERE status='PENDING'),
         count(*) FILTER (WHERE COALESCE(hub_delivery_status,'') = 'DELIVERED')
    INTO v_comm_required, v_comm_req, v_comm_failed, v_comm_pending, v_comm_delivered
    FROM public.bn_uprating_communication_intent WHERE run_id = p_run_id;

  IF NOT COALESCE((v_comp->>'source_available')::boolean,false) THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_NO_SESSION',
      'message','This run has not been executed, so there is nothing to complete.');
  ELSIF NOT COALESCE((v_comp->>'execution_complete')::boolean,false) THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_EXECUTION_INCOMPLETE',
      'message','Finish executing and retrying the outstanding items before post-execution processing.');
  END IF;

  RETURN jsonb_build_object(
    'run_id', r.run_id,
    'run_reference', r.run_reference,
    'status', r.status,
    'row_version', r.row_version,
    'source_available', true,
    'completion', v_comp,
    'blockers', v_blockers,
    'can_finalise_execution', v_decide AND jsonb_array_length(v_blockers) = 0
        AND r.status IN ('EXECUTING','COMPLETED','PARTIAL'),
    'can_rebuild_schedules', v_decide AND jsonb_array_length(v_blockers) = 0
        AND COALESCE((v_comp->>'execution_successful')::boolean,false)
        AND r.status IN ('EXECUTING','COMPLETED'),
    'can_retry_schedule_rebuild', v_decide AND v_sched_failed > 0
        AND EXISTS (SELECT 1 FROM public.bn_uprating_schedule_rebuild
                     WHERE run_id = p_run_id AND status='FAILED' AND is_retryable),
    'can_issue_communications', v_decide AND r.status = 'SCHEDULES_REBUILT',
    'can_retry_communications', v_decide AND EXISTS (
        SELECT 1 FROM public.bn_uprating_communication_intent
         WHERE run_id = p_run_id AND status='FAILED' AND is_retryable),
    'can_mark_failed', v_admin AND r.status IN ('EXECUTING','PARTIAL','COMPLETED')
        AND COALESCE((v_comp->>'final_failure_count')::int,0) > 0,
    'schedule_required_count', v_sched_required,
    'schedule_completed_count', v_sched_done,
    'schedule_failed_count', v_sched_failed,
    'schedule_pending_count', v_sched_pending,
    'communication_required_count', v_comm_required,
    'communication_requested_count', v_comm_req,
    'communication_failed_count', v_comm_failed,
    'communication_pending_count', v_comm_pending,
    'communication_delivered_count', v_comm_delivered,
    'schedules_rebuilt_at', r.schedules_rebuilt_at,
    'communications_issued_at', r.communications_issued_at);
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_uprating_post_execution_readiness_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,
    'data', public._bn_uprating_post_execution_readiness(p_run_id, p_actor_user_id));
END; $function$;
GRANT EXECUTE ON FUNCTION public.bn_uprating_post_execution_readiness_v1(uuid,uuid) TO authenticated, service_role;