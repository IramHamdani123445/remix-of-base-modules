
-- ─── 1. Extend existing communication action table ──────────────────────────
ALTER TABLE public.omni_comms_communication_action
  ALTER COLUMN event_definition_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_communication_action
    ADD CONSTRAINT omni_comms_communication_action_org_code_key UNIQUE (organization_id, code);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON public.omni_comms_communication_action TO authenticated;
GRANT ALL ON public.omni_comms_communication_action TO service_role;

ALTER TABLE public.omni_comms_template_family
  ADD COLUMN IF NOT EXISTS communication_action_id uuid NULL
    REFERENCES public.omni_comms_communication_action(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS omni_comms_template_family_action_idx
  ON public.omni_comms_template_family(communication_action_id);

-- Backfill: one governed action per existing family (identity preserved)
WITH src AS (
  SELECT f.id AS family_id, f.organization_id, f.event_definition_id, f.name,
         f.description, f.status, f.created_by, f.updated_by, f.created_at,
         CASE WHEN upper(regexp_replace(f.code, '[^A-Za-z0-9_]', '_', 'g')) ~ '^[A-Z]'
              THEN left(upper(regexp_replace(f.code, '[^A-Za-z0-9_]', '_', 'g')), 70)
              ELSE left('A_' || upper(regexp_replace(f.code, '[^A-Za-z0-9_]', '_', 'g')), 70)
         END AS base_code
    FROM public.omni_comms_template_family f
   WHERE f.communication_action_id IS NULL
), numbered AS (
  SELECT s.*, row_number() OVER (PARTITION BY s.organization_id, s.base_code
                                 ORDER BY s.created_at, s.family_id) AS rn
    FROM src s
), final AS (
  SELECT n.*, CASE WHEN n.rn = 1 THEN n.base_code ELSE n.base_code || '_' || n.rn END AS action_code
    FROM numbered n
), ins AS (
  INSERT INTO public.omni_comms_communication_action
    (organization_id, event_definition_id, code, name, description, status,
     obligation, satisfaction_rule, created_by, updated_by)
  SELECT f.organization_id, f.event_definition_id, f.action_code, f.name, f.description,
         CASE WHEN f.status = 'retired' THEN 'retired' ELSE 'active' END,
         'optional', 'one_of', f.created_by, f.updated_by
    FROM final f
  ON CONFLICT (organization_id, code) DO NOTHING
  RETURNING id, organization_id, code
)
UPDATE public.omni_comms_template_family tf
   SET communication_action_id = a.id
  FROM final f
  JOIN public.omni_comms_communication_action a
    ON a.organization_id = f.organization_id AND a.code = f.action_code
 WHERE tf.id = f.family_id
   AND tf.communication_action_id IS NULL;

-- ─── 2. Business object governance fields ───────────────────────────────────
ALTER TABLE public.omni_comms_business_object
  ADD COLUMN IF NOT EXISTS description text NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_business_object
    ADD CONSTRAINT omni_comms_business_object_status_chk
    CHECK (status IN ('active','retired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_business_object
    ADD CONSTRAINT omni_comms_business_object_module_code_key UNIQUE (module_code, code);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON public.omni_comms_business_object TO authenticated;
GRANT ALL ON public.omni_comms_business_object TO service_role;

-- ─── 3. Business object RPCs ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_business_object_list(
  p_module_code text DEFAULT NULL,
  p_include_retired boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', b.id, 'module_code', b.module_code, 'code', b.code,
           'name', b.name, 'description', b.description,
           'display_order', b.display_order, 'status', b.status,
           'updated_at', b.updated_at)
         ORDER BY b.module_code, b.display_order, b.name), '[]'::jsonb)
    INTO v
    FROM public.omni_comms_business_object b
   WHERE (p_module_code IS NULL OR b.module_code = p_module_code)
     AND (p_include_retired OR b.status = 'active');
  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_business_object_create(
  p_module_code text, p_code text, p_name text,
  p_display_order integer DEFAULT 1000,
  p_description text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_business_object;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF btrim(COALESCE(p_module_code,'')) = '' OR btrim(COALESCE(p_code,'')) = ''
     OR btrim(COALESCE(p_name,'')) = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='module_code_code_name_required';
  END IF;
  IF upper(btrim(p_code)) !~ '^[A-Z0-9_]+$' OR upper(btrim(p_module_code)) !~ '^[A-Z0-9_]+$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='code_format_invalid';
  END IF;
  BEGIN
    INSERT INTO public.omni_comms_business_object
      (module_code, code, name, description, display_order, status, created_by, updated_by)
    VALUES (upper(btrim(p_module_code)), upper(btrim(p_code)), btrim(p_name),
            NULLIF(btrim(COALESCE(p_description,'')),''),
            COALESCE(p_display_order, 1000), 'active', v_uid, v_uid)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 duplicate_business_object' USING ERRCODE='P0001', DETAIL=p_code;
  END;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'create', 'business_object', v_row.id, v_row.module_code || '.' || v_row.code,
    NULL, to_jsonb(v_row), p_correlation_id);
  RETURN to_jsonb(v_row);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_business_object_update(
  p_id uuid, p_name text DEFAULT NULL, p_display_order integer DEFAULT NULL,
  p_description text DEFAULT NULL, p_status text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_before public.omni_comms_business_object; v_after public.omni_comms_business_object;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_before FROM public.omni_comms_business_object WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='business_object';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','retired') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='status_invalid';
  END IF;
  UPDATE public.omni_comms_business_object
     SET name = COALESCE(NULLIF(btrim(COALESCE(p_name,'')),''), name),
         display_order = COALESCE(p_display_order, display_order),
         description = COALESCE(p_description, description),
         status = COALESCE(p_status, status),
         updated_by = v_uid, updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'update', 'business_object', p_id, v_after.module_code || '.' || v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN to_jsonb(v_after);
END; $function$;

-- ─── 4. Event definition: business object classification + ordering ─────────
DROP FUNCTION IF EXISTS public.omni_comms_event_definition_create(text,text,text,text,text,text,text,text);
CREATE FUNCTION public.omni_comms_event_definition_create(
  p_code text, p_module_code text, p_entity_type text, p_name text,
  p_description text, p_communication_class text, p_default_priority text,
  p_correlation_id text,
  p_business_object_code text DEFAULT NULL,
  p_display_order integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_id uuid; v_cons text; v_bo text; v_module text; v_code text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_module := upper(btrim(COALESCE(p_module_code,'')));
  v_bo := NULLIF(upper(btrim(COALESCE(p_business_object_code, p_entity_type, ''))), '');
  v_code := upper(btrim(COALESCE(p_code,'')));
  IF v_bo IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='business_object_required';
  END IF;
  IF split_part(v_code,'.',3) = '' OR split_part(v_code,'.',1) <> v_module
     OR split_part(v_code,'.',2) <> v_bo THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='code_must_be_module_object_action';
  END IF;
  BEGIN
    INSERT INTO public.omni_comms_event_definition
      (code, module_code, entity_type, business_object_code, display_order, name, description,
       communication_class, default_priority, status, created_by, updated_by)
    VALUES
      (v_code, v_module, v_bo, v_bo, COALESCE(p_display_order, 1000), p_name, p_description,
       p_communication_class, COALESCE(p_default_priority, 'normal'), 'draft', v_uid, v_uid)
    RETURNING id INTO v_id;
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
    v_uid, 'create', 'event_definition', v_id, v_code, NULL,
    jsonb_build_object('code', v_code, 'module_code', v_module,
                       'business_object_code', v_bo,
                       'display_order', COALESCE(p_display_order,1000),
                       'name', p_name, 'communication_class', p_communication_class,
                       'default_priority', COALESCE(p_default_priority,'normal'),
                       'status','draft'),
    p_correlation_id);
  RETURN v_id;
END; $function$;

DROP FUNCTION IF EXISTS public.omni_comms_event_definition_update_draft(uuid,timestamptz,text,text,text,text,text,text,text,text);
CREATE FUNCTION public.omni_comms_event_definition_update_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_code text, p_module_code text,
  p_entity_type text, p_name text, p_description text, p_communication_class text,
  p_default_priority text, p_correlation_id text,
  p_business_object_code text DEFAULT NULL,
  p_display_order integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_before public.omni_comms_event_definition; v_after public.omni_comms_event_definition;
        v_cons text; v_bo text; v_module text; v_code text;
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
  v_module := upper(btrim(COALESCE(p_module_code, v_before.module_code)));
  v_bo := NULLIF(upper(btrim(COALESCE(p_business_object_code, p_entity_type, v_before.business_object_code, ''))), '');
  v_code := upper(btrim(COALESCE(p_code, v_before.code)));
  IF v_bo IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='business_object_required';
  END IF;
  IF split_part(v_code,'.',3) = '' OR split_part(v_code,'.',1) <> v_module
     OR split_part(v_code,'.',2) <> v_bo THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='code_must_be_module_object_action';
  END IF;
  BEGIN
    UPDATE public.omni_comms_event_definition
       SET code = v_code, module_code = v_module,
           entity_type = v_bo, business_object_code = v_bo,
           display_order = COALESCE(p_display_order, display_order),
           name = p_name, description = p_description,
           communication_class = p_communication_class,
           default_priority = COALESCE(p_default_priority, default_priority),
           updated_by = v_uid, updated_at = now()
     WHERE id = p_id RETURNING * INTO v_after;
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
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $function$;

DROP FUNCTION IF EXISTS public.omni_comms_event_definition_list(integer,integer,text,text,text);
CREATE FUNCTION public.omni_comms_event_definition_list(
  p_limit integer, p_offset integer, p_status text, p_module_code text, p_search text,
  p_business_object_code text DEFAULT NULL
) RETURNS TABLE(id uuid, code text, module_code text, entity_type text,
                business_object_code text, display_order integer, name text,
                communication_class text, default_priority text, status text,
                updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_limit int; v_offset int; v_needle text; v_pattern text;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  v_limit := p_limit; v_offset := p_offset;
  IF v_limit IS NULL OR v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='limit_out_of_range';
  END IF;
  IF v_offset IS NULL OR v_offset < 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='offset_out_of_range';
  END IF;
  v_needle := btrim(COALESCE(p_search, ''));
  v_pattern := CASE WHEN v_needle = '' THEN NULL
                    ELSE '%' || public.omni_comms_priv_escape_ilike(v_needle) || '%' END;
  RETURN QUERY
    SELECT d.id, d.code, d.module_code, d.entity_type,
           COALESCE(d.business_object_code, d.entity_type), COALESCE(d.display_order, 1000),
           d.name, d.communication_class, d.default_priority, d.status, d.updated_at
      FROM public.omni_comms_event_definition d
     WHERE (p_status IS NULL OR d.status = p_status)
       AND (p_module_code IS NULL OR d.module_code = p_module_code)
       AND (p_business_object_code IS NULL
            OR COALESCE(d.business_object_code, d.entity_type) = p_business_object_code)
       AND (v_pattern IS NULL
            OR d.code ILIKE v_pattern ESCAPE '\'
            OR d.name ILIKE v_pattern ESCAPE '\'
            OR d.module_code ILIKE v_pattern ESCAPE '\'
            OR d.entity_type ILIKE v_pattern ESCAPE '\')
     ORDER BY d.code ASC, d.id ASC
     LIMIT v_limit OFFSET v_offset;
END; $function$;

-- ─── 5. Communication action authoring RPCs ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_communication_action_create(
  p_organization_id uuid, p_code text, p_name text,
  p_event_definition_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_scope_type text DEFAULT 'event',
  p_department_id uuid DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_action public.omni_comms_communication_action;
        v_family public.omni_comms_template_family; v_scope text; v_code text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required';
  END IF;
  v_scope := COALESCE(p_scope_type, 'event');
  v_code := upper(btrim(COALESCE(p_code,'')));
  IF v_code !~ '^[A-Z][A-Z0-9_]{2,79}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='code_format_invalid';
  END IF;
  IF v_scope NOT IN ('organization','department','event') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='scope_type_invalid';
  END IF;
  IF v_scope = 'event' AND p_event_definition_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='event_definition_required';
  END IF;
  IF v_scope = 'department' THEN
    IF p_department_id IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_required';
    END IF;
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  END IF;

  BEGIN
    INSERT INTO public.omni_comms_communication_action
      (organization_id, event_definition_id, department_id, code, name, description, status,
       obligation, satisfaction_rule, created_by, updated_by)
    VALUES (p_organization_id,
            CASE WHEN v_scope = 'event' THEN p_event_definition_id ELSE p_event_definition_id END,
            CASE WHEN v_scope = 'department' THEN p_department_id ELSE NULL END,
            v_code, btrim(p_name), NULLIF(btrim(COALESCE(p_description,'')),''),
            'active', 'optional', 'one_of', v_uid, v_uid)
    RETURNING * INTO v_action;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 duplicate_communication_action' USING ERRCODE='P0001', DETAIL=v_code;
  END;

  BEGIN
    INSERT INTO public.omni_comms_template_family
      (code, name, description, scope_type, organization_id, department_id,
       event_definition_id, communication_action_id, status, created_by, updated_by)
    VALUES (v_code, v_action.name, v_action.description, v_scope, p_organization_id,
            CASE WHEN v_scope = 'department' THEN p_department_id ELSE NULL END,
            CASE WHEN v_scope = 'event' THEN p_event_definition_id ELSE NULL END,
            v_action.id, 'draft', v_uid, v_uid)
    RETURNING * INTO v_family;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 duplicate_template_family_code' USING ERRCODE='P0001', DETAIL=v_code;
  END;

  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'create', 'communication_action', v_action.id, v_action.code,
    NULL, to_jsonb(v_action), p_correlation_id);
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'create', 'template_family', v_family.id, v_family.code,
    NULL, to_jsonb(v_family), NULL, NULL, p_correlation_id);

  RETURN jsonb_build_object(
    'communication_action_id', v_action.id,
    'code', v_action.code, 'name', v_action.name,
    'event_definition_id', v_action.event_definition_id,
    'template_family_id', v_family.id,
    'scope_type', v_family.scope_type,
    'status', v_family.status,
    'created_at', v_family.created_at,
    'updated_at', v_family.updated_at);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_communication_action_add_scope(
  p_communication_action_id uuid, p_scope_type text,
  p_department_id uuid DEFAULT NULL, p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_action public.omni_comms_communication_action;
        v_family public.omni_comms_template_family; v_code text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  SELECT * INTO v_action FROM public.omni_comms_communication_action
   WHERE id = p_communication_action_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='communication_action';
  END IF;
  IF p_scope_type NOT IN ('organization','department') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='scope_type_invalid';
  END IF;
  IF p_scope_type = 'department' THEN
    IF p_department_id IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_required';
    END IF;
    PERFORM public.omni_comms_priv_verify_department_ownership(p_department_id, v_action.organization_id);
  END IF;
  v_code := left(v_action.code || '__' || upper(p_scope_type) ||
            COALESCE('_' || upper(left(replace(p_department_id::text,'-',''), 8)), ''), 120);
  BEGIN
    INSERT INTO public.omni_comms_template_family
      (code, name, description, scope_type, organization_id, department_id,
       event_definition_id, communication_action_id, status, created_by, updated_by)
    VALUES (v_code, v_action.name, v_action.description, p_scope_type, v_action.organization_id,
            p_department_id, NULL, v_action.id, 'draft', v_uid, v_uid)
    RETURNING * INTO v_family;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 duplicate_scope_override' USING ERRCODE='P0001', DETAIL=v_code;
  END;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'create', 'template_family', v_family.id, v_family.code,
    NULL, to_jsonb(v_family), NULL, NULL, p_correlation_id);
  RETURN jsonb_build_object('template_family_id', v_family.id, 'code', v_family.code,
                            'scope_type', v_family.scope_type);
END; $function$;

-- ─── 6. Catalogue built from governed metadata only ─────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_template_business_catalogue(
  p_organization_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_modules jsonb; v_shared jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');

  CREATE TEMP TABLE _oc_chan ON COMMIT DROP AS
    WITH ranked AS (
      SELECT v.*, row_number() OVER (
               PARTITION BY v.template_family_id, v.channel
               ORDER BY CASE v.status WHEN 'published' THEN 1 WHEN 'approved' THEN 2
                                      WHEN 'draft' THEN 3 ELSE 4 END,
                        v.version_number DESC) AS rn,
             count(*) OVER (PARTITION BY v.template_family_id, v.channel) AS version_count
        FROM public.omni_comms_template_version v
    )
    SELECT template_family_id, channel, id AS version_id, status, version_number,
           locale, updated_at, version_count
      FROM ranked WHERE rn = 1;

  CREATE TEMP TABLE _oc_action ON COMMIT DROP AS
    SELECT a.id AS action_id, a.code AS action_code, a.name AS action_name,
           a.status AS action_status, a.event_definition_id, a.organization_id,
           f.id AS family_id, f.scope_type, f.department_id, f.status AS family_status,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'channel', c.channel, 'version_id', c.version_id,
                      'status', c.status, 'version_number', c.version_number,
                      'locale', c.locale, 'updated_at', c.updated_at,
                      'version_count', c.version_count) ORDER BY c.channel)
               FROM _oc_chan c WHERE c.template_family_id = f.id), '[]'::jsonb) AS channels
      FROM public.omni_comms_communication_action a
      JOIN public.omni_comms_template_family f ON f.communication_action_id = a.id
     WHERE (p_organization_id IS NULL OR a.organization_id = p_organization_id);

  SELECT COALESCE(jsonb_agg(t.m ORDER BY t.module_code), '[]'::jsonb) INTO v_modules
    FROM (
      SELECT s.module_code,
             jsonb_build_object(
               'module_code', s.module_code,
               'module_name', initcap(replace(lower(s.module_code), '_', ' ')),
               'business_objects', jsonb_agg(s.bo ORDER BY s.bo_order, s.bo_name)
             ) AS m
        FROM (
          SELECT e.module_code,
                 COALESCE(b.display_order, 1000) AS bo_order,
                 COALESCE(b.name, initcap(replace(lower(COALESCE(e.business_object_code, e.entity_type)), '_', ' '))) AS bo_name,
                 jsonb_build_object(
                   'code', COALESCE(e.business_object_code, e.entity_type),
                   'name', COALESCE(b.name, initcap(replace(lower(COALESCE(e.business_object_code, e.entity_type)), '_', ' '))),
                   'display_order', COALESCE(b.display_order, 1000),
                   'events', jsonb_agg(jsonb_build_object(
                      'id', e.id, 'code', e.code, 'name', e.name, 'status', e.status,
                      'communication_class', e.communication_class,
                      'display_order', COALESCE(e.display_order, 1000),
                      'actions', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                                 'id', ac.family_id,
                                 'communication_action_id', ac.action_id,
                                 'code', ac.action_code, 'name', ac.action_name,
                                 'status', ac.family_status, 'scope_type', ac.scope_type,
                                 'department_id', ac.department_id,
                                 'channels', ac.channels) ORDER BY ac.action_name)
                          FROM _oc_action ac WHERE ac.event_definition_id = e.id), '[]'::jsonb))
                      ORDER BY COALESCE(e.display_order, 1000), e.name)
                 ) AS bo
            FROM public.omni_comms_event_definition e
            LEFT JOIN public.omni_comms_business_object b
                   ON b.module_code = e.module_code
                  AND b.code = COALESCE(e.business_object_code, e.entity_type)
           WHERE COALESCE(b.status, 'active') = 'active'
           GROUP BY e.module_code, COALESCE(e.business_object_code, e.entity_type),
                    b.name, b.display_order
        ) s
       GROUP BY s.module_code
    ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ac.family_id, 'communication_action_id', ac.action_id,
           'code', ac.action_code, 'name', ac.action_name,
           'status', ac.family_status, 'scope_type', ac.scope_type,
           'department_id', ac.department_id, 'channels', ac.channels)
         ORDER BY ac.action_name), '[]'::jsonb)
    INTO v_shared
    FROM _oc_action ac
   WHERE ac.event_definition_id IS NULL;

  RETURN jsonb_build_object('modules', v_modules, 'shared', v_shared);
