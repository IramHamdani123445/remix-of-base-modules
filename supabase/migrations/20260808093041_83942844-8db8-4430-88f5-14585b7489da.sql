-- ============================================================
-- BN Uprating — Epic 1: run master, population snapshot,
-- exceptions and simulation (pre-execution only).
-- ============================================================

-- ---------- Reference data --------------------------------------------
INSERT INTO public.bn_uprating_reference_value(domain, code, label, description, sort_order) VALUES
 ('RUN_STATUS','DRAFT','Draft','Run created, parameters not yet locked.',10),
 ('RUN_STATUS','PARAMETERISED','Parameterised','Run parameters and policy provenance locked.',20),
 ('RUN_STATUS','ELIGIBILITY_SNAPSHOT','Population snapshot','Immutable award population snapshot taken.',30),
 ('RUN_STATUS','EXCLUSIONS_APPLIED','Exclusions applied','Exclusions and exceptions evaluated.',40),
 ('RUN_STATUS','DRY_RUN','Dry run','Deterministic simulation produced.',50),

 ('EXCLUSION_REASON','PENDING_MORTALITY','Pending mortality','A mortality event is open for this award.',10),
 ('EXCLUSION_REASON','UNRESOLVED_APPEAL','Unresolved appeal','An appeal affecting this award is unresolved.',20),
 ('EXCLUSION_REASON','PAYMENT_HELD','Payment held','Payment on this award is currently held or suspended.',30),
 ('EXCLUSION_REASON','RISK_INVESTIGATION','Risk investigation','An operational risk control restricts this award.',40),
 ('EXCLUSION_REASON','MANUAL_EXCLUSION','Manual exclusion','Excluded by an authorised officer decision.',50),

 ('EXCEPTION_CODE','MISSING_PRODUCT_VERSION','Missing product version','The award has no resolvable product version.',10),
 ('EXCEPTION_CODE','UNSUPPORTED_FREQUENCY','Unsupported payment frequency','The award payment frequency is not supported by the policy.',20),
 ('EXCEPTION_CODE','SUSPENDED_AWARD','Suspended award','The award is suspended.',30),
 ('EXCEPTION_CODE','TERMINATED_AWARD','Terminated award','The award is terminated or closed.',40),
 ('EXCEPTION_CODE','INVALID_BASE_AMOUNT','Invalid base amount','The award base amount is missing, zero or negative.',50),
 ('EXCEPTION_CODE','CONFLICTING_RATE_HISTORY','Conflicting rate history','More than one current rate was observed for the award.',60),
 ('EXCEPTION_CODE','PENDING_APPEAL','Pending appeal','An appeal is pending for this award.',70),
 ('EXCEPTION_CODE','PENDING_MORTALITY_EVENT','Pending mortality event','A mortality event is pending for this award.',80),
 ('EXCEPTION_CODE','UNRESOLVED_OVERPAYMENT_POLICY_CONFLICT','Unresolved overpayment policy conflict','An overpayment control conflicts with uprating treatment.',90),
 ('EXCEPTION_CODE','PAYMENT_ALREADY_ISSUED_FOR_PERIOD','Payment already issued for period','A payment was already issued covering the target period.',100),
 ('EXCEPTION_CODE','MISSING_PAYMENT_PROFILE','Missing payment profile','The award has no usable payment frequency profile.',110),
 ('EXCEPTION_CODE','CONCURRENT_AWARD_AMENDMENT','Concurrent award amendment','The award changed while the snapshot was being built.',120),
 ('EXCEPTION_CODE','STALE_ROW_VERSION','Stale row version','The observed award row version is no longer current.',130),

 ('EXCEPTION_RESOLUTION','EXCLUDE','Exclude from run','Permanently exclude this award from the current run.',10),
 ('EXCEPTION_RESOLUTION','CONFIRM_ELIGIBLE','Confirm eligible','Confirm the award may be uprated despite the exception.',20),
 ('EXCEPTION_RESOLUTION','CORRECTED_AT_SOURCE','Corrected at source','The owning domain corrected the data; reassess on rebuild.',30),
 ('EXCEPTION_RESOLUTION','DEFER','Defer','Defer this award to a later uprating run.',40),
 ('EXCEPTION_RESOLUTION','ACCEPT_EXCEPTION','Accept exception','Record the exception as accepted without changing treatment.',50)
ON CONFLICT (domain, code) DO NOTHING;

