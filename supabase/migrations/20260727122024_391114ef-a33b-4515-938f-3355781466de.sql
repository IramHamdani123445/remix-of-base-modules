-- A4.1 — Dedicated controlled-revalidation execution record.
-- One row per attempted send. Provider-boundary state is tracked
-- separately from the underlying communication_request.

CREATE TABLE IF NOT EXISTS public.communication_hub_revalidation_execution (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                       UUID NOT NULL,
  authorisation_id               UUID,
  operator_id                    UUID NOT NULL,
  request_id                     UUID,
  message_id                     UUID,
  trace_id                       UUID,
  delivery_attempt_id            UUID,
  idempotency_key                TEXT NOT NULL,
  state                          TEXT NOT NULL DEFAULT 'READY_FOR_PROVIDER',
  provider_boundary_state        TEXT NOT NULL DEFAULT 'NOT_ENTERED',
  provider_call_attempted        BOOLEAN NOT NULL DEFAULT false,
  provider_call_started_at       TIMESTAMPTZ,
  provider_call_completed_at     TIMESTAMPTZ,
  provider_message_id            TEXT,
  event_certification_id         UUID,
  production_lineage_id          UUID,
  baseline_ore_certification_id  UUID,
  baseline_fingerprint_v2        TEXT,
  current_fingerprint_v2         TEXT,
  template_version_id            UUID,
  template_manifest_hash         TEXT,
  sender_profile_id              UUID,
  recipient_policy_version       TEXT,
  recipient_set_hash             TEXT,
  provider_id                    UUID,
  runtime_build                  TEXT,
  failure_code                   TEXT,
  failure_detail                 JSONB,
  metadata                       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT communication_hub_revalidation_execution_state_chk
    CHECK (state IN (
      'READY_FOR_PROVIDER',
      'PROVIDER_INVOKED',
      'PROVIDER_ACCEPTED',
      'PROVIDER_REJECTED',
      'FAILED_PRE_PROVIDER',
      'RECONCILING',
      'CONFIRMED',
      'VOIDED'
    )),
  CONSTRAINT communication_hub_revalidation_execution_pbs_chk
    CHECK (provider_boundary_state IN (
      'NOT_ENTERED',
      'ENTERING',
      'ENTERED',
      'RETURNED',
      'ABANDONED'
    ))
);

GRANT SELECT ON public.communication_hub_revalidation_execution TO authenticated;
GRANT ALL ON public.communication_hub_revalidation_execution TO service_role;

-- At most one execution per cycle may cross the provider boundary.
CREATE UNIQUE INDEX IF NOT EXISTS ux_chre_provider_call_per_cycle
  ON public.communication_hub_revalidation_execution (cycle_id)
  WHERE provider_call_attempted = true;

-- Idempotency: one active pre-provider execution per key.
CREATE UNIQUE INDEX IF NOT EXISTS ux_chre_active_idempotency
  ON public.communication_hub_revalidation_execution (idempotency_key)
  WHERE state IN ('READY_FOR_PROVIDER', 'PROVIDER_INVOKED', 'RECONCILING');

CREATE INDEX IF NOT EXISTS ix_chre_cycle
  ON public.communication_hub_revalidation_execution (cycle_id);

CREATE INDEX IF NOT EXISTS ix_chre_operator
  ON public.communication_hub_revalidation_execution (operator_id);

CREATE INDEX IF NOT EXISTS ix_chre_state
  ON public.communication_hub_revalidation_execution (state);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._chre_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chre_touch_updated_at
  ON public.communication_hub_revalidation_execution;

CREATE TRIGGER trg_chre_touch_updated_at
  BEFORE UPDATE ON public.communication_hub_revalidation_execution
  FOR EACH ROW EXECUTE FUNCTION public._chre_touch_updated_at();

ALTER TABLE public.communication_hub_revalidation_execution
  ENABLE ROW LEVEL SECURITY;

-- Read-only visibility for authenticated admins (view execution history).
-- Writes MUST go through the service-role helper RPCs below.
DROP POLICY IF EXISTS chre_read_admin
  ON public.communication_hub_revalidation_execution;

CREATE POLICY chre_read_admin
  ON public.communication_hub_revalidation_execution
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'));

-- ============================================================
-- Internal service-role-only RPCs (Edge Function consumes these
-- in a subsequent A4.1 slice; no Edge Function change this turn).
-- ============================================================

CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_prepare_execution(
  p_cycle_id UUID,
  p_authorisation_id UUID,
  p_operator_id UUID,
  p_idempotency_key TEXT,
  p_event_certification_id UUID,
  p_production_lineage_id UUID,
  p_baseline_ore_certification_id UUID,
  p_baseline_fingerprint_v2 TEXT,
  p_current_fingerprint_v2 TEXT,
  p_template_version_id UUID,
  p_template_manifest_hash TEXT,
  p_sender_profile_id UUID,
  p_recipient_policy_version TEXT,
  p_recipient_set_hash TEXT,
  p_provider_id UUID,
  p_runtime_build TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
  execution_id UUID,
  reused BOOLEAN,
  state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_existing UUID;
  v_state TEXT;
  v_new_id UUID;
BEGIN
  -- Internal only. Reject non-service-role callers.
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501',
            HINT   = 'This is an internal RPC. Call via the Edge Function service-role client.';
  END IF;

  IF p_cycle_id IS NULL OR p_operator_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_PREPARE_ARGS'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotency: return existing active execution for this key.
  SELECT id, state INTO v_existing, v_state
    FROM public.communication_hub_revalidation_execution
    WHERE idempotency_key = p_idempotency_key
      AND state IN ('READY_FOR_PROVIDER', 'PROVIDER_INVOKED', 'RECONCILING')
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, true, v_state;
    RETURN;
  END IF;

  -- One execution per cycle across provider boundary — pre-check to give
  -- a clean error (partial unique index still enforces at write time).
  IF EXISTS (
    SELECT 1 FROM public.communication_hub_revalidation_execution
      WHERE cycle_id = p_cycle_id
        AND provider_call_attempted = true
  ) THEN
    RAISE EXCEPTION 'CYCLE_PROVIDER_BOUNDARY_ALREADY_USED'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.communication_hub_revalidation_execution (
    cycle_id, authorisation_id, operator_id, idempotency_key,
    state, provider_boundary_state, provider_call_attempted,
    event_certification_id, production_lineage_id,
    baseline_ore_certification_id, baseline_fingerprint_v2, current_fingerprint_v2,
    template_version_id, template_manifest_hash, sender_profile_id,
    recipient_policy_version, recipient_set_hash, provider_id,
    runtime_build, metadata
  ) VALUES (
    p_cycle_id, p_authorisation_id, p_operator_id, p_idempotency_key,
    'READY_FOR_PROVIDER', 'NOT_ENTERED', false,
    p_event_certification_id, p_production_lineage_id,
    p_baseline_ore_certification_id, p_baseline_fingerprint_v2, p_current_fingerprint_v2,
    p_template_version_id, p_template_manifest_hash, p_sender_profile_id,
    p_recipient_policy_version, p_recipient_set_hash, p_provider_id,
    p_runtime_build, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, false, 'READY_FOR_PROVIDER'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public._comm_hub_revalidation_prepare_execution(
  UUID, UUID, UUID, TEXT, UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_prepare_execution(
  UUID, UUID, UUID, TEXT, UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, TEXT, JSONB
) TO service_role;


CREATE OR REPLACE FUNCTION public._comm_hub_revalidation_mark_pre_provider_failure(
  p_execution_id UUID,
  p_failure_code TEXT,
  p_failure_detail JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
  execution_id UUID,
  state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_attempted BOOLEAN;
BEGIN
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT provider_call_attempted INTO v_attempted
    FROM public.communication_hub_revalidation_execution
    WHERE id = p_execution_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXECUTION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_attempted THEN
    RAISE EXCEPTION 'PROVIDER_BOUNDARY_ALREADY_ENTERED_CANNOT_MARK_PRE_PROVIDER'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.communication_hub_revalidation_execution
    SET state = 'FAILED_PRE_PROVIDER',
        provider_boundary_state = 'NOT_ENTERED',
        provider_call_attempted = false,
        failure_code = p_failure_code,
        failure_detail = COALESCE(p_failure_detail, '{}'::jsonb)
    WHERE id = p_execution_id;

  RETURN QUERY SELECT p_execution_id, 'FAILED_PRE_PROVIDER'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public._comm_hub_revalidation_mark_pre_provider_failure(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._comm_hub_revalidation_mark_pre_provider_failure(UUID, TEXT, JSONB)
  TO service_role;

COMMENT ON TABLE public.communication_hub_revalidation_execution IS
  'A4.1: durable per-attempt controlled-revalidation execution record. Provider-boundary state, fingerprints, resolver bindings and idempotency live here — distinct from communication_request.id. Writes only via service-role RPCs.';