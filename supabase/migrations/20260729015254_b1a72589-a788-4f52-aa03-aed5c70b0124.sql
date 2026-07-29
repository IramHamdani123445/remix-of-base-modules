-- Omni-Comms Build 3 Slice 1 — runtime schema foundation

CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_channel(p_channel text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 invalid_channel: %', p_channel USING ERRCODE = 'P0001';
  END IF;
END; $$;
ALTER FUNCTION public.omni_comms_priv_validate_channel(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_channel(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_require_json_object(p_value jsonb, p_max_bytes integer)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'OC422 json_object_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_bytes IS NOT NULL AND octet_length(p_value::text) > p_max_bytes THEN
    RAISE EXCEPTION 'OC422 json_too_large' USING ERRCODE = 'P0001';
  END IF;
END; $$;
ALTER FUNCTION public.omni_comms_priv_require_json_object(jsonb, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_require_json_object(jsonb, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_channel_array(p_channels text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c text;
BEGIN
  IF p_channels IS NULL OR array_length(p_channels,1) IS NULL THEN
    RAISE EXCEPTION 'OC422 channels_required' USING ERRCODE = 'P0001';
  END IF;
  FOREACH v_c IN ARRAY p_channels LOOP
    PERFORM public.omni_comms_priv_validate_channel(v_c);
  END LOOP;
END; $$;
ALTER FUNCTION public.omni_comms_priv_validate_channel_array(text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_channel_array(text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_touch_runtime_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
ALTER FUNCTION public.omni_comms_priv_touch_runtime_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_touch_runtime_updated_at() FROM PUBLIC, anon, authenticated;

-- ============ omni_comms_event_route ============
CREATE TABLE public.omni_comms_event_route (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  event_definition_id uuid NOT NULL REFERENCES public.omni_comms_event_definition(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  template_family_id uuid NULL REFERENCES public.omni_comms_template_family(id) ON DELETE RESTRICT,
  sender_identity_id uuid NULL REFERENCES public.omni_comms_sender_identity(id) ON DELETE RESTRICT,
  sender_resolution_policy text NOT NULL DEFAULT 'explicit'
    CHECK (sender_resolution_policy IN ('explicit','event_default','organisation_default')),
  preference_policy text NOT NULL DEFAULT 'honour'
    CHECK (preference_policy IN ('honour','bypass_for_required','ignore')),
  lifecycle_state text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft','active','suspended','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  activated_at timestamptz NULL,
  activated_by uuid NULL,
  retired_at timestamptz NULL,
  retired_by uuid NULL,
  CONSTRAINT omni_comms_event_route_priority_chk CHECK (priority BETWEEN 1 AND 10000),
  CONSTRAINT omni_comms_event_route_channel_chk CHECK (channel IN ('email','sms','whatsapp','push','in_app','print'))
);
ALTER TABLE public.omni_comms_event_route OWNER TO postgres;
CREATE UNIQUE INDEX omni_comms_event_route_org_active_uk
  ON public.omni_comms_event_route (organization_id, event_definition_id, channel)
  WHERE department_id IS NULL AND lifecycle_state = 'active';
CREATE UNIQUE INDEX omni_comms_event_route_dept_active_uk
  ON public.omni_comms_event_route (organization_id, department_id, event_definition_id, channel)
  WHERE department_id IS NOT NULL AND lifecycle_state = 'active';
CREATE INDEX omni_comms_event_route_lookup_idx
  ON public.omni_comms_event_route (organization_id, event_definition_id, channel, lifecycle_state);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_event_route_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tf record; v_si record;
BEGIN
  PERFORM public.omni_comms_priv_validate_channel(NEW.channel);
  IF NEW.department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(NEW.department_id, NEW.organization_id);
  END IF;
  IF NEW.template_family_id IS NOT NULL THEN
    SELECT organization_id INTO v_tf FROM public.omni_comms_template_family WHERE id = NEW.template_family_id;
    IF v_tf.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'OC422 template_family_org_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.sender_identity_id IS NOT NULL THEN
    SELECT organization_id, channel INTO v_si FROM public.omni_comms_sender_identity WHERE id = NEW.sender_identity_id;
    IF v_si.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'OC422 sender_identity_org_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_si.channel <> NEW.channel THEN
      RAISE EXCEPTION 'OC422 sender_identity_channel_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.lifecycle_state = 'retired' AND NEW.lifecycle_state <> 'retired' THEN
      RAISE EXCEPTION 'OC422 route_retired_immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
ALTER FUNCTION public.omni_comms_priv_event_route_validate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_event_route_validate() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER omni_comms_event_route_validate_biu BEFORE INSERT OR UPDATE ON public.omni_comms_event_route
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_event_route_validate();
CREATE TRIGGER omni_comms_event_route_touch_updated_at BEFORE UPDATE ON public.omni_comms_event_route
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_touch_runtime_updated_at();

-- ============ omni_comms_request ============
CREATE TABLE public.omni_comms_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  event_definition_id uuid NOT NULL REFERENCES public.omni_comms_event_definition(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('dry_run','shadow','queued')),
  status text NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted','processing','completed','completed_with_blockers','blocked','failed')),
  idempotency_key text NOT NULL,
  idempotency_scope text NOT NULL DEFAULT 'caller_module'
    CHECK (idempotency_scope IN ('caller_module','organisation','global')),
  request_fingerprint text NOT NULL,
  correlation_id text NULL,
  caller_module_code text NOT NULL,
  caller_entity_type text NULL,
  caller_entity_id text NULL,
  payload_snapshot jsonb NOT NULL,
  requested_channels text[] NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz NULL,
  completed_at timestamptz NULL,
  failed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_request_idempotency_key_chk CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT omni_comms_request_fingerprint_chk CHECK (length(request_fingerprint) BETWEEN 8 AND 128),
  CONSTRAINT omni_comms_request_caller_module_chk CHECK (length(caller_module_code) BETWEEN 1 AND 64)
);
ALTER TABLE public.omni_comms_request OWNER TO postgres;
CREATE UNIQUE INDEX omni_comms_request_idempotency_uk
  ON public.omni_comms_request (organization_id, caller_module_code, idempotency_key);
CREATE INDEX omni_comms_request_status_idx
  ON public.omni_comms_request (organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_request_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(NEW.department_id, NEW.organization_id);
  END IF;
  PERFORM public.omni_comms_priv_require_json_object(NEW.payload_snapshot, 262144);
  PERFORM public.omni_comms_priv_validate_channel_array(NEW.requested_channels);
  IF jsonb_typeof(NEW.blockers) <> 'array' THEN
    RAISE EXCEPTION 'OC422 blockers_must_be_array' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.event_definition_id IS DISTINCT FROM OLD.event_definition_id
       OR NEW.mode IS DISTINCT FROM OLD.mode
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
       OR NEW.caller_module_code IS DISTINCT FROM OLD.caller_module_code
       OR NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot THEN
      RAISE EXCEPTION 'OC422 request_immutable_fields' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'accepted'   AND NEW.status IN ('processing','failed','blocked')) OR
        (OLD.status = 'processing' AND NEW.status IN ('completed','completed_with_blockers','blocked','failed'))
      ) THEN
        RAISE EXCEPTION 'OC422 invalid_request_transition' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
ALTER FUNCTION public.omni_comms_priv_request_validate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_request_validate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER omni_comms_request_validate_biu BEFORE INSERT OR UPDATE ON public.omni_comms_request
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_request_validate();
CREATE TRIGGER omni_comms_request_touch_updated_at BEFORE UPDATE ON public.omni_comms_request
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_touch_runtime_updated_at();

-- ============ omni_comms_recipient ============
CREATE TABLE public.omni_comms_recipient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.omni_comms_request(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('user','contact','group','external','system')),
  recipient_reference text NULL,
  display_name text NULL,
  locale text NULL,
  email_destination text NULL,
  phone_destination text NULL,
  push_destination text NULL,
  destination_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligibility_status text NOT NULL DEFAULT 'pending'
    CHECK (eligibility_status IN ('pending','eligible','partially_eligible','blocked','invalid')),
  resolved_channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.omni_comms_recipient OWNER TO postgres;
CREATE INDEX omni_comms_recipient_request_idx ON public.omni_comms_recipient (request_id);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_recipient_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_req_org uuid; v_c text;
BEGIN
  SELECT organization_id INTO v_req_org FROM public.omni_comms_request WHERE id = NEW.request_id;
  IF v_req_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 recipient_request_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_json_object(NEW.destination_snapshot, 32768);
  PERFORM public.omni_comms_priv_require_json_object(NEW.resolution_snapshot, 32768);
  IF jsonb_typeof(NEW.blockers) <> 'array' THEN
    RAISE EXCEPTION 'OC422 blockers_must_be_array' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.resolved_channels IS NOT NULL AND array_length(NEW.resolved_channels,1) IS NOT NULL THEN
    FOREACH v_c IN ARRAY NEW.resolved_channels LOOP
      PERFORM public.omni_comms_priv_validate_channel(v_c);
    END LOOP;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.recipient_type IS DISTINCT FROM OLD.recipient_type THEN
      RAISE EXCEPTION 'OC422 recipient_immutable_fields' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
ALTER FUNCTION public.omni_comms_priv_recipient_validate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_recipient_validate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER omni_comms_recipient_validate_biu BEFORE INSERT OR UPDATE ON public.omni_comms_recipient
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_recipient_validate();
CREATE TRIGGER omni_comms_recipient_touch_updated_at BEFORE UPDATE ON public.omni_comms_recipient
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_touch_runtime_updated_at();

-- ============ omni_comms_message ============
CREATE TABLE public.omni_comms_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.omni_comms_request(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES public.omni_comms_recipient(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  event_definition_id uuid NOT NULL REFERENCES public.omni_comms_event_definition(id) ON DELETE RESTRICT,
  event_route_id uuid NULL REFERENCES public.omni_comms_event_route(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  template_family_id uuid NULL REFERENCES public.omni_comms_template_family(id) ON DELETE RESTRICT,
  template_version_id uuid NULL REFERENCES public.omni_comms_template_version(id) ON DELETE RESTRICT,
  layout_id uuid NULL,
  layout_version_id uuid NULL,
  resolved_asset_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  sender_identity_id uuid NULL REFERENCES public.omni_comms_sender_identity(id) ON DELETE RESTRICT,
  provider_id uuid NULL REFERENCES public.omni_comms_provider(id) ON DELETE RESTRICT,
  provider_account_id uuid NULL REFERENCES public.omni_comms_provider_account(id) ON DELETE RESTRICT,
  channel_setting_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  destination_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_subject text NULL,
  rendered_html text NULL,
  rendered_text text NULL,
  unresolved_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_required_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  rendered_checksum text NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','rendered','blocked','dry_run_completed','shadow_completed','queued','held','dispatching','accepted','delivered','failed','cancelled')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  rendered_at timestamptz NULL,
  queued_at timestamptz NULL,
  completed_at timestamptz NULL,
  failed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_message_channel_chk CHECK (channel IN ('email','sms','whatsapp','push','in_app','print')),
  CONSTRAINT omni_comms_message_html_size_chk CHECK (rendered_html IS NULL OR octet_length(rendered_html) <= 1048576),
  CONSTRAINT omni_comms_message_text_size_chk CHECK (rendered_text IS NULL OR octet_length(rendered_text) <= 262144),
  CONSTRAINT omni_comms_message_subject_size_chk CHECK (rendered_subject IS NULL OR length(rendered_subject) <= 998),
  CONSTRAINT omni_comms_message_checksum_chk CHECK (rendered_checksum IS NULL OR rendered_checksum ~ '^sha256:[0-9a-f]{64}$')
);
ALTER TABLE public.omni_comms_message OWNER TO postgres;
CREATE INDEX omni_comms_message_request_idx ON public.omni_comms_message (request_id);
CREATE INDEX omni_comms_message_recipient_idx ON public.omni_comms_message (recipient_id);
CREATE INDEX omni_comms_message_status_idx ON public.omni_comms_message (organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_message_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_req_org uuid; v_rcp_org uuid; v_rcp_req uuid;
BEGIN
  SELECT organization_id INTO v_req_org FROM public.omni_comms_request WHERE id = NEW.request_id;
  IF v_req_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 message_request_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  SELECT organization_id, request_id INTO v_rcp_org, v_rcp_req FROM public.omni_comms_recipient WHERE id = NEW.recipient_id;
  IF v_rcp_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 message_recipient_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_rcp_req IS DISTINCT FROM NEW.request_id THEN
    RAISE EXCEPTION 'OC422 message_recipient_request_mismatch' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_json_object(NEW.resolved_asset_manifest, 262144);
  PERFORM public.omni_comms_priv_require_json_object(NEW.channel_setting_snapshot, 32768);
  PERFORM public.omni_comms_priv_require_json_object(NEW.destination_snapshot, 32768);
  IF jsonb_typeof(NEW.unresolved_tokens) <> 'array' THEN RAISE EXCEPTION 'OC422 unresolved_tokens_must_be_array' USING ERRCODE='P0001'; END IF;
  IF jsonb_typeof(NEW.unresolved_required_slots) <> 'array' THEN RAISE EXCEPTION 'OC422 unresolved_required_slots_must_be_array' USING ERRCODE='P0001'; END IF;
  IF jsonb_typeof(NEW.blockers) <> 'array' THEN RAISE EXCEPTION 'OC422 blockers_must_be_array' USING ERRCODE='P0001'; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('pending','blocked') THEN
      IF NEW.template_family_id IS DISTINCT FROM OLD.template_family_id
         OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
         OR NEW.layout_id IS DISTINCT FROM OLD.layout_id
         OR NEW.layout_version_id IS DISTINCT FROM OLD.layout_version_id
         OR NEW.resolved_asset_manifest IS DISTINCT FROM OLD.resolved_asset_manifest
         OR NEW.rendered_subject IS DISTINCT FROM OLD.rendered_subject
         OR NEW.rendered_html IS DISTINCT FROM OLD.rendered_html
         OR NEW.rendered_text IS DISTINCT FROM OLD.rendered_text
         OR NEW.rendered_checksum IS DISTINCT FROM OLD.rendered_checksum
         OR NEW.channel IS DISTINCT FROM OLD.channel
         OR NEW.sender_identity_id IS DISTINCT FROM OLD.sender_identity_id
         OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
         OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
         OR NEW.destination_snapshot IS DISTINCT FROM OLD.destination_snapshot THEN
        RAISE EXCEPTION 'OC409 message_snapshot_immutable' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'pending'     AND NEW.status IN ('rendered','blocked','cancelled')) OR
        (OLD.status = 'rendered'    AND NEW.status IN ('dry_run_completed','shadow_completed','queued','held','cancelled','blocked')) OR
        (OLD.status = 'queued'      AND NEW.status IN ('dispatching','cancelled','held')) OR
        (OLD.status = 'held'        AND NEW.status IN ('queued','cancelled')) OR
        (OLD.status = 'dispatching' AND NEW.status IN ('accepted','failed')) OR
        (OLD.status = 'accepted'    AND NEW.status IN ('delivered','failed'))
      ) THEN
        RAISE EXCEPTION 'OC422 invalid_message_transition' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
ALTER FUNCTION public.omni_comms_priv_message_validate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_message_validate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER omni_comms_message_validate_biu BEFORE INSERT OR UPDATE ON public.omni_comms_message
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_message_validate();
CREATE TRIGGER omni_comms_message_touch_updated_at BEFORE UPDATE ON public.omni_comms_message
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_touch_runtime_updated_at();

-- ============ omni_comms_dispatch_job ============
CREATE TABLE public.omni_comms_dispatch_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.omni_comms_request(id) ON DELETE RESTRICT,
  message_id uuid NOT NULL REFERENCES public.omni_comms_message(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  channel text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('dry_run','shadow','queued')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','held','ready','leased','processing','completed','retry_wait','failed','cancelled')),
  priority integer NOT NULL DEFAULT 100,
  scheduled_at timestamptz NULL,
  next_attempt_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  lock_token text NULL,
  locked_at timestamptz NULL,
  locked_by text NULL,
  lease_expires_at timestamptz NULL,
  correlation_id text NULL,
  is_runnable boolean NOT NULL DEFAULT false,
  hold_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  CONSTRAINT omni_comms_dispatch_job_channel_chk CHECK (channel IN ('email','sms','whatsapp','push','in_app','print')),
  CONSTRAINT omni_comms_dispatch_job_attempt_chk CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
  CONSTRAINT omni_comms_dispatch_job_max_attempts_chk CHECK (max_attempts BETWEEN 1 AND 25),
  CONSTRAINT omni_comms_dispatch_job_priority_chk CHECK (priority BETWEEN 1 AND 10000),
  CONSTRAINT omni_comms_dispatch_job_lease_shape_chk CHECK (
    (lock_token IS NULL AND locked_at IS NULL AND locked_by IS NULL AND lease_expires_at IS NULL)
    OR (lock_token IS NOT NULL AND locked_at IS NOT NULL AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > locked_at)
  )
);
ALTER TABLE public.omni_comms_dispatch_job OWNER TO postgres;
CREATE UNIQUE INDEX omni_comms_dispatch_job_active_uk
  ON public.omni_comms_dispatch_job (message_id)
  WHERE status NOT IN ('completed','failed','cancelled');
CREATE INDEX omni_comms_dispatch_job_ready_idx
  ON public.omni_comms_dispatch_job (status, next_attempt_at)
  WHERE is_runnable = true;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_job_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_msg record;
BEGIN
  SELECT organization_id, request_id, channel INTO v_msg FROM public.omni_comms_message WHERE id = NEW.message_id;
  IF v_msg.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 dispatch_message_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.request_id IS DISTINCT FROM NEW.request_id THEN
    RAISE EXCEPTION 'OC422 dispatch_message_request_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.channel <> NEW.channel THEN
    RAISE EXCEPTION 'OC422 dispatch_message_channel_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.mode = 'dry_run' AND NEW.is_runnable = true THEN
    RAISE EXCEPTION 'OC422 dry_run_not_runnable' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'pending'    AND NEW.status IN ('held','ready','cancelled')) OR
      (OLD.status = 'held'       AND NEW.status IN ('ready','cancelled')) OR
      (OLD.status = 'ready'      AND NEW.status IN ('leased','cancelled')) OR
      (OLD.status = 'leased'     AND NEW.status IN ('processing','ready')) OR
      (OLD.status = 'processing' AND NEW.status IN ('completed','retry_wait','failed')) OR
      (OLD.status = 'retry_wait' AND NEW.status IN ('ready','failed','cancelled'))
    ) THEN
      RAISE EXCEPTION 'OC422 invalid_dispatch_transition' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
ALTER FUNCTION public.omni_comms_priv_dispatch_job_validate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_job_validate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER omni_comms_dispatch_job_validate_biu BEFORE INSERT OR UPDATE ON public.omni_comms_dispatch_job
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_dispatch_job_validate();
CREATE TRIGGER omni_comms_dispatch_job_touch_updated_at BEFORE UPDATE ON public.omni_comms_dispatch_job
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_touch_runtime_updated_at();

-- ============ omni_comms_delivery_attempt ============
CREATE TABLE public.omni_comms_delivery_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_job_id uuid NOT NULL REFERENCES public.omni_comms_dispatch_job(id) ON DELETE RESTRICT,
  message_id uuid NOT NULL REFERENCES public.omni_comms_message(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  provider_id uuid NULL REFERENCES public.omni_comms_provider(id) ON DELETE RESTRICT,
  provider_account_id uuid NULL REFERENCES public.omni_comms_provider_account(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','accepted','rejected','failed','timed_out','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  latency_ms integer NULL,
  provider_message_id text NULL,
  response_category text NULL,
  response_code text NULL,
  is_retriable boolean NULL,
  failure_category text NULL,
  safe_request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  safe_response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_delivery_attempt_number_chk CHECK (attempt_number >= 1),
  CONSTRAINT omni_comms_delivery_attempt_latency_chk CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT omni_comms_delivery_attempt_completed_chk CHECK (status = 'started' OR completed_at IS NOT NULL)
);
ALTER TABLE public.omni_comms_delivery_attempt OWNER TO postgres;
CREATE UNIQUE INDEX omni_comms_delivery_attempt_number_uk
  ON public.omni_comms_delivery_attempt (dispatch_job_id, attempt_number);
CREATE INDEX omni_comms_delivery_attempt_message_idx
  ON public.omni_comms_delivery_attempt (message_id);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_delivery_attempt_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_job record; v_msg record;
BEGIN
  SELECT organization_id, message_id INTO v_job FROM public.omni_comms_dispatch_job WHERE id = NEW.dispatch_job_id;
  IF v_job.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 attempt_job_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_job.message_id IS DISTINCT FROM NEW.message_id THEN
    RAISE EXCEPTION 'OC422 attempt_job_message_mismatch' USING ERRCODE = 'P0001';
  END IF;
  SELECT organization_id, provider_id, provider_account_id INTO v_msg FROM public.omni_comms_message WHERE id = NEW.message_id;
  IF v_msg.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 attempt_message_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.provider_id IS NOT NULL AND NEW.provider_id IS NOT NULL AND v_msg.provider_id <> NEW.provider_id THEN
    RAISE EXCEPTION 'OC422 attempt_provider_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_msg.provider_account_id IS NOT NULL AND NEW.provider_account_id IS NOT NULL AND v_msg.provider_account_id <> NEW.provider_account_id THEN
    RAISE EXCEPTION 'OC422 attempt_provider_account_mismatch' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_json_object(NEW.safe_request_metadata, 8192);
  PERFORM public.omni_comms_priv_require_json_object(NEW.safe_response_metadata, 16384);
  RETURN NEW;
END; $$;
ALTER FUNCTION public.omni_comms_priv_delivery_attempt_validate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_delivery_attempt_validate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER omni_comms_delivery_attempt_validate_biu BEFORE INSERT OR UPDATE ON public.omni_comms_delivery_attempt
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_delivery_attempt_validate();

-- ============ omni_comms_message_event ============
CREATE TABLE public.omni_comms_message_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.omni_comms_request(id) ON DELETE RESTRICT,
  message_id uuid NULL REFERENCES public.omni_comms_message(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'request_accepted','request_processing','recipient_resolved','recipient_blocked',
    'message_rendered','message_blocked','dry_run_completed','shadow_completed',
    'dispatch_queued','dispatch_held','request_completed','request_failed'
  )),
  event_sequence bigint NOT NULL,
  status_before text NULL,
  status_after text NULL,
  summary text NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NULL,
  actor_type text NULL,
  actor_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_message_event_summary_chk CHECK (summary IS NULL OR length(summary) <= 500)
);
ALTER TABLE public.omni_comms_message_event OWNER TO postgres;
CREATE UNIQUE INDEX omni_comms_message_event_sequence_uk
  ON public.omni_comms_message_event (request_id, event_sequence);
CREATE INDEX omni_comms_message_event_message_idx
  ON public.omni_comms_message_event (message_id) WHERE message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_message_event_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_req_org uuid; v_msg record;
BEGIN
  SELECT organization_id INTO v_req_org FROM public.omni_comms_request WHERE id = NEW.request_id;
  IF v_req_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'OC422 event_request_org_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.message_id IS NOT NULL THEN
    SELECT organization_id, request_id INTO v_msg FROM public.omni_comms_message WHERE id = NEW.message_id;
    IF v_msg.request_id IS DISTINCT FROM NEW.request_id THEN
      RAISE EXCEPTION 'OC422 event_message_request_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_msg.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'OC422 event_message_org_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  PERFORM public.omni_comms_priv_require_json_object(NEW.safe_metadata, 8192);
  RETURN NEW;
END; $$;
ALTER FUNCTION public.omni_comms_priv_message_event_validate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_message_event_validate() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_message_event_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'OC409 message_event_append_only' USING ERRCODE = 'P0001'; END; $$;
ALTER FUNCTION public.omni_comms_priv_message_event_append_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_message_event_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER omni_comms_message_event_validate_bi BEFORE INSERT ON public.omni_comms_message_event
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_message_event_validate();
CREATE TRIGGER omni_comms_message_event_no_update BEFORE UPDATE ON public.omni_comms_message_event
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_message_event_append_only();
CREATE TRIGGER omni_comms_message_event_no_delete BEFORE DELETE ON public.omni_comms_message_event
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_message_event_append_only();

-- ============ RLS + grants ============
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'omni_comms_event_route','omni_comms_request','omni_comms_recipient',
    'omni_comms_message','omni_comms_dispatch_job','omni_comms_delivery_attempt',
    'omni_comms_message_event'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;