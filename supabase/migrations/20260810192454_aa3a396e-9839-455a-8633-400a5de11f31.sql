-- Omni-Comms — Module → Sender Profile assignment layer.
-- Configuration-only. No sending, no provider contact, no route rewriting.

CREATE TABLE IF NOT EXISTS public.omni_comms_module_sender_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  caller_module_code text NOT NULL,
  channel text NOT NULL,
  sender_identity_id uuid NOT NULL REFERENCES public.omni_comms_sender_identity(id) ON DELETE RESTRICT,
  profile_role text NOT NULL DEFAULT 'default',
  communication_class text NULL,
  is_default boolean NOT NULL DEFAULT false,
  allow_event_override boolean NOT NULL DEFAULT true,
  allow_organization_fallback boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  data_origin text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  activated_at timestamptz NULL,
  activated_by uuid NULL,
  retired_at timestamptz NULL,
  retired_by uuid NULL,
  retirement_reason text NULL,
  CONSTRAINT omni_comms_msp_status_chk
    CHECK (status IN ('draft','active','disabled','retired')),
  CONSTRAINT omni_comms_msp_origin_chk
    CHECK (data_origin IN ('system_seed','user')),
  CONSTRAINT omni_comms_msp_role_chk
    CHECK (profile_role IN ('default','transactional','legal','service')),
  CONSTRAINT omni_comms_msp_channel_chk
    CHECK (channel IN ('email','sms','whatsapp','push','in_app','print'))
);

GRANT SELECT ON public.omni_comms_module_sender_profile TO authenticated;
GRANT ALL ON public.omni_comms_module_sender_profile TO service_role;

-- Permanent architectural rule for this project: no RLS. Authorisation is
-- enforced by the SECURITY DEFINER RPCs below.

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_msp_one_active_default_uq
  ON public.omni_comms_module_sender_profile
     (organization_id, caller_module_code, channel, profile_role)
  WHERE is_default AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_msp_unique_assignment_uq
  ON public.omni_comms_module_sender_profile
     (organization_id, caller_module_code, channel, profile_role, sender_identity_id)
  WHERE status <> 'retired';

CREATE INDEX IF NOT EXISTS omni_comms_msp_lookup_idx
  ON public.omni_comms_module_sender_profile
     (organization_id, caller_module_code, channel, status);

-- ── Validation helper ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_module_sender_validate(
  p_organization_id uuid,
  p_department_id uuid,
  p_caller_module_code text,
  p_channel text,
  p_sender_identity_id uuid,
  p_profile_role text
) RETURNS public.omni_comms_sender_identity
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_sender public.omni_comms_sender_identity%ROWTYPE; v_mod boolean;
BEGIN
  IF p_organization_id IS NULL OR p_sender_identity_id IS NULL
     OR COALESCE(btrim(p_caller_module_code),'') = ''
     OR COALESCE(btrim(p_channel),'') = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_module_channel_sender_required';
  END IF;
  IF COALESCE(p_profile_role,'default') NOT IN ('default','transactional','legal','service') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_profile_role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.core_organization o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='organization';
  END IF;

  SELECT r.is_active INTO v_mod
    FROM public.omni_comms_caller_module_registry r
   WHERE r.module_code = p_caller_module_code;
  IF v_mod IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='caller_module_not_registered';
  END IF;
  IF NOT v_mod THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='caller_module_inactive';
  END IF;

  SELECT * INTO v_sender FROM public.omni_comms_sender_identity s WHERE s.id = p_sender_identity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity';
  END IF;
  IF v_sender.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='sender_other_organisation';
  END IF;
  IF v_sender.channel IS DISTINCT FROM p_channel THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='sender_channel_mismatch';
  END IF;
  IF v_sender.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_sender_not_assignable';
  END IF;
  IF v_sender.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='sender_retired';
  END IF;
  IF p_department_id IS NOT NULL AND v_sender.department_id IS NOT NULL
     AND v_sender.department_id IS DISTINCT FROM p_department_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_scope_mismatch';
  END IF;
  IF p_department_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.core_department d
        WHERE d.id = p_department_id AND d.organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='department';
  END IF;

  RETURN v_sender;
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_module_sender_validate(uuid, uuid, text, text, uuid, text) TO service_role;

