CREATE OR REPLACE FUNCTION public.omni_comms_provider_credential_send_ready(
  p_verification_status text,
  p_verification_result_code text
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT coalesce(p_verification_status,'') = 'verified'
      OR (coalesce(p_verification_status,'') = 'pending'
          AND coalesce(p_verification_result_code,'') = 'restricted_api_key');
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_provider_credential_send_ready(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_provider_credential_send_ready(text,text) TO authenticated, service_role;

DO $mig$
DECLARE
  v_src text;
  v_new text;
  v_pred constant text :=
    'public.omni_comms_provider_credential_send_ready(v_account.verification_status, v_account.verification_result_code)';
BEGIN
  -- 1. Controlled test-delivery gate.
  v_src := pg_get_functiondef(
    'public.omni_comms_channel_test_delivery_prepare(uuid,text,text,text,text,text)'::regprocedure);
  v_new := replace(v_src,
    'OR v_account.verification_status <> ''verified'' THEN',
    'OR NOT ' || v_pred || ' THEN');
  IF v_new = v_src THEN
    RAISE EXCEPTION 'omni_comms gate patch failed: test_delivery_prepare predicate not found';
  END IF;
  EXECUTE v_new;

  -- 2. Live email dispatch gate.
  v_src := pg_get_functiondef(
    'public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)'::regprocedure);
  v_new := replace(v_src,
    'ELSIF coalesce(v_account.verification_status,'''') <> ''verified'' THEN',
    'ELSIF NOT ' || v_pred || ' THEN');
  IF v_new = v_src THEN
    RAISE EXCEPTION 'omni_comms gate patch failed: dispatch_claim_email predicate not found';
  END IF;
  EXECUTE v_new;
END $mig$;