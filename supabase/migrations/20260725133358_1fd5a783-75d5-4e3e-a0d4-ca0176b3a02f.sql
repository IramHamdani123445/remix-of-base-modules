
-- =========================================================================
-- Comm Hub Go-Live Stages 6/7/8 — Foundation migration (additive)
-- =========================================================================

-- ----- Stage 6: send_context + provider_mode on execution/grant -----------

ALTER TABLE public.communication_controlled_live_execution
  ADD COLUMN IF NOT EXISTS send_context text NOT NULL DEFAULT 'STUB',
  ADD COLUMN IF NOT EXISTS provider_mode text,
  ADD COLUMN IF NOT EXISTS real_email_authorised boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccle_send_context_chk') THEN
    ALTER TABLE public.communication_controlled_live_execution
      ADD CONSTRAINT ccle_send_context_chk
      CHECK (send_context IN ('STUB','REAL_EMAIL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccle_provider_mode_chk') THEN
    ALTER TABLE public.communication_controlled_live_execution
      ADD CONSTRAINT ccle_provider_mode_chk
      CHECK (provider_mode IS NULL OR provider_mode IN ('stub','real'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccle_real_email_gate_chk') THEN
    ALTER TABLE public.communication_controlled_live_execution
      ADD CONSTRAINT ccle_real_email_gate_chk
      CHECK (send_context = 'STUB' OR real_email_authorised = true);
  END IF;
END $$;

ALTER TABLE public.communication_controlled_live_grant
  ADD COLUMN IF NOT EXISTS send_context text NOT NULL DEFAULT 'STUB';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cclg_send_context_chk') THEN
    ALTER TABLE public.communication_controlled_live_grant
      ADD CONSTRAINT cclg_send_context_chk
      CHECK (send_context IN ('STUB','REAL_EMAIL'));
  END IF;
END $$;

-- v2 scope hash that discriminates STUB vs REAL_EMAIL scopes
CREATE OR REPLACE FUNCTION public.comm_hub_controlled_live_scope_hash_v2(
  p_operator uuid,
  p_module text,
  p_event text,
  p_channel text,
  p_recipient_hash text,
  p_preview_approval uuid,
  p_dryrun_cert uuid,
  p_send_context text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      concat_ws('|',
        coalesce(p_operator::text,''),
        coalesce(p_module,''),
        coalesce(p_event,''),
        coalesce(p_channel,''),
        coalesce(p_recipient_hash,''),
        coalesce(p_preview_approval::text,''),
        coalesce(p_dryrun_cert::text,''),
        coalesce(p_send_context,'STUB')
      ),
      'sha256'
    ),
    'hex'
  );
$$;

GRANT EXECUTE ON FUNCTION public.comm_hub_controlled_live_scope_hash_v2(uuid,text,text,text,text,uuid,uuid,text)
  TO authenticated, service_role;

-- ----- Stage 6: platform real-email feature gate --------------------------

CREATE TABLE IF NOT EXISTS public.communication_hub_real_email_gate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  enabled boolean NOT NULL DEFAULT false,
  opened_by uuid,
  opened_at timestamptz,
  reason text,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_code, event_code, channel)
);

GRANT SELECT ON public.communication_hub_real_email_gate TO authenticated;
GRANT ALL ON public.communication_hub_real_email_gate TO service_role;
ALTER TABLE public.communication_hub_real_email_gate ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS real_email_gate_read_admin ON public.communication_hub_real_email_gate;
CREATE POLICY real_email_gate_read_admin ON public.communication_hub_real_email_gate
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_real_email_gate_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_real_email_gate_touch ON public.communication_hub_real_email_gate;
CREATE TRIGGER trg_real_email_gate_touch
  BEFORE UPDATE ON public.communication_hub_real_email_gate
  FOR EACH ROW EXECUTE FUNCTION public.tg_real_email_gate_touch();

