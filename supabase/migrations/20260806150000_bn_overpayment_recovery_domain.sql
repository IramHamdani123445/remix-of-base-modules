-- =====================================================================
-- BN Overpayment Recovery — forward-only governed domain migration
-- Reconstructed from the governed contract: 24 bn_op_* tables, RLS,
-- policies, indexes, constraints and the 43-RPC secured boundary.
-- Idempotent: safe to re-apply.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.bn_op_action_definition (
  action_code text NOT NULL,
  display_name text NOT NULL,
  risk_level text NOT NULL DEFAULT 'STANDARD'::text,
  is_financial boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_appeal_hold (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  appeal_reference text,
  reason text NOT NULL,
  placed_by text NOT NULL,
  placed_at timestamp with time zone NOT NULL DEFAULT now(),
  released_by text,
  released_at timestamp with time zone,
  release_outcome text,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_case (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_reference text NOT NULL,
  bn_award_id uuid,
  bn_claim_id uuid,
  person_reference text,
  detection_source text NOT NULL DEFAULT 'MANUAL'::text,
  reason_code text,
  period_from date,
  period_to date,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  status text NOT NULL DEFAULT 'CANDIDATE'::text,
  gross_liability numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_amount numeric(18,2) NOT NULL DEFAULT 0,
  legacy_overpayment_id uuid,
  closed_at timestamp with time zone,
  closed_by text,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL DEFAULT 'system'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_communication_intent (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  event_code text NOT NULL,
  channel_hint text,
  recipient_ref text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING'::text,
  dispatch_reference text,
  last_error text,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_deduction_instruction (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  plan_id uuid,
  bn_award_id uuid,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  amount_per_cycle numeric(18,2) NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  status text NOT NULL DEFAULT 'PENDING'::text,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_estate_referral (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  referral_reference text,
  external_case_ref text,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  referred_amount numeric(18,2) NOT NULL,
  deceased_reference text,
  status text NOT NULL DEFAULT 'REFERRED'::text,
  idempotency_key text NOT NULL,
  referred_by text NOT NULL,
  referred_at timestamp with time zone NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_event (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  event_code text NOT NULL,
  command_code text,
  from_status text,
  to_status text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_code text NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_evidence_link (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  liability_id uuid,
  evidence_kind text NOT NULL,
  evidence_ref text NOT NULL,
  is_confidential boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_finance_posting_intent (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  transaction_id uuid,
  intent_type text NOT NULL,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  signed_amount numeric(18,2) NOT NULL,
  source_command text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'::text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  posting_reference text,
  posted_at timestamp with time zone,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_idempotency (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  command_code text NOT NULL,
  case_id uuid,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'IN_PROGRESS'::text,
  result jsonb,
  actor_code text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.bn_op_legal_referral (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  referral_reference text,
  external_case_ref text,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  referred_amount numeric(18,2) NOT NULL,
  status text NOT NULL DEFAULT 'REFERRED'::text,
  idempotency_key text NOT NULL,
  referred_by text NOT NULL,
  referred_at timestamp with time zone NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_liability_version (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  version_no integer NOT NULL,
  method_code text NOT NULL DEFAULT 'MANUAL'::text,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  gross_amount numeric(18,2) NOT NULL,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT'::text,
  superseded_by uuid,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.bn_op_operational_exception (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid,
  command_code text,
  error_code text NOT NULL,
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_code text,
  occurred_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_receipt_allocation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  instalment_id uuid,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  amount numeric(18,2) NOT NULL,
  allocated_by text NOT NULL,
  allocated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_reconciliation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  module_balance numeric(18,2) NOT NULL,
  finance_balance numeric(18,2),
  variance numeric(18,2),
  status text NOT NULL DEFAULT 'PENDING'::text,
  note text,
  reconciled_by text,
  reconciled_at timestamp with time zone,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_recovery_plan (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  plan_no integer NOT NULL,
  method_code text NOT NULL DEFAULT 'BENEFIT_DEDUCTION'::text,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  total_amount numeric(18,2) NOT NULL,
  instalment_amount numeric(18,2),
  frequency_code text NOT NULL DEFAULT 'MONTHLY'::text,
  start_date date,
  status text NOT NULL DEFAULT 'PROPOSED'::text,
  proposed_by text NOT NULL,
  approved_by text,
  approved_at timestamp with time zone,
  rejected_by text,
  rejected_at timestamp with time zone,
  rejection_reason text,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_recovery_plan_instalment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  case_id uuid NOT NULL,
  sequence_no integer NOT NULL,
  due_date date NOT NULL,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  amount numeric(18,2) NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED'::text,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_recovery_suspension (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  reason_code text NOT NULL,
  reason text,
  suspended_by text NOT NULL,
  suspended_at timestamp with time zone NOT NULL DEFAULT now(),
  resumed_by text,
  resumed_at timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_recovery_transaction (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  txn_no bigint NOT NULL,
  txn_type text NOT NULL,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  signed_amount numeric(18,2) NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  source_command text NOT NULL,
  source_reference text,
  reverses_transaction_id uuid,
  is_reversal boolean NOT NULL DEFAULT false,
  posted_by text NOT NULL,
  posted_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_representation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  received_on date NOT NULL DEFAULT CURRENT_DATE,
  channel text NOT NULL DEFAULT 'WRITTEN'::text,
  summary text NOT NULL,
  outcome text NOT NULL DEFAULT 'PENDING'::text,
  decided_by text,
  decided_at timestamp with time zone,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_role_action (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  role_code text NOT NULL,
  action_code text NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_user_role (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role_code text NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_waiver_request (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  requested_amount numeric(18,2) NOT NULL,
  is_full boolean NOT NULL DEFAULT false,
  ground_code text NOT NULL,
  justification text,
  status text NOT NULL DEFAULT 'REQUESTED'::text,
  requested_by text NOT NULL,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamp with time zone,
  decision_note text,
  transaction_id uuid,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bn_op_writeoff_request (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  currency character(3) NOT NULL DEFAULT 'XCD'::bpchar,
  requested_amount numeric(18,2) NOT NULL,
  is_full boolean NOT NULL DEFAULT false,
  ground_code text NOT NULL,
  justification text,
  status text NOT NULL DEFAULT 'REQUESTED'::text,
  requested_by text NOT NULL,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamp with time zone,
  decision_note text,
  transaction_id uuid,
  row_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $mig$ BEGIN ALTER TABLE public.bn_op_action_definition ADD CONSTRAINT bn_op_action_definition_pkey PRIMARY KEY (action_code); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_action_definition ADD CONSTRAINT bn_op_action_risk_chk CHECK ((risk_level = ANY (ARRAY['STANDARD'::text, 'ELEVATED'::text, 'HIGH'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_appeal_hold ADD CONSTRAINT bn_op_appeal_hold_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_appeal_hold ADD CONSTRAINT bn_op_appeal_hold_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_case ADD CONSTRAINT bn_op_case_case_reference_key UNIQUE (case_reference); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_case ADD CONSTRAINT bn_op_case_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_case ADD CONSTRAINT bn_op_case_bn_award_id_fkey FOREIGN KEY (bn_award_id) REFERENCES bn_award(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_case ADD CONSTRAINT bn_op_case_legacy_overpayment_id_fkey FOREIGN KEY (legacy_overpayment_id) REFERENCES bn_overpayment(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_case ADD CONSTRAINT bn_op_case_status_chk CHECK ((status = ANY (ARRAY['CANDIDATE'::text, 'CALCULATED'::text, 'VERIFIED'::text, 'NOTICE_ISSUED'::text, 'REPRESENTATION'::text, 'LIABILITY_CONFIRMED'::text, 'PLAN_PROPOSED'::text, 'PLAN_APPROVED'::text, 'IN_RECOVERY'::text, 'SUSPENDED'::text, 'ON_APPEAL_HOLD'::text, 'RECONCILED'::text, 'CLOSED'::text, 'CANCELLED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_communication_intent ADD CONSTRAINT bn_op_communication_intent_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_communication_intent ADD CONSTRAINT bn_op_communication_intent_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_communication_intent ADD CONSTRAINT bn_op_comm_status_chk CHECK ((status = ANY (ARRAY['PENDING'::text, 'DISPATCHED'::text, 'FAILED'::text, 'SUPPRESSED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_deduction_instruction ADD CONSTRAINT bn_op_deduction_instruction_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_deduction_instruction ADD CONSTRAINT bn_op_deduction_instruction_bn_award_id_fkey FOREIGN KEY (bn_award_id) REFERENCES bn_award(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_deduction_instruction ADD CONSTRAINT bn_op_deduction_instruction_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_deduction_instruction ADD CONSTRAINT bn_op_deduction_instruction_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES bn_op_recovery_plan(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_deduction_instruction ADD CONSTRAINT bn_op_ded_amt_chk CHECK ((amount_per_cycle > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_deduction_instruction ADD CONSTRAINT bn_op_ded_status_chk CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'ENDED'::text, 'CANCELLED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_estate_referral ADD CONSTRAINT bn_op_estate_referral_idempotency_key_key UNIQUE (idempotency_key); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_estate_referral ADD CONSTRAINT bn_op_estate_referral_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_estate_referral ADD CONSTRAINT bn_op_estate_referral_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_estate_referral ADD CONSTRAINT bn_op_estate_status_chk CHECK ((status = ANY (ARRAY['REFERRED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'CLOSED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_event ADD CONSTRAINT bn_op_event_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_event ADD CONSTRAINT bn_op_event_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_evidence_link ADD CONSTRAINT bn_op_evidence_link_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_evidence_link ADD CONSTRAINT bn_op_evidence_link_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_evidence_link ADD CONSTRAINT bn_op_evidence_link_liability_id_fkey FOREIGN KEY (liability_id) REFERENCES bn_op_liability_version(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_finance_posting_intent ADD CONSTRAINT bn_op_finance_posting_intent_idempotency_key_key UNIQUE (idempotency_key); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_finance_posting_intent ADD CONSTRAINT bn_op_finance_posting_intent_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_finance_posting_intent ADD CONSTRAINT bn_op_finance_posting_intent_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_finance_posting_intent ADD CONSTRAINT bn_op_finance_posting_intent_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES bn_op_recovery_transaction(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_finance_posting_intent ADD CONSTRAINT bn_op_fin_posted_chk CHECK (((status <> 'POSTED'::text) OR (posting_reference IS NOT NULL))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_finance_posting_intent ADD CONSTRAINT bn_op_fin_status_chk CHECK ((status = ANY (ARRAY['PENDING'::text, 'POSTED'::text, 'FAILED'::text, 'CANCELLED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_idempotency ADD CONSTRAINT bn_op_idempotency_idempotency_key_key UNIQUE (idempotency_key); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_idempotency ADD CONSTRAINT bn_op_idempotency_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_idempotency ADD CONSTRAINT bn_op_idem_status_chk CHECK ((status = ANY (ARRAY['IN_PROGRESS'::text, 'COMPLETED'::text, 'FAILED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_legal_referral ADD CONSTRAINT bn_op_legal_referral_idempotency_key_key UNIQUE (idempotency_key); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_legal_referral ADD CONSTRAINT bn_op_legal_referral_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_legal_referral ADD CONSTRAINT bn_op_legal_referral_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_legal_referral ADD CONSTRAINT bn_op_legal_status_chk CHECK ((status = ANY (ARRAY['REFERRED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'CLOSED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_liability_version ADD CONSTRAINT bn_op_liability_version_case_id_version_no_key UNIQUE (case_id, version_no); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_liability_version ADD CONSTRAINT bn_op_liability_version_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_liability_version ADD CONSTRAINT bn_op_liability_version_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_liability_version ADD CONSTRAINT bn_op_liab_amt_chk CHECK ((gross_amount >= (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_liability_version ADD CONSTRAINT bn_op_liab_status_chk CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'SUPERSEDED'::text, 'VOID'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_operational_exception ADD CONSTRAINT bn_op_operational_exception_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_operational_exception ADD CONSTRAINT bn_op_operational_exception_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_receipt_allocation ADD CONSTRAINT bn_op_receipt_allocation_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_receipt_allocation ADD CONSTRAINT bn_op_receipt_allocation_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_receipt_allocation ADD CONSTRAINT bn_op_receipt_allocation_instalment_id_fkey FOREIGN KEY (instalment_id) REFERENCES bn_op_recovery_plan_instalment(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_receipt_allocation ADD CONSTRAINT bn_op_receipt_allocation_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES bn_op_recovery_transaction(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_receipt_allocation ADD CONSTRAINT bn_op_alloc_amt_chk CHECK ((amount > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_reconciliation ADD CONSTRAINT bn_op_reconciliation_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_reconciliation ADD CONSTRAINT bn_op_reconciliation_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_reconciliation ADD CONSTRAINT bn_op_recon_status_chk CHECK ((status = ANY (ARRAY['PENDING'::text, 'MATCHED'::text, 'VARIANCE'::text, 'FAILED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan ADD CONSTRAINT bn_op_recovery_plan_case_id_plan_no_key UNIQUE (case_id, plan_no); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan ADD CONSTRAINT bn_op_recovery_plan_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan ADD CONSTRAINT bn_op_recovery_plan_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan ADD CONSTRAINT bn_op_plan_amt_chk CHECK ((total_amount > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan ADD CONSTRAINT bn_op_plan_status_chk CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'REJECTED'::text, 'REVISED'::text, 'ACTIVE'::text, 'COMPLETED'::text, 'BREACHED'::text, 'CANCELLED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan_instalment ADD CONSTRAINT bn_op_recovery_plan_instalment_plan_id_sequence_no_key UNIQUE (plan_id, sequence_no); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan_instalment ADD CONSTRAINT bn_op_recovery_plan_instalment_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan_instalment ADD CONSTRAINT bn_op_recovery_plan_instalment_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan_instalment ADD CONSTRAINT bn_op_recovery_plan_instalment_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES bn_op_recovery_plan(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_plan_instalment ADD CONSTRAINT bn_op_inst_status_chk CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'DUE'::text, 'PAID'::text, 'PARTIAL'::text, 'MISSED'::text, 'CANCELLED'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_suspension ADD CONSTRAINT bn_op_recovery_suspension_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_suspension ADD CONSTRAINT bn_op_recovery_suspension_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_transaction ADD CONSTRAINT bn_op_recovery_transaction_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_transaction ADD CONSTRAINT bn_op_recovery_transaction_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_transaction ADD CONSTRAINT bn_op_recovery_transaction_reverses_transaction_id_fkey FOREIGN KEY (reverses_transaction_id) REFERENCES bn_op_recovery_transaction(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_transaction ADD CONSTRAINT bn_op_txn_amt_chk CHECK ((signed_amount <> (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_transaction ADD CONSTRAINT bn_op_txn_reversal_chk CHECK (((is_reversal AND (reverses_transaction_id IS NOT NULL)) OR ((NOT is_reversal) AND (reverses_transaction_id IS NULL)))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_recovery_transaction ADD CONSTRAINT bn_op_txn_type_chk CHECK ((txn_type = ANY (ARRAY['LIABILITY'::text, 'RECEIPT'::text, 'DEDUCTION'::text, 'WAIVER'::text, 'WRITEOFF'::text, 'ADJUSTMENT'::text, 'REVERSAL'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_representation ADD CONSTRAINT bn_op_representation_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_representation ADD CONSTRAINT bn_op_representation_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_representation ADD CONSTRAINT bn_op_rep_outcome_chk CHECK ((outcome = ANY (ARRAY['PENDING'::text, 'UPHELD'::text, 'PARTIALLY_UPHELD'::text, 'REJECTED'::text, 'WITHDRAWN'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_role_action ADD CONSTRAINT bn_op_role_action_role_code_action_code_key UNIQUE (role_code, action_code); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_role_action ADD CONSTRAINT bn_op_role_action_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_role_action ADD CONSTRAINT bn_op_role_action_action_code_fkey FOREIGN KEY (action_code) REFERENCES bn_op_action_definition(action_code) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_user_role ADD CONSTRAINT bn_op_user_role_user_id_role_code_key UNIQUE (user_id, role_code); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_user_role ADD CONSTRAINT bn_op_user_role_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_waiver_request ADD CONSTRAINT bn_op_waiver_request_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_waiver_request ADD CONSTRAINT bn_op_waiver_request_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_waiver_request ADD CONSTRAINT bn_op_waiver_request_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES bn_op_recovery_transaction(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_waiver_request ADD CONSTRAINT bn_op_waiver_amt_chk CHECK ((requested_amount > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_waiver_request ADD CONSTRAINT bn_op_waiver_status_chk CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'WITHDRAWN'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_writeoff_request ADD CONSTRAINT bn_op_writeoff_request_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_writeoff_request ADD CONSTRAINT bn_op_writeoff_request_case_id_fkey FOREIGN KEY (case_id) REFERENCES bn_op_case(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_writeoff_request ADD CONSTRAINT bn_op_writeoff_request_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES bn_op_recovery_transaction(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_writeoff_request ADD CONSTRAINT bn_op_wo_amt_chk CHECK ((requested_amount > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

DO $mig$ BEGIN ALTER TABLE public.bn_op_writeoff_request ADD CONSTRAINT bn_op_wo_status_chk CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'WITHDRAWN'::text]))); EXCEPTION WHEN duplicate_object THEN NULL WHEN duplicate_table THEN NULL; END $mig$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_op_appeal_hold_active ON public.bn_op_appeal_hold USING btree (case_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_bn_op_case_award ON public.bn_op_case USING btree (bn_award_id);

CREATE INDEX IF NOT EXISTS idx_bn_op_case_status ON public.bn_op_case USING btree (status);

CREATE INDEX IF NOT EXISTS idx_bn_op_event_case ON public.bn_op_event USING btree (case_id, occurred_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_op_suspension_active ON public.bn_op_recovery_suspension USING btree (case_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_bn_op_txn_case ON public.bn_op_recovery_transaction USING btree (case_id);

CREATE INDEX IF NOT EXISTS idx_bn_op_txn_reverses ON public.bn_op_recovery_transaction USING btree (reverses_transaction_id);

ALTER TABLE public.bn_op_action_definition ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_action_definition_read ON public.bn_op_action_definition; CREATE POLICY bn_op_action_definition_read ON public.bn_op_action_definition AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_action_definition_service ON public.bn_op_action_definition; CREATE POLICY bn_op_action_definition_service ON public.bn_op_action_definition AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_appeal_hold ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_appeal_hold_read ON public.bn_op_appeal_hold; CREATE POLICY bn_op_appeal_hold_read ON public.bn_op_appeal_hold AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_appeal_hold_service ON public.bn_op_appeal_hold; CREATE POLICY bn_op_appeal_hold_service ON public.bn_op_appeal_hold AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_case ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_case_read ON public.bn_op_case; CREATE POLICY bn_op_case_read ON public.bn_op_case AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_case_service ON public.bn_op_case; CREATE POLICY bn_op_case_service ON public.bn_op_case AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_communication_intent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_communication_intent_read ON public.bn_op_communication_intent; CREATE POLICY bn_op_communication_intent_read ON public.bn_op_communication_intent AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_communication_intent_service ON public.bn_op_communication_intent; CREATE POLICY bn_op_communication_intent_service ON public.bn_op_communication_intent AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_deduction_instruction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_deduction_instruction_read ON public.bn_op_deduction_instruction; CREATE POLICY bn_op_deduction_instruction_read ON public.bn_op_deduction_instruction AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_deduction_instruction_service ON public.bn_op_deduction_instruction; CREATE POLICY bn_op_deduction_instruction_service ON public.bn_op_deduction_instruction AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_estate_referral ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_estate_referral_read ON public.bn_op_estate_referral; CREATE POLICY bn_op_estate_referral_read ON public.bn_op_estate_referral AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_estate_referral_service ON public.bn_op_estate_referral; CREATE POLICY bn_op_estate_referral_service ON public.bn_op_estate_referral AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_event_read ON public.bn_op_event; CREATE POLICY bn_op_event_read ON public.bn_op_event AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_event_service ON public.bn_op_event; CREATE POLICY bn_op_event_service ON public.bn_op_event AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_evidence_link ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_evidence_link_read ON public.bn_op_evidence_link; CREATE POLICY bn_op_evidence_link_read ON public.bn_op_evidence_link AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_evidence_link_service ON public.bn_op_evidence_link; CREATE POLICY bn_op_evidence_link_service ON public.bn_op_evidence_link AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_finance_posting_intent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_finance_posting_intent_read ON public.bn_op_finance_posting_intent; CREATE POLICY bn_op_finance_posting_intent_read ON public.bn_op_finance_posting_intent AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_finance_posting_intent_service ON public.bn_op_finance_posting_intent; CREATE POLICY bn_op_finance_posting_intent_service ON public.bn_op_finance_posting_intent AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_idempotency_read ON public.bn_op_idempotency; CREATE POLICY bn_op_idempotency_read ON public.bn_op_idempotency AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_idempotency_service ON public.bn_op_idempotency; CREATE POLICY bn_op_idempotency_service ON public.bn_op_idempotency AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_legal_referral ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_legal_referral_read ON public.bn_op_legal_referral; CREATE POLICY bn_op_legal_referral_read ON public.bn_op_legal_referral AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_legal_referral_service ON public.bn_op_legal_referral; CREATE POLICY bn_op_legal_referral_service ON public.bn_op_legal_referral AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_liability_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_liability_version_read ON public.bn_op_liability_version; CREATE POLICY bn_op_liability_version_read ON public.bn_op_liability_version AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_liability_version_service ON public.bn_op_liability_version; CREATE POLICY bn_op_liability_version_service ON public.bn_op_liability_version AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_operational_exception ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_operational_exception_read ON public.bn_op_operational_exception; CREATE POLICY bn_op_operational_exception_read ON public.bn_op_operational_exception AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_operational_exception_service ON public.bn_op_operational_exception; CREATE POLICY bn_op_operational_exception_service ON public.bn_op_operational_exception AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_receipt_allocation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_receipt_allocation_read ON public.bn_op_receipt_allocation; CREATE POLICY bn_op_receipt_allocation_read ON public.bn_op_receipt_allocation AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_receipt_allocation_service ON public.bn_op_receipt_allocation; CREATE POLICY bn_op_receipt_allocation_service ON public.bn_op_receipt_allocation AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_reconciliation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_reconciliation_read ON public.bn_op_reconciliation; CREATE POLICY bn_op_reconciliation_read ON public.bn_op_reconciliation AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_reconciliation_service ON public.bn_op_reconciliation; CREATE POLICY bn_op_reconciliation_service ON public.bn_op_reconciliation AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_recovery_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_recovery_plan_read ON public.bn_op_recovery_plan; CREATE POLICY bn_op_recovery_plan_read ON public.bn_op_recovery_plan AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_recovery_plan_service ON public.bn_op_recovery_plan; CREATE POLICY bn_op_recovery_plan_service ON public.bn_op_recovery_plan AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_recovery_plan_instalment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_recovery_plan_instalment_read ON public.bn_op_recovery_plan_instalment; CREATE POLICY bn_op_recovery_plan_instalment_read ON public.bn_op_recovery_plan_instalment AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_recovery_plan_instalment_service ON public.bn_op_recovery_plan_instalment; CREATE POLICY bn_op_recovery_plan_instalment_service ON public.bn_op_recovery_plan_instalment AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_recovery_suspension ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_recovery_suspension_read ON public.bn_op_recovery_suspension; CREATE POLICY bn_op_recovery_suspension_read ON public.bn_op_recovery_suspension AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_recovery_suspension_service ON public.bn_op_recovery_suspension; CREATE POLICY bn_op_recovery_suspension_service ON public.bn_op_recovery_suspension AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_recovery_transaction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_recovery_transaction_read ON public.bn_op_recovery_transaction; CREATE POLICY bn_op_recovery_transaction_read ON public.bn_op_recovery_transaction AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_recovery_transaction_service ON public.bn_op_recovery_transaction; CREATE POLICY bn_op_recovery_transaction_service ON public.bn_op_recovery_transaction AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_representation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_representation_read ON public.bn_op_representation; CREATE POLICY bn_op_representation_read ON public.bn_op_representation AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_representation_service ON public.bn_op_representation; CREATE POLICY bn_op_representation_service ON public.bn_op_representation AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_role_action ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_role_action_read ON public.bn_op_role_action; CREATE POLICY bn_op_role_action_read ON public.bn_op_role_action AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_role_action_service ON public.bn_op_role_action; CREATE POLICY bn_op_role_action_service ON public.bn_op_role_action AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_user_role ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_user_role_read ON public.bn_op_user_role; CREATE POLICY bn_op_user_role_read ON public.bn_op_user_role AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_user_role_service ON public.bn_op_user_role; CREATE POLICY bn_op_user_role_service ON public.bn_op_user_role AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_waiver_request ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_waiver_request_read ON public.bn_op_waiver_request; CREATE POLICY bn_op_waiver_request_read ON public.bn_op_waiver_request AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_waiver_request_service ON public.bn_op_waiver_request; CREATE POLICY bn_op_waiver_request_service ON public.bn_op_waiver_request AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.bn_op_writeoff_request ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bn_op_writeoff_request_read ON public.bn_op_writeoff_request; CREATE POLICY bn_op_writeoff_request_read ON public.bn_op_writeoff_request AS PERMISSIVE FOR SELECT TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bn_op_writeoff_request_service ON public.bn_op_writeoff_request; CREATE POLICY bn_op_writeoff_request_service ON public.bn_op_writeoff_request AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._bn_op_actor()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v uuid := auth.uid();
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED'; END IF;
  RETURN v::text;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_actor_uid()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v uuid := auth.uid();
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED'; END IF;
  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_assert_actions_enabled()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v boolean;
BEGIN
  SELECT actions_enabled INTO v FROM public.app_modules WHERE name = 'bn_overpayments';
  IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'E_ACTIONS_DISABLED'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_assert_amount(p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'E_AMOUNT_INVALID'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_assert_currency(p_case bn_op_case, p_currency text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_currency IS NOT NULL AND upper(p_currency) <> p_case.currency THEN
    RAISE EXCEPTION 'E_CURRENCY_MISMATCH';
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_assert_no_hold(p_case_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bn_op_appeal_hold WHERE case_id = p_case_id AND is_active) THEN
    RAISE EXCEPTION 'E_APPEAL_HOLD';
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_assert_not_suspended(p_case_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bn_op_recovery_suspension WHERE case_id = p_case_id AND is_active) THEN
    RAISE EXCEPTION 'E_RECOVERY_SUSPENDED';
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_assert_open(p_case bn_op_case)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_case.status IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'E_CASE_CLOSED'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_assert_state(p_actual text, p_allowed text[])
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_actual = ANY (p_allowed)) THEN
    RAISE EXCEPTION 'E_INVALID_STATE: %', p_actual;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_block_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'E_IMMUTABLE_RECORD: % rows cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION public._bn_op_check_version(p_actual integer, p_expected integer)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_expected IS NULL OR p_expected <> p_actual THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION';
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_comm_intent(p_case_id uuid, p_event_code text, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v uuid; safe jsonb;
BEGIN
  safe := coalesce(p_context, '{}'::jsonb)
          - 'fraud_narrative' - 'staff_notes' - 'legal_advice' - 'risk_score'
          - 'bank_account' - 'payment_instrument' - 'medical' - 'ssn';
  INSERT INTO public.bn_op_communication_intent(case_id, event_code, context, created_by)
  VALUES (p_case_id, p_event_code, safe, public._bn_op_actor())
  RETURNING id INTO v;
  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_deny_self_approval(p_maker text, p_checker text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_maker IS NOT NULL AND p_maker = p_checker THEN RAISE EXCEPTION 'E_SELF_APPROVAL'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_event(p_case_id uuid, p_event text, p_command text, p_from text, p_to text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.bn_op_event(case_id, event_code, command_code, from_status, to_status, detail, actor_code)
  VALUES (p_case_id, p_event, p_command, p_from, p_to, coalesce(p_detail,'{}'::jsonb), public._bn_op_actor());
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_finance_intent(p_case_id uuid, p_txn_id uuid, p_type text, p_currency text, p_signed_amount numeric, p_command text, p_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v uuid;
BEGIN
  INSERT INTO public.bn_op_finance_posting_intent(
    case_id, transaction_id, intent_type, currency, signed_amount,
    source_command, idempotency_key, created_by)
  VALUES (p_case_id, p_txn_id, p_type, p_currency, p_signed_amount, p_command, p_key, public._bn_op_actor())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v;
  IF v IS NULL THEN
    SELECT id INTO v FROM public.bn_op_finance_posting_intent WHERE idempotency_key = p_key;
  END IF;
  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_idem_begin(p_key text, p_command text, p_case_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.bn_op_idempotency; h text := md5(coalesce(p_payload, '{}'::jsonb)::text);
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 THEN RAISE EXCEPTION 'E_IDEMPOTENCY_KEY_REQUIRED'; END IF;
  SELECT * INTO r FROM public.bn_op_idempotency WHERE idempotency_key = p_key;
  IF FOUND THEN
    IF r.payload_hash <> h THEN RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
    IF r.command_code <> p_command THEN RAISE EXCEPTION 'E_IDEMPOTENCY_KEY_REUSED'; END IF;
    IF r.status = 'COMPLETED' THEN RETURN r.result; END IF;
    RAISE EXCEPTION 'E_IDEMPOTENCY_KEY_REUSED';
  END IF;
  INSERT INTO public.bn_op_idempotency(idempotency_key, command_code, case_id, payload_hash, actor_code)
  VALUES (p_key, p_command, p_case_id, h, public._bn_op_actor());
  RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_idem_finish(p_key text, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.bn_op_idempotency
     SET status = 'COMPLETED', result = p_result, completed_at = now()
   WHERE idempotency_key = p_key;
  RETURN p_result;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_ok(p_case_id uuid, p_command text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case;
BEGIN
  SELECT * INTO c FROM public.bn_op_case WHERE id = p_case_id;
  RETURN jsonb_build_object(
    'ok', true, 'command', p_command, 'case_id', p_case_id,
    'status', c.status, 'row_version', c.row_version,
    'outstanding_amount', c.outstanding_amount, 'currency', c.currency,
    'data', coalesce(p_data, '{}'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_outstanding(p_case_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(signed_amount), 0)::numeric(18,2)
  FROM public.bn_op_recovery_transaction WHERE case_id = p_case_id;
$function$;

CREATE OR REPLACE FUNCTION public._bn_op_post_txn(p_case_id uuid, p_type text, p_signed numeric, p_command text, p_reference text DEFAULT NULL::text, p_reverses uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v uuid; c public.bn_op_case;
BEGIN
  SELECT * INTO c FROM public.bn_op_case WHERE id = p_case_id;
  INSERT INTO public.bn_op_recovery_transaction(
    case_id, txn_type, currency, signed_amount, source_command, source_reference,
    reverses_transaction_id, is_reversal, posted_by)
  VALUES (p_case_id, p_type, c.currency, p_signed, p_command, p_reference,
          p_reverses, p_reverses IS NOT NULL, public._bn_op_actor())
  RETURNING id INTO v;
  UPDATE public.bn_op_case
     SET outstanding_amount = public._bn_op_outstanding(p_case_id),
         updated_by = public._bn_op_actor(), row_version = row_version + 1
   WHERE id = p_case_id;
  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_require_case(p_case_id uuid)
 RETURNS bn_op_case
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.bn_op_case;
BEGIN
  SELECT * INTO r FROM public.bn_op_case WHERE id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  RETURN r;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_require_permission(p_action text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bn_op_user_role ur
    JOIN public.bn_op_role_action ra ON ra.role_code = ur.role_code
    WHERE ur.user_id = public._bn_op_actor_uid() AND ra.action_code = p_action
  ) INTO v;
  IF NOT v THEN RAISE EXCEPTION 'E_PERMISSION_DENIED: %', p_action; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_require_view()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_permission('view');
END; $function$;

CREATE OR REPLACE FUNCTION public._bn_op_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._bn_op_touch_case(p_case_id uuid, p_status text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.bn_op_case
     SET status = COALESCE(p_status, status),
         row_version = row_version + 1,
         updated_by = public._bn_op_actor()
   WHERE id = p_case_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_activate_benefit_deduction_v1(p_case_id uuid, p_plan_id uuid, p_row_version integer, p_amount_per_cycle numeric, p_currency text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; p public.bn_op_recovery_plan; cached jsonb; v uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('activate_deduction');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  PERFORM public._bn_op_assert_not_suspended(p_case_id);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['PLAN_APPROVED','IN_RECOVERY']);
  PERFORM public._bn_op_assert_amount(p_amount_per_cycle);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  SELECT * INTO p FROM public.bn_op_recovery_plan WHERE id = p_plan_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  IF p.status <> 'APPROVED' THEN RAISE EXCEPTION 'E_INVALID_STATE: plan %', p.status; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_ACTIVATE_BENEFIT_DEDUCTION', p_case_id,
    jsonb_build_object('plan', p_plan_id, 'amount', p_amount_per_cycle));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  INSERT INTO public.bn_op_deduction_instruction(case_id, plan_id, bn_award_id, currency,
    amount_per_cycle, status, created_by)
  VALUES (p_case_id, p_plan_id, c.bn_award_id, c.currency, p_amount_per_cycle, 'ACTIVE', public._bn_op_actor())
  RETURNING id INTO v;
  UPDATE public.bn_op_recovery_plan SET status = 'ACTIVE', row_version = row_version + 1 WHERE id = p_plan_id;
  PERFORM public._bn_op_touch_case(p_case_id, 'IN_RECOVERY');
  PERFORM public._bn_op_event(p_case_id, 'DEDUCTION_ACTIVATED', 'BN_OVP_ACTIVATE_BENEFIT_DEDUCTION',
    c.status, 'IN_RECOVERY', jsonb_build_object('instruction_id', v));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_ACTIVATE_BENEFIT_DEDUCTION', jsonb_build_object('instruction_id', v)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_allocate_receipt_v1(p_case_id uuid, p_transaction_id uuid, p_instalment_id uuid, p_amount numeric, p_currency text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; t public.bn_op_recovery_transaction; cached jsonb; v uuid; allocated numeric;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('allocate_receipt');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  PERFORM public._bn_op_assert_not_suspended(p_case_id);
  PERFORM public._bn_op_assert_amount(p_amount);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  SELECT * INTO t FROM public.bn_op_recovery_transaction
   WHERE id = p_transaction_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  IF t.txn_type NOT IN ('RECEIPT','DEDUCTION') THEN RAISE EXCEPTION 'E_INVALID_STATE: not a receipt'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO allocated FROM public.bn_op_receipt_allocation
   WHERE transaction_id = p_transaction_id;
  IF allocated + p_amount > abs(t.signed_amount) THEN RAISE EXCEPTION 'E_AMOUNT_INVALID: over-allocation'; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_ALLOCATE_RECEIPT', p_case_id,
    jsonb_build_object('txn', p_transaction_id, 'amount', p_amount, 'inst', p_instalment_id));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  INSERT INTO public.bn_op_receipt_allocation(case_id, transaction_id, instalment_id, currency, amount, allocated_by)
  VALUES (p_case_id, p_transaction_id, p_instalment_id, c.currency, p_amount, public._bn_op_actor())
  RETURNING id INTO v;
  IF p_instalment_id IS NOT NULL THEN
    UPDATE public.bn_op_recovery_plan_instalment
       SET status = CASE WHEN p_amount >= amount THEN 'PAID' ELSE 'PARTIAL' END,
           row_version = row_version + 1
     WHERE id = p_instalment_id;
  END IF;
  PERFORM public._bn_op_event(p_case_id, 'RECEIPT_ALLOCATED', 'BN_OVP_ALLOCATE_RECEIPT', c.status, c.status,
    jsonb_build_object('allocation_id', v));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_ALLOCATE_RECEIPT', jsonb_build_object('allocation_id', v)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_appeal_holds_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true,
    'holds', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.placed_at)
      FROM public.bn_op_appeal_hold h WHERE h.case_id = p_case_id), '[]'::jsonb),
    'suspensions', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.suspended_at)
      FROM public.bn_op_recovery_suspension s WHERE s.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_approve_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; p public.bn_op_recovery_plan; cached jsonb;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('approve_recovery_plan');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  SELECT * INTO p FROM public.bn_op_recovery_plan WHERE id = p_plan_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(p.row_version, p_plan_row_version);
  PERFORM public._bn_op_assert_state(p.status, ARRAY['PROPOSED','REVISED']);
  PERFORM public._bn_op_deny_self_approval(p.proposed_by, public._bn_op_actor());
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_APPROVE_RECOVERY_PLAN', p_case_id,
    jsonb_build_object('plan', p_plan_id));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_recovery_plan
     SET status = 'APPROVED', approved_by = public._bn_op_actor(), approved_at = now(),
         row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_plan_id;
  PERFORM public._bn_op_touch_case(p_case_id, 'PLAN_APPROVED');
  PERFORM public._bn_op_comm_intent(p_case_id, 'BN_OVP_PLAN_APPROVED',
    jsonb_build_object('case_reference', c.case_reference, 'plan_id', p_plan_id));
  PERFORM public._bn_op_event(p_case_id, 'PLAN_APPROVED', 'BN_OVP_APPROVE_RECOVERY_PLAN', c.status,
    'PLAN_APPROVED', jsonb_build_object('plan_id', p_plan_id));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_APPROVE_RECOVERY_PLAN', jsonb_build_object('plan_id', p_plan_id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_approve_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; w public.bn_op_waiver_request; cached jsonb; txn uuid; fi uuid; outstanding numeric;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('approve_waiver');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  SELECT * INTO w FROM public.bn_op_waiver_request WHERE id = p_waiver_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(w.row_version, p_row_version);
  PERFORM public._bn_op_assert_state(w.status, ARRAY['REQUESTED']);
  PERFORM public._bn_op_deny_self_approval(w.requested_by, public._bn_op_actor());
  outstanding := public._bn_op_outstanding(p_case_id);
  IF w.requested_amount > outstanding THEN RAISE EXCEPTION 'E_AMOUNT_INVALID: waiver exceeds outstanding'; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_APPROVE_WAIVER', p_case_id,
    jsonb_build_object('waiver', p_waiver_id));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  txn := public._bn_op_post_txn(p_case_id, 'WAIVER', -w.requested_amount, 'BN_OVP_APPROVE_WAIVER', p_waiver_id::text);
  fi := public._bn_op_finance_intent(p_case_id, txn, 'WAIVER', c.currency, -w.requested_amount,
        'BN_OVP_APPROVE_WAIVER', p_idempotency_key || ':FIN');
  UPDATE public.bn_op_waiver_request
     SET status = 'APPROVED', decided_by = public._bn_op_actor(), decided_at = now(),
         decision_note = p_note, transaction_id = txn, row_version = row_version + 1,
         updated_by = public._bn_op_actor()
   WHERE id = p_waiver_id;
  PERFORM public._bn_op_comm_intent(p_case_id, 'BN_OVP_WAIVER_APPROVED',
    jsonb_build_object('case_reference', c.case_reference, 'amount', w.requested_amount, 'currency', c.currency));
  PERFORM public._bn_op_event(p_case_id, 'WAIVER_APPROVED', 'BN_OVP_APPROVE_WAIVER', c.status, c.status,
    jsonb_build_object('waiver_id', p_waiver_id, 'transaction_id', txn, 'finance_intent_id', fi));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_APPROVE_WAIVER',
      jsonb_build_object('waiver_id', p_waiver_id, 'transaction_id', txn, 'finance_intent_id', fi)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_approve_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; w public.bn_op_writeoff_request; cached jsonb; txn uuid; fi uuid; outstanding numeric;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('approve_writeoff');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  SELECT * INTO w FROM public.bn_op_writeoff_request WHERE id = p_writeoff_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(w.row_version, p_row_version);
  PERFORM public._bn_op_assert_state(w.status, ARRAY['REQUESTED']);
  PERFORM public._bn_op_deny_self_approval(w.requested_by, public._bn_op_actor());
  outstanding := public._bn_op_outstanding(p_case_id);
  IF w.requested_amount > outstanding THEN RAISE EXCEPTION 'E_AMOUNT_INVALID: write-off exceeds outstanding'; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_APPROVE_WRITEOFF', p_case_id,
    jsonb_build_object('writeoff', p_writeoff_id));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  txn := public._bn_op_post_txn(p_case_id, 'WRITEOFF', -w.requested_amount, 'BN_OVP_APPROVE_WRITEOFF', p_writeoff_id::text);
  fi := public._bn_op_finance_intent(p_case_id, txn, 'WRITEOFF', c.currency, -w.requested_amount,
        'BN_OVP_APPROVE_WRITEOFF', p_idempotency_key || ':FIN');
  UPDATE public.bn_op_writeoff_request
     SET status = 'APPROVED', decided_by = public._bn_op_actor(), decided_at = now(),
         decision_note = p_note, transaction_id = txn, row_version = row_version + 1,
         updated_by = public._bn_op_actor()
   WHERE id = p_writeoff_id;
  PERFORM public._bn_op_event(p_case_id, 'WRITEOFF_APPROVED', 'BN_OVP_APPROVE_WRITEOFF', c.status, c.status,
    jsonb_build_object('writeoff_id', p_writeoff_id, 'transaction_id', txn, 'finance_intent_id', fi));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_APPROVE_WRITEOFF',
      jsonb_build_object('writeoff_id', p_writeoff_id, 'transaction_id', txn, 'finance_intent_id', fi)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_audit_history_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_permission('audit');
  RETURN jsonb_build_object('ok', true,
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at)
      FROM public.bn_op_event e WHERE e.case_id = p_case_id), '[]'::jsonb),
    'idempotency', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
      FROM public.bn_op_idempotency i WHERE i.case_id = p_case_id), '[]'::jsonb),
    'exceptions', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.occurred_at)
      FROM public.bn_op_operational_exception x WHERE x.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_available_actions_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; acts text[]; enabled boolean; hold boolean; susp boolean;
BEGIN
  PERFORM public._bn_op_require_view();
  SELECT * INTO c FROM public.bn_op_case WHERE id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  SELECT COALESCE(actions_enabled, false) INTO enabled FROM public.app_modules WHERE name = 'bn_overpayments';
  SELECT EXISTS (SELECT 1 FROM public.bn_op_appeal_hold h WHERE h.case_id = p_case_id AND h.is_active) INTO hold;
  SELECT EXISTS (SELECT 1 FROM public.bn_op_recovery_suspension s WHERE s.case_id = p_case_id AND s.is_active) INTO susp;
  SELECT COALESCE(array_agg(DISTINCT ra.action_code), ARRAY[]::text[]) INTO acts
    FROM public.bn_op_user_role ur
    JOIN public.bn_op_role_action ra ON ra.role_code = ur.role_code
   WHERE ur.user_id = public._bn_op_actor_uid();
  RETURN jsonb_build_object('ok', true, 'actions_enabled', COALESCE(enabled,false),
    'status', c.status, 'row_version', c.row_version,
    'on_appeal_hold', hold, 'recovery_suspended', susp,
    'granted_actions', to_jsonb(acts));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_balance_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case;
BEGIN
  PERFORM public._bn_op_require_view();
  SELECT * INTO c FROM public.bn_op_case WHERE id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  RETURN jsonb_build_object('ok', true, 'currency', c.currency,
    'gross_liability', c.gross_liability,
    'outstanding_amount', public._bn_op_outstanding(p_case_id),
    'receipts', COALESCE((SELECT -SUM(signed_amount) FROM public.bn_op_recovery_transaction
                           WHERE case_id = p_case_id AND txn_type = 'RECEIPT'), 0),
    'waived', COALESCE((SELECT -SUM(signed_amount) FROM public.bn_op_recovery_transaction
                         WHERE case_id = p_case_id AND txn_type = 'WAIVER'), 0),
    'written_off', COALESCE((SELECT -SUM(signed_amount) FROM public.bn_op_recovery_transaction
                              WHERE case_id = p_case_id AND txn_type = 'WRITEOFF'), 0),
    'reversals', COALESCE((SELECT SUM(signed_amount) FROM public.bn_op_recovery_transaction
                            WHERE case_id = p_case_id AND is_reversal), 0));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_calculate_liability_v1(p_case_id uuid, p_row_version integer, p_gross_amount numeric, p_currency text, p_method_code text, p_basis jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; n integer; v uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('calculate_liability');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['CANDIDATE','CALCULATED','REPRESENTATION']);
  PERFORM public._bn_op_assert_amount(p_gross_amount);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_CALCULATE_LIABILITY', p_case_id,
    jsonb_build_object('amount', p_gross_amount, 'method', p_method_code));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(MAX(version_no), 0) + 1 INTO n FROM public.bn_op_liability_version WHERE case_id = p_case_id;
  UPDATE public.bn_op_liability_version SET status = 'SUPERSEDED'
   WHERE case_id = p_case_id AND status = 'ACTIVE';
  INSERT INTO public.bn_op_liability_version(case_id, version_no, method_code, currency,
    gross_amount, basis, status, created_by)
  VALUES (p_case_id, n, COALESCE(p_method_code,'MANUAL'), c.currency, p_gross_amount,
    COALESCE(p_basis,'{}'::jsonb), 'ACTIVE', public._bn_op_actor())
  RETURNING id INTO v;
  UPDATE public.bn_op_case SET gross_liability = p_gross_amount WHERE id = p_case_id;
  PERFORM public._bn_op_touch_case(p_case_id, 'CALCULATED');
  PERFORM public._bn_op_event(p_case_id, 'LIABILITY_CALCULATED', 'BN_OVP_CALCULATE_LIABILITY', c.status, 'CALCULATED',
    jsonb_build_object('liability_id', v, 'version_no', n, 'amount', p_gross_amount));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_CALCULATE_LIABILITY', jsonb_build_object('liability_id', v, 'version_no', n)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_case_detail_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case;
BEGIN
  PERFORM public._bn_op_require_view();
  SELECT * INTO c FROM public.bn_op_case WHERE id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'case', to_jsonb(c),
    'outstanding_amount', public._bn_op_outstanding(p_case_id),
    'on_appeal_hold', EXISTS (SELECT 1 FROM public.bn_op_appeal_hold h WHERE h.case_id = p_case_id AND h.is_active),
    'recovery_suspended', EXISTS (SELECT 1 FROM public.bn_op_recovery_suspension s WHERE s.case_id = p_case_id AND s.is_active),
    'finance_pending', (SELECT count(*) FROM public.bn_op_finance_posting_intent f
                         WHERE f.case_id = p_case_id AND f.status = 'PENDING'),
    'finance_failed', (SELECT count(*) FROM public.bn_op_finance_posting_intent f
                        WHERE f.case_id = p_case_id AND f.status = 'FAILED'));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_close_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; outstanding numeric;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('close');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  outstanding := public._bn_op_outstanding(p_case_id);
  IF outstanding > 0 THEN RAISE EXCEPTION 'E_INVALID_STATE: outstanding balance remains'; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_CLOSE', p_case_id,
    jsonb_build_object('reason', p_reason));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_case
     SET status = 'CLOSED', closed_at = now(), closed_by = public._bn_op_actor(),
         row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_case_id;
  PERFORM public._bn_op_event(p_case_id, 'CASE_CLOSED', 'BN_OVP_CLOSE', c.status, 'CLOSED');
  RETURN public._bn_op_idem_finish(p_idempotency_key, public._bn_op_ok(p_case_id, 'BN_OVP_CLOSE'));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_communication_dispatch_svc_v1(p_intent_id uuid, p_dispatch_reference text, p_success boolean, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.bn_op_communication_intent
     SET status = CASE WHEN p_success THEN 'DISPATCHED' ELSE 'FAILED' END,
         dispatch_reference = p_dispatch_reference, last_error = p_error,
         row_version = row_version + 1
   WHERE id = p_intent_id;
  RETURN jsonb_build_object('ok', p_success, 'intent_id', p_intent_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_confirm_liability_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; maker text; amt numeric; txn uuid; fi uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('confirm_liability');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['VERIFIED','NOTICE_ISSUED','REPRESENTATION']);
  SELECT created_by, gross_amount INTO maker, amt FROM public.bn_op_liability_version
   WHERE case_id = p_case_id AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1;
  IF amt IS NULL THEN RAISE EXCEPTION 'E_INVALID_STATE: no active liability version'; END IF;
  PERFORM public._bn_op_deny_self_approval(maker, public._bn_op_actor());
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_CONFIRM_LIABILITY', p_case_id,
    jsonb_build_object('note', p_note, 'amount', amt));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  txn := public._bn_op_post_txn(p_case_id, 'LIABILITY', amt, 'BN_OVP_CONFIRM_LIABILITY');
  fi := public._bn_op_finance_intent(p_case_id, txn, 'DEBT_RAISED', c.currency, amt,
        'BN_OVP_CONFIRM_LIABILITY', p_idempotency_key || ':FIN');
  PERFORM public._bn_op_touch_case(p_case_id, 'LIABILITY_CONFIRMED');
  PERFORM public._bn_op_comm_intent(p_case_id, 'BN_OVP_LIABILITY_CONFIRMED',
    jsonb_build_object('case_reference', c.case_reference, 'amount', amt, 'currency', c.currency));
  PERFORM public._bn_op_event(p_case_id, 'LIABILITY_CONFIRMED', 'BN_OVP_CONFIRM_LIABILITY', c.status,
    'LIABILITY_CONFIRMED', jsonb_build_object('transaction_id', txn, 'finance_intent_id', fi));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_CONFIRM_LIABILITY',
      jsonb_build_object('transaction_id', txn, 'finance_intent_id', fi)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_create_candidate_v1(p_award_id uuid, p_reason_code text, p_period_from date, p_period_to date, p_currency text, p_detection_source text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cached jsonb; v uuid; ref text; a text;
BEGIN
  a := public._bn_op_actor();
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('create_candidate');
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_CREATE_CANDIDATE', NULL,
    jsonb_build_object('award', p_award_id, 'from', p_period_from, 'to', p_period_to, 'reason', p_reason_code));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  ref := 'OVP-' || to_char(now(), 'YYYY') || '-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 10);
  INSERT INTO public.bn_op_case(case_reference, bn_award_id, reason_code, period_from, period_to,
    currency, detection_source, status, created_by)
  VALUES (ref, p_award_id, p_reason_code, p_period_from, p_period_to,
    upper(COALESCE(p_currency,'XCD')), COALESCE(p_detection_source,'MANUAL'), 'CANDIDATE', a)
  RETURNING id INTO v;
  PERFORM public._bn_op_event(v, 'CASE_CREATED', 'BN_OVP_CREATE_CANDIDATE', NULL, 'CANDIDATE');
  RETURN public._bn_op_idem_finish(p_idempotency_key, public._bn_op_ok(v, 'BN_OVP_CREATE_CANDIDATE'));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_finance_post_intent_svc_v1(p_intent_id uuid, p_posting_reference text, p_success boolean, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i public.bn_op_finance_posting_intent;
BEGIN
  SELECT * INTO i FROM public.bn_op_finance_posting_intent WHERE id = p_intent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  IF i.status = 'POSTED' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'posting_reference', i.posting_reference);
  END IF;
  IF p_success THEN
    IF p_posting_reference IS NULL THEN RAISE EXCEPTION 'E_INVALID_STATE: posting reference required'; END IF;
    UPDATE public.bn_op_finance_posting_intent
       SET status = 'POSTED', posting_reference = p_posting_reference, posted_at = now(),
           attempt_count = attempt_count + 1, last_error = NULL, row_version = row_version + 1
     WHERE id = p_intent_id;
  ELSE
    UPDATE public.bn_op_finance_posting_intent
       SET status = 'FAILED', attempt_count = attempt_count + 1, last_error = p_error,
           row_version = row_version + 1
     WHERE id = p_intent_id;
  END IF;
  RETURN jsonb_build_object('ok', p_success, 'duplicate', false, 'intent_id', p_intent_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_issue_notice_v1(p_case_id uuid, p_row_version integer, p_recipient_ref text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; ci uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('issue_notice');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['VERIFIED']);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_ISSUE_NOTICE', p_case_id,
    jsonb_build_object('recipient', p_recipient_ref));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  ci := public._bn_op_comm_intent(p_case_id, 'BN_OVP_NOTICE_ISSUED',
    jsonb_build_object('case_reference', c.case_reference, 'currency', c.currency,
                       'gross_liability', c.gross_liability, 'recipient_ref', p_recipient_ref));
  PERFORM public._bn_op_touch_case(p_case_id, 'NOTICE_ISSUED');
  PERFORM public._bn_op_event(p_case_id, 'NOTICE_ISSUED', 'BN_OVP_ISSUE_NOTICE', c.status, 'NOTICE_ISSUED',
    jsonb_build_object('communication_intent_id', ci));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_ISSUE_NOTICE', jsonb_build_object('communication_intent_id', ci)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_liability_versions_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(l) ORDER BY l.version_no)
      FROM public.bn_op_liability_version l WHERE l.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_place_appeal_hold_v1(p_case_id uuid, p_row_version integer, p_appeal_reference text, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('place_appeal_hold');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  IF EXISTS (SELECT 1 FROM public.bn_op_appeal_hold WHERE case_id = p_case_id AND is_active) THEN
    RAISE EXCEPTION 'E_INVALID_STATE: hold already active';
  END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_PLACE_APPEAL_HOLD', p_case_id,
    jsonb_build_object('appeal', p_appeal_reference, 'reason', p_reason));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  INSERT INTO public.bn_op_appeal_hold(case_id, appeal_reference, reason, placed_by, created_by)
  VALUES (p_case_id, p_appeal_reference, COALESCE(p_reason,'APPEAL_LODGED'),
    public._bn_op_actor(), public._bn_op_actor())
  RETURNING id INTO v;
  PERFORM public._bn_op_touch_case(p_case_id, 'ON_APPEAL_HOLD');
  PERFORM public._bn_op_event(p_case_id, 'APPEAL_HOLD_PLACED', 'BN_OVP_PLACE_APPEAL_HOLD', c.status,
    'ON_APPEAL_HOLD', jsonb_build_object('hold_id', v));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_PLACE_APPEAL_HOLD', jsonb_build_object('hold_id', v)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_propose_recovery_plan_v1(p_case_id uuid, p_row_version integer, p_total_amount numeric, p_instalment_amount numeric, p_frequency_code text, p_method_code text, p_start_date date, p_currency text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; n integer; v uuid; i integer; remaining numeric; amt numeric; d date;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('propose_recovery_plan');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  PERFORM public._bn_op_assert_not_suspended(p_case_id);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['LIABILITY_CONFIRMED','PLAN_PROPOSED','IN_RECOVERY']);
  PERFORM public._bn_op_assert_amount(p_total_amount);
  PERFORM public._bn_op_assert_amount(p_instalment_amount);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_PROPOSE_RECOVERY_PLAN', p_case_id,
    jsonb_build_object('total', p_total_amount, 'inst', p_instalment_amount, 'freq', p_frequency_code));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(MAX(plan_no), 0) + 1 INTO n FROM public.bn_op_recovery_plan WHERE case_id = p_case_id;
  INSERT INTO public.bn_op_recovery_plan(case_id, plan_no, method_code, currency, total_amount,
    instalment_amount, frequency_code, start_date, proposed_by, created_by)
  VALUES (p_case_id, n, COALESCE(p_method_code,'BENEFIT_DEDUCTION'), c.currency, p_total_amount,
    p_instalment_amount, COALESCE(p_frequency_code,'MONTHLY'), COALESCE(p_start_date, CURRENT_DATE),
    public._bn_op_actor(), public._bn_op_actor())
  RETURNING id INTO v;
  remaining := p_total_amount; i := 0; d := COALESCE(p_start_date, CURRENT_DATE);
  WHILE remaining > 0 AND i < 600 LOOP
    i := i + 1;
    amt := LEAST(p_instalment_amount, remaining);
    INSERT INTO public.bn_op_recovery_plan_instalment(plan_id, case_id, sequence_no, due_date,
      currency, amount, created_by)
    VALUES (v, p_case_id, i, d, c.currency, amt, public._bn_op_actor());
    remaining := remaining - amt;
    d := d + INTERVAL '1 month';
  END LOOP;
  PERFORM public._bn_op_touch_case(p_case_id, 'PLAN_PROPOSED');
  PERFORM public._bn_op_event(p_case_id, 'PLAN_PROPOSED', 'BN_OVP_PROPOSE_RECOVERY_PLAN', c.status,
    'PLAN_PROPOSED', jsonb_build_object('plan_id', v, 'instalments', i));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_PROPOSE_RECOVERY_PLAN',
      jsonb_build_object('plan_id', v, 'instalments', i)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_reconcile_v1(p_case_id uuid, p_finance_balance numeric, p_currency text, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid; mb numeric; var numeric; st text; pending integer;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('reconcile');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_RECONCILE', p_case_id,
    jsonb_build_object('finance', p_finance_balance));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  mb := public._bn_op_outstanding(p_case_id);
  var := COALESCE(p_finance_balance, 0) - mb;
  SELECT count(*) INTO pending FROM public.bn_op_finance_posting_intent
   WHERE case_id = p_case_id AND status IN ('PENDING','FAILED');
  st := CASE WHEN pending > 0 THEN 'FAILED' WHEN var = 0 THEN 'MATCHED' ELSE 'VARIANCE' END;
  INSERT INTO public.bn_op_reconciliation(case_id, currency, module_balance, finance_balance, variance,
    status, note, reconciled_by, reconciled_at, created_by)
  VALUES (p_case_id, c.currency, mb, p_finance_balance, var, st, p_note,
    public._bn_op_actor(), now(), public._bn_op_actor())
  RETURNING id INTO v;
  IF st = 'MATCHED' THEN PERFORM public._bn_op_touch_case(p_case_id, 'RECONCILED'); END IF;
  PERFORM public._bn_op_event(p_case_id, 'RECONCILED', 'BN_OVP_RECONCILE', c.status, st,
    jsonb_build_object('reconciliation_id', v, 'variance', var, 'pending_finance_intents', pending));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_RECONCILE',
      jsonb_build_object('reconciliation_id', v, 'status', st, 'variance', var)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_reconciliations_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true,
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at)
      FROM public.bn_op_reconciliation r WHERE r.case_id = p_case_id), '[]'::jsonb),
    'finance_intents', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at)
      FROM public.bn_op_finance_posting_intent f WHERE f.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_record_receipt_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_source_reference text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; txn uuid; fi uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('record_receipt');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_not_suspended(p_case_id);
  PERFORM public._bn_op_assert_state(c.status,
    ARRAY['LIABILITY_CONFIRMED','PLAN_PROPOSED','PLAN_APPROVED','IN_RECOVERY','ON_APPEAL_HOLD']);
  PERFORM public._bn_op_assert_amount(p_amount);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_RECORD_RECEIPT', p_case_id,
    jsonb_build_object('amount', p_amount, 'ref', p_source_reference));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  txn := public._bn_op_post_txn(p_case_id, 'RECEIPT', -p_amount, 'BN_OVP_RECORD_RECEIPT', p_source_reference);
  fi := public._bn_op_finance_intent(p_case_id, txn, 'RECEIPT', c.currency, -p_amount,
        'BN_OVP_RECORD_RECEIPT', p_idempotency_key || ':FIN');
  PERFORM public._bn_op_event(p_case_id, 'RECEIPT_RECORDED', 'BN_OVP_RECORD_RECEIPT', c.status, c.status,
    jsonb_build_object('transaction_id', txn, 'amount', p_amount, 'finance_intent_id', fi));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_RECORD_RECEIPT',
      jsonb_build_object('transaction_id', txn, 'finance_intent_id', fi)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_record_representation_v1(p_case_id uuid, p_row_version integer, p_summary text, p_channel text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('record_representation');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['NOTICE_ISSUED','REPRESENTATION']);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_RECORD_REPRESENTATION', p_case_id,
    jsonb_build_object('summary', p_summary));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  INSERT INTO public.bn_op_representation(case_id, summary, channel, created_by)
  VALUES (p_case_id, p_summary, COALESCE(p_channel,'WRITTEN'), public._bn_op_actor())
  RETURNING id INTO v;
  PERFORM public._bn_op_touch_case(p_case_id, 'REPRESENTATION');
  PERFORM public._bn_op_event(p_case_id, 'REPRESENTATION_RECORDED', 'BN_OVP_RECORD_REPRESENTATION',
    c.status, 'REPRESENTATION', jsonb_build_object('representation_id', v));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_RECORD_REPRESENTATION', jsonb_build_object('representation_id', v)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_recovery_plans_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('instalments', COALESCE((
             SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sequence_no)
               FROM public.bn_op_recovery_plan_instalment i WHERE i.plan_id = p.id), '[]'::jsonb))
             ORDER BY p.plan_no)
      FROM public.bn_op_recovery_plan p WHERE p.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_refer_estate_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_deceased_reference text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid; existing public.bn_op_estate_referral;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('refer_estate');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_amount(p_amount);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REFER_ESTATE', p_case_id,
    jsonb_build_object('amount', p_amount, 'deceased', p_deceased_reference));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO existing FROM public.bn_op_estate_referral WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN v := existing.id;
  ELSE
    INSERT INTO public.bn_op_estate_referral(case_id, referral_reference, currency, referred_amount,
      deceased_reference, idempotency_key, referred_by, created_by)
    VALUES (p_case_id, 'EST-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
      c.currency, p_amount, p_deceased_reference, p_idempotency_key,
      public._bn_op_actor(), public._bn_op_actor())
    RETURNING id INTO v;
  END IF;
  PERFORM public._bn_op_event(p_case_id, 'ESTATE_REFERRED', 'BN_OVP_REFER_ESTATE', c.status, c.status,
    jsonb_build_object('referral_id', v));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REFER_ESTATE', jsonb_build_object('referral_id', v)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_refer_legal_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_external_case_ref text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid; existing public.bn_op_legal_referral;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('refer_legal');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  PERFORM public._bn_op_assert_amount(p_amount);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REFER_LEGAL', p_case_id,
    jsonb_build_object('amount', p_amount));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO existing FROM public.bn_op_legal_referral WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN v := existing.id;
  ELSE
    INSERT INTO public.bn_op_legal_referral(case_id, referral_reference, external_case_ref, currency,
      referred_amount, idempotency_key, referred_by, created_by)
    VALUES (p_case_id, 'LGL-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
      p_external_case_ref, c.currency, p_amount, p_idempotency_key,
      public._bn_op_actor(), public._bn_op_actor())
    RETURNING id INTO v;
  END IF;
  PERFORM public._bn_op_event(p_case_id, 'LEGAL_REFERRED', 'BN_OVP_REFER_LEGAL', c.status, c.status,
    jsonb_build_object('referral_id', v));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REFER_LEGAL', jsonb_build_object('referral_id', v)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_referrals_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true,
    'legal', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.referred_at)
      FROM public.bn_op_legal_referral l WHERE l.case_id = p_case_id), '[]'::jsonb),
    'estate', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.referred_at)
      FROM public.bn_op_estate_referral e WHERE e.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_reject_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; p public.bn_op_recovery_plan; cached jsonb;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('approve_recovery_plan');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  SELECT * INTO p FROM public.bn_op_recovery_plan WHERE id = p_plan_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(p.row_version, p_plan_row_version);
  PERFORM public._bn_op_assert_state(p.status, ARRAY['PROPOSED','REVISED']);
  PERFORM public._bn_op_deny_self_approval(p.proposed_by, public._bn_op_actor());
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REJECT_RECOVERY_PLAN', p_case_id,
    jsonb_build_object('plan', p_plan_id, 'reason', p_reason));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_recovery_plan
     SET status = 'REJECTED', rejected_by = public._bn_op_actor(), rejected_at = now(),
         rejection_reason = p_reason, row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_plan_id;
  PERFORM public._bn_op_touch_case(p_case_id, 'LIABILITY_CONFIRMED');
  PERFORM public._bn_op_event(p_case_id, 'PLAN_REJECTED', 'BN_OVP_REJECT_RECOVERY_PLAN', c.status,
    'LIABILITY_CONFIRMED', jsonb_build_object('plan_id', p_plan_id));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REJECT_RECOVERY_PLAN', jsonb_build_object('plan_id', p_plan_id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_reject_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; w public.bn_op_waiver_request; cached jsonb;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('approve_waiver');
  c := public._bn_op_require_case(p_case_id);
  SELECT * INTO w FROM public.bn_op_waiver_request WHERE id = p_waiver_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(w.row_version, p_row_version);
  PERFORM public._bn_op_assert_state(w.status, ARRAY['REQUESTED']);
  PERFORM public._bn_op_deny_self_approval(w.requested_by, public._bn_op_actor());
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REJECT_WAIVER', p_case_id,
    jsonb_build_object('waiver', p_waiver_id, 'note', p_note));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_waiver_request
     SET status = 'REJECTED', decided_by = public._bn_op_actor(), decided_at = now(),
         decision_note = p_note, row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_waiver_id;
  PERFORM public._bn_op_event(p_case_id, 'WAIVER_REJECTED', 'BN_OVP_REJECT_WAIVER', c.status, c.status,
    jsonb_build_object('waiver_id', p_waiver_id));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REJECT_WAIVER', jsonb_build_object('waiver_id', p_waiver_id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_reject_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; w public.bn_op_writeoff_request; cached jsonb;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('approve_writeoff');
  c := public._bn_op_require_case(p_case_id);
  SELECT * INTO w FROM public.bn_op_writeoff_request WHERE id = p_writeoff_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(w.row_version, p_row_version);
  PERFORM public._bn_op_assert_state(w.status, ARRAY['REQUESTED']);
  PERFORM public._bn_op_deny_self_approval(w.requested_by, public._bn_op_actor());
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REJECT_WRITEOFF', p_case_id,
    jsonb_build_object('writeoff', p_writeoff_id, 'note', p_note));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_writeoff_request
     SET status = 'REJECTED', decided_by = public._bn_op_actor(), decided_at = now(),
         decision_note = p_note, row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_writeoff_id;
  PERFORM public._bn_op_event(p_case_id, 'WRITEOFF_REJECTED', 'BN_OVP_REJECT_WRITEOFF', c.status, c.status,
    jsonb_build_object('writeoff_id', p_writeoff_id));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REJECT_WRITEOFF', jsonb_build_object('writeoff_id', p_writeoff_id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_release_appeal_hold_v1(p_case_id uuid, p_hold_id uuid, p_row_version integer, p_appeal_outcome text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; h public.bn_op_appeal_hold; cached jsonb; nxt text;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('release_appeal_hold');
  c := public._bn_op_require_case(p_case_id);
  SELECT * INTO h FROM public.bn_op_appeal_hold WHERE id = p_hold_id AND case_id = p_case_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(h.row_version, p_row_version);
  IF p_appeal_outcome IS NULL OR p_appeal_outcome NOT IN ('DISMISSED','ALLOWED','WITHDRAWN','PARTIALLY_ALLOWED') THEN
    RAISE EXCEPTION 'E_INVALID_STATE: appeal outcome required';
  END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_RELEASE_APPEAL_HOLD', p_case_id,
    jsonb_build_object('hold', p_hold_id, 'outcome', p_appeal_outcome));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_appeal_hold
     SET is_active = false, released_by = public._bn_op_actor(), released_at = now(),
         release_outcome = p_appeal_outcome, row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_hold_id;
  nxt := CASE WHEN EXISTS (SELECT 1 FROM public.bn_op_deduction_instruction
                           WHERE case_id = p_case_id AND status = 'ACTIVE')
              THEN 'IN_RECOVERY' ELSE 'LIABILITY_CONFIRMED' END;
  PERFORM public._bn_op_touch_case(p_case_id, nxt);
  PERFORM public._bn_op_event(p_case_id, 'APPEAL_HOLD_RELEASED', 'BN_OVP_RELEASE_APPEAL_HOLD',
    'ON_APPEAL_HOLD', nxt, jsonb_build_object('hold_id', p_hold_id, 'outcome', p_appeal_outcome));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_RELEASE_APPEAL_HOLD', jsonb_build_object('hold_id', p_hold_id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_reopen_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('reopen');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['CLOSED']);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REOPEN', p_case_id,
    jsonb_build_object('reason', p_reason));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_case
     SET status = 'LIABILITY_CONFIRMED', closed_at = NULL, closed_by = NULL,
         row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_case_id;
  PERFORM public._bn_op_event(p_case_id, 'CASE_REOPENED', 'BN_OVP_REOPEN', 'CLOSED', 'LIABILITY_CONFIRMED',
    jsonb_build_object('reason', p_reason));
  RETURN public._bn_op_idem_finish(p_idempotency_key, public._bn_op_ok(p_case_id, 'BN_OVP_REOPEN'));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_request_waiver_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid; outstanding numeric; amt numeric;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('request_waiver');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  outstanding := public._bn_op_outstanding(p_case_id);
  amt := CASE WHEN COALESCE(p_is_full,false) THEN outstanding ELSE p_amount END;
  PERFORM public._bn_op_assert_amount(amt);
  IF amt > outstanding THEN RAISE EXCEPTION 'E_AMOUNT_INVALID: waiver exceeds outstanding'; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REQUEST_WAIVER', p_case_id,
    jsonb_build_object('amount', amt, 'ground', p_ground_code));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  INSERT INTO public.bn_op_waiver_request(case_id, currency, requested_amount, is_full, ground_code,
    justification, requested_by, created_by)
  VALUES (p_case_id, c.currency, amt, COALESCE(p_is_full,false), p_ground_code, p_justification,
    public._bn_op_actor(), public._bn_op_actor())
  RETURNING id INTO v;
  PERFORM public._bn_op_event(p_case_id, 'WAIVER_REQUESTED', 'BN_OVP_REQUEST_WAIVER', c.status, c.status,
    jsonb_build_object('waiver_id', v, 'amount', amt));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REQUEST_WAIVER', jsonb_build_object('waiver_id', v, 'amount', amt)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_request_writeoff_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid; outstanding numeric; amt numeric;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('request_writeoff');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_currency(c, p_currency);
  outstanding := public._bn_op_outstanding(p_case_id);
  amt := CASE WHEN COALESCE(p_is_full,false) THEN outstanding ELSE p_amount END;
  PERFORM public._bn_op_assert_amount(amt);
  IF amt > outstanding THEN RAISE EXCEPTION 'E_AMOUNT_INVALID: write-off exceeds outstanding'; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REQUEST_WRITEOFF', p_case_id,
    jsonb_build_object('amount', amt, 'ground', p_ground_code));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  INSERT INTO public.bn_op_writeoff_request(case_id, currency, requested_amount, is_full, ground_code,
    justification, requested_by, created_by)
  VALUES (p_case_id, c.currency, amt, COALESCE(p_is_full,false), p_ground_code, p_justification,
    public._bn_op_actor(), public._bn_op_actor())
  RETURNING id INTO v;
  PERFORM public._bn_op_event(p_case_id, 'WRITEOFF_REQUESTED', 'BN_OVP_REQUEST_WRITEOFF', c.status, c.status,
    jsonb_build_object('writeoff_id', v, 'amount', amt));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REQUEST_WRITEOFF', jsonb_build_object('writeoff_id', v, 'amount', amt)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_resume_recovery_v1(p_case_id uuid, p_suspension_id uuid, p_row_version integer, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; s public.bn_op_recovery_suspension; cached jsonb; nxt text;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('resume_recovery');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_no_hold(p_case_id);
  SELECT * INTO s FROM public.bn_op_recovery_suspension
   WHERE id = p_suspension_id AND case_id = p_case_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(s.row_version, p_row_version);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_RESUME_RECOVERY', p_case_id,
    jsonb_build_object('suspension', p_suspension_id));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_recovery_suspension
     SET is_active = false, resumed_by = public._bn_op_actor(), resumed_at = now(),
         row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_suspension_id;
  UPDATE public.bn_op_deduction_instruction SET status = 'ACTIVE', row_version = row_version + 1
   WHERE case_id = p_case_id AND status = 'SUSPENDED';
  nxt := CASE WHEN EXISTS (SELECT 1 FROM public.bn_op_deduction_instruction
                           WHERE case_id = p_case_id AND status = 'ACTIVE')
              THEN 'IN_RECOVERY' ELSE 'LIABILITY_CONFIRMED' END;
  PERFORM public._bn_op_touch_case(p_case_id, nxt);
  PERFORM public._bn_op_event(p_case_id, 'RECOVERY_RESUMED', 'BN_OVP_RESUME_RECOVERY', 'SUSPENDED', nxt,
    jsonb_build_object('suspension_id', p_suspension_id));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_RESUME_RECOVERY', jsonb_build_object('suspension_id', p_suspension_id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_reverse_transaction_v1(p_case_id uuid, p_transaction_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; t public.bn_op_recovery_transaction; cached jsonb;
        reversed numeric; amt numeric; txn uuid; fi uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('reverse_transaction');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  SELECT * INTO t FROM public.bn_op_recovery_transaction WHERE id = p_transaction_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  IF t.is_reversal THEN RAISE EXCEPTION 'E_INVALID_STATE: cannot reverse a reversal'; END IF;
  PERFORM public._bn_op_assert_currency(c, p_currency);
  IF p_currency IS NOT NULL AND upper(p_currency) <> t.currency THEN RAISE EXCEPTION 'E_CURRENCY_MISMATCH'; END IF;
  SELECT COALESCE(SUM(abs(signed_amount)), 0) INTO reversed
    FROM public.bn_op_recovery_transaction WHERE reverses_transaction_id = p_transaction_id;
  amt := COALESCE(p_amount, abs(t.signed_amount) - reversed);
  PERFORM public._bn_op_assert_amount(amt);
  IF reversed >= abs(t.signed_amount) THEN RAISE EXCEPTION 'E_OVER_REVERSAL: already fully reversed'; END IF;
  IF reversed + amt > abs(t.signed_amount) THEN RAISE EXCEPTION 'E_OVER_REVERSAL'; END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REVERSE_TRANSACTION', p_case_id,
    jsonb_build_object('txn', p_transaction_id, 'amount', amt));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  txn := public._bn_op_post_txn(p_case_id, 'REVERSAL', (CASE WHEN t.signed_amount < 0 THEN amt ELSE -amt END),
         'BN_OVP_REVERSE_TRANSACTION', p_reason, p_transaction_id);
  fi := public._bn_op_finance_intent(p_case_id, txn, 'REVERSAL', c.currency,
        (CASE WHEN t.signed_amount < 0 THEN amt ELSE -amt END),
        'BN_OVP_REVERSE_TRANSACTION', p_idempotency_key || ':FIN');
  PERFORM public._bn_op_event(p_case_id, 'TRANSACTION_REVERSED', 'BN_OVP_REVERSE_TRANSACTION', c.status, c.status,
    jsonb_build_object('reversal_transaction_id', txn, 'original_transaction_id', p_transaction_id, 'amount', amt));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REVERSE_TRANSACTION',
      jsonb_build_object('reversal_transaction_id', txn, 'amount', amt)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_revise_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_instalment_amount numeric, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; p public.bn_op_recovery_plan; cached jsonb;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('propose_recovery_plan');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_not_suspended(p_case_id);
  SELECT * INTO p FROM public.bn_op_recovery_plan WHERE id = p_plan_id AND case_id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_SCOPE'; END IF;
  PERFORM public._bn_op_check_version(p.row_version, p_plan_row_version);
  PERFORM public._bn_op_assert_state(p.status, ARRAY['PROPOSED','REJECTED','REVISED']);
  PERFORM public._bn_op_assert_amount(p_instalment_amount);
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_REVISE_RECOVERY_PLAN', p_case_id,
    jsonb_build_object('plan', p_plan_id, 'inst', p_instalment_amount));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  UPDATE public.bn_op_recovery_plan
     SET status = 'REVISED', instalment_amount = p_instalment_amount,
         proposed_by = public._bn_op_actor(), row_version = row_version + 1, updated_by = public._bn_op_actor()
   WHERE id = p_plan_id;
  PERFORM public._bn_op_touch_case(p_case_id, 'PLAN_PROPOSED');
  PERFORM public._bn_op_event(p_case_id, 'PLAN_REVISED', 'BN_OVP_REVISE_RECOVERY_PLAN', c.status,
    'PLAN_PROPOSED', jsonb_build_object('plan_id', p_plan_id));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_REVISE_RECOVERY_PLAN', jsonb_build_object('plan_id', p_plan_id)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_suspend_recovery_v1(p_case_id uuid, p_row_version integer, p_reason_code text, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; v uuid;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('suspend_recovery');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  IF EXISTS (SELECT 1 FROM public.bn_op_recovery_suspension WHERE case_id = p_case_id AND is_active) THEN
    RAISE EXCEPTION 'E_INVALID_STATE: suspension already active';
  END IF;
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_SUSPEND_RECOVERY', p_case_id,
    jsonb_build_object('reason_code', p_reason_code));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  INSERT INTO public.bn_op_recovery_suspension(case_id, reason_code, reason, suspended_by, created_by)
  VALUES (p_case_id, COALESCE(p_reason_code,'HARDSHIP'), p_reason, public._bn_op_actor(), public._bn_op_actor())
  RETURNING id INTO v;
  UPDATE public.bn_op_deduction_instruction SET status = 'SUSPENDED', row_version = row_version + 1
   WHERE case_id = p_case_id AND status = 'ACTIVE';
  PERFORM public._bn_op_touch_case(p_case_id, 'SUSPENDED');
  PERFORM public._bn_op_event(p_case_id, 'RECOVERY_SUSPENDED', 'BN_OVP_SUSPEND_RECOVERY', c.status,
    'SUSPENDED', jsonb_build_object('suspension_id', v));
  RETURN public._bn_op_idem_finish(p_idempotency_key,
    public._bn_op_ok(p_case_id, 'BN_OVP_SUSPEND_RECOVERY', jsonb_build_object('suspension_id', v)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_timeline_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at)
      FROM public.bn_op_event e WHERE e.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_transactions_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_permission('view_financial_detail');
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.txn_no)
      FROM public.bn_op_recovery_transaction t WHERE t.case_id = p_case_id), '[]'::jsonb),
    'allocations', COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.allocated_at)
      FROM public.bn_op_receipt_allocation a WHERE a.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_verify_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.bn_op_case; cached jsonb; maker text;
BEGIN
  PERFORM public._bn_op_assert_actions_enabled();
  PERFORM public._bn_op_require_permission('verify');
  c := public._bn_op_require_case(p_case_id);
  PERFORM public._bn_op_check_version(c.row_version, p_row_version);
  PERFORM public._bn_op_assert_open(c);
  PERFORM public._bn_op_assert_state(c.status, ARRAY['CALCULATED']);
  SELECT created_by INTO maker FROM public.bn_op_liability_version
   WHERE case_id = p_case_id AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1;
  PERFORM public._bn_op_deny_self_approval(maker, public._bn_op_actor());
  cached := public._bn_op_idem_begin(p_idempotency_key, 'BN_OVP_VERIFY', p_case_id, jsonb_build_object('note', p_note));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM public._bn_op_touch_case(p_case_id, 'VERIFIED');
  PERFORM public._bn_op_event(p_case_id, 'CASE_VERIFIED', 'BN_OVP_VERIFY', c.status, 'VERIFIED');
  RETURN public._bn_op_idem_finish(p_idempotency_key, public._bn_op_ok(p_case_id, 'BN_OVP_VERIFY'));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_waiver_requests_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(w) ORDER BY w.requested_at)
      FROM public.bn_op_waiver_request w WHERE w.case_id = p_case_id), '[]'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_worklist_v1(p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rows jsonb; total integer;
BEGIN
  PERFORM public._bn_op_require_view();
  SELECT count(*) INTO total FROM public.bn_op_case c
   WHERE (p_status IS NULL OR c.status = p_status)
     AND (p_search IS NULL OR c.case_reference ILIKE '%' || p_search || '%');
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO rows
    FROM (
      SELECT c.id, c.case_reference, c.status, c.currency, c.gross_liability,
             c.outstanding_amount, c.bn_award_id, c.row_version, c.created_at,
             EXISTS (SELECT 1 FROM public.bn_op_appeal_hold h WHERE h.case_id = c.id AND h.is_active) AS on_appeal_hold,
             EXISTS (SELECT 1 FROM public.bn_op_recovery_suspension s WHERE s.case_id = c.id AND s.is_active) AS recovery_suspended
        FROM public.bn_op_case c
       WHERE (p_status IS NULL OR c.status = p_status)
         AND (p_search IS NULL OR c.case_reference ILIKE '%' || p_search || '%')
       ORDER BY c.created_at DESC
       LIMIT GREATEST(COALESCE(p_limit,50),1) OFFSET GREATEST(COALESCE(p_offset,0),0)
    ) t;
  RETURN jsonb_build_object('ok', true, 'total', total, 'rows', rows);
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_overpayment_writeoff_requests_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._bn_op_require_view();
  RETURN jsonb_build_object('ok', true, 'rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(w) ORDER BY w.requested_at)
      FROM public.bn_op_writeoff_request w WHERE w.case_id = p_case_id), '[]'::jsonb));
