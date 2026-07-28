
-- ============================================================================
-- Epic 4 — Story 1: Provider, Provider Account, Sender Identity,
-- Sender-Provider Binding, and Channel Setting foundation.
--
-- No public RPCs. No policies (denied by default). No seeds.
-- ============================================================================

-- ─── Shared: allowed channel values (reused from Template Catalogue) ────────
-- Channels: email, sms, in_app, push, whatsapp, print.

-- ─── Shared: timezone validation helper (reused across triggers) ───────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_timezone(p_tz text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_tz);
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_timezone(text) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.omni_comms_priv_validate_timezone(text) OWNER TO postgres;

-- ============================================================================
-- 1. omni_comms_provider
-- ============================================================================
CREATE TABLE public.omni_comms_provider (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL,
  display_name    text NOT NULL,
  channel         text NOT NULL,
  adapter_key     text NOT NULL,
  status          text NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  activated_at    timestamptz,
  activated_by    uuid,
  retired_at      timestamptz,
  retired_by      uuid,
  retirement_reason text,
  CONSTRAINT omni_comms_provider_code_uk UNIQUE (code),
  CONSTRAINT omni_comms_provider_adapter_channel_uk UNIQUE (adapter_key, channel),
  CONSTRAINT omni_comms_provider_code_fmt_chk
    CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) BETWEEN 3 AND 64),
  CONSTRAINT omni_comms_provider_display_name_chk
    CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120),
  CONSTRAINT omni_comms_provider_channel_chk
    CHECK (channel IN ('email','sms','in_app','push','whatsapp','print')),
  CONSTRAINT omni_comms_provider_adapter_key_chk
    CHECK (adapter_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(adapter_key) BETWEEN 3 AND 64),
  CONSTRAINT omni_comms_provider_status_chk
    CHECK (status IN ('draft','active','retired')),
  CONSTRAINT omni_comms_provider_retired_meta_chk CHECK (
    (status = 'retired' AND retired_at IS NOT NULL) OR
    (status <> 'retired' AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL)
  ),
  CONSTRAINT omni_comms_provider_activated_meta_chk CHECK (
    (status = 'draft' AND activated_at IS NULL AND activated_by IS NULL) OR
    (status IN ('active','retired'))
  ),
  CONSTRAINT omni_comms_provider_retirement_reason_len_chk CHECK (
    retirement_reason IS NULL OR (char_length(btrim(retirement_reason)) BETWEEN 1 AND 2000)
  )
);

CREATE INDEX omni_comms_provider_channel_status_idx
  ON public.omni_comms_provider (channel, status);

-- ============================================================================
-- 2. omni_comms_provider_account
-- ============================================================================
CREATE TABLE public.omni_comms_provider_account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.core_organization(id) ON DELETE RESTRICT,
  provider_id     uuid NOT NULL REFERENCES public.omni_comms_provider(id) ON DELETE RESTRICT,
  code            text NOT NULL,
  display_name    text NOT NULL,
  secret_ref      text NOT NULL,
  region          text,
  sandbox_mode    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'draft',
  health_state    text NOT NULL DEFAULT 'unknown',
  health_checked_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  activated_at    timestamptz,
  activated_by    uuid,
  retired_at      timestamptz,
  retired_by      uuid,
  retirement_reason text,
  CONSTRAINT omni_comms_provider_account_org_code_uk UNIQUE (organization_id, code),
  CONSTRAINT omni_comms_provider_account_code_fmt_chk
    CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) BETWEEN 3 AND 64),
  CONSTRAINT omni_comms_provider_account_display_name_chk
    CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120),
  CONSTRAINT omni_comms_provider_account_secret_ref_chk
    CHECK (secret_ref ~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$' AND char_length(secret_ref) BETWEEN 16 AND 96),
  CONSTRAINT omni_comms_provider_account_region_chk
    CHECK (region IS NULL OR (char_length(btrim(region)) BETWEEN 1 AND 40 AND region ~ '^[a-z0-9-]+$')),
  CONSTRAINT omni_comms_provider_account_status_chk
    CHECK (status IN ('draft','active','disabled','retired')),
  CONSTRAINT omni_comms_provider_account_health_chk
    CHECK (health_state IN ('unknown','healthy','degraded','failed')),
  CONSTRAINT omni_comms_provider_account_health_meta_chk CHECK (
    (health_state = 'unknown' AND health_checked_at IS NULL) OR
    (health_state <> 'unknown' AND health_checked_at IS NOT NULL)
  ),
  CONSTRAINT omni_comms_provider_account_retired_meta_chk CHECK (
    (status = 'retired' AND retired_at IS NOT NULL) OR
    (status <> 'retired' AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL)
  ),
  CONSTRAINT omni_comms_provider_account_activated_meta_chk CHECK (
    (status = 'draft' AND activated_at IS NULL AND activated_by IS NULL) OR
    (status IN ('active','disabled','retired'))
  ),
  CONSTRAINT omni_comms_provider_account_retirement_reason_len_chk CHECK (
    retirement_reason IS NULL OR (char_length(btrim(retirement_reason)) BETWEEN 1 AND 2000)
  )
);