CREATE OR REPLACE FUNCTION public.set_comm_hub_real_email_gate(
  p_module text, p_event text, p_channel text,
  p_enabled boolean, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.communication_hub_real_email_gate%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.has_role(v_uid, 'Admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 6 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  INSERT INTO public.communication_hub_real_email_gate
    (module_code,event_code,channel,enabled,opened_by,opened_at,reason,closed_by,closed_at)
  VALUES
    (p_module,p_event,coalesce(p_channel,'email'),p_enabled,
     CASE WHEN p_enabled THEN v_uid END,
     CASE WHEN p_enabled THEN now() END, p_reason,
     CASE WHEN NOT p_enabled THEN v_uid END,
     CASE WHEN NOT p_enabled THEN now() END)
  ON CONFLICT (module_code,event_code,channel) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        reason  = EXCLUDED.reason,
        opened_by = CASE WHEN EXCLUDED.enabled THEN v_uid ELSE public.communication_hub_real_email_gate.opened_by END,
        opened_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE public.communication_hub_real_email_gate.opened_at END,
        closed_by = CASE WHEN NOT EXCLUDED.enabled THEN v_uid ELSE NULL END,
        closed_at = CASE WHEN NOT EXCLUDED.enabled THEN now() ELSE NULL END
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok',true,'gate',to_jsonb(v_row));
END $$;

REVOKE ALL ON FUNCTION public.set_comm_hub_real_email_gate(text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_comm_hub_real_email_gate(text,text,text,boolean,text) TO authenticated;

-- ----- Stage 6: begin one_real_email execution ----------------------------

CREATE OR REPLACE FUNCTION public.begin_comm_hub_one_real_email(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event  text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_recipient text := p_payload->>'recipient';
  v_recipient_hash text := p_payload->>'recipient_set_hash';
  v_preview_approval uuid := (p_payload->>'preview_approval_id')::uuid;
  v_dryrun_cert uuid := (p_payload->>'dry_run_certification_id')::uuid;
  v_stub_cert_id uuid := (p_payload->>'controlled_stub_certification_id')::uuid;
  v_idempotency text := p_payload->>'idempotency_key';
  v_reason text := p_payload->>'reason';
  v_stub_cert record;
  v_gate record;
  v_provider record;
  v_scope_hash text;
  v_exec_id uuid;
  v_grant_id uuid;
  v_operating_mode text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF v_idempotency IS NULL OR length(trim(v_idempotency)) < 8 THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;

  -- Emergency stop / operating mode
  SELECT operating_mode INTO v_operating_mode FROM public.communication_hub_control_settings LIMIT 1;
  IF v_operating_mode = 'EMERGENCY_STOP' THEN RAISE EXCEPTION 'emergency_stop_active'; END IF;
  IF v_operating_mode <> 'CONTROLLED_LIVE' THEN RAISE EXCEPTION 'operating_mode_not_controlled_live'; END IF;

  -- Real-email feature gate
  SELECT * INTO v_gate FROM public.communication_hub_real_email_gate
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel;
  IF NOT FOUND OR NOT v_gate.enabled THEN
    RAISE EXCEPTION 'real_email_gate_closed';
  END IF;

  -- Recipient discipline
  IF v_recipient IS NULL OR position(',' in v_recipient) > 0 THEN
    RAISE EXCEPTION 'exactly_one_recipient_required';
  END IF;
  IF (p_payload ? 'cc') OR (p_payload ? 'bcc') THEN
    RAISE EXCEPTION 'cc_bcc_not_allowed';
  END IF;

  -- Controlled-stub certification match (canonical prerequisite)
  SELECT * INTO v_stub_cert
    FROM public.communication_controlled_live_certification
   WHERE id = v_stub_cert_id
     AND certification_kind = 'CONTROLLED_STUB'
     AND status IN ('PROVIDER_ACCEPTED','DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
     AND module_code = v_module
     AND event_code = v_event
     AND channel = v_channel
     AND recipient_set_hash = v_recipient_hash
     AND preview_approval_id = v_preview_approval
     AND dry_run_certification_id = v_dryrun_cert;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled_stub_certification_required';
  END IF;

  -- Active real provider
  SELECT * INTO v_provider FROM public.notification_providers
   WHERE channel = 'email'::notification_channel
     AND is_active = true
     AND is_default = true
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_real_provider'; END IF;

  v_scope_hash := public.comm_hub_controlled_live_scope_hash_v2(
    v_uid, v_module, v_event, v_channel, v_recipient_hash,
    v_preview_approval, v_dryrun_cert, 'REAL_EMAIL'
  );

  -- Idempotent begin
  SELECT id INTO v_exec_id FROM public.communication_controlled_live_execution
   WHERE idempotency_key = v_idempotency AND requested_by = v_uid;
  IF v_exec_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'execution_id',v_exec_id,'idempotent',true);
  END IF;

  INSERT INTO public.communication_controlled_live_execution
    (idempotency_key, scope_hash, requested_by, module_code, event_code, channel,
     recipient_set_hash, recipient, preview_snapshot_id, preview_approval_id,
     dry_run_certification_id, reason, send_context, provider_mode,
     real_email_authorised, prior_operating_mode, final_operating_mode,
     audit_metadata)
  VALUES
    (v_idempotency, v_scope_hash, v_uid, v_module, v_event, v_channel,
     v_recipient_hash, v_recipient, (p_payload->>'preview_snapshot_id')::uuid,
     v_preview_approval, v_dryrun_cert, v_reason, 'REAL_EMAIL', 'real',
     true, v_operating_mode::communication_operating_mode,
     v_operating_mode::communication_operating_mode,
     jsonb_build_object(
       'stage','SEND_ONE_REAL_EMAIL',
       'controlled_stub_certification_id', v_stub_cert_id,
       'provider_id', v_provider.id,
       'provider_name', v_provider.provider_name,
       'gate_opened_by', v_gate.opened_by
     ))
  RETURNING id INTO v_exec_id;

  INSERT INTO public.communication_controlled_live_grant
    (execution_id, module_code, event_code, channel, recipient_set_hash,
     scope_hash, preview_approval_id, dry_run_certification_id,
     configuration_version, recipient_policy_version,
     issued_by, expires_at, send_context, audit_metadata)
  VALUES
    (v_exec_id, v_module, v_event, v_channel, v_recipient_hash,
     v_scope_hash, v_preview_approval, v_dryrun_cert,
     (p_payload->>'configuration_version')::bigint,
     (p_payload->>'recipient_policy_version')::bigint,
     v_uid, now() + interval '15 minutes', 'REAL_EMAIL',
     jsonb_build_object('reason', v_reason))
  RETURNING id INTO v_grant_id;

  UPDATE public.communication_controlled_live_execution
     SET state='AUTHORISED', controlled_live_grant_id=v_grant_id, updated_at=now()
   WHERE id = v_exec_id;

  RETURN jsonb_build_object(
    'ok',true,
    'execution_id',v_exec_id,
    'grant_id',v_grant_id,
    'scope_hash',v_scope_hash,
    'provider_id',v_provider.id,
    'provider_name',v_provider.provider_name,
    'send_context','REAL_EMAIL',
    'provider_mode','real',
    'real_email_authorised',true
  );
END $$;

REVOKE ALL ON FUNCTION public.begin_comm_hub_one_real_email(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_comm_hub_one_real_email(jsonb) TO authenticated, service_role;

-- ----- Stage 6: finalize one_real_email (issue cert) ----------------------

CREATE OR REPLACE FUNCTION public.finalize_comm_hub_one_real_email(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exec_id uuid := (p_payload->>'execution_id')::uuid;
  v_exec record;
  v_cert_id uuid;
  v_provider_outcome text := p_payload->>'provider_outcome';
  v_provider_status text := p_payload->>'provider_status';
BEGIN
  SELECT * INTO v_exec FROM public.communication_controlled_live_execution WHERE id=v_exec_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'execution_not_found'; END IF;
  IF v_exec.send_context <> 'REAL_EMAIL' THEN RAISE EXCEPTION 'execution_not_real_email'; END IF;
  IF v_exec.provider_call_attempted IS NOT TRUE THEN RAISE EXCEPTION 'provider_not_invoked'; END IF;
  IF v_provider_outcome NOT IN ('PROVIDER_ACCEPTED','DELIVERY_PENDING','DELIVERED') THEN
    RAISE EXCEPTION 'invalid_provider_outcome';
  END IF;

  INSERT INTO public.communication_controlled_live_certification
    (execution_id, module_code, event_code, channel, recipient_set_hash,
     preview_snapshot_id, preview_approval_id, dry_run_certification_id,
     request_id, message_id, delivery_attempt_id, trace_id,
     provider_name, provider_message_id, provider_outcome, provider_status,
     status, configuration_version, recipient_policy_version,
     operating_mode_prior, operating_mode_final, cleanup_succeeded,
     certified_by, certification_kind)
  VALUES
    (v_exec_id, v_exec.module_code, v_exec.event_code, v_exec.channel,
     v_exec.recipient_set_hash, v_exec.preview_snapshot_id,
     v_exec.preview_approval_id, v_exec.dry_run_certification_id,
     v_exec.request_id, v_exec.message_id, v_exec.delivery_attempt_id,
     v_exec.trace_id, v_exec.provider_name, v_exec.provider_message_id,
     v_provider_outcome, v_provider_status, v_provider_outcome,
     v_exec.configuration_version::int, v_exec.recipient_policy_version::int,
     v_exec.prior_operating_mode::text, v_exec.final_operating_mode::text,
     true, v_exec.requested_by, 'ONE_REAL_EMAIL')
  RETURNING id INTO v_cert_id;

  UPDATE public.communication_controlled_live_execution
     SET state = CASE v_provider_outcome
                   WHEN 'DELIVERED' THEN 'DELIVERED'::communication_controlled_live_state
                   WHEN 'DELIVERY_PENDING' THEN 'DELIVERY_PENDING'::communication_controlled_live_state
                   ELSE 'PROVIDER_ACCEPTED'::communication_controlled_live_state
                 END,
         completed_at = now(), updated_at = now()
   WHERE id = v_exec_id;

  RETURN jsonb_build_object('ok',true,'certification_id',v_cert_id,
    'certification_kind','ONE_REAL_EMAIL',
    'provider_outcome',v_provider_outcome,
    'provider_mode','real','real_email_authorised',true,
    'provider_call_attempted',true);
END $$;

REVOKE ALL ON FUNCTION public.finalize_comm_hub_one_real_email(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_comm_hub_one_real_email(jsonb) TO service_role;

-- =========================================================================
-- Stage 7 — Event certification manifest
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.communication_hub_event_certification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  status text NOT NULL,
  controlled_stub_certification_id uuid NOT NULL
    REFERENCES public.communication_controlled_live_certification(id),
  one_real_email_certification_id uuid NOT NULL
    REFERENCES public.communication_controlled_live_certification(id),
  configuration_version bigint,
  recipient_policy_version bigint,
  template_version_id uuid,
  template_manifest_hash text,
  sender_profile_id uuid,
  recipient_set_hash text,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  drift_detected_at timestamptz,
  drift_reason text,
  suspended_at timestamptz,
  automation_certified_at timestamptz,
  automation_certified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_code, event_code, channel),
  CONSTRAINT chec_status_chk CHECK (status IN ('live_manual_only','live_cron_allowed','SUSPENDED','REVOKED'))
);

GRANT SELECT ON public.communication_hub_event_certification TO authenticated;
GRANT ALL ON public.communication_hub_event_certification TO service_role;
ALTER TABLE public.communication_hub_event_certification ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chec_read_admin ON public.communication_hub_event_certification;
CREATE POLICY chec_read_admin ON public.communication_hub_event_certification
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_chec_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_chec_touch ON public.communication_hub_event_certification;
CREATE TRIGGER trg_chec_touch
  BEFORE UPDATE ON public.communication_hub_event_certification
  FOR EACH ROW EXECUTE FUNCTION public.tg_chec_touch();

CREATE OR REPLACE FUNCTION public.certify_comm_hub_event_manual_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_ore_cert_id uuid := (p_payload->>'one_real_email_certification_id')::uuid;
  v_reason text := p_payload->>'reason';
  v_ore record;
  v_stub_cert_id uuid;
  v_row_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v_ore
    FROM public.communication_controlled_live_certification
   WHERE id = v_ore_cert_id AND certification_kind='ONE_REAL_EMAIL'
     AND module_code=v_module AND event_code=v_event AND channel=v_channel
     AND status IN ('PROVIDER_ACCEPTED','DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY');
  IF NOT FOUND THEN RAISE EXCEPTION 'one_real_email_certification_required'; END IF;

  IF v_ore.status = 'PROVIDER_ACCEPTED'
     AND coalesce(v_ore.manual_verification_status,'') <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'inbox_confirmation_required';
  END IF;

  -- Trace back to the stub cert via the execution's audit metadata
  SELECT (audit_metadata->>'controlled_stub_certification_id')::uuid
    INTO v_stub_cert_id
    FROM public.communication_controlled_live_execution
   WHERE id = v_ore.execution_id;
  IF v_stub_cert_id IS NULL THEN RAISE EXCEPTION 'stub_lineage_missing'; END IF;

  INSERT INTO public.communication_hub_event_certification
    (module_code,event_code,channel,status,
     controlled_stub_certification_id, one_real_email_certification_id,
     configuration_version, recipient_policy_version,
     template_version_id, template_manifest_hash,
     sender_profile_id, recipient_set_hash,
     approved_by, reason)
  VALUES
    (v_module, v_event, v_channel, 'live_manual_only',
     v_stub_cert_id, v_ore_cert_id,
     v_ore.configuration_version, v_ore.recipient_policy_version,
     (p_payload->>'template_version_id')::uuid,
     p_payload->>'template_manifest_hash',
     (p_payload->>'sender_profile_id')::uuid,
     v_ore.recipient_set_hash, v_uid, v_reason)
  ON CONFLICT (module_code,event_code,channel) DO UPDATE
    SET status='live_manual_only',
        controlled_stub_certification_id=EXCLUDED.controlled_stub_certification_id,
        one_real_email_certification_id=EXCLUDED.one_real_email_certification_id,
        configuration_version=EXCLUDED.configuration_version,
        recipient_policy_version=EXCLUDED.recipient_policy_version,
        template_version_id=EXCLUDED.template_version_id,
        template_manifest_hash=EXCLUDED.template_manifest_hash,
        sender_profile_id=EXCLUDED.sender_profile_id,
        recipient_set_hash=EXCLUDED.recipient_set_hash,
        approved_by=EXCLUDED.approved_by,
        approved_at=now(),
        reason=EXCLUDED.reason,
        drift_detected_at=NULL,
        drift_reason=NULL,
        suspended_at=NULL,
        automation_certified_at=NULL,
        automation_certified_by=NULL
  RETURNING id INTO v_row_id;

  INSERT INTO public.communication_hub_event_live_control
    (module_code,event_code,status,risk_level,reason,changed_by)
  VALUES (v_module,v_event,'live_manual_only','medium',v_reason,v_uid)
  ON CONFLICT (module_code,event_code) DO UPDATE
    SET status='live_manual_only', reason=EXCLUDED.reason,
        changed_by=v_uid, changed_at=now(), updated_at=now();

  RETURN jsonb_build_object('ok',true,'certification_row_id',v_row_id,'status','live_manual_only');
END $$;

REVOKE ALL ON FUNCTION public.certify_comm_hub_event_manual_production(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certify_comm_hub_event_manual_production(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.suspend_comm_hub_event_certification_on_drift(
  p_module text, p_event text, p_channel text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_updated int;
BEGIN
  UPDATE public.communication_hub_event_certification
     SET status='SUSPENDED', drift_detected_at=now(),
         drift_reason=p_reason, suspended_at=now()
   WHERE module_code=p_module AND event_code=p_event AND channel=coalesce(p_channel,'email')
     AND status IN ('live_manual_only','live_cron_allowed');
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE public.communication_hub_event_live_control
     SET status='dry_run_only', reason='drift: '||coalesce(p_reason,''),
         changed_at=now(), updated_at=now()
   WHERE module_code=p_module AND event_code=p_event
     AND status IN ('live_manual_only','live_cron_allowed');

  RETURN jsonb_build_object('ok',true,'suspended_rows',v_updated);
END $$;

REVOKE ALL ON FUNCTION public.suspend_comm_hub_event_certification_on_drift(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suspend_comm_hub_event_certification_on_drift(text,text,text,text) TO service_role;

-- =========================================================================
-- Stage 8 — Automation readiness catalog
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.communication_hub_automation_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  scheduler_ok boolean NOT NULL DEFAULT false,
  scheduler_checked_at timestamptz,
  scheduler_checked_by uuid,
  automatic_triggers_ok boolean NOT NULL DEFAULT false,
  automatic_triggers_checked_at timestamptz,
  automatic_triggers_checked_by uuid,
  retry_worker_ok boolean NOT NULL DEFAULT false,
  retry_worker_checked_at timestamptz,
  retry_worker_checked_by uuid,
  dead_letter_ok boolean NOT NULL DEFAULT false,
  dead_letter_checked_at timestamptz,
  dead_letter_checked_by uuid,
  rate_limits_ok boolean NOT NULL DEFAULT false,
  rate_limits_checked_at timestamptz,
  rate_limits_checked_by uuid,
  batch_limits_ok boolean NOT NULL DEFAULT false,
  batch_limits_checked_at timestamptz,
  batch_limits_checked_by uuid,
  provider_circuit_breaker_ok boolean NOT NULL DEFAULT false,
  provider_circuit_breaker_checked_at timestamptz,
  provider_circuit_breaker_checked_by uuid,
  emergency_stop_ok boolean NOT NULL DEFAULT false,
  emergency_stop_checked_at timestamptz,
  emergency_stop_checked_by uuid,
  alerting_monitoring_ok boolean NOT NULL DEFAULT false,
  alerting_monitoring_checked_at timestamptz,
  alerting_monitoring_checked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_code, event_code, channel)
);

GRANT SELECT ON public.communication_hub_automation_readiness TO authenticated;
GRANT ALL ON public.communication_hub_automation_readiness TO service_role;
ALTER TABLE public.communication_hub_automation_readiness ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS char_read_admin ON public.communication_hub_automation_readiness;
CREATE POLICY char_read_admin ON public.communication_hub_automation_readiness
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_char_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_char_touch ON public.communication_hub_automation_readiness;
CREATE TRIGGER trg_char_touch
  BEFORE UPDATE ON public.communication_hub_automation_readiness
  FOR EACH ROW EXECUTE FUNCTION public.tg_char_touch();

CREATE OR REPLACE FUNCTION public.record_comm_hub_automation_readiness_check(
  p_module text, p_event text, p_channel text, p_check text, p_ok boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_sql text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF p_check NOT IN ('scheduler','automatic_triggers','retry_worker','dead_letter',
                     'rate_limits','batch_limits','provider_circuit_breaker',
                     'emergency_stop','alerting_monitoring') THEN
    RAISE EXCEPTION 'unknown_check';
  END IF;

  INSERT INTO public.communication_hub_automation_readiness (module_code,event_code,channel)
  VALUES (p_module,p_event,coalesce(p_channel,'email'))
  ON CONFLICT (module_code,event_code,channel) DO NOTHING;

  v_sql := format(
    'UPDATE public.communication_hub_automation_readiness
        SET %1$I_ok=$1, %1$I_checked_at=now(), %1$I_checked_by=$2, updated_at=now()
      WHERE module_code=$3 AND event_code=$4 AND channel=$5',
    p_check);
  EXECUTE v_sql USING p_ok, v_uid, p_module, p_event, coalesce(p_channel,'email');

  RETURN jsonb_build_object('ok',true,'check',p_check,'value',p_ok);
END $$;

REVOKE ALL ON FUNCTION public.record_comm_hub_automation_readiness_check(text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_comm_hub_automation_readiness_check(text,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.certify_comm_hub_event_automated_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_reason text := p_payload->>'reason';
  v_min_manual_sends int := coalesce((p_payload->>'min_manual_sends')::int, 1);
  v_manual_success_count int;
  v_current record;
  v_ready record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v_current FROM public.communication_hub_event_certification
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel;
  IF NOT FOUND OR v_current.status <> 'live_manual_only' THEN
    RAISE EXCEPTION 'manual_production_certification_required';
  END IF;

  SELECT count(*) INTO v_manual_success_count
    FROM public.communication_message m
   WHERE m.module_code=v_module AND m.event_code=v_event
     AND m.created_at > v_current.approved_at
     AND m.status IN ('sent','delivered');
  IF v_manual_success_count < v_min_manual_sends THEN
    RAISE EXCEPTION 'insufficient_manual_observation';
  END IF;

  SELECT * INTO v_ready FROM public.communication_hub_automation_readiness
    WHERE module_code=v_module AND event_code=v_event AND channel=v_channel;
  IF NOT FOUND
     OR NOT (v_ready.scheduler_ok AND v_ready.automatic_triggers_ok
             AND v_ready.retry_worker_ok AND v_ready.dead_letter_ok
             AND v_ready.rate_limits_ok AND v_ready.batch_limits_ok
             AND v_ready.provider_circuit_breaker_ok
             AND v_ready.emergency_stop_ok AND v_ready.alerting_monitoring_ok) THEN
    RAISE EXCEPTION 'automation_readiness_incomplete';
  END IF;

  UPDATE public.communication_hub_event_certification
     SET status='live_cron_allowed',
         automation_certified_at=now(),
         automation_certified_by=v_uid,
         reason=v_reason
   WHERE id = v_current.id;

  UPDATE public.communication_hub_event_live_control
     SET status='live_cron_allowed', reason=v_reason,
         changed_by=v_uid, changed_at=now(), updated_at=now()
   WHERE module_code=v_module AND event_code=v_event;

  RETURN jsonb_build_object('ok',true,'status','live_cron_allowed');
END $$;

REVOKE ALL ON FUNCTION public.certify_comm_hub_event_automated_production(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certify_comm_hub_event_automated_production(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_comm_hub_event_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text := p_payload->>'module_code';
  v_event text := p_payload->>'event_code';
  v_channel text := coalesce(p_payload->>'channel','email');
  v_target text := p_payload->>'target_status';
  v_reason text := p_payload->>'reason';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF v_target NOT IN ('live_manual_only','dry_run_only','SUSPENDED') THEN
    RAISE EXCEPTION 'invalid_target_status';
  END IF;
  IF v_reason IS NULL OR length(trim(v_reason)) < 6 THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.communication_hub_event_certification
     SET status = CASE WHEN v_target='SUSPENDED' THEN 'SUSPENDED'
                       WHEN v_target='live_manual_only' THEN 'live_manual_only'
                       ELSE 'SUSPENDED' END,
         suspended_at = CASE WHEN v_target IN ('SUSPENDED','dry_run_only') THEN now() ELSE NULL END,
         automation_certified_at = NULL,
         automation_certified_by = NULL,
         reason = v_reason
   WHERE module_code=v_module AND event_code=v_event AND channel=v_channel;

  UPDATE public.communication_hub_event_live_control
     SET status = CASE v_target WHEN 'live_manual_only' THEN 'live_manual_only'
                                ELSE 'dry_run_only' END,
         reason = v_reason, changed_by=v_uid, changed_at=now(), updated_at=now()
   WHERE module_code=v_module AND event_code=v_event;

  RETURN jsonb_build_object('ok',true,'status',v_target);
END $$;

REVOKE ALL ON FUNCTION public.rollback_comm_hub_event_production(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rollback_comm_hub_event_production(jsonb) TO authenticated;