-- ── Route governance helper ──────────────────────────────────────────────
-- Returns NULL when allowed, or a blocking slug. A module with no ACTIVE
-- assignments for the channel is treated as unconfigured (governance not yet
-- applied) so existing behaviour is never broken.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_module_sender_route_block(
  p_organization_id uuid,
  p_event_definition_id uuid,
  p_channel text,
  p_sender_identity_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_module text; v_assignments int; v_allowed int;
BEGIN
  IF p_sender_identity_id IS NULL THEN RETURN NULL; END IF;

  SELECT e.module_code INTO v_module
    FROM public.omni_comms_event_definition e WHERE e.id = p_event_definition_id;
  IF v_module IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_assignments
    FROM public.omni_comms_module_sender_profile m
   WHERE m.organization_id = p_organization_id
     AND m.caller_module_code = v_module
     AND m.channel = p_channel
     AND m.status = 'active';
  IF v_assignments = 0 THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_allowed
    FROM public.omni_comms_module_sender_profile m
   WHERE m.organization_id = p_organization_id
     AND m.caller_module_code = v_module
     AND m.channel = p_channel
     AND m.status = 'active'
     AND m.sender_identity_id = p_sender_identity_id;
  IF v_allowed > 0 THEN RETURN NULL; END IF;

  RETURN 'sender_not_authorised_for_module';
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_module_sender_route_block(uuid, uuid, text, uuid) TO service_role;

-- ── Impact analysis ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_module_sender_impact(
  p_row public.omni_comms_module_sender_profile
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_active int; v_draft int; v_total int; v_msgs int;
BEGIN
  SELECT
    count(*) FILTER (WHERE r.lifecycle_state = 'active'),
    count(*) FILTER (WHERE r.lifecycle_state = 'draft'),
    count(*)
    INTO v_active, v_draft, v_total
  FROM public.omni_comms_event_route r
  JOIN public.omni_comms_event_definition e ON e.id = r.event_definition_id
 WHERE r.organization_id = p_row.organization_id
   AND r.channel = p_row.channel
   AND e.module_code = p_row.caller_module_code
   AND r.sender_identity_id = p_row.sender_identity_id;

  SELECT count(*) INTO v_msgs
    FROM public.omni_comms_message m WHERE m.sender_identity_id = p_row.sender_identity_id;

  RETURN jsonb_build_object(
    'active_routes', COALESCE(v_active,0),
    'draft_routes', COALESCE(v_draft,0),
    'total_routes', COALESCE(v_total,0),
    'messages', COALESCE(v_msgs,0),
    'can_hard_delete', p_row.status = 'draft' AND COALESCE(v_total,0) = 0
  );
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_module_sender_impact(public.omni_comms_module_sender_profile) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_impact(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_module_sender_profile%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  SELECT * INTO v_row FROM public.omni_comms_module_sender_profile WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='module_sender_profile';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_row.organization_id, NULL);
  RETURN public.omni_comms_priv_module_sender_impact(v_row.*)
         || jsonb_build_object('id', p_id);
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_impact(uuid) TO authenticated, service_role;

-- ── Summary / coverage reader ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_summary(
  p_organization_id uuid,
  p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_can_configure boolean; v_modules jsonb; v_senders jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);
  v_can_configure := public.has_permission(v_uid,'omni_comms','configure');

  WITH mods AS (
    SELECT r.module_code, r.permission_module, r.is_active, r.notes
      FROM public.omni_comms_caller_module_registry r
  ), assign AS (
    SELECT m.*, s.code AS sender_code, s.display_name AS sender_name,
           s.status AS sender_status, s.data_origin AS sender_origin,
           lower(COALESCE(s.identity_config->>'from_address', s.from_address,'')) AS from_address,
           d.name AS department_name,
           public.omni_comms_priv_sender_address_facts(s.*) AS facts
      FROM public.omni_comms_module_sender_profile m
      JOIN public.omni_comms_sender_identity s ON s.id = m.sender_identity_id
      LEFT JOIN public.core_department d ON d.id = m.department_id
     WHERE m.organization_id = p_organization_id
       AND m.channel = p_channel
       AND m.status <> 'retired'
  ), assign_json AS (
    SELECT a.caller_module_code,
      jsonb_agg(jsonb_build_object(
        'id', a.id,
        'organization_id', a.organization_id,
        'department_id', a.department_id,
        'department_name', a.department_name,
        'caller_module_code', a.caller_module_code,
        'channel', a.channel,
        'sender_identity_id', a.sender_identity_id,
        'sender_code', a.sender_code,
        'sender_display_name', a.sender_name,
        'sender_status', a.sender_status,
        'from_address', NULLIF(a.from_address,''),
        'domain_name', a.facts->>'domain_name',
        'domain_ready', COALESCE((a.facts->>'domain_ready')::boolean,false),
        'provider_account_code', a.facts->>'provider_account_code',
        'provider_account_name', a.facts->>'provider_account_name',
        'provider_account_status', a.facts->>'provider_account_status',
        'profile_role', a.profile_role,
        'communication_class', a.communication_class,
        'is_default', a.is_default,
        'allow_event_override', a.allow_event_override,
        'allow_organization_fallback', a.allow_organization_fallback,
        'status', a.status,
        'data_origin', a.data_origin,
        'created_at', a.created_at,
        'updated_at', a.updated_at,
        'activated_at', a.activated_at
      ) ORDER BY a.is_default DESC, a.created_at) AS rows
      FROM assign a GROUP BY a.caller_module_code
  ), ev AS (
    SELECT e.module_code,
           count(*) FILTER (WHERE r.id IS NOT NULL) AS routes,
           count(*) FILTER (
             WHERE r.id IS NOT NULL AND r.sender_identity_id IS NOT NULL
               AND r.sender_identity_id = (
                 SELECT m2.sender_identity_id FROM public.omni_comms_module_sender_profile m2
                  WHERE m2.organization_id = p_organization_id
                    AND m2.caller_module_code = e.module_code
                    AND m2.channel = p_channel
                    AND m2.status = 'active' AND m2.is_default
                    AND m2.profile_role = 'default'
                  LIMIT 1)) AS uses_default
      FROM public.omni_comms_event_definition e
      LEFT JOIN public.omni_comms_event_route r
        ON r.event_definition_id = e.id
       AND r.organization_id = p_organization_id
       AND r.channel = p_channel
       AND r.lifecycle_state <> 'retired'
     GROUP BY e.module_code
  )
  SELECT jsonb_agg(jsonb_build_object(
           'module_code', m.module_code,
           'permission_module', m.permission_module,
           'module_active', m.is_active,
           'notes', m.notes,
           'assignments', COALESCE(aj.rows,'[]'::jsonb),
           'routes_total', COALESCE(ev.routes,0),
           'routes_using_default', COALESCE(ev.uses_default,0),
           'routes_with_override',
             GREATEST(COALESCE(ev.routes,0) - COALESCE(ev.uses_default,0), 0)
         ) ORDER BY m.module_code)
    INTO v_modules
    FROM mods m
    LEFT JOIN assign_json aj ON aj.caller_module_code = m.module_code
    LEFT JOIN ev ON ev.module_code = m.module_code;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'code', s.code, 'display_name', s.display_name,
           'status', s.status, 'department_id', s.department_id,
           'from_address', lower(COALESCE(s.identity_config->>'from_address', s.from_address,'')),
           'domain_ready', COALESCE((public.omni_comms_priv_sender_address_facts(s.*)->>'domain_ready')::boolean,false)
         ) ORDER BY s.code),'[]'::jsonb)
    INTO v_senders
    FROM public.omni_comms_sender_identity s
   WHERE s.organization_id = p_organization_id
     AND s.channel = p_channel
     AND s.data_origin <> 'reference_seed'
     AND s.status <> 'retired';

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'channel', p_channel,
    'can_manage', v_can_configure,
    'modules', COALESCE(v_modules,'[]'::jsonb),
    'assignable_senders', v_senders,
    'generated_at', now());
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_summary(uuid, text) TO authenticated, service_role;

