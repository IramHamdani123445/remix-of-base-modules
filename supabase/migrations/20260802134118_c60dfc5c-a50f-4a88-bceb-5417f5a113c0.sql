-- ============================================================
-- Omni-Comms C5B closure — retry-safe controlled Resend test delivery
-- Scope: technical test path only. Live delivery remains disabled.
-- ============================================================

-- 1. Approval expiry / volume controls on the channel policy -----------
ALTER TABLE public.omni_comms_channel_setting
  ADD COLUMN IF NOT EXISTS controlled_test_approval_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS controlled_test_max_deliveries integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS controlled_test_min_interval_seconds integer NOT NULL DEFAULT 60;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_channel_setting
    ADD CONSTRAINT omni_comms_cs_ct_max_deliveries_chk
    CHECK (controlled_test_max_deliveries BETWEEN 1 AND 20);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_channel_setting
    ADD CONSTRAINT omni_comms_cs_ct_min_interval_chk
    CHECK (controlled_test_min_interval_seconds BETWEEN 30 AND 3600);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Delivery ledger: claim + provider-content columns -----------------
ALTER TABLE public.omni_comms_channel_test_delivery
  ADD COLUMN IF NOT EXISTS provider_payload_hash text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key text,
  ADD COLUMN IF NOT EXISTS active_claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.omni_comms_channel_test_delivery
  DROP CONSTRAINT IF EXISTS omni_comms_ctd_status_chk;
ALTER TABLE public.omni_comms_channel_test_delivery
  ADD CONSTRAINT omni_comms_ctd_status_chk
  CHECK (status IN ('pending','dispatching','accepted','failed','outcome_unknown'));

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_ctd_provider_message_uq
  ON public.omni_comms_channel_test_delivery (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 3. Provider attempt ledger (new logical object 31) -------------------
CREATE TABLE IF NOT EXISTS public.omni_comms_channel_test_delivery_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL
    REFERENCES public.omni_comms_channel_test_delivery(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  claim_token uuid NOT NULL,
  provider_idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'claimed'
    CHECK (state IN ('claimed','accepted','failed','outcome_unknown')),
  result_code text,
  provider_message_id text,
  provider_status_code integer,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_detail text,
  claimed_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, attempt_number)
);

REVOKE ALL ON public.omni_comms_channel_test_delivery_attempt FROM PUBLIC;
GRANT ALL ON public.omni_comms_channel_test_delivery_attempt TO service_role;
ALTER TABLE public.omni_comms_channel_test_delivery_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_channel_test_delivery_attempt FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_attempt_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_attempt_delete_forbidden';
  END IF;
  IF OLD.state <> 'claimed' THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_attempt_terminal_immutable';
  END IF;
  IF NEW.id <> OLD.id OR NEW.delivery_id <> OLD.delivery_id
     OR NEW.attempt_number <> OLD.attempt_number
     OR NEW.claim_token <> OLD.claim_token
     OR NEW.provider_idempotency_key <> OLD.provider_idempotency_key THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_attempt_identity_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS omni_comms_ctda_guard_trg
  ON public.omni_comms_channel_test_delivery_attempt;
CREATE TRIGGER omni_comms_ctda_guard_trg
  BEFORE UPDATE OR DELETE ON public.omni_comms_channel_test_delivery_attempt
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_channel_test_delivery_attempt_guard();

-- 4. Delivery guard: allow non-terminal transitions only ---------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_delete_forbidden';
  END IF;
  IF OLD.status NOT IN ('pending','dispatching','outcome_unknown') THEN
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
     OR NEW.payload_hash <> OLD.payload_hash
     OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
     OR NEW.provider_payload_hash IS DISTINCT FROM OLD.provider_payload_hash THEN
    RAISE EXCEPTION 'OC409 immutable_evidence'
      USING ERRCODE='P0001', DETAIL='test_delivery_identity_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- 5. Callback hardening -------------------------------------------------
ALTER TABLE public.omni_comms_channel_test_delivery_event
  DROP CONSTRAINT IF EXISTS omni_comms_ctde_event_type_chk;
ALTER TABLE public.omni_comms_channel_test_delivery_event
  ADD CONSTRAINT omni_comms_ctde_event_type_chk
  CHECK (event_type IN (
    'sent','delivered','delivery_delayed','bounced','complained',
    'opened','clicked','failed'));

ALTER TABLE public.omni_comms_channel_test_delivery_event
  DROP CONSTRAINT IF EXISTS omni_comms_ctde_signature_chk;
