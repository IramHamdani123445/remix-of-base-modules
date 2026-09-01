-- Final definition of the governed Internal Audit Omni-Comms seeding helper.
-- Applied via run_sql during Wave 4; recorded here as the source of truth.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_seed_internal_audit_event(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := (p->>'actorId')::uuid;
  v_approver uuid := COALESCE((p->>'approverId')::uuid, (p->>'actorId')::uuid);
  v_org uuid := (p->>'organizationId')::uuid;
  v_dept uuid := (p->>'departmentId')::uuid;
  v_code text := p->>'code';
  v_event uuid;
  v_family uuid;
  v_version integer;
  v_channel jsonb;
  v_ch text;
  v_checksum text;
BEGIN
  IF v_approver = v_actor THEN
    RAISE EXCEPTION 'Seed requires an approver distinct from the author (separation of duties).';
  END IF;

  INSERT INTO public.omni_comms_caller_module_registry
    (module_code, permission_module, permission_action, is_active, notes)
  SELECT 'INTERNAL_AUDIT', 'internal_audit', 'view', true, 'Internal Audit business module.'
  WHERE NOT EXISTS (SELECT 1 FROM public.omni_comms_caller_module_registry
                     WHERE module_code = 'INTERNAL_AUDIT');

  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = v_code;
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, v_code, 'INTERNAL_AUDIT', split_part(v_code, '.', 2), p->>'name',
            p->>'description', p->>'communicationClass', p->>'priority',
            'draft', now(), v_actor, now(), v_actor);
  END IF;
  UPDATE public.omni_comms_event_definition
     SET name = p->>'name', description = p->>'description',
         communication_class = p->>'communicationClass',
         default_priority = p->>'priority',
         status = CASE WHEN status IN ('draft','suspended') THEN 'active' ELSE status END,
         updated_at = now(), updated_by = v_actor
   WHERE id = v_event;

  v_checksum := p->>'schemaChecksum';
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = v_checksum) THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, p->'schema', p->'samplePayload', 'draft',
            v_checksum, now(), v_actor, now(), v_actor);
    UPDATE public.omni_comms_event_contract
       SET status = 'published', published_at = now(), published_by = v_approver,
           updated_at = now(), updated_by = v_approver
     WHERE event_definition_id = v_event AND version_number = v_version;
  END IF;

  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status IN ('active','draft')
   ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_family, p->>'familyCode', p->>'name', p->>'description', 'event',
            v_org, NULL, v_event, 'draft', now(), v_actor, now(), v_actor);
  END IF;

  UPDATE public.omni_comms_template_family
     SET status = 'active', activated_at = COALESCE(activated_at, now()),
         activated_by = COALESCE(activated_by, v_approver),
         updated_at = now(), updated_by = v_approver
   WHERE id = v_family AND status = 'draft';

  FOR v_channel IN SELECT jsonb_array_elements(p->'channels') LOOP
    v_ch := v_channel->>'channel';
    v_checksum := v_channel->>'checksum';
    IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                    WHERE template_family_id = v_family AND channel = v_ch
                      AND locale = p->>'locale' AND status = 'published'
                      AND checksum = v_checksum) THEN
      UPDATE public.omni_comms_template_version
         SET status = 'retired', retired_at = now(), retired_by = v_actor,
             retirement_reason = 'Superseded by the generated Internal Audit template library',
             updated_at = now(), updated_by = v_actor
       WHERE template_family_id = v_family AND channel = v_ch
         AND locale = p->>'locale' AND status = 'published';
      SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
        FROM public.omni_comms_template_version
       WHERE template_family_id = v_family AND channel = v_ch AND locale = p->>'locale';
      INSERT INTO public.omni_comms_template_version
        (id, template_family_id, version_number, channel, locale, content, status,
         created_at, created_by, updated_at, updated_by,
         layout_selection_mode, layout_id, pinned_layout_version_id)
      VALUES (gen_random_uuid(), v_family, v_version, v_ch, p->>'locale',
              v_channel->'content', 'draft', now(), v_actor, now(), v_actor,
              'pinned', (v_channel->>'layoutId')::uuid, (v_channel->>'layoutVersionId')::uuid);
      UPDATE public.omni_comms_template_version
         SET status = 'approved', checksum = v_checksum,
             approved_at = now(), approved_by = v_approver,
             updated_at = now(), updated_by = v_approver
       WHERE template_family_id = v_family AND version_number = v_version
         AND channel = v_ch AND locale = p->>'locale';
      UPDATE public.omni_comms_template_version
         SET status = 'published', published_at = now(), published_by = v_approver,
             updated_at = now(), updated_by = v_approver
       WHERE template_family_id = v_family AND version_number = v_version
         AND channel = v_ch AND locale = p->>'locale';
    END IF;
  END LOOP;

  FOR v_channel IN SELECT jsonb_array_elements(p->'channels') LOOP
    v_ch := v_channel->>'channel';
    IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                    WHERE event_definition_id = v_event AND channel = v_ch
                      AND organization_id = v_org AND department_id = v_dept) THEN
      INSERT INTO public.omni_comms_event_route
        (id, organization_id, department_id, event_definition_id, channel, is_required,
         is_enabled, priority, template_family_id, sender_identity_id,
         sender_resolution_policy, preference_policy, lifecycle_state,
         created_at, created_by, updated_at, updated_by)
      VALUES (gen_random_uuid(), v_org, v_dept, v_event, v_ch, true, true,
              (v_channel->>'priority')::integer, v_family,
              (v_channel->>'senderIdentityId')::uuid, 'explicit', 'honour', 'draft',
              now(), v_actor, now(), v_actor);
    END IF;
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, v_approver),
           updated_at = now(), updated_by = v_approver
     WHERE event_definition_id = v_event AND channel = v_ch
       AND organization_id = v_org AND department_id = v_dept;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = v_org AND department_id = v_dept) THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by,
       updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), v_org, v_dept, 'INTERNAL_AUDIT', v_event,
            ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication',
            now(), v_actor, now(), v_actor, now(), v_approver);
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, v_approver),
           updated_at = now(), updated_by = v_approver
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = v_org AND department_id = v_dept;
  END IF;

  RETURN jsonb_build_object('code', v_code, 'eventId', v_event, 'familyId', v_family);
END;
$function$

;
REVOKE ALL ON FUNCTION public.omni_comms_priv_seed_internal_audit_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_seed_internal_audit_event(jsonb) TO service_role;
