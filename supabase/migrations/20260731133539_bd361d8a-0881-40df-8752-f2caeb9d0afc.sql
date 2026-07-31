-- ===========================================================================
-- Omni-Comms Runtime Hardening — Part 1
-- (a) Authoritative server-side runtime authorisation.
-- (b) Canonical persisted-message projection shared by fresh + replay paths.
-- No table DDL. No data mutation. No provider contact.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (a) omni_comms_priv_authorize_runtime_actor
--
-- Bounded authorisation oracle for the trusted Edge Function boundary.
-- Answers exactly one question: may THIS actor execute an Omni-Comms runtime
-- request for THIS organisation / department / caller module?
--
-- Returns { allowed: boolean, code: text }. `code` is drawn from a closed set
-- of safe slugs. No role names, permission names, table contents, secrets, or
-- SQL diagnostics are ever returned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_authorize_runtime_actor(
  p_actor_id          uuid,
  p_organization_id   uuid,
  p_department_id     uuid,
  p_caller_module_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  -- Closed registry of caller modules permitted to enter the runtime.
  -- Extending this list is an explicit, auditable migration.
  c_modules constant text[] := ARRAY[
    'OMNI_COMMS_DIRECT',
    'OMNI_COMMS_ADMIN_DRY_RUN',
    'BENEFITS',
    'COMPLIANCE',
    'LEGAL',
    'FINANCE',
    'EMPLOYER_REGISTRATION',
    'INSURED_PERSON',
    'PLATFORM'
  ];
  v_module      text;
  v_org_ok      boolean := false;
  v_privileged  boolean := false;
  v_dept_org    uuid;
  v_dept_active boolean;
BEGIN
  -- 1. Actor must be present.
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'authentication_required');
  END IF;

  -- 2. Organisation must be supplied.
  IF p_organization_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'organization_required');
  END IF;

  -- 3. Approved Omni-Comms execution capability.
  IF NOT public.has_permission(p_actor_id, 'omni_comms', 'operate') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'permission_denied');
  END IF;

  -- 4. Caller module must be registered. Never trust the browser-supplied
  --    module code; an unregistered value is a hard rejection.
  v_module := upper(btrim(coalesce(p_caller_module_code, '')));
  IF v_module = '' OR NOT (v_module = ANY (c_modules)) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'caller_module_not_registered');
  END IF;

  -- Platform-wide operators bypass per-tenant membership but still had to
  -- clear the capability check above.
  v_privileged := public.is_admin(p_actor_id)
                  OR public.has_permission(p_actor_id, 'omni_comms', 'administer');

  -- 5. Organisation access. The organisation must exist and not be retired.
  SELECT true INTO v_org_ok
  FROM public.core_organization o
  WHERE o.id = p_organization_id
    AND coalesce(lower(o.status), 'active') NOT IN ('retired', 'archived', 'deleted')
  LIMIT 1;

  IF NOT coalesce(v_org_ok, false) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'organization_access_denied');
  END IF;

  IF NOT v_privileged THEN
    -- Non-privileged actors must hold an active staff assignment inside a
    -- department belonging to the submitted organisation.
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
      RETURN jsonb_build_object('allowed', false, 'code', 'organization_access_denied');
    END IF;
  END IF;

  -- 6. Department access (optional field; when supplied it is authoritative).
  IF p_department_id IS NOT NULL THEN
    SELECT d.organization_id, coalesce(d.is_active, true)
      INTO v_dept_org, v_dept_active
    FROM public.core_department d
    WHERE d.id = p_department_id;

    IF v_dept_org IS NULL THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'department_access_denied');
    END IF;

    IF v_dept_org <> p_organization_id THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'department_organization_mismatch');
    END IF;

    IF NOT v_dept_active THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'department_access_denied');
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
        RETURN jsonb_build_object('allowed', false, 'code', 'department_access_denied');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'code', 'ok');
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) IS
'Omni-Comms trusted runtime authorisation. Verifies actor organisation access, department access, omni_comms.operate capability, and caller-module registration. Returns only {allowed, code}; leaks no role or configuration detail. service_role EXECUTE only.';

-- ---------------------------------------------------------------------------
-- (b) omni_comms_priv_load_persisted_messages
--
-- Canonical bounded projection of persisted messages for one request. Used by
-- BOTH the fresh-render response and the replay response so the public result
-- contract is byte-identical between the two paths.
--
-- Read-only (STABLE). Returns no rendered content, no PII, no provider secret.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_load_persisted_messages(
  p_actor_id        uuid,
  p_request_id      uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_req record;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  SELECT id, status, mode INTO v_req
  FROM public.omni_comms_request
  WHERE id = p_request_id AND organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'status',     v_req.status,
    'mode',       v_req.mode,
    'messages', coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'message_id',        m.id,
                 'recipient_id',      m.recipient_id,
                 'channel',           m.channel,
                 'status',            m.status,
                 'rendered_checksum', m.rendered_checksum,
                 'dispatch_job_id',   j.id,
                 'blockers',          coalesce(m.blockers, '[]'::jsonb)
               )
               ORDER BY m.created_at, m.id
             )
      FROM public.omni_comms_message m
      LEFT JOIN LATERAL (
        SELECT dj.id
        FROM public.omni_comms_dispatch_job dj
        WHERE dj.message_id = m.id
        ORDER BY dj.created_at, dj.id
        LIMIT 1
      ) j ON true
      WHERE m.request_id = p_request_id
        AND m.organization_id = p_organization_id
    ), '[]'::jsonb)
  );
END;
$function$;

ALTER FUNCTION public.omni_comms_priv_load_persisted_messages(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_messages(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_messages(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_load_persisted_messages(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_load_persisted_messages(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.omni_comms_priv_load_persisted_messages(uuid, uuid, uuid) IS
'Omni-Comms canonical persisted-message projection. Read-only bounded list used identically by fresh and replay runtime responses. service_role EXECUTE only.';