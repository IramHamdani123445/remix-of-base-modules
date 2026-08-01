-- ===========================================================================
-- Build 4A — Part 2: producer-to-event authorisation
-- Object: public.omni_comms_producer_event_binding (registry entry #23)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.omni_comms_producer_event_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.core_organization(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.core_department(id) ON DELETE RESTRICT,
  caller_module_code text NOT NULL,
  event_definition_id uuid NOT NULL REFERENCES public.omni_comms_event_definition(id) ON DELETE RESTRICT,
  allowed_modes text[] NOT NULL DEFAULT ARRAY['dry_run']::text[],
  status text NOT NULL DEFAULT 'draft',
  integration_reference text,
  lifecycle_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  activated_at timestamptz,
  activated_by uuid,
  suspended_at timestamptz,
  suspended_by uuid,
  retired_at timestamptz,
  retired_by uuid,
  CONSTRAINT omni_comms_peb_status_chk
    CHECK (status IN ('draft', 'active', 'suspended', 'retired')),
  CONSTRAINT omni_comms_peb_module_upper_chk
    CHECK (caller_module_code = upper(btrim(caller_module_code)) AND caller_module_code <> ''),
  CONSTRAINT omni_comms_peb_modes_nonempty_chk
    CHECK (array_length(allowed_modes, 1) IS NOT NULL AND array_length(allowed_modes, 1) BETWEEN 1 AND 3),
  CONSTRAINT omni_comms_peb_modes_bounded_chk
    CHECK (allowed_modes <@ ARRAY['dry_run', 'shadow', 'queued']::text[]),
  CONSTRAINT omni_comms_peb_reference_len_chk
    CHECK (integration_reference IS NULL OR char_length(integration_reference) <= 200),
  CONSTRAINT omni_comms_peb_reason_len_chk
    CHECK (lifecycle_reason IS NULL OR char_length(lifecycle_reason) <= 500)
);

-- Tenant-safe single-active uniqueness (department NULL and NOT NULL variants).
CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_peb_active_dept_uq
  ON public.omni_comms_producer_event_binding
  (organization_id, department_id, caller_module_code, event_definition_id)
  WHERE status = 'active' AND department_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_peb_active_orgwide_uq
  ON public.omni_comms_producer_event_binding
  (organization_id, caller_module_code, event_definition_id)
  WHERE status = 'active' AND department_id IS NULL;

CREATE INDEX IF NOT EXISTS omni_comms_peb_lookup_idx
  ON public.omni_comms_producer_event_binding
  (organization_id, caller_module_code, event_definition_id, status);

REVOKE ALL ON public.omni_comms_producer_event_binding FROM PUBLIC;
REVOKE ALL ON public.omni_comms_producer_event_binding FROM anon;
REVOKE ALL ON public.omni_comms_producer_event_binding FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.omni_comms_producer_event_binding TO service_role;

ALTER TABLE public.omni_comms_producer_event_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_producer_event_binding FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_peb_service_role ON public.omni_comms_producer_event_binding;
CREATE POLICY omni_comms_peb_service_role
  ON public.omni_comms_producer_event_binding
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.omni_comms_peb_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.omni_comms_peb_touch() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_omni_comms_peb_touch ON public.omni_comms_producer_event_binding;
CREATE TRIGGER trg_omni_comms_peb_touch
  BEFORE UPDATE ON public.omni_comms_producer_event_binding
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_peb_touch();

-- ===========================================================================
-- Private helper: load a binding row with tenant verification.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_priv_peb_load(p_id uuid)
RETURNS public.omni_comms_producer_event_binding
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.omni_comms_producer_event_binding%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.omni_comms_producer_event_binding
  WHERE id = p_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 producer_binding_not_found'
      USING ERRCODE = 'P0001', DETAIL = 'producer_binding_not_found';
  END IF;

  RETURN v_row;
