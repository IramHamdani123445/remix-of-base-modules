
-- ============================================================================
-- Epic 2 Story 2: Event Catalogue application services (RPCs)
-- All functions: SECURITY DEFINER, owner=postgres,
-- search_path = pg_catalog, extensions (all public/auth objects fully qualified)
-- REVOKE ALL FROM PUBLIC; GRANT EXECUTE only to authenticated for public RPCs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Private helper: require capability (wraps public.has_permission)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_require_capability(p_action text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required'
      USING ERRCODE = 'P0001', DETAIL = 'authentication_required';
  END IF;
  IF NOT public.has_permission(v_uid, 'omni_comms', p_action) THEN
    RAISE EXCEPTION 'OC403 permission_denied'
      USING ERRCODE = 'P0001', DETAIL = p_action;
  END IF;
  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_require_capability(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Private helper: recursive $ref detector on schema JSONB
-- Rejects any $ref value that is not a local fragment (starting with '#').
-- Only inspects the schema, NEVER the sample payload.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_reject_nonlocal_refs(p_schema jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_node jsonb;
  v_key  text;
  v_val  jsonb;
  v_ref  text;
BEGIN
  IF p_schema IS NULL OR jsonb_typeof(p_schema) <> 'object' THEN
    RETURN;
  END IF;

  -- BFS/DFS over structural JSONB (never string parsing)
  FOR v_node IN
    WITH RECURSIVE walk(node) AS (
      SELECT p_schema
      UNION ALL
      SELECT CASE
               WHEN jsonb_typeof(w.node) = 'object' THEN kv.value
               WHEN jsonb_typeof(w.node) = 'array'  THEN elem.value
             END
      FROM walk w
      LEFT JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.node) = 'object' THEN w.node ELSE '{}'::jsonb END) kv  ON jsonb_typeof(w.node) = 'object'
      LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.node) = 'array' THEN w.node ELSE '[]'::jsonb END) elem ON jsonb_typeof(w.node) = 'array'
      WHERE w.node IS NOT NULL
        AND jsonb_typeof(w.node) IN ('object','array')
    )
    SELECT node FROM walk WHERE node IS NOT NULL AND jsonb_typeof(node) = 'object'
  LOOP
    IF v_node ? '$ref' THEN
      v_val := v_node -> '$ref';
      IF jsonb_typeof(v_val) <> 'string' THEN
        RAISE EXCEPTION 'OC422 validation_error'
          USING ERRCODE = 'P0001', DETAIL = 'non_local_ref';
      END IF;
      v_ref := trim(both '"' from v_val::text);
      IF v_ref = '' OR left(v_ref, 1) <> '#' THEN
        RAISE EXCEPTION 'OC422 validation_error'
          USING ERRCODE = 'P0001', DETAIL = 'non_local_ref';
      END IF;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_reject_nonlocal_refs(jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Private helper: full validation pipeline for schema + sample
--   1. schema is a JSON object
--   2. serialized schema <= 256 KB, serialized sample <= 256 KB
--   3. no non-local $ref in schema
--   4. schema is a valid JSON Schema (extensions.jsonschema_is_valid)
--   5. root schema type describes an object (declared "type":"object")
--   6. sample_payload is a JSON object
--   7. sample_payload matches schema (extensions.jsonb_matches_schema)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_schema(
  p_json_schema     jsonb,
  p_sample_payload  jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_schema_bytes int;
  v_sample_bytes int;
  v_type jsonb;
BEGIN
  IF p_json_schema IS NULL OR jsonb_typeof(p_json_schema) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'root_schema_not_object';
  END IF;

  v_schema_bytes := octet_length(convert_to(p_json_schema::text, 'UTF8'));
  IF v_schema_bytes > 262144 THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'schema_too_large';
  END IF;

  IF p_sample_payload IS NOT NULL THEN
    v_sample_bytes := octet_length(convert_to(p_sample_payload::text, 'UTF8'));
    IF v_sample_bytes > 262144 THEN
      RAISE EXCEPTION 'OC422 validation_error'
        USING ERRCODE = 'P0001', DETAIL = 'sample_payload_too_large';
    END IF;
  END IF;

  PERFORM public.omni_comms_priv_reject_nonlocal_refs(p_json_schema);

  IF NOT extensions.jsonschema_is_valid(p_json_schema::text::json) THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'invalid_schema';
  END IF;

  v_type := p_json_schema -> 'type';
  IF v_type IS NULL OR jsonb_typeof(v_type) <> 'string' OR trim(both '"' from v_type::text) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'root_schema_not_object';
  END IF;

  IF p_sample_payload IS NOT NULL THEN
    IF jsonb_typeof(p_sample_payload) <> 'object' THEN
      RAISE EXCEPTION 'OC422 validation_error'
        USING ERRCODE = 'P0001', DETAIL = 'sample_payload_not_object';
    END IF;
    IF NOT extensions.jsonb_matches_schema(p_json_schema::text::json, p_sample_payload) THEN
      RAISE EXCEPTION 'OC422 validation_error'
        USING ERRCODE = 'P0001', DETAIL = 'sample_payload_invalid';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_schema(jsonb, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Private helper: compute deterministic SHA-256 checksum of a contract
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_compute_checksum(
  p_event_code     text,
  p_version_number integer,
  p_json_schema    jsonb
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'eventCode',     p_event_code,
          'versionNumber', p_version_number,
          'jsonSchema',    p_json_schema
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_compute_checksum(text, integer, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Private helper: atomic audit-log write.
-- The insert happens in the same transaction as the caller mutation.
-- If it fails, translate to OC450 audit_write_failed so the transaction rolls
-- back (caller does NOT catch it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_write_audit(
  p_actor_id       uuid,
  p_action         text,
  p_entity_type    text,
  p_entity_id      uuid,
  p_entity_display text,
  p_before         jsonb,
  p_after          jsonb,
  p_correlation_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_actor_name  text;
  v_actor_email text;
  v_changed     text[];
BEGIN
  BEGIN
    SELECT p.full_name, u.email
      INTO v_actor_name, v_actor_email
      FROM public.profiles p
      LEFT JOIN auth.users u ON u.id = p.user_id
      WHERE p.user_id = p_actor_id
      LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_actor_name := NULL;
    v_actor_email := NULL;
  END;

  IF p_before IS NOT NULL AND p_after IS NOT NULL THEN
    SELECT COALESCE(array_agg(k), ARRAY[]::text[])
      INTO v_changed
      FROM (
        SELECT key AS k
          FROM jsonb_each(p_after)
         WHERE p_before -> key IS DISTINCT FROM p_after -> key
      ) diff;
  END IF;

  BEGIN
    INSERT INTO public.core_audit_log (
      event_code, event_name, event_category, severity, risk_level,
      actor_user_id, actor_name, actor_email,
      module_code, domain_code, entity_type, entity_id, entity_display_name,
      action, outcome,
      before_value, after_value, changed_fields,
      correlation_id, source, source_component
    ) VALUES (
      'OMNI_COMMS.' || upper(p_entity_type) || '.' || upper(p_action),
      p_action, 'configuration', 'info', 'low',
      p_actor_id, v_actor_name, v_actor_email,
      'OMNI_COMMS', 'events', p_entity_type, p_entity_id::text, p_entity_display,
      p_action, 'success',
      p_before, p_after, v_changed,
      p_correlation_id, 'rpc', 'omni_comms_event_catalogue'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'OC450 audit_write_failed'
      USING ERRCODE = 'P0001', DETAIL = SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_write_audit(uuid, text, text, uuid, text, jsonb, jsonb, text) FROM PUBLIC;

-- ===========================================================================
-- EVENT DEFINITION MUTATIONS
-- ===========================================================================

-- create
CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_create(
  p_code                text,
  p_module_code         text,
  p_entity_type         text,
  p_name                text,
  p_description         text,
  p_communication_class text,
  p_default_priority    text,
  p_correlation_id      text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_id  uuid;
  v_cons text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  BEGIN
    INSERT INTO public.omni_comms_event_definition
      (code, module_code, entity_type, name, description,
       communication_class, default_priority, status,
       created_by, updated_by)
    VALUES
      (p_code, p_module_code, p_entity_type, p_name, p_description,
       p_communication_class, COALESCE(p_default_priority, 'normal'), 'draft',
       v_uid, v_uid)
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      IF v_cons = 'omni_comms_event_definition_code_key' THEN
        RAISE EXCEPTION 'OC409 duplicate_event_code'
          USING ERRCODE = 'P0001', DETAIL = p_code;
      END IF;
      RAISE;
    WHEN check_violation THEN
      RAISE EXCEPTION 'OC422 validation_error'
        USING ERRCODE = 'P0001', DETAIL = SQLERRM;
  END;

  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'create', 'event_definition', v_id, p_code,
    NULL,
    jsonb_build_object('code', p_code, 'module_code', p_module_code,
                       'entity_type', p_entity_type, 'name', p_name,
                       'communication_class', p_communication_class,
                       'default_priority', COALESCE(p_default_priority,'normal'),
                       'status', 'draft'),
    p_correlation_id
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_create(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_create(text,text,text,text,text,text,text,text) TO authenticated;

-- update draft
CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_update_draft(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_code                text,
  p_module_code         text,
  p_entity_type         text,
  p_name                text,
  p_description         text,
  p_communication_class text,
  p_default_priority    text,
  p_correlation_id      text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_definition%ROWTYPE;
  v_after  public.omni_comms_event_definition%ROWTYPE;
  v_cons text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_event_definition WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition';
  END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft';
  END IF;

  BEGIN
    UPDATE public.omni_comms_event_definition
       SET code = p_code,
           module_code = p_module_code,
           entity_type = p_entity_type,
           name = p_name,
           description = p_description,
           communication_class = p_communication_class,
           default_priority = COALESCE(p_default_priority, default_priority),
           updated_by = v_uid,
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_after;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      IF v_cons = 'omni_comms_event_definition_code_key' THEN
        RAISE EXCEPTION 'OC409 duplicate_event_code' USING ERRCODE='P0001', DETAIL=p_code;
      END IF;
      RAISE;
    WHEN check_violation THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;

  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'update_draft', 'event_definition', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id
  );
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_update_draft(uuid,timestamptz,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_update_draft(uuid,timestamptz,text,text,text,text,text,text,text,text) TO authenticated;

-- helper macro for the three lifecycle transitions
CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_definition%ROWTYPE;
  v_after  public.omni_comms_event_definition%ROWTYPE;
  v_pub_count int;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_event_definition WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition';
  END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status NOT IN ('draft','suspended') THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='cannot_activate_from_'||v_before.status;
  END IF;
  SELECT count(*) INTO v_pub_count
    FROM public.omni_comms_event_contract
   WHERE event_definition_id = p_id AND status = 'published';
  IF v_pub_count < 1 THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='no_published_contract';
  END IF;
  UPDATE public.omni_comms_event_definition
     SET status = 'active', updated_by = v_uid, updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'activate', 'event_definition', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id
  );
  RETURN p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_activate(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_activate(uuid,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_suspend(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_definition%ROWTYPE;
  v_after  public.omni_comms_event_definition%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_event_definition WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status <> 'active' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_active';
  END IF;
  UPDATE public.omni_comms_event_definition
     SET status = 'suspended', updated_by = v_uid, updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'suspend', 'event_definition', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id
  );
  RETURN p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_suspend(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_suspend(uuid,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_retire(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_definition%ROWTYPE;
  v_after  public.omni_comms_event_definition%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_event_definition WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_retired';
  END IF;
  UPDATE public.omni_comms_event_definition
     SET status = 'retired', updated_by = v_uid, updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'retire', 'event_definition', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id
  );
  RETURN p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_retire(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_retire(uuid,timestamptz,text) TO authenticated;

-- ===========================================================================
-- EVENT CONTRACT MUTATIONS
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_create(
  p_event_definition_id uuid,
  p_version_number      integer,
  p_json_schema         jsonb,
  p_sample_payload      jsonb,
  p_correlation_id      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_id  uuid;
  v_owner_status text;
  v_cons text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT status INTO v_owner_status FROM public.omni_comms_event_definition WHERE id = p_event_definition_id;
  IF v_owner_status IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition';
  END IF;
  IF v_owner_status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='event_retired';
  END IF;
  PERFORM public.omni_comms_priv_validate_schema(p_json_schema, p_sample_payload);
  BEGIN
    INSERT INTO public.omni_comms_event_contract
      (event_definition_id, version_number, json_schema, sample_payload, status, created_by, updated_by)
    VALUES
      (p_event_definition_id, p_version_number, p_json_schema, COALESCE(p_sample_payload,'{}'::jsonb),
       'draft', v_uid, v_uid)
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      IF v_cons = 'omni_comms_event_contract_event_version_key' THEN
        RAISE EXCEPTION 'OC410 duplicate_contract_version' USING ERRCODE='P0001', DETAIL=p_version_number::text;
      END IF;
      RAISE;
    WHEN check_violation THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;

  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'create', 'event_contract', v_id,
    p_event_definition_id::text || '#' || p_version_number::text,
    NULL,
    jsonb_build_object('event_definition_id', p_event_definition_id,
                       'version_number', p_version_number, 'status','draft'),
    p_correlation_id
  );
  RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_create(uuid,integer,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_create(uuid,integer,jsonb,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_update_draft(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_json_schema         jsonb,
  p_sample_payload      jsonb,
  p_correlation_id      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_contract%ROWTYPE;
  v_after  public.omni_comms_event_contract%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_event_contract WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_contract'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft';
  END IF;
  PERFORM public.omni_comms_priv_validate_schema(p_json_schema, p_sample_payload);
  UPDATE public.omni_comms_event_contract
     SET json_schema = p_json_schema,
         sample_payload = COALESCE(p_sample_payload, sample_payload),
         updated_by = v_uid, updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'update_draft', 'event_contract', p_id,
    v_after.event_definition_id::text || '#' || v_after.version_number::text,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id
  );
  RETURN p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_update_draft(uuid,timestamptz,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_update_draft(uuid,timestamptz,jsonb,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_publish(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_contract%ROWTYPE;
  v_after  public.omni_comms_event_contract%ROWTYPE;
  v_event_code text;
  v_checksum   text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_event_contract WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_contract'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft';
  END IF;
  PERFORM public.omni_comms_priv_validate_schema(v_before.json_schema, v_before.sample_payload);
  SELECT code INTO v_event_code FROM public.omni_comms_event_definition WHERE id = v_before.event_definition_id;
  v_checksum := public.omni_comms_priv_compute_checksum(v_event_code, v_before.version_number, v_before.json_schema);
  UPDATE public.omni_comms_event_contract
     SET status='published', checksum=v_checksum,
         published_at=now(), published_by=v_uid,
         updated_by=v_uid, updated_at=now()
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'publish', 'event_contract', p_id,
    v_after.event_definition_id::text || '#' || v_after.version_number::text,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id
  );
  RETURN p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_publish(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_publish(uuid,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_retire(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_contract%ROWTYPE;
  v_after  public.omni_comms_event_contract%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_event_contract WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_contract'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status <> 'published' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_published';
  END IF;
  UPDATE public.omni_comms_event_contract
     SET status='retired', retired_at=now(), retired_by=v_uid,
         updated_by=v_uid, updated_at=now()
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'retire', 'event_contract', p_id,
    v_after.event_definition_id::text || '#' || v_after.version_number::text,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id
  );
  RETURN p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_retire(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_retire(uuid,timestamptz,text) TO authenticated;

-- ===========================================================================
-- READ RPCS
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_get(p_id uuid)
RETURNS TABLE (
  id uuid, code text, module_code text, entity_type text, name text,
  description text, communication_class text, default_priority text,
  status text, created_at timestamptz, created_by uuid,
  updated_at timestamptz, updated_by uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  RETURN QUERY
    SELECT d.id, d.code, d.module_code, d.entity_type, d.name, d.description,
           d.communication_class, d.default_priority, d.status,
           d.created_at, d.created_by, d.updated_at, d.updated_by
      FROM public.omni_comms_event_definition d
     WHERE d.id = p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_list(
  p_limit integer, p_offset integer, p_status text, p_module_code text
)
RETURNS TABLE (
  id uuid, code text, module_code text, entity_type text, name text,
  communication_class text, default_priority text, status text,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE v_limit int; v_offset int;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_limit  := COALESCE(p_limit, 50);
  v_offset := COALESCE(p_offset, 0);
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='limit_out_of_range';
  END IF;
  IF v_offset < 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='negative_offset';
  END IF;
  RETURN QUERY
    SELECT d.id, d.code, d.module_code, d.entity_type, d.name,
           d.communication_class, d.default_priority, d.status, d.updated_at
      FROM public.omni_comms_event_definition d
     WHERE (p_status IS NULL OR d.status = p_status)
       AND (p_module_code IS NULL OR d.module_code = p_module_code)
     ORDER BY d.code ASC, d.id ASC
     LIMIT v_limit OFFSET v_offset;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_list(integer,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_list(integer,integer,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_get(p_id uuid)
RETURNS TABLE (
  id uuid, event_definition_id uuid, version_number integer,
  json_schema jsonb, sample_payload jsonb, status text, checksum text,
  published_at timestamptz, published_by uuid,
  retired_at timestamptz, retired_by uuid,
  created_at timestamptz, created_by uuid,
  updated_at timestamptz, updated_by uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  RETURN QUERY
    SELECT c.id, c.event_definition_id, c.version_number,
           c.json_schema, c.sample_payload, c.status, c.checksum,
           c.published_at, c.published_by, c.retired_at, c.retired_by,
           c.created_at, c.created_by, c.updated_at, c.updated_by
      FROM public.omni_comms_event_contract c
     WHERE c.id = p_id;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_list(
  p_event_definition_id uuid, p_limit integer, p_offset integer, p_status text
)
RETURNS TABLE (
  id uuid, event_definition_id uuid, version_number integer, status text,
  checksum text, published_at timestamptz, retired_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE v_limit int; v_offset int;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_limit  := COALESCE(p_limit, 50);
  v_offset := COALESCE(p_offset, 0);
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='limit_out_of_range';
  END IF;
  IF v_offset < 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='negative_offset';
  END IF;
  RETURN QUERY
    SELECT c.id, c.event_definition_id, c.version_number, c.status,
           c.checksum, c.published_at, c.retired_at, c.updated_at
      FROM public.omni_comms_event_contract c
     WHERE c.event_definition_id = p_event_definition_id
       AND (p_status IS NULL OR c.status = p_status)
     ORDER BY c.version_number DESC, c.id ASC
     LIMIT v_limit OFFSET v_offset;
END;$$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_list(uuid,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_list(uuid,integer,integer,text) TO authenticated;