-- ── Configuration resolution precedence ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_resolve(
  p_organization_id uuid,
  p_event_definition_id uuid,
  p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_module text; v_def public.omni_comms_module_sender_profile%ROWTYPE;
        v_allowed jsonb; v_route_sender uuid; v_fallback public.omni_comms_module_sender_profile%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT e.module_code INTO v_module
    FROM public.omni_comms_event_definition e WHERE e.id = p_event_definition_id;
  IF v_module IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition';
  END IF;

  SELECT r.sender_identity_id INTO v_route_sender
    FROM public.omni_comms_event_route r
   WHERE r.organization_id = p_organization_id
     AND r.event_definition_id = p_event_definition_id
     AND r.channel = p_channel
     AND r.lifecycle_state <> 'retired'
   ORDER BY (r.lifecycle_state = 'active') DESC, r.updated_at DESC
   LIMIT 1;

  SELECT * INTO v_def FROM public.omni_comms_module_sender_profile m
   WHERE m.organization_id = p_organization_id
     AND m.caller_module_code = v_module
     AND m.channel = p_channel
     AND m.status = 'active' AND m.is_default AND m.profile_role = 'default'
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sender_identity_id', m.sender_identity_id,
           'sender_code', s.code,
           'sender_display_name', s.display_name,
           'is_default', m.is_default,
           'profile_role', m.profile_role,
           'allow_event_override', m.allow_event_override
         ) ORDER BY m.is_default DESC, s.code),'[]'::jsonb)
    INTO v_allowed
    FROM public.omni_comms_module_sender_profile m
    JOIN public.omni_comms_sender_identity s ON s.id = m.sender_identity_id
   WHERE m.organization_id = p_organization_id
     AND m.caller_module_code = v_module
     AND m.channel = p_channel
     AND m.status = 'active';

  IF v_def.id IS NULL THEN
    SELECT * INTO v_fallback FROM public.omni_comms_module_sender_profile m
     WHERE m.organization_id = p_organization_id
       AND m.caller_module_code = 'PLATFORM'
       AND m.channel = p_channel
       AND m.status = 'active' AND m.is_default
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'module_code', v_module,
    'channel', p_channel,
    'persisted_route_sender_identity_id', v_route_sender,
    'source', CASE
      WHEN v_route_sender IS NOT NULL THEN 'persisted_route'
      WHEN v_def.id IS NOT NULL THEN 'module_default'
      ELSE 'blocked' END,
    'sender_identity_id', COALESCE(v_route_sender, v_def.sender_identity_id),
    'module_default_sender_identity_id', v_def.sender_identity_id,
    'allow_event_override', COALESCE(v_def.allow_event_override, true),
    'allow_organization_fallback', COALESCE(v_def.allow_organization_fallback, false),
    'organisation_fallback_sender_identity_id',
      CASE WHEN COALESCE(v_def.allow_organization_fallback,false)
             OR (v_def.id IS NULL AND false)
           THEN v_fallback.sender_identity_id ELSE NULL END,
    'allowed_senders', v_allowed,
    'generated_at', now());
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_resolve(uuid, uuid, text) TO authenticated, service_role;

