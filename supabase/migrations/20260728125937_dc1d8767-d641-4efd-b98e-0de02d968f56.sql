
-- ============================================================================
-- Epic 2 — Story 3: Omni-Comms Event Catalogue hardening
-- Lifecycle reasons, bounded pagination, escaped search, sample redaction.
-- Single-transaction migration (Supabase wraps files in a transaction by
-- default); partial failure leaves the prior Story 2 definitions intact.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Drop old overloads that are being replaced with new signatures.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_activate(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_suspend(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_retire(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_publish(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_retire(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_list(integer, integer, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_list(uuid, integer, integer, text);
DROP FUNCTION IF EXISTS public.omni_comms_event_contract_get(uuid);

-- ---------------------------------------------------------------------------
-- Private helper: normalize + bound a lifecycle reason.
--   - trims whitespace
--   - requires non-empty when p_required is true (OC422 reason_required)
--   - rejects > 2000 chars (OC422 reason_too_long)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_reason(
  p_reason   text,
  p_required boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE v_trimmed text;
BEGIN
  v_trimmed := btrim(COALESCE(p_reason, ''));
  IF p_required AND v_trimmed = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;
  IF char_length(v_trimmed) > 2000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reason_too_long';
  END IF;
  IF v_trimmed = '' THEN RETURN NULL; END IF;
  RETURN v_trimmed;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_reason(text, boolean) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Private helper: escape ILIKE pattern characters (\, %, _).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_escape_ilike(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
  SELECT replace(replace(replace(COALESCE(p_input, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_escape_ilike(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Private helper: audit write with a first-class `reason` column.
-- Replaces the legacy p_correlation_id-only helper for lifecycle actions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_write_lifecycle_audit(
  p_actor_id       uuid,
  p_action         text,
  p_entity_type    text,
  p_entity_id      uuid,
  p_entity_display text,
  p_before         jsonb,
  p_after          jsonb,
  p_reason         text,
  p_correlation_id text
) RETURNS void
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
    v_actor_name := NULL; v_actor_email := NULL;
  END;

  IF p_before IS NOT NULL AND p_after IS NOT NULL THEN
    SELECT COALESCE(array_agg(k), ARRAY[]::text[])
      INTO v_changed
      FROM (
        SELECT key AS k FROM jsonb_each(p_after)
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
      reason, correlation_id, source, source_component
    ) VALUES (
      'OMNI_COMMS.' || upper(p_entity_type) || '.' || upper(p_action),
      p_action, 'configuration', 'info', 'low',
      p_actor_id, v_actor_name, v_actor_email,
      'OMNI_COMMS', 'events', p_entity_type, p_entity_id::text, p_entity_display,
      p_action, 'success',
      p_before, p_after, v_changed,
      p_reason, p_correlation_id, 'rpc', 'omni_comms_event_catalogue'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'OC450 audit_write_failed'
      USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_write_lifecycle_audit(
  uuid,text,text,uuid,text,jsonb,jsonb,text,text
) FROM PUBLIC;

-- ===========================================================================
-- RECREATED LIFECYCLE RPCs (with p_reason)
-- ===========================================================================

-- activate event definition: reason optional
CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_activate(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_reason              text,
  p_correlation_id      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_definition%ROWTYPE;
  v_after  public.omni_comms_event_definition%ROWTYPE;
  v_pub_count int;
  v_reason text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, false);
  SELECT * INTO v_before FROM public.omni_comms_event_definition WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition'; END IF;
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
     SET status='active', updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_lifecycle_audit(
    v_uid, 'activate', 'event_definition', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), v_reason, p_correlation_id
  );
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_activate(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_activate(uuid,timestamptz,text,text) TO authenticated;

-- suspend event definition: reason required
CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_suspend(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_reason              text,
  p_correlation_id      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_definition%ROWTYPE;
  v_after  public.omni_comms_event_definition%ROWTYPE;
  v_reason text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, true);
  SELECT * INTO v_before FROM public.omni_comms_event_definition WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status <> 'active' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_active';
  END IF;
  UPDATE public.omni_comms_event_definition
     SET status='suspended', updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_lifecycle_audit(
    v_uid, 'suspend', 'event_definition', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), v_reason, p_correlation_id
  );
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_suspend(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_suspend(uuid,timestamptz,text,text) TO authenticated;

-- retire event definition: reason required
CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_retire(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_reason              text,
  p_correlation_id      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_definition%ROWTYPE;
  v_after  public.omni_comms_event_definition%ROWTYPE;
  v_reason text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, true);
  SELECT * INTO v_before FROM public.omni_comms_event_definition WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_definition'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_retired';
  END IF;
  UPDATE public.omni_comms_event_definition
     SET status='retired', updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_lifecycle_audit(
    v_uid, 'retire', 'event_definition', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), v_reason, p_correlation_id
  );
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_retire(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_retire(uuid,timestamptz,text,text) TO authenticated;

-- publish contract: reason optional
CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_publish(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_reason              text,
  p_correlation_id      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_contract%ROWTYPE;
  v_after  public.omni_comms_event_contract%ROWTYPE;
  v_event_code text;
  v_checksum   text;
  v_reason text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, false);
  SELECT * INTO v_before FROM public.omni_comms_event_contract WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='event_contract'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft';
  END IF;
  PERFORM public.omni_comms_priv_validate_schema(v_before.json_schema, v_before.sample_payload);
  SELECT code INTO v_event_code FROM public.omni_comms_event_definition WHERE id=v_before.event_definition_id;
  v_checksum := public.omni_comms_priv_compute_checksum(v_event_code, v_before.version_number, v_before.json_schema);
  UPDATE public.omni_comms_event_contract
     SET status='published', checksum=v_checksum,
         published_at=now(), published_by=v_uid,
         updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_lifecycle_audit(
    v_uid, 'publish', 'event_contract', p_id,
    v_after.event_definition_id::text || '#' || v_after.version_number::text,
    to_jsonb(v_before), to_jsonb(v_after), v_reason, p_correlation_id
  );
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_publish(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_publish(uuid,timestamptz,text,text) TO authenticated;

-- retire contract: reason required
CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_retire(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_reason              text,
  p_correlation_id      text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_event_contract%ROWTYPE;
  v_after  public.omni_comms_event_contract%ROWTYPE;
  v_reason text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, true);
  SELECT * INTO v_before FROM public.omni_comms_event_contract WHERE id=p_id FOR UPDATE;
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
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_lifecycle_audit(
    v_uid, 'retire', 'event_contract', p_id,
    v_after.event_definition_id::text || '#' || v_after.version_number::text,
    to_jsonb(v_before), to_jsonb(v_after), v_reason, p_correlation_id
  );
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_retire(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_retire(uuid,timestamptz,text,text) TO authenticated;

-- ===========================================================================
-- RECREATED READ RPCs (bounded pagination + escaped search + redaction)
-- ===========================================================================

-- event definition list: adds p_search (escaped); strict limit/offset validation
CREATE OR REPLACE FUNCTION public.omni_comms_event_definition_list(
  p_limit       integer,
  p_offset      integer,
  p_status      text,
  p_module_code text,
  p_search      text
) RETURNS TABLE (
  id uuid, code text, module_code text, entity_type text, name text,
  communication_class text, default_priority text, status text,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_limit int; v_offset int; v_needle text; v_pattern text;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_limit  := p_limit;
  v_offset := p_offset;
  IF v_limit IS NULL OR v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='limit_out_of_range';
  END IF;
  IF v_offset IS NULL OR v_offset < 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='offset_out_of_range';
  END IF;
  v_needle := btrim(COALESCE(p_search, ''));
  IF v_needle = '' THEN
    v_pattern := NULL;
  ELSE
    v_pattern := '%' || public.omni_comms_priv_escape_ilike(v_needle) || '%';
  END IF;
  RETURN QUERY
    SELECT d.id, d.code, d.module_code, d.entity_type, d.name,
           d.communication_class, d.default_priority, d.status, d.updated_at
      FROM public.omni_comms_event_definition d
     WHERE (p_status IS NULL OR d.status = p_status)
       AND (p_module_code IS NULL OR d.module_code = p_module_code)
       AND (
             v_pattern IS NULL
             OR d.code        ILIKE v_pattern ESCAPE '\'
             OR d.name        ILIKE v_pattern ESCAPE '\'
             OR d.module_code ILIKE v_pattern ESCAPE '\'
             OR d.entity_type ILIKE v_pattern ESCAPE '\'
           )
     ORDER BY d.code ASC, d.id ASC
     LIMIT v_limit OFFSET v_offset;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_definition_list(integer,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_list(integer,integer,text,text,text) TO authenticated;

-- event contract list: strict validation (limit_out_of_range/offset_out_of_range)
CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_list(
  p_event_definition_id uuid, p_limit integer, p_offset integer, p_status text
) RETURNS TABLE (
  id uuid, event_definition_id uuid, version_number integer, status text,
  checksum text, published_at timestamptz, retired_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE v_limit int; v_offset int;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_limit := p_limit; v_offset := p_offset;
  IF v_limit IS NULL OR v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='limit_out_of_range';
  END IF;
  IF v_offset IS NULL OR v_offset < 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='offset_out_of_range';
  END IF;
  RETURN QUERY
    SELECT c.id, c.event_definition_id, c.version_number, c.status,
           c.checksum, c.published_at, c.retired_at, c.updated_at
      FROM public.omni_comms_event_contract c
     WHERE c.event_definition_id = p_event_definition_id
       AND (p_status IS NULL OR c.status = p_status)
     ORDER BY c.version_number DESC, c.id ASC
     LIMIT v_limit OFFSET v_offset;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_list(uuid,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_list(uuid,integer,integer,text) TO authenticated;

-- contract get: redacts sample payload when caller lacks view_sensitive_content
CREATE OR REPLACE FUNCTION public.omni_comms_event_contract_get(p_id uuid)
RETURNS TABLE (
  id uuid, event_definition_id uuid, version_number integer,
  json_schema jsonb, sample_payload jsonb, sample_payload_redacted boolean,
  status text, checksum text,
  published_at timestamptz, published_by uuid,
  retired_at timestamptz, retired_by uuid,
  created_at timestamptz, created_by uuid,
  updated_at timestamptz, updated_by uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_uid uuid;
  v_can_see boolean;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_can_see := public.has_permission(v_uid, 'omni_comms', 'view_sensitive_content');
  RETURN QUERY
    SELECT c.id, c.event_definition_id, c.version_number, c.json_schema,
           CASE WHEN v_can_see THEN c.sample_payload ELSE NULL::jsonb END AS sample_payload,
           NOT v_can_see AS sample_payload_redacted,
           c.status, c.checksum,
           c.published_at, c.published_by, c.retired_at, c.retired_by,
           c.created_at, c.created_by, c.updated_at, c.updated_by
      FROM public.omni_comms_event_contract c
     WHERE c.id = p_id;
END; $$;
REVOKE ALL ON FUNCTION public.omni_comms_event_contract_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_get(uuid) TO authenticated;

-- ===========================================================================
-- Legacy audit helper: still used by non-lifecycle RPCs (create, update_draft).
-- Left in place; not renamed. Only lifecycle actions moved to the new helper.
-- ===========================================================================

COMMENT ON FUNCTION public.omni_comms_priv_write_lifecycle_audit(uuid,text,text,uuid,text,jsonb,jsonb,text,text)
  IS 'Epic 2 Story 3: lifecycle-audit writer; persists trimmed reason to core_audit_log.reason.';

-- ============================================================================
-- ROLLBACK SQL (documented only — do NOT execute against active branch):
--   DROP FUNCTION IF EXISTS public.omni_comms_event_contract_get(uuid);
--   DROP FUNCTION IF EXISTS public.omni_comms_event_contract_list(uuid,integer,integer,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_event_definition_list(integer,integer,text,text,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_event_contract_retire(uuid,timestamptz,text,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_event_contract_publish(uuid,timestamptz,text,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_event_definition_retire(uuid,timestamptz,text,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_event_definition_suspend(uuid,timestamptz,text,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_event_definition_activate(uuid,timestamptz,text,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_priv_write_lifecycle_audit(uuid,text,text,uuid,text,jsonb,jsonb,text,text);
--   DROP FUNCTION IF EXISTS public.omni_comms_priv_escape_ilike(text);
--   DROP FUNCTION IF EXISTS public.omni_comms_priv_normalize_reason(text,boolean);
--   Then reapply the Story 2 migration (20260728122047_*.sql) to restore
--   the prior overloads with owner=postgres, SECURITY DEFINER,
--   search_path=pg_catalog,extensions, REVOKE ALL FROM PUBLIC and
--   GRANT EXECUTE ... TO authenticated.
-- ============================================================================
