-- Omni-Comms — Template layout selection: response contracts, setter hardening,
-- and bounded published-layout-version listing. No enforcement is weakened.

-- 1. Channel <-> layout_kind compatibility helper (private)
CREATE OR REPLACE FUNCTION public.omni_comms_priv_layout_kind_matches_channel(p_layout_kind text, p_channel text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE
    WHEN p_layout_kind IS NULL THEN true
    WHEN upper(p_layout_kind) = upper(p_channel) THEN true
    WHEN upper(p_channel) = 'PRINT' AND upper(p_layout_kind) IN ('LETTER','LETTERHEAD','NOTICE','STATEMENT','CERTIFICATE','REPORT','RECEIPT') THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_layout_kind_matches_channel(text, text) FROM PUBLIC;

-- 2. Validity expression helper (private, read-only)
CREATE OR REPLACE FUNCTION public.omni_comms_priv_layout_selection_valid(
  p_mode text, p_layout_id uuid, p_pinned_layout_version_id uuid, p_channel text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE v_kind text; v_active boolean; v_pv_layout uuid; v_pv_status text;
BEGIN
  IF p_mode IS NULL OR p_layout_id IS NULL THEN RETURN false; END IF;
  IF p_mode NOT IN ('resolved_default','pinned') THEN RETURN false; END IF;
  SELECT l.layout_kind, l.is_active INTO v_kind, v_active
    FROM public.core_template_layout l WHERE l.id = p_layout_id;
  IF NOT FOUND OR COALESCE(v_active,false) = false THEN RETURN false; END IF;
  IF NOT public.omni_comms_priv_layout_kind_matches_channel(v_kind, p_channel) THEN RETURN false; END IF;
  IF p_mode = 'pinned' THEN
    IF p_pinned_layout_version_id IS NULL THEN RETURN false; END IF;
    SELECT lv.layout_id, lv.status INTO v_pv_layout, v_pv_status
      FROM public.core_template_layout_version lv WHERE lv.id = p_pinned_layout_version_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_pv_layout IS DISTINCT FROM p_layout_id THEN RETURN false; END IF;
    IF v_pv_status <> 'published' THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_layout_selection_valid(text, uuid, uuid, text) FROM PUBLIC;

-- 3. version_get — add layout selection fields (additive only)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.omni_comms_template_version; v_layout_name text; v_layout_code text; v_pv_num int;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT * INTO r FROM public.omni_comms_template_version WHERE id = p_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found';
  END IF;
  SELECT l.name, l.code INTO v_layout_name, v_layout_code
    FROM public.core_template_layout l WHERE l.id = r.layout_id;
  SELECT lv.version_number INTO v_pv_num
    FROM public.core_template_layout_version lv WHERE lv.id = r.pinned_layout_version_id;
  RETURN jsonb_build_object(
    'id', r.id, 'template_family_id', r.template_family_id,
    'version_number', r.version_number, 'channel', r.channel, 'locale', r.locale,
    'status', r.status, 'checksum', r.checksum, 'content', r.content,
    'approved_at', r.approved_at, 'published_at', r.published_at,
    'retired_at', r.retired_at, 'retirement_reason', r.retirement_reason,
    'created_at', r.created_at, 'updated_at', r.updated_at,
    'layout_selection_mode', r.layout_selection_mode,
    'layout_id', r.layout_id,
    'pinned_layout_version_id', r.pinned_layout_version_id,
    'layout_name', v_layout_name,
    'layout_code', v_layout_code,
    'pinned_layout_version_number', v_pv_num,
    'layout_selection_valid', public.omni_comms_priv_layout_selection_valid(
      r.layout_selection_mode, r.layout_id, r.pinned_layout_version_id, r.channel));
END; $function$;

-- 4. version_list — add layout selection fields (additive only)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_list(
  p_template_family_id uuid, p_channel text, p_locale text, p_status text, p_limit integer, p_offset integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      'retired_at', p.retired_at, 'updated_at', p.updated_at,
      'layout_selection_mode', p.layout_selection_mode,
      'layout_id', p.layout_id,
      'pinned_layout_version_id', p.pinned_layout_version_id,
      'layout_name', l.name,
      'layout_code', l.code,
      'pinned_layout_version_number', lv.version_number,
      'layout_selection_valid', public.omni_comms_priv_layout_selection_valid(
        p.layout_selection_mode, p.layout_id, p.pinned_layout_version_id, p.channel))
      ORDER BY p.version_number DESC, p.id ASC), '[]'::jsonb),
    (SELECT count(*) FROM filtered) INTO v_items, v_total
  FROM page p
  LEFT JOIN public.core_template_layout l ON l.id = p.layout_id
  LEFT JOIN public.core_template_layout_version lv ON lv.id = p.pinned_layout_version_id;
  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