END; $function$;

REVOKE ALL ON FUNCTION public._bn_op_actor() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_actor_uid() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_assert_actions_enabled() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_assert_amount(p_amount numeric) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_assert_currency(p_case bn_op_case, p_currency text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_assert_no_hold(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_assert_not_suspended(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_assert_open(p_case bn_op_case) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_assert_state(p_actual text, p_allowed text[]) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_block_mutation() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_check_version(p_actual integer, p_expected integer) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_comm_intent(p_case_id uuid, p_event_code text, p_context jsonb) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_deny_self_approval(p_maker text, p_checker text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_event(p_case_id uuid, p_event text, p_command text, p_from text, p_to text, p_detail jsonb) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_finance_intent(p_case_id uuid, p_txn_id uuid, p_type text, p_currency text, p_signed_amount numeric, p_command text, p_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_idem_begin(p_key text, p_command text, p_case_id uuid, p_payload jsonb) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_idem_finish(p_key text, p_result jsonb) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_ok(p_case_id uuid, p_command text, p_data jsonb) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_outstanding(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_post_txn(p_case_id uuid, p_type text, p_signed numeric, p_command text, p_reference text, p_reverses uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_require_case(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_require_permission(p_action text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_require_view() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_touch() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public._bn_op_touch_case(p_case_id uuid, p_status text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_activate_benefit_deduction_v1(p_case_id uuid, p_plan_id uuid, p_row_version integer, p_amount_per_cycle numeric, p_currency text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_allocate_receipt_v1(p_case_id uuid, p_transaction_id uuid, p_instalment_id uuid, p_amount numeric, p_currency text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_appeal_holds_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_approve_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_approve_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_approve_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_audit_history_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_available_actions_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_balance_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_calculate_liability_v1(p_case_id uuid, p_row_version integer, p_gross_amount numeric, p_currency text, p_method_code text, p_basis jsonb, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_case_detail_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_close_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_communication_dispatch_svc_v1(p_intent_id uuid, p_dispatch_reference text, p_success boolean, p_error text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_confirm_liability_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_create_candidate_v1(p_award_id uuid, p_reason_code text, p_period_from date, p_period_to date, p_currency text, p_detection_source text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_finance_post_intent_svc_v1(p_intent_id uuid, p_posting_reference text, p_success boolean, p_error text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_issue_notice_v1(p_case_id uuid, p_row_version integer, p_recipient_ref text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_liability_versions_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_place_appeal_hold_v1(p_case_id uuid, p_row_version integer, p_appeal_reference text, p_reason text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_propose_recovery_plan_v1(p_case_id uuid, p_row_version integer, p_total_amount numeric, p_instalment_amount numeric, p_frequency_code text, p_method_code text, p_start_date date, p_currency text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_reconcile_v1(p_case_id uuid, p_finance_balance numeric, p_currency text, p_note text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_reconciliations_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_record_receipt_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_source_reference text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_record_representation_v1(p_case_id uuid, p_row_version integer, p_summary text, p_channel text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_recovery_plans_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_refer_estate_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_deceased_reference text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_refer_legal_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_external_case_ref text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_referrals_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_reject_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_reason text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_reject_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_reject_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_release_appeal_hold_v1(p_case_id uuid, p_hold_id uuid, p_row_version integer, p_appeal_outcome text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_reopen_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_request_waiver_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_request_writeoff_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_resume_recovery_v1(p_case_id uuid, p_suspension_id uuid, p_row_version integer, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_reverse_transaction_v1(p_case_id uuid, p_transaction_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_revise_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_instalment_amount numeric, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_suspend_recovery_v1(p_case_id uuid, p_row_version integer, p_reason_code text, p_reason text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_timeline_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_transactions_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_verify_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_waiver_requests_v1(p_case_id uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_worklist_v1(p_status text, p_search text, p_limit integer, p_offset integer) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.bn_overpayment_writeoff_requests_v1(p_case_id uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._bn_op_actor() TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_actor_uid() TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_assert_actions_enabled() TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_assert_amount(p_amount numeric) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_assert_currency(p_case bn_op_case, p_currency text) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_assert_no_hold(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_assert_not_suspended(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_assert_open(p_case bn_op_case) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_assert_state(p_actual text, p_allowed text[]) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_block_mutation() TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_check_version(p_actual integer, p_expected integer) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_comm_intent(p_case_id uuid, p_event_code text, p_context jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_deny_self_approval(p_maker text, p_checker text) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_event(p_case_id uuid, p_event text, p_command text, p_from text, p_to text, p_detail jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_finance_intent(p_case_id uuid, p_txn_id uuid, p_type text, p_currency text, p_signed_amount numeric, p_command text, p_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_idem_begin(p_key text, p_command text, p_case_id uuid, p_payload jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_idem_finish(p_key text, p_result jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_ok(p_case_id uuid, p_command text, p_data jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_outstanding(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_post_txn(p_case_id uuid, p_type text, p_signed numeric, p_command text, p_reference text, p_reverses uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_require_case(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_require_permission(p_action text) TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_require_view() TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_touch() TO service_role;

GRANT EXECUTE ON FUNCTION public._bn_op_touch_case(p_case_id uuid, p_status text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_activate_benefit_deduction_v1(p_case_id uuid, p_plan_id uuid, p_row_version integer, p_amount_per_cycle numeric, p_currency text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_activate_benefit_deduction_v1(p_case_id uuid, p_plan_id uuid, p_row_version integer, p_amount_per_cycle numeric, p_currency text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_allocate_receipt_v1(p_case_id uuid, p_transaction_id uuid, p_instalment_id uuid, p_amount numeric, p_currency text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_allocate_receipt_v1(p_case_id uuid, p_transaction_id uuid, p_instalment_id uuid, p_amount numeric, p_currency text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_appeal_holds_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_appeal_holds_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_approve_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_approve_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_approve_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_approve_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_approve_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_approve_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_audit_history_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_audit_history_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_available_actions_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_available_actions_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_balance_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_balance_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_calculate_liability_v1(p_case_id uuid, p_row_version integer, p_gross_amount numeric, p_currency text, p_method_code text, p_basis jsonb, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_calculate_liability_v1(p_case_id uuid, p_row_version integer, p_gross_amount numeric, p_currency text, p_method_code text, p_basis jsonb, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_case_detail_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_case_detail_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_close_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_close_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_communication_dispatch_svc_v1(p_intent_id uuid, p_dispatch_reference text, p_success boolean, p_error text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_confirm_liability_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_confirm_liability_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_create_candidate_v1(p_award_id uuid, p_reason_code text, p_period_from date, p_period_to date, p_currency text, p_detection_source text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_create_candidate_v1(p_award_id uuid, p_reason_code text, p_period_from date, p_period_to date, p_currency text, p_detection_source text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_finance_post_intent_svc_v1(p_intent_id uuid, p_posting_reference text, p_success boolean, p_error text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_issue_notice_v1(p_case_id uuid, p_row_version integer, p_recipient_ref text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_issue_notice_v1(p_case_id uuid, p_row_version integer, p_recipient_ref text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_liability_versions_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_liability_versions_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_place_appeal_hold_v1(p_case_id uuid, p_row_version integer, p_appeal_reference text, p_reason text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_place_appeal_hold_v1(p_case_id uuid, p_row_version integer, p_appeal_reference text, p_reason text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_propose_recovery_plan_v1(p_case_id uuid, p_row_version integer, p_total_amount numeric, p_instalment_amount numeric, p_frequency_code text, p_method_code text, p_start_date date, p_currency text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_propose_recovery_plan_v1(p_case_id uuid, p_row_version integer, p_total_amount numeric, p_instalment_amount numeric, p_frequency_code text, p_method_code text, p_start_date date, p_currency text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reconcile_v1(p_case_id uuid, p_finance_balance numeric, p_currency text, p_note text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reconcile_v1(p_case_id uuid, p_finance_balance numeric, p_currency text, p_note text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reconciliations_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reconciliations_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_record_receipt_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_source_reference text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_record_receipt_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_source_reference text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_record_representation_v1(p_case_id uuid, p_row_version integer, p_summary text, p_channel text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_record_representation_v1(p_case_id uuid, p_row_version integer, p_summary text, p_channel text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_recovery_plans_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_recovery_plans_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_refer_estate_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_deceased_reference text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_refer_estate_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_deceased_reference text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_refer_legal_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_external_case_ref text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_refer_legal_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_currency text, p_external_case_ref text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_referrals_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_referrals_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reject_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_reason text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reject_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_reason text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reject_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reject_waiver_v1(p_case_id uuid, p_waiver_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reject_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reject_writeoff_v1(p_case_id uuid, p_writeoff_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_release_appeal_hold_v1(p_case_id uuid, p_hold_id uuid, p_row_version integer, p_appeal_outcome text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_release_appeal_hold_v1(p_case_id uuid, p_hold_id uuid, p_row_version integer, p_appeal_outcome text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reopen_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reopen_v1(p_case_id uuid, p_row_version integer, p_reason text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_request_waiver_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_request_waiver_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_request_writeoff_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_request_writeoff_v1(p_case_id uuid, p_row_version integer, p_amount numeric, p_is_full boolean, p_ground_code text, p_justification text, p_currency text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_resume_recovery_v1(p_case_id uuid, p_suspension_id uuid, p_row_version integer, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_resume_recovery_v1(p_case_id uuid, p_suspension_id uuid, p_row_version integer, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reverse_transaction_v1(p_case_id uuid, p_transaction_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_reverse_transaction_v1(p_case_id uuid, p_transaction_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_revise_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_instalment_amount numeric, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_revise_recovery_plan_v1(p_case_id uuid, p_plan_id uuid, p_plan_row_version integer, p_instalment_amount numeric, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_suspend_recovery_v1(p_case_id uuid, p_row_version integer, p_reason_code text, p_reason text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_suspend_recovery_v1(p_case_id uuid, p_row_version integer, p_reason_code text, p_reason text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_timeline_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_timeline_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_transactions_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_transactions_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_verify_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_verify_v1(p_case_id uuid, p_row_version integer, p_note text, p_idempotency_key text) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_waiver_requests_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_waiver_requests_v1(p_case_id uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_worklist_v1(p_status text, p_search text, p_limit integer, p_offset integer) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_worklist_v1(p_status text, p_search text, p_limit integer, p_offset integer) TO service_role;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_writeoff_requests_v1(p_case_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.bn_overpayment_writeoff_requests_v1(p_case_id uuid) TO service_role;
-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_bn_op_alloc_immutable ON public.bn_op_receipt_allocation;
CREATE TRIGGER trg_bn_op_alloc_immutable BEFORE DELETE OR UPDATE ON public.bn_op_receipt_allocation FOR EACH ROW EXECUTE FUNCTION _bn_op_block_mutation();

DROP TRIGGER IF EXISTS trg_bn_op_appeal_hold_touch ON public.bn_op_appeal_hold;
CREATE TRIGGER trg_bn_op_appeal_hold_touch BEFORE UPDATE ON public.bn_op_appeal_hold FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_case_touch ON public.bn_op_case;
CREATE TRIGGER trg_bn_op_case_touch BEFORE UPDATE ON public.bn_op_case FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_communication_intent_touch ON public.bn_op_communication_intent;
CREATE TRIGGER trg_bn_op_communication_intent_touch BEFORE UPDATE ON public.bn_op_communication_intent FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_deduction_instruction_touch ON public.bn_op_deduction_instruction;
CREATE TRIGGER trg_bn_op_deduction_instruction_touch BEFORE UPDATE ON public.bn_op_deduction_instruction FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_estate_referral_touch ON public.bn_op_estate_referral;
CREATE TRIGGER trg_bn_op_estate_referral_touch BEFORE UPDATE ON public.bn_op_estate_referral FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_event_immutable ON public.bn_op_event;
CREATE TRIGGER trg_bn_op_event_immutable BEFORE DELETE OR UPDATE ON public.bn_op_event FOR EACH ROW EXECUTE FUNCTION _bn_op_block_mutation();

DROP TRIGGER IF EXISTS trg_bn_op_finance_posting_intent_touch ON public.bn_op_finance_posting_intent;
CREATE TRIGGER trg_bn_op_finance_posting_intent_touch BEFORE UPDATE ON public.bn_op_finance_posting_intent FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_legal_referral_touch ON public.bn_op_legal_referral;
CREATE TRIGGER trg_bn_op_legal_referral_touch BEFORE UPDATE ON public.bn_op_legal_referral FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_reconciliation_touch ON public.bn_op_reconciliation;
CREATE TRIGGER trg_bn_op_reconciliation_touch BEFORE UPDATE ON public.bn_op_reconciliation FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_recovery_plan_instalment_touch ON public.bn_op_recovery_plan_instalment;
CREATE TRIGGER trg_bn_op_recovery_plan_instalment_touch BEFORE UPDATE ON public.bn_op_recovery_plan_instalment FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_recovery_plan_touch ON public.bn_op_recovery_plan;
CREATE TRIGGER trg_bn_op_recovery_plan_touch BEFORE UPDATE ON public.bn_op_recovery_plan FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_recovery_suspension_touch ON public.bn_op_recovery_suspension;
CREATE TRIGGER trg_bn_op_recovery_suspension_touch BEFORE UPDATE ON public.bn_op_recovery_suspension FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_representation_touch ON public.bn_op_representation;
CREATE TRIGGER trg_bn_op_representation_touch BEFORE UPDATE ON public.bn_op_representation FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_txn_immutable ON public.bn_op_recovery_transaction;
CREATE TRIGGER trg_bn_op_txn_immutable BEFORE DELETE OR UPDATE ON public.bn_op_recovery_transaction FOR EACH ROW EXECUTE FUNCTION _bn_op_block_mutation();

DROP TRIGGER IF EXISTS trg_bn_op_waiver_request_touch ON public.bn_op_waiver_request;
CREATE TRIGGER trg_bn_op_waiver_request_touch BEFORE UPDATE ON public.bn_op_waiver_request FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

DROP TRIGGER IF EXISTS trg_bn_op_writeoff_request_touch ON public.bn_op_writeoff_request;
CREATE TRIGGER trg_bn_op_writeoff_request_touch BEFORE UPDATE ON public.bn_op_writeoff_request FOR EACH ROW EXECUTE FUNCTION _bn_op_touch();

-- ---------------------------------------------------------------------
-- Action catalogue (reference data, not case residue)
-- ---------------------------------------------------------------------

INSERT INTO public.bn_op_action_definition (action_code, display_name, risk_level, is_financial) VALUES
  ('activate_deduction', 'Activate benefit deduction', 'ELEVATED', 't'),
  ('admin', 'Overpayment administration', 'HIGH', 't'),
  ('allocate_receipt', 'Allocate receipt', 'ELEVATED', 't'),
  ('approve_recovery_plan', 'Approve recovery plan', 'ELEVATED', 't'),
  ('approve_waiver', 'Approve waiver', 'HIGH', 't'),
  ('approve_writeoff', 'Approve write-off', 'HIGH', 't'),
  ('audit', 'View audit history', 'ELEVATED', 'f'),
  ('calculate_liability', 'Calculate liability', 'ELEVATED', 't'),
  ('close', 'Close case', 'ELEVATED', 'f'),
  ('confirm_liability', 'Confirm liability', 'HIGH', 't'),
  ('create_candidate', 'Create overpayment candidate', 'STANDARD', 'f'),
  ('issue_notice', 'Issue notice', 'STANDARD', 'f'),
  ('place_appeal_hold', 'Place appeal hold', 'ELEVATED', 'f'),
  ('propose_recovery_plan', 'Propose recovery plan', 'STANDARD', 'f'),
  ('reconcile', 'Reconcile', 'ELEVATED', 't'),
  ('record_receipt', 'Record receipt', 'ELEVATED', 't'),
  ('record_representation', 'Record representation', 'STANDARD', 'f'),
  ('refer_estate', 'Refer to Estate', 'HIGH', 'f'),
  ('refer_legal', 'Refer to Legal', 'HIGH', 'f'),
  ('release_appeal_hold', 'Release appeal hold', 'ELEVATED', 'f'),
  ('reopen', 'Reopen case', 'HIGH', 'f'),
  ('request_waiver', 'Request waiver', 'STANDARD', 'f'),
  ('request_writeoff', 'Request write-off', 'STANDARD', 'f'),
  ('resume_recovery', 'Resume recovery', 'ELEVATED', 'f'),
  ('reverse_transaction', 'Reverse transaction', 'HIGH', 't'),
  ('suspend_recovery', 'Suspend recovery', 'ELEVATED', 'f'),
  ('verify', 'Verify case', 'ELEVATED', 'f'),
  ('view', 'View overpayment cases', 'STANDARD', 'f'),
  ('view_financial_detail', 'View financial detail', 'ELEVATED', 't')
ON CONFLICT (action_code) DO UPDATE SET display_name = excluded.display_name, risk_level = excluded.risk_level, is_financial = excluded.is_financial;

-- ---------------------------------------------------------------------
-- Module registration (dark launch: internal_pilot, actions disabled)
-- ---------------------------------------------------------------------

INSERT INTO public.app_modules (name, display_name, description, route, is_enabled, show_in_menu, rollout_state, internal_only, routes_enabled, actions_enabled)
VALUES ('bn_overpayments', 'Overpayment Recovery', 'Overpayment detection and recovery tracking', '/bn/overpayments', true, false, 'internal_pilot', 'f', 't', false)
ON CONFLICT (name) DO UPDATE
  SET display_name = excluded.display_name,
      rollout_state = excluded.rollout_state,
      internal_only = excluded.internal_only,
      routes_enabled = excluded.routes_enabled,
      actions_enabled = false;
