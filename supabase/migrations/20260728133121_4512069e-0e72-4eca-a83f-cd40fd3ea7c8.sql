-- ============================================================================
-- Omni-Comms — Epic 3 Story 1: Template Family and Template Version foundation
-- ============================================================================

-- ---------- Table: omni_comms_template_family ----------
CREATE TABLE public.omni_comms_template_family (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL,
  name                  text NOT NULL,
  description           text,
  scope_type            text NOT NULL,
  organization_id       uuid NOT NULL
    REFERENCES public.core_organization(id) ON DELETE RESTRICT,
  department_id         uuid
    REFERENCES public.core_department(id) ON DELETE RESTRICT,
  event_definition_id   uuid
    REFERENCES public.omni_comms_event_definition(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'draft',
  activated_at          timestamptz,
  activated_by          uuid,
  retired_at            timestamptz,
  retired_by            uuid,
  retirement_reason     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT omni_comms_template_family_code_format_chk
    CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT omni_comms_template_family_name_chk
    CHECK (btrim(name) = name AND length(name) > 0),
  CONSTRAINT omni_comms_template_family_scope_type_chk
    CHECK (scope_type IN ('organization','department','event')),
  CONSTRAINT omni_comms_template_family_scope_shape_chk CHECK (
    (scope_type = 'organization' AND department_id IS NULL AND event_definition_id IS NULL)
    OR (scope_type = 'department' AND department_id IS NOT NULL AND event_definition_id IS NULL)
    OR (scope_type = 'event' AND department_id IS NULL AND event_definition_id IS NOT NULL)
  ),
  CONSTRAINT omni_comms_template_family_status_chk
    CHECK (status IN ('draft','active','retired')),
  CONSTRAINT omni_comms_template_family_lifecycle_fields_chk CHECK (
    CASE status
      WHEN 'draft' THEN
        activated_at IS NULL AND activated_by IS NULL
        AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL
      WHEN 'active' THEN
        activated_at IS NOT NULL AND activated_by IS NOT NULL
        AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL
      WHEN 'retired' THEN
        retired_at IS NOT NULL AND retired_by IS NOT NULL
        AND retirement_reason IS NOT NULL
        AND btrim(retirement_reason) <> ''
    END
  ),
  CONSTRAINT omni_comms_template_family_retirement_reason_len_chk
    CHECK (retirement_reason IS NULL OR length(retirement_reason) <= 2000)
);

-- Partial unique indexes: same code may coexist across valid scopes
CREATE UNIQUE INDEX omni_comms_template_family_org_scope_code_uk
  ON public.omni_comms_template_family (organization_id, code)
  WHERE scope_type = 'organization';

CREATE UNIQUE INDEX omni_comms_template_family_dept_scope_code_uk
  ON public.omni_comms_template_family (organization_id, department_id, code)
  WHERE scope_type = 'department';

CREATE UNIQUE INDEX omni_comms_template_family_event_scope_code_uk
  ON public.omni_comms_template_family (organization_id, event_definition_id, code)
  WHERE scope_type = 'event';

-- ---------- Table: omni_comms_template_version ----------
CREATE TABLE public.omni_comms_template_version (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_family_id    uuid NOT NULL
    REFERENCES public.omni_comms_template_family(id) ON DELETE RESTRICT,
  version_number        integer NOT NULL,
  channel               text NOT NULL,
  locale                text NOT NULL,
  content               jsonb NOT NULL,
  status                text NOT NULL DEFAULT 'draft',
  checksum              text,
  approved_at           timestamptz,
  approved_by           uuid,
  published_at          timestamptz,
  published_by          uuid,
  retired_at            timestamptz,
  retired_by            uuid,
  retirement_reason     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT omni_comms_template_version_number_positive_chk
    CHECK (version_number > 0),
  CONSTRAINT omni_comms_template_version_channel_chk
    CHECK (channel IN ('email','sms','in_app','push','whatsapp','print')),
  CONSTRAINT omni_comms_template_version_locale_chk
    CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  CONSTRAINT omni_comms_template_version_content_object_chk
    CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT omni_comms_template_version_status_chk
    CHECK (status IN ('draft','approved','published','retired')),
  CONSTRAINT omni_comms_template_version_checksum_format_chk
    CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_template_version_family_channel_locale_version_uk
    UNIQUE (template_family_id, channel, locale, version_number),
  CONSTRAINT omni_comms_template_version_lifecycle_fields_chk CHECK (
    CASE status
      WHEN 'draft' THEN
        checksum IS NULL
        AND approved_at IS NULL AND approved_by IS NULL
        AND published_at IS NULL AND published_by IS NULL
        AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL
      WHEN 'approved' THEN
        checksum IS NOT NULL
        AND approved_at IS NOT NULL AND approved_by IS NOT NULL
        AND published_at IS NULL AND published_by IS NULL
        AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL
      WHEN 'published' THEN
        checksum IS NOT NULL
        AND approved_at IS NOT NULL AND approved_by IS NOT NULL
        AND published_at IS NOT NULL AND published_by IS NOT NULL
        AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL
      WHEN 'retired' THEN
        checksum IS NOT NULL
        AND approved_at IS NOT NULL AND approved_by IS NOT NULL
        AND retired_at IS NOT NULL AND retired_by IS NOT NULL
        AND retirement_reason IS NOT NULL
        AND btrim(retirement_reason) <> ''
    END
  ),
  CONSTRAINT omni_comms_template_version_retirement_reason_len_chk
    CHECK (retirement_reason IS NULL OR length(retirement_reason) <= 2000),
  CONSTRAINT omni_comms_template_version_independent_approver_chk
    CHECK (status = 'draft' OR approved_by IS DISTINCT FROM created_by)
);

-- Partial unique index: at most one published per family/channel/locale
CREATE UNIQUE INDEX omni_comms_template_version_published_uk
  ON public.omni_comms_template_version (template_family_id, channel, locale)
  WHERE status = 'published';

-- ---------- Trigger function: template_family lifecycle ----------
CREATE OR REPLACE FUNCTION public.omni_comms_enforce_template_family_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dept_org uuid;
  v_version_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_template_family may only be inserted with status=draft (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.scope_type = 'department' THEN
      SELECT organization_id INTO v_dept_org
        FROM public.core_department WHERE id = NEW.department_id;
      IF v_dept_org IS NULL THEN
        RAISE EXCEPTION 'omni_comms_template_family department_id % not found', NEW.department_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF v_dept_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'omni_comms_template_family department_id % does not belong to organization_id %',
          NEW.department_id, NEW.organization_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Allowed transitions
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'draft'  AND NEW.status = 'active')
        OR (OLD.status = 'draft'  AND NEW.status = 'retired')
        OR (OLD.status = 'active' AND NEW.status = 'retired')
      ) THEN
        RAISE EXCEPTION 'omni_comms_template_family invalid status transition % -> %', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Immutability once leaving draft
    IF OLD.status <> 'draft' THEN
      IF NEW.code               IS DISTINCT FROM OLD.code
         OR NEW.scope_type          IS DISTINCT FROM OLD.scope_type
         OR NEW.organization_id     IS DISTINCT FROM OLD.organization_id
         OR NEW.department_id       IS DISTINCT FROM OLD.department_id
         OR NEW.event_definition_id IS DISTINCT FROM OLD.event_definition_id
         OR NEW.created_at          IS DISTINCT FROM OLD.created_at
         OR NEW.created_by          IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'omni_comms_template_family identity fields are immutable after leaving draft'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Re-verify department ownership if changed (only possible while draft)
    IF NEW.scope_type = 'department'
       AND NEW.department_id IS DISTINCT FROM OLD.department_id THEN
      SELECT organization_id INTO v_dept_org
        FROM public.core_department WHERE id = NEW.department_id;
      IF v_dept_org IS NULL OR v_dept_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'omni_comms_template_family department_id % does not belong to organization_id %',
          NEW.department_id, NEW.organization_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_template_family may only be deleted while status=draft (got %)', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO v_version_count
      FROM public.omni_comms_template_version WHERE template_family_id = OLD.id;
    IF v_version_count > 0 THEN
      RAISE EXCEPTION 'omni_comms_template_family cannot be deleted while % version(s) exist', v_version_count
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------- Trigger function: template_version lifecycle ----------
CREATE OR REPLACE FUNCTION public.omni_comms_enforce_template_version_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_template_version may only be inserted with status=draft (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT status INTO v_family_status
      FROM public.omni_comms_template_family WHERE id = NEW.template_family_id;
    IF v_family_status IS NULL THEN
      RAISE EXCEPTION 'omni_comms_template_version template_family_id % not found', NEW.template_family_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_family_status = 'retired' THEN
      RAISE EXCEPTION 'omni_comms_template_version cannot be created under retired family %', NEW.template_family_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Allowed transitions
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'draft'    AND NEW.status = 'approved')
        OR (OLD.status = 'approved' AND NEW.status = 'published')
        OR (OLD.status = 'approved' AND NEW.status = 'retired')
        OR (OLD.status = 'published' AND NEW.status = 'retired')
      ) THEN
        RAISE EXCEPTION 'omni_comms_template_version invalid status transition % -> %', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;

      -- On approval, family must not be retired
      IF NEW.status = 'approved' THEN
        SELECT status INTO v_family_status
          FROM public.omni_comms_template_family WHERE id = NEW.template_family_id;
        IF v_family_status = 'retired' THEN
          RAISE EXCEPTION 'omni_comms_template_version cannot be approved under retired family'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      -- On publish, family must be active
      IF NEW.status = 'published' THEN
        SELECT status INTO v_family_status
          FROM public.omni_comms_template_family WHERE id = NEW.template_family_id;
        IF v_family_status <> 'active' THEN
          RAISE EXCEPTION 'omni_comms_template_version can only be published when family is active (family status=%)', v_family_status
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;

    -- Immutability once leaving draft
    IF OLD.status <> 'draft' THEN
      IF NEW.template_family_id IS DISTINCT FROM OLD.template_family_id
         OR NEW.version_number  IS DISTINCT FROM OLD.version_number
         OR NEW.channel         IS DISTINCT FROM OLD.channel
         OR NEW.locale          IS DISTINCT FROM OLD.locale
         OR NEW.content         IS DISTINCT FROM OLD.content
         OR NEW.checksum        IS DISTINCT FROM OLD.checksum
         OR NEW.approved_at     IS DISTINCT FROM OLD.approved_at
         OR NEW.approved_by     IS DISTINCT FROM OLD.approved_by
         OR NEW.created_at      IS DISTINCT FROM OLD.created_at
         OR NEW.created_by      IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'omni_comms_template_version approved fields are immutable'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Publication metadata immutable once published
    IF OLD.status IN ('published','retired') AND OLD.published_at IS NOT NULL THEN
      IF NEW.published_at IS DISTINCT FROM OLD.published_at
         OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
        RAISE EXCEPTION 'omni_comms_template_version publication metadata is immutable'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Retired terminal
    IF OLD.status = 'retired' THEN
      IF NEW.retired_at        IS DISTINCT FROM OLD.retired_at
         OR NEW.retired_by     IS DISTINCT FROM OLD.retired_by
         OR NEW.retirement_reason IS DISTINCT FROM OLD.retirement_reason THEN
        RAISE EXCEPTION 'omni_comms_template_version retirement fields are immutable once retired'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_template_version may only be deleted while status=draft (got %)', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------- Triggers ----------
CREATE TRIGGER omni_comms_template_family_enforce_rules_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.omni_comms_template_family
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_enforce_template_family_rules();

CREATE TRIGGER omni_comms_template_version_enforce_rules_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.omni_comms_template_version
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_enforce_template_version_rules();

-- ---------- RLS + grants ----------
-- service_role has BYPASSRLS. RLS enabled with no policies; anon/authenticated
-- have all privileges revoked; no browser access.
ALTER TABLE public.omni_comms_template_family  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_template_version ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.omni_comms_template_family  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.omni_comms_template_version FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omni_comms_template_family  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.omni_comms_template_version TO service_role;

COMMENT ON TABLE public.omni_comms_template_family IS
  'Omni-Comms Epic 3 Story 1: template family identity with organization/department/event scope. Server-side writes only.';
COMMENT ON TABLE public.omni_comms_template_version IS
  'Omni-Comms Epic 3 Story 1: versioned template content per channel/locale. Draft -> approved -> published -> retired; content immutable after approval. Server-side writes only.';