CREATE INDEX omni_comms_provider_account_provider_idx
  ON public.omni_comms_provider_account (provider_id);
CREATE INDEX omni_comms_provider_account_org_status_idx
  ON public.omni_comms_provider_account (organization_id, status);

-- ============================================================================
-- 3. omni_comms_sender_identity
-- ============================================================================
CREATE TABLE public.omni_comms_sender_identity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.core_organization(id) ON DELETE RESTRICT,
  department_id     uuid REFERENCES public.core_department(id) ON DELETE RESTRICT,
  event_definition_id uuid REFERENCES public.omni_comms_event_definition(id) ON DELETE RESTRICT,
  code              text NOT NULL,
  display_name      text NOT NULL,
  channel           text NOT NULL,
  from_address      text,
  from_name         text,
  reply_to_address  text,
  print_config      jsonb,
  status            text NOT NULL DEFAULT 'draft',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  activated_at      timestamptz,
  activated_by      uuid,
  retired_at        timestamptz,
  retired_by        uuid,
  retirement_reason text,
  CONSTRAINT omni_comms_sender_identity_org_code_uk UNIQUE (organization_id, code),
  CONSTRAINT omni_comms_sender_identity_code_fmt_chk
    CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) BETWEEN 3 AND 64),
  CONSTRAINT omni_comms_sender_identity_display_name_chk
    CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 160),
  CONSTRAINT omni_comms_sender_identity_channel_chk
    CHECK (channel IN ('email','sms','in_app','push','whatsapp','print')),
  CONSTRAINT omni_comms_sender_identity_status_chk
    CHECK (status IN ('draft','active','retired')),
  CONSTRAINT omni_comms_sender_identity_from_address_len_chk CHECK (
    from_address IS NULL OR char_length(btrim(from_address)) BETWEEN 1 AND 254
  ),
  CONSTRAINT omni_comms_sender_identity_from_name_len_chk CHECK (
    from_name IS NULL OR char_length(btrim(from_name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT omni_comms_sender_identity_reply_to_len_chk CHECK (
    reply_to_address IS NULL OR char_length(btrim(reply_to_address)) BETWEEN 1 AND 254
  ),
  CONSTRAINT omni_comms_sender_identity_from_required_chk CHECK (
    (channel IN ('email','sms','whatsapp') AND from_address IS NOT NULL) OR
    (channel IN ('in_app','push','print'))
  ),
  CONSTRAINT omni_comms_sender_identity_reply_to_channel_chk CHECK (
    reply_to_address IS NULL OR channel = 'email'
  ),
  CONSTRAINT omni_comms_sender_identity_email_shape_chk CHECK (
    channel <> 'email' OR (from_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  CONSTRAINT omni_comms_sender_identity_reply_to_shape_chk CHECK (
    reply_to_address IS NULL OR reply_to_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  CONSTRAINT omni_comms_sender_identity_print_config_channel_chk CHECK (
    (print_config IS NULL) OR (channel = 'print' AND jsonb_typeof(print_config) = 'object')
  ),
  CONSTRAINT omni_comms_sender_identity_event_channel_chk CHECK (
    event_definition_id IS NULL OR channel <> 'print'
  ),
  CONSTRAINT omni_comms_sender_identity_retired_meta_chk CHECK (
    (status = 'retired' AND retired_at IS NOT NULL) OR
    (status <> 'retired' AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL)
  ),
  CONSTRAINT omni_comms_sender_identity_activated_meta_chk CHECK (
    (status = 'draft' AND activated_at IS NULL AND activated_by IS NULL) OR
    (status IN ('active','retired'))
  ),
  CONSTRAINT omni_comms_sender_identity_retirement_reason_len_chk CHECK (
    retirement_reason IS NULL OR (char_length(btrim(retirement_reason)) BETWEEN 1 AND 2000)
  )
);

CREATE INDEX omni_comms_sender_identity_org_channel_status_idx
  ON public.omni_comms_sender_identity (organization_id, channel, status);
CREATE INDEX omni_comms_sender_identity_department_idx
  ON public.omni_comms_sender_identity (department_id);
CREATE INDEX omni_comms_sender_identity_event_idx
  ON public.omni_comms_sender_identity (event_definition_id);

-- ============================================================================
-- 4. omni_comms_sender_provider_binding
-- ============================================================================
CREATE TABLE public.omni_comms_sender_provider_binding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_identity_id    uuid NOT NULL REFERENCES public.omni_comms_sender_identity(id) ON DELETE RESTRICT,
  provider_account_id   uuid NOT NULL REFERENCES public.omni_comms_provider_account(id) ON DELETE RESTRICT,
  external_sender_ref   text,
  priority              integer NOT NULL DEFAULT 100,
  verification_status   text NOT NULL DEFAULT 'unverified',
  verified_at           timestamptz,
  status                text NOT NULL DEFAULT 'draft',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  activated_at          timestamptz,
  activated_by          uuid,
  retired_at            timestamptz,
  retired_by            uuid,
  retirement_reason     text,
  CONSTRAINT omni_comms_binding_unique_pair_uk UNIQUE (sender_identity_id, provider_account_id),
  CONSTRAINT omni_comms_binding_status_chk
    CHECK (status IN ('draft','active','retired')),
  CONSTRAINT omni_comms_binding_verification_chk
    CHECK (verification_status IN ('unverified','pending','verified','failed')),
  CONSTRAINT omni_comms_binding_priority_chk
    CHECK (priority BETWEEN 1 AND 1000),
  CONSTRAINT omni_comms_binding_external_ref_len_chk CHECK (
    external_sender_ref IS NULL OR char_length(btrim(external_sender_ref)) BETWEEN 1 AND 254
  ),
  CONSTRAINT omni_comms_binding_verified_meta_chk CHECK (
    (verification_status = 'verified' AND verified_at IS NOT NULL) OR
    (verification_status IN ('unverified','pending') AND verified_at IS NULL) OR
    (verification_status = 'failed')
  ),
  CONSTRAINT omni_comms_binding_retired_meta_chk CHECK (
    (status = 'retired' AND retired_at IS NOT NULL) OR
    (status <> 'retired' AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL)
  ),
  CONSTRAINT omni_comms_binding_activated_meta_chk CHECK (
    (status = 'draft' AND activated_at IS NULL AND activated_by IS NULL) OR
    (status IN ('active','retired'))
  ),
  CONSTRAINT omni_comms_binding_retirement_reason_len_chk CHECK (
    retirement_reason IS NULL OR (char_length(btrim(retirement_reason)) BETWEEN 1 AND 2000)
  )
);

CREATE UNIQUE INDEX omni_comms_binding_active_priority_uk
  ON public.omni_comms_sender_provider_binding (sender_identity_id, priority)
  WHERE status = 'active';
CREATE INDEX omni_comms_binding_account_idx
  ON public.omni_comms_sender_provider_binding (provider_account_id);

-- ============================================================================
-- 5. omni_comms_channel_setting
-- ============================================================================
CREATE TABLE public.omni_comms_channel_setting (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.core_organization(id) ON DELETE RESTRICT,
  department_id         uuid REFERENCES public.core_department(id) ON DELETE RESTRICT,
  channel               text NOT NULL,
  enabled               boolean NOT NULL DEFAULT false,
  live_delivery_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start     time without time zone,
  quiet_hours_end       time without time zone,
  quiet_hours_timezone  text,
  per_minute_limit      integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT omni_comms_channel_setting_channel_chk
    CHECK (channel IN ('email','sms','in_app','push','whatsapp','print')),
  CONSTRAINT omni_comms_channel_setting_live_requires_enabled_chk
    CHECK (NOT live_delivery_enabled OR enabled),
  CONSTRAINT omni_comms_channel_setting_quiet_pair_chk CHECK (
    (quiet_hours_start IS NULL AND quiet_hours_end IS NULL) OR
    (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  ),
  CONSTRAINT omni_comms_channel_setting_quiet_tz_required_chk CHECK (
    quiet_hours_start IS NULL OR quiet_hours_timezone IS NOT NULL
  ),
  CONSTRAINT omni_comms_channel_setting_quiet_distinct_chk CHECK (
    quiet_hours_start IS NULL OR quiet_hours_start <> quiet_hours_end
  ),
  CONSTRAINT omni_comms_channel_setting_rate_chk CHECK (
    per_minute_limit IS NULL OR per_minute_limit BETWEEN 1 AND 100000
  )
);

CREATE UNIQUE INDEX omni_comms_channel_setting_org_scope_uk
  ON public.omni_comms_channel_setting (organization_id, channel)
  WHERE department_id IS NULL;
CREATE UNIQUE INDEX omni_comms_channel_setting_dept_scope_uk
  ON public.omni_comms_channel_setting (organization_id, department_id, channel)
  WHERE department_id IS NOT NULL;

-- ============================================================================
-- Lifecycle triggers
-- ============================================================================

-- Provider lifecycle
CREATE OR REPLACE FUNCTION public.omni_comms_priv_provider_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_provider must be inserted in draft status'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.retired_at IS NOT NULL OR NEW.activated_at IS NOT NULL THEN
      RAISE EXCEPTION 'omni_comms_provider draft insert cannot set lifecycle timestamps'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'omni_comms_provider retired status is terminal' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'omni_comms_provider cannot revert active to draft' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status NOT IN ('draft','active','retired') THEN
    RAISE EXCEPTION 'omni_comms_provider invalid status %', NEW.status USING ERRCODE = 'P0001';
  END IF;

  -- activation metadata
  IF NEW.status = 'active' AND OLD.status = 'draft' THEN
    IF NEW.activated_at IS NULL THEN NEW.activated_at := now(); END IF;
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS NULL THEN
    RAISE EXCEPTION 'omni_comms_provider activated_at cannot be cleared' USING ERRCODE = 'P0001';
  END IF;

  -- retirement metadata
  IF NEW.status = 'retired' AND OLD.status <> 'retired' THEN
    IF NEW.retired_at IS NULL THEN NEW.retired_at := now(); END IF;
    IF NEW.retirement_reason IS NULL OR char_length(btrim(NEW.retirement_reason)) < 1 THEN
      RAISE EXCEPTION 'omni_comms_provider retirement requires a non-empty reason' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status = 'retired' THEN
    IF OLD.retired_at IS DISTINCT FROM NEW.retired_at
       OR OLD.retired_by IS DISTINCT FROM NEW.retired_by
       OR OLD.retirement_reason IS DISTINCT FROM NEW.retirement_reason THEN
      RAISE EXCEPTION 'omni_comms_provider retirement metadata is immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- business identity immutability after activation
  IF OLD.status IN ('active','retired') THEN
    IF OLD.code <> NEW.code OR OLD.adapter_key <> NEW.adapter_key OR OLD.channel <> NEW.channel THEN
      RAISE EXCEPTION 'omni_comms_provider identity fields are immutable after activation'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_provider_lifecycle_guard() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.omni_comms_priv_provider_lifecycle_guard() OWNER TO postgres;

CREATE TRIGGER omni_comms_provider_lifecycle_guard
BEFORE INSERT OR UPDATE ON public.omni_comms_provider
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_provider_lifecycle_guard();

-- Provider account lifecycle
CREATE OR REPLACE FUNCTION public.omni_comms_priv_provider_account_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_provider_account must be inserted in draft status'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'omni_comms_provider_account retired status is terminal' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'omni_comms_provider_account cannot revert to draft' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status NOT IN ('draft','active','disabled','retired') THEN
    RAISE EXCEPTION 'omni_comms_provider_account invalid status %', NEW.status USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IN ('active','disabled') AND OLD.status = 'draft' AND NEW.status = 'active' THEN
    IF NEW.activated_at IS NULL THEN NEW.activated_at := now(); END IF;
  END IF;
  IF NEW.status = 'disabled' AND OLD.status = 'draft' THEN
    RAISE EXCEPTION 'omni_comms_provider_account cannot go draft to disabled' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS NULL THEN
    RAISE EXCEPTION 'omni_comms_provider_account activated_at cannot be cleared' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'retired' AND OLD.status <> 'retired' THEN
    IF NEW.retired_at IS NULL THEN NEW.retired_at := now(); END IF;
    IF NEW.retirement_reason IS NULL OR char_length(btrim(NEW.retirement_reason)) < 1 THEN
      RAISE EXCEPTION 'omni_comms_provider_account retirement requires a non-empty reason' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status = 'retired' THEN
    IF OLD.retired_at IS DISTINCT FROM NEW.retired_at
       OR OLD.retired_by IS DISTINCT FROM NEW.retired_by
       OR OLD.retirement_reason IS DISTINCT FROM NEW.retirement_reason THEN
      RAISE EXCEPTION 'omni_comms_provider_account retirement metadata is immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF OLD.status IN ('active','disabled','retired') THEN
    IF OLD.code <> NEW.code
       OR OLD.organization_id <> NEW.organization_id
       OR OLD.provider_id <> NEW.provider_id THEN
      RAISE EXCEPTION 'omni_comms_provider_account identity fields are immutable after activation'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_provider_account_lifecycle_guard() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.omni_comms_priv_provider_account_lifecycle_guard() OWNER TO postgres;

CREATE TRIGGER omni_comms_provider_account_lifecycle_guard
BEFORE INSERT OR UPDATE ON public.omni_comms_provider_account
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_provider_account_lifecycle_guard();

-- Sender identity lifecycle + ownership
CREATE OR REPLACE FUNCTION public.omni_comms_priv_sender_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_org uuid;
BEGIN
  -- Ownership: department belongs to organization
  IF NEW.department_id IS NOT NULL THEN
    IF NOT public.omni_comms_priv_verify_department_ownership(NEW.department_id, NEW.organization_id) THEN
      RAISE EXCEPTION 'omni_comms_sender_identity department does not belong to organization'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Ownership: event belongs to organization (event has no org column; enforce via existence in same org context)
  IF NEW.event_definition_id IS NOT NULL THEN
    SELECT organization_id INTO v_event_org
      FROM public.omni_comms_event_definition WHERE id = NEW.event_definition_id;
    IF v_event_org IS NULL OR v_event_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'omni_comms_sender_identity event does not belong to organization'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_sender_identity must be inserted in draft status'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'omni_comms_sender_identity retired status is terminal' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'omni_comms_sender_identity cannot revert active to draft' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status NOT IN ('draft','active','retired') THEN
    RAISE EXCEPTION 'omni_comms_sender_identity invalid status %', NEW.status USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'active' AND OLD.status = 'draft' AND NEW.activated_at IS NULL THEN
    NEW.activated_at := now();
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS NULL THEN
    RAISE EXCEPTION 'omni_comms_sender_identity activated_at cannot be cleared' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'retired' AND OLD.status <> 'retired' THEN
    IF NEW.retired_at IS NULL THEN NEW.retired_at := now(); END IF;
    IF NEW.retirement_reason IS NULL OR char_length(btrim(NEW.retirement_reason)) < 1 THEN
      RAISE EXCEPTION 'omni_comms_sender_identity retirement requires a reason' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status = 'retired' THEN
    IF OLD.retired_at IS DISTINCT FROM NEW.retired_at
       OR OLD.retired_by IS DISTINCT FROM NEW.retired_by
       OR OLD.retirement_reason IS DISTINCT FROM NEW.retirement_reason THEN
      RAISE EXCEPTION 'omni_comms_sender_identity retirement metadata is immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status IN ('active','retired') THEN
    IF OLD.code <> NEW.code
       OR OLD.organization_id <> NEW.organization_id
       OR OLD.channel <> NEW.channel THEN
      RAISE EXCEPTION 'omni_comms_sender_identity identity fields are immutable after activation'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_sender_identity_guard() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.omni_comms_priv_sender_identity_guard() OWNER TO postgres;

CREATE TRIGGER omni_comms_sender_identity_guard
BEFORE INSERT OR UPDATE ON public.omni_comms_sender_identity
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_sender_identity_guard();

-- Sender-provider binding lifecycle + compatibility
CREATE OR REPLACE FUNCTION public.omni_comms_priv_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sender_org uuid; v_sender_channel text;
  v_account_org uuid; v_provider_id uuid; v_provider_channel text;
BEGIN
  SELECT organization_id, channel INTO v_sender_org, v_sender_channel
    FROM public.omni_comms_sender_identity WHERE id = NEW.sender_identity_id;
  SELECT pa.organization_id, pa.provider_id, p.channel
    INTO v_account_org, v_provider_id, v_provider_channel
    FROM public.omni_comms_provider_account pa
    JOIN public.omni_comms_provider p ON p.id = pa.provider_id
    WHERE pa.id = NEW.provider_account_id;

  IF v_sender_org IS NULL OR v_account_org IS NULL THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding referenced rows missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_sender_org <> v_account_org THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding organisation mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_sender_channel <> v_provider_channel THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding channel mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding must be inserted in draft status'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding retired status is terminal' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding cannot revert active to draft' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status NOT IN ('draft','active','retired') THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding invalid status %', NEW.status USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'active' AND OLD.status = 'draft' AND NEW.activated_at IS NULL THEN
    NEW.activated_at := now();
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS NULL THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding activated_at cannot be cleared' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'retired' AND OLD.status <> 'retired' THEN
    IF NEW.retired_at IS NULL THEN NEW.retired_at := now(); END IF;
    IF NEW.retirement_reason IS NULL OR char_length(btrim(NEW.retirement_reason)) < 1 THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding retirement requires a reason' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status = 'retired' THEN
    IF OLD.retired_at IS DISTINCT FROM NEW.retired_at
       OR OLD.retired_by IS DISTINCT FROM NEW.retired_by
       OR OLD.retirement_reason IS DISTINCT FROM NEW.retirement_reason THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding retirement metadata is immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status IN ('active','retired') THEN
    IF OLD.sender_identity_id <> NEW.sender_identity_id
       OR OLD.provider_account_id <> NEW.provider_account_id THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding identity is immutable after activation'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_binding_guard() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.omni_comms_priv_binding_guard() OWNER TO postgres;

CREATE TRIGGER omni_comms_binding_guard
BEFORE INSERT OR UPDATE ON public.omni_comms_sender_provider_binding
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_binding_guard();

-- Channel setting: ownership + quiet-hours timezone validation
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_setting_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    IF NOT public.omni_comms_priv_verify_department_ownership(NEW.department_id, NEW.organization_id) THEN
      RAISE EXCEPTION 'omni_comms_channel_setting department does not belong to organization'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.quiet_hours_timezone IS NOT NULL THEN
    IF NOT public.omni_comms_priv_validate_timezone(NEW.quiet_hours_timezone) THEN
      RAISE EXCEPTION 'omni_comms_channel_setting invalid timezone %', NEW.quiet_hours_timezone
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_setting_guard() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.omni_comms_priv_channel_setting_guard() OWNER TO postgres;

CREATE TRIGGER omni_comms_channel_setting_guard
BEFORE INSERT OR UPDATE ON public.omni_comms_channel_setting
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_channel_setting_guard();

-- ============================================================================
-- RLS + Grants
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'omni_comms_provider',
    'omni_comms_provider_account',
    'omni_comms_sender_identity',
    'omni_comms_sender_provider_binding',
    'omni_comms_channel_setting'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END$$;
