-- ===================================================================
-- Build 4A — FINAL acceptance corrections.
-- Provider-free. dry_run / shadow only. No dispatch, no live delivery.
-- Idempotent.
-- ===================================================================

-- -------------------------------------------------------------------
-- 1. Pilot environment guard — authoritative + fail-closed.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_pilot_assert_non_production()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_env text;
BEGIN
  -- Authoritative reader ONLY. Any failure is treated as unknown.
  BEGIN
    v_env := public.omni_comms_priv_runtime_environment();
  EXCEPTION WHEN OTHERS THEN
    v_env := 'unknown';
  END;

  IF v_env IS NULL OR v_env <> 'non_production' THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_non_production_required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.omni_comms_channel_setting WHERE live_delivery_enabled
  ) THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_live_delivery_enabled';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_pilot_assert_non_production() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_pilot_assert_non_production() FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_pilot_assert_non_production() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_pilot_assert_non_production() TO service_role;

-- -------------------------------------------------------------------
-- 2. Bootstrap — prerequisite gate + all-or-nothing completion check.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(
  p_actor_id uuid,
  p_organization_code text DEFAULT 'SKN-SSB',
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  k_event_code    CONSTANT text := 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';
  k_module_code   CONSTANT text := 'EMPLOYER_REGISTRATION';
  k_family_code   CONSTANT text := 'pilot_registration_employer_application_submitted';
  k_locale        CONSTANT text := 'en-US';
  v_actions  jsonb := '[]'::jsonb;
  v_org      uuid;
  v_dept     uuid;
  v_event    uuid;
  v_family   uuid;
  v_version  uuid;
  v_layout   uuid;
  v_layout_version uuid;
  v_sender   uuid;
  v_route    uuid;
  v_binding  uuid;
  v_actor    uuid := p_actor_id;
  v_schema   jsonb;
  v_sample   jsonb;
  v_content  jsonb;
  v_checksum text;
  v_id       uuid;
  v_module_ok boolean;
BEGIN
  PERFORM public.omni_comms_priv_pilot_assert_non_production();

  SELECT id INTO v_org FROM public.core_organization WHERE org_code = p_organization_code;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found'
      USING ERRCODE = 'P0001', DETAIL = 'organization_not_found';
  END IF;

  IF v_actor IS NULL THEN
    SELECT created_by INTO v_actor FROM public.omni_comms_event_definition
     WHERE created_by IS NOT NULL ORDER BY created_at LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input'
      USING ERRCODE = 'P0001', DETAIL = 'bootstrap_actor_required';
  END IF;

  SELECT id INTO v_dept FROM public.core_department
   WHERE organization_id = v_org AND code = 'REGISTRATION';
  SELECT id INTO v_sender FROM public.omni_comms_sender_identity
   WHERE organization_id = v_org AND code = 'ref_sender_registration';
  SELECT l.id, v.id
    INTO v_layout, v_layout_version
  FROM public.core_template_layout l
  JOIN public.core_template_layout_version v ON v.layout_id = l.id
 WHERE l.code = 'OMNI_REF_EMAIL'
   AND l.is_active
   AND v.status = 'published'
 ORDER BY v.version_number DESC
 LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.omni_comms_caller_module_registry
     WHERE module_code = k_module_code AND is_active = true
  ) INTO v_module_ok;

  -- Prerequisite gate: apply mode is all-or-nothing. A missing prerequisite
  -- must abort BEFORE any object is created, so the pilot can never be left
  -- partially active.
  IF p_apply THEN
    IF v_dept IS NULL THEN
      RAISE EXCEPTION 'OC412 invalid_state'
        USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_department_missing';
    END IF;
    IF NOT v_module_ok THEN
      RAISE EXCEPTION 'OC412 invalid_state'
        USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_caller_module_inactive';
    END IF;
    IF v_sender IS NULL THEN
      RAISE EXCEPTION 'OC412 invalid_state'
        USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_sender_identity_missing';
    END IF;
    IF v_layout IS NULL OR v_layout_version IS NULL THEN
      RAISE EXCEPTION 'OC412 invalid_state'
        USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_layout_missing';
    END IF;
  END IF;

  v_schema := jsonb_build_object(
    '$schema', 'https://json-schema.org/draft/2020-12/schema',
    'type', 'object',
    'additionalProperties', false,
    'required', jsonb_build_array('reference', 'subjectName', 'submissionStatus', 'submittedAt'),
    'properties', jsonb_build_object(
      'reference',        jsonb_build_object('type', 'string', 'maxLength', 64),
      'subjectName',      jsonb_build_object('type', 'string', 'maxLength', 160),
      'submissionStatus', jsonb_build_object('type', 'string', 'maxLength', 64),
      'submittedAt',      jsonb_build_object('type', 'string', 'maxLength', 40)
    )
  );
  v_sample := jsonb_build_object(
    'reference', 'ER-004512',
    'subjectName', 'Frigate Bay Retail Ltd',
    'submissionStatus', 'Pending review',
    'submittedAt', '2026-08-01T08:00:00.000Z'
  );
  v_content := jsonb_build_object(
    'subject', 'Application received - employer registration {{payload.reference}}',
    'html', '<p>{{payload.subjectName}},</p><p>We have received your employer registration application. Reference <strong>{{payload.reference}}</strong>, submitted on {{payload.submittedAt}}.</p><p>Current status: {{payload.submissionStatus}}. This message confirms receipt of your application only. Your application has not been assessed, no registration decision has been made, and no effective date has been set.</p><p>Social Security Board</p>',
    'text', '{{payload.subjectName}}: we have received your employer registration application {{payload.reference}}, submitted on {{payload.submittedAt}}. Current status: {{payload.submissionStatus}}. This confirms receipt of your application only; it has not been assessed, no decision has been made and no effective date has been set.'
  );

  -- event definition ---------------------------------------------------
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = k_event_code;
  IF v_event IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',k_event_code,'action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',k_event_code,'action','planned');
  ELSE
    INSERT INTO public.omni_comms_event_definition
      (code, module_code, entity_type, name, description, communication_class, default_priority, status, created_by, updated_by)
    VALUES (k_event_code, 'REGISTRATION', 'EMPLOYER',
            'Employer Registration Application Submitted',
            'Acknowledges receipt of an employer registration application. Receipt only: no assessment, decision, activation or effective date is implied.',
            'transactional', 'normal', 'draft', v_actor, v_actor)
    RETURNING id INTO v_event;
    UPDATE public.omni_comms_event_definition
       SET status = 'active', updated_at = now(), updated_by = v_actor
     WHERE id = v_event;
    v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',k_event_code,'action','created');
  END IF;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('applied', p_apply, 'organization_id', v_org, 'actions', v_actions);
  END IF;

  -- published contract v1 ----------------------------------------------
  IF EXISTS (SELECT 1 FROM public.omni_comms_event_contract
              WHERE event_definition_id = v_event AND version_number = 1) THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',k_event_code || ':v1','action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',k_event_code || ':v1','action','planned');
  ELSE
    PERFORM public.omni_comms_priv_validate_schema(v_schema, v_sample);
    INSERT INTO public.omni_comms_event_contract
      (event_definition_id, version_number, json_schema, sample_payload, status, created_by, updated_by)
    VALUES (v_event, 1, v_schema, v_sample, 'draft', v_actor, v_actor)
    RETURNING id INTO v_id;
    v_checksum := public.omni_comms_priv_compute_checksum(k_event_code, 1, v_schema);
    UPDATE public.omni_comms_event_contract
       SET status = 'published', checksum = v_checksum, published_at = now(), published_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_id;
    v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',k_event_code || ':v1','action','created');
  END IF;

  -- active template family ---------------------------------------------
  SELECT id INTO v_family FROM public.omni_comms_template_family WHERE code = k_family_code;
  IF v_family IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_family','key',k_family_code,'action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_family','key',k_family_code,'action','planned');
  ELSE
    INSERT INTO public.omni_comms_template_family
      (code, name, description, scope_type, organization_id, department_id, event_definition_id, status, created_by, updated_by)
    VALUES (k_family_code, 'Employer Registration Application Submitted Templates',
            'Pilot templates for ' || k_event_code, 'event', v_org, NULL, v_event, 'draft', v_actor, v_actor)
    RETURNING id INTO v_family;
    UPDATE public.omni_comms_template_family
       SET status = 'active', activated_at = now(), activated_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_family;
    v_actions := v_actions || jsonb_build_object('object_type','template_family','key',k_family_code,'action','created');
  END IF;

  -- published email template version ------------------------------------
  IF v_family IS NOT NULL THEN
    SELECT id INTO v_version FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email'
       AND locale = k_locale AND version_number = 1;
  END IF;

  IF v_version IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_version','key',k_family_code || ':email','action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','template_version','key',k_family_code || ':email','action','planned');
  ELSE
    PERFORM public.omni_comms_priv_validate_channel_content('email', v_content);
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, status,
       layout_selection_mode, layout_id, pinned_layout_version_id, created_by, updated_by)
    VALUES (v_family, 1, 'email', k_locale, v_content, 'draft',
            'pinned', v_layout, v_layout_version, NULL, v_actor)
    RETURNING id INTO v_version;

    v_checksum := public.omni_comms_priv_compute_template_checksum(
      k_family_code, 1, 'email', k_locale, v_content);

    UPDATE public.omni_comms_template_version
       SET status = 'approved', checksum = v_checksum, approved_at = now(), approved_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_version;
    UPDATE public.omni_comms_template_version
       SET status = 'published', published_at = now(), published_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_version;

    v_actions := v_actions || jsonb_build_object('object_type','template_version','key',k_family_code || ':email','action','created');
  END IF;

  -- active email route ---------------------------------------------------
  SELECT id INTO v_route FROM public.omni_comms_event_route
   WHERE organization_id = v_org
     AND department_id IS NOT DISTINCT FROM v_dept
     AND event_definition_id = v_event
     AND channel = 'email';

  IF v_route IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_route','key',k_event_code || ':email','action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','event_route','key',k_event_code || ':email','action','planned');
  ELSE
    INSERT INTO public.omni_comms_event_route
      (organization_id, department_id, event_definition_id, channel, is_required, is_enabled, priority,
       template_family_id, sender_identity_id, sender_resolution_policy, preference_policy, lifecycle_state,
       created_by, updated_by)
    VALUES (v_org, v_dept, v_event, 'email', false, true, 100,
            v_family, v_sender, 'explicit', 'honour', 'draft', v_actor, v_actor)
    RETURNING id INTO v_route;
    UPDATE public.omni_comms_event_route
       SET lifecycle_state = 'active', activated_at = now(), activated_by = v_actor,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_route;
    v_actions := v_actions || jsonb_build_object('object_type','event_route','key',k_event_code || ':email','action','created');
  END IF;

  -- caller module registration -------------------------------------------
  v_actions := v_actions || jsonb_build_object(
    'object_type','caller_module','key',k_module_code,
    'action', CASE WHEN v_module_ok THEN 'existing' ELSE 'missing' END);

  -- producer binding (dry_run + shadow only) ------------------------------
  SELECT id INTO v_binding FROM public.omni_comms_producer_event_binding
   WHERE organization_id = v_org
     AND caller_module_code = k_module_code
     AND event_definition_id = v_event
     AND status <> 'retired'
   LIMIT 1;

  IF v_binding IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('object_type','producer_binding','key',k_event_code,'action','existing');
  ELSIF NOT p_apply THEN
    v_actions := v_actions || jsonb_build_object('object_type','producer_binding','key',k_event_code,'action','planned');
  ELSE
    INSERT INTO public.omni_comms_producer_event_binding
      (organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_by, updated_by,
       activated_at, activated_by)
    VALUES (v_org, NULL, k_module_code, v_event,
            ARRAY['dry_run','shadow']::text[], 'active',
            'build4a_pilot_employer_registration_application_submitted', v_actor, v_actor,
            now(), v_actor)
    RETURNING id INTO v_binding;
    v_actions := v_actions || jsonb_build_object('object_type','producer_binding','key',k_event_code,'action','created');
  END IF;

  -- Completion gate: in apply mode the pilot must be whole, or nothing at
  -- all. Any missing piece aborts and rolls the whole bootstrap back.
  IF p_apply THEN
    IF v_event IS NULL
       OR v_family IS NULL
       OR v_version IS NULL
       OR v_route IS NULL
       OR v_binding IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                       WHERE event_definition_id = v_event
                         AND version_number = 1 AND status = 'published')
       OR NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                       WHERE id = v_version AND status = 'published')
       OR NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                       WHERE id = v_route AND lifecycle_state = 'active' AND is_enabled)
       OR NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                       WHERE id = v_binding AND status = 'active')
    THEN
      RAISE EXCEPTION 'OC412 invalid_state'
        USING ERRCODE = 'P0001', DETAIL = 'pilot_bootstrap_incomplete_configuration';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'applied', p_apply,
    'organization_code', p_organization_code,
    'organization_id', v_org,
    'event_code', k_event_code,
    'event_definition_id', v_event,
    'caller_module_code', k_module_code,
    'template_family_id', v_family,
    'template_version_id', v_version,
    'layout_id', v_layout,
    'layout_version_id', v_layout_version,
    'event_route_id', v_route,
    'producer_event_binding_id', v_binding,
    'actions', v_actions
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) TO service_role;

