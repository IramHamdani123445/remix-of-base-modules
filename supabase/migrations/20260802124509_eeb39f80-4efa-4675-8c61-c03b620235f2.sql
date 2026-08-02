-- =====================================================================
-- Omni-Comms C5B — Controlled provider test delivery (Email / Resend)
--
-- Preserves every C5A / C5A.1 zero-send guarantee: the configuration
-- preflight still never sends. Controlled delivery is a SEPARATE, explicitly
-- approved, recipient-allow-listed action that requires a CURRENT PASSED
-- preflight for the SAME binding and the SAME recipient.
-- Live delivery (live_delivery_enabled) remains untouched and false.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Approval controls on the channel policy
-- ---------------------------------------------------------------------
ALTER TABLE public.omni_comms_channel_setting
  ADD COLUMN IF NOT EXISTS controlled_test_delivery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS controlled_test_recipients text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS controlled_test_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS controlled_test_approved_by uuid;

ALTER TABLE public.omni_comms_channel_setting
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_controlled_test_recipients_chk;
ALTER TABLE public.omni_comms_channel_setting
  ADD CONSTRAINT omni_comms_channel_setting_controlled_test_recipients_chk
  CHECK (array_length(controlled_test_recipients, 1) IS NULL
         OR array_length(controlled_test_recipients, 1) <= 5);