END; $function$;

-- 5. Setter hardening — controlled, explicit layout validation (adds checks only)
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_set_layout_selection(
  p_version_id uuid, p_mode text, p_layout_id uuid, p_pinned_layout_version_id uuid,
  p_expected_updated_at timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid; v_row public.omni_comms_template_version;
  v_kind text; v_active boolean; v_pv_layout uuid; v_pv_status text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  SELECT * INTO v_row FROM public.omni_comms_template_version WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='version_not_found'; END IF;
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='not_draft';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrency_conflict' USING ERRCODE='P0001', DETAIL='stale_template_version';
  END IF;
  IF p_mode NOT IN ('resolved_default','pinned') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_mode';
  END IF;
  IF p_layout_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_required';
  END IF;

  SELECT l.layout_kind, l.is_active INTO v_kind, v_active
    FROM public.core_template_layout l WHERE l.id = p_layout_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='layout_not_found';
  END IF;
  IF COALESCE(v_active, false) = false THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_not_active';
  END IF;
  IF NOT public.omni_comms_priv_layout_kind_matches_channel(v_kind, v_row.channel) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_channel_mismatch';
  END IF;

  IF p_mode = 'pinned' THEN
    IF p_pinned_layout_version_id IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_version_required';
    END IF;
    SELECT lv.layout_id, lv.status INTO v_pv_layout, v_pv_status
      FROM public.core_template_layout_version lv WHERE lv.id = p_pinned_layout_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='layout_version_not_found';
    END IF;
    IF v_pv_layout IS DISTINCT FROM p_layout_id THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_version_mismatch';
    END IF;
    IF v_pv_status <> 'published' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_version_not_published';
    END IF;
  END IF;

  UPDATE public.omni_comms_template_version
    SET layout_selection_mode = p_mode,
        layout_id = p_layout_id,
        pinned_layout_version_id = CASE WHEN p_mode = 'pinned' THEN p_pinned_layout_version_id ELSE NULL END,
        updated_at = now(), updated_by = v_uid
    WHERE id = p_version_id;
  RETURN jsonb_build_object('id', p_version_id, 'ok', true);
END;$function$;

-- 6. Bounded, read-only published layout version listing
CREATE OR REPLACE FUNCTION public.core_template_layout_version_list_published(
  p_layout_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, layout_id uuid, version_number integer, status text,
              checksum text, published_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_limit int; v_offset int;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_layout_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='layout_required';
  END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  RETURN QUERY
    SELECT lv.id, lv.layout_id, lv.version_number, lv.status, lv.checksum, lv.published_at
      FROM public.core_template_layout_version lv
     WHERE lv.layout_id = p_layout_id AND lv.status = 'published'
     ORDER BY lv.version_number DESC
     LIMIT v_limit OFFSET v_offset;
END;$function$;

ALTER FUNCTION public.core_template_layout_version_list_published(uuid, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_template_layout_version_list_published(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.core_template_layout_version_list_published(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.core_template_layout_version_list_published(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.core_template_layout_version_list_published(uuid, integer, integer) TO service_role;