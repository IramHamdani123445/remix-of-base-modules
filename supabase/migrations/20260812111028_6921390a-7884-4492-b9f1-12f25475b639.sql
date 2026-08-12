DO $mig$
DECLARE
  v_src text;
  v_old text := $q$jsonb_build_object('sequence',10,'code','provider_credentials_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account pa WHERE pa.id=v_provider_account AND pa.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail','Provider credentials verified.')$q$;
  v_new text := $q$jsonb_build_object('sequence',10,'code','provider_credentials_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account pa WHERE pa.id=v_provider_account AND public.omni_comms_provider_credential_send_ready(pa.verification_status, pa.verification_result_code)) THEN 'passed' ELSE 'failed' END,'detail','Provider credentials are sending-ready (verified, or a restricted sending-only provider key authenticated by the provider).')$q$;
BEGIN
  SELECT pg_get_functiondef('public.omni_comms_priv_channel_release_prerequisites(uuid,uuid,text,uuid,text)'::regprocedure) INTO v_src;
  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'prerequisite_sequence_10_marker_not_found';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END
$mig$;

DO $chk$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef('public.omni_comms_priv_channel_release_prerequisites(uuid,uuid,text,uuid,text)'::regprocedure) INTO v_src;
  IF position('omni_comms_provider_credential_send_ready' in v_src) = 0 THEN
    RAISE EXCEPTION 'prerequisite_sequence_10_not_updated';
  END IF;
END
$chk$;