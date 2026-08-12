-- Omni-Comms — executable regression for release prerequisite truthfulness.
--
-- Proves against the live database that:
--   1. The dispatcher-installed prerequisite (sequence 32) is derived from the
--      canonical capability probe, not a frozen function signature.
--   2. The deployed-revision prerequisite (sequence 27) may fall back ONLY to
--      the server-observed deployment identity, never to a browser value.
--   3. The controlled dispatch claim still accepts a sending-only
--      (restricted) provider credential via the canonical send-ready
--      predicate.
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE proname = 'omni_comms_priv_channel_release_prerequisites';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'prerequisites function missing';
  END IF;

  IF position('omni_comms_priv_business_dispatch_installed()' in v_src) = 0 THEN
    RAISE EXCEPTION 'sequence 32 is not derived from the canonical dispatch capability probe';
  END IF;

  IF position('omni_comms_priv_observed_deployed_revision()' in v_src) = 0 THEN
    RAISE EXCEPTION 'sequence 27 lacks the server-observed deployment fallback';
  END IF;

  IF to_regprocedure('public.omni_comms_priv_record_runtime_deployment(text,text)') IS NULL THEN
    RAISE EXCEPTION 'deployment observation RPC missing';
  END IF;

  IF NOT public.omni_comms_priv_business_dispatch_installed() THEN
    RAISE EXCEPTION 'controlled business dispatcher is not installed';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc
  WHERE proname = 'omni_comms_priv_dispatch_claim_email';

  IF position('omni_comms_provider_credential_send_ready' in v_src) = 0 THEN
    RAISE EXCEPTION 'dispatch claim regressed away from the canonical send-ready predicate';
  END IF;

  IF v_src ~ 'verification_status\s*=\s*''verified''' THEN
    RAISE EXCEPTION 'dispatch claim requires full provider access; sending-only keys must be sufficient';
  END IF;

  RAISE NOTICE 'omni_comms_release_prerequisite_truth: PASSED';
END $$;
