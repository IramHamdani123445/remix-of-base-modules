-- ============================================================
-- Omni-Comms — Epic 2 Story 1: Event foundation
-- ============================================================

-- ---------- Table: omni_comms_event_definition ----------
CREATE TABLE public.omni_comms_event_definition (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL,
  module_code           text NOT NULL,
  entity_type           text NOT NULL,
  name                  text NOT NULL,
  description           text,
  communication_class   text NOT NULL,
  default_priority      text NOT NULL DEFAULT 'normal',
  status                text NOT NULL DEFAULT 'draft',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT omni_comms_event_definition_code_key UNIQUE (code),
  CONSTRAINT omni_comms_event_definition_code_format_chk
    CHECK (code ~ '^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$'),
  CONSTRAINT omni_comms_event_definition_module_code_chk
    CHECK (btrim(module_code) = module_code
           AND length(module_code) > 0
           AND module_code = upper(module_code)),
  CONSTRAINT omni_comms_event_definition_entity_type_chk
    CHECK (btrim(entity_type) = entity_type AND length(entity_type) > 0),
  CONSTRAINT omni_comms_event_definition_name_chk
    CHECK (btrim(name) = name AND length(name) > 0),
  CONSTRAINT omni_comms_event_definition_class_chk
    CHECK (communication_class IN
      ('transactional','service','security','legal_mandatory','operational','marketing')),
  CONSTRAINT omni_comms_event_definition_priority_chk
    CHECK (default_priority IN ('low','normal','high','urgent')),
  CONSTRAINT omni_comms_event_definition_status_chk
    CHECK (status IN ('draft','active','suspended','retired'))
);

-- Code segments must agree with module_code and entity_type
ALTER TABLE public.omni_comms_event_definition
  ADD CONSTRAINT omni_comms_event_definition_code_segments_chk CHECK (
    split_part(code, '.', 1) = module_code
    AND split_part(code, '.', 2) = upper(entity_type)
  );

-- ---------- Table: omni_comms_event_contract ----------
CREATE TABLE public.omni_comms_event_contract (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_definition_id   uuid NOT NULL
    REFERENCES public.omni_comms_event_definition(id) ON DELETE RESTRICT,
  version_number        integer NOT NULL,
  json_schema           jsonb NOT NULL,
  sample_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'draft',
  checksum              text,
  published_at          timestamptz,
  published_by          uuid,
  retired_at            timestamptz,
  retired_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT omni_comms_event_contract_event_version_key
    UNIQUE (event_definition_id, version_number),
  CONSTRAINT omni_comms_event_contract_version_positive_chk
    CHECK (version_number > 0),
  CONSTRAINT omni_comms_event_contract_json_schema_object_chk
    CHECK (jsonb_typeof(json_schema) = 'object'),
  CONSTRAINT omni_comms_event_contract_sample_payload_object_chk
    CHECK (jsonb_typeof(sample_payload) = 'object'),
  CONSTRAINT omni_comms_event_contract_status_chk
    CHECK (status IN ('draft','published','retired')),
  CONSTRAINT omni_comms_event_contract_checksum_format_chk
    CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_event_contract_lifecycle_fields_chk CHECK (
    CASE status
      WHEN 'draft' THEN
        published_at IS NULL AND published_by IS NULL
        AND retired_at IS NULL AND retired_by IS NULL
      WHEN 'published' THEN
        published_at IS NOT NULL AND published_by IS NOT NULL
        AND checksum IS NOT NULL
        AND retired_at IS NULL AND retired_by IS NULL
      WHEN 'retired' THEN
        published_at IS NOT NULL AND published_by IS NOT NULL
        AND retired_at IS NOT NULL AND retired_by IS NOT NULL
        AND checksum IS NOT NULL
    END
  )
);

-- ---------- Indexes (minimal, non-duplicating) ----------
-- event_definition
CREATE INDEX omni_comms_event_definition_module_status_idx
  ON public.omni_comms_event_definition (module_code, status);

-- event_contract
CREATE INDEX omni_comms_event_contract_published_idx
  ON public.omni_comms_event_contract (event_definition_id, version_number)
  WHERE status = 'published';

-- ---------- Trigger function: event_definition lifecycle ----------
CREATE OR REPLACE FUNCTION public.omni_comms_enforce_event_definition_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_event_definition may only be inserted with status=draft (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  -- Allowed transitions
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft'     AND NEW.status IN ('active','retired'))
      OR (OLD.status = 'active'    AND NEW.status IN ('suspended','retired'))
      OR (OLD.status = 'suspended' AND NEW.status IN ('active','retired'))
    ) THEN
      RAISE EXCEPTION 'omni_comms_event_definition disallowed status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Retired terminal
  IF OLD.status = 'retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'omni_comms_event_definition retired events cannot be reactivated'
      USING ERRCODE = 'check_violation';
  END IF;

  -- code editable only while draft->draft; not in same update that leaves draft
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    IF NOT (OLD.status = 'draft' AND NEW.status = 'draft') THEN
      RAISE EXCEPTION 'omni_comms_event_definition code is immutable once event leaves draft'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------- Trigger function: event_contract lifecycle ----------
