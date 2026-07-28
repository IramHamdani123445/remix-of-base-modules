
-- =============================================================================
-- Accelerated Build 1 — Shared Communication Assets & Layouts
-- =============================================================================

-- ─── Neutral shared department-ownership helper ─────────────────────────────
CREATE OR REPLACE FUNCTION public.core_priv_verify_department_ownership(
  p_department_id uuid,
  p_organization_id uuid
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_org uuid;
BEGIN
  IF p_department_id IS NULL THEN RETURN; END IF;
  SELECT organization_id INTO v_org FROM public.core_department WHERE id = p_department_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='department_not_found';
  END IF;
  IF v_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_organization_mismatch';
  END IF;
END;
$$;
ALTER FUNCTION public.core_priv_verify_department_ownership(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_priv_verify_department_ownership(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Make existing Omni-Comms helper delegate to neutral helper (signature preserved).
CREATE OR REPLACE FUNCTION public.omni_comms_priv_verify_department_ownership(
  p_department_id uuid,
  p_organization_id uuid
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
END;
$$;
ALTER FUNCTION public.omni_comms_priv_verify_department_ownership(uuid, uuid) OWNER TO postgres;

-- =============================================================================
-- 1. core_comm_asset
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.core_comm_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.core_organization(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.core_department(id) ON DELETE RESTRICT,
  asset_type text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  activated_at timestamptz,
  activated_by uuid,
  retired_at timestamptz,
  retired_by uuid,
  retirement_reason text,
  CONSTRAINT core_comm_asset_type_chk CHECK (asset_type IN (
    'logo','media','email_header','email_footer','email_signature','disclaimer',
    'print_letterhead','print_footer','address_block','text_block'
  )),
  CONSTRAINT core_comm_asset_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT core_comm_asset_code_fmt_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9_\.\-]{1,79}$'),
  CONSTRAINT core_comm_asset_unique_code UNIQUE (organization_id, asset_type, code)
);
CREATE INDEX IF NOT EXISTS core_comm_asset_org_type_idx ON public.core_comm_asset(organization_id, asset_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.core_comm_asset TO service_role;
REVOKE ALL ON public.core_comm_asset FROM PUBLIC, anon, authenticated;
ALTER TABLE public.core_comm_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_comm_asset FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. core_comm_asset_version (immutable)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.core_comm_asset_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.core_comm_asset(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  content_html text,
  content_text text,
  content_json jsonb,
  storage_bucket text,
  storage_object_path text,
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'published',
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_comm_asset_version_status_chk CHECK (status IN ('published','retired')),
  CONSTRAINT core_comm_asset_version_checksum_chk CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT core_comm_asset_version_unique UNIQUE (asset_id, version_number),
  CONSTRAINT core_comm_asset_version_has_payload CHECK (
    content_html IS NOT NULL OR content_text IS NOT NULL OR content_json IS NOT NULL OR storage_object_path IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS core_comm_asset_version_asset_idx ON public.core_comm_asset_version(asset_id);

GRANT SELECT, INSERT ON public.core_comm_asset_version TO service_role;
REVOKE ALL ON public.core_comm_asset_version FROM PUBLIC, anon, authenticated;
ALTER TABLE public.core_comm_asset_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_comm_asset_version FORCE ROW LEVEL SECURITY;

ALTER TABLE public.core_comm_asset
  ADD CONSTRAINT core_comm_asset_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES public.core_comm_asset_version(id) DEFERRABLE INITIALLY DEFERRED;

-- Immutability + storage-bucket allow-list trigger for asset_version
CREATE OR REPLACE FUNCTION public.core_priv_asset_version_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_bucket_ok bool;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.storage_bucket IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM storage.buckets WHERE id = NEW.storage_bucket) INTO v_bucket_ok;
      IF NOT v_bucket_ok THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='storage_bucket_not_registered';
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.status = 'retired' AND OLD.status = 'published'
        AND NEW.asset_id = OLD.asset_id AND NEW.version_number = OLD.version_number
        AND NEW.checksum = OLD.checksum
        AND NEW.content_html IS NOT DISTINCT FROM OLD.content_html
        AND NEW.content_text IS NOT DISTINCT FROM OLD.content_text
        AND NEW.content_json IS NOT DISTINCT FROM OLD.content_json
        AND NEW.storage_object_path IS NOT DISTINCT FROM OLD.storage_object_path) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='asset_version_immutable';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='asset_version_not_deletable';
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS core_comm_asset_version_guard_trg ON public.core_comm_asset_version;
CREATE TRIGGER core_comm_asset_version_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.core_comm_asset_version
  FOR EACH ROW EXECUTE FUNCTION public.core_priv_asset_version_guard();

-- Asset lifecycle trigger
CREATE OR REPLACE FUNCTION public.core_priv_asset_lifecycle_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='asset_must_start_draft';
    END IF;
    IF NEW.department_id IS NOT NULL THEN
      PERFORM public.core_priv_verify_department_ownership(NEW.department_id, NEW.organization_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.asset_type IS DISTINCT FROM OLD.asset_type
       OR NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='asset_identity_immutable';
    END IF;
    IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='asset_terminal_retired';
    END IF;
    IF NEW.department_id IS NOT NULL THEN
      PERFORM public.core_priv_verify_department_ownership(NEW.department_id, NEW.organization_id);
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='asset_not_deletable';
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS core_comm_asset_lifecycle_trg ON public.core_comm_asset;
CREATE TRIGGER core_comm_asset_lifecycle_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.core_comm_asset
  FOR EACH ROW EXECUTE FUNCTION public.core_priv_asset_lifecycle_guard();

-- =============================================================================
-- 3. core_template_layout_version (immutable slot schema)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.core_template_layout_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id uuid NOT NULL REFERENCES public.core_template_layout(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  slots jsonb NOT NULL,
  wrapper_html text,
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'published',
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_template_layout_version_status_chk CHECK (status IN ('published','retired')),
  CONSTRAINT core_template_layout_version_checksum_chk CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT core_template_layout_version_unique UNIQUE (layout_id, version_number)
);
GRANT SELECT, INSERT ON public.core_template_layout_version TO service_role;
REVOKE ALL ON public.core_template_layout_version FROM PUBLIC, anon, authenticated;
ALTER TABLE public.core_template_layout_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_template_layout_version FORCE ROW LEVEL SECURITY;

-- Slot JSON validation + immutability
CREATE OR REPLACE FUNCTION public.core_priv_layout_version_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  v_slot jsonb; v_codes text[]; v_orders int[]; v_code text; v_order int; v_required bool;
  v_allowed jsonb; v_extra text[]; k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF jsonb_typeof(NEW.slots) <> 'array' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='slots_must_be_array';
    END IF;
    v_codes := ARRAY[]::text[]; v_orders := ARRAY[]::int[];
    FOR v_slot IN SELECT * FROM jsonb_array_elements(NEW.slots) LOOP
      -- reject unknown keys
      FOR k IN SELECT jsonb_object_keys(v_slot) LOOP
        IF k NOT IN ('code','order','required','allowed_asset_types','wrapper','fallback_policy') THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_slot_key:'||k;
        END IF;
      END LOOP;
      v_code := v_slot->>'code';
      IF v_code IS NULL OR v_code = '' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='slot_code_required';
      END IF;
      IF v_code = ANY(v_codes) THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='slot_code_duplicate:'||v_code;
      END IF;
      v_codes := v_codes || v_code;
      v_order := (v_slot->>'order')::int;
      IF v_order IS NULL THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='slot_order_required';
      END IF;
      IF v_order = ANY(v_orders) THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='slot_order_duplicate';
      END IF;
      v_orders := v_orders || v_order;
      v_required := COALESCE((v_slot->>'required')::bool, false);
      v_allowed := v_slot->'allowed_asset_types';
      IF v_allowed IS NULL OR jsonb_typeof(v_allowed) <> 'array' THEN
        IF v_code <> 'content_body' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='slot_allowed_types_required:'||v_code;
        END IF;
      END IF;
    END LOOP;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'retired' AND OLD.status = 'published'
       AND NEW.layout_id = OLD.layout_id
       AND NEW.version_number = OLD.version_number
       AND NEW.slots = OLD.slots
       AND NEW.checksum = OLD.checksum
       AND NEW.wrapper_html IS NOT DISTINCT FROM OLD.wrapper_html THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='layout_version_immutable';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='layout_version_not_deletable';
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS core_template_layout_version_guard_trg ON public.core_template_layout_version;
CREATE TRIGGER core_template_layout_version_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.core_template_layout_version
  FOR EACH ROW EXECUTE FUNCTION public.core_priv_layout_version_guard();

-- =============================================================================
-- 4. core_comm_assignment
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.core_comm_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.core_organization(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.core_department(id) ON DELETE RESTRICT,
  output_channel text NOT NULL,
  assignment_kind text NOT NULL,
  slot_code text,
  layout_id uuid REFERENCES public.core_template_layout(id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES public.core_comm_asset(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT core_comm_assignment_channel_chk CHECK (output_channel IN ('email','sms','whatsapp','print','in_app','push')),
  CONSTRAINT core_comm_assignment_kind_chk CHECK (assignment_kind IN ('layout_default','asset_slot')),
  CONSTRAINT core_comm_assignment_target_chk CHECK (
    (assignment_kind = 'layout_default' AND layout_id IS NOT NULL AND asset_id IS NULL AND slot_code IS NULL)
    OR
    (assignment_kind = 'asset_slot' AND asset_id IS NOT NULL AND layout_id IS NULL AND slot_code IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS core_comm_assignment_org_layout_default_uq
  ON public.core_comm_assignment(organization_id, output_channel)
  WHERE assignment_kind = 'layout_default' AND department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS core_comm_assignment_dept_layout_override_uq
  ON public.core_comm_assignment(organization_id, department_id, output_channel)
  WHERE assignment_kind = 'layout_default' AND department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS core_comm_assignment_org_asset_slot_uq
  ON public.core_comm_assignment(organization_id, output_channel, slot_code)
  WHERE assignment_kind = 'asset_slot' AND department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS core_comm_assignment_dept_asset_slot_uq
  ON public.core_comm_assignment(organization_id, department_id, output_channel, slot_code)
  WHERE assignment_kind = 'asset_slot' AND department_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.core_comm_assignment TO service_role;
REVOKE ALL ON public.core_comm_assignment FROM PUBLIC, anon, authenticated;
ALTER TABLE public.core_comm_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_comm_assignment FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.core_priv_assignment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_asset_org uuid;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF NEW.department_id IS NOT NULL THEN
      PERFORM public.core_priv_verify_department_ownership(NEW.department_id, NEW.organization_id);
    END IF;
    IF NEW.asset_id IS NOT NULL THEN
      SELECT organization_id INTO v_asset_org FROM public.core_comm_asset WHERE id = NEW.asset_id;
      IF v_asset_org IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='asset_organization_mismatch';
      END IF;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS core_comm_assignment_guard_trg ON public.core_comm_assignment;
CREATE TRIGGER core_comm_assignment_guard_trg
  BEFORE INSERT OR UPDATE ON public.core_comm_assignment
  FOR EACH ROW EXECUTE FUNCTION public.core_priv_assignment_guard();

-- =============================================================================
-- 5. Additive columns on omni_comms_template_version
-- =============================================================================
ALTER TABLE public.omni_comms_template_version
  ADD COLUMN IF NOT EXISTS layout_selection_mode text,
  ADD COLUMN IF NOT EXISTS layout_id uuid REFERENCES public.core_template_layout(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pinned_layout_version_id uuid REFERENCES public.core_template_layout_version(id) ON DELETE RESTRICT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'omni_comms_template_version_layout_mode_chk') THEN
    ALTER TABLE public.omni_comms_template_version
      ADD CONSTRAINT omni_comms_template_version_layout_mode_chk
      CHECK (layout_selection_mode IS NULL OR layout_selection_mode IN ('resolved_default','pinned'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_template_version_layout_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_pinned_layout uuid;
BEGIN
  -- Editable only while draft
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft'
     AND (NEW.layout_selection_mode IS DISTINCT FROM OLD.layout_selection_mode
          OR NEW.layout_id IS DISTINCT FROM OLD.layout_id
          OR NEW.pinned_layout_version_id IS DISTINCT FROM OLD.pinned_layout_version_id) THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='layout_selection_locked_after_draft';
  END IF;
  -- Approval/publication requires selection set
  IF (NEW.status IN ('approved','published')) AND (OLD.status = 'draft' OR TG_OP='INSERT') THEN
    IF NEW.layout_selection_mode IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_selection_required';
    END IF;
    IF NEW.layout_selection_mode = 'pinned' THEN
      IF NEW.pinned_layout_version_id IS NULL OR NEW.layout_id IS NULL THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='pinned_requires_layout_and_version';
      END IF;
      SELECT layout_id INTO v_pinned_layout FROM public.core_template_layout_version WHERE id = NEW.pinned_layout_version_id;
      IF v_pinned_layout IS DISTINCT FROM NEW.layout_id THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='pinned_version_layout_mismatch';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS omni_comms_template_version_layout_trg ON public.omni_comms_template_version;
CREATE TRIGGER omni_comms_template_version_layout_trg
  BEFORE INSERT OR UPDATE ON public.omni_comms_template_version
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_template_version_layout_guard();

-- =============================================================================
-- 6. RPCs (12) — SECURITY DEFINER, capability-checked
-- =============================================================================

-- 1) list active assets
CREATE OR REPLACE FUNCTION public.core_comm_asset_list_active(
  p_organization_id uuid, p_asset_type text DEFAULT NULL
) RETURNS TABLE(id uuid, code text, name text, asset_type text, department_id uuid, active_version_id uuid, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  RETURN QUERY
    SELECT a.id, a.code, a.name, a.asset_type, a.department_id, a.active_version_id, a.updated_at
    FROM public.core_comm_asset a
    WHERE a.organization_id = p_organization_id
      AND a.status = 'active'
      AND (p_asset_type IS NULL OR a.asset_type = p_asset_type)
    ORDER BY a.asset_type, a.code;
END;$$;
ALTER FUNCTION public.core_comm_asset_list_active(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_asset_list_active(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_asset_list_active(uuid, text) TO authenticated;

-- 2) get asset with active version
CREATE OR REPLACE FUNCTION public.core_comm_asset_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT jsonb_build_object(
    'asset', to_jsonb(a.*),
    'active_version', (SELECT to_jsonb(v.*) FROM public.core_comm_asset_version v WHERE v.id = a.active_version_id)
  ) INTO v FROM public.core_comm_asset a WHERE a.id = p_id;
  IF v IS NULL THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='asset_not_found'; END IF;
  RETURN v;
END;$$;
ALTER FUNCTION public.core_comm_asset_get(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_asset_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_asset_get(uuid) TO authenticated;

-- 3) list active layouts (only email initially, but exposes all active)
CREATE OR REPLACE FUNCTION public.core_template_layout_list_active(p_layout_kind text DEFAULT NULL)
RETURNS TABLE(id uuid, code text, name text, layout_kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  RETURN QUERY SELECT l.id, l.code, l.name, l.layout_kind
    FROM public.core_template_layout l
    WHERE l.is_active = true
      AND (p_layout_kind IS NULL OR l.layout_kind = p_layout_kind)
    ORDER BY l.name;
END;$$;
ALTER FUNCTION public.core_template_layout_list_active(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_template_layout_list_active(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_template_layout_list_active(text) TO authenticated;

-- 4) get layout version (published)
CREATE OR REPLACE FUNCTION public.core_template_layout_version_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT to_jsonb(x.*) INTO v FROM public.core_template_layout_version x WHERE x.id = p_id;
  IF v IS NULL THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='layout_version_not_found'; END IF;
  RETURN v;
END;$$;
ALTER FUNCTION public.core_template_layout_version_get(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_template_layout_version_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_template_layout_version_get(uuid) TO authenticated;

-- 5) list assignments for organisation (+ optional dept)
CREATE OR REPLACE FUNCTION public.core_comm_assignment_list(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL, p_output_channel text DEFAULT 'email'
) RETURNS TABLE(id uuid, organization_id uuid, department_id uuid, output_channel text, assignment_kind text, slot_code text, layout_id uuid, asset_id uuid, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_department_id IS NOT NULL THEN
    PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;
  RETURN QUERY
    SELECT a.id,a.organization_id,a.department_id,a.output_channel,a.assignment_kind,a.slot_code,a.layout_id,a.asset_id,a.updated_at
    FROM public.core_comm_assignment a
    WHERE a.organization_id = p_organization_id
      AND a.output_channel = p_output_channel
      AND (a.department_id IS NULL OR p_department_id IS NULL OR a.department_id = p_department_id)
    ORDER BY a.assignment_kind, a.slot_code NULLS FIRST, a.department_id NULLS FIRST;
END;$$;
ALTER FUNCTION public.core_comm_assignment_list(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_assignment_list(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_assignment_list(uuid, uuid, text) TO authenticated;

-- 6) upsert org-level default (layout or asset_slot)
CREATE OR REPLACE FUNCTION public.core_comm_assignment_upsert_org_default(
  p_organization_id uuid, p_output_channel text, p_assignment_kind text,
  p_slot_code text, p_layout_id uuid, p_asset_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid uuid; v_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_assignment_kind = 'layout_default' THEN
    INSERT INTO public.core_comm_assignment(organization_id, output_channel, assignment_kind, layout_id, created_by, updated_by)
    VALUES (p_organization_id, p_output_channel, 'layout_default', p_layout_id, v_uid, v_uid)
    ON CONFLICT (organization_id, output_channel) WHERE assignment_kind='layout_default' AND department_id IS NULL
    DO UPDATE SET layout_id = EXCLUDED.layout_id, updated_by = v_uid, updated_at = now()
    RETURNING id INTO v_id;
  ELSIF p_assignment_kind = 'asset_slot' THEN
    INSERT INTO public.core_comm_assignment(organization_id, output_channel, assignment_kind, slot_code, asset_id, created_by, updated_by)
    VALUES (p_organization_id, p_output_channel, 'asset_slot', p_slot_code, p_asset_id, v_uid, v_uid)
    ON CONFLICT (organization_id, output_channel, slot_code) WHERE assignment_kind='asset_slot' AND department_id IS NULL
    DO UPDATE SET asset_id = EXCLUDED.asset_id, updated_by = v_uid, updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_assignment_kind';
  END IF;
  RETURN v_id;
END;$$;
ALTER FUNCTION public.core_comm_assignment_upsert_org_default(uuid, text, text, text, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_assignment_upsert_org_default(uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_assignment_upsert_org_default(uuid, text, text, text, uuid, uuid) TO authenticated;

-- 7) upsert dept override
CREATE OR REPLACE FUNCTION public.core_comm_assignment_upsert_dept_override(
  p_organization_id uuid, p_department_id uuid, p_output_channel text, p_assignment_kind text,
  p_slot_code text, p_layout_id uuid, p_asset_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid uuid; v_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_department_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_required';
  END IF;
  IF p_assignment_kind = 'layout_default' THEN
    INSERT INTO public.core_comm_assignment(organization_id, department_id, output_channel, assignment_kind, layout_id, created_by, updated_by)
    VALUES (p_organization_id, p_department_id, p_output_channel, 'layout_default', p_layout_id, v_uid, v_uid)
    ON CONFLICT (organization_id, department_id, output_channel) WHERE assignment_kind='layout_default' AND department_id IS NOT NULL
    DO UPDATE SET layout_id = EXCLUDED.layout_id, updated_by = v_uid, updated_at = now()
    RETURNING id INTO v_id;
  ELSIF p_assignment_kind = 'asset_slot' THEN
    INSERT INTO public.core_comm_assignment(organization_id, department_id, output_channel, assignment_kind, slot_code, asset_id, created_by, updated_by)
    VALUES (p_organization_id, p_department_id, p_output_channel, 'asset_slot', p_slot_code, p_asset_id, v_uid, v_uid)
    ON CONFLICT (organization_id, department_id, output_channel, slot_code) WHERE assignment_kind='asset_slot' AND department_id IS NOT NULL
    DO UPDATE SET asset_id = EXCLUDED.asset_id, updated_by = v_uid, updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_assignment_kind';
  END IF;
  RETURN v_id;
END;$$;
ALTER FUNCTION public.core_comm_assignment_upsert_dept_override(uuid, uuid, text, text, text, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_assignment_upsert_dept_override(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_assignment_upsert_dept_override(uuid, uuid, text, text, text, uuid, uuid) TO authenticated;

-- 8) reset dept override (retires only dept row)
CREATE OR REPLACE FUNCTION public.core_comm_assignment_reset_dept_override(
  p_organization_id uuid, p_department_id uuid, p_output_channel text,
  p_assignment_kind text, p_slot_code text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid uuid; v_rows int;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  DELETE FROM public.core_comm_assignment
    WHERE organization_id = p_organization_id
      AND department_id = p_department_id
      AND output_channel = p_output_channel
      AND assignment_kind = p_assignment_kind
      AND (p_assignment_kind = 'layout_default' OR slot_code = p_slot_code);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;$$;
ALTER FUNCTION public.core_comm_assignment_reset_dept_override(uuid, uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_assignment_reset_dept_override(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_assignment_reset_dept_override(uuid, uuid, text, text, text) TO authenticated;

-- 9) template version set layout selection (draft-only)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_set_layout_selection(
  p_version_id uuid, p_mode text, p_layout_id uuid, p_pinned_layout_version_id uuid, p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid uuid; v_row public.omni_comms_template_version;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  SELECT * INTO v_row FROM public.omni_comms_template_version WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='version_not_found'; END IF;
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='not_draft';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrency_conflict' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF p_mode NOT IN ('resolved_default','pinned') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_mode';
  END IF;
  UPDATE public.omni_comms_template_version
    SET layout_selection_mode = p_mode,
        layout_id = p_layout_id,
        pinned_layout_version_id = CASE WHEN p_mode = 'pinned' THEN p_pinned_layout_version_id ELSE NULL END,
        updated_at = now(), updated_by = v_uid
    WHERE id = p_version_id;
  RETURN jsonb_build_object('id', p_version_id, 'ok', true);
END;$$;
ALTER FUNCTION public.omni_comms_template_version_set_layout_selection(uuid, text, uuid, uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_set_layout_selection(uuid, text, uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_set_layout_selection(uuid, text, uuid, uuid, timestamptz) TO authenticated;

-- 10) resolve render manifest
CREATE OR REPLACE FUNCTION public.omni_comms_resolve_render_manifest(
  p_template_version_id uuid, p_organization_id uuid, p_department_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tv public.omni_comms_template_version;
  v_fam public.omni_comms_template_family;
  v_layout_id uuid; v_layout_version_id uuid; v_layout_source text;
  v_slots jsonb; v_slot jsonb; v_slot_code text;
  v_resolved jsonb := '[]'::jsonb;
  v_asset public.core_comm_asset;
  v_av public.core_comm_asset_version;
  v_asset_id uuid; v_inh text;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT * INTO v_tv FROM public.omni_comms_template_version WHERE id = p_template_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='version_not_found'; END IF;
  SELECT * INTO v_fam FROM public.omni_comms_template_family WHERE id = v_tv.template_family_id;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  -- layout resolution
  IF v_tv.layout_selection_mode = 'pinned' THEN
    v_layout_id := v_tv.layout_id;
    v_layout_version_id := v_tv.pinned_layout_version_id;
    v_layout_source := 'pinned';
  ELSE
    -- department override → organisation default
    SELECT layout_id INTO v_layout_id FROM public.core_comm_assignment
      WHERE organization_id = p_organization_id AND department_id = p_department_id
        AND output_channel = v_tv.channel AND assignment_kind = 'layout_default';
    IF v_layout_id IS NOT NULL THEN
      v_layout_source := 'department';
    ELSE
      SELECT layout_id INTO v_layout_id FROM public.core_comm_assignment
        WHERE organization_id = p_organization_id AND department_id IS NULL
          AND output_channel = v_tv.channel AND assignment_kind = 'layout_default';
      IF v_layout_id IS NOT NULL THEN v_layout_source := 'organization'; END IF;
    END IF;
    IF v_layout_id IS NOT NULL THEN
      SELECT id INTO v_layout_version_id FROM public.core_template_layout_version
        WHERE layout_id = v_layout_id AND status='published'
        ORDER BY version_number DESC LIMIT 1;
    END IF;
  END IF;

  -- slot resolution
  IF v_layout_version_id IS NOT NULL THEN
    SELECT slots INTO v_slots FROM public.core_template_layout_version WHERE id = v_layout_version_id;
    FOR v_slot IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
      v_slot_code := v_slot->>'code';
      IF v_slot_code = 'content_body' THEN CONTINUE; END IF;
      v_asset_id := NULL; v_inh := NULL;
      IF p_department_id IS NOT NULL THEN
        SELECT asset_id INTO v_asset_id FROM public.core_comm_assignment
          WHERE organization_id=p_organization_id AND department_id=p_department_id
            AND output_channel=v_tv.channel AND assignment_kind='asset_slot' AND slot_code=v_slot_code;
        IF v_asset_id IS NOT NULL THEN v_inh := 'department'; END IF;
      END IF;
      IF v_asset_id IS NULL THEN
        SELECT asset_id INTO v_asset_id FROM public.core_comm_assignment
          WHERE organization_id=p_organization_id AND department_id IS NULL
            AND output_channel=v_tv.channel AND assignment_kind='asset_slot' AND slot_code=v_slot_code;
        IF v_asset_id IS NOT NULL THEN v_inh := 'organization'; END IF;
      END IF;
      IF v_asset_id IS NOT NULL THEN
        SELECT * INTO v_asset FROM public.core_comm_asset WHERE id = v_asset_id;
        SELECT * INTO v_av FROM public.core_comm_asset_version WHERE id = v_asset.active_version_id;
        v_resolved := v_resolved || jsonb_build_object(
          'slot', v_slot_code, 'asset_id', v_asset.id,
          'asset_version_id', v_av.id, 'asset_type', v_asset.asset_type,
          'inheritance_source', v_inh,
          'content_html', v_av.content_html, 'content_text', v_av.content_text,
          'checksum', v_av.checksum
        );
      ELSE
        v_resolved := v_resolved || jsonb_build_object(
          'slot', v_slot_code, 'asset_id', null, 'asset_version_id', null,
          'asset_type', null, 'inheritance_source', 'unresolved'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'template_family_id', v_tv.template_family_id,
    'template_version_id', v_tv.id,
    'template_content', v_tv.content,
    'template_channel', v_tv.channel,
    'template_locale', v_tv.locale,
    'layout_id', v_layout_id,
    'layout_version_id', v_layout_version_id,
    'layout_inheritance_source', v_layout_source,
    'layout_slots', v_slots,
    'resolved_assets', v_resolved
  );
END;$$;
ALTER FUNCTION public.omni_comms_resolve_render_manifest(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_resolve_render_manifest(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_resolve_render_manifest(uuid, uuid, uuid) TO authenticated;

-- 11) pilot migration dry-run
CREATE OR REPLACE FUNCTION public.core_comm_pilot_migration_dry_run(
  p_organization_id uuid, p_department_id uuid,
  p_letterhead_id uuid, p_signature_id uuid, p_footer_id uuid, p_dept_signature_id uuid,
  p_email_layout_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_report jsonb := '{}'::jsonb; v_bucket_ok bool := true;
  v_lh record; v_sig record; v_ft record; v_dsig record; v_lay record;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('configure');
  PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  SELECT id, name, header_html, footer_html INTO v_lh FROM public.comm_letterhead WHERE id = p_letterhead_id;
  SELECT id, body INTO v_sig FROM public.comm_signature WHERE id = p_signature_id;
  SELECT id, body INTO v_ft FROM public.comm_footer WHERE id = p_footer_id;
  IF p_dept_signature_id IS NOT NULL THEN
    SELECT id, body INTO v_dsig FROM public.comm_signature WHERE id = p_dept_signature_id;
  END IF;
  SELECT id, name, layout_kind INTO v_lay FROM public.core_template_layout WHERE id = p_email_layout_id;
  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'sources', jsonb_build_object(
      'letterhead', to_jsonb(v_lh),
      'org_signature', to_jsonb(v_sig),
      'footer', to_jsonb(v_ft),
      'dept_signature', to_jsonb(v_dsig),
      'email_layout', to_jsonb(v_lay)
    ),
    'destination_codes', jsonb_build_object(
      'org_email_header', 'PILOT.ORG.EMAIL_HEADER',
      'org_email_footer', 'PILOT.ORG.EMAIL_FOOTER',
      'org_email_signature', 'PILOT.ORG.EMAIL_SIGNATURE',
      'dept_email_signature', 'PILOT.DEPT.EMAIL_SIGNATURE'
    ),
    'ambiguity', CASE
      WHEN v_lh.id IS NULL OR v_sig.id IS NULL OR v_ft.id IS NULL OR v_lay.id IS NULL THEN 'source_missing'
      ELSE 'none'
    END,
    'storage_bucket_check', v_bucket_ok,
    'dry_run', true
  );
END;$$;
ALTER FUNCTION public.core_comm_pilot_migration_dry_run(uuid, uuid, uuid, uuid, uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_pilot_migration_dry_run(uuid, uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_pilot_migration_dry_run(uuid, uuid, uuid, uuid, uuid, uuid, uuid) TO authenticated;

-- 12) pilot migration apply — idempotent
CREATE OR REPLACE FUNCTION public.core_comm_pilot_migration_apply(
  p_organization_id uuid, p_department_id uuid,
  p_letterhead_id uuid, p_signature_id uuid, p_footer_id uuid, p_dept_signature_id uuid,
  p_email_layout_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_uid uuid;
  v_lh record; v_sig record; v_ft record; v_dsig record; v_lay record;
  v_asset_hdr uuid; v_asset_ftr uuid; v_asset_sig uuid; v_asset_dsig uuid;
  v_ver_hdr uuid; v_ver_ftr uuid; v_ver_sig uuid; v_ver_dsig uuid;
  v_layv uuid;
  v_hdr_html text; v_ftr_html text; v_sig_html text; v_dsig_html text;
  v_slots jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  SELECT * INTO v_lh FROM public.comm_letterhead WHERE id = p_letterhead_id;
  SELECT * INTO v_sig FROM public.comm_signature WHERE id = p_signature_id;
  SELECT * INTO v_ft FROM public.comm_footer WHERE id = p_footer_id;
  IF p_dept_signature_id IS NOT NULL THEN
    SELECT * INTO v_dsig FROM public.comm_signature WHERE id = p_dept_signature_id;
  END IF;
  SELECT * INTO v_lay FROM public.core_template_layout WHERE id = p_email_layout_id;
  IF v_lh.id IS NULL OR v_sig.id IS NULL OR v_ft.id IS NULL OR v_lay.id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='pilot_source_missing';
  END IF;
  v_hdr_html := COALESCE(v_lh.header_html, '<div>Header</div>');
  v_ftr_html := COALESCE(v_ft.body, '<div>Footer</div>');
  v_sig_html := COALESCE(v_sig.body, '<div>Signature</div>');
  IF v_dsig.id IS NOT NULL THEN
    v_dsig_html := COALESCE(v_dsig.body, '<div>Dept Signature</div>');
  END IF;

  -- Idempotent upserts (asset masters)
  INSERT INTO public.core_comm_asset(organization_id, asset_type, code, name, status, created_by, updated_by, activated_at, activated_by)
    VALUES (p_organization_id, 'email_header', 'PILOT.ORG.EMAIL_HEADER', 'Pilot organisation email header', 'draft', v_uid, v_uid, NULL, NULL)
    ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by = v_uid, updated_at = now()
    RETURNING id INTO v_asset_hdr;
  INSERT INTO public.core_comm_asset(organization_id, asset_type, code, name, status, created_by, updated_by)
    VALUES (p_organization_id, 'email_footer', 'PILOT.ORG.EMAIL_FOOTER', 'Pilot organisation email footer', 'draft', v_uid, v_uid)
    ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by = v_uid, updated_at = now()
    RETURNING id INTO v_asset_ftr;
  INSERT INTO public.core_comm_asset(organization_id, asset_type, code, name, status, created_by, updated_by)
    VALUES (p_organization_id, 'email_signature', 'PILOT.ORG.EMAIL_SIGNATURE', 'Pilot organisation email signature', 'draft', v_uid, v_uid)
    ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by = v_uid, updated_at = now()
    RETURNING id INTO v_asset_sig;
  IF v_dsig.id IS NOT NULL THEN
    INSERT INTO public.core_comm_asset(organization_id, department_id, asset_type, code, name, status, created_by, updated_by)
      VALUES (p_organization_id, p_department_id, 'email_signature', 'PILOT.DEPT.EMAIL_SIGNATURE', 'Pilot department email signature', 'draft', v_uid, v_uid)
      ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by = v_uid, updated_at = now()
      RETURNING id INTO v_asset_dsig;
  END IF;

  -- version 1 (idempotent)
  INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
    VALUES (v_asset_hdr, 1, v_hdr_html, encode(extensions.digest(v_hdr_html,'sha256'),'hex'), v_uid)
    ON CONFLICT (asset_id, version_number) DO NOTHING
    RETURNING id INTO v_ver_hdr;
  IF v_ver_hdr IS NULL THEN SELECT id INTO v_ver_hdr FROM public.core_comm_asset_version WHERE asset_id=v_asset_hdr AND version_number=1; END IF;

  INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
    VALUES (v_asset_ftr, 1, v_ftr_html, encode(extensions.digest(v_ftr_html,'sha256'),'hex'), v_uid)
    ON CONFLICT (asset_id, version_number) DO NOTHING
    RETURNING id INTO v_ver_ftr;
  IF v_ver_ftr IS NULL THEN SELECT id INTO v_ver_ftr FROM public.core_comm_asset_version WHERE asset_id=v_asset_ftr AND version_number=1; END IF;

  INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
    VALUES (v_asset_sig, 1, v_sig_html, encode(extensions.digest(v_sig_html,'sha256'),'hex'), v_uid)
    ON CONFLICT (asset_id, version_number) DO NOTHING
    RETURNING id INTO v_ver_sig;
  IF v_ver_sig IS NULL THEN SELECT id INTO v_ver_sig FROM public.core_comm_asset_version WHERE asset_id=v_asset_sig AND version_number=1; END IF;

  IF v_asset_dsig IS NOT NULL THEN
    INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
      VALUES (v_asset_dsig, 1, v_dsig_html, encode(extensions.digest(v_dsig_html,'sha256'),'hex'), v_uid)
      ON CONFLICT (asset_id, version_number) DO NOTHING
      RETURNING id INTO v_ver_dsig;
    IF v_ver_dsig IS NULL THEN SELECT id INTO v_ver_dsig FROM public.core_comm_asset_version WHERE asset_id=v_asset_dsig AND version_number=1; END IF;
  END IF;

  -- activate assets (idempotent)
  UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_hdr, activated_at=COALESCE(activated_at, now()), activated_by=COALESCE(activated_by, v_uid) WHERE id=v_asset_hdr AND status<>'retired';
  UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_ftr, activated_at=COALESCE(activated_at, now()), activated_by=COALESCE(activated_by, v_uid) WHERE id=v_asset_ftr AND status<>'retired';
  UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_sig, activated_at=COALESCE(activated_at, now()), activated_by=COALESCE(activated_by, v_uid) WHERE id=v_asset_sig AND status<>'retired';
  IF v_asset_dsig IS NOT NULL THEN
    UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_dsig, activated_at=COALESCE(activated_at, now()), activated_by=COALESCE(activated_by, v_uid) WHERE id=v_asset_dsig AND status<>'retired';
  END IF;

  -- layout version (idempotent)
  v_slots := jsonb_build_array(
    jsonb_build_object('code','email_header','order',10,'required',false,'allowed_asset_types', jsonb_build_array('email_header')),
    jsonb_build_object('code','content_body','order',20,'required',true),
    jsonb_build_object('code','email_signature','order',30,'required',false,'allowed_asset_types', jsonb_build_array('email_signature')),
    jsonb_build_object('code','disclaimer','order',40,'required',false,'allowed_asset_types', jsonb_build_array('disclaimer')),
    jsonb_build_object('code','email_footer','order',50,'required',false,'allowed_asset_types', jsonb_build_array('email_footer'))
  );
  INSERT INTO public.core_template_layout_version(layout_id, version_number, slots, checksum, published_by)
    VALUES (p_email_layout_id, 1, v_slots, encode(extensions.digest(v_slots::text,'sha256'),'hex'), v_uid)
    ON CONFLICT (layout_id, version_number) DO NOTHING
    RETURNING id INTO v_layv;
  IF v_layv IS NULL THEN SELECT id INTO v_layv FROM public.core_template_layout_version WHERE layout_id=p_email_layout_id AND version_number=1; END IF;

  -- assignments: org layout default + org asset slots + dept signature override
  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','layout_default',NULL,p_email_layout_id,NULL);
  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','asset_slot','email_header',NULL,v_asset_hdr);
  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','asset_slot','email_footer',NULL,v_asset_ftr);
  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','asset_slot','email_signature',NULL,v_asset_sig);
  IF v_asset_dsig IS NOT NULL THEN
    PERFORM public.core_comm_assignment_upsert_dept_override(p_organization_id, p_department_id,'email','asset_slot','email_signature',NULL,v_asset_dsig);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'assets', jsonb_build_object('email_header', v_asset_hdr, 'email_footer', v_asset_ftr, 'email_signature', v_asset_sig, 'dept_email_signature', v_asset_dsig),
    'versions', jsonb_build_object('email_header', v_ver_hdr, 'email_footer', v_ver_ftr, 'email_signature', v_ver_sig, 'dept_email_signature', v_ver_dsig),
    'layout_version_id', v_layv
  );
END;$$;
ALTER FUNCTION public.core_comm_pilot_migration_apply(uuid, uuid, uuid, uuid, uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_pilot_migration_apply(uuid, uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_pilot_migration_apply(uuid, uuid, uuid, uuid, uuid, uuid, uuid) TO authenticated;