-- ── Upsert draft ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_upsert_draft(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_caller_module_code text,
  p_channel text,
  p_sender_identity_id uuid,
  p_profile_role text DEFAULT 'default',
  p_communication_class text DEFAULT NULL,
  p_is_default boolean DEFAULT false,
  p_allow_event_override boolean DEFAULT true,
  p_allow_organization_fallback boolean DEFAULT false,
  p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid;
  v_before public.omni_comms_module_sender_profile%ROWTYPE;
  v_after public.omni_comms_module_sender_profile%ROWTYPE;
  v_role text := COALESCE(NULLIF(btrim(p_profile_role),''),'default');
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  PERFORM public.omni_comms_priv_module_sender_validate(
    p_organization_id, p_department_id, p_caller_module_code, p_channel,
    p_sender_identity_id, v_role);

  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public.omni_comms_module_sender_profile(
        organization_id, department_id, caller_module_code, channel,
        sender_identity_id, profile_role, communication_class, is_default,
        allow_event_override, allow_organization_fallback, status, data_origin,
        created_by, updated_by)
      VALUES (p_organization_id, p_department_id, p_caller_module_code, p_channel,
        p_sender_identity_id, v_role, NULLIF(btrim(COALESCE(p_communication_class,'')),''),
        COALESCE(p_is_default,false), COALESCE(p_allow_event_override,true),
        COALESCE(p_allow_organization_fallback,false), 'draft', 'user', v_uid, v_uid)
      RETURNING * INTO v_after;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='module_sender_assignment_exists';
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','module_sender_profile',v_after.id,v_after.caller_module_code,
      NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_module_sender_profile WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='module_sender_profile';
  END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='retired_assignment_immutable';
  END IF;

  BEGIN
    UPDATE public.omni_comms_module_sender_profile
       SET department_id = p_department_id,
           sender_identity_id = p_sender_identity_id,
           profile_role = v_role,
           communication_class = NULLIF(btrim(COALESCE(p_communication_class,'')),''),
           is_default = COALESCE(p_is_default, is_default),
           allow_event_override = COALESCE(p_allow_event_override, allow_event_override),
           allow_organization_fallback =
             COALESCE(p_allow_organization_fallback, allow_organization_fallback),
           updated_by = v_uid, updated_at = now()
     WHERE id = p_id RETURNING * INTO v_after;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='module_sender_assignment_exists';
  END;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update','module_sender_profile',p_id,v_after.caller_module_code,
    to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_upsert_draft(
  uuid, timestamptz, uuid, uuid, text, text, uuid, text, text, boolean, boolean, boolean, text)
  TO authenticated, service_role;

-- ── Lifecycle ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_set_lifecycle(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid;
  v_before public.omni_comms_module_sender_profile%ROWTYPE;
  v_after public.omni_comms_module_sender_profile%ROWTYPE;
  v_sender public.omni_comms_sender_identity%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason,'')),'');
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_action NOT IN ('activate','disable','retire') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_action';
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_module_sender_profile WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='module_sender_profile';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_before.organization_id, NULL);
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_retired';
  END IF;
  IF p_action IN ('disable','retire') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;

  IF p_action = 'activate' THEN
    PERFORM public.omni_comms_priv_module_sender_validate(
      v_before.organization_id, v_before.department_id, v_before.caller_module_code,
      v_before.channel, v_before.sender_identity_id, v_before.profile_role);
    SELECT * INTO v_sender FROM public.omni_comms_sender_identity WHERE id = v_before.sender_identity_id;
    IF v_sender.status <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='sender_not_active';
    END IF;
    IF v_before.is_default AND EXISTS (
      SELECT 1 FROM public.omni_comms_module_sender_profile m
       WHERE m.id <> p_id
         AND m.organization_id = v_before.organization_id
         AND m.caller_module_code = v_before.caller_module_code
         AND m.channel = v_before.channel
         AND m.profile_role = v_before.profile_role
         AND m.is_default AND m.status = 'active') THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='default_already_active';
    END IF;
  END IF;

  UPDATE public.omni_comms_module_sender_profile
     SET status = CASE p_action WHEN 'activate' THEN 'active'
                                WHEN 'disable' THEN 'disabled'
                                ELSE 'retired' END,
         activated_at = CASE WHEN p_action='activate' THEN now() ELSE activated_at END,
         activated_by = CASE WHEN p_action='activate' THEN v_uid ELSE activated_by END,
         retired_at = CASE WHEN p_action='retire' THEN now() ELSE retired_at END,
         retired_by = CASE WHEN p_action='retire' THEN v_uid ELSE retired_by END,
         retirement_reason = CASE WHEN p_action='retire' THEN v_reason ELSE retirement_reason END,
         is_default = CASE WHEN p_action IN ('disable','retire') THEN false ELSE is_default END,
         updated_by = v_uid, updated_at = now()
   WHERE id = p_id RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, p_action, 'module_sender_profile', p_id, v_after.caller_module_code,
    to_jsonb(v_before), to_jsonb(v_after) || jsonb_build_object('reason', v_reason),
    p_correlation_id);

  RETURN jsonb_build_object('id', p_id, 'status', v_after.status,
                            'impact', public.omni_comms_priv_module_sender_impact(v_after.*));
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_set_lifecycle(uuid, timestamptz, text, text, text)
  TO authenticated, service_role;