-- ---------------------------------------------------------------------
-- 2. Delivery ledger
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.omni_comms_channel_test_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid NOT NULL REFERENCES public.omni_comms_channel_test_run(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  department_id uuid,
  channel text NOT NULL,
  binding_id uuid NOT NULL,
  provider_id uuid,
  provider_code text,
  provider_account_id uuid,
  sender_identity_id uuid,
  channel_endpoint_id uuid,
  policy_id uuid,
  from_address text,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  configuration_fingerprint text NOT NULL,
  target_type text NOT NULL,
  target_masked text NOT NULL,
  target_hash text NOT NULL,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','failed')),
  result_code text,
  provider_message_id text,
  provider_status_code integer,
  provider_response jsonb,
  error_code text,
  error_detail text,
  correlation_id text,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_channel_test_delivery_idem_uk
  ON public.omni_comms_channel_test_delivery (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS omni_comms_channel_test_delivery_binding_ix
  ON public.omni_comms_channel_test_delivery (organization_id, channel, binding_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS omni_comms_channel_test_delivery_run_ix
  ON public.omni_comms_channel_test_delivery (test_run_id);
CREATE INDEX IF NOT EXISTS omni_comms_channel_test_delivery_msg_ix
  ON public.omni_comms_channel_test_delivery (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

REVOKE ALL ON public.omni_comms_channel_test_delivery FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omni_comms_channel_test_delivery TO service_role;
ALTER TABLE public.omni_comms_channel_test_delivery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS omni_comms_channel_test_delivery_service_role
  ON public.omni_comms_channel_test_delivery;
CREATE POLICY omni_comms_channel_test_delivery_service_role
  ON public.omni_comms_channel_test_delivery FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 3. Callback evidence
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.omni_comms_channel_test_delivery_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL
    REFERENCES public.omni_comms_channel_test_delivery(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  channel text NOT NULL,
  event_type text NOT NULL,
  provider_event_id text,
  provider_message_id text,
  signature_verified boolean NOT NULL DEFAULT false,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_channel_test_delivery_event_uk
  ON public.omni_comms_channel_test_delivery_event (delivery_id, event_type, coalesce(provider_event_id,''));
CREATE INDEX IF NOT EXISTS omni_comms_channel_test_delivery_event_ix
  ON public.omni_comms_channel_test_delivery_event (delivery_id, received_at DESC);

REVOKE ALL ON public.omni_comms_channel_test_delivery_event FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omni_comms_channel_test_delivery_event TO service_role;
ALTER TABLE public.omni_comms_channel_test_delivery_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS omni_comms_channel_test_delivery_event_service_role
  ON public.omni_comms_channel_test_delivery_event;
CREATE POLICY omni_comms_channel_test_delivery_event_service_role
  ON public.omni_comms_channel_test_delivery_event FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 4. Guard: a completed delivery is immutable except for provider evidence
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_delete_forbidden';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_result_immutable';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.test_run_id <> OLD.test_run_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.binding_id <> OLD.binding_id
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.request_fingerprint <> OLD.request_fingerprint
     OR NEW.target_hash <> OLD.target_hash
     OR NEW.payload_hash <> OLD.payload_hash THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_identity_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS omni_comms_channel_test_delivery_guard_trg
  ON public.omni_comms_channel_test_delivery;
CREATE TRIGGER omni_comms_channel_test_delivery_guard_trg
  BEFORE UPDATE OR DELETE ON public.omni_comms_channel_test_delivery
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_channel_test_delivery_guard();

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_event_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','public' AS $$
BEGIN
  RAISE EXCEPTION 'OC409 immutable_evidence'
    USING ERRCODE='P0001', DETAIL='test_delivery_event_immutable';
END; $$;

DROP TRIGGER IF EXISTS omni_comms_channel_test_delivery_event_guard_trg
  ON public.omni_comms_channel_test_delivery_event;
CREATE TRIGGER omni_comms_channel_test_delivery_event_guard_trg
  BEFORE UPDATE OR DELETE ON public.omni_comms_channel_test_delivery_event
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_channel_test_delivery_event_guard();

-- ---------------------------------------------------------------------
-- 5. Bounded projection
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_json(
  r public.omni_comms_channel_test_delivery,
  p_include_detail boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql STABLE
SET search_path TO 'pg_catalog','public' AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'test_run_id', r.test_run_id,
    'organization_id', r.organization_id,
    'department_id', r.department_id,
    'channel', r.channel,
    'binding_id', r.binding_id,
    'provider_code', r.provider_code,
    'provider_account_id', r.provider_account_id,
    'sender_identity_id', r.sender_identity_id,
    'channel_endpoint_id', r.channel_endpoint_id,
    'policy_id', r.policy_id,
    'from_address', r.from_address,
    'idempotency_key', r.idempotency_key,
    'request_fingerprint', r.request_fingerprint,
    'configuration_fingerprint', r.configuration_fingerprint,
    'target_type', r.target_type,
    'target_masked', r.target_masked,
    'payload_summary', r.payload_summary,
    'status', r.status,
    'result_code', r.result_code,
    'provider_message_id', r.provider_message_id,
    'provider_status_code', r.provider_status_code,
    'provider_response', CASE WHEN p_include_detail THEN r.provider_response ELSE NULL END,
    'error_code', r.error_code,
    'error_detail', CASE WHEN p_include_detail THEN r.error_detail ELSE NULL END,
    'correlation_id', r.correlation_id,
    'requested_by', r.requested_by,
    'requested_at', r.requested_at,
    'completed_at', r.completed_at,
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id,
               'event_type', e.event_type,
               'provider_event_id', e.provider_event_id,
               'signature_verified', e.signature_verified,
               'occurred_at', e.occurred_at,
               'received_at', e.received_at,
               'payload_summary', e.payload_summary)
             ORDER BY e.received_at)
        FROM public.omni_comms_channel_test_delivery_event e
       WHERE e.delivery_id = r.id), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- 6. Approval RPC (operator, capability-checked)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_set_approval(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_enabled boolean DEFAULT false,
  p_recipients text[] DEFAULT '{}'::text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_uid uuid;
  v_ch text := btrim(coalesce(p_channel,''));
  v_clean text[] := '{}'::text[];
  v_item text;
  v_policy public.omni_comms_channel_setting%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='controlled_delivery_email_only'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  FOREACH v_item IN ARRAY coalesce(p_recipients, '{}'::text[]) LOOP
    v_item := lower(btrim(v_item));
    CONTINUE WHEN v_item = '';
    IF v_item !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'OC422 validation_error'
        USING ERRCODE='P0001', DETAIL='invalid_test_recipient'; END IF;
    IF NOT (v_item = ANY(v_clean)) THEN v_clean := array_append(v_clean, v_item); END IF;
  END LOOP;

  IF array_length(v_clean,1) > 5 THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='too_many_test_recipients'; END IF;
  IF p_enabled AND coalesce(array_length(v_clean,1),0) = 0 THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='approved_recipient_required'; END IF;

  SELECT * INTO v_policy FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id
     AND channel = v_ch
     AND department_id IS NOT DISTINCT FROM p_department_id
     AND coalesce(data_origin,'') <> 'reference_seed'
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='effective_policy_missing'; END IF;

  UPDATE public.omni_comms_channel_setting
     SET controlled_test_delivery_enabled = coalesce(p_enabled,false),
         controlled_test_recipients = v_clean,
         controlled_test_approved_at = CASE WHEN coalesce(p_enabled,false) THEN now() ELSE NULL END,
         controlled_test_approved_by = CASE WHEN coalesce(p_enabled,false) THEN v_uid ELSE NULL END,
         updated_at = now(),
         updated_by = v_uid
   WHERE id = v_policy.id
   RETURNING * INTO v_policy;

  RETURN jsonb_build_object(
    'policy_id', v_policy.id,
    'controlled_test_delivery_enabled', v_policy.controlled_test_delivery_enabled,
    'controlled_test_recipients', to_jsonb(v_policy.controlled_test_recipients),
    'controlled_test_approved_at', v_policy.controlled_test_approved_at,
    'live_delivery_enabled', v_policy.live_delivery_enabled);
END; $$;

-- ---------------------------------------------------------------------
-- 7. Prepare RPC — authorises and reserves a controlled delivery
--     Returns the dispatch context (secret REFERENCE name only, never a key).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_prepare(
  p_test_run_id uuid,
  p_target text,
  p_idempotency_key text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_uid uuid;
  v_run public.omni_comms_channel_test_run%ROWTYPE;
  v_binding public.omni_comms_sender_provider_binding%ROWTYPE;
  v_account public.omni_comms_provider_account%ROWTYPE;
  v_identity public.omni_comms_sender_identity%ROWTYPE;
  v_policy public.omni_comms_channel_setting%ROWTYPE;
  v_provider_code text;
  v_target text := lower(btrim(coalesce(p_target,'')));
  v_target_hash text;
  v_cfg_fp text;
  v_fp text;
  v_secret text;
  v_existing public.omni_comms_channel_test_delivery%ROWTYPE;
  v_row public.omni_comms_channel_test_delivery%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_test_run_id IS NULL OR coalesce(btrim(p_idempotency_key),'') = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_input'; END IF;

  SELECT * INTO v_run FROM public.omni_comms_channel_test_run WHERE id = p_test_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='test_run_not_found'; END IF;

  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_run.organization_id, v_run.department_id);

  IF v_run.channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='controlled_delivery_email_only'; END IF;
  IF v_run.status <> 'passed' THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='preflight_not_passed'; END IF;

  v_cfg_fp := public.omni_comms_priv_channel_test_config_fingerprint(
    v_run.organization_id, v_run.department_id, v_run.channel, v_run.binding_id);
  IF v_cfg_fp IS DISTINCT FROM v_run.configuration_fingerprint THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='preflight_stale'; END IF;

  IF v_target = '' OR v_target !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_target'; END IF;
  v_target_hash := public.omni_comms_priv_channel_test_sha256(v_target);
  IF v_target_hash IS DISTINCT FROM v_run.target_hash THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='target_differs_from_preflight'; END IF;

  SELECT * INTO v_binding FROM public.omni_comms_sender_provider_binding WHERE id = v_run.binding_id;
  IF NOT FOUND OR v_binding.status <> 'active'
     OR coalesce(v_binding.data_origin,'') = 'reference_seed' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='binding_not_operational'; END IF;

  SELECT * INTO v_account FROM public.omni_comms_provider_account WHERE id = v_binding.provider_account_id;
  IF NOT FOUND OR v_account.status <> 'active'
     OR coalesce(v_account.data_origin,'') = 'reference_seed'
     OR v_account.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_account_not_verified'; END IF;

  SELECT code INTO v_provider_code FROM public.omni_comms_provider WHERE id = v_account.provider_id;
  IF coalesce(v_provider_code,'') <> 'resend_email' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='provider_not_supported'; END IF;

  SELECT coalesce(v_account.secret_ref, s.secret_ref) INTO v_secret
    FROM public.omni_comms_provider_account_secret_ref s
   WHERE s.provider_account_id = v_account.id
   ORDER BY s.purpose LIMIT 1;
  v_secret := coalesce(v_account.secret_ref, v_secret);
  IF coalesce(v_secret,'') !~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='secret_reference_invalid'; END IF;

  SELECT * INTO v_identity FROM public.omni_comms_sender_identity WHERE id = v_binding.sender_identity_id;
  IF NOT FOUND OR v_identity.status <> 'active'
     OR coalesce(v_identity.data_origin,'') = 'reference_seed' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='identity_not_operational'; END IF;

  SELECT * INTO v_policy FROM public.omni_comms_channel_setting
   WHERE organization_id = v_run.organization_id
     AND channel = 'email'
     AND coalesce(data_origin,'') <> 'reference_seed'
     AND (department_id IS NOT DISTINCT FROM v_run.department_id OR department_id IS NULL)
   ORDER BY (department_id IS NOT NULL) DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='effective_policy_missing'; END IF;
  IF v_policy.operational_state NOT IN ('test_only','pilot_ready') THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='policy_state_forbids_test_delivery'; END IF;
  IF coalesce(v_policy.controlled_test_delivery_enabled,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='controlled_test_delivery_not_approved'; END IF;
  IF NOT (v_target = ANY(coalesce(v_policy.controlled_test_recipients,'{}'::text[]))) THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='recipient_not_approved'; END IF;

  v_fp := public.omni_comms_priv_channel_test_sha256(
    v_run.id::text || '|' || v_target_hash || '|' || v_run.payload_hash || '|' || v_cfg_fp);

  SELECT * INTO v_existing FROM public.omni_comms_channel_test_delivery
   WHERE organization_id = v_run.organization_id
     AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fp THEN
      RAISE EXCEPTION 'OC409 idempotency_conflict'
        USING ERRCODE='P0001', DETAIL='idempotency_payload_mismatch'; END IF;
    RETURN jsonb_build_object(
      'replayed', true,
      'dispatch_required', (v_existing.status = 'pending'),
      'delivery_id', v_existing.id,
      'secret_ref', CASE WHEN v_existing.status = 'pending' THEN v_secret ELSE NULL END,
      'from_address', v_existing.from_address,
      'delivery', public.omni_comms_priv_channel_test_delivery_json(v_existing, true));
  END IF;

  INSERT INTO public.omni_comms_channel_test_delivery (
    test_run_id, organization_id, department_id, channel, binding_id,
    provider_id, provider_code, provider_account_id, sender_identity_id,
    channel_endpoint_id, policy_id, from_address, idempotency_key,
    request_fingerprint, configuration_fingerprint, target_type, target_masked,
    target_hash, payload_summary, payload_hash, status, correlation_id, requested_by)
  VALUES (
    v_run.id, v_run.organization_id, v_run.department_id, 'email', v_run.binding_id,
    v_account.provider_id, v_provider_code, v_account.id, v_identity.id,
    v_binding.channel_endpoint_id, v_policy.id, v_identity.from_address,
    btrim(p_idempotency_key), v_fp, v_cfg_fp, v_run.target_type, v_run.target_masked,
    v_target_hash, v_run.payload_summary, v_run.payload_hash, 'pending',
    nullif(btrim(coalesce(p_correlation_id,'')),''), v_uid)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'replayed', false,
    'dispatch_required', true,
    'delivery_id', v_row.id,
    'secret_ref', v_secret,
    'from_address', v_identity.from_address,
    'from_name', v_identity.from_name,
    'reply_to_address', v_identity.reply_to_address,
    'delivery', public.omni_comms_priv_channel_test_delivery_json(v_row, true));
END; $$;

-- ---------------------------------------------------------------------
-- 8. Completion RPC — service_role only (called by the edge function)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_complete(
  p_delivery_id uuid,
  p_status text,
  p_result_code text,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status_code integer DEFAULT NULL,
  p_provider_response jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_detail text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_row public.omni_comms_channel_test_delivery%ROWTYPE;
BEGIN
  IF p_status NOT IN ('accepted','failed') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_status'; END IF;

  UPDATE public.omni_comms_channel_test_delivery
     SET status = p_status,
         result_code = p_result_code,
         provider_message_id = p_provider_message_id,
         provider_status_code = p_provider_status_code,
         provider_response = p_provider_response,
         error_code = p_error_code,
         error_detail = left(coalesce(p_error_detail,''), 500),
         completed_at = now()
   WHERE id = p_delivery_id AND status = 'pending'
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='delivery_already_completed'; END IF;

  RETURN public.omni_comms_priv_channel_test_delivery_json(v_row, true);
END; $$;

-- ---------------------------------------------------------------------
-- 9. Callback RPC — service_role only (called by the webhook receiver)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_record_event(
  p_provider_message_id text,
  p_event_type text,
  p_provider_event_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL,
  p_payload_summary jsonb DEFAULT '{}'::jsonb,
  p_signature_verified boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_delivery public.omni_comms_channel_test_delivery%ROWTYPE;
  v_id uuid;
BEGIN
  IF coalesce(btrim(p_provider_message_id),'') = ''
     OR coalesce(btrim(p_event_type),'') = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_input'; END IF;

  SELECT * INTO v_delivery FROM public.omni_comms_channel_test_delivery
   WHERE provider_message_id = btrim(p_provider_message_id)
   ORDER BY requested_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false); END IF;

  INSERT INTO public.omni_comms_channel_test_delivery_event (
    delivery_id, organization_id, channel, event_type, provider_event_id,
    provider_message_id, signature_verified, occurred_at, payload_summary)
  VALUES (
    v_delivery.id, v_delivery.organization_id, v_delivery.channel,
    btrim(p_event_type), nullif(btrim(coalesce(p_provider_event_id,'')),''),
    btrim(p_provider_message_id), coalesce(p_signature_verified,false),
    p_occurred_at, coalesce(p_payload_summary,'{}'::jsonb))
  ON CONFLICT (delivery_id, event_type, coalesce(provider_event_id,'')) DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'matched', true,
    'delivery_id', v_delivery.id,
    'event_id', v_id,
    'duplicate', (v_id IS NULL));
END; $$;

-- ---------------------------------------------------------------------
-- 10. Diagnostics RPC — operator read surface
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_diagnostics(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_binding_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_uid uuid;
  v_ch text := btrim(coalesce(p_channel,''));
  v_limit integer := least(greatest(coalesce(p_limit,20),1),100);
  v_can_configure boolean;
  v_policy public.omni_comms_channel_setting%ROWTYPE;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  v_can_configure := public.has_permission(v_uid, 'omni_comms', 'configure');

  SELECT * INTO v_policy FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id
     AND channel = v_ch
     AND coalesce(data_origin,'') <> 'reference_seed'
     AND (department_id IS NOT DISTINCT FROM p_department_id OR department_id IS NULL)
   ORDER BY (department_id IS NOT NULL) DESC LIMIT 1;

  SELECT coalesce(jsonb_agg(public.omni_comms_priv_channel_test_delivery_json(d, v_can_configure)
           ORDER BY d.requested_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT * FROM public.omni_comms_channel_test_delivery
       WHERE organization_id = p_organization_id
         AND channel = v_ch
         AND (p_binding_id IS NULL OR binding_id = p_binding_id)
       ORDER BY requested_at DESC LIMIT v_limit
    ) d;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', v_ch,
    'binding_id', p_binding_id,
    'can_configure', v_can_configure,
    'controlled_test_delivery_enabled',
      coalesce(v_policy.controlled_test_delivery_enabled,false),
    'controlled_test_recipients',
      to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
    'controlled_test_approved_at', v_policy.controlled_test_approved_at,
    'live_delivery_enabled', coalesce(v_policy.live_delivery_enabled,false),
    'policy_id', v_policy.id,
    'deliveries', v_rows);
END; $$;

-- ---------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_delivery_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_delivery_event_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_delivery_json(public.omni_comms_channel_test_delivery, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_delivery_complete(uuid,text,text,text,integer,jsonb,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_delivery_record_event(text,text,text,timestamptz,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_test_delivery_complete(uuid,text,text,text,integer,jsonb,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_test_delivery_record_event(text,text,text,timestamptz,jsonb,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.omni_comms_channel_test_delivery_set_approval(uuid,uuid,text,boolean,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_channel_test_delivery_prepare(uuid,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_channel_test_delivery_diagnostics(uuid,uuid,text,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_delivery_set_approval(uuid,uuid,text,boolean,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_delivery_prepare(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_delivery_diagnostics(uuid,uuid,text,uuid,integer) TO authenticated;