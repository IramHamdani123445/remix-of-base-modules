-- ===================================================================
-- Build 4A — Acceptance corrections.
-- Provider-free. dry_run / shadow only. No dispatch, no live delivery.
-- Idempotent.
-- ===================================================================

-- -------------------------------------------------------------------
-- 1. Trusted authorizer execution grants (service_role only).
-- -------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_authorize_producer_event(uuid, uuid, uuid, text, text, text) TO service_role;

-- -------------------------------------------------------------------
-- 2. Persist the producer binding used for authorisation (immutable).
-- -------------------------------------------------------------------
ALTER TABLE public.omni_comms_request
  ADD COLUMN IF NOT EXISTS producer_event_binding_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'omni_comms_request_producer_event_binding_fkey'
  ) THEN
    ALTER TABLE public.omni_comms_request
      ADD CONSTRAINT omni_comms_request_producer_event_binding_fkey
      FOREIGN KEY (producer_event_binding_id)
      REFERENCES public.omni_comms_producer_event_binding(id)
      ON DELETE RESTRICT;
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_request_binding_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $fn$
BEGIN
  IF NEW.producer_event_binding_id IS DISTINCT FROM OLD.producer_event_binding_id THEN
    RAISE EXCEPTION 'OC409 producer_binding_immutable'
      USING ERRCODE = 'P0001', DETAIL = 'producer_binding_immutable';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS omni_comms_request_binding_immutable_trg ON public.omni_comms_request;
CREATE TRIGGER omni_comms_request_binding_immutable_trg
  BEFORE UPDATE ON public.omni_comms_request
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_request_binding_immutable();

