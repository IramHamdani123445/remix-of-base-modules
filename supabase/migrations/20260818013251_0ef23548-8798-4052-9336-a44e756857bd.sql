-- =====================================================================
-- Omni-Comms: enterprise presentation inheritance
--   organisation → module → department×module → module+event → dept×module+event
-- =====================================================================

ALTER TABLE public.core_comm_assignment
  ADD COLUMN IF NOT EXISTS module_code text,
  ADD COLUMN IF NOT EXISTS event_code text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_comm_assignment_scope_chk') THEN
    ALTER TABLE public.core_comm_assignment
      ADD CONSTRAINT core_comm_assignment_scope_chk
      CHECK (event_code IS NULL OR module_code IS NOT NULL);
  END IF;
END $$;

DROP INDEX IF EXISTS public.core_comm_assignment_org_layout_default_uq;
DROP INDEX IF EXISTS public.core_comm_assignment_dept_layout_override_uq;
DROP INDEX IF EXISTS public.core_comm_assignment_org_asset_slot_uq;
DROP INDEX IF EXISTS public.core_comm_assignment_dept_asset_slot_uq;

CREATE UNIQUE INDEX IF NOT EXISTS core_comm_assignment_scope_uq
  ON public.core_comm_assignment (
    organization_id,
    output_channel,
    assignment_kind,
    coalesce(module_code, ''),
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(event_code, ''),
    coalesce(slot_code, '')
  );

