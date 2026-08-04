-- =====================================================================
-- BN LIFE CERTIFICATES — Controlled vertical slice: schema foundation
-- =====================================================================

-- ---------- 1. Policy catalogue -------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_life_certificate_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL,
  policy_version integer NOT NULL DEFAULT 1,
  description text,
  country_code varchar(5),
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  applicable_benefit_codes text[] NOT NULL DEFAULT '{}'::text[],
  applicable_award_types text[] NOT NULL DEFAULT '{}'::text[],
  applicable_award_statuses text[] NOT NULL DEFAULT ARRAY['ACTIVE'],
  min_claimant_age integer,
  payment_jurisdictions text[] NOT NULL DEFAULT '{}'::text[],
  frequency_months integer NOT NULL DEFAULT 12,
  obligation_period_kind text NOT NULL DEFAULT 'ANNUAL',
  issue_offset_days integer NOT NULL DEFAULT 0,
  due_offset_days integer NOT NULL DEFAULT 30,
  grace_days integer NOT NULL DEFAULT 30,
  reminder_offset_days integer[] NOT NULL DEFAULT ARRAY[-14, -3],
  escalation_offset_days integer NOT NULL DEFAULT 15,
  accepted_evidence_types text[] NOT NULL DEFAULT ARRAY['LIFE_CERTIFICATE','EMBASSY_ATTESTATION','MEDICAL_ATTESTATION'],
  accepted_issuing_authorities text[] NOT NULL DEFAULT '{}'::text[],
  certificate_validity_days integer NOT NULL DEFAULT 90,
  requires_maker_checker boolean NOT NULL DEFAULT true,
  waiver_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  suspension_reason_code text NOT NULL DEFAULT 'LIFE_CERT_OVERDUE',
  reinstatement_reason_code text NOT NULL DEFAULT 'LIFE_CERT_EVIDENCE_RECEIVED',
  business_days_only boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/St_Kitts',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT bn_lc_policy_code_version_uq UNIQUE (policy_code, policy_version),
  CONSTRAINT bn_lc_policy_freq_chk CHECK (frequency_months BETWEEN 1 AND 60),
  CONSTRAINT bn_lc_policy_grace_chk CHECK (grace_days >= 0),
  CONSTRAINT bn_lc_policy_period_kind_chk CHECK (obligation_period_kind IN ('ANNUAL','SEMI_ANNUAL','QUARTERLY','CUSTOM'))
);

GRANT ALL ON public.bn_life_certificate_policy TO service_role;
REVOKE ALL ON public.bn_life_certificate_policy FROM anon, authenticated;