-- -------------------------------------------------------------------
-- 3. Send RPC accepts + persists + returns the trusted binding.
-- -------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_send_communication(
  p_actor_id uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_event_code text,
  p_mode text,
  p_idempotency_key text,
  p_caller_module_code text,
  p_caller_entity_type text,
  p_caller_entity_id text,
  p_correlation_id text,
  p_request_fingerprint text,
  p_payload jsonb,
  p_requested_channels text[],
  p_producer_event_binding_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id  uuid;
  v_caller    text := coalesce(nullif(btrim(p_caller_module_code), ''), 'OMNI_COMMS_DIRECT');
  v_existing  record;
  v_chan      text;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organization_required' USING ERRCODE='P0001';
  END IF;
  IF p_event_code IS NULL OR btrim(p_event_code) = '' OR length(p_event_code) > 128 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('dry_run','shadow','queued') THEN
    RAISE EXCEPTION 'OC422 mode_invalid' USING ERRCODE='P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'OC422 idempotency_key_required' USING ERRCODE='P0001';
  END IF;
  IF length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'OC422 idempotency_key_too_long' USING ERRCODE='P0001';
  END IF;
  IF p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'OC422 payload_invalid' USING ERRCODE='P0001';
  END IF;
  IF octet_length(p_payload::text) > 262144 THEN
    RAISE EXCEPTION 'OC422 payload_too_large' USING ERRCODE='P0001';
  END IF;
  IF length(v_caller) > 64 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;
  IF p_requested_channels IS NOT NULL THEN
    IF array_length(p_requested_channels, 1) > 8 THEN
      RAISE EXCEPTION 'OC422 channel_invalid' USING ERRCODE='P0001';
    END IF;
    FOREACH v_chan IN ARRAY p_requested_channels LOOP
      IF v_chan IS NULL
         OR v_chan NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
        RAISE EXCEPTION 'OC422 channel_invalid' USING ERRCODE='P0001';
      END IF;
    END LOOP;
  END IF;

  -- The binding is supplied by the TRUSTED runtime only (this function is
  -- service_role-only). It must exist, be active and belong to this
  -- organisation and caller module.
  IF p_producer_event_binding_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.omni_comms_producer_event_binding b
      WHERE b.id = p_producer_event_binding_id
        AND b.organization_id = p_organization_id
        AND b.caller_module_code = upper(v_caller)
        AND b.status = 'active'
    ) THEN
      RAISE EXCEPTION 'OC403 producer_event_not_authorized' USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT id INTO v_event_id
  FROM public.omni_comms_event_definition
  WHERE code = btrim(p_event_code);
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'OC404 event_code_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at,
         r.idempotency_key, r.producer_event_binding_id
    INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id    = p_organization_id
    AND r.caller_module_code = v_caller
    AND r.idempotency_key    = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE='P0001';
    END IF;
    RETURN jsonb_build_object(
      'request_id',      v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'mode',            v_existing.mode,
      'status',          v_existing.status,
      'created_at',      v_existing.created_at,
      'producer_event_binding_id', v_existing.producer_event_binding_id,
      'replayed',        true
    );
  END IF;

  BEGIN
    INSERT INTO public.omni_comms_request (
      organization_id, department_id, event_definition_id, mode, status,
      idempotency_key, idempotency_scope, request_fingerprint, correlation_id,
      caller_module_code, caller_entity_type, caller_entity_id,
      payload_snapshot, requested_channels, requested_by, accepted_at,
      producer_event_binding_id
    ) VALUES (
      p_organization_id, p_department_id, v_event_id, p_mode, 'accepted',
      p_idempotency_key,
      'caller_module',
      p_request_fingerprint,
      nullif(btrim(coalesce(p_correlation_id, '')), ''),
      v_caller,
      nullif(btrim(coalesce(p_caller_entity_type, '')), ''),
      nullif(btrim(coalesce(p_caller_entity_id, '')), ''),
      p_payload,
      coalesce(p_requested_channels, ARRAY[]::text[]),
      p_actor_id,
      now(),
      p_producer_event_binding_id
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id, r.request_fingerprint, r.mode, r.status, r.created_at,
           r.idempotency_key, r.producer_event_binding_id
      INTO v_existing
    FROM public.omni_comms_request r
    WHERE r.organization_id    = p_organization_id
      AND r.caller_module_code = v_caller
      AND r.idempotency_key    = p_idempotency_key;
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'OC409 idempotency_payload_mismatch' USING ERRCODE='P0001';
    END IF;
    RETURN jsonb_build_object(
      'request_id',      v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'mode',            v_existing.mode,
      'status',          v_existing.status,
      'created_at',      v_existing.created_at,
      'producer_event_binding_id', v_existing.producer_event_binding_id,
      'replayed',        true
    );
  END;

  SELECT r.id, r.created_at, r.mode, r.status, r.idempotency_key,
         r.correlation_id, r.producer_event_binding_id
    INTO v_existing
  FROM public.omni_comms_request r
  WHERE r.organization_id    = p_organization_id
    AND r.caller_module_code = v_caller
    AND r.idempotency_key    = p_idempotency_key;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    status_before, status_after, safe_metadata,
    correlation_id, actor_type, actor_id
  ) VALUES (
    v_existing.id, NULL, p_organization_id, 'request_accepted',
    public.omni_comms_priv_next_event_sequence(v_existing.id),
    NULL, 'accepted',
    jsonb_build_object('mode', v_existing.mode),
    v_existing.correlation_id, 'user', p_actor_id::text
  );

  RETURN jsonb_build_object(
    'request_id',      v_existing.id,
    'idempotency_key', v_existing.idempotency_key,
    'mode',            v_existing.mode,
    'status',          v_existing.status,
    'created_at',      v_existing.created_at,
    'producer_event_binding_id', v_existing.producer_event_binding_id,
    'replayed',        false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[], uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_send_communication(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[], uuid) TO service_role;

-- -------------------------------------------------------------------
-- 4. Tenant authorisation helper for producer administration RPCs.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_require_tenant_access(
  p_actor_id uuid,
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_privileged  boolean;
  v_dept_org    uuid;
  v_dept_active boolean;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required'
      USING ERRCODE = 'P0001', DETAIL = 'authentication_required';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC400 organization_required'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.core_organization o
    WHERE o.id = p_organization_id
      AND coalesce(lower(o.status), 'active') NOT IN ('retired', 'archived', 'deleted')
  ) THEN
    RAISE EXCEPTION 'OC403 organization_access_denied'
      USING ERRCODE = 'P0001', DETAIL = 'organization_access_denied';
  END IF;

  v_privileged := public.is_admin(p_actor_id)
                  OR public.has_permission(p_actor_id, 'omni_comms', 'administer');

  IF NOT v_privileged THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.core_staff_assignments a
      JOIN public.core_department d ON d.id = a.department_id
      WHERE a.user_id = p_actor_id
        AND a.is_active = true
        AND a.assignment_status = 'ACTIVE'
        AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
        AND d.organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'OC403 organization_access_denied'
        USING ERRCODE = 'P0001', DETAIL = 'organization_access_denied';
    END IF;
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT d.organization_id, coalesce(d.is_active, true)
      INTO v_dept_org, v_dept_active
    FROM public.core_department d
    WHERE d.id = p_department_id;

    IF v_dept_org IS NULL OR NOT v_dept_active THEN
      RAISE EXCEPTION 'OC403 department_access_denied'
        USING ERRCODE = 'P0001', DETAIL = 'department_access_denied';
    END IF;
    IF v_dept_org <> p_organization_id THEN
      RAISE EXCEPTION 'OC403 department_organization_mismatch'
        USING ERRCODE = 'P0001', DETAIL = 'department_organization_mismatch';
    END IF;

    IF NOT v_privileged THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.core_staff_assignments a
        WHERE a.user_id = p_actor_id
          AND a.department_id = p_department_id
          AND a.is_active = true
          AND a.assignment_status = 'ACTIVE'
          AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
      ) THEN
        RAISE EXCEPTION 'OC403 department_access_denied'
          USING ERRCODE = 'P0001', DETAIL = 'department_access_denied';
      END IF;
    END IF;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_require_tenant_access(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_require_tenant_access(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_require_tenant_access(uuid, uuid, uuid) TO service_role;

-- -------------------------------------------------------------------
-- 5. Apply tenant authorisation to the 4 administration RPCs.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_list_producer_event_bindings(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);

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
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_get_producer_event_binding(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_row.organization_id, v_row.department_id);

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
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_upsert_producer_event_binding_draft(
  p_id uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_caller_module_code text,
  p_event_definition_id uuid,
  p_allowed_modes text[],
  p_integration_reference text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);

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
    PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_row.organization_id, v_row.department_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.omni_comms_set_producer_event_binding_status(
  p_id uuid,
  p_target_status text,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_row.organization_id, v_row.department_id);

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
$function$;

-- -------------------------------------------------------------------
-- 6. Employer Registration APPLICATION_SUBMITTED pilot bootstrap.
--    Non-production only. Idempotent. Provider-free.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_pilot_assert_non_production()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.omni_comms_runtime_environment
    WHERE lower(coalesce(environment, 'unknown')) = 'production'
  ) THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_forbidden_in_production';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.omni_comms_channel_setting WHERE live_delivery_enabled
  ) THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_live_delivery_enabled';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_pilot_assert_non_production() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(
  p_actor_id uuid,
  p_organization_code text DEFAULT 'SKN-SSB',
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  k_event_code    CONSTANT text := 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';
  k_module_code   CONSTANT text := 'EMPLOYER_REGISTRATION';
  k_family_code   CONSTANT text := 'pilot_registration_employer_application_submitted';
  k_locale        CONSTANT text := 'en-US';
  v_actions  jsonb := '[]'::jsonb;
  v_org      uuid;
  v_dept     uuid;
  v_event    uuid;
  v_family   uuid;
  v_version  uuid;
  v_layout   uuid;
  v_layout_version uuid;
  v_sender   uuid;
  v_route    uuid;
  v_binding  uuid;
  v_actor    uuid := p_actor_id;
  v_schema   jsonb;
  v_sample   jsonb;
  v_content  jsonb;
  v_checksum text;
  v_id       uuid;
