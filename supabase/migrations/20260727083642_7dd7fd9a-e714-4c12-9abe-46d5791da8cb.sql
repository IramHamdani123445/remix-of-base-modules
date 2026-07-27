
-- Enums
DO $$ BEGIN
  CREATE TYPE public.comm_hub_revalidation_purpose AS ENUM (
    'CONFIGURATION_CHANGE','PROVIDER_CHANGE','SENDER_CHANGE','TEMPLATE_CHANGE',
    'RUNTIME_CHANGE','SECURITY_CHANGE','INCIDENT_RECOVERY','OPERATOR_ASSURANCE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.comm_hub_revalidation_status AS ENUM (
    'DRAFT','ASSESSING','REVALIDATION_REQUIRED','NON_SENDING_CHECKS',
    'READY_FOR_CONTROLLED_EMAIL','EMAIL_AUTHORISED','PROVIDER_PROCESSING',
    'AWAITING_INBOX_CONFIRMATION','CONFIRMED','NOT_RECEIVED','FAILED','VOIDED',
    'VERIFIED_SUPPLEMENTAL','READY_FOR_PROMOTION','PROMOTED','SUPERSEDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.comm_hub_revalidation_stage_code AS ENUM (
    'CHANGE_ASSESSMENT','CONTRACT_TESTS','PREVIEW','PREVIEW_APPROVAL','DRY_RUN',
    'CONTROLLED_STUB','CONTROLLED_REVALIDATION_EMAIL','INBOX_CONFIRMATION',
    'MANUAL_PRODUCTION_ACCEPTANCE','AUTOMATED_READINESS','AUTOMATED_CANARY',
    'BASELINE_PROMOTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.comm_hub_revalidation_level AS ENUM (
    'NONE','NON_SENDING_ONLY','CONTROLLED_EMAIL','FULL_CONTENT_AND_DELIVERY',
    'FULL_MANUAL_PRODUCTION','AUTOMATED_CANARY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.comm_hub_stage_result_status AS ENUM (
    'PASSED','FAILED','SKIPPED','ACCEPTED_UNCHANGED','PENDING'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Runtime release manifest
CREATE TABLE IF NOT EXISTS public.communication_hub_runtime_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  git_commit_sha text NOT NULL,
  release_reference text NOT NULL UNIQUE,
  component_build_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_surfaces text[] NOT NULL DEFAULT ARRAY[]::text[],
  revalidation_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_reason text,
  deployed_by uuid,
  deployed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.communication_hub_runtime_release TO authenticated;
GRANT ALL ON public.communication_hub_runtime_release TO service_role;
ALTER TABLE public.communication_hub_runtime_release ENABLE ROW LEVEL SECURITY;

CREATE POLICY "runtime_release_admin_read" ON public.communication_hub_runtime_release
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'));

-- Revalidation cycle
CREATE TABLE IF NOT EXISTS public.communication_hub_revalidation_cycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  purpose public.comm_hub_revalidation_purpose NOT NULL,
  reason text NOT NULL,
  change_ticket_reference text,
  status public.comm_hub_revalidation_status NOT NULL DEFAULT 'DRAFT',
  started_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  baseline_event_certification_id uuid,
  baseline_ore_certification_id uuid,
  baseline_production_lineage_id uuid,
  baseline_evidence_core_v2 jsonb,
  baseline_evidence_fingerprint_v2 text,
  current_evidence_core_v2 jsonb,
  current_evidence_fingerprint_v2 text,
  changed_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  runtime_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_validation_level public.comm_hub_revalidation_level NOT NULL DEFAULT 'NONE',
  required_stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  runtime_release_id uuid REFERENCES public.communication_hub_runtime_release(id),
  recipient_email text,
  recipient_set_hash text,
  controlled_email_execution_id uuid,
  controlled_email_certification_id uuid,
  inbox_confirmation_status text CHECK (inbox_confirmation_status IN ('PENDING','CONFIRMED','NOT_RECEIVED') OR inbox_confirmation_status IS NULL),
  provider_call_attempted boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  promotion_status text CHECK (promotion_status IN ('NONE','SUPPLEMENTAL','PROMOTED') OR promotion_status IS NULL) DEFAULT 'NONE',
  promoted_at timestamptz,
  promoted_by uuid,
  superseded_cycle_id uuid REFERENCES public.communication_hub_revalidation_cycle(id),
  configuration_version_at_start bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one unresolved cycle per module/event/channel
CREATE UNIQUE INDEX IF NOT EXISTS uq_chrc_one_unresolved_per_event
  ON public.communication_hub_revalidation_cycle (module_code, event_code, channel)
  WHERE status NOT IN ('CONFIRMED','NOT_RECEIVED','FAILED','VOIDED','VERIFIED_SUPPLEMENTAL','PROMOTED','SUPERSEDED');

-- At most one provider-contacting execution per cycle
CREATE UNIQUE INDEX IF NOT EXISTS uq_chrc_one_provider_execution
  ON public.communication_hub_revalidation_cycle (id)
  WHERE controlled_email_execution_id IS NOT NULL;

GRANT SELECT ON public.communication_hub_revalidation_cycle TO authenticated;
GRANT ALL ON public.communication_hub_revalidation_cycle TO service_role;
ALTER TABLE public.communication_hub_revalidation_cycle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chrc_admin_read" ON public.communication_hub_revalidation_cycle
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'));

-- Revalidation stage result (append-only)
CREATE TABLE IF NOT EXISTS public.communication_hub_revalidation_stage_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.communication_hub_revalidation_cycle(id) ON DELETE CASCADE,
  stage_code public.comm_hub_revalidation_stage_code NOT NULL,
  status public.comm_hub_stage_result_status NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_snapshot_id uuid,
  preview_approval_id uuid,
  dry_run_certification_id uuid,
  controlled_stub_certification_id uuid,
  one_real_email_certification_id uuid,
  manual_observation_id uuid,
  automated_canary_id uuid,
  reused_historical_evidence boolean NOT NULL DEFAULT false,
  completed_by uuid,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_chrsr_cycle ON public.communication_hub_revalidation_stage_result(cycle_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chrsr_cycle_stage_active
  ON public.communication_hub_revalidation_stage_result(cycle_id, stage_code)
  WHERE status IN ('PASSED','ACCEPTED_UNCHANGED');

GRANT SELECT ON public.communication_hub_revalidation_stage_result TO authenticated;
GRANT ALL ON public.communication_hub_revalidation_stage_result TO service_role;
ALTER TABLE public.communication_hub_revalidation_stage_result ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chrsr_admin_read" ON public.communication_hub_revalidation_stage_result
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'));

-- Send authorisation
CREATE TABLE IF NOT EXISTS public.communication_hub_revalidation_send_authorisation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.communication_hub_revalidation_cycle(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  bound_current_fingerprint text NOT NULL,
  bound_event_certification_id uuid NOT NULL,
  bound_production_lineage_id uuid NOT NULL,
  issued_by uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_execution_id uuid,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chrsa_one_active_per_cycle
  ON public.communication_hub_revalidation_send_authorisation(cycle_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

GRANT SELECT ON public.communication_hub_revalidation_send_authorisation TO authenticated;
GRANT ALL ON public.communication_hub_revalidation_send_authorisation TO service_role;
ALTER TABLE public.communication_hub_revalidation_send_authorisation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chrsa_admin_read" ON public.communication_hub_revalidation_send_authorisation
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'Admin'));

-- updated_at trigger fn (reuse if present, else create)
CREATE OR REPLACE FUNCTION public.set_updated_at_now()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_chrc_updated_at ON public.communication_hub_revalidation_cycle;
CREATE TRIGGER trg_chrc_updated_at BEFORE UPDATE ON public.communication_hub_revalidation_cycle
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

DROP TRIGGER IF EXISTS trg_chrr_updated_at ON public.communication_hub_runtime_release;
CREATE TRIGGER trg_chrr_updated_at BEFORE UPDATE ON public.communication_hub_runtime_release
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

-- Stage-result immutability: only status may transition PENDING -> terminal via service role
CREATE OR REPLACE FUNCTION public.enforce_chrsr_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'communication_hub_revalidation_stage_result rows are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'PENDING' THEN
      RAISE EXCEPTION 'stage result % is terminal (%), no updates allowed', OLD.id, OLD.status;
    END IF;
    IF NEW.cycle_id <> OLD.cycle_id OR NEW.stage_code <> OLD.stage_code THEN
      RAISE EXCEPTION 'cannot change cycle_id or stage_code';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chrsr_immutable ON public.communication_hub_revalidation_stage_result;
CREATE TRIGGER trg_chrsr_immutable BEFORE UPDATE OR DELETE ON public.communication_hub_revalidation_stage_result
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chrsr_immutability();