END;
$$;
ALTER FUNCTION public.omni_comms_priv_peb_load(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_peb_load(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_peb_load(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_peb_load(uuid) FROM authenticated;

-- ===========================================================================
-- Public RPC: list bindings
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_list_producer_event_bindings(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid;
  v_rows  jsonb;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC400 organization_required'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;

  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'event_code'), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'id', b.id,
             'organization_id', b.organization_id,
             'department_id', b.department_id,
             'caller_module_code', b.caller_module_code,
             'event_definition_id', b.event_definition_id,
             'event_code', e.code,
             'event_name', e.name,
             'event_module_code', e.module_code,
             'event_status', e.status,
             'allowed_modes', to_jsonb(b.allowed_modes),
             'status', b.status,
             'integration_reference', b.integration_reference,
             'lifecycle_reason', b.lifecycle_reason,
             'updated_at', b.updated_at,
             'activated_at', b.activated_at
           ) AS x
    FROM public.omni_comms_producer_event_binding b
    JOIN public.omni_comms_event_definition e ON e.id = b.event_definition_id
    WHERE b.organization_id = p_organization_id
      AND (p_department_id IS NULL OR b.department_id = p_department_id)
      AND (p_status IS NULL OR b.status = p_status)
  ) s;

  RETURN jsonb_build_object('bindings', v_rows);
END;
$$;
ALTER FUNCTION public.omni_comms_list_producer_event_bindings(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_list_producer_event_bindings(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_list_producer_event_bindings(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_list_producer_event_bindings(uuid, uuid, text) TO authenticated;

-- ===========================================================================
-- Public RPC: get one binding
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_get_producer_event_binding(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid;
  v_row   public.omni_comms_producer_event_binding%ROWTYPE;
  v_evt   public.omni_comms_event_definition%ROWTYPE;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  v_row := public.omni_comms_priv_peb_load(p_id);

  IF v_row.department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(v_row.department_id, v_row.organization_id);
  END IF;

  SELECT * INTO v_evt FROM public.omni_comms_event_definition WHERE id = v_row.event_definition_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'organization_id', v_row.organization_id,
    'department_id', v_row.department_id,
    'caller_module_code', v_row.caller_module_code,
    'event_definition_id', v_row.event_definition_id,
    'event_code', v_evt.code,
    'event_name', v_evt.name,
    'event_module_code', v_evt.module_code,
    'event_status', v_evt.status,
    'allowed_modes', to_jsonb(v_row.allowed_modes),
    'status', v_row.status,
    'integration_reference', v_row.integration_reference,
    'lifecycle_reason', v_row.lifecycle_reason,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'activated_at', v_row.activated_at,
    'suspended_at', v_row.suspended_at,
    'retired_at', v_row.retired_at
  );
END;
$$;
ALTER FUNCTION public.omni_comms_get_producer_event_binding(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_get_producer_event_binding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_get_producer_event_binding(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_get_producer_event_binding(uuid) TO authenticated;

-- ===========================================================================
-- Public RPC: upsert draft
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_upsert_producer_event_binding_draft(
  p_id uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_caller_module_code text,
  p_event_definition_id uuid,
  p_allowed_modes text[],
  p_integration_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  uuid;
  v_module text;
  v_before jsonb;
  v_row    public.omni_comms_producer_event_binding%ROWTYPE;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC400 organization_required'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;

  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  v_module := upper(btrim(coalesce(p_caller_module_code, '')));
  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_caller_module_registry
    WHERE module_code = v_module AND is_active = true
  ) THEN
    RAISE EXCEPTION 'OC400 caller_module_not_registered'
      USING ERRCODE = 'P0001', DETAIL = 'caller_module_not_registered';
  END IF;

  IF p_event_definition_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.omni_comms_event_definition WHERE id = p_event_definition_id) THEN
    RAISE EXCEPTION 'OC404 event_not_found'
      USING ERRCODE = 'P0001', DETAIL = 'event_not_found';
  END IF;

  IF p_allowed_modes IS NULL OR array_length(p_allowed_modes, 1) IS NULL THEN
    RAISE EXCEPTION 'OC400 allowed_modes_required'
      USING ERRCODE = 'P0001', DETAIL = 'allowed_modes_required';
  END IF;

  -- Build 4A: business bindings may not carry the queued mode.
  IF 'queued' = ANY (p_allowed_modes) THEN
    RAISE EXCEPTION 'OC400 producer_mode_not_available'
      USING ERRCODE = 'P0001', DETAIL = 'queued_mode_requires_certified_delivery_release';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_producer_event_binding (
      organization_id, department_id, caller_module_code, event_definition_id,
      allowed_modes, status, integration_reference, created_by, updated_by
    ) VALUES (
      p_organization_id, p_department_id, v_module, p_event_definition_id,
      p_allowed_modes, 'draft', nullif(btrim(coalesce(p_integration_reference, '')), ''), v_actor, v_actor
    )
    RETURNING * INTO v_row;
    v_before := NULL;
  ELSE
    v_row := public.omni_comms_priv_peb_load(p_id);
    IF v_row.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'OC403 organization_mismatch'
        USING ERRCODE = 'P0001', DETAIL = 'organization_mismatch';
    END IF;
    IF v_row.status <> 'draft' THEN
      RAISE EXCEPTION 'OC409 producer_binding_not_draft'
        USING ERRCODE = 'P0001', DETAIL = 'producer_binding_not_draft';
    END IF;
    v_before := jsonb_build_object(
      'caller_module_code', v_row.caller_module_code,
      'event_definition_id', v_row.event_definition_id,
      'allowed_modes', to_jsonb(v_row.allowed_modes),
      'department_id', v_row.department_id,
      'integration_reference', v_row.integration_reference,
      'status', v_row.status
    );
    UPDATE public.omni_comms_producer_event_binding
       SET department_id = p_department_id,
           caller_module_code = v_module,
           event_definition_id = p_event_definition_id,
           allowed_modes = p_allowed_modes,
           integration_reference = nullif(btrim(coalesce(p_integration_reference, '')), ''),
           updated_by = v_actor
     WHERE id = p_id
     RETURNING * INTO v_row;
  END IF;

  PERFORM public.omni_comms_priv_write_audit(
    v_actor, 'upsert_draft', 'producer_event_binding', v_row.id,
    v_row.caller_module_code,
    v_before,
    jsonb_build_object(
      'caller_module_code', v_row.caller_module_code,
      'event_definition_id', v_row.event_definition_id,
      'allowed_modes', to_jsonb(v_row.allowed_modes),
      'department_id', v_row.department_id,
      'integration_reference', v_row.integration_reference,
      'status', v_row.status
    ),
    NULL
  );

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;
ALTER FUNCTION public.omni_comms_upsert_producer_event_binding_draft(uuid, uuid, uuid, text, uuid, text[], text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_upsert_producer_event_binding_draft(uuid, uuid, uuid, text, uuid, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_upsert_producer_event_binding_draft(uuid, uuid, uuid, text, uuid, text[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_upsert_producer_event_binding_draft(uuid, uuid, uuid, text, uuid, text[], text) TO authenticated;

-- ===========================================================================
-- Public RPC: lifecycle transitions (activate / suspend / retire)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_set_producer_event_binding_status(
  p_id uuid,
  p_target_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  uuid;
  v_row    public.omni_comms_producer_event_binding%ROWTYPE;
  v_target text;
  v_before jsonb;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  v_target := lower(btrim(coalesce(p_target_status, '')));

  IF v_target NOT IN ('active', 'suspended', 'retired') THEN
    RAISE EXCEPTION 'OC400 invalid_target_status'
      USING ERRCODE = 'P0001', DETAIL = 'invalid_target_status';
  END IF;

  v_row := public.omni_comms_priv_peb_load(p_id);

  IF v_row.department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(v_row.department_id, v_row.organization_id);
  END IF;

  IF v_row.status = 'retired' THEN
    RAISE EXCEPTION 'OC409 producer_binding_retired'
      USING ERRCODE = 'P0001', DETAIL = 'producer_binding_retired';
  END IF;

  IF v_target IN ('suspended', 'retired')
     AND nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'OC400 lifecycle_reason_required'
      USING ERRCODE = 'P0001', DETAIL = 'lifecycle_reason_required';
  END IF;

  IF v_target = 'active' AND v_row.status NOT IN ('draft', 'suspended') THEN
    RAISE EXCEPTION 'OC409 invalid_transition'
      USING ERRCODE = 'P0001', DETAIL = 'invalid_transition';
  END IF;

  IF v_target = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.omni_comms_event_definition
    WHERE id = v_row.event_definition_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'OC409 event_not_active'
      USING ERRCODE = 'P0001', DETAIL = 'event_not_active';
  END IF;

  v_before := jsonb_build_object('status', v_row.status);

  UPDATE public.omni_comms_producer_event_binding
     SET status = v_target,
         lifecycle_reason = CASE WHEN v_target = 'active' THEN NULL
                                 ELSE nullif(btrim(coalesce(p_reason, '')), '') END,
         activated_at = CASE WHEN v_target = 'active' THEN now() ELSE activated_at END,
         activated_by = CASE WHEN v_target = 'active' THEN v_actor ELSE activated_by END,
         suspended_at = CASE WHEN v_target = 'suspended' THEN now() ELSE suspended_at END,
         suspended_by = CASE WHEN v_target = 'suspended' THEN v_actor ELSE suspended_by END,
         retired_at   = CASE WHEN v_target = 'retired' THEN now() ELSE retired_at END,
         retired_by   = CASE WHEN v_target = 'retired' THEN v_actor ELSE retired_by END,
         updated_by   = v_actor
   WHERE id = p_id
   RETURNING * INTO v_row;

  PERFORM public.omni_comms_priv_write_audit(
    v_actor, v_target, 'producer_event_binding', v_row.id,
    v_row.caller_module_code, v_before,
    jsonb_build_object('status', v_row.status), NULL
  );

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;
ALTER FUNCTION public.omni_comms_set_producer_event_binding_status(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_set_producer_event_binding_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_set_producer_event_binding_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_set_producer_event_binding_status(uuid, text, text) TO authenticated;

-- ===========================================================================
-- Trusted runtime authorisation: actor + producer-event binding + mode.
-- Called by the omni-comms-runtime Edge Function BEFORE any persistence.
-- Default is denial.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_priv_authorize_producer_event(
  p_actor_id uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_caller_module_code text,
  p_event_code text,
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_auth jsonb;
  v_module     text;
  v_mode       text;
  v_event      public.omni_comms_event_definition%ROWTYPE;
  v_binding    public.omni_comms_producer_event_binding%ROWTYPE;
BEGIN
  v_actor_auth := public.omni_comms_priv_authorize_runtime_actor(
    p_actor_id, p_organization_id, p_department_id, p_caller_module_code
  );

  IF coalesce((v_actor_auth ->> 'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN v_actor_auth;
  END IF;

  v_module := upper(btrim(coalesce(p_caller_module_code, '')));
  v_mode   := lower(btrim(coalesce(p_mode, '')));

  IF v_mode NOT IN ('dry_run', 'shadow', 'queued') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'mode_invalid');
  END IF;

  SELECT * INTO v_event
  FROM public.omni_comms_event_definition
  WHERE code = btrim(coalesce(p_event_code, ''));

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'event_not_found');
  END IF;

  IF v_event.status <> 'active' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'event_not_active');
  END IF;

  -- The bounded administration dry-run caller keeps its own synthetic guard
  -- and is intentionally exempt from the business producer binding.
  IF v_module = 'OMNI_COMMS_ADMIN_DRY_RUN' THEN
    IF v_mode <> 'dry_run' THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'producer_mode_not_authorized');
    END IF;
    RETURN jsonb_build_object('allowed', true, 'code', 'admin_dry_run_caller', 'binding_id', NULL);
  END IF;

  -- Every other caller (including OMNI_COMMS_DIRECT and PLATFORM) requires an
  -- explicit active producer-event binding. Department-scoped bindings win
  -- over organisation-wide bindings; no wildcard or cross-module allowance.
  SELECT * INTO v_binding
  FROM public.omni_comms_producer_event_binding b
  WHERE b.status = 'active'
    AND b.organization_id = p_organization_id
    AND b.caller_module_code = v_module
    AND b.event_definition_id = v_event.id
    AND (b.department_id IS NULL OR b.department_id = p_department_id)
  ORDER BY (b.department_id IS NOT NULL) DESC
  LIMIT 1;

  IF v_binding.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'producer_event_not_authorized');
  END IF;

  IF v_binding.department_id IS NOT NULL AND v_binding.department_id IS DISTINCT FROM p_department_id THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'producer_event_not_authorized');
  END IF;

  IF NOT (v_mode = ANY (v_binding.allowed_modes)) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'producer_mode_not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'code', 'authorized',
    'binding_id', v_binding.id,
    'event_definition_id', v_event.id
  );
END;
$$;
ALTER FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) FROM authenticated;