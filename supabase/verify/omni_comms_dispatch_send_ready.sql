-- Omni-Comms — executable regression against the FINAL DEPLOYED dispatch claim.
--
-- Proves, against the live catalogue (not source files), that:
--   1. exactly one omni_comms_priv_dispatch_claim_email exists;
--   2. it gates sending on the canonical send-ready predicate;
--   3. it does NOT require full Resend access (verification_status = 'verified');
--   4. a restricted (sending-only) credential is send ready.
DO $$
DECLARE
  v_src text;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_dispatch_claim_email';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one dispatch claim function, found %', v_count;
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_dispatch_claim_email';

  IF position('omni_comms_provider_credential_send_ready' in v_src) = 0 THEN
    RAISE EXCEPTION 'dispatch claim no longer uses the canonical send-ready predicate';
  END IF;

  IF v_src ~ 'verification_status\s*=\s*''verified''' THEN
    RAISE EXCEPTION 'dispatch claim regressed to requiring full provider access';
  END IF;

  IF NOT public.omni_comms_provider_credential_send_ready('pending', 'restricted_api_key') THEN
    RAISE EXCEPTION 'a restricted (sending-only) credential must be send ready';
  END IF;

  IF NOT public.omni_comms_priv_business_dispatch_installed() THEN
    RAISE EXCEPTION 'business dispatcher reported as not installed';
  END IF;
END $$;