-- -------------------------------------------------------------------
-- 3. Public wrapper — capability AND tenant authorisation.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(
  p_organization_code text DEFAULT 'SKN-SSB',
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_actor uuid;
  v_org   uuid;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');

  IF p_organization_code IS NULL OR btrim(p_organization_code) = '' THEN
    RAISE EXCEPTION 'OC400 organization_required'
      USING ERRCODE = 'P0001', DETAIL = 'organization_required';
  END IF;

  SELECT id INTO v_org FROM public.core_organization
   WHERE org_code = btrim(p_organization_code);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found'
      USING ERRCODE = 'P0001', DETAIL = 'organization_not_found';
  END IF;

  -- Caller must be entitled to act for THIS organisation.
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_org, NULL);

  RETURN public.omni_comms_priv_bootstrap_employer_registration_pilot(
    v_actor, btrim(p_organization_code), coalesce(p_apply, false));
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_bootstrap_employer_registration_pilot(text, boolean) TO service_role;

-- -------------------------------------------------------------------
-- 4. Scoped retirement of the ONE incorrect SKN-SSB pilot binding.
--    Scoped by organisation + module + event + pilot integration
--    reference. No other organisation and no legitimate completed-
--    registration binding is touched.
-- -------------------------------------------------------------------
DO $do$
DECLARE
  v_actor uuid;
BEGIN
  SELECT created_by INTO v_actor FROM public.omni_comms_event_definition
   WHERE created_by IS NOT NULL ORDER BY created_at LIMIT 1;

  UPDATE public.omni_comms_producer_event_binding b
     SET status = 'retired',
         lifecycle_reason = 'REGISTRATION.EMPLOYER.REGISTERED represents a completed registration and must not be emitted on application submission.',
         retired_at = now(),
         retired_by = coalesce(v_actor, b.created_by),
         updated_by = coalesce(v_actor, b.updated_by)
   WHERE b.caller_module_code = 'EMPLOYER_REGISTRATION'
     AND b.status <> 'retired'
     AND b.integration_reference = 'useEmployerRegistrationSubmit'
     AND b.organization_id = (
       SELECT id FROM public.core_organization WHERE org_code = 'SKN-SSB')
     AND b.event_definition_id = (
       SELECT id FROM public.omni_comms_event_definition
        WHERE code = 'REGISTRATION.EMPLOYER.REGISTERED');
END
$do$;