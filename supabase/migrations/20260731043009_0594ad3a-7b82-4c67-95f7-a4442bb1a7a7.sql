CREATE OR REPLACE FUNCTION public.omni_comms_priv_reference_seed_run_v2(
  p_actor_id uuid,
  p_organization_id uuid,
  p_mode text,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  c              jsonb := public.omni_comms_priv_reference_seed_catalogue_v2();
  v_locale       text  := c ->> 'locale';
  v_actions      jsonb := '[]'::jsonb;
  v_created      integer := 0;
  v_planned      integer := 0;
  v_existing     integer := 0;
  v_conflicts    integer := 0;
  v_blocked      integer := 0;
  v_skipped      integer := 0;
  v_write        boolean := p_mode IN ('apply', 'reconcile');
  v_repair       boolean := p_mode = 'reconcile';
  v_found        boolean;
  it             jsonb;
  ch             jsonb;
  rec            record;
  v_id           uuid;
  v_dept_id      uuid;
  v_provider_id  uuid;
  v_account_id   uuid;
  v_sender_id    uuid;
  v_event_id     uuid;
  v_family_id    uuid;
  v_version_id   uuid;
  v_layout_id    uuid;
  v_layout_ver   uuid;
  v_contract_id  uuid;
  v_code         text;
  v_extra        text;
  v_schema       jsonb;
  v_sample       jsonb;
  v_checksum     text;
  v_family_code  text;
  v_key          text;
  v_note_reason  text;
BEGIN
  IF p_mode NOT IN ('preview', 'apply', 'reconcile') THEN
    RAISE EXCEPTION 'OC400 invalid_mode' USING ERRCODE = 'P0001', DETAIL = 'invalid_seed_mode';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.core_organization WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE = 'P0001', DETAIL = 'organization_not_found';
  END IF;

  -- =========================== PROVIDERS ===================================
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'providers') LOOP
    v_code := it ->> 'code';
    SELECT * INTO rec FROM public.omni_comms_provider WHERE code = v_code;
    IF FOUND THEN
      v_note_reason := NULL;
      IF rec.adapter_key IS DISTINCT FROM (it ->> 'adapter_key') THEN
        v_note_reason := 'adapter_key_mismatch';
      ELSIF rec.channel IS DISTINCT FROM (it ->> 'channel') THEN
        v_note_reason := 'channel_mismatch';
      ELSIF rec.status NOT IN ('draft', 'active') THEN
        v_note_reason := 'unexpected_status:' || rec.status;
      ELSIF rec.adapter_key NOT LIKE 'simulation%' THEN
        v_note_reason := 'not_simulation_adapter';
      END IF;

      IF v_note_reason IS NOT NULL THEN
        v_conflicts := v_conflicts + 1;
        v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','conflict','reason',v_note_reason);
        CONTINUE;
      END IF;

      v_provider_id := rec.id;
      IF rec.status = 'draft' AND v_repair THEN
        UPDATE public.omni_comms_provider
           SET status = 'active', activated_at = now(), activated_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = v_provider_id;
        PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_repair', 'provider', v_provider_id, v_code, NULL, jsonb_build_object('status','active'), p_correlation_id);
      END IF;
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','existing_compatible');
    ELSIF NOT v_write THEN
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
      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create', 'provider', v_provider_id, v_code, NULL, to_jsonb(it), p_correlation_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ======================= PROVIDER ACCOUNTS ===============================
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'accounts') LOOP
    v_code := it ->> 'code';
    SELECT id INTO v_provider_id FROM public.omni_comms_provider WHERE code = it ->> 'provider_code';

    SELECT * INTO rec FROM public.omni_comms_provider_account
     WHERE organization_id = p_organization_id AND code = v_code;

    IF FOUND THEN
      v_note_reason := NULL;
      IF v_provider_id IS NOT NULL AND rec.provider_id IS DISTINCT FROM v_provider_id THEN
        v_note_reason := 'provider_mismatch';
      ELSIF COALESCE(rec.sandbox_mode, false) = false THEN
        v_note_reason := 'account_not_sandbox';
      ELSIF rec.status NOT IN ('draft', 'active') THEN
        v_note_reason := 'unexpected_status:' || rec.status;
      END IF;
      IF v_note_reason IS NOT NULL THEN
        v_conflicts := v_conflicts + 1;
        v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','conflict','reason',v_note_reason);
        CONTINUE;
      END IF;
      IF rec.status = 'draft' AND v_repair THEN
        UPDATE public.omni_comms_provider_account
           SET status = 'active', activated_at = now(), activated_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = rec.id;
        PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_repair', 'provider_account', rec.id, v_code, NULL, jsonb_build_object('status','active'), p_correlation_id);
      END IF;
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','existing_compatible');
      CONTINUE;
    END IF;

    IF NOT v_write THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','planned');
      CONTINUE;
    END IF;

    IF v_provider_id IS NULL THEN
      v_blocked := v_blocked + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','blocked','reason','provider_unavailable');
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
    PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create', 'provider_account', v_account_id, v_code, NULL, to_jsonb(it), p_correlation_id);
    v_created := v_created + 1;
    v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','created');
  END LOOP;

  -- ==================== SENDER IDENTITIES + BINDINGS =======================
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'senders') LOOP
    v_code := it ->> 'code';
    v_dept_id := NULL;
    IF it ->> 'department_code' IS NOT NULL THEN
      SELECT id INTO v_dept_id FROM public.core_department
       WHERE organization_id = p_organization_id AND code = it ->> 'department_code';
    END IF;

    v_sender_id := NULL;
    SELECT * INTO rec FROM public.omni_comms_sender_identity
     WHERE organization_id = p_organization_id AND code = v_code;

    IF FOUND THEN
      v_note_reason := NULL;
      IF rec.channel IS DISTINCT FROM (it ->> 'channel') THEN
        v_note_reason := 'channel_mismatch';
      ELSIF rec.from_address IS DISTINCT FROM (it ->> 'from_address') THEN
        v_note_reason := 'from_address_mismatch';
      ELSIF rec.status NOT IN ('draft', 'active') THEN
        v_note_reason := 'unexpected_status:' || rec.status;
      ELSIF (it ->> 'channel') = 'email'
            AND rec.from_address NOT LIKE ('%@' || (c ->> 'recipient_domain')) THEN
        v_note_reason := 'non_reference_sender_domain';
      END IF;
      IF v_note_reason IS NOT NULL THEN
        v_conflicts := v_conflicts + 1;
        v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','conflict','reason',v_note_reason);
        CONTINUE;
      END IF;
      v_sender_id := rec.id;
      IF rec.status = 'draft' AND v_repair THEN
        UPDATE public.omni_comms_sender_identity
           SET status = 'active', activated_at = now(), activated_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = v_sender_id;
        PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_repair', 'sender_identity', v_sender_id, v_code, NULL, jsonb_build_object('status','active'), p_correlation_id);
      END IF;
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','existing_compatible');
    ELSIF NOT v_write THEN
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
      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create', 'sender_identity', v_sender_id, v_code, NULL, to_jsonb(it), p_correlation_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','created');
    END IF;

    SELECT id INTO v_account_id FROM public.omni_comms_provider_account
     WHERE organization_id = p_organization_id AND code = it ->> 'account_code';

    IF v_sender_id IS NULL OR v_account_id IS NULL THEN
      IF NOT v_write THEN
        v_planned := v_planned + 1;
        v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','planned');
      ELSE
        v_blocked := v_blocked + 1;
        v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','blocked','reason','sender_or_account_unavailable');
      END IF;
      CONTINUE;
    END IF;

    SELECT * INTO rec FROM public.omni_comms_sender_provider_binding
     WHERE sender_identity_id = v_sender_id AND provider_account_id = v_account_id;

    IF FOUND THEN
      IF rec.status NOT IN ('draft', 'active') THEN
        v_conflicts := v_conflicts + 1;
        v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','conflict','reason','unexpected_status:' || rec.status);
      ELSE
        IF rec.status = 'draft' AND v_repair THEN
          UPDATE public.omni_comms_sender_provider_binding
             SET status = 'active', activated_at = now(), activated_by = p_actor_id,
                 updated_at = now(), updated_by = p_actor_id
           WHERE id = rec.id;
        END IF;
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','existing_compatible');
      END IF;
    ELSIF NOT v_write THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_sender_provider_binding
        (sender_identity_id, provider_account_id, priority, verification_status, status, created_by, updated_by)
      VALUES (v_sender_id, v_account_id, 100, 'verified', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_id;
      UPDATE public.omni_comms_sender_provider_binding
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_id;
      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create', 'sender_binding', v_id, v_code, NULL, jsonb_build_object('simulation_only', true, 'external_delivery', false), p_correlation_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ========================= CHANNEL SETTINGS ==============================
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'channel_settings') LOOP
    v_code := it ->> 'channel';
    SELECT * INTO rec FROM public.omni_comms_channel_setting
     WHERE organization_id = p_organization_id AND department_id IS NULL AND channel = v_code;
    IF FOUND THEN
      IF COALESCE(rec.live_delivery_enabled, false) THEN
        v_conflicts := v_conflicts + 1;
        v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','conflict','reason','live_delivery_enabled');
      ELSE
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','existing_compatible');
      END IF;
    ELSIF NOT v_write THEN
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

  -- ============ EVENTS / CONTRACTS / FAMILIES / VERSIONS / ROUTES ==========
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

    -- ---- 1. event definition (draft first) --------------------------------
    v_event_id := NULL;
    SELECT * INTO rec FROM public.omni_comms_event_definition WHERE code = v_code;
    IF FOUND THEN
      v_note_reason := NULL;
      IF rec.module_code IS DISTINCT FROM (it ->> 'module_code') THEN
        v_note_reason := 'module_code_mismatch';
      ELSIF rec.entity_type IS DISTINCT FROM (it ->> 'entity_type') THEN
        v_note_reason := 'entity_type_mismatch';
      ELSIF rec.communication_class IS DISTINCT FROM (it ->> 'communication_class') THEN
        v_note_reason := 'communication_class_mismatch';
      ELSIF rec.status NOT IN ('draft', 'active') THEN
        v_note_reason := 'unexpected_status:' || rec.status;
      END IF;
      IF v_note_reason IS NOT NULL THEN
        v_conflicts := v_conflicts + 1;
        v_skipped := v_skipped + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','conflict','reason',v_note_reason);
        CONTINUE;
      END IF;
      v_event_id := rec.id;
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','existing_compatible');
    ELSIF NOT v_write THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_event_definition
        (code, module_code, entity_type, name, description, communication_class, default_priority, status, created_by, updated_by)
      VALUES (v_code, it ->> 'module_code', it ->> 'entity_type', it ->> 'name',
              'reference_seed(v2): ' || (it ->> 'description'),
              it ->> 'communication_class', it ->> 'default_priority', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_event_id;
      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create_draft', 'event_definition', v_event_id, v_code, NULL, jsonb_build_object('status','draft'), p_correlation_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','created');
    END IF;

    IF v_write AND v_event_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- ---- 2/3/4. contract draft -> validate -> publish ---------------------
    v_contract_id := NULL;
    v_found := false;
    IF v_event_id IS NOT NULL THEN
      SELECT * INTO rec FROM public.omni_comms_event_contract
       WHERE event_definition_id = v_event_id AND version_number = 1;
      v_found := FOUND;
    END IF;

    IF v_found THEN
      v_checksum := public.omni_comms_priv_compute_checksum(v_code, 1, rec.json_schema);
      v_note_reason := NULL;
      IF rec.status <> 'published' THEN
        IF v_repair THEN
          PERFORM public.omni_comms_priv_validate_schema(rec.json_schema, rec.sample_payload);
          UPDATE public.omni_comms_event_contract
             SET status = 'published', checksum = v_checksum, published_at = now(), published_by = p_actor_id,
                 updated_at = now(), updated_by = p_actor_id
           WHERE id = rec.id;
          PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_publish', 'event_contract', rec.id, v_code || ':v1', jsonb_build_object('status',rec.status), jsonb_build_object('status','published'), p_correlation_id);
          v_contract_id := rec.id;
          v_existing := v_existing + 1;
          v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','existing_compatible','reason','repaired_to_published');
        ELSE
          v_note_reason := 'contract_not_published:' || rec.status;
        END IF;
      ELSIF rec.checksum IS DISTINCT FROM v_checksum THEN
        v_note_reason := 'contract_checksum_mismatch';
      ELSE
        v_contract_id := rec.id;
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','existing_compatible');
      END IF;

      IF v_note_reason IS NOT NULL THEN
        v_conflicts := v_conflicts + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','conflict','reason',v_note_reason);
      END IF;
    ELSIF NOT v_write THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','planned');
    ELSE
      PERFORM public.omni_comms_priv_validate_schema(v_schema, v_sample);
      INSERT INTO public.omni_comms_event_contract
        (event_definition_id, version_number, json_schema, sample_payload, status, created_by, updated_by)
      VALUES (v_event_id, 1, v_schema, v_sample, 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_contract_id;
      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create_draft', 'event_contract', v_contract_id, v_code || ':v1', NULL, jsonb_build_object('status','draft'), p_correlation_id);
      v_checksum := public.omni_comms_priv_compute_checksum(v_code, 1, v_schema);
      UPDATE public.omni_comms_event_contract
         SET status = 'published', checksum = v_checksum, published_at = now(), published_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_contract_id;
      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_publish', 'event_contract', v_contract_id, v_code || ':v1', jsonb_build_object('status','draft'), jsonb_build_object('status','published'), p_correlation_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','created');
    END IF;

    -- ---- 5. activate event ONLY after a published contract ----------------
    IF v_write THEN
      IF v_contract_id IS NULL THEN
        v_blocked := v_blocked + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','blocked','reason','published_contract_required_before_activation');
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.omni_comms_event_definition WHERE id = v_event_id AND status = 'draft') THEN
        UPDATE public.omni_comms_event_definition
           SET status = 'active', updated_at = now(), updated_by = p_actor_id
         WHERE id = v_event_id;
        PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_activate', 'event_definition', v_event_id, v_code, jsonb_build_object('status','draft'), jsonb_build_object('status','active'), p_correlation_id);
      END IF;
    END IF;

    -- ---- 6. template family ------------------------------------------------
    v_family_code := it ->> 'family_code';
    v_family_id := NULL;
    SELECT * INTO rec FROM public.omni_comms_template_family WHERE code = v_family_code;
    IF FOUND THEN
      v_note_reason := NULL;
      IF rec.organization_id IS DISTINCT FROM p_organization_id THEN
        v_note_reason := 'family_belongs_to_other_organization';
      ELSIF rec.scope_type IS DISTINCT FROM 'event' THEN
        v_note_reason := 'family_scope_mismatch';
      ELSIF v_event_id IS NOT NULL AND rec.event_definition_id IS DISTINCT FROM v_event_id THEN
        v_note_reason := 'family_event_mismatch';
      ELSIF rec.status NOT IN ('draft', 'active') THEN
        v_note_reason := 'unexpected_status:' || rec.status;
      END IF;
      IF v_note_reason IS NOT NULL THEN
        v_conflicts := v_conflicts + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','conflict','reason',v_note_reason);
        CONTINUE;
      END IF;
      v_family_id := rec.id;
      IF rec.status = 'draft' AND v_repair THEN
        UPDATE public.omni_comms_template_family
           SET status = 'active', activated_at = now(), activated_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = v_family_id;
        PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_repair', 'template_family', v_family_id, v_family_code, NULL, jsonb_build_object('status','active'), p_correlation_id);
      END IF;
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','existing_compatible');
    ELSIF NOT v_write THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_template_family
        (code, name, description, scope_type, organization_id, department_id, event_definition_id, status, created_by, updated_by)
      VALUES (v_family_code, (it ->> 'name') || ' Templates',
              'reference_seed(v2): reference templates for ' || v_code,
              'event', p_organization_id, NULL, v_event_id, 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_family_id;
      UPDATE public.omni_comms_template_family
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_family_id;
      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create', 'template_family', v_family_id, v_family_code, NULL, jsonb_build_object('status','active'), p_correlation_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','created');
    END IF;

    -- ---- per channel: template version + route ----------------------------
    FOR ch IN SELECT * FROM jsonb_array_elements(it -> 'channels') LOOP
      v_key := v_family_code || ':' || (ch ->> 'channel');

      SELECT id INTO v_layout_id FROM public.core_template_layout
       WHERE code = (c -> 'layouts' ->> (ch ->> 'channel')) AND is_active LIMIT 1;

      v_layout_ver := NULL;
      IF v_layout_id IS NOT NULL THEN
        SELECT id INTO v_layout_ver FROM public.core_template_layout_version
         WHERE layout_id = v_layout_id AND status = 'published'
         ORDER BY version_number DESC LIMIT 1;
      END IF;

      v_version_id := NULL;
      v_found := false;
      IF v_family_id IS NOT NULL THEN
        SELECT * INTO rec FROM public.omni_comms_template_version
         WHERE template_family_id = v_family_id AND channel = ch ->> 'channel'
           AND locale = v_locale AND version_number = 1;
        v_found := FOUND;
      END IF;

      IF v_found THEN
        v_checksum := public.omni_comms_priv_compute_template_checksum(
          v_family_code, 1, ch ->> 'channel', v_locale, rec.content);
        v_note_reason := NULL;
        IF rec.status = 'published' AND rec.checksum IS DISTINCT FROM v_checksum THEN
          v_note_reason := 'template_checksum_mismatch';
        ELSIF NOT public.omni_comms_priv_layout_selection_valid(
                rec.layout_selection_mode, rec.layout_id, rec.pinned_layout_version_id, rec.channel) THEN
          IF v_repair AND v_layout_id IS NOT NULL AND v_layout_ver IS NOT NULL THEN
            UPDATE public.omni_comms_template_version
               SET layout_selection_mode = 'pinned', layout_id = v_layout_id,
                   pinned_layout_version_id = v_layout_ver,
                   updated_at = now(), updated_by = p_actor_id
             WHERE id = rec.id;
            PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_repair', 'template_version', rec.id, v_key, NULL, jsonb_build_object('layout_selection_mode','pinned'), p_correlation_id);
          ELSE
            v_note_reason := 'invalid_layout_selection';
          END IF;
        END IF;

        IF v_note_reason IS NULL AND rec.status <> 'published' THEN
          IF v_repair THEN
            UPDATE public.omni_comms_template_version
               SET status = 'approved', checksum = v_checksum, approved_at = now(), approved_by = p_actor_id,
                   updated_at = now(), updated_by = p_actor_id
             WHERE id = rec.id AND status = 'draft';
            UPDATE public.omni_comms_template_version
               SET status = 'published', published_at = now(), published_by = p_actor_id,
                   updated_at = now(), updated_by = p_actor_id
             WHERE id = rec.id;
            PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_publish', 'template_version', rec.id, v_key, jsonb_build_object('status',rec.status), jsonb_build_object('status','published'), p_correlation_id);
          ELSE
            v_note_reason := 'template_not_published:' || rec.status;
          END IF;
        END IF;

        IF v_note_reason IS NOT NULL THEN
          v_conflicts := v_conflicts + 1;
          v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_key,'action','conflict','reason',v_note_reason);
        ELSE
          v_version_id := rec.id;
          v_existing := v_existing + 1;
          v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_key,'action','existing_compatible');
        END IF;
      ELSIF v_layout_id IS NULL OR v_layout_ver IS NULL THEN
        v_blocked := v_blocked + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_key,'action','blocked','reason','no_published_layout_version');
      ELSIF NOT v_write THEN
        v_planned := v_planned + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_key,'action','planned');
      ELSIF v_family_id IS NULL THEN
        v_blocked := v_blocked + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_key,'action','blocked','reason','family_unavailable');
      ELSE
        PERFORM public.omni_comms_priv_validate_channel_content(ch ->> 'channel', ch -> 'content');
        INSERT INTO public.omni_comms_template_version
          (template_family_id, version_number, channel, locale, content, status,
           layout_selection_mode, layout_id, pinned_layout_version_id, created_by, updated_by)
        VALUES (v_family_id, 1, ch ->> 'channel', v_locale, ch -> 'content', 'draft',
                'pinned', v_layout_id, v_layout_ver, NULL, p_actor_id)
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

        PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_publish', 'template_version', v_version_id, v_key, NULL, jsonb_build_object('status','published','checksum',v_checksum,'layout_selection_mode','pinned'), p_correlation_id);
        v_created := v_created + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_key,'action','created');
      END IF;

      -- ---- route ----------------------------------------------------------
      v_key := v_code || ':' || (ch ->> 'channel');
      SELECT id INTO v_sender_id FROM public.omni_comms_sender_identity
       WHERE organization_id = p_organization_id AND code = ch ->> 'sender_code';

      v_found := false;
      IF v_event_id IS NOT NULL THEN
        SELECT * INTO rec FROM public.omni_comms_event_route
         WHERE organization_id = p_organization_id
           AND department_id IS NOT DISTINCT FROM v_dept_id
           AND event_definition_id = v_event_id
           AND channel = ch ->> 'channel';
        v_found := FOUND;
      END IF;

      IF v_found THEN
        v_note_reason := NULL;
        IF v_family_id IS NOT NULL AND rec.template_family_id IS DISTINCT FROM v_family_id THEN
          v_note_reason := 'route_family_mismatch';
        ELSIF v_sender_id IS NOT NULL AND rec.sender_identity_id IS DISTINCT FROM v_sender_id THEN
          v_note_reason := 'route_sender_mismatch';
        ELSIF rec.lifecycle_state NOT IN ('draft', 'active') THEN
          v_note_reason := 'unexpected_lifecycle:' || rec.lifecycle_state;
        END IF;
        IF v_note_reason IS NOT NULL THEN
          v_conflicts := v_conflicts + 1;
          v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_key,'action','conflict','reason',v_note_reason);
          CONTINUE;
        END IF;
        IF v_repair AND (rec.lifecycle_state = 'draft' OR COALESCE(rec.is_enabled,false) = false) THEN
          UPDATE public.omni_comms_event_route
             SET lifecycle_state = 'active', is_enabled = true,
                 activated_at = COALESCE(activated_at, now()), activated_by = COALESCE(activated_by, p_actor_id),
                 updated_at = now(), updated_by = p_actor_id
           WHERE id = rec.id;
          PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_repair', 'event_route', rec.id, v_key, NULL, jsonb_build_object('lifecycle_state','active'), p_correlation_id);
        END IF;
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_key,'action','existing_compatible');
        CONTINUE;
      END IF;

      IF NOT v_write THEN
        v_planned := v_planned + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_key,'action','planned');
        CONTINUE;
      END IF;

      IF v_family_id IS NULL OR v_sender_id IS NULL OR v_version_id IS NULL THEN
        v_blocked := v_blocked + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_key,'action','blocked','reason','template_or_sender_unavailable');
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

      PERFORM public.omni_comms_priv_write_audit(p_actor_id, 'reference_seed_create', 'event_route', v_id, v_key, NULL, jsonb_build_object('lifecycle_state','active'), p_correlation_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_key,'action','created');
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'catalogue_version', (c ->> 'catalogue_version')::int,
    'mode', p_mode,
    'created', v_created,
    'planned', v_planned,
    'existing', v_existing,
    'conflicts', v_conflicts,
    'blocked', v_blocked,
    'skipped', v_skipped,
    'actions', v_actions,
    'generated_at', now()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reference_seed_run_v2(uuid, uuid, text, text) FROM PUBLIC;