CREATE OR REPLACE FUNCTION public.omni_comms_enforce_event_contract_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published','retired') THEN
      RAISE EXCEPTION 'omni_comms_event_contract cannot delete % contract', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_event_contract may only be inserted with status=draft (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  -- Retired: fully immutable
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'omni_comms_event_contract retired contracts are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Status transition rules
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'draft' AND NEW.status = 'published' THEN
      IF NEW.checksum IS NULL OR NEW.published_at IS NULL OR NEW.published_by IS NULL THEN
        RAISE EXCEPTION 'omni_comms_event_contract publish requires checksum, published_at, published_by'
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT status INTO v_owner_status
        FROM public.omni_comms_event_definition
        WHERE id = NEW.event_definition_id;
      IF v_owner_status = 'retired' THEN
        RAISE EXCEPTION 'omni_comms_event_contract cannot publish against a retired event'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF OLD.status = 'published' AND NEW.status = 'retired' THEN
      IF NEW.retired_at IS NULL OR NEW.retired_by IS NULL THEN
        RAISE EXCEPTION 'omni_comms_event_contract retire requires retired_at, retired_by'
          USING ERRCODE = 'check_violation';
      END IF;
      -- Preserve identity/content/publication fields on retirement
      IF NEW.event_definition_id IS DISTINCT FROM OLD.event_definition_id
         OR NEW.version_number   IS DISTINCT FROM OLD.version_number
         OR NEW.json_schema      IS DISTINCT FROM OLD.json_schema
         OR NEW.sample_payload   IS DISTINCT FROM OLD.sample_payload
         OR NEW.checksum         IS DISTINCT FROM OLD.checksum
         OR NEW.published_at     IS DISTINCT FROM OLD.published_at
         OR NEW.published_by     IS DISTINCT FROM OLD.published_by
         OR NEW.created_at       IS DISTINCT FROM OLD.created_at
         OR NEW.created_by       IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'omni_comms_event_contract retirement must preserve identity, content, checksum, publication and creation fields'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'omni_comms_event_contract disallowed status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- No status change
    IF OLD.status = 'published' THEN
      -- Published contracts are immutable except retire
      IF NEW.event_definition_id IS DISTINCT FROM OLD.event_definition_id
         OR NEW.version_number   IS DISTINCT FROM OLD.version_number
         OR NEW.json_schema      IS DISTINCT FROM OLD.json_schema
         OR NEW.sample_payload   IS DISTINCT FROM OLD.sample_payload
         OR NEW.checksum         IS DISTINCT FROM OLD.checksum
         OR NEW.published_at     IS DISTINCT FROM OLD.published_at
         OR NEW.published_by     IS DISTINCT FROM OLD.published_by
         OR NEW.created_at       IS DISTINCT FROM OLD.created_at
         OR NEW.created_by       IS DISTINCT FROM OLD.created_by
         OR NEW.retired_at       IS DISTINCT FROM OLD.retired_at
         OR NEW.retired_by       IS DISTINCT FROM OLD.retired_by THEN
        RAISE EXCEPTION 'omni_comms_event_contract published contracts are immutable except retirement'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------- Triggers ----------
CREATE TRIGGER omni_comms_event_definition_enforce_rules_trg
  BEFORE INSERT OR UPDATE ON public.omni_comms_event_definition
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_enforce_event_definition_rules();

CREATE TRIGGER omni_comms_event_contract_enforce_rules_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.omni_comms_event_contract
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_enforce_event_contract_rules();

-- ---------- RLS + grants ----------
-- service_role has BYPASSRLS (verified). RLS is enabled and NO policies are
-- created; enabling RLS blocks anon/authenticated by default, and service_role
-- bypasses it. This avoids misleading service_role-only policies.
ALTER TABLE public.omni_comms_event_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_event_contract   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.omni_comms_event_definition FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.omni_comms_event_contract   FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omni_comms_event_definition TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.omni_comms_event_contract   TO service_role;

COMMENT ON TABLE public.omni_comms_event_definition IS
  'Omni-Comms Epic 2 Story 1: canonical business-event catalogue (MODULE.ENTITY.ACTION). Server-side writes only.';
COMMENT ON TABLE public.omni_comms_event_contract IS
  'Omni-Comms Epic 2 Story 1: versioned payload contracts per event. Draft -> published -> retired; published/retired immutable. Server-side writes only.';
