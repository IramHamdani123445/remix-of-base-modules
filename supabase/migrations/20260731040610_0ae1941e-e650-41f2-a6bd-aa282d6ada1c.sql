CREATE OR REPLACE FUNCTION public.omni_comms_priv_reference_seed_run(
  p_actor_id uuid,
  p_organization_id uuid,
  p_apply boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  c              jsonb := public.omni_comms_priv_reference_seed_catalogue();
  v_locale       text  := c ->> 'locale';
  v_actions      jsonb := '[]'::jsonb;
  v_created      integer := 0;
  v_planned      integer := 0;
  v_existing     integer := 0;
  v_skipped      integer := 0;
  it             jsonb;
  ch             jsonb;
  v_id           uuid;
  v_dept_id      uuid;
  v_provider_id  uuid;
  v_account_id   uuid;
  v_sender_id    uuid;
  v_event_id     uuid;
  v_family_id    uuid;
  v_version_id   uuid;
  v_layout_id    uuid;
  v_code         text;
  v_extra        text;
  v_schema       jsonb;
  v_sample       jsonb;
  v_checksum     text;
  v_family_code  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.core_organization WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'OC404 not_found'
      USING ERRCODE = 'P0001', DETAIL = 'organization_not_found';
  END IF;

  -- ---- providers (global) -------------------------------------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'providers') LOOP
    v_code := it ->> 'code';
    SELECT id INTO v_provider_id FROM public.omni_comms_provider WHERE code = v_code;
    IF v_provider_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_provider (code, display_name, channel, adapter_key, status, created_by, updated_by)
      VALUES (v_code, it ->> 'display_name', it ->> 'channel', it ->> 'adapter_key', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_provider_id;
      UPDATE public.omni_comms_provider
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_provider_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ---- provider accounts (org scoped, simulation only) --------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'accounts') LOOP
    v_code := it ->> 'code';
    SELECT id INTO v_account_id
      FROM public.omni_comms_provider_account
     WHERE organization_id = p_organization_id AND code = v_code;
    IF v_account_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','existing');
      CONTINUE;
    END IF;
    SELECT id INTO v_provider_id FROM public.omni_comms_provider WHERE code = it ->> 'provider_code';
    IF v_provider_id IS NULL OR NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','planned');
      CONTINUE;
    END IF;
    INSERT INTO public.omni_comms_provider_account
      (organization_id, provider_id, code, display_name, secret_ref, sandbox_mode, status, created_by, updated_by)
    VALUES
      (p_organization_id, v_provider_id, v_code, it ->> 'display_name', it ->> 'secret_ref', true, 'draft', p_actor_id, p_actor_id)
    RETURNING id INTO v_account_id;
    UPDATE public.omni_comms_provider_account
       SET status = 'active', activated_at = now(), activated_by = p_actor_id,
           updated_at = now(), updated_by = p_actor_id
     WHERE id = v_account_id;
    v_created := v_created + 1;
    v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','created');
  END LOOP;

  -- ---- sender identities + bindings ---------------------------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'senders') LOOP
    v_code := it ->> 'code';
    v_dept_id := NULL;
    IF it ->> 'department_code' IS NOT NULL THEN
      SELECT id INTO v_dept_id FROM public.core_department
       WHERE organization_id = p_organization_id AND code = it ->> 'department_code';
    END IF;

    SELECT id INTO v_sender_id
      FROM public.omni_comms_sender_identity
     WHERE organization_id = p_organization_id AND code = v_code;

    IF v_sender_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 2;
      v_actions := v_actions
        || jsonb_build_object('object_type','sender_identity','key',v_code,'action','planned')
        || jsonb_build_object('object_type','sender_binding','key',v_code,'action','planned');
      CONTINUE;
    ELSE
      INSERT INTO public.omni_comms_sender_identity
        (organization_id, department_id, code, display_name, channel, from_address, from_name, reply_to_address, status, created_by, updated_by)
      VALUES
        (p_organization_id, v_dept_id, v_code, it ->> 'display_name', it ->> 'channel',
         it ->> 'from_address', it ->> 'from_name', it ->> 'reply_to_address', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_sender_id;
      UPDATE public.omni_comms_sender_identity
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_sender_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','created');
    END IF;

    SELECT id INTO v_account_id
      FROM public.omni_comms_provider_account
     WHERE organization_id = p_organization_id AND code = it ->> 'account_code';

    IF v_sender_id IS NULL OR v_account_id IS NULL THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','planned');
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding
                WHERE sender_identity_id = v_sender_id AND provider_account_id = v_account_id) THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_sender_provider_binding
        (sender_identity_id, provider_account_id, priority, verification_status, verified_at, status, created_by, updated_by)
      VALUES (v_sender_id, v_account_id, 100, 'verified', now(), 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_id;
      UPDATE public.omni_comms_sender_provider_binding
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ---- channel settings (enabled, live delivery OFF) ----------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'channel_settings') LOOP
    v_code := it ->> 'channel';
    IF EXISTS (SELECT 1 FROM public.omni_comms_channel_setting
                WHERE organization_id = p_organization_id AND department_id IS NULL AND channel = v_code) THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_channel_setting
        (organization_id, department_id, channel, enabled, live_delivery_enabled, created_by, updated_by)
      VALUES (p_organization_id, NULL, v_code, true, false, p_actor_id, p_actor_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ---- events, contracts, families, versions, routes ----------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'events') LOOP
    v_code  := it ->> 'code';
    v_extra := it ->> 'extra_field';

    v_schema := jsonb_build_object(
      '$schema', 'https://json-schema.org/draft/2020-12/schema',
      'type', 'object',
      'additionalProperties', false,
      'required', jsonb_build_array('reference', 'subjectName', v_extra),
      'properties', jsonb_build_object(
        'reference',   jsonb_build_object('type','string','maxLength',64),
        'subjectName', jsonb_build_object('type','string','maxLength',160)
      ) || jsonb_build_object(v_extra, jsonb_build_object('type','string','maxLength',240))
    );
    v_sample := (it -> 'sample') || jsonb_build_object(v_extra, it ->> 'extra_sample');

    v_dept_id := NULL;
    IF it ->> 'department_code' IS NOT NULL THEN
      SELECT id INTO v_dept_id FROM public.core_department
       WHERE organization_id = p_organization_id AND code = it ->> 'department_code';
    END IF;

    SELECT id INTO v_event_id FROM public.omni_comms_event_definition WHERE code = v_code;
    IF v_event_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_event_definition
        (code, module_code, entity_type, name, description, communication_class, default_priority, status, created_by, updated_by)
      VALUES (v_code, it ->> 'module_code', it ->> 'entity_type', it ->> 'name', it ->> 'description',
              it ->> 'communication_class', it ->> 'default_priority', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_event_id;
      UPDATE public.omni_comms_event_definition
         SET status = 'active', updated_at = now(), updated_by = p_actor_id
       WHERE id = v_event_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','created');
    END IF;

    -- During apply a missing event blocks its children; during preview the
    -- dependent objects are still reported as planned.
    IF v_event_id IS NULL AND p_apply THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- event contract v1 (published)
    IF v_event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.omni_comms_event_contract
       WHERE event_definition_id = v_event_id AND version_number = 1) THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','planned');
    ELSE
      PERFORM public.omni_comms_priv_validate_schema(v_schema, v_sample);
      INSERT INTO public.omni_comms_event_contract
        (event_definition_id, version_number, json_schema, sample_payload, status, created_by, updated_by)
      VALUES (v_event_id, 1, v_schema, v_sample, 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_id;
      v_checksum := public.omni_comms_priv_compute_checksum(v_code, 1, v_schema);
      UPDATE public.omni_comms_event_contract
         SET status = 'published', checksum = v_checksum, published_at = now(), published_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','created');
    END IF;

    -- template family (event scoped)
    v_family_code := it ->> 'family_code';
    SELECT id INTO v_family_id FROM public.omni_comms_template_family WHERE code = v_family_code;
    IF v_family_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_template_family
        (code, name, description, scope_type, organization_id, department_id, event_definition_id, status, created_by, updated_by)
      VALUES (v_family_code, (it ->> 'name') || ' Templates', 'Reference seed templates for ' || v_code,
              'event', p_organization_id, NULL, v_event_id, 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_family_id;
      UPDATE public.omni_comms_template_family
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_family_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','created');
    END IF;

    FOR ch IN SELECT * FROM jsonb_array_elements(it -> 'channels') LOOP
      SELECT id INTO v_layout_id FROM public.core_template_layout
       WHERE code = (c -> 'layouts' ->> (ch ->> 'channel')) AND is_active LIMIT 1;

      v_version_id := NULL;
      IF v_family_id IS NOT NULL THEN
        SELECT id INTO v_version_id FROM public.omni_comms_template_version
         WHERE template_family_id = v_family_id AND channel = ch ->> 'channel'
           AND locale = v_locale AND version_number = 1;
      END IF;

      IF v_version_id IS NOT NULL THEN
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_family_code || ':' || (ch ->> 'channel'),'action','existing');
      ELSIF NOT p_apply OR v_family_id IS NULL OR v_layout_id IS NULL THEN
        v_planned := v_planned + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_family_code || ':' || (ch ->> 'channel'),'action','planned');
      ELSE
        PERFORM public.omni_comms_priv_validate_channel_content(ch ->> 'channel', ch -> 'content');
        -- Author is the system seed principal (NULL); approver is the operator,
        -- which satisfies the independent-approver rule by construction.
        INSERT INTO public.omni_comms_template_version
          (template_family_id, version_number, channel, locale, content, status,
           layout_selection_mode, layout_id, created_by, updated_by)
        VALUES (v_family_id, 1, ch ->> 'channel', v_locale, ch -> 'content', 'draft',
                'resolved_default', v_layout_id, NULL, p_actor_id)
        RETURNING id INTO v_version_id;

        v_checksum := public.omni_comms_priv_compute_template_checksum(
          v_family_code, 1, ch ->> 'channel', v_locale, ch -> 'content');

        UPDATE public.omni_comms_template_version
           SET status = 'approved', checksum = v_checksum, approved_at = now(), approved_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = v_version_id;

        UPDATE public.omni_comms_template_version
           SET status = 'published', published_at = now(), published_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = v_version_id;

        v_created := v_created + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_family_code || ':' || (ch ->> 'channel'),'action','created');
      END IF;

      v_id := NULL;
      IF v_event_id IS NOT NULL THEN
        SELECT id INTO v_id FROM public.omni_comms_event_route
         WHERE organization_id = p_organization_id
           AND department_id IS NOT DISTINCT FROM v_dept_id
           AND event_definition_id = v_event_id
           AND channel = ch ->> 'channel';
      END IF;

      IF v_id IS NOT NULL THEN
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_code || ':' || (ch ->> 'channel'),'action','existing');
        CONTINUE;
      END IF;

      SELECT id INTO v_sender_id FROM public.omni_comms_sender_identity
       WHERE organization_id = p_organization_id AND code = ch ->> 'sender_code';

      IF NOT p_apply OR v_family_id IS NULL OR v_sender_id IS NULL THEN
        v_planned := v_planned + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_code || ':' || (ch ->> 'channel'),'action','planned');
        CONTINUE;
      END IF;

      INSERT INTO public.omni_comms_event_route
        (organization_id, department_id, event_definition_id, channel, is_required, is_enabled, priority,
         template_family_id, sender_identity_id, sender_resolution_policy, preference_policy, lifecycle_state,
         created_by, updated_by)
      VALUES
        (p_organization_id, v_dept_id, v_event_id, ch ->> 'channel',
         COALESCE((ch ->> 'is_required')::boolean, false), true,
         COALESCE((ch ->> 'priority')::integer, 100),
         v_family_id, v_sender_id, 'explicit', 'honour', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_id;

      UPDATE public.omni_comms_event_route
         SET lifecycle_state = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_id;

      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_code || ':' || (ch ->> 'channel'),'action','created');
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'catalogue_version', (c ->> 'catalogue_version')::int,
    'mode', CASE WHEN p_apply THEN 'apply' ELSE 'preview' END,
    'created', v_created,
    'planned', v_planned,
    'existing', v_existing,
    'skipped', v_skipped,
    'actions', v_actions,
    'generated_at', now()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reference_seed_run(uuid, uuid, boolean) FROM PUBLIC;