BEGIN
  PERFORM public.omni_comms_priv_pilot_assert_non_production();

  SELECT id INTO v_org FROM public.core_organization WHERE org_code = p_organization_code;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found'
      USING ERRCODE = 'P0001', DETAIL = 'organization_not_found';
  END IF;

  IF v_actor IS NULL THEN
    SELECT created_by INTO v_actor FROM public.omni_comms_event_definition
     WHERE created_by IS NOT NULL ORDER BY created_at LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input'
      USING ERRCODE = 'P0001', DETAIL = 'bootstrap_actor_required';
  END IF;

  SELECT id INTO v_dept FROM public.core_department
   WHERE organization_id = v_org AND code = 'REGISTRATION';
  SELECT id INTO v_sender FROM public.omni_comms_sender_identity
   WHERE organization_id = v_org AND code = 'ref_sender_registration';
  SELECT l.id, v.id
    INTO v_layout, v_layout_version
  FROM public.core_template_layout l
  JOIN public.core_template_layout_version v ON v.layout_id = l.id
 WHERE l.code = 'OMNI_REF_EMAIL'
   AND l.is_active
   AND v.status = 'published'
 ORDER BY v.version_number DESC
 LIMIT 1;

  v_schema := jsonb_build_object(
    '$schema', 'https://json-schema.org/draft/2020-12/schema',
    'type', 'object',
    'additionalProperties', false,
    'required', jsonb_build_array('reference', 'subjectName', 'submissionStatus', 'submittedAt'),
    'properties', jsonb_build_object(
      'reference',        jsonb_build_object('type', 'string', 'maxLength', 64),
      'subjectName',      jsonb_build_object('type', 'string', 'maxLength', 160),
      'submissionStatus', jsonb_build_object('type', 'string', 'maxLength', 64),
      'submittedAt',      jsonb_build_object('type', 'string', 'maxLength', 40)
    )
  );
  v_sample := jsonb_build_object(
    'reference', 'ER-004512',
    'subjectName', 'Frigate Bay Retail Ltd',
    'submissionStatus', 'Pending review',
    'submittedAt', '2026-08-01T08:00:00.000Z'
  );
  v_content := jsonb_build_object(
    'subject', 'Application received - employer registration {{payload.reference}}',
    'html', '<p>{{payload.subjectName}},</p><p>We have received your employer registration application. Reference <strong>{{payload.reference}}</strong>, submitted on {{payload.submittedAt}}.</p><p>Current status: {{payload.submissionStatus}}. This message confirms receipt of your application only. Your application has not been assessed, no registration decision has been made, and no effective date has been set.</p><p>Social Security Board</p>',
    'text', '{{payload.subjectName}}: we have received your employer registration application {{payload.reference}}, submitted on {{payload.submittedAt}}. Current status: {{payload.submissionStatus}}. This confirms receipt of your application only; it has not been assessed, no decision has been made and no effective date has been set.'
  );

  -- event definition ---------------------------------------------------
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = k_event_code;
  IF v_event IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',k_event_code,'action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',k_event_code,'action','planned');
  ELSE
    INSERT INTO public.omni_comms_event_definition
      (code, module_code, entity_type, name, description, communication_class, default_priority, status, created_by, updated_by)
    VALUES (k_event_code, 'REGISTRATION', 'EMPLOYER',
            'Employer Registration Application Submitted',
            'Acknowledges receipt of an employer registration application. Receipt only: no assessment, decision, activation or effective date is implied.',
            'transactional', 'normal', 'draft', v_actor, v_actor)
    RETURNING id INTO v_event;
    UPDATE public.omni_comms_event_definition
       SET status = 'active', updated_at = now(), updated_by = v_actor
     WHERE id = v_event;
    v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',k_event_code,'action','created');
  END IF;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('applied', p_apply, 'organization_id', v_org, 'actions', v_actions);
  END IF;

  -- published contract v1 ----------------------------------------------
  IF EXISTS (SELECT 1 FROM public.omni_comms_event_contract
              WHERE event_definition_id = v_event AND version_number = 1) THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',k_event_code || ':v1','action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',k_event_code || ':v1','action','planned');
  ELSE
    PERFORM public.omni_comms_priv_validate_schema(v_schema, v_sample);
    INSERT INTO public.omni_comms_event_contract
      (event_definition_id, version_number, json_schema, sample_payload, status, created_by, updated_by)
    VALUES (v_event, 1, v_schema, v_sample, 'draft', v_actor, v_actor)
    RETURNING id INTO v_id;
    v_checksum := public.omni_comms_priv_compute_checksum(k_event_code, 1, v_schema);
    UPDATE public.omni_comms_event_contract
       SET status = 'published', checksum = v_checksum, published_at = now(), published_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_id;
    v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',k_event_code || ':v1','action','created');
  END IF;

  -- active template family ---------------------------------------------
  SELECT id INTO v_family FROM public.omni_comms_template_family WHERE code = k_family_code;
  IF v_family IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_family','key',k_family_code,'action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_family','key',k_family_code,'action','planned');
  ELSE
    INSERT INTO public.omni_comms_template_family
      (code, name, description, scope_type, organization_id, department_id, event_definition_id, status, created_by, updated_by)
    VALUES (k_family_code, 'Employer Registration Application Submitted Templates',
            'Pilot templates for ' || k_event_code, 'event', v_org, NULL, v_event, 'draft', v_actor, v_actor)
    RETURNING id INTO v_family;
    UPDATE public.omni_comms_template_family
       SET status = 'active', activated_at = now(), activated_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_family;
    v_actions := v_actions || jsonb_build_object('object_type','template_family','key',k_family_code,'action','created');
  END IF;

  -- published email template version ------------------------------------
  IF v_family IS NOT NULL THEN
    SELECT id INTO v_version FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email'
       AND locale = k_locale AND version_number = 1;
  END IF;

  IF v_version IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_version','key',k_family_code || ':email','action','existing');
  ELSIF NOT p_apply OR v_family IS NULL OR v_layout IS NULL OR v_layout_version IS NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_version','key',k_family_code || ':email','action','planned');
  ELSE
    PERFORM public.omni_comms_priv_validate_channel_content('email', v_content);
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, status,
       layout_selection_mode, layout_id, pinned_layout_version_id, created_by, updated_by)
    VALUES (v_family, 1, 'email', k_locale, v_content, 'draft',
            'pinned', v_layout, v_layout_version, NULL, v_actor)
    RETURNING id INTO v_version;

    v_checksum := public.omni_comms_priv_compute_template_checksum(
      k_family_code, 1, 'email', k_locale, v_content);

    UPDATE public.omni_comms_template_version
       SET status = 'approved', checksum = v_checksum, approved_at = now(), approved_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_version;
    UPDATE public.omni_comms_template_version
       SET status = 'published', published_at = now(), published_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_version;

    v_actions := v_actions || jsonb_build_object('object_type','template_version','key',k_family_code || ':email','action','created');
  END IF;

  -- active email route ---------------------------------------------------
  SELECT id INTO v_route FROM public.omni_comms_event_route
   WHERE organization_id = v_org
     AND department_id IS NOT DISTINCT FROM v_dept
     AND event_definition_id = v_event
     AND channel = 'email';

  IF v_route IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_route','key',k_event_code || ':email','action','existing');
  ELSIF NOT p_apply OR v_family IS NULL OR v_sender IS NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_route','key',k_event_code || ':email','action','planned');
  ELSE
    INSERT INTO public.omni_comms_event_route
      (organization_id, department_id, event_definition_id, channel, is_required, is_enabled, priority,
       template_family_id, sender_identity_id, sender_resolution_policy, preference_policy, lifecycle_state,
       created_by, updated_by)
    VALUES (v_org, v_dept, v_event, 'email', false, true, 100,
            v_family, v_sender, 'explicit', 'honour', 'draft', v_actor, v_actor)
    RETURNING id INTO v_route;
    UPDATE public.omni_comms_event_route
       SET lifecycle_state = 'active', activated_at = now(), activated_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_route;
    v_actions := v_actions || jsonb_build_object('object_type','event_route','key',k_event_code || ':email','action','created');
  END IF;

  -- caller module registration -------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_caller_module_registry
    WHERE module_code = k_module_code AND is_active = true
  ) THEN
    v_actions := v_actions || jsonb_build_object('object_type','caller_module','key',k_module_code,'action','missing');
  ELSE
    v_actions := v_actions || jsonb_build_object('object_type','caller_module','key',k_module_code,'action','existing');
  END IF;

  -- producer binding (dry_run + shadow only) ------------------------------
  SELECT id INTO v_binding FROM public.omni_comms_producer_event_binding
   WHERE organization_id = v_org
     AND caller_module_code = k_module_code
     AND event_definition_id = v_event
     AND status <> 'retired'
   LIMIT 1;

  IF v_binding IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','producer_binding','key',k_event_code,'action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','producer_binding','key',k_event_code,'action','planned');
  ELSE
    INSERT INTO public.omni_comms_producer_event_binding
      (organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_by, updated_by,
       activated_at, activated_by)
    VALUES (v_org, NULL, k_module_code, v_event,
            ARRAY['dry_run','shadow']::text[], 'active',
            'build4a_pilot_employer_registration_application_submitted', v_actor, v_actor,
            now(), v_actor)
    RETURNING id INTO v_binding;
    v_actions := v_actions || jsonb_build_object('object_type','producer_binding','key',k_event_code,'action','created');
  END IF;

  RETURN jsonb_build_object(
    'applied', p_apply,
    'organization_code', p_organization_code,
    'organization_id', v_org,
    'event_code', k_event_code,
    'event_definition_id', v_event,
    'caller_module_code', k_module_code,
    'template_family_id', v_family,
    'template_version_id', v_version,
    'layout_id', v_layout,
    'layout_version_id', v_layout_version,
    'event_route_id', v_route,
    'producer_event_binding_id', v_binding,
    'actions', v_actions
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(
  p_organization_code text DEFAULT 'SKN-SSB',
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_bootstrap_employer_registration_pilot(
    v_actor, p_organization_code, coalesce(p_apply, false));
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) TO service_role;

-- -------------------------------------------------------------------
-- 7. Run the bootstrap, and retire the incorrect REGISTERED binding.
-- -------------------------------------------------------------------
DO $do$
DECLARE
  v_actor uuid;
  v_res   jsonb;
BEGIN
  SELECT created_by INTO v_actor FROM public.omni_comms_event_definition
   WHERE created_by IS NOT NULL ORDER BY created_at LIMIT 1;

  IF EXISTS (SELECT 1 FROM public.core_organization WHERE org_code = 'SKN-SSB') THEN
    v_res := public.omni_comms_priv_bootstrap_employer_registration_pilot(v_actor, 'SKN-SSB', true);
    RAISE NOTICE 'pilot bootstrap: %', v_res;
  END IF;

  UPDATE public.omni_comms_producer_event_binding b
     SET status = 'retired',
         lifecycle_reason = 'REGISTRATION.EMPLOYER.REGISTERED represents a completed registration and must not be emitted on application submission.',
         retired_at = now(),
         retired_by = coalesce(v_actor, b.created_by),
         updated_by = coalesce(v_actor, b.updated_by)
   WHERE b.caller_module_code = 'EMPLOYER_REGISTRATION'
     AND b.status <> 'retired'
     AND b.event_definition_id = (
       SELECT id FROM public.omni_comms_event_definition
        WHERE code = 'REGISTRATION.EMPLOYER.REGISTERED');
END
$do$;