END; $function$;

-- ─── 7. Resolution can never cross a communication action ───────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_template_resolve_published(
  p_event_definition_id uuid, p_organization_id uuid, p_department_id uuid,
  p_channel text, p_locale text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_locale text; v_family_id uuid; v_version_id uuid;
  v_family public.omni_comms_template_family;
  v_version public.omni_comms_template_version;
  v_action_id uuid;
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

  SELECT f.id, v.id INTO v_family_id, v_version_id
    FROM public.omni_comms_template_family f
    JOIN public.omni_comms_communication_action a ON a.id = f.communication_action_id
    JOIN public.omni_comms_template_version v ON v.template_family_id = f.id
   WHERE f.status = 'active'
     AND f.organization_id = p_organization_id
     AND a.status <> 'retired'
     AND ((p_event_definition_id IS NOT NULL AND a.event_definition_id = p_event_definition_id)
          OR (p_event_definition_id IS NULL AND a.event_definition_id IS NULL))
     AND v.status = 'published'
     AND v.channel = p_channel
     AND v.locale = v_locale
     AND (f.scope_type = 'organization'
          OR (f.scope_type = 'department' AND p_department_id IS NOT NULL
              AND f.department_id = p_department_id)
          OR (f.scope_type = 'event' AND p_event_definition_id IS NOT NULL
              AND f.event_definition_id = p_event_definition_id))
   ORDER BY CASE f.scope_type WHEN 'event' THEN 3 WHEN 'department' THEN 2 ELSE 1 END DESC,
            v.version_number DESC
   LIMIT 1;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='no_published_template';
  END IF;

  SELECT * INTO v_family FROM public.omni_comms_template_family WHERE id = v_family_id;
  SELECT * INTO v_version FROM public.omni_comms_template_version WHERE id = v_version_id;

  RETURN jsonb_build_object(
    'template_family_id', v_family.id,
    'family_code', v_family.code,
    'communication_action_id', v_family.communication_action_id,
    'scope_type', v_family.scope_type,
    'template_version_id', v_version.id,
    'version_number', v_version.version_number,
    'channel', v_version.channel,
    'locale', v_version.locale,
    'checksum', v_version.checksum,
    'content', v_version.content);
END; $function$;
