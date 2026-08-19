-- Omni-Comms — external provider approval authority.
ALTER TABLE public.omni_comms_template_provider_registration
  ADD COLUMN IF NOT EXISTS verification_mode text NOT NULL DEFAULT 'manual_attestation',
  ADD COLUMN IF NOT EXISTS provider_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_error_code text;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_template_provider_registration
    ADD CONSTRAINT omni_comms_tpr_verification_mode_chk
    CHECK (verification_mode IN ('manual_attestation','provider_verified'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.omni_comms_template_provider_registration
  DROP CONSTRAINT IF EXISTS omni_comms_template_provider_registration_provider_status_check;
ALTER TABLE public.omni_comms_template_provider_registration
  ADD CONSTRAINT omni_comms_template_provider_registration_provider_status_check
  CHECK (provider_status IN ('draft','submitted','pending','approved','rejected','paused','disabled'));

COMMENT ON COLUMN public.omni_comms_template_provider_registration.verification_mode IS
  'manual_attestation = an internal operator asserted the provider state. provider_verified = written by server-side provider reconciliation only.';

CREATE OR REPLACE FUNCTION public.omni_comms_template_provider_registration_attest(
  p_id uuid, p_provider_template_ref text, p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_template_provider_registration; v_ref text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('approve_templates');
  SELECT * INTO v_row FROM public.omni_comms_template_provider_registration WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='registration_not_found'; END IF;
  IF v_row.verification_mode = 'provider_verified' THEN
    RAISE EXCEPTION 'OC403 forbidden' USING ERRCODE='P0001', DETAIL='provider_verified_not_operator_editable'; END IF;
  v_ref := NULLIF(btrim(COALESCE(p_provider_template_ref, v_row.provider_template_ref, '')),'');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_template_ref_required'; END IF;
  IF v_row.adapter_key = 'twilio_whatsapp' AND v_ref !~ '^HX[0-9a-fA-F]{32}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_template_ref_invalid'; END IF;

  UPDATE public.omni_comms_template_provider_registration
     SET provider_status='approved', verification_mode='manual_attestation',
         provider_template_ref = v_ref, approved_at = now(),
         rejected_at = NULL, rejection_code = NULL, rejection_reason = NULL,
         last_checked_at = now(), updated_at = now(), updated_by = v_uid
   WHERE id = p_id RETURNING * INTO v_row;

  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'attest_provider_registration', 'template_provider_registration', v_row.id,
    v_row.adapter_key, NULL,
    jsonb_build_object('provider_status','approved','verification_mode','manual_attestation'),
    NULL, NULL, p_correlation_id);
  RETURN to_jsonb(v_row);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_approve(uuid,text,text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_approve(uuid,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_attest(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_provider_registration_attest(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_template_provider_registration_reconcile(
  p_id uuid,
  p_provider_status text,
  p_provider_template_ref text DEFAULT NULL,
  p_provider_evidence jsonb DEFAULT '{}'::jsonb,
  p_error_code text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_row public.omni_comms_template_provider_registration; v_status text; v_ev jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'OC403 forbidden' USING ERRCODE='P0001', DETAIL='reconciliation_is_server_only'; END IF;

  v_status := lower(btrim(coalesce(p_provider_status,'')));
  IF v_status NOT IN ('pending','approved','rejected','paused','disabled') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_status_invalid'; END IF;

  SELECT * INTO v_row FROM public.omni_comms_template_provider_registration WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='registration_not_found'; END IF;

  v_ev := jsonb_strip_nulls(jsonb_build_object(
    'provider_status', v_status,
    'provider_template_ref', left(coalesce(p_provider_template_ref, v_row.provider_template_ref,''), 64),
    'checked_at', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'provider_category', coalesce(p_provider_evidence ->> 'provider_category', v_row.provider_category),
    'provider_language', coalesce(p_provider_evidence ->> 'provider_language', v_row.provider_language),
    'rejection_reason', left(coalesce(p_provider_evidence ->> 'rejection_reason',''), 200)));

  UPDATE public.omni_comms_template_provider_registration
     SET provider_status = v_status,
         verification_mode = 'provider_verified',
         provider_template_ref = coalesce(nullif(btrim(coalesce(p_provider_template_ref,'')),''), provider_template_ref),
         provider_evidence = v_ev,
         approved_at = CASE WHEN v_status = 'approved' THEN now() ELSE NULL END,
         rejected_at = CASE WHEN v_status = 'rejected' THEN now() ELSE NULL END,
         reconciliation_error_code = left(nullif(btrim(coalesce(p_error_code,'')),''), 64),
         last_checked_at = now(), last_reconciled_at = now(), updated_at = now()
   WHERE id = p_id RETURNING * INTO v_row;

  PERFORM public.omni_comms_priv_write_template_audit(
    NULL, 'reconcile_provider_registration', 'template_provider_registration', v_row.id,
    v_row.adapter_key, NULL,
    jsonb_build_object('provider_status', v_status, 'verification_mode','provider_verified'),
    NULL, NULL, p_correlation_id);
  RETURN to_jsonb(v_row);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_template_provider_registration_reconcile(uuid,text,text,jsonb,text,text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_priv_template_provider_registration_reconcile(uuid,text,text,jsonb,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_template_provider_registration_reconcile(uuid,text,text,jsonb,text,text) TO service_role;