-- ============================================================================
-- Omni-Comms — Epic 3 Story 2: Template Catalogue application services
-- ============================================================================
-- Contract:
--  * No new tables. All operations run against Story 1 tables.
--  * All private helpers REVOKE ALL FROM PUBLIC.
--  * All public RPCs: SECURITY DEFINER, owner postgres, restricted search_path,
--    REVOKE ALL FROM PUBLIC + anon; GRANT EXECUTE TO authenticated only.
--  * Controlled RPC errors: SQLSTATE P0001, message begins "OC### ...", DETAIL
--    carries a machine-readable slug.
-- ============================================================================

-- ─── Private helpers ────────────────────────────────────────────────────────

-- normalize_locale: trim, lowercase language, uppercase region. Rejects
-- unsupported forms rather than silently stripping subtags.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_locale(p_locale text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_trim text;
  v_lang text;
  v_region text;
  v_dash integer;
BEGIN
  IF p_locale IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='locale_required';
  END IF;
  v_trim := btrim(p_locale);
  IF v_trim = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='locale_required';
  END IF;
  v_dash := position('-' in v_trim);
  IF v_dash = 0 THEN
    v_lang := lower(v_trim);
    v_region := NULL;
  ELSE
    v_lang := lower(substring(v_trim FROM 1 FOR v_dash - 1));
    v_region := upper(substring(v_trim FROM v_dash + 1));
  END IF;
  IF v_region IS NULL THEN
    IF NOT (v_lang ~ '^[a-z]{2,3}$') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='locale_format_invalid';
    END IF;
    RETURN v_lang;
  ELSE
    IF NOT (v_lang ~ '^[a-z]{2,3}$' AND v_region ~ '^[A-Z]{2}$') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='locale_format_invalid';
    END IF;
    RETURN v_lang || '-' || v_region;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_locale(text) FROM PUBLIC;

-- extract_tokens: strict {{path}} scan. Returns text[] of unique paths.
-- Rejects: unmatched braces, empty tokens, triple braces, nested/sections/
-- helpers/comments/partials, array indexes, malformed dotted paths.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_extract_tokens(p_source text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_len integer;
  v_i integer := 1;
  v_ch text;
  v_next text;
  v_end integer;
  v_body text;
  v_close integer;
  v_tokens text[] := ARRAY[]::text[];
BEGIN
  IF p_source IS NULL OR p_source = '' THEN
    RETURN v_tokens;
  END IF;
  v_len := length(p_source);
  WHILE v_i <= v_len LOOP
    v_ch := substr(p_source, v_i, 1);
    IF v_ch = '{' THEN
      IF v_i + 1 > v_len THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_unmatched_open';
      END IF;
      v_next := substr(p_source, v_i + 1, 1);
      IF v_next <> '{' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_unmatched_open';
      END IF;
      -- reject triple brace
      IF v_i + 2 <= v_len AND substr(p_source, v_i + 2, 1) = '{' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_triple_brace';
      END IF;
      v_close := position('}}' in substr(p_source, v_i + 2));
      IF v_close = 0 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_unmatched_open';
      END IF;
      v_body := substr(p_source, v_i + 2, v_close - 1);
      -- reject nested braces / control chars inside body
      IF v_body ~ '[{}#/^!>@=]' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_disallowed_syntax';
      END IF;
      v_body := btrim(v_body);
      IF v_body = '' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_empty';
      END IF;
      IF NOT (v_body ~ '^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$') THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_path_invalid';
      END IF;
      IF NOT (v_body = ANY(v_tokens)) THEN
        v_tokens := array_append(v_tokens, v_body);
      END IF;
      v_i := v_i + 2 + v_close + 1;
    ELSIF v_ch = '}' THEN
      IF v_i + 1 <= v_len AND substr(p_source, v_i + 1, 1) = '}' THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_token_unmatched_close';
      END IF;
      v_i := v_i + 1;
    ELSE
      v_i := v_i + 1;
    END IF;
  END LOOP;
  RETURN v_tokens;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_extract_tokens(text) FROM PUBLIC;

-- validate_channel_content: enumerates exact allowed keys, forbids unknown/null,
-- enforces trimmed non-empty, checks UTF-8 byte size <= 256 KiB.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_channel_content(
  p_channel text,
  p_content jsonb
) RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_allowed text[];
  v_required text[];
  v_key text;
  v_val jsonb;
  v_bytes integer;
  v_html text;
  v_text text;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_not_object';
  END IF;
  v_bytes := octet_length(convert_to(p_content::text, 'UTF8'));
  IF v_bytes > 262144 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_too_large';
  END IF;

  CASE p_channel
    WHEN 'email'    THEN v_allowed := ARRAY['subject','html','text','preheader'];
                         v_required := ARRAY['subject'];
    WHEN 'sms'      THEN v_allowed := ARRAY['body'];                v_required := ARRAY['body'];
    WHEN 'in_app'   THEN v_allowed := ARRAY['title','body'];         v_required := ARRAY['title','body'];
    WHEN 'push'     THEN v_allowed := ARRAY['title','body'];         v_required := ARRAY['title','body'];
    WHEN 'whatsapp' THEN v_allowed := ARRAY['body'];                v_required := ARRAY['body'];
    WHEN 'print'    THEN v_allowed := ARRAY['subject','html','text'];v_required := ARRAY['subject'];
    ELSE
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_unknown';
  END CASE;

  -- reject unknown keys
  FOR v_key IN SELECT k FROM jsonb_object_keys(p_content) k LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_unknown_key';
    END IF;
    v_val := p_content -> v_key;
    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_null_value';
    END IF;
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_non_string_value';
    END IF;
    IF btrim(v_val #>> '{}') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_empty_value';
    END IF;
    -- validate token grammar on every string field
    PERFORM public.omni_comms_priv_extract_tokens(v_val #>> '{}');
  END LOOP;

  -- required keys present
  FOR v_key IN SELECT unnest(v_required) LOOP
    IF NOT (p_content ? v_key) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_missing_required_key';
    END IF;
  END LOOP;

  -- email requires at least one of html/text
  IF p_channel = 'email' THEN
    v_html := p_content ->> 'html';
    v_text := p_content ->> 'text';
    IF COALESCE(btrim(v_html), '') = '' AND COALESCE(btrim(v_text), '') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_email_body_required';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_channel_content(text, jsonb) FROM PUBLIC;

-- compute_template_checksum: SHA-256 hex over deterministic identity + content.
-- Relies on PostgreSQL JSONB key-order normalisation.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_compute_template_checksum(
  p_family_code   text,
  p_version_number integer,
  p_channel       text,
  p_locale        text,
  p_content       jsonb
) RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, extensions
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'familyCode',    p_family_code,
          'versionNumber', p_version_number,
          'channel',       p_channel,
          'locale',        p_locale,
          'content',       p_content
        )::text, 'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_compute_template_checksum(text, integer, text, text, jsonb) FROM PUBLIC;

-- verify_department_ownership: STABLE, INVOKER (callers are DEFINER RPCs).
CREATE OR REPLACE FUNCTION public.omni_comms_priv_verify_department_ownership(
  p_department_id uuid,
  p_organization_id uuid
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.core_department WHERE id = p_department_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='department_not_found';
  END IF;
  IF v_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_organization_mismatch';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_verify_department_ownership(uuid, uuid) FROM PUBLIC;

-- write_template_audit: SECURITY DEFINER audit writer scoped to the template
-- catalogue. Required because the existing event helper hardcodes
-- domain_code='events' and source_component='omni_comms_event_catalogue'.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_write_template_audit(
  p_actor_id       uuid,
  p_action         text,
  p_entity_type    text,
  p_entity_id      uuid,
  p_entity_display text,
  p_before         jsonb,
  p_after          jsonb,
  p_reason         text,
  p_notes          text,
  p_correlation_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_name  text;
  v_actor_email text;
  v_changed     text[];
BEGIN
  BEGIN
    SELECT p.full_name, u.email INTO v_actor_name, v_actor_email
      FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.user_id
     WHERE p.user_id = p_actor_id LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_actor_name := NULL; v_actor_email := NULL;
  END;
  IF p_before IS NOT NULL AND p_after IS NOT NULL THEN
    SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_changed
      FROM (SELECT key AS k FROM jsonb_each(p_after)
             WHERE p_before -> key IS DISTINCT FROM p_after -> key) d;
  END IF;
  BEGIN
    INSERT INTO public.core_audit_log (
      event_code, event_name, event_category, severity, risk_level,
      actor_user_id, actor_name, actor_email,
      module_code, domain_code, entity_type, entity_id, entity_display_name,
      action, outcome,
      before_value, after_value, changed_fields,
      reason, notes, correlation_id, source, source_component
    ) VALUES (
      'OMNI_COMMS.' || upper(p_entity_type) || '.' || upper(p_action),
      p_action, 'configuration', 'info', 'low',
      p_actor_id, v_actor_name, v_actor_email,
      'OMNI_COMMS', 'templates', p_entity_type, p_entity_id::text, p_entity_display,
      p_action, 'success',
      p_before, p_after, v_changed,
      p_reason, p_notes, p_correlation_id, 'rpc', 'omni_comms_template_catalogue'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'OC450 audit_write_failed' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;
END;
$$;
ALTER FUNCTION public.omni_comms_priv_write_template_audit(uuid,text,text,uuid,text,jsonb,jsonb,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_priv_write_template_audit(uuid,text,text,uuid,text,jsonb,jsonb,text,text,text) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC RPCs — TEMPLATE FAMILY
-- ═══════════════════════════════════════════════════════════════════════════

-- family_create
CREATE OR REPLACE FUNCTION public.omni_comms_template_family_create(
  p_code                text,
  p_name                text,
  p_description         text,
  p_scope_type          text,
  p_organization_id     uuid,
  p_department_id       uuid,
  p_event_definition_id uuid,
  p_correlation_id      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid;
  v_id  uuid;
  v_row public.omni_comms_template_family;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  IF p_scope_type IS NULL OR p_scope_type NOT IN ('organization','department','event') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='scope_type_invalid';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required';
  END IF;
  IF p_scope_type = 'department' THEN
    IF p_department_id IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_required';
    END IF;
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;
  IF p_scope_type = 'event' AND p_event_definition_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='event_definition_required';
  END IF;

  BEGIN
    INSERT INTO public.omni_comms_template_family
      (code, name, description, scope_type, organization_id, department_id, event_definition_id,
       status, created_by, updated_by)
    VALUES (p_code, p_name, p_description, p_scope_type, p_organization_id,
      CASE p_scope_type WHEN 'department' THEN p_department_id ELSE NULL END,
      CASE p_scope_type WHEN 'event' THEN p_event_definition_id ELSE NULL END,
      'draft', v_uid, v_uid)
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'OC409 duplicate_template_family_code' USING ERRCODE='P0001', DETAIL='duplicate_family_code';
    WHEN check_violation THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;

  SELECT * INTO v_row FROM public.omni_comms_template_family WHERE id = v_id;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'create', 'template_family', v_id, v_row.code,
    NULL, to_jsonb(v_row), NULL, NULL, p_correlation_id);

  RETURN jsonb_build_object(
    'id', v_row.id, 'code', v_row.code, 'name', v_row.name,
    'description', v_row.description, 'scope_type', v_row.scope_type,
    'organization_id', v_row.organization_id, 'department_id', v_row.department_id,
    'event_definition_id', v_row.event_definition_id, 'status', v_row.status,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at);
END;
$$;
ALTER FUNCTION public.omni_comms_template_family_create(text,text,text,text,uuid,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_family_create(text,text,text,text,uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_family_create(text,text,text,text,uuid,uuid,uuid,text) TO authenticated;

-- family_update (draft only, name/description)
CREATE OR REPLACE FUNCTION public.omni_comms_template_family_update(
  p_id                 uuid,
  p_name               text,
  p_description        text,
  p_expected_updated_at timestamptz,
  p_correlation_id     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid;
  v_before public.omni_comms_template_family;
  v_after  public.omni_comms_template_family;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  SELECT * INTO v_before FROM public.omni_comms_template_family WHERE id = p_id FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_family_not_found';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='family_not_draft';
  END IF;
  IF p_expected_updated_at IS DISTINCT FROM v_before.updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  UPDATE public.omni_comms_template_family
     SET name = COALESCE(p_name, name),
         description = p_description,
         updated_at = now(), updated_by = v_uid
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'update', 'template_family', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), NULL, NULL, p_correlation_id);
  RETURN jsonb_build_object(
    'id', v_after.id, 'code', v_after.code, 'name', v_after.name,
    'description', v_after.description, 'status', v_after.status,
    'updated_at', v_after.updated_at);
END;
$$;
ALTER FUNCTION public.omni_comms_template_family_update(uuid,text,text,timestamptz,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_family_update(uuid,text,text,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_family_update(uuid,text,text,timestamptz,text) TO authenticated;

-- family_activate (draft → active)
CREATE OR REPLACE FUNCTION public.omni_comms_template_family_activate(
  p_id uuid, p_reason text, p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_reason text;
  v_before public.omni_comms_template_family;
  v_after  public.omni_comms_template_family;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, false);
  SELECT * INTO v_before FROM public.omni_comms_template_family WHERE id = p_id FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_family_not_found';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='family_not_draft';
  END IF;
  UPDATE public.omni_comms_template_family
     SET status = 'active', activated_at = now(), activated_by = v_uid,
         updated_at = now(), updated_by = v_uid
   WHERE id = p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'activate', 'template_family', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), v_reason, NULL, p_correlation_id);
  RETURN jsonb_build_object('id', v_after.id, 'status', v_after.status, 'activated_at', v_after.activated_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_family_activate(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_family_activate(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_family_activate(uuid,text,text) TO authenticated;

-- family_retire
CREATE OR REPLACE FUNCTION public.omni_comms_template_family_retire(
  p_id uuid, p_reason text, p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_reason text;
  v_before public.omni_comms_template_family;
  v_after  public.omni_comms_template_family;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, true);
  SELECT * INTO v_before FROM public.omni_comms_template_family WHERE id = p_id FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_family_not_found';
  END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='family_already_retired';
  END IF;
  UPDATE public.omni_comms_template_family
     SET status='retired', retired_at=now(), retired_by=v_uid,
         retirement_reason=v_reason,
         updated_at=now(), updated_by=v_uid
   WHERE id = p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'retire', 'template_family', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), v_reason, NULL, p_correlation_id);
  RETURN jsonb_build_object('id', v_after.id, 'status', v_after.status, 'retired_at', v_after.retired_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_family_retire(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_family_retire(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_family_retire(uuid,text,text) TO authenticated;

-- family_list
CREATE OR REPLACE FUNCTION public.omni_comms_template_family_list(
  p_search text,
  p_status text,
  p_scope_type text,
  p_organization_id uuid,
  p_limit integer,
  p_offset integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit int; v_offset int; v_pattern text; v_items jsonb; v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_pattern := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
                    ELSE '%' || public.omni_comms_priv_escape_ilike(btrim(p_search)) || '%' END;

  WITH filtered AS (
    SELECT f.* FROM public.omni_comms_template_family f
     WHERE (p_status IS NULL OR f.status = p_status)
       AND (p_scope_type IS NULL OR f.scope_type = p_scope_type)
       AND (p_organization_id IS NULL OR f.organization_id = p_organization_id)
       AND (v_pattern IS NULL OR f.code ILIKE v_pattern ESCAPE '\' OR f.name ILIKE v_pattern ESCAPE '\')
  ), page AS (
    SELECT * FROM filtered ORDER BY updated_at DESC, id ASC LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'code', p.code, 'name', p.name, 'scope_type', p.scope_type,
      'status', p.status, 'organization_id', p.organization_id,
      'department_id', p.department_id, 'event_definition_id', p.event_definition_id,
      'updated_at', p.updated_at)), '[]'::jsonb),
      (SELECT count(*) FROM filtered)
    INTO v_items, v_total FROM page p;

  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
END; $$;
ALTER FUNCTION public.omni_comms_template_family_list(text,text,text,uuid,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_family_list(text,text,text,uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_family_list(text,text,text,uuid,integer,integer) TO authenticated;

-- family_get
CREATE OR REPLACE FUNCTION public.omni_comms_template_family_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE r public.omni_comms_template_family;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT * INTO r FROM public.omni_comms_template_family WHERE id = p_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_family_not_found';
  END IF;
  RETURN jsonb_build_object(
    'id', r.id, 'code', r.code, 'name', r.name, 'description', r.description,
    'scope_type', r.scope_type, 'status', r.status,
    'organization_id', r.organization_id, 'department_id', r.department_id,
    'event_definition_id', r.event_definition_id,
    'activated_at', r.activated_at, 'retired_at', r.retired_at,
    'retirement_reason', r.retirement_reason,
    'created_at', r.created_at, 'updated_at', r.updated_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_family_get(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_family_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_family_get(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC RPCs — TEMPLATE VERSION
-- ═══════════════════════════════════════════════════════════════════════════

-- version_create
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_create(
  p_template_family_id uuid,
  p_channel            text,
  p_locale             text,
  p_version_number     integer,
  p_content            jsonb,
  p_correlation_id     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_locale text; v_family public.omni_comms_template_family;
  v_id uuid; v_row public.omni_comms_template_version;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  IF p_channel NOT IN ('email','sms','in_app','push','whatsapp','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_unknown';
  END IF;
  v_locale := public.omni_comms_priv_normalize_locale(p_locale);
  PERFORM public.omni_comms_priv_validate_channel_content(p_channel, p_content);
  SELECT * INTO v_family FROM public.omni_comms_template_family WHERE id = p_template_family_id;
  IF v_family.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_family_not_found';
  END IF;
  IF v_family.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='family_retired';
  END IF;
  IF p_version_number IS NULL OR p_version_number <= 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='version_number_invalid';
  END IF;
  BEGIN
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, status,
       created_by, updated_by)
    VALUES (p_template_family_id, p_version_number, p_channel, v_locale, p_content, 'draft', v_uid, v_uid)
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'OC409 duplicate_template_version' USING ERRCODE='P0001', DETAIL='duplicate_version';
    WHEN check_violation THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;
  SELECT * INTO v_row FROM public.omni_comms_template_version WHERE id = v_id;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'create', 'template_version', v_id,
    v_family.code || ':' || v_row.channel || ':' || v_row.locale || ':v' || v_row.version_number,
    NULL,
    jsonb_build_object('id', v_row.id, 'template_family_id', v_row.template_family_id,
      'channel', v_row.channel, 'locale', v_row.locale, 'version_number', v_row.version_number,
      'status', v_row.status),
    NULL, NULL, p_correlation_id);
  RETURN jsonb_build_object(
    'id', v_row.id, 'template_family_id', v_row.template_family_id,
    'version_number', v_row.version_number, 'channel', v_row.channel,
    'locale', v_row.locale, 'status', v_row.status,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_version_create(uuid,text,text,integer,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_create(uuid,text,text,integer,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_create(uuid,text,text,integer,jsonb,text) TO authenticated;

-- version_update (draft only)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_update(
  p_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_before public.omni_comms_template_version; v_after public.omni_comms_template_version;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  SELECT * INTO v_before FROM public.omni_comms_template_version WHERE id = p_id FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='version_not_draft';
  END IF;
  IF p_expected_updated_at IS DISTINCT FROM v_before.updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  PERFORM public.omni_comms_priv_validate_channel_content(v_before.channel, p_content);
  UPDATE public.omni_comms_template_version
     SET content = p_content, updated_at = now(), updated_by = v_uid
   WHERE id = p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'update', 'template_version', p_id, v_after.channel || ':' || v_after.locale || ':v' || v_after.version_number,
    jsonb_build_object('id', v_before.id, 'status', v_before.status),
    jsonb_build_object('id', v_after.id,  'status', v_after.status),
    NULL, NULL, p_correlation_id);
  RETURN jsonb_build_object('id', v_after.id, 'status', v_after.status, 'updated_at', v_after.updated_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_version_update(uuid,jsonb,timestamptz,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_update(uuid,jsonb,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_update(uuid,jsonb,timestamptz,text) TO authenticated;

-- version_approve (draft → approved, independent approver, note → audit.notes)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_approve(
  p_id uuid,
  p_approval_note text,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_before public.omni_comms_template_version; v_after public.omni_comms_template_version;
  v_family public.omni_comms_template_family; v_checksum text; v_note text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('approve_templates');
  v_note := btrim(COALESCE(p_approval_note, ''));
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='approval_note_too_long';
  END IF;
  IF v_note = '' THEN v_note := NULL; END IF;
  SELECT * INTO v_before FROM public.omni_comms_template_version WHERE id = p_id FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='version_not_draft';
  END IF;
  IF v_before.created_by IS NOT NULL AND v_before.created_by = v_uid THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='approver_must_differ_from_author';
  END IF;
  SELECT * INTO v_family FROM public.omni_comms_template_family WHERE id = v_before.template_family_id;
  PERFORM public.omni_comms_priv_validate_channel_content(v_before.channel, v_before.content);
  v_checksum := public.omni_comms_priv_compute_template_checksum(
    v_family.code, v_before.version_number, v_before.channel, v_before.locale, v_before.content);
  UPDATE public.omni_comms_template_version
     SET status='approved', approved_at=now(), approved_by=v_uid,
         checksum=v_checksum, updated_at=now(), updated_by=v_uid
   WHERE id = p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'approve', 'template_version', p_id,
    v_family.code || ':' || v_after.channel || ':' || v_after.locale || ':v' || v_after.version_number,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'checksum', v_after.checksum),
    NULL, v_note, p_correlation_id);
  RETURN jsonb_build_object('id', v_after.id, 'status', v_after.status, 'checksum', v_after.checksum, 'approved_at', v_after.approved_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_version_approve(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_approve(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_approve(uuid,text,text) TO authenticated;

-- version_publish (approved → published; atomic replacement of prior published)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_publish(
  p_id uuid, p_reason text, p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_reason text;
  v_before public.omni_comms_template_version;
  v_after  public.omni_comms_template_version;
  v_family public.omni_comms_template_family;
  v_prev   public.omni_comms_template_version;
  v_replaced_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('approve_templates');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, false);
  -- Read the version briefly to identify family, then lock family row first
  SELECT * INTO v_before FROM public.omni_comms_template_version WHERE id = p_id;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found';
  END IF;
  PERFORM 1 FROM public.omni_comms_template_family WHERE id = v_before.template_family_id FOR UPDATE;
  SELECT * INTO v_family FROM public.omni_comms_template_family WHERE id = v_before.template_family_id;
  -- Re-read version under family lock, then take its row lock
  SELECT * INTO v_before FROM public.omni_comms_template_version WHERE id = p_id FOR UPDATE;
  IF v_before.status <> 'approved' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='version_not_approved';
  END IF;
  -- Lock existing published (if any) for exact (family, channel, locale)
  SELECT * INTO v_prev
    FROM public.omni_comms_template_version
   WHERE template_family_id = v_before.template_family_id
     AND channel = v_before.channel
     AND locale  = v_before.locale
     AND status  = 'published'
   FOR UPDATE;
  IF v_prev.id IS NOT NULL AND v_prev.id = v_before.id THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_published';
  END IF;
  IF v_prev.id IS NOT NULL THEN
    UPDATE public.omni_comms_template_version
       SET status='retired', retired_at=now(), retired_by=v_uid,
           retirement_reason=COALESCE(v_reason, 'replaced_by_new_publication'),
           updated_at=now(), updated_by=v_uid
     WHERE id = v_prev.id;
    v_replaced_id := v_prev.id;
    PERFORM public.omni_comms_priv_write_template_audit(
      v_uid, 'retire', 'template_version', v_prev.id,
      v_family.code || ':' || v_prev.channel || ':' || v_prev.locale || ':v' || v_prev.version_number,
      jsonb_build_object('status', v_prev.status),
      jsonb_build_object('status', 'retired', 'replaced_by', v_before.id),
      COALESCE(v_reason, 'replaced_by_new_publication'), NULL, p_correlation_id);
  END IF;
  UPDATE public.omni_comms_template_version
     SET status='published', published_at=now(), published_by=v_uid,
         updated_at=now(), updated_by=v_uid
   WHERE id = p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'publish', 'template_version', p_id,
    v_family.code || ':' || v_after.channel || ':' || v_after.locale || ':v' || v_after.version_number,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'replaced', v_replaced_id),
    v_reason, NULL, p_correlation_id);
  RETURN jsonb_build_object('id', v_after.id, 'status', v_after.status,
    'published_at', v_after.published_at, 'replaced_version_id', v_replaced_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 duplicate_publication' USING ERRCODE='P0001', DETAIL='publication_conflict';
END; $$;
ALTER FUNCTION public.omni_comms_template_version_publish(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_publish(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_publish(uuid,text,text) TO authenticated;

-- version_retire (approved/published → retired)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_retire(
  p_id uuid, p_reason text, p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_reason text; v_before public.omni_comms_template_version; v_after public.omni_comms_template_version;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, true);
  SELECT * INTO v_before FROM public.omni_comms_template_version WHERE id = p_id FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found';
  END IF;
  IF v_before.status NOT IN ('approved','published') THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='version_cannot_be_retired';
  END IF;
  UPDATE public.omni_comms_template_version
     SET status='retired', retired_at=now(), retired_by=v_uid,
         retirement_reason=v_reason, updated_at=now(), updated_by=v_uid
   WHERE id = p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'retire', 'template_version', p_id, v_after.channel || ':' || v_after.locale || ':v' || v_after.version_number,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status),
    v_reason, NULL, p_correlation_id);
  RETURN jsonb_build_object('id', v_after.id, 'status', v_after.status, 'retired_at', v_after.retired_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_version_retire(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_retire(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_retire(uuid,text,text) TO authenticated;

-- version_list (omits content)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_list(
  p_template_family_id uuid,
  p_channel text,
  p_locale  text,
  p_status  text,
  p_limit   integer,
  p_offset  integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_limit int; v_offset int; v_items jsonb; v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_template_family_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='template_family_id_required';
  END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  WITH filtered AS (
    SELECT v.* FROM public.omni_comms_template_version v
     WHERE v.template_family_id = p_template_family_id
       AND (p_channel IS NULL OR v.channel = p_channel)
       AND (p_locale  IS NULL OR v.locale  = p_locale)
       AND (p_status  IS NULL OR v.status  = p_status)
  ), page AS (
    SELECT * FROM filtered ORDER BY version_number DESC, id ASC LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'template_family_id', p.template_family_id,
      'version_number', p.version_number, 'channel', p.channel, 'locale', p.locale,
      'status', p.status, 'checksum', p.checksum,
      'approved_at', p.approved_at, 'published_at', p.published_at,
      'retired_at', p.retired_at, 'updated_at', p.updated_at)), '[]'::jsonb),
    (SELECT count(*) FROM filtered) INTO v_items, v_total FROM page p;
  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
END; $$;
ALTER FUNCTION public.omni_comms_template_version_list(uuid,text,text,text,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_list(uuid,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_list(uuid,text,text,text,integer,integer) TO authenticated;

-- version_get (includes content)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE r public.omni_comms_template_version;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT * INTO r FROM public.omni_comms_template_version WHERE id = p_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found';
  END IF;
  RETURN jsonb_build_object(
    'id', r.id, 'template_family_id', r.template_family_id,
    'version_number', r.version_number, 'channel', r.channel, 'locale', r.locale,
    'status', r.status, 'checksum', r.checksum, 'content', r.content,
    'approved_at', r.approved_at, 'published_at', r.published_at,
    'retired_at', r.retired_at, 'retirement_reason', r.retirement_reason,
    'created_at', r.created_at, 'updated_at', r.updated_at);
END; $$;
ALTER FUNCTION public.omni_comms_template_version_get(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_get(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC RPC — RESOLVE PUBLISHED TEMPLATE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_template_resolve_published(
  p_event_definition_id uuid,
  p_organization_id     uuid,
  p_department_id       uuid,
  p_channel             text,
  p_locale              text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_locale text;
  v_family_id uuid; v_version_id uuid; v_scope text;
  v_family public.omni_comms_template_family;
  v_version public.omni_comms_template_version;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required';
  END IF;
  IF p_channel NOT IN ('email','sms','in_app','push','whatsapp','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_unknown';
  END IF;
  v_locale := public.omni_comms_priv_normalize_locale(p_locale);
  IF p_department_id IS NOT NULL THEN
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  -- Precedence: event (3) > department (2) > organization (1)
  SELECT f.id, v.id,
         CASE f.scope_type WHEN 'event' THEN 3 WHEN 'department' THEN 2 ELSE 1 END
    INTO v_family_id, v_version_id, v_scope
    FROM public.omni_comms_template_family f
    JOIN public.omni_comms_template_version v ON v.template_family_id = f.id
   WHERE f.status = 'active'
     AND f.organization_id = p_organization_id
     AND v.status = 'published'
     AND v.channel = p_channel
     AND v.locale  = v_locale
     AND (
       (f.scope_type = 'event' AND p_event_definition_id IS NOT NULL
          AND f.event_definition_id = p_event_definition_id)
       OR (f.scope_type = 'department' AND p_department_id IS NOT NULL
          AND f.department_id = p_department_id)
       OR (f.scope_type = 'organization')
     )
   ORDER BY CASE f.scope_type WHEN 'event' THEN 3 WHEN 'department' THEN 2 ELSE 1 END DESC,
            v.version_number DESC
   LIMIT 1;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='no_published_template';
  END IF;

  SELECT * INTO v_family  FROM public.omni_comms_template_family  WHERE id = v_family_id;
  SELECT * INTO v_version FROM public.omni_comms_template_version WHERE id = v_version_id;

  RETURN jsonb_build_object(
    'template_family_id', v_family.id,
    'family_code',        v_family.code,
    'scope_type',         v_family.scope_type,
    'template_version_id', v_version.id,
    'version_number',     v_version.version_number,
    'channel',            v_version.channel,
    'locale',             v_version.locale,
    'checksum',           v_version.checksum,
    'content',            v_version.content);
END; $$;
ALTER FUNCTION public.omni_comms_template_resolve_published(uuid,uuid,uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_resolve_published(uuid,uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_resolve_published(uuid,uuid,uuid,text,text) TO authenticated;