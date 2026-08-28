-- DEF-16 — Final database recipient allowlist enforcement.
--
-- Proves that `public.omni_comms_priv_evaluate_dispatch_authorization` independently
-- validates the recipient hash against the SAME effective governed release allowlist
-- used by `public.omni_comms_priv_channel_release_decision`, and fails closed with the
-- bounded reason `recipient_not_allowlisted`.
--
-- Read-only against governance state. Run inside a transaction and ROLL BACK.
-- No provider call. No job creation. No live data.

BEGIN;

DO $$
DECLARE
  v_org           uuid;
  v_rev           text;
  v_known         text;
  v_unknown       text := encode(sha256('def16-unknown-recipient@example.invalid'::bytea), 'hex');
  v_res           text;
  v_rel           public.omni_comms_channel_release_control%ROWTYPE;
BEGIN
  SELECT c.organization_id, c.approved_commit
    INTO v_org, v_rev
  FROM public.omni_comms_channel_release_control c
  WHERE c.channel = 'email' AND c.release_state = 'controlled_pilot'
  ORDER BY c.release_version DESC
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE NOTICE 'DEF-16: no controlled_pilot email release present — nothing to assert.';
    RETURN;
  END IF;

  v_rel := public.omni_comms_priv_channel_release_effective(v_org, NULL, 'email');

  SELECT r->>'target_hash' INTO v_known
  FROM jsonb_array_elements(coalesce(v_rel.pilot_recipient_rules, '[]'::jsonb)) r
  LIMIT 1;

  IF v_known IS NULL THEN
    RAISE EXCEPTION 'DEF-16: effective email release has an empty recipient allowlist';
  END IF;

  -- ============ Positive: governed allowlisted recipient ==================
  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             v_known, 'simulation_email', now(), v_rev);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'DEF-16: allowlisted recipient must authorize, got %', v_res;
  END IF;

  -- Hash contract: comparison is case-insensitive on the canonical lowercase hash.
  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             upper(v_known), 'simulation_email', now(), v_rev);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'DEF-16: hash contract mismatch on case normalisation, got %', v_res;
  END IF;

  -- ============ Negative: unknown / null / empty / malformed ==============
  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             v_unknown, 'simulation_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'recipient_not_allowlisted' THEN
    RAISE EXCEPTION 'DEF-16: unknown recipient must be denied, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             NULL, 'simulation_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'recipient_not_allowlisted' THEN
    RAISE EXCEPTION 'DEF-16: NULL recipient must be denied, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             '', 'simulation_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'recipient_not_allowlisted' THEN
    RAISE EXCEPTION 'DEF-16: empty recipient must be denied, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             '   ', 'simulation_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'recipient_not_allowlisted' THEN
    RAISE EXCEPTION 'DEF-16: whitespace recipient must be denied, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             'not-a-hash', 'simulation_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'recipient_not_allowlisted' THEN
    RAISE EXCEPTION 'DEF-16: malformed recipient must be denied, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  -- ============ Recipient scope is per governed channel release ===========
  -- An email-channel allowlisted destination must not implicitly authorize the
  -- in-app channel, which carries its own governed recipient scope.
  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'in_app', 'INTERNAL_AUDIT', 'queued',
             v_known, 'internal_in_app', now(), v_rev);
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'DEF-16: email recipient hash must not authorize the in_app release scope';
  END IF;

  -- ============ Other gates remain narrowing, not widened =================
  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'BENEFITS', 'queued',
             v_known, 'simulation_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'module_not_in_pilot_scope' THEN
    RAISE EXCEPTION 'DEF-16: module scope regression, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'immediate',
             v_known, 'simulation_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'mode_not_queued' THEN
    RAISE EXCEPTION 'DEF-16: mode gate regression, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             v_known, 'resend_email', now(), v_rev);
  IF v_res IS DISTINCT FROM 'provider_not_certification_safe' THEN
    RAISE EXCEPTION 'DEF-16: live provider gate regression, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             v_known, 'simulation_email', now(), repeat('a', 40));
  IF v_res IS DISTINCT FROM 'runtime_revision_not_approved' THEN
    RAISE EXCEPTION 'DEF-16: revision gate regression, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  v_res := public.omni_comms_priv_evaluate_dispatch_authorization(
             v_org, NULL, 'email', 'INTERNAL_AUDIT', 'queued',
             v_known, 'simulation_email', timestamptz '2000-01-01', v_rev);
  IF v_res IS DISTINCT FROM 'historical_job_not_authorized' THEN
    RAISE EXCEPTION 'DEF-16: historical gate regression, got %', coalesce(v_res, 'AUTHORIZED');
  END IF;

  -- ============ Both canonical dispatch paths route through the gate ======
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_dispatch_claim_email'
      AND pg_get_functiondef(p.oid) ILIKE '%evaluate_dispatch_authorization%'
  ) THEN
    RAISE EXCEPTION 'DEF-16: email claim path does not consult the final authorization gate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_persist_rendered_messages'
      AND pg_get_functiondef(p.oid) ILIKE '%evaluate_dispatch_authorization%'
  ) THEN
    RAISE EXCEPTION 'DEF-16: runnable persistence path does not consult the final authorization gate';
  END IF;

  RAISE NOTICE 'DEF-16 recipient allowlist enforcement: PASS';
END $$;

ROLLBACK;