-- ── Safe delete ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_delete(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_module_sender_profile%ROWTYPE; v_impact jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_row FROM public.omni_comms_module_sender_profile WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='module_sender_profile';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_row.organization_id, NULL);
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;

  v_impact := public.omni_comms_priv_module_sender_impact(v_row.*);
  IF NOT (v_impact->>'can_hard_delete')::boolean THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='assignment_has_dependencies';
  END IF;

  DELETE FROM public.omni_comms_module_sender_profile WHERE id = p_id;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'delete','module_sender_profile',p_id,v_row.caller_module_code,
    to_jsonb(v_row), NULL::jsonb, p_correlation_id);
  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_delete(uuid, timestamptz, text)
  TO authenticated, service_role;

-- ── Idempotent bootstrap (preview / apply) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_bootstrap(
  p_organization_id uuid,
  p_apply boolean DEFAULT false,
  p_channel text DEFAULT 'email',
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_plan jsonb := '[]'::jsonb; v_created int := 0; v_existing int := 0;
        v_blocked int := 0; v_rec record; v_sender public.omni_comms_sender_identity%ROWTYPE;
        v_mod boolean; v_row public.omni_comms_module_sender_profile%ROWTYPE;
        v_status text; v_detail text; v_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability(
    CASE WHEN COALESCE(p_apply,false) THEN 'configure' ELSE 'view' END);
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  FOR v_rec IN
    SELECT * FROM (VALUES
      ('BENEFITS','benefits_department'),
      ('EMPLOYER_REGISTRATION','registration_department'),
      ('REGISTRATION','registration_department'),
      ('INSURED_PERSON','registration_department'),
      ('C3','contributions_department'),
      ('CONTRIBUTIONS','contributions_department'),
      ('COMPLIANCE','compliance_department'),
      ('FINANCE','finance_department'),
      ('LEGAL','legal_department'),
      ('PLATFORM','platform_notifications')
    ) AS t(module_code, sender_code)
  LOOP
    v_status := NULL; v_detail := NULL; v_id := NULL; v_sender := NULL;

    SELECT r.is_active INTO v_mod
      FROM public.omni_comms_caller_module_registry r
     WHERE r.module_code = v_rec.module_code;

    IF v_mod IS NULL THEN
      v_status := 'blocked'; v_detail := 'caller_module_not_registered';
    ELSIF NOT v_mod THEN
      v_status := 'blocked'; v_detail := 'caller_module_inactive';
    ELSE
      SELECT * INTO v_sender FROM public.omni_comms_sender_identity s
       WHERE s.organization_id = p_organization_id
         AND s.channel = p_channel
         AND s.code = v_rec.sender_code
         AND s.data_origin <> 'reference_seed'
         AND s.status <> 'retired'
       LIMIT 1;
      IF v_sender.id IS NULL THEN
        v_status := 'blocked'; v_detail := 'sender_not_defined';
      END IF;
    END IF;

    IF v_status IS NULL THEN
      SELECT * INTO v_row FROM public.omni_comms_module_sender_profile m
       WHERE m.organization_id = p_organization_id
         AND m.caller_module_code = v_rec.module_code
         AND m.channel = p_channel
         AND m.profile_role = 'default'
         AND m.status <> 'retired'
       LIMIT 1;

      IF v_row.id IS NOT NULL THEN
        v_status := 'existing'; v_id := v_row.id;
        IF v_row.sender_identity_id IS DISTINCT FROM v_sender.id THEN
          v_detail := 'different_sender_configured';
        END IF;
      ELSIF COALESCE(p_apply,false) THEN
        INSERT INTO public.omni_comms_module_sender_profile(
          organization_id, department_id, caller_module_code, channel,
          sender_identity_id, profile_role, is_default, allow_event_override,
          allow_organization_fallback, status, data_origin,
          created_by, updated_by, activated_at, activated_by)
        VALUES (p_organization_id, v_sender.department_id, v_rec.module_code, p_channel,
          v_sender.id, 'default', true, true,
          (v_rec.module_code = 'PLATFORM'),
          CASE WHEN v_sender.status = 'active' THEN 'active' ELSE 'draft' END, 'system_seed',
          v_uid, v_uid,
          CASE WHEN v_sender.status = 'active' THEN now() ELSE NULL END,
          CASE WHEN v_sender.status = 'active' THEN v_uid ELSE NULL END)
        RETURNING * INTO v_row;
        v_status := 'created'; v_id := v_row.id;
        PERFORM public.omni_comms_priv_write_channel_audit(
          v_uid,'create','module_sender_profile',v_row.id,v_row.caller_module_code,
          NULL,to_jsonb(v_row),p_correlation_id);
      ELSE
        v_status := 'will_create';
      END IF;
    END IF;

    IF v_status = 'created' THEN v_created := v_created + 1;
    ELSIF v_status = 'existing' THEN v_existing := v_existing + 1;
    ELSIF v_status = 'blocked' THEN v_blocked := v_blocked + 1;
    END IF;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'caller_module_code', v_rec.module_code,
      'sender_code', v_rec.sender_code,
      'status', v_status,
      'detail', v_detail,
      'assignment_id', v_id,
      'sender_identity_id', v_sender.id,
      'department_id', v_sender.department_id));
  END LOOP;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'channel', p_channel,
    'applied', COALESCE(p_apply,false),
    'created', v_created,
    'existing', v_existing,
    'blocked', v_blocked,
    'plan', v_plan,
    'generated_at', now());
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_bootstrap(uuid, boolean, text, text)
  TO authenticated, service_role;