-- ---------- Run master -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_uprating_run (
  run_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_reference          text NOT NULL UNIQUE,
  run_name               text,
  policy_id              uuid NOT NULL REFERENCES public.bn_uprating_policy(policy_id),
  policy_version_id      uuid NOT NULL REFERENCES public.bn_uprating_policy_version(policy_version_id),
  status                 text NOT NULL DEFAULT 'DRAFT',
  country_code           text,
  target_effective_date  date NOT NULL,
  scope_product_id       uuid REFERENCES public.bn_product(id),
  scope_award_type_code  text,
  scope_award_component_code text,
  scope_payment_frequency text,
  scope_description      text,
  calculation_basis      text NOT NULL DEFAULT 'AWARD_BASE_AMOUNT',
  -- frozen policy provenance (captured at parameterisation)
  frozen_policy_type     text,
  frozen_rounding_mode   text,
  frozen_effective_from  date,
  frozen_effective_to    date,
  frozen_percentage_bp   integer,
  frozen_fixed_amount_minor bigint,
  frozen_formula_version_id uuid,
  frozen_index_series_id uuid,
  frozen_index_observation_id uuid,
  frozen_index_value     numeric(18,6),
  frozen_index_base_value numeric(18,6),
  frozen_tiers           jsonb NOT NULL DEFAULT '[]'::jsonb,
  frozen_applicability   jsonb NOT NULL DEFAULT '{}'::jsonb,
  parameterised_at       timestamptz,
  parameterised_by       uuid,
  current_snapshot_id    uuid,
  current_snapshot_version integer,
  current_simulation_id  uuid,
  current_simulation_version integer,
  simulation_state       text NOT NULL DEFAULT 'NONE',
  input_fingerprint      text,
  row_version            integer NOT NULL DEFAULT 1,
  correlation_id         uuid,
  created_by             uuid,
  created_by_name        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_uprating_run_status_ck CHECK (status IN
    ('DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN')),
  CONSTRAINT bn_uprating_run_simstate_ck CHECK (simulation_state IN ('NONE','CURRENT','STALE'))
);
CREATE INDEX IF NOT EXISTS bn_uprating_run_policy_idx ON public.bn_uprating_run(policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bn_uprating_run_status_idx ON public.bn_uprating_run(status);
GRANT ALL ON public.bn_uprating_run TO service_role;
REVOKE ALL ON public.bn_uprating_run FROM anon, authenticated;
ALTER TABLE public.bn_uprating_run ENABLE ROW LEVEL SECURITY;

-- ---------- Population snapshot ---------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_uprating_run_snapshot (
  snapshot_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  snapshot_version   integer NOT NULL,
  status             text NOT NULL DEFAULT 'CURRENT',
  policy_version_id  uuid NOT NULL,
  selection_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_items        integer NOT NULL DEFAULT 0,
  eligible_items     integer NOT NULL DEFAULT 0,
  excluded_items     integer NOT NULL DEFAULT 0,
  exception_items    integer NOT NULL DEFAULT 0,
  blocking_exception_items integer NOT NULL DEFAULT 0,
  current_total_minor bigint NOT NULL DEFAULT 0,
  snapshot_fingerprint text,
  superseded_by_snapshot_id uuid REFERENCES public.bn_uprating_run_snapshot(snapshot_id),
  superseded_at      timestamptz,
  taken_by           uuid,
  taken_by_name      text,
  taken_at           timestamptz NOT NULL DEFAULT now(),
  correlation_id     uuid,
  UNIQUE (run_id, snapshot_version),
  CONSTRAINT bn_uprating_snapshot_status_ck CHECK (status IN ('CURRENT','SUPERSEDED'))
);
GRANT ALL ON public.bn_uprating_run_snapshot TO service_role;
REVOKE ALL ON public.bn_uprating_run_snapshot FROM anon, authenticated;
ALTER TABLE public.bn_uprating_run_snapshot ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_run_snapshot_item (
  snapshot_item_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id        uuid NOT NULL REFERENCES public.bn_uprating_run_snapshot(snapshot_id) ON DELETE CASCADE,
  run_id             uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  award_id           uuid NOT NULL,
  award_reference    text NOT NULL,
  person_reference   text,
  product_id         uuid,
  product_code       text,
  product_name       text,
  product_version_id uuid,
  award_type_code    text,
  award_component_code text,
  award_status       text,
  base_amount_minor  bigint,
  currency_code      text,
  payment_frequency  text,
  award_start_date   date,
  award_end_date     date,
  source_row_version integer,
  source_observed_at timestamptz NOT NULL DEFAULT now(),
  eligibility_status text NOT NULL DEFAULT 'ELIGIBLE',
  exclusion_reason_code text,
  exception_status   text NOT NULL DEFAULT 'NONE',
  inclusion_explanation text,
  provenance         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, award_id),
  CONSTRAINT bn_uprating_snapitem_elig_ck CHECK (eligibility_status IN ('ELIGIBLE','EXCLUDED','DEFERRED')),
  CONSTRAINT bn_uprating_snapitem_exc_ck CHECK (exception_status IN ('NONE','OPEN','BLOCKING','RESOLVED'))
);
CREATE INDEX IF NOT EXISTS bn_uprating_snapitem_snapshot_idx ON public.bn_uprating_run_snapshot_item(snapshot_id, award_reference);
CREATE INDEX IF NOT EXISTS bn_uprating_snapitem_run_idx ON public.bn_uprating_run_snapshot_item(run_id);
GRANT ALL ON public.bn_uprating_run_snapshot_item TO service_role;
REVOKE ALL ON public.bn_uprating_run_snapshot_item FROM anon, authenticated;
ALTER TABLE public.bn_uprating_run_snapshot_item ENABLE ROW LEVEL SECURITY;