-- ---------- 2. Obligation record (extend existing table) ------------
ALTER TABLE public.bn_life_certificate
  ADD COLUMN IF NOT EXISTS obligation_period text,
  ADD COLUMN IF NOT EXISTS obligation_period_start date,
  ADD COLUMN IF NOT EXISTS obligation_period_end date,
  ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES public.bn_life_certificate_policy(id),
  ADD COLUMN IF NOT EXISTS policy_version integer,
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS generation_inputs jsonb,
  ADD COLUMN IF NOT EXISTS issue_date date,
  ADD COLUMN IF NOT EXISTS grace_end_date date,
  ADD COLUMN IF NOT EXISTS escalation_date date,
  ADD COLUMN IF NOT EXISTS obligation_status text NOT NULL DEFAULT 'NOT_DUE',
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS escalation_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS communication_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS evidence_type text,
  ADD COLUMN IF NOT EXISTS evidence_checksum text,
  ADD COLUMN IF NOT EXISTS evidence_version integer,
  ADD COLUMN IF NOT EXISTS evidence_is_confidential boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS issuing_authority text,
  ADD COLUMN IF NOT EXISTS certificate_date date,
  ADD COLUMN IF NOT EXISTS received_channel text,
  ADD COLUMN IF NOT EXISTS received_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason_code text,
  ADD COLUMN IF NOT EXISTS rejection_narrative text,
  ADD COLUMN IF NOT EXISTS resubmission_due_date date,
  ADD COLUMN IF NOT EXISTS waiver_reason_code text,
  ADD COLUMN IF NOT EXISTS waiver_narrative text,
  ADD COLUMN IF NOT EXISTS waiver_effective_from date,
  ADD COLUMN IF NOT EXISTS waiver_expires_on date,
  ADD COLUMN IF NOT EXISTS waived_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS deferred_to_date date,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_event_id uuid REFERENCES public.bn_award_suspension_event(id),
  ADD COLUMN IF NOT EXISTS reinstatement_event_id uuid REFERENCES public.bn_award_suspension_event(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_lc_obligation_status_chk') THEN
    ALTER TABLE public.bn_life_certificate ADD CONSTRAINT bn_lc_obligation_status_chk
      CHECK (obligation_status IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE','OVERDUE','RECEIVED',
                                   'UNDER_REVIEW','VERIFIED','REJECTED','RESUBMISSION_REQUIRED',
                                   'WAIVED','DEFERRED','CLOSED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_lc_evidence_status_chk') THEN
    ALTER TABLE public.bn_life_certificate ADD CONSTRAINT bn_lc_evidence_status_chk
      CHECK (evidence_status IN ('NONE','LINKED','REJECTED','SUPERSEDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_lc_verification_status_chk') THEN
    ALTER TABLE public.bn_life_certificate ADD CONSTRAINT bn_lc_verification_status_chk
      CHECK (verification_status IN ('NOT_STARTED','IN_REVIEW','VERIFIED','REJECTED','WAIVED','DEFERRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_lc_escalation_status_chk') THEN
    ALTER TABLE public.bn_life_certificate ADD CONSTRAINT bn_lc_escalation_status_chk
      CHECK (escalation_status IN ('NONE','PENDING','SUSPENSION_PROPOSED','REINSTATEMENT_PROPOSED','CLOSED','FAILED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_lc_communication_status_chk') THEN
    ALTER TABLE public.bn_life_certificate ADD CONSTRAINT bn_lc_communication_status_chk
      CHECK (communication_status IN ('NONE','INTENT_RECORDED','DISPATCHED','FAILED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bn_lc_channel_chk') THEN
    ALTER TABLE public.bn_life_certificate ADD CONSTRAINT bn_lc_channel_chk
      CHECK (received_channel IS NULL OR received_channel IN
        ('IN_PERSON','PORTAL','EMAIL_INTAKE','EMBASSY','AUTHORISED_AUTHORITY','INTERNAL_UPLOAD','POST'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_lc_award_period
  ON public.bn_life_certificate (bn_award_id, obligation_period)
  WHERE obligation_period IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_bn_lc_obligation_status ON public.bn_life_certificate (obligation_status, due_date);
CREATE INDEX IF NOT EXISTS ix_bn_lc_escalation ON public.bn_life_certificate (escalation_status, escalation_date);
CREATE INDEX IF NOT EXISTS ix_bn_lc_document ON public.bn_life_certificate (document_id) WHERE document_id IS NOT NULL;

GRANT ALL ON public.bn_life_certificate TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.bn_life_certificate FROM anon, authenticated;

-- ---------- 3. Transition / decision history ------------------------
CREATE TABLE IF NOT EXISTS public.bn_life_certificate_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  life_certificate_id uuid NOT NULL REFERENCES public.bn_life_certificate(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_state text,
  to_state text,
  actor_user_id uuid,
  actor_user_code text,
  reason_code text,
  narrative text,
  correlation_id text,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bn_lc_event_cert ON public.bn_life_certificate_event (life_certificate_id, created_at DESC);
GRANT ALL ON public.bn_life_certificate_event TO service_role;
REVOKE ALL ON public.bn_life_certificate_event FROM anon, authenticated;

-- ---------- 4. Communication intent outbox --------------------------
CREATE TABLE IF NOT EXISTS public.bn_life_certificate_communication_intent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  life_certificate_id uuid NOT NULL REFERENCES public.bn_life_certificate(id) ON DELETE CASCADE,
  bn_award_id uuid NOT NULL,
  event_code text NOT NULL,
  module_code text NOT NULL DEFAULT 'bn_life_certificate',
  recipient_reference text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  correlation_id text,
  delivery_status text NOT NULL DEFAULT 'PENDING',
  delivery_reference text,
  last_error_code text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_lc_comm_delivery_status_chk
    CHECK (delivery_status IN ('PENDING','DISPATCHED','DELIVERED','FAILED','CANCELLED')),
  CONSTRAINT bn_lc_comm_idem_uq UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_bn_lc_comm_cert ON public.bn_life_certificate_communication_intent (life_certificate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_bn_lc_comm_pending ON public.bn_life_certificate_communication_intent (delivery_status, created_at) WHERE delivery_status = 'PENDING';
GRANT ALL ON public.bn_life_certificate_communication_intent TO service_role;
REVOKE ALL ON public.bn_life_certificate_communication_intent FROM anon, authenticated;

-- ---------- 5. Module registration (dark launched) ------------------
DO $$
DECLARE v_parent uuid; v_module uuid; v_action text;
BEGIN
  SELECT parent_id INTO v_parent FROM public.app_modules WHERE name = 'bn_award_suspension';

  INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id,
                                  sort_order, is_enabled, show_in_menu, routes_enabled, actions_enabled)
  VALUES ('bn_life_certificate','Life Certificates',
          'Life certificate obligations, verification and controlled escalation',
          'FileCheck2','/bn/life-certificates', v_parent, 41, true, false, true, false)
  ON CONFLICT (name) DO UPDATE SET route = EXCLUDED.route
  RETURNING id INTO v_module;

  IF v_module IS NULL THEN
    SELECT id INTO v_module FROM public.app_modules WHERE name = 'bn_life_certificate';
  END IF;

  FOREACH v_action IN ARRAY ARRAY[
    'view','generate','receive','verify','reject','request_resubmission','waive','defer',
    'view_evidence','view_confidential_evidence','send_reminder','escalate',
    'propose_suspension','propose_reinstatement','audit','admin'
  ] LOOP
    INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
    VALUES (v_module, v_action, initcap(replace(v_action,'_',' ')),
            'Life Certificate action: ' || v_action, true)
    ON CONFLICT (module_id, action_name) DO NOTHING;
  END LOOP;
END $$;

-- ---------- 6. Reason codes ----------------------------------------
INSERT INTO public.bn_reason_code (reason_code, reason_label, reason_category, applicable_actions, requires_narrative, is_active)
VALUES
  ('LIFE_CERT_OVERDUE','Life certificate overdue','LIFE_CERTIFICATE', ARRAY['SUSPEND'], true, true),
  ('LIFE_CERT_EVIDENCE_RECEIVED','Life certificate evidence received and verified','LIFE_CERTIFICATE', ARRAY['REINSTATE'], true, true),
  ('LIFE_CERT_INVALID_EVIDENCE','Evidence invalid or unreadable','LIFE_CERTIFICATE', ARRAY['REJECT'], true, true),
  ('LIFE_CERT_WRONG_CLAIMANT','Evidence does not match claimant','LIFE_CERTIFICATE', ARRAY['REJECT'], true, true),
  ('LIFE_CERT_EXPIRED_CERTIFICATE','Certificate outside permitted validity period','LIFE_CERTIFICATE', ARRAY['REJECT'], true, true),
  ('LIFE_CERT_MEDICAL_EXEMPTION','Medical exemption granted','LIFE_CERTIFICATE', ARRAY['WAIVE'], true, true),
  ('LIFE_CERT_INSTITUTION','Institutional residence confirmed','LIFE_CERTIFICATE', ARRAY['WAIVE'], true, true),
  ('LIFE_CERT_ADMIN_DEFERRAL','Administrative deferral','LIFE_CERTIFICATE', ARRAY['DEFER'], true, true)
ON CONFLICT (reason_code) DO NOTHING;

-- ---------- 7. Baseline policy -------------------------------------
INSERT INTO public.bn_life_certificate_policy
  (policy_code, policy_version, description, is_active, applicable_award_statuses,
   frequency_months, obligation_period_kind, due_offset_days, grace_days,
   reminder_offset_days, escalation_offset_days, requires_maker_checker)
VALUES
  ('BN_LIFE_CERT_DEFAULT', 1, 'Default annual life certificate obligation for active pension awards',
   true, ARRAY['ACTIVE'], 12, 'ANNUAL', 30, 30, ARRAY[-14,-3], 15, true)
ON CONFLICT (policy_code, policy_version) DO NOTHING;