-- ── Event-route governance enforcement ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_event_route_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_department_id uuid, p_event_definition_id uuid, p_channel text,
  p_is_required boolean, p_is_enabled boolean, p_priority integer,
  p_template_family_id uuid, p_sender_identity_id uuid,
  p_sender_resolution_policy text, p_preference_policy text,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid;
  v_before public.omni_comms_event_route%ROWTYPE;
  v_after  public.omni_comms_event_route%ROWTYPE;
  v_block text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');

  IF p_id IS NULL THEN
    IF p_organization_id IS NULL OR p_event_definition_id IS NULL OR p_channel IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_event_channel_required';
    END IF;
    v_block := public.omni_comms_priv_module_sender_route_block(
      p_organization_id, p_event_definition_id, p_channel, p_sender_identity_id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL=v_block;
    END IF;
    BEGIN
      INSERT INTO public.omni_comms_event_route(
        organization_id, department_id, event_definition_id, channel,
        is_required, is_enabled, priority, template_family_id, sender_identity_id,
        sender_resolution_policy, preference_policy, lifecycle_state,
        created_by, updated_by)
      VALUES (p_organization_id, p_department_id, p_event_definition_id, p_channel,
        COALESCE(p_is_required,false), COALESCE(p_is_enabled,false),
        COALESCE(p_priority,100), p_template_family_id, p_sender_identity_id,
        COALESCE(p_sender_resolution_policy,'organisation_default'),
        COALESCE(p_preference_policy,'honour'), 'draft', v_uid, v_uid)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 duplicate_event_route' USING ERRCODE='P0001', DETAIL='org_dept_event_channel_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','event_route',v_after.id,v_after.channel,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_event_route WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_route'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.lifecycle_state = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='retired_route_immutable';
  END IF;

  -- Only a CHANGED sender is governed; already-persisted senders are never
  -- rewritten or retro-invalidated by module assignment configuration.
  IF p_sender_identity_id IS DISTINCT FROM v_before.sender_identity_id THEN
    v_block := public.omni_comms_priv_module_sender_route_block(
      v_before.organization_id, v_before.event_definition_id, v_before.channel, p_sender_identity_id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL=v_block;
    END IF;
  END IF;

  BEGIN
    UPDATE public.omni_comms_event_route
       SET is_required = COALESCE(p_is_required, is_required),
           is_enabled = COALESCE(p_is_enabled, is_enabled),
           priority = COALESCE(p_priority, priority),
           template_family_id = p_template_family_id,
           sender_identity_id = p_sender_identity_id,
           sender_resolution_policy = COALESCE(p_sender_resolution_policy, sender_resolution_policy),
           preference_policy = COALESCE(p_preference_policy, preference_policy),
           updated_by = v_uid, updated_at = now()
     WHERE id = p_id RETURNING * INTO v_after;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update','event_route',p_id,v_after.channel,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_event_route_set_lifecycle(
  p_id uuid, p_expected_updated_at timestamptz, p_target_state text,
  p_reason text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid;
  v_before public.omni_comms_event_route%ROWTYPE;
  v_after  public.omni_comms_event_route%ROWTYPE;
  v_reason text;
  v_block text;
  v_origin text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_target_state NOT IN ('active','suspended','retired') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unsupported_target_state';
  END IF;
  v_reason := NULLIF(btrim(COALESCE(p_reason,'')),'');
  IF p_target_state IN ('suspended','retired') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reason_too_long';
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_event_route WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_route'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.lifecycle_state = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_retired';
  END IF;
  IF p_target_state = 'active' AND v_before.lifecycle_state NOT IN ('draft','suspended') THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='not_activatable';
  END IF;
  IF p_target_state = 'suspended' AND v_before.lifecycle_state <> 'active' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='not_suspendable';
  END IF;

  IF p_target_state = 'active' THEN
    SELECT s.data_origin INTO v_origin FROM public.omni_comms_sender_identity s
     WHERE s.id = v_before.sender_identity_id;
    -- Reference/simulation senders belong to reference data and are outside
    -- module governance; genuine senders must be authorised for the module.
    IF COALESCE(v_origin,'') <> 'reference_seed' THEN
      v_block := public.omni_comms_priv_module_sender_route_block(
        v_before.organization_id, v_before.event_definition_id,
        v_before.channel, v_before.sender_identity_id);
      IF v_block IS NOT NULL THEN
        RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL=v_block;
      END IF;
    END IF;
  END IF;

  UPDATE public.omni_comms_event_route
     SET lifecycle_state = p_target_state,
         is_enabled = CASE WHEN p_target_state = 'active' THEN true
                           WHEN p_target_state IN ('suspended','retired') THEN false
                           ELSE is_enabled END,
         activated_at = CASE WHEN p_target_state='active' THEN now() ELSE activated_at END,
         activated_by = CASE WHEN p_target_state='active' THEN v_uid ELSE activated_by END,
         retired_at = CASE WHEN p_target_state='retired' THEN now() ELSE retired_at END,
         retired_by = CASE WHEN p_target_state='retired' THEN v_uid ELSE retired_by END,
         updated_by = v_uid, updated_at = now()
   WHERE id = p_id RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, p_target_state, 'event_route', p_id, v_after.channel,
    to_jsonb(v_before), to_jsonb(v_after) || jsonb_build_object('reason', v_reason), p_correlation_id);
END; $function$;