ALTER TABLE public.omni_comms_channel_test_delivery_event
  ADD CONSTRAINT omni_comms_ctde_signature_chk CHECK (signature_verified);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_ctde_provider_event_uq
  ON public.omni_comms_channel_test_delivery_event (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- 6. C4B effective policy resolver -------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_effective_policy(
  p_organization_id uuid, p_department_id uuid, p_channel text)
RETURNS public.omni_comms_channel_setting
LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_org public.omni_comms_channel_setting%ROWTYPE;
  v_dept public.omni_comms_channel_setting%ROWTYPE;
BEGIN
  IF p_department_id IS NOT NULL THEN
    SELECT * INTO v_dept FROM public.omni_comms_channel_setting
     WHERE organization_id = p_organization_id AND channel = p_channel
       AND department_id = p_department_id
       AND coalesce(data_origin,'') <> 'reference_seed' LIMIT 1;
    IF FOUND AND coalesce(v_dept.department_override_enabled,false) THEN
      RETURN v_dept;
    END IF;
  END IF;
  SELECT * INTO v_org FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND channel = p_channel
     AND department_id IS NULL
     AND coalesce(data_origin,'') <> 'reference_seed' LIMIT 1;
  RETURN v_org;
END; $$;

-- 7. Approval RPC (configure) ------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_channel_test_delivery_set_approval(uuid,uuid,text,boolean,text[]);

CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_set_approval(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_enabled boolean DEFAULT false,
  p_recipients text[] DEFAULT '{}'::text[],
  p_expires_in_hours integer DEFAULT 4,
  p_max_deliveries integer DEFAULT 5,
  p_min_interval_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_uid uuid;
  v_ch text := btrim(coalesce(p_channel,''));
  v_clean text[] := '{}'::text[];
  v_item text;
  v_norm jsonb;
  v_policy public.omni_comms_channel_setting%ROWTYPE;
  v_before jsonb;
  v_hours integer := coalesce(p_expires_in_hours,4);
  v_max integer := coalesce(p_max_deliveries,5);
  v_interval integer := coalesce(p_min_interval_seconds,60);
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='controlled_delivery_email_only'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  IF v_hours < 1 OR v_hours > 24 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='approval_window_out_of_range'; END IF;
  IF v_max < 1 OR v_max > 20 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_deliveries_out_of_range'; END IF;
  IF v_interval < 30 OR v_interval > 3600 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='min_interval_out_of_range'; END IF;

  FOREACH v_item IN ARRAY coalesce(p_recipients, '{}'::text[]) LOOP
    CONTINUE WHEN btrim(coalesce(v_item,'')) = '';
    v_norm := public.omni_comms_priv_channel_test_normalize_target(v_ch, v_item);
    IF (v_norm->>'valid')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_test_recipient'; END IF;
    v_item := lower(btrim(v_item));
    IF NOT (v_item = ANY(v_clean)) THEN v_clean := array_append(v_clean, v_item); END IF;
  END LOOP;

  IF coalesce(array_length(v_clean,1),0) > 5 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='too_many_test_recipients'; END IF;
  IF p_enabled AND coalesce(array_length(v_clean,1),0) = 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='approved_recipient_required'; END IF;

  SELECT * INTO v_policy FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND channel = v_ch
     AND department_id IS NOT DISTINCT FROM p_department_id
     AND coalesce(data_origin,'') <> 'reference_seed' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='effective_policy_missing'; END IF;

  v_before := jsonb_build_object(
    'controlled_test_delivery_enabled', v_policy.controlled_test_delivery_enabled,
    'controlled_test_recipients', to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
    'controlled_test_approval_expires_at', v_policy.controlled_test_approval_expires_at,
    'controlled_test_max_deliveries', v_policy.controlled_test_max_deliveries,
    'controlled_test_min_interval_seconds', v_policy.controlled_test_min_interval_seconds);

  UPDATE public.omni_comms_channel_setting
     SET controlled_test_delivery_enabled = coalesce(p_enabled,false),
         controlled_test_recipients = v_clean,
         controlled_test_approved_at = CASE WHEN coalesce(p_enabled,false) THEN now() ELSE NULL END,
         controlled_test_approved_by = CASE WHEN coalesce(p_enabled,false) THEN v_uid ELSE NULL END,
         controlled_test_approval_expires_at =
           CASE WHEN coalesce(p_enabled,false) THEN now() + make_interval(hours => v_hours) ELSE NULL END,
         controlled_test_max_deliveries = v_max,
         controlled_test_min_interval_seconds = v_interval,
         live_delivery_enabled = false,
         updated_at = now(),
         updated_by = v_uid
   WHERE id = v_policy.id
   RETURNING * INTO v_policy;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, 'set_controlled_test_approval', 'channel_test_delivery_approval',
    v_policy.id, v_ch, v_before,
    jsonb_build_object(
      'controlled_test_delivery_enabled', v_policy.controlled_test_delivery_enabled,
      'controlled_test_recipients', to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
      'controlled_test_approval_expires_at', v_policy.controlled_test_approval_expires_at,
      'controlled_test_max_deliveries', v_policy.controlled_test_max_deliveries,
      'controlled_test_min_interval_seconds', v_policy.controlled_test_min_interval_seconds),
    NULL);

  RETURN jsonb_build_object(
    'policy_id', v_policy.id,
    'controlled_test_delivery_enabled', v_policy.controlled_test_delivery_enabled,
    'controlled_test_recipients', to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
    'controlled_test_approved_at', v_policy.controlled_test_approved_at,
    'controlled_test_approval_expires_at', v_policy.controlled_test_approval_expires_at,
    'controlled_test_max_deliveries', v_policy.controlled_test_max_deliveries,
    'controlled_test_min_interval_seconds', v_policy.controlled_test_min_interval_seconds,
    'live_delivery_enabled', v_policy.live_delivery_enabled);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_test_delivery_set_approval(uuid,uuid,text,boolean,text[],integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_delivery_set_approval(uuid,uuid,text,boolean,text[],integer,integer,integer) TO authenticated;

-- 8. Prepare RPC (operate) — content bound, atomic claim ----------------
DROP FUNCTION IF EXISTS public.omni_comms_channel_test_delivery_prepare(uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_prepare(
  p_test_run_id uuid,
  p_target text,
  p_idempotency_key text,
  p_subject text,
  p_body_text text,
  p_correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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
  v_tnorm jsonb;
  v_pnorm jsonb;
  v_target_hash text;
  v_cfg_fp text;
  v_fp text;
  v_secret text;
  v_prov_subject text;
  v_prov_body text;
  v_prov_hash text;
  v_row public.omni_comms_channel_test_delivery%ROWTYPE;
  v_claim uuid;
  v_attempt integer;
  v_recent integer;
  v_last timestamptz;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('operate');
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

  -- Canonical target normalisation (identical rules to the preflight).
  v_tnorm := public.omni_comms_priv_channel_test_normalize_target('email', v_target);
  IF (v_tnorm->>'valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_target'; END IF;
  v_target_hash := v_tnorm->>'target_hash';
  IF v_target_hash IS DISTINCT FROM v_run.target_hash THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='target_differs_from_preflight'; END IF;

  -- Actual provider content must be the content that passed the preflight.
  v_pnorm := public.omni_comms_priv_channel_test_normalize_payload(
    'email', jsonb_build_object('subject', coalesce(p_subject,''), 'body', coalesce(p_body_text,'')));
  IF (v_pnorm->>'valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=coalesce(v_pnorm->>'code','payload_invalid'); END IF;
  IF (v_pnorm->>'payload_hash') IS DISTINCT FROM v_run.payload_hash THEN
    RAISE EXCEPTION 'OC409 preflight_required' USING ERRCODE='P0001', DETAIL='payload_differs_from_preflight'; END IF;

  v_prov_subject := '[TEST] ' || btrim(coalesce(p_subject,''));
  v_prov_body := coalesce(p_body_text,'')
    || E'\n\n--\nThis is a technical Omni-Comms channel test message. '
    || 'It contains no personal or case information and was not produced by the live sending path.';
  v_prov_hash := public.omni_comms_priv_channel_test_sha256(
    'email|' || jsonb_build_object('subject', v_prov_subject, 'body', v_prov_body)::text);

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

  -- Canonical credential: the api_key secret reference for the account.
  SELECT s.secret_ref INTO v_secret
    FROM public.omni_comms_provider_account_secret_ref s
   WHERE s.provider_account_id = v_account.id AND s.purpose = 'api_key'
   LIMIT 1;
  IF coalesce(v_secret,'') !~ '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='secret_reference_invalid'; END IF;

  SELECT * INTO v_identity FROM public.omni_comms_sender_identity WHERE id = v_binding.sender_identity_id;
  IF NOT FOUND OR v_identity.status <> 'active'
     OR coalesce(v_identity.data_origin,'') = 'reference_seed' THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='identity_not_operational'; END IF;

  -- C4B effective policy (department override preference).
  v_policy := public.omni_comms_priv_channel_test_effective_policy(
    v_run.organization_id, v_run.department_id, 'email');
  IF v_policy.id IS NULL THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='effective_policy_missing'; END IF;
  IF v_policy.operational_state NOT IN ('test_only','pilot_ready') THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='policy_state_forbids_test_delivery'; END IF;
  IF coalesce(v_policy.live_delivery_enabled,false) IS TRUE THEN
    RAISE EXCEPTION 'OC409 configuration_incomplete' USING ERRCODE='P0001', DETAIL='live_delivery_must_be_disabled'; END IF;
  IF coalesce(v_policy.controlled_test_delivery_enabled,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='controlled_test_delivery_not_approved'; END IF;
  IF v_policy.controlled_test_approval_expires_at IS NULL
     OR v_policy.controlled_test_approval_expires_at <= now() THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='controlled_test_approval_expired'; END IF;
  IF NOT (v_target = ANY(coalesce(v_policy.controlled_test_recipients,'{}'::text[]))) THEN
    RAISE EXCEPTION 'OC403 approval_required' USING ERRCODE='P0001', DETAIL='recipient_not_approved'; END IF;

  v_fp := public.omni_comms_priv_channel_test_sha256(
    v_run.id::text || '|' || v_target_hash || '|' || v_run.payload_hash || '|'
    || v_prov_hash || '|' || v_cfg_fp);

  SELECT * INTO v_row FROM public.omni_comms_channel_test_delivery
   WHERE organization_id = v_run.organization_id
     AND idempotency_key = btrim(p_idempotency_key)
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.request_fingerprint IS DISTINCT FROM v_fp THEN
      RAISE EXCEPTION 'OC409 idempotency_conflict'
        USING ERRCODE='P0001', DETAIL='idempotency_payload_mismatch'; END IF;
  ELSE
    -- Volume and pacing controls apply only to genuinely new deliveries.
    SELECT count(*), max(requested_at) INTO v_recent, v_last
      FROM public.omni_comms_channel_test_delivery d
     WHERE d.policy_id = v_policy.id
       AND d.requested_at >= coalesce(v_policy.controlled_test_approved_at, now() - interval '24 hours');
    IF v_recent >= coalesce(v_policy.controlled_test_max_deliveries,5) THEN
      RAISE EXCEPTION 'OC429 rate_limited'
        USING ERRCODE='P0001', DETAIL='approved_delivery_volume_exhausted'; END IF;
    IF v_last IS NOT NULL
       AND v_last > now() - make_interval(secs => coalesce(v_policy.controlled_test_min_interval_seconds,60)) THEN
      RAISE EXCEPTION 'OC429 rate_limited'
        USING ERRCODE='P0001', DETAIL='minimum_interval_not_elapsed'; END IF;

    INSERT INTO public.omni_comms_channel_test_delivery (
      test_run_id, organization_id, department_id, channel, binding_id,
      provider_id, provider_code, provider_account_id, sender_identity_id,
      channel_endpoint_id, policy_id, from_address, idempotency_key,
      request_fingerprint, configuration_fingerprint, target_type, target_masked,
      target_hash, payload_summary, payload_hash, provider_payload_hash,
      status, correlation_id, requested_by)
    VALUES (
      v_run.id, v_run.organization_id, v_run.department_id, 'email', v_run.binding_id,
      v_account.provider_id, v_provider_code, v_account.id, v_identity.id,
      v_binding.channel_endpoint_id, v_policy.id, v_identity.from_address,
      btrim(p_idempotency_key), v_fp, v_cfg_fp,
      v_tnorm->>'target_type', v_tnorm->>'target_masked',
      v_target_hash, v_pnorm->'payload_summary', v_run.payload_hash, v_prov_hash,
      'pending', nullif(btrim(coalesce(p_correlation_id,'')),''), v_uid)
    RETURNING * INTO v_row;

    UPDATE public.omni_comms_channel_test_delivery
       SET provider_idempotency_key = 'omni-test/' || v_row.id::text
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;

  -- Atomic claim. A stale worker can never take a claimed, still-live attempt.
  v_claim := gen_random_uuid();
  UPDATE public.omni_comms_channel_test_delivery d
     SET status = 'dispatching',
         active_claim_token = v_claim,
         claimed_at = now(),
         attempt_count = d.attempt_count + 1
   WHERE d.id = v_row.id
     AND d.attempt_count < 3
     AND (
       d.status = 'pending'
       OR d.status = 'outcome_unknown'
       OR (d.status = 'dispatching' AND d.claimed_at < now() - interval '2 minutes')
     )
     AND (d.status = 'pending' OR d.requested_at > now() - interval '24 hours')
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.omni_comms_channel_test_delivery
     WHERE organization_id = v_run.organization_id
       AND idempotency_key = btrim(p_idempotency_key);
    RETURN jsonb_build_object(
      'replayed', true,
      'dispatch_required', false,
      'delivery_id', v_row.id,
      'delivery', public.omni_comms_priv_channel_test_delivery_json(v_row, true));
  END IF;

  v_attempt := v_row.attempt_count;
  INSERT INTO public.omni_comms_channel_test_delivery_attempt (
    delivery_id, organization_id, attempt_number, claim_token,
    provider_idempotency_key, state, claimed_by)
  VALUES (
    v_row.id, v_row.organization_id, v_attempt, v_claim,
    v_row.provider_idempotency_key, 'claimed', v_uid);

  RETURN jsonb_build_object(
    'replayed', (v_attempt > 1),
    'dispatch_required', true,
    'delivery_id', v_row.id,
    'claim_token', v_claim,
    'attempt_number', v_attempt,
    'provider_idempotency_key', v_row.provider_idempotency_key,
    'secret_ref', v_secret,
    'from_address', v_identity.from_address,
    'from_name', v_identity.from_name,
    'reply_to_address', v_identity.reply_to_address,
    'provider_subject', v_prov_subject,
    'provider_body_text', v_prov_body,
    'delivery', public.omni_comms_priv_channel_test_delivery_json(v_row, true));
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_test_delivery_prepare(uuid,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_delivery_prepare(uuid,text,text,text,text,text) TO authenticated;

-- 9. Complete RPC — claim-bound, transport uncertainty aware ------------
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_delivery_complete(uuid,text,text,text,integer,jsonb,text,text);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_complete(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_status text,
  p_result_code text,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status_code integer DEFAULT NULL,
  p_provider_response jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_detail text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_row public.omni_comms_channel_test_delivery%ROWTYPE;
BEGIN
  IF p_status NOT IN ('accepted','failed','outcome_unknown') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_status'; END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='claim_token_required'; END IF;

  UPDATE public.omni_comms_channel_test_delivery
     SET status = p_status,
         result_code = p_result_code,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         provider_status_code = p_provider_status_code,
         provider_response = p_provider_response,
         error_code = p_error_code,
         error_detail = left(coalesce(p_error_detail,''), 500),
         active_claim_token = NULL,
         completed_at = CASE WHEN p_status = 'outcome_unknown' THEN NULL ELSE now() END
   WHERE id = p_delivery_id
     AND status = 'dispatching'
     AND active_claim_token = p_claim_token
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC409 stale_worker'
      USING ERRCODE='P0001', DETAIL='delivery_claim_no_longer_valid'; END IF;

  UPDATE public.omni_comms_channel_test_delivery_attempt
     SET state = p_status,
         result_code = p_result_code,
         provider_message_id = p_provider_message_id,
         provider_status_code = p_provider_status_code,
         response_summary = coalesce(p_provider_response,'{}'::jsonb),
         error_code = p_error_code,
         error_detail = left(coalesce(p_error_detail,''), 500),
         completed_at = now()
   WHERE delivery_id = p_delivery_id AND claim_token = p_claim_token AND state = 'claimed';

  RETURN public.omni_comms_priv_channel_test_delivery_json(v_row, true);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_delivery_complete(uuid,uuid,text,text,text,integer,jsonb,text,text) FROM PUBLIC, anon, authenticated;

-- 10. Callback recorder — verified signatures only -----------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_record_event(
  p_provider_message_id text,
  p_event_type text,
  p_provider_event_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL,
  p_payload_summary jsonb DEFAULT '{}'::jsonb,
  p_signature_verified boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_delivery public.omni_comms_channel_test_delivery%ROWTYPE;
  v_id uuid;
  v_type text := btrim(coalesce(p_event_type,''));
BEGIN
  IF coalesce(btrim(p_provider_message_id),'') = '' OR v_type = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_input'; END IF;
  IF coalesce(p_signature_verified,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OC403 signature_invalid'
      USING ERRCODE='P0001', DETAIL='callback_signature_not_verified'; END IF;
  IF v_type NOT IN ('sent','delivered','delivery_delayed','bounced','complained',
                    'opened','clicked','failed') THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='callback_event_type_unsupported'; END IF;

  SELECT * INTO v_delivery FROM public.omni_comms_channel_test_delivery
   WHERE provider_message_id = btrim(p_provider_message_id) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false); END IF;

  IF p_provider_event_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.omni_comms_channel_test_delivery_event
        WHERE provider_event_id = btrim(p_provider_event_id)) THEN
    RETURN jsonb_build_object(
      'matched', true, 'delivery_id', v_delivery.id, 'event_id', NULL, 'duplicate', true);
  END IF;

  INSERT INTO public.omni_comms_channel_test_delivery_event (
    delivery_id, organization_id, channel, event_type, provider_event_id,
    provider_message_id, signature_verified, occurred_at, payload_summary)
  VALUES (
    v_delivery.id, v_delivery.organization_id, v_delivery.channel,
    v_type, nullif(btrim(coalesce(p_provider_event_id,'')),''),
    btrim(p_provider_message_id), true,
    p_occurred_at, coalesce(p_payload_summary,'{}'::jsonb))
  ON CONFLICT (delivery_id, event_type, coalesce(provider_event_id,'')) DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'matched', true, 'delivery_id', v_delivery.id,
    'event_id', v_id, 'duplicate', (v_id IS NULL));
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_test_delivery_record_event(text,text,text,timestamptz,jsonb,boolean) FROM PUBLIC, anon, authenticated;

-- 11. Delivery projection — attempts + claim state ----------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_delivery_json(
  r public.omni_comms_channel_test_delivery, p_include_detail boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'pg_catalog','public' AS $$
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
    'provider_payload_hash', r.provider_payload_hash,
    'provider_idempotency_key', r.provider_idempotency_key,
    'attempt_count', r.attempt_count,
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
    'attempts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id,
               'attempt_number', a.attempt_number,
               'state', a.state,
               'result_code', a.result_code,
               'provider_message_id', a.provider_message_id,
               'provider_status_code', a.provider_status_code,
               'error_code', a.error_code,
               'started_at', a.started_at,
               'completed_at', a.completed_at)
             ORDER BY a.attempt_number)
        FROM public.omni_comms_channel_test_delivery_attempt a
       WHERE a.delivery_id = r.id), '[]'::jsonb),
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

-- 12. Diagnostics — effective policy + execution capability -------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_diagnostics(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email', p_binding_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_uid uuid;
  v_ch text := btrim(coalesce(p_channel,''));
  v_limit integer := least(greatest(coalesce(p_limit,20),1),100);
  v_can_configure boolean;
  v_can_execute boolean;
  v_policy public.omni_comms_channel_setting%ROWTYPE;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  v_can_configure := public.has_permission(v_uid, 'omni_comms', 'configure');
  v_can_execute := public.has_permission(v_uid, 'omni_comms', 'operate');

  v_policy := public.omni_comms_priv_channel_test_effective_policy(
    p_organization_id, p_department_id, v_ch);

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
    'can_execute', v_can_execute,
    'controlled_test_delivery_enabled',
      coalesce(v_policy.controlled_test_delivery_enabled,false),
    'controlled_test_recipients',
      to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
    'controlled_test_approved_at', v_policy.controlled_test_approved_at,
    'controlled_test_approval_expires_at', v_policy.controlled_test_approval_expires_at,
    'controlled_test_approval_active',
      (coalesce(v_policy.controlled_test_delivery_enabled,false)
       AND v_policy.controlled_test_approval_expires_at IS NOT NULL
       AND v_policy.controlled_test_approval_expires_at > now()),
    'controlled_test_max_deliveries', coalesce(v_policy.controlled_test_max_deliveries,5),
    'controlled_test_min_interval_seconds', coalesce(v_policy.controlled_test_min_interval_seconds,60),
    'live_delivery_enabled', coalesce(v_policy.live_delivery_enabled,false),
    'policy_id', v_policy.id,
    'deliveries', v_rows);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_test_delivery_diagnostics(uuid,uuid,text,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_test_delivery_diagnostics(uuid,uuid,text,uuid,integer) TO authenticated;