-- scope naming + precedence rank (single source of truth)
CREATE OR REPLACE FUNCTION public.omni_comms_priv_scope_level(
  p_module_code text, p_department_id uuid, p_event_code text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_event_code IS NOT NULL AND p_department_id IS NOT NULL THEN 'department_module_event'
    WHEN p_event_code IS NOT NULL THEN 'module_event'
    WHEN p_department_id IS NOT NULL AND p_module_code IS NOT NULL THEN 'department_module'
    WHEN p_department_id IS NOT NULL THEN 'department'
    WHEN p_module_code IS NOT NULL THEN 'module'
    ELSE 'organization'
  END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_scope_rank(
  p_module_code text, p_department_id uuid, p_event_code text
) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE public.omni_comms_priv_scope_level(p_module_code, p_department_id, p_event_code)
    WHEN 'department_module_event' THEN 60
    WHEN 'module_event'            THEN 50
    WHEN 'department_module'       THEN 40
    WHEN 'department'              THEN 30
    WHEN 'module'                  THEN 20
    ELSE 10
  END;
$$;

-- change history
CREATE TABLE IF NOT EXISTS public.omni_comms_presentation_assignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid,
  organization_id uuid NOT NULL,
  output_channel text NOT NULL,
  assignment_kind text NOT NULL,
  slot_code text,
  module_code text,
  department_id uuid,
  event_code text,
  scope_level text NOT NULL,
  action text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.omni_comms_presentation_assignment_audit TO service_role;
REVOKE ALL ON public.omni_comms_presentation_assignment_audit FROM PUBLIC, anon, authenticated;
ALTER TABLE public.omni_comms_presentation_assignment_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_presentation_assignment_audit FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- Resolver: per-property inheritance with source trace
-- =====================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_resolve_presentation(
  p_organization_id uuid,
  p_output_channel text,
  p_module_code text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_event_code text DEFAULT NULL,
  p_pinned_layout_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_layout_id uuid; v_layout_source text; v_layout_scope text;
  v_layout_version_id uuid; v_slots jsonb;
  v_slot jsonb; v_slot_code text; v_row record;
  v_resolved jsonb := '[]'::jsonb;
  v_asset public.core_comm_asset; v_av public.core_comm_asset_version;
  v_trace jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  IF p_department_id IS NOT NULL THEN
    PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  IF p_pinned_layout_id IS NOT NULL THEN
    v_layout_id := p_pinned_layout_id;
    v_layout_source := 'pinned';
    v_layout_scope := 'pinned';
  ELSE
    SELECT a.layout_id,
           public.omni_comms_priv_scope_level(a.module_code, a.department_id, a.event_code)
      INTO v_layout_id, v_layout_scope
    FROM public.core_comm_assignment a
    WHERE a.organization_id = p_organization_id
      AND a.output_channel = p_output_channel
      AND a.assignment_kind = 'layout_default'
      AND (a.module_code IS NULL OR a.module_code = p_module_code)
      AND (a.department_id IS NULL OR a.department_id = p_department_id)
      AND (a.event_code IS NULL OR a.event_code = p_event_code)
    ORDER BY public.omni_comms_priv_scope_rank(a.module_code, a.department_id, a.event_code) DESC,
             a.updated_at DESC
    LIMIT 1;
    v_layout_source := v_layout_scope;
  END IF;

  IF v_layout_id IS NOT NULL THEN
    SELECT id, slots INTO v_layout_version_id, v_slots
    FROM public.core_template_layout_version
    WHERE layout_id = v_layout_id AND status = 'published'
    ORDER BY version_number DESC LIMIT 1;
  END IF;

  v_trace := v_trace || jsonb_build_object(
    'property', 'layout', 'value_id', v_layout_id,
    'source_scope', coalesce(v_layout_scope, 'unresolved'));

  IF v_slots IS NOT NULL THEN
    FOR v_slot IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
      v_slot_code := v_slot->>'code';
      CONTINUE WHEN v_slot_code = 'content_body';

      SELECT a.asset_id,
             public.omni_comms_priv_scope_level(a.module_code, a.department_id, a.event_code) AS scope_level
        INTO v_row
      FROM public.core_comm_assignment a
      WHERE a.organization_id = p_organization_id
        AND a.output_channel = p_output_channel
        AND a.assignment_kind = 'asset_slot'
        AND a.slot_code = v_slot_code
        AND (a.module_code IS NULL OR a.module_code = p_module_code)
        AND (a.department_id IS NULL OR a.department_id = p_department_id)
        AND (a.event_code IS NULL OR a.event_code = p_event_code)
      ORDER BY public.omni_comms_priv_scope_rank(a.module_code, a.department_id, a.event_code) DESC,
               a.updated_at DESC
      LIMIT 1;

      IF v_row.asset_id IS NOT NULL THEN
        SELECT * INTO v_asset FROM public.core_comm_asset WHERE id = v_row.asset_id;
        SELECT * INTO v_av FROM public.core_comm_asset_version WHERE id = v_asset.active_version_id;
        v_resolved := v_resolved || jsonb_build_object(
          'slot', v_slot_code, 'asset_id', v_asset.id, 'asset_version_id', v_av.id,
          'asset_type', v_asset.asset_type,
          'inheritance_source', v_row.scope_level,
          'source_scope', v_row.scope_level,
          'content_html', v_av.content_html, 'content_text', v_av.content_text,
          'checksum', v_av.checksum);
        v_trace := v_trace || jsonb_build_object(
          'property', v_slot_code, 'value_id', v_asset.id, 'source_scope', v_row.scope_level);
      ELSE
        v_resolved := v_resolved || jsonb_build_object(
          'slot', v_slot_code, 'asset_id', null, 'asset_version_id', null,
          'asset_type', null, 'inheritance_source', 'unresolved', 'source_scope', 'unresolved');
        v_trace := v_trace || jsonb_build_object(
          'property', v_slot_code, 'value_id', null, 'source_scope', 'unresolved');
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'resolver_version', 'presentation.v2',
    'organization_id', p_organization_id,
    'module_code', p_module_code,
    'department_id', p_department_id,
    'event_code', p_event_code,
    'output_channel', p_output_channel,
    'layout_id', v_layout_id,
    'layout_version_id', v_layout_version_id,
    'layout_inheritance_source', coalesce(v_layout_source, 'unresolved'),
    'layout_slots', v_slots,
    'resolved_assets', v_resolved,
    'trace', v_trace);
END;$$;
ALTER FUNCTION public.omni_comms_resolve_presentation(uuid, text, text, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_resolve_presentation(uuid, text, text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_resolve_presentation(uuid, text, text, uuid, text, uuid) TO authenticated;

-- =====================================================================
-- Scoped render manifest (content + presentation)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_resolve_render_manifest_scoped(
  p_template_version_id uuid,
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_module_code text DEFAULT NULL,
  p_event_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tv public.omni_comms_template_version;
  v_pres jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT * INTO v_tv FROM public.omni_comms_template_version WHERE id = p_template_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='version_not_found';
  END IF;

  v_pres := public.omni_comms_resolve_presentation(
    p_organization_id, v_tv.channel, p_module_code, p_department_id, p_event_code,
    CASE WHEN v_tv.layout_selection_mode = 'pinned' THEN v_tv.layout_id ELSE NULL END);

  RETURN jsonb_build_object(
    'template_family_id', v_tv.template_family_id,
    'template_version_id', v_tv.id,
    'template_content', v_tv.content,
    'template_channel', v_tv.channel,
    'template_locale', v_tv.locale,
    'layout_id', v_pres->'layout_id',
    'layout_version_id', v_pres->'layout_version_id',
    'layout_inheritance_source', v_pres->>'layout_inheritance_source',
    'layout_slots', v_pres->'layout_slots',
    'resolved_assets', v_pres->'resolved_assets',
    'resolver_version', v_pres->>'resolver_version',
    'trace', v_pres->'trace');
END;$$;
ALTER FUNCTION public.omni_comms_resolve_render_manifest_scoped(uuid, uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_resolve_render_manifest_scoped(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_resolve_render_manifest_scoped(uuid, uuid, uuid, text, text) TO authenticated;

-- =====================================================================
-- Governed administration RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION public.omni_comms_assignment_list_scoped(
  p_organization_id uuid,
  p_output_channel text DEFAULT 'email'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.scope_rank DESC, x.slot_code NULLS FIRST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT a.id, a.organization_id, a.output_channel, a.assignment_kind, a.slot_code,
           a.module_code, a.department_id, a.event_code, a.layout_id, a.asset_id, a.updated_at,
           public.omni_comms_priv_scope_level(a.module_code, a.department_id, a.event_code) AS scope_level,
           public.omni_comms_priv_scope_rank(a.module_code, a.department_id, a.event_code) AS scope_rank
    FROM public.core_comm_assignment a
    WHERE a.organization_id = p_organization_id
      AND a.output_channel = p_output_channel
  ) x;
  RETURN v_rows;
END;$$;
ALTER FUNCTION public.omni_comms_assignment_list_scoped(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_assignment_list_scoped(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_assignment_list_scoped(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_assignment_upsert_scoped(
  p_organization_id uuid,
  p_output_channel text,
  p_assignment_kind text,
  p_slot_code text DEFAULT NULL,
  p_module_code text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_event_code text DEFAULT NULL,
  p_layout_id uuid DEFAULT NULL,
  p_asset_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_prev jsonb; v_scope text;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('configure');
  IF p_event_code IS NOT NULL AND p_module_code IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='event_scope_requires_module';
  END IF;
  IF p_department_id IS NOT NULL THEN
    PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;
  v_scope := public.omni_comms_priv_scope_level(p_module_code, p_department_id, p_event_code);

  SELECT id, jsonb_build_object('layout_id', layout_id, 'asset_id', asset_id)
    INTO v_id, v_prev
  FROM public.core_comm_assignment
  WHERE organization_id = p_organization_id
    AND output_channel = p_output_channel
    AND assignment_kind = p_assignment_kind
    AND coalesce(module_code,'') = coalesce(p_module_code,'')
    AND coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_department_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND coalesce(event_code,'') = coalesce(p_event_code,'')
    AND coalesce(slot_code,'') = coalesce(p_slot_code,'');

  IF v_id IS NULL THEN
    INSERT INTO public.core_comm_assignment (
      organization_id, department_id, module_code, event_code,
      output_channel, assignment_kind, slot_code, layout_id, asset_id, created_by, updated_by)
    VALUES (p_organization_id, p_department_id, p_module_code, p_event_code,
      p_output_channel, p_assignment_kind, p_slot_code, p_layout_id, p_asset_id, auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.core_comm_assignment
      SET layout_id = p_layout_id, asset_id = p_asset_id, updated_by = auth.uid(), updated_at = now()
    WHERE id = v_id;
  END IF;

  INSERT INTO public.omni_comms_presentation_assignment_audit (
    assignment_id, organization_id, output_channel, assignment_kind, slot_code,
    module_code, department_id, event_code, scope_level, action, previous_value, new_value, actor_id)
  VALUES (v_id, p_organization_id, p_output_channel, p_assignment_kind, p_slot_code,
    p_module_code, p_department_id, p_event_code, v_scope,
    CASE WHEN v_prev IS NULL THEN 'created' ELSE 'updated' END, v_prev,
    jsonb_build_object('layout_id', p_layout_id, 'asset_id', p_asset_id), auth.uid());

  RETURN v_id;
END;$$;
ALTER FUNCTION public.omni_comms_assignment_upsert_scoped(uuid, text, text, text, text, uuid, text, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_assignment_upsert_scoped(uuid, text, text, text, text, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_assignment_upsert_scoped(uuid, text, text, text, text, uuid, text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_assignment_reset_scoped(
  p_organization_id uuid,
  p_output_channel text,
  p_assignment_kind text,
  p_slot_code text DEFAULT NULL,
  p_module_code text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_event_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_prev jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('configure');
  IF p_module_code IS NULL AND p_department_id IS NULL AND p_event_code IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organisation_default_cannot_be_reset';
  END IF;

  SELECT id, jsonb_build_object('layout_id', layout_id, 'asset_id', asset_id)
    INTO v_id, v_prev
  FROM public.core_comm_assignment
  WHERE organization_id = p_organization_id
    AND output_channel = p_output_channel
    AND assignment_kind = p_assignment_kind
    AND coalesce(module_code,'') = coalesce(p_module_code,'')
    AND coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_department_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND coalesce(event_code,'') = coalesce(p_event_code,'')
    AND coalesce(slot_code,'') = coalesce(p_slot_code,'');

  IF v_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.core_comm_assignment WHERE id = v_id;

  INSERT INTO public.omni_comms_presentation_assignment_audit (
    assignment_id, organization_id, output_channel, assignment_kind, slot_code,
    module_code, department_id, event_code, scope_level, action, previous_value, new_value, actor_id)
  VALUES (v_id, p_organization_id, p_output_channel, p_assignment_kind, p_slot_code,
    p_module_code, p_department_id, p_event_code,
    public.omni_comms_priv_scope_level(p_module_code, p_department_id, p_event_code),
    'reset', v_prev, NULL, auth.uid());

  RETURN true;
END;$$;
ALTER FUNCTION public.omni_comms_assignment_reset_scoped(uuid, text, text, text, text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_assignment_reset_scoped(uuid, text, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_assignment_reset_scoped(uuid, text, text, text, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_assignment_history(
  p_organization_id uuid,
  p_output_channel text DEFAULT 'email',
  p_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT id, assignment_kind, slot_code, module_code, department_id, event_code,
           scope_level, action, previous_value, new_value, created_at
    FROM public.omni_comms_presentation_assignment_audit
    WHERE organization_id = p_organization_id AND output_channel = p_output_channel
    ORDER BY created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
  ) x;
  RETURN v_rows;
END;$$;
ALTER FUNCTION public.omni_comms_assignment_history(uuid, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_assignment_history(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_assignment_history(uuid, text, integer) TO authenticated;