-- ---------- Exception catalogue and records ---------------------------
CREATE TABLE IF NOT EXISTS public.bn_uprating_exception_policy (
  exception_code       text PRIMARY KEY,
  owning_domain        text NOT NULL,
  default_severity     text NOT NULL DEFAULT 'BLOCKING',
  is_blocking          boolean NOT NULL DEFAULT true,
  business_explanation text NOT NULL,
  allowed_resolutions  text[] NOT NULL DEFAULT ARRAY[]::text[],
  requires_source_correction boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bn_uprating_exception_policy TO service_role;
REVOKE ALL ON public.bn_uprating_exception_policy FROM anon, authenticated;
ALTER TABLE public.bn_uprating_exception_policy ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bn_uprating_exception_policy
 (exception_code, owning_domain, default_severity, is_blocking, business_explanation, allowed_resolutions, requires_source_correction) VALUES
 ('MISSING_PRODUCT_VERSION','BENEFITS_PRODUCT','BLOCKING',true,'The award cannot be uprated because no product version could be resolved for the target effective date.',ARRAY['EXCLUDE','CORRECTED_AT_SOURCE','DEFER'],true),
 ('UNSUPPORTED_FREQUENCY','BENEFITS_AWARD','BLOCKING',true,'The award payment frequency is outside the frequency supported by this uprating policy version.',ARRAY['EXCLUDE','DEFER'],false),
 ('SUSPENDED_AWARD','BENEFITS_AWARD','BLOCKING',true,'The award is suspended, so uprating treatment must be decided explicitly.',ARRAY['EXCLUDE','DEFER'],false),
 ('TERMINATED_AWARD','BENEFITS_AWARD','BLOCKING',true,'The award is terminated and cannot be uprated.',ARRAY['EXCLUDE'],false),
 ('INVALID_BASE_AMOUNT','BENEFITS_AWARD','BLOCKING',true,'The award base amount is missing or not a valid positive amount.',ARRAY['EXCLUDE','CORRECTED_AT_SOURCE'],true),
 ('CONFLICTING_RATE_HISTORY','BENEFITS_AWARD','BLOCKING',true,'More than one current rate was observed for this award.',ARRAY['EXCLUDE','CORRECTED_AT_SOURCE','DEFER'],true),
 ('PENDING_APPEAL','BENEFITS_APPEALS','BLOCKING',true,'An appeal affecting this award is unresolved.',ARRAY['EXCLUDE','DEFER','CONFIRM_ELIGIBLE'],false),
 ('PENDING_MORTALITY_EVENT','BENEFITS_MORTALITY','BLOCKING',true,'A mortality event is open for this award.',ARRAY['EXCLUDE','DEFER'],false),
 ('UNRESOLVED_OVERPAYMENT_POLICY_CONFLICT','BENEFITS_OVERPAYMENT','BLOCKING',true,'An overpayment control conflicts with uprating treatment for this award.',ARRAY['EXCLUDE','DEFER','ACCEPT_EXCEPTION'],false),
 ('PAYMENT_ALREADY_ISSUED_FOR_PERIOD','BENEFITS_PAYMENT','WARNING',false,'A payment covering the target period has already been issued.',ARRAY['ACCEPT_EXCEPTION','DEFER','EXCLUDE'],false),
 ('MISSING_PAYMENT_PROFILE','BENEFITS_PAYMENT','BLOCKING',true,'The award has no usable payment frequency profile.',ARRAY['EXCLUDE','CORRECTED_AT_SOURCE'],true),
 ('CONCURRENT_AWARD_AMENDMENT','BENEFITS_AWARD','BLOCKING',true,'The award was amended while this population snapshot was built.',ARRAY['CORRECTED_AT_SOURCE','EXCLUDE','DEFER'],true),
 ('STALE_ROW_VERSION','BENEFITS_AWARD','BLOCKING',true,'The observed award row version is no longer current; rebuild the population.',ARRAY['CORRECTED_AT_SOURCE','EXCLUDE'],true),
 ('RISK_OPERATIONAL_RESTRICTION','BENEFITS_RISK','BLOCKING',true,'An operational risk control currently restricts servicing of this award.',ARRAY['EXCLUDE','DEFER'],false),
 ('PAYMENT_HELD','BENEFITS_PAYMENT','BLOCKING',true,'Payment on this award is held or suspended.',ARRAY['EXCLUDE','DEFER'],false),
 ('SOURCE_STATUS_UNAVAILABLE','BENEFITS_PLATFORM','BLOCKING',true,'A required authoritative status could not be resolved, so the award fails closed.',ARRAY['EXCLUDE','CORRECTED_AT_SOURCE'],true)
ON CONFLICT (exception_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bn_uprating_run_exception (
  exception_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  snapshot_id        uuid NOT NULL REFERENCES public.bn_uprating_run_snapshot(snapshot_id) ON DELETE CASCADE,
  snapshot_item_id   uuid NOT NULL REFERENCES public.bn_uprating_run_snapshot_item(snapshot_item_id) ON DELETE CASCADE,
  award_reference    text NOT NULL,
  exception_code     text NOT NULL REFERENCES public.bn_uprating_exception_policy(exception_code),
  severity           text NOT NULL DEFAULT 'BLOCKING',
  is_blocking        boolean NOT NULL DEFAULT true,
  owning_domain      text NOT NULL,
  business_explanation text NOT NULL,
  source_reference   text,
  detected_at        timestamptz NOT NULL DEFAULT now(),
  resolution_status  text NOT NULL DEFAULT 'OPEN',
  resolution_code    text,
  resolution_label   text,
  resolution_reason  text,
  justification      text,
  resolved_by        uuid,
  resolved_by_name   text,
  resolved_at        timestamptz,
  row_version        integer NOT NULL DEFAULT 1,
  correlation_id     uuid,
  CONSTRAINT bn_uprating_exc_res_ck CHECK (resolution_status IN ('OPEN','RESOLVED'))
);
CREATE INDEX IF NOT EXISTS bn_uprating_exc_run_idx ON public.bn_uprating_run_exception(run_id, resolution_status);
CREATE INDEX IF NOT EXISTS bn_uprating_exc_item_idx ON public.bn_uprating_run_exception(snapshot_item_id);
GRANT ALL ON public.bn_uprating_run_exception TO service_role;
REVOKE ALL ON public.bn_uprating_run_exception FROM anon, authenticated;
ALTER TABLE public.bn_uprating_run_exception ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_run_exception_history (
  history_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id   uuid NOT NULL REFERENCES public.bn_uprating_run_exception(exception_id) ON DELETE CASCADE,
  sequence_no    integer NOT NULL,
  action_code    text NOT NULL,
  resolution_code text,
  justification  text,
  actor_user_id  uuid,
  actor_name     text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid,
  UNIQUE (exception_id, sequence_no)
);
GRANT ALL ON public.bn_uprating_run_exception_history TO service_role;
REVOKE ALL ON public.bn_uprating_run_exception_history FROM anon, authenticated;
ALTER TABLE public.bn_uprating_run_exception_history ENABLE ROW LEVEL SECURITY;

-- ---------- Simulation --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_uprating_simulation (
  simulation_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  simulation_version integer NOT NULL,
  snapshot_id        uuid NOT NULL REFERENCES public.bn_uprating_run_snapshot(snapshot_id),
  policy_version_id  uuid NOT NULL,
  status             text NOT NULL DEFAULT 'CURRENT',
  input_fingerprint  text NOT NULL,
  policy_type        text NOT NULL,
  rounding_mode      text NOT NULL,
  simulated_items    integer NOT NULL DEFAULT 0,
  failed_items       integer NOT NULL DEFAULT 0,
  increase_count     integer NOT NULL DEFAULT 0,
  no_change_count    integer NOT NULL DEFAULT 0,
  decrease_count     integer NOT NULL DEFAULT 0,
  current_total_minor  bigint NOT NULL DEFAULT 0,
  proposed_total_minor bigint NOT NULL DEFAULT 0,
  delta_total_minor    bigint NOT NULL DEFAULT 0,
  exception_total      integer NOT NULL DEFAULT 0,
  provenance         jsonb NOT NULL DEFAULT '{}'::jsonb,
  superseded_by_simulation_id uuid REFERENCES public.bn_uprating_simulation(simulation_id),
  superseded_at      timestamptz,
  simulated_by       uuid,
  simulated_by_name  text,
  simulated_at       timestamptz NOT NULL DEFAULT now(),
  correlation_id     uuid,
  UNIQUE (run_id, simulation_version),
  CONSTRAINT bn_uprating_sim_status_ck CHECK (status IN ('CURRENT','SUPERSEDED','STALE'))
);
GRANT ALL ON public.bn_uprating_simulation TO service_role;
REVOKE ALL ON public.bn_uprating_simulation FROM anon, authenticated;
ALTER TABLE public.bn_uprating_simulation ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_simulation_item (
  simulation_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id      uuid NOT NULL REFERENCES public.bn_uprating_simulation(simulation_id) ON DELETE CASCADE,
  run_id             uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  snapshot_item_id   uuid NOT NULL REFERENCES public.bn_uprating_run_snapshot_item(snapshot_item_id) ON DELETE CASCADE,
  award_reference    text NOT NULL,
  award_component_code text,
  base_amount_minor  bigint NOT NULL,
  policy_method      text NOT NULL,
  unrounded_amount_minor numeric(20,6) NOT NULL,
  rounding_mode      text NOT NULL,
  proposed_amount_minor bigint NOT NULL,
  delta_amount_minor bigint NOT NULL,
  applied_percentage_bp integer,
  applied_fixed_amount_minor bigint,
  applied_factor     numeric(18,8),
  matched_tier_sequence integer,
  calculation_status text NOT NULL DEFAULT 'CALCULATED',
  exception_status   text NOT NULL DEFAULT 'NONE',
  calculation_trace  jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_fingerprint  text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (simulation_id, snapshot_item_id),
  CONSTRAINT bn_uprating_simitem_status_ck CHECK (calculation_status IN ('CALCULATED','FAILED','SKIPPED'))
);
CREATE INDEX IF NOT EXISTS bn_uprating_simitem_sim_idx ON public.bn_uprating_simulation_item(simulation_id, award_reference);
GRANT ALL ON public.bn_uprating_simulation_item TO service_role;
REVOKE ALL ON public.bn_uprating_simulation_item FROM anon, authenticated;
ALTER TABLE public.bn_uprating_simulation_item ENABLE ROW LEVEL SECURITY;

-- ---------- Run timeline ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bn_uprating_run_event (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  event_code      text NOT NULL,
  event_label     text NOT NULL,
  detail          text,
  previous_status text,
  new_status      text,
  actor_user_id   uuid,
  actor_name      text,
  correlation_id  uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bn_uprating_run_event_idx ON public.bn_uprating_run_event(run_id, occurred_at DESC);
GRANT ALL ON public.bn_uprating_run_event TO service_role;
REVOKE ALL ON public.bn_uprating_run_event FROM anon, authenticated;
ALTER TABLE public.bn_uprating_run_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bn_uprating_command_audit ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE OR REPLACE FUNCTION public._bn_uprating_run_event(
  p_run_id uuid, p_code text, p_label text, p_detail text,
  p_prev text, p_new text, p_actor uuid, p_correlation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  INSERT INTO public.bn_uprating_run_event(run_id, event_code, event_label, detail,
    previous_status, new_status, actor_user_id, actor_name, correlation_id)
  VALUES (p_run_id, p_code, p_label, p_detail, p_prev, p_new, p_actor,
          public._bn_uprating_actor_name(p_actor), p_correlation);
END; $fn$;
