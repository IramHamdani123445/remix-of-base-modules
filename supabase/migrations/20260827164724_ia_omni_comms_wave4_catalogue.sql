-- Internal Audit → Omni-Comms catalogue seed (generated).
-- Source of truth: src/platform/omni-comms/integrations/business/internal-audit/
-- Idempotent: safe to re-run. Never edit by hand — regenerate instead.

-- Registered caller module.
INSERT INTO public.omni_comms_caller_module_registry
  (module_code, permission_module, permission_action, is_active, notes)
SELECT 'INTERNAL_AUDIT', 'internal_audit', 'view', true, 'Internal Audit business module.'
WHERE NOT EXISTS (SELECT 1 FROM public.omni_comms_caller_module_registry
                   WHERE module_code = 'INTERNAL_AUDIT');

-- INTERNAL_AUDIT.PLAN.SUBMITTED — Annual audit plan submitted for approval
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.PLAN.SUBMITTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.PLAN.SUBMITTED', 'INTERNAL_AUDIT', 'PLAN', 'Annual audit plan submitted for approval',
       'The annual internal audit plan has been submitted into the approval workflow.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Annual audit plan submitted for approval', description = 'The annual internal audit plan has been submitted into the approval workflow.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '48454b989efdba938d426321c5116ffd447898f96ab3b8a724f6dfcb1627067a') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","planYear","submittedOn","engagementCount"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"planYear":{"type":"string","minLength":1},"submittedOn":{"type":"string","minLength":1},"engagementCount":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","planYear":"2026","submittedOn":"14 August 2026","engagementCount":"18"}'::jsonb, 'published', '48454b989efdba938d426321c5116ffd447898f96ab3b8a724f6dfcb1627067a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_plan_submitted', 'Annual audit plan submitted for approval', 'The annual internal audit plan has been submitted into the approval workflow.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '8506acf45bebe8b0928e2960ba5176f33f036c30d89b5712db76b1abf550bc1e') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Annual audit plan {{payload.reference}} submitted for approval","text":"Dear {{payload.subjectName}},\n\nThe annual internal audit plan has been submitted and is awaiting your approval.\n\nPlan year: {{payload.planYear}}\nSubmitted on: {{payload.submittedOn}}\nEngagement count: {{payload.engagementCount}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The annual internal audit plan has been submitted and is awaiting your approval.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Plan year</strong></td><td>{{payload.planYear}}</td></tr>\n<tr><td><strong>Submitted on</strong></td><td>{{payload.submittedOn}}</td></tr>\n<tr><td><strong>Engagement count</strong></td><td>{{payload.engagementCount}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '8506acf45bebe8b0928e2960ba5176f33f036c30d89b5712db76b1abf550bc1e',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'd4f62213dcefab91a93a3a2a7bde2228a98362ac404346b7a15419f0af24096c') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Annual audit plan {{payload.reference}} submitted for approval","body":"The annual internal audit plan has been submitted and is awaiting your approval. Plan year: {{payload.planYear}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'd4f62213dcefab91a93a3a2a7bde2228a98362ac404346b7a15419f0af24096c',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.PLAN.APPROVED — Annual audit plan approved
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.PLAN.APPROVED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.PLAN.APPROVED', 'INTERNAL_AUDIT', 'PLAN', 'Annual audit plan approved',
       'The annual internal audit plan has been approved and is now executable.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Annual audit plan approved', description = 'The annual internal audit plan has been approved and is now executable.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '4617b4d6afb4ea320d0c9774451e8296ea3ba9be19bc402a643e61e2e5e674d3') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","planYear","approvedOn","approvedBy"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"planYear":{"type":"string","minLength":1},"approvedOn":{"type":"string","minLength":1},"approvedBy":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","planYear":"2026","approvedOn":"18 August 2026","approvedBy":"Head of Internal Audit"}'::jsonb, 'published', '4617b4d6afb4ea320d0c9774451e8296ea3ba9be19bc402a643e61e2e5e674d3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_plan_approved', 'Annual audit plan approved', 'The annual internal audit plan has been approved and is now executable.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '84a308e5ef50130edf255a9acf36aab9742b868b316cb0827d6d34b168237d88') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Annual audit plan {{payload.reference}} approved","text":"Dear {{payload.subjectName}},\n\nThe annual internal audit plan has been approved and engagements may now be launched.\n\nPlan year: {{payload.planYear}}\nApproved on: {{payload.approvedOn}}\nApproved by: {{payload.approvedBy}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The annual internal audit plan has been approved and engagements may now be launched.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Plan year</strong></td><td>{{payload.planYear}}</td></tr>\n<tr><td><strong>Approved on</strong></td><td>{{payload.approvedOn}}</td></tr>\n<tr><td><strong>Approved by</strong></td><td>{{payload.approvedBy}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '84a308e5ef50130edf255a9acf36aab9742b868b316cb0827d6d34b168237d88',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '0824e266fb703376d6f749e6edd75f1e7a87efc50baccb0e3a5971fe701160ab') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Annual audit plan {{payload.reference}} approved","body":"The annual internal audit plan has been approved and engagements may now be launched. Plan year: {{payload.planYear}}. Reference {{payload.reference}}."}'::jsonb, 'published', '0824e266fb703376d6f749e6edd75f1e7a87efc50baccb0e3a5971fe701160ab',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.PLAN.REJECTED — Annual audit plan rejected
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.PLAN.REJECTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.PLAN.REJECTED', 'INTERNAL_AUDIT', 'PLAN', 'Annual audit plan rejected',
       'The annual internal audit plan was rejected by the approving authority.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Annual audit plan rejected', description = 'The annual internal audit plan was rejected by the approving authority.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '5e26bd9ff674953492de17fd9ba4a76b0a9a158e90be8c25dc16c46bca15813e') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","planYear","decidedOn","decisionReason"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"planYear":{"type":"string","minLength":1},"decidedOn":{"type":"string","minLength":1},"decisionReason":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","planYear":"2026","decidedOn":"19 August 2026","decisionReason":"Coverage of the payments cycle was insufficient"}'::jsonb, 'published', '5e26bd9ff674953492de17fd9ba4a76b0a9a158e90be8c25dc16c46bca15813e',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_plan_rejected', 'Annual audit plan rejected', 'The annual internal audit plan was rejected by the approving authority.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'b5a9faa1fdd7e0089c3ac9981ddbd37fa181a32d345a16653ae80d1d591bf9a1') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Annual audit plan {{payload.reference}} rejected","text":"Dear {{payload.subjectName}},\n\nThe annual internal audit plan was rejected and must be reworked before resubmission.\n\nPlan year: {{payload.planYear}}\nDecided on: {{payload.decidedOn}}\nDecision reason: {{payload.decisionReason}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The annual internal audit plan was rejected and must be reworked before resubmission.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Plan year</strong></td><td>{{payload.planYear}}</td></tr>\n<tr><td><strong>Decided on</strong></td><td>{{payload.decidedOn}}</td></tr>\n<tr><td><strong>Decision reason</strong></td><td>{{payload.decisionReason}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'b5a9faa1fdd7e0089c3ac9981ddbd37fa181a32d345a16653ae80d1d591bf9a1',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'ef0c1ee406fe9a0f95cb22d6e62bccfc507c8b08b18eb472c5d666c84e8075e3') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Annual audit plan {{payload.reference}} rejected","body":"The annual internal audit plan was rejected and must be reworked before resubmission. Plan year: {{payload.planYear}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'ef0c1ee406fe9a0f95cb22d6e62bccfc507c8b08b18eb472c5d666c84e8075e3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.PLAN.REVISION_REQUESTED — Annual audit plan revision requested
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.PLAN.REVISION_REQUESTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.PLAN.REVISION_REQUESTED', 'INTERNAL_AUDIT', 'PLAN', 'Annual audit plan revision requested',
       'A material change requires the annual plan to be revised and re-approved.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Annual audit plan revision requested', description = 'A material change requires the annual plan to be revised and re-approved.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '2b9bae2c12a266bb0e28280974094cf3aa5d095f43f3d4fc7f112fd1865b4a3b') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","planYear","requestedOn","revisionReason"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"planYear":{"type":"string","minLength":1},"requestedOn":{"type":"string","minLength":1},"revisionReason":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","planYear":"2026","requestedOn":"20 August 2026","revisionReason":"A new high-risk auditable unit was added to the universe"}'::jsonb, 'published', '2b9bae2c12a266bb0e28280974094cf3aa5d095f43f3d4fc7f112fd1865b4a3b',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_plan_revision_requested', 'Annual audit plan revision requested', 'A material change requires the annual plan to be revised and re-approved.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'f093ab185415af4b43db2f3ea2f1a9d25f1b1011ae2f7bcfb38a58bf93bf7179') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Revision requested for annual audit plan {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nA revision has been requested for the annual internal audit plan.\n\nPlan year: {{payload.planYear}}\nRequested on: {{payload.requestedOn}}\nRevision reason: {{payload.revisionReason}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A revision has been requested for the annual internal audit plan.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Plan year</strong></td><td>{{payload.planYear}}</td></tr>\n<tr><td><strong>Requested on</strong></td><td>{{payload.requestedOn}}</td></tr>\n<tr><td><strong>Revision reason</strong></td><td>{{payload.revisionReason}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'f093ab185415af4b43db2f3ea2f1a9d25f1b1011ae2f7bcfb38a58bf93bf7179',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '29a2334bed6ac84c895a54cc673e80c9fd19879a2033b7919c5a52be4c28702d') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Revision requested for annual audit plan {{payload.reference}}","body":"A revision has been requested for the annual internal audit plan. Plan year: {{payload.planYear}}. Reference {{payload.reference}}."}'::jsonb, 'published', '29a2334bed6ac84c895a54cc673e80c9fd19879a2033b7919c5a52be4c28702d',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.PLAN.CLOSED — Annual audit plan closed
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.PLAN.CLOSED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.PLAN.CLOSED', 'INTERNAL_AUDIT', 'PLAN', 'Annual audit plan closed',
       'The annual internal audit plan has been closed for the plan year.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Annual audit plan closed', description = 'The annual internal audit plan has been closed for the plan year.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '4be1bfba33c3291e82e80d5531971241da3dca2c4c5e2e41b594411ee2bcecc9') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","planYear","closedOn","carriedForwardCount"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"planYear":{"type":"string","minLength":1},"closedOn":{"type":"string","minLength":1},"carriedForwardCount":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","planYear":"2026","closedOn":"15 December 2026","carriedForwardCount":"3"}'::jsonb, 'published', '4be1bfba33c3291e82e80d5531971241da3dca2c4c5e2e41b594411ee2bcecc9',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_plan_closed', 'Annual audit plan closed', 'The annual internal audit plan has been closed for the plan year.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'f6e19c11dab207f6b4afa8faee8353936047f97e70243da5ac59008f7f90168b') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Annual audit plan {{payload.reference}} closed","text":"Dear {{payload.subjectName}},\n\nThe annual internal audit plan has been closed.\n\nPlan year: {{payload.planYear}}\nClosed on: {{payload.closedOn}}\nCarried forward count: {{payload.carriedForwardCount}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The annual internal audit plan has been closed.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Plan year</strong></td><td>{{payload.planYear}}</td></tr>\n<tr><td><strong>Closed on</strong></td><td>{{payload.closedOn}}</td></tr>\n<tr><td><strong>Carried forward count</strong></td><td>{{payload.carriedForwardCount}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'f6e19c11dab207f6b4afa8faee8353936047f97e70243da5ac59008f7f90168b',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '55aed7c5f240986b09086a78498804c8d3eb34da597add57ffaba773833f4c7a') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Annual audit plan {{payload.reference}} closed","body":"The annual internal audit plan has been closed. Plan year: {{payload.planYear}}. Reference {{payload.reference}}."}'::jsonb, 'published', '55aed7c5f240986b09086a78498804c8d3eb34da597add57ffaba773833f4c7a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.PLAN.TEAM_CONFLICT — Audit team independence conflict detected
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.PLAN.TEAM_CONFLICT';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.PLAN.TEAM_CONFLICT', 'INTERNAL_AUDIT', 'PLAN', 'Audit team independence conflict detected',
       'A team assignment breaches the independence or availability rules.', 'operational', 'urgent',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Audit team independence conflict detected', description = 'A team assignment breaches the independence or availability rules.',
           communication_class = 'operational',
           default_priority = 'urgent', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '37da0523d37afb164f8d5601ed4540fcf476fb7d17a5d86f2d5e182900180be5') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","planYear","conflictSummary","detectedOn"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"planYear":{"type":"string","minLength":1},"conflictSummary":{"type":"string","minLength":1},"detectedOn":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","planYear":"2026","conflictSummary":"Assigned auditor worked in the auditee unit within the last 12 months","detectedOn":"21 August 2026"}'::jsonb, 'published', '37da0523d37afb164f8d5601ed4540fcf476fb7d17a5d86f2d5e182900180be5',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_plan_team_conflict', 'Audit team independence conflict detected', 'A team assignment breaches the independence or availability rules.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '8ac77b16cb67854438cecbeca82f85ea03f32b3e871d6ed4d37e0eb045bfced3') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Independence conflict on audit plan {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nAn independence or availability conflict was detected on an audit team assignment.\n\nPlan year: {{payload.planYear}}\nConflict summary: {{payload.conflictSummary}}\nDetected on: {{payload.detectedOn}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>An independence or availability conflict was detected on an audit team assignment.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Plan year</strong></td><td>{{payload.planYear}}</td></tr>\n<tr><td><strong>Conflict summary</strong></td><td>{{payload.conflictSummary}}</td></tr>\n<tr><td><strong>Detected on</strong></td><td>{{payload.detectedOn}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '8ac77b16cb67854438cecbeca82f85ea03f32b3e871d6ed4d37e0eb045bfced3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '9696181c2e02481300c2629024aeb268988f3346b6281828ee1801fd78ab6b18') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Independence conflict on audit plan {{payload.reference}}","body":"An independence or availability conflict was detected on an audit team assignment. Plan year: {{payload.planYear}}. Reference {{payload.reference}}."}'::jsonb, 'published', '9696181c2e02481300c2629024aeb268988f3346b6281828ee1801fd78ab6b18',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ENGAGEMENT.LAUNCHED — Audit engagement launched
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ENGAGEMENT.LAUNCHED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ENGAGEMENT.LAUNCHED', 'INTERNAL_AUDIT', 'ENGAGEMENT', 'Audit engagement launched',
       'The engagement has passed launch readiness and fieldwork may begin.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Audit engagement launched', description = 'The engagement has passed launch readiness and fieldwork may begin.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'a3e7b7f8575983c92ec9731a0ba04fa23e5a8f08a02bc165e2ab5cfa36f61f05') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","auditeeUnit","launchedOn","plannedEndDate"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"auditeeUnit":{"type":"string","minLength":1},"launchedOn":{"type":"string","minLength":1},"plannedEndDate":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","auditeeUnit":"Contributions Department","launchedOn":"24 August 2026","plannedEndDate":"30 September 2026"}'::jsonb, 'published', 'a3e7b7f8575983c92ec9731a0ba04fa23e5a8f08a02bc165e2ab5cfa36f61f05',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_engagement_launched', 'Audit engagement launched', 'The engagement has passed launch readiness and fieldwork may begin.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '4c7424f737088e57715a6242b77c2801158df11384f31b5a218f28952280219b') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Audit engagement {{payload.reference}} launched","text":"Dear {{payload.subjectName}},\n\nThe audit engagement has been launched and is now in execution.\n\nEngagement title: {{payload.engagementTitle}}\nAuditee unit: {{payload.auditeeUnit}}\nLaunched on: {{payload.launchedOn}}\nPlanned end date: {{payload.plannedEndDate}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The audit engagement has been launched and is now in execution.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Auditee unit</strong></td><td>{{payload.auditeeUnit}}</td></tr>\n<tr><td><strong>Launched on</strong></td><td>{{payload.launchedOn}}</td></tr>\n<tr><td><strong>Planned end date</strong></td><td>{{payload.plannedEndDate}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '4c7424f737088e57715a6242b77c2801158df11384f31b5a218f28952280219b',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'e403f46b8205e00f5608ebff3f7a4556262b8cbfe7b9c955bd8ec98033fc7ebf') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Audit engagement {{payload.reference}} launched","body":"The audit engagement has been launched and is now in execution. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'e403f46b8205e00f5608ebff3f7a4556262b8cbfe7b9c955bd8ec98033fc7ebf',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED — Audit intimation issued to the auditee
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED', 'INTERNAL_AUDIT', 'ENGAGEMENT', 'Audit intimation issued to the auditee',
       'Formal notice of the forthcoming audit has been issued to the auditee.', 'legal_mandatory', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Audit intimation issued to the auditee', description = 'Formal notice of the forthcoming audit has been issued to the auditee.',
           communication_class = 'legal_mandatory',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '101cd844c81f01a10e8f7fea083ecaf6f3e3c1712ee2bc039cdab665a79e74f4') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","auditeeUnit","scopeSummary","plannedStartDate","plannedEndDate"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"auditeeUnit":{"type":"string","minLength":1},"scopeSummary":{"type":"string","minLength":1},"plannedStartDate":{"type":"string","minLength":1},"plannedEndDate":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","auditeeUnit":"Contributions Department","scopeSummary":"Contribution receipting, posting and reconciliation controls","plannedStartDate":"1 September 2026","plannedEndDate":"30 September 2026"}'::jsonb, 'published', '101cd844c81f01a10e8f7fea083ecaf6f3e3c1712ee2bc039cdab665a79e74f4',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_engagement_intimation_issued', 'Audit intimation issued to the auditee', 'Formal notice of the forthcoming audit has been issued to the auditee.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'e3e7b9213411663f0e4e62f772f16dc9037a2202860e2e73169db95a37d087e3') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Notice of internal audit — {{payload.engagementTitle}}","text":"Dear {{payload.subjectName}},\n\nThis is formal notice that an internal audit of your area is scheduled.\n\nEngagement title: {{payload.engagementTitle}}\nAuditee unit: {{payload.auditeeUnit}}\nScope summary: {{payload.scopeSummary}}\nPlanned start date: {{payload.plannedStartDate}}\nPlanned end date: {{payload.plannedEndDate}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>This is formal notice that an internal audit of your area is scheduled.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Auditee unit</strong></td><td>{{payload.auditeeUnit}}</td></tr>\n<tr><td><strong>Scope summary</strong></td><td>{{payload.scopeSummary}}</td></tr>\n<tr><td><strong>Planned start date</strong></td><td>{{payload.plannedStartDate}}</td></tr>\n<tr><td><strong>Planned end date</strong></td><td>{{payload.plannedEndDate}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'e3e7b9213411663f0e4e62f772f16dc9037a2202860e2e73169db95a37d087e3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '94be05ad442d9e7cf192e3808cdc797eb62885ef3e27aa6f17122dfd8cf28dee') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Notice of internal audit — {{payload.engagementTitle}}","body":"This is formal notice that an internal audit of your area is scheduled. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '94be05ad442d9e7cf192e3808cdc797eb62885ef3e27aa6f17122dfd8cf28dee',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ENGAGEMENT.ENTRANCE_MEETING — Entrance meeting scheduled
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ENGAGEMENT.ENTRANCE_MEETING';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ENGAGEMENT.ENTRANCE_MEETING', 'INTERNAL_AUDIT', 'ENGAGEMENT', 'Entrance meeting scheduled',
       'The entrance meeting for the engagement has been scheduled.', 'service', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Entrance meeting scheduled', description = 'The entrance meeting for the engagement has been scheduled.',
           communication_class = 'service',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '3396db8f9249df5f46a6541878e62a378e391ac95fb41644ca9909d5a745ed54') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","meetingDateTime","meetingLocation"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"meetingDateTime":{"type":"string","minLength":1},"meetingLocation":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","meetingDateTime":"2 September 2026 at 10:00","meetingLocation":"Head Office, Conference Room 2"}'::jsonb, 'published', '3396db8f9249df5f46a6541878e62a378e391ac95fb41644ca9909d5a745ed54',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_engagement_entrance_meeting', 'Entrance meeting scheduled', 'The entrance meeting for the engagement has been scheduled.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '5c301e9c65d5ca9f1e5ce532d45c516fec0dcbfb9e52bbb92a0544403ba9609d') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Entrance meeting for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nAn entrance meeting has been scheduled for the forthcoming internal audit.\n\nEngagement title: {{payload.engagementTitle}}\nMeeting date time: {{payload.meetingDateTime}}\nMeeting location: {{payload.meetingLocation}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>An entrance meeting has been scheduled for the forthcoming internal audit.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Meeting date time</strong></td><td>{{payload.meetingDateTime}}</td></tr>\n<tr><td><strong>Meeting location</strong></td><td>{{payload.meetingLocation}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '5c301e9c65d5ca9f1e5ce532d45c516fec0dcbfb9e52bbb92a0544403ba9609d',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '4e6793f2ce58945a5756900e8215c0e010f05d0165b3df5daf638291c691577a') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Entrance meeting for audit {{payload.reference}}","body":"An entrance meeting has been scheduled for the forthcoming internal audit. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '4e6793f2ce58945a5756900e8215c0e010f05d0165b3df5daf638291c691577a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ENGAGEMENT.EXIT_MEETING — Exit meeting scheduled
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ENGAGEMENT.EXIT_MEETING';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ENGAGEMENT.EXIT_MEETING', 'INTERNAL_AUDIT', 'ENGAGEMENT', 'Exit meeting scheduled',
       'The exit meeting for the engagement has been scheduled.', 'service', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Exit meeting scheduled', description = 'The exit meeting for the engagement has been scheduled.',
           communication_class = 'service',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '3396db8f9249df5f46a6541878e62a378e391ac95fb41644ca9909d5a745ed54') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","meetingDateTime","meetingLocation"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"meetingDateTime":{"type":"string","minLength":1},"meetingLocation":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","meetingDateTime":"2 September 2026 at 10:00","meetingLocation":"Head Office, Conference Room 2"}'::jsonb, 'published', '3396db8f9249df5f46a6541878e62a378e391ac95fb41644ca9909d5a745ed54',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_engagement_exit_meeting', 'Exit meeting scheduled', 'The exit meeting for the engagement has been scheduled.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '6e78a0df85f8b7e359eb6fb6f9e34b6ae5a013b8dd1f1b732c95b99f12c70b85') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Exit meeting for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nAn exit meeting has been scheduled to discuss the audit outcome.\n\nEngagement title: {{payload.engagementTitle}}\nMeeting date time: {{payload.meetingDateTime}}\nMeeting location: {{payload.meetingLocation}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>An exit meeting has been scheduled to discuss the audit outcome.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Meeting date time</strong></td><td>{{payload.meetingDateTime}}</td></tr>\n<tr><td><strong>Meeting location</strong></td><td>{{payload.meetingLocation}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '6e78a0df85f8b7e359eb6fb6f9e34b6ae5a013b8dd1f1b732c95b99f12c70b85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'e6878cf953eb8f168b458ee81bd3773a6d949e270d90208794674959d946e445') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Exit meeting for audit {{payload.reference}}","body":"An exit meeting has been scheduled to discuss the audit outcome. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'e6878cf953eb8f168b458ee81bd3773a6d949e270d90208794674959d946e445',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ENGAGEMENT.FIELDWORK_COMPLETED — Fieldwork completed
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ENGAGEMENT.FIELDWORK_COMPLETED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ENGAGEMENT.FIELDWORK_COMPLETED', 'INTERNAL_AUDIT', 'ENGAGEMENT', 'Fieldwork completed',
       'Fieldwork on the engagement has been concluded.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Fieldwork completed', description = 'Fieldwork on the engagement has been concluded.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'bd86cd725d497fbbd5e80debfac2e36607b75e23d26610b79fbb0a2f43a0b604') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","completedOn","findingCount"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"completedOn":{"type":"string","minLength":1},"findingCount":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","completedOn":"26 September 2026","findingCount":"6"}'::jsonb, 'published', 'bd86cd725d497fbbd5e80debfac2e36607b75e23d26610b79fbb0a2f43a0b604',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_engagement_fieldwork_completed', 'Fieldwork completed', 'Fieldwork on the engagement has been concluded.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '768636e406367964108cca22477364f5c873ef52ccfb6adb44ce6cf61a508e7c') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Fieldwork completed for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nFieldwork has been completed and the engagement is moving to reporting.\n\nEngagement title: {{payload.engagementTitle}}\nCompleted on: {{payload.completedOn}}\nFinding count: {{payload.findingCount}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>Fieldwork has been completed and the engagement is moving to reporting.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Completed on</strong></td><td>{{payload.completedOn}}</td></tr>\n<tr><td><strong>Finding count</strong></td><td>{{payload.findingCount}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '768636e406367964108cca22477364f5c873ef52ccfb6adb44ce6cf61a508e7c',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '637e8059e506ee02f34adc13bf2fbc136284363eee45ba9293b17aea3efc6ea9') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Fieldwork completed for audit {{payload.reference}}","body":"Fieldwork has been completed and the engagement is moving to reporting. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '637e8059e506ee02f34adc13bf2fbc136284363eee45ba9293b17aea3efc6ea9',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ENGAGEMENT.CLOSED — Audit engagement closed
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ENGAGEMENT.CLOSED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ENGAGEMENT.CLOSED', 'INTERNAL_AUDIT', 'ENGAGEMENT', 'Audit engagement closed',
       'The engagement has satisfied all closure conditions and is closed.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Audit engagement closed', description = 'The engagement has satisfied all closure conditions and is closed.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '5e430dbf6587e32f9d81ce75ce928ad6508ecd053f7b6b82cfde3293af08dde9') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","closedOn","openActionCount"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"closedOn":{"type":"string","minLength":1},"openActionCount":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","closedOn":"15 December 2026","openActionCount":"2"}'::jsonb, 'published', '5e430dbf6587e32f9d81ce75ce928ad6508ecd053f7b6b82cfde3293af08dde9',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_engagement_closed', 'Audit engagement closed', 'The engagement has satisfied all closure conditions and is closed.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '8e85a2bf1e592373e2b72eacfe45598c8b3055d20bc4873395baacfb9590788d') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Audit engagement {{payload.reference}} closed","text":"Dear {{payload.subjectName}},\n\nThe audit engagement has been closed.\n\nEngagement title: {{payload.engagementTitle}}\nClosed on: {{payload.closedOn}}\nOpen action count: {{payload.openActionCount}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The audit engagement has been closed.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Closed on</strong></td><td>{{payload.closedOn}}</td></tr>\n<tr><td><strong>Open action count</strong></td><td>{{payload.openActionCount}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '8e85a2bf1e592373e2b72eacfe45598c8b3055d20bc4873395baacfb9590788d',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'ab94382a2ce3a4c291b07e686baec0a00447baa6283f2c5ba2e4af29584d53a1') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Audit engagement {{payload.reference}} closed","body":"The audit engagement has been closed. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'ab94382a2ce3a4c291b07e686baec0a00447baa6283f2c5ba2e4af29584d53a1',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.REQUEST.ISSUED — Information request issued
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.REQUEST.ISSUED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.REQUEST.ISSUED', 'INTERNAL_AUDIT', 'REQUEST', 'Information request issued',
       'An audit information/document request has been issued to the auditee.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Information request issued', description = 'An audit information/document request has been issued to the auditee.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'd34bdde8ed944afd193df11e7b20b6f2c4aa15f7f25bd846e4ec4ef234cfaf86') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","requestSummary","dueDate","engagementTitle"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"requestSummary":{"type":"string","minLength":1},"dueDate":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","requestSummary":"Contribution reconciliation working papers for July 2026","dueDate":"8 September 2026","engagementTitle":"Contributions collection and posting"}'::jsonb, 'published', 'd34bdde8ed944afd193df11e7b20b6f2c4aa15f7f25bd846e4ec4ef234cfaf86',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_request_issued', 'Information request issued', 'An audit information/document request has been issued to the auditee.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'c29bea9f97cc52b58b98879e88ee8723eaf492956efb192ee81adc5098899514') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Information requested for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nThe internal audit team requires the following information.\n\nRequest summary: {{payload.requestSummary}}\nDue date: {{payload.dueDate}}\nEngagement title: {{payload.engagementTitle}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The internal audit team requires the following information.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Request summary</strong></td><td>{{payload.requestSummary}}</td></tr>\n<tr><td><strong>Due date</strong></td><td>{{payload.dueDate}}</td></tr>\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'c29bea9f97cc52b58b98879e88ee8723eaf492956efb192ee81adc5098899514',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '5abd4d994081ea6780f6124647edc73f5376ca1d0a0c94c3a254bde81e4e423b') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Information requested for audit {{payload.reference}}","body":"The internal audit team requires the following information. Request summary: {{payload.requestSummary}}. Reference {{payload.reference}}."}'::jsonb, 'published', '5abd4d994081ea6780f6124647edc73f5376ca1d0a0c94c3a254bde81e4e423b',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.REQUEST.REMINDER — Information request reminder
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.REQUEST.REMINDER';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.REQUEST.REMINDER', 'INTERNAL_AUDIT', 'REQUEST', 'Information request reminder',
       'A reminder that an outstanding information request is approaching its due date.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Information request reminder', description = 'A reminder that an outstanding information request is approaching its due date.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'fdbb3ccd34112abd664d547be95a421eb977ae0c52ab23ecb1e2341c84009190') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","requestSummary","dueDate","daysRemaining"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"requestSummary":{"type":"string","minLength":1},"dueDate":{"type":"string","minLength":1},"daysRemaining":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","requestSummary":"Contribution reconciliation working papers for July 2026","dueDate":"8 September 2026","daysRemaining":"3"}'::jsonb, 'published', 'fdbb3ccd34112abd664d547be95a421eb977ae0c52ab23ecb1e2341c84009190',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_request_reminder', 'Information request reminder', 'A reminder that an outstanding information request is approaching its due date.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'e15175b67b39de81fe438a4ef67e6ba09400be543fbfd081c73996c2ee37d351') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Reminder: information outstanding for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nThe following information request is still outstanding.\n\nRequest summary: {{payload.requestSummary}}\nDue date: {{payload.dueDate}}\nDays remaining: {{payload.daysRemaining}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The following information request is still outstanding.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Request summary</strong></td><td>{{payload.requestSummary}}</td></tr>\n<tr><td><strong>Due date</strong></td><td>{{payload.dueDate}}</td></tr>\n<tr><td><strong>Days remaining</strong></td><td>{{payload.daysRemaining}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'e15175b67b39de81fe438a4ef67e6ba09400be543fbfd081c73996c2ee37d351',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '45abb34e8cabd14916cafe5f6ef70c247b2666f2ddb3bc812185076e9326c17a') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Reminder: information outstanding for audit {{payload.reference}}","body":"The following information request is still outstanding. Request summary: {{payload.requestSummary}}. Reference {{payload.reference}}."}'::jsonb, 'published', '45abb34e8cabd14916cafe5f6ef70c247b2666f2ddb3bc812185076e9326c17a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.REQUEST.OVERDUE — Information request overdue
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.REQUEST.OVERDUE';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.REQUEST.OVERDUE', 'INTERNAL_AUDIT', 'REQUEST', 'Information request overdue',
       'An information request has passed its due date without a complete response.', 'transactional', 'urgent',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Information request overdue', description = 'An information request has passed its due date without a complete response.',
           communication_class = 'transactional',
           default_priority = 'urgent', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'e828b5925a3222f60d8249c86847eca26031146b12fc1fa5df8c6f4f19518aa3') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","requestSummary","dueDate","daysOverdue"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"requestSummary":{"type":"string","minLength":1},"dueDate":{"type":"string","minLength":1},"daysOverdue":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","requestSummary":"Contribution reconciliation working papers for July 2026","dueDate":"8 September 2026","daysOverdue":"5"}'::jsonb, 'published', 'e828b5925a3222f60d8249c86847eca26031146b12fc1fa5df8c6f4f19518aa3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_request_overdue', 'Information request overdue', 'An information request has passed its due date without a complete response.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '23abc1e0e3a96ea5f6408276ea824e4d900614401a0cb720f501fcfe6aa3c9b9') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Overdue: information request for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nAn information request required by the internal audit team is now overdue.\n\nRequest summary: {{payload.requestSummary}}\nDue date: {{payload.dueDate}}\nDays overdue: {{payload.daysOverdue}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>An information request required by the internal audit team is now overdue.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Request summary</strong></td><td>{{payload.requestSummary}}</td></tr>\n<tr><td><strong>Due date</strong></td><td>{{payload.dueDate}}</td></tr>\n<tr><td><strong>Days overdue</strong></td><td>{{payload.daysOverdue}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '23abc1e0e3a96ea5f6408276ea824e4d900614401a0cb720f501fcfe6aa3c9b9',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '98b56280636f5dacabc15116549de417941088609f9e192d7af66976aca87bc5') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Overdue: information request for audit {{payload.reference}}","body":"An information request required by the internal audit team is now overdue. Request summary: {{payload.requestSummary}}. Reference {{payload.reference}}."}'::jsonb, 'published', '98b56280636f5dacabc15116549de417941088609f9e192d7af66976aca87bc5',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FINDING.RAISED — Audit finding raised
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FINDING.RAISED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FINDING.RAISED', 'INTERNAL_AUDIT', 'FINDING', 'Audit finding raised',
       'A new audit finding has been recorded against the engagement.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Audit finding raised', description = 'A new audit finding has been recorded against the engagement.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'd32c421fbb3f72cee1539c2e80fb6dc573471697b725fb6f690094af161fa959') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","findingTitle","severity","engagementTitle","raisedOn"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"findingTitle":{"type":"string","minLength":1},"severity":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"raisedOn":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","findingTitle":"Contribution reconciliations were not independently reviewed","severity":"High","engagementTitle":"Contributions collection and posting","raisedOn":"15 September 2026"}'::jsonb, 'published', 'd32c421fbb3f72cee1539c2e80fb6dc573471697b725fb6f690094af161fa959',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_finding_raised', 'Audit finding raised', 'A new audit finding has been recorded against the engagement.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'a7c46db882bfadd78394db57b5a464c734ae134dc901be72e975e688e1d0109e') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Finding {{payload.reference}} raised","text":"Dear {{payload.subjectName}},\n\nA new audit finding has been raised.\n\nFinding title: {{payload.findingTitle}}\nSeverity: {{payload.severity}}\nEngagement title: {{payload.engagementTitle}}\nRaised on: {{payload.raisedOn}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A new audit finding has been raised.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Finding title</strong></td><td>{{payload.findingTitle}}</td></tr>\n<tr><td><strong>Severity</strong></td><td>{{payload.severity}}</td></tr>\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Raised on</strong></td><td>{{payload.raisedOn}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'a7c46db882bfadd78394db57b5a464c734ae134dc901be72e975e688e1d0109e',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'd959c0d30abc51bad31c16fbe372d98c7b97ef0bdd66e3f27952db599d79dd78') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Finding {{payload.reference}} raised","body":"A new audit finding has been raised. Finding title: {{payload.findingTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'd959c0d30abc51bad31c16fbe372d98c7b97ef0bdd66e3f27952db599d79dd78',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FINDING.SEVERITY_CHANGED — Finding severity changed
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FINDING.SEVERITY_CHANGED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FINDING.SEVERITY_CHANGED', 'INTERNAL_AUDIT', 'FINDING', 'Finding severity changed',
       'The severity rating of an audit finding has been changed.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Finding severity changed', description = 'The severity rating of an audit finding has been changed.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'cc24d9b83e853e0be97724995431c7ba942966766b11e57eca124566f8baf150') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","findingTitle","previousSeverity","severity","changeReason"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"findingTitle":{"type":"string","minLength":1},"previousSeverity":{"type":"string","minLength":1},"severity":{"type":"string","minLength":1},"changeReason":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","findingTitle":"Contribution reconciliations were not independently reviewed","previousSeverity":"Medium","severity":"High","changeReason":"Additional exceptions were identified during testing"}'::jsonb, 'published', 'cc24d9b83e853e0be97724995431c7ba942966766b11e57eca124566f8baf150',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_finding_severity_changed', 'Finding severity changed', 'The severity rating of an audit finding has been changed.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '7603bd3cb795058f7105bf1bc28d821acdeb71cc6f1a02aef3ea59de9ebacffb') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Severity changed on finding {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nThe severity of an audit finding has been reassessed.\n\nFinding title: {{payload.findingTitle}}\nPrevious severity: {{payload.previousSeverity}}\nSeverity: {{payload.severity}}\nChange reason: {{payload.changeReason}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The severity of an audit finding has been reassessed.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Finding title</strong></td><td>{{payload.findingTitle}}</td></tr>\n<tr><td><strong>Previous severity</strong></td><td>{{payload.previousSeverity}}</td></tr>\n<tr><td><strong>Severity</strong></td><td>{{payload.severity}}</td></tr>\n<tr><td><strong>Change reason</strong></td><td>{{payload.changeReason}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '7603bd3cb795058f7105bf1bc28d821acdeb71cc6f1a02aef3ea59de9ebacffb',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '3c52c0333ad7606407a34af91433308c3842fb706e7f5d5746d20534220cb4c5') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Severity changed on finding {{payload.reference}}","body":"The severity of an audit finding has been reassessed. Finding title: {{payload.findingTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '3c52c0333ad7606407a34af91433308c3842fb706e7f5d5746d20534220cb4c5',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED — Management response requested
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED', 'INTERNAL_AUDIT', 'FINDING', 'Management response requested',
       'A management response has been requested for an audit finding.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Management response requested', description = 'A management response has been requested for an audit finding.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'a0b857bb45700802abc98b793bcda22c3365bbf40195583eb94094a9f37f123a') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","findingTitle","severity","dueDate"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"findingTitle":{"type":"string","minLength":1},"severity":{"type":"string","minLength":1},"dueDate":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","findingTitle":"Contribution reconciliations were not independently reviewed","severity":"High","dueDate":"8 September 2026"}'::jsonb, 'published', 'a0b857bb45700802abc98b793bcda22c3365bbf40195583eb94094a9f37f123a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_finding_response_requested', 'Management response requested', 'A management response has been requested for an audit finding.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'af5243aef7f2383c67ba7318ce7cf227bc4932e0520ec433d438f20fd70110cd') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Management response required for finding {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nA management response is required for the following audit finding.\n\nFinding title: {{payload.findingTitle}}\nSeverity: {{payload.severity}}\nDue date: {{payload.dueDate}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A management response is required for the following audit finding.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Finding title</strong></td><td>{{payload.findingTitle}}</td></tr>\n<tr><td><strong>Severity</strong></td><td>{{payload.severity}}</td></tr>\n<tr><td><strong>Due date</strong></td><td>{{payload.dueDate}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'af5243aef7f2383c67ba7318ce7cf227bc4932e0520ec433d438f20fd70110cd',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'dcb7a218e1019dc70ec9537eb8e2161b439a40b4e2b626af003567661e7c185a') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Management response required for finding {{payload.reference}}","body":"A management response is required for the following audit finding. Finding title: {{payload.findingTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'dcb7a218e1019dc70ec9537eb8e2161b439a40b4e2b626af003567661e7c185a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FINDING.RESPONSE_SUBMITTED — Management response submitted
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FINDING.RESPONSE_SUBMITTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FINDING.RESPONSE_SUBMITTED', 'INTERNAL_AUDIT', 'FINDING', 'Management response submitted',
       'Management has submitted its response to an audit finding.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Management response submitted', description = 'Management has submitted its response to an audit finding.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '948a9f30469e6b7d99d88b46edfa69cf5c8ef46f24d1e25abe2a0238524913c1') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","findingTitle","submittedOn","responseSummary"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"findingTitle":{"type":"string","minLength":1},"submittedOn":{"type":"string","minLength":1},"responseSummary":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","findingTitle":"Contribution reconciliations were not independently reviewed","submittedOn":"14 August 2026","responseSummary":"A monthly independent review will be introduced from October 2026"}'::jsonb, 'published', '948a9f30469e6b7d99d88b46edfa69cf5c8ef46f24d1e25abe2a0238524913c1',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_finding_response_submitted', 'Management response submitted', 'Management has submitted its response to an audit finding.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '54754821d12f6cd624cebe5a532a8e1f1dbb2daf84eba5b3ee0aa68bb6f61200') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Management response submitted for finding {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nA management response has been submitted and awaits audit review.\n\nFinding title: {{payload.findingTitle}}\nSubmitted on: {{payload.submittedOn}}\nResponse summary: {{payload.responseSummary}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A management response has been submitted and awaits audit review.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Finding title</strong></td><td>{{payload.findingTitle}}</td></tr>\n<tr><td><strong>Submitted on</strong></td><td>{{payload.submittedOn}}</td></tr>\n<tr><td><strong>Response summary</strong></td><td>{{payload.responseSummary}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '54754821d12f6cd624cebe5a532a8e1f1dbb2daf84eba5b3ee0aa68bb6f61200',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '5d117109772a8cbb450161a16f0741580b3d0a68aa7e1555ea7f526899e1781f') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Management response submitted for finding {{payload.reference}}","body":"A management response has been submitted and awaits audit review. Finding title: {{payload.findingTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '5d117109772a8cbb450161a16f0741580b3d0a68aa7e1555ea7f526899e1781f',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FINDING.RESPONSE_ACCEPTED — Management response accepted
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FINDING.RESPONSE_ACCEPTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FINDING.RESPONSE_ACCEPTED', 'INTERNAL_AUDIT', 'FINDING', 'Management response accepted',
       'Internal Audit accepted the management response to a finding.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Management response accepted', description = 'Internal Audit accepted the management response to a finding.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'f7a447f6f591d94bfa60ee03b3a3ab7f4286e5722f7ff1e0bee1dcfb42bffe07') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","findingTitle","decidedOn","reviewerComment"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"findingTitle":{"type":"string","minLength":1},"decidedOn":{"type":"string","minLength":1},"reviewerComment":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","findingTitle":"Contribution reconciliations were not independently reviewed","decidedOn":"19 August 2026","reviewerComment":"The proposed control addresses the root cause"}'::jsonb, 'published', 'f7a447f6f591d94bfa60ee03b3a3ab7f4286e5722f7ff1e0bee1dcfb42bffe07',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_finding_response_accepted', 'Management response accepted', 'Internal Audit accepted the management response to a finding.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'dd09f724366ace3c7e3eb42506f17a2d982c73ee5d9bf9948e2d44c5dbb7822b') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Management response accepted for finding {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nInternal Audit has accepted the management response.\n\nFinding title: {{payload.findingTitle}}\nDecided on: {{payload.decidedOn}}\nReviewer comment: {{payload.reviewerComment}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>Internal Audit has accepted the management response.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Finding title</strong></td><td>{{payload.findingTitle}}</td></tr>\n<tr><td><strong>Decided on</strong></td><td>{{payload.decidedOn}}</td></tr>\n<tr><td><strong>Reviewer comment</strong></td><td>{{payload.reviewerComment}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'dd09f724366ace3c7e3eb42506f17a2d982c73ee5d9bf9948e2d44c5dbb7822b',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'e4916013c40d53bfa671b97e1fac19b7aa83f0cf45621f292237df2dbbac555f') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Management response accepted for finding {{payload.reference}}","body":"Internal Audit has accepted the management response. Finding title: {{payload.findingTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'e4916013c40d53bfa671b97e1fac19b7aa83f0cf45621f292237df2dbbac555f',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FINDING.RESPONSE_REJECTED — Management response returned
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FINDING.RESPONSE_REJECTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FINDING.RESPONSE_REJECTED', 'INTERNAL_AUDIT', 'FINDING', 'Management response returned',
       'Internal Audit returned the management response for rework.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Management response returned', description = 'Internal Audit returned the management response for rework.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '3ddca9d81333de34e54bbddbe596eea3eff2c732e6d4f0447d2471a1b890a554') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","findingTitle","decidedOn","reviewerComment","dueDate"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"findingTitle":{"type":"string","minLength":1},"decidedOn":{"type":"string","minLength":1},"reviewerComment":{"type":"string","minLength":1},"dueDate":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","findingTitle":"Contribution reconciliations were not independently reviewed","decidedOn":"19 August 2026","reviewerComment":"The proposed control addresses the root cause","dueDate":"8 September 2026"}'::jsonb, 'published', '3ddca9d81333de34e54bbddbe596eea3eff2c732e6d4f0447d2471a1b890a554',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_finding_response_rejected', 'Management response returned', 'Internal Audit returned the management response for rework.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '61a50902e0f81e0afdb8d720b3eee9cb7a506b1095c37800d73d6c7ccb77e0cb') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Management response returned for finding {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nInternal Audit has returned the management response for rework.\n\nFinding title: {{payload.findingTitle}}\nDecided on: {{payload.decidedOn}}\nReviewer comment: {{payload.reviewerComment}}\nDue date: {{payload.dueDate}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>Internal Audit has returned the management response for rework.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Finding title</strong></td><td>{{payload.findingTitle}}</td></tr>\n<tr><td><strong>Decided on</strong></td><td>{{payload.decidedOn}}</td></tr>\n<tr><td><strong>Reviewer comment</strong></td><td>{{payload.reviewerComment}}</td></tr>\n<tr><td><strong>Due date</strong></td><td>{{payload.dueDate}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '61a50902e0f81e0afdb8d720b3eee9cb7a506b1095c37800d73d6c7ccb77e0cb',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '6ad88ea15f803c835361943c9fb7aac381e254e5d06543e4c74c3367f8ffc39a') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Management response returned for finding {{payload.reference}}","body":"Internal Audit has returned the management response for rework. Finding title: {{payload.findingTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '6ad88ea15f803c835361943c9fb7aac381e254e5d06543e4c74c3367f8ffc39a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.REPORT.DRAFT_CIRCULATED — Draft audit report circulated
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.REPORT.DRAFT_CIRCULATED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.REPORT.DRAFT_CIRCULATED', 'INTERNAL_AUDIT', 'REPORT', 'Draft audit report circulated',
       'A draft audit report version has been circulated for comment.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Draft audit report circulated', description = 'A draft audit report version has been circulated for comment.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'aebc8cd01910e16e8a2aaad2d1c5ecb4c2e6cec9267705ac13494d17a591e6d0') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","versionNumber","commentDueDate"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"versionNumber":{"type":"string","minLength":1},"commentDueDate":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","versionNumber":"2","commentDueDate":"10 October 2026"}'::jsonb, 'published', 'aebc8cd01910e16e8a2aaad2d1c5ecb4c2e6cec9267705ac13494d17a591e6d0',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_report_draft_circulated', 'Draft audit report circulated', 'A draft audit report version has been circulated for comment.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '9415fc969285be77996b156f70927248b037ac42e3bcd8818841575bba61009a') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Draft audit report {{payload.reference}} circulated","text":"Dear {{payload.subjectName}},\n\nA draft internal audit report has been circulated for your comment.\n\nEngagement title: {{payload.engagementTitle}}\nVersion number: {{payload.versionNumber}}\nComment due date: {{payload.commentDueDate}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A draft internal audit report has been circulated for your comment.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Version number</strong></td><td>{{payload.versionNumber}}</td></tr>\n<tr><td><strong>Comment due date</strong></td><td>{{payload.commentDueDate}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '9415fc969285be77996b156f70927248b037ac42e3bcd8818841575bba61009a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '0829af42ce0bb7ad406f693606994d83f3f6ff1887f62a9e1cd1e36f165e37bc') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Draft audit report {{payload.reference}} circulated","body":"A draft internal audit report has been circulated for your comment. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '0829af42ce0bb7ad406f693606994d83f3f6ff1887f62a9e1cd1e36f165e37bc',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.REPORT.QA_REQUESTED — Quality review requested
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.REPORT.QA_REQUESTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.REPORT.QA_REQUESTED', 'INTERNAL_AUDIT', 'REPORT', 'Quality review requested',
       'A quality assurance review has been requested on the engagement report.', 'operational', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Quality review requested', description = 'A quality assurance review has been requested on the engagement report.',
           communication_class = 'operational',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '7b65b759c62bd3c91b271899c05259a2804e23d1d2152156afa5008db08684ee') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","requestedOn","dueDate"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"requestedOn":{"type":"string","minLength":1},"dueDate":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","requestedOn":"20 August 2026","dueDate":"8 September 2026"}'::jsonb, 'published', '7b65b759c62bd3c91b271899c05259a2804e23d1d2152156afa5008db08684ee',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_report_qa_requested', 'Quality review requested', 'A quality assurance review has been requested on the engagement report.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '7c1008e8d3d5aaeecfe1f6547d387df6ea317b0bb0e0b0e75ecbaa2ddf3ca8a9') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Quality review requested for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nA quality assurance review has been assigned to you.\n\nEngagement title: {{payload.engagementTitle}}\nRequested on: {{payload.requestedOn}}\nDue date: {{payload.dueDate}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A quality assurance review has been assigned to you.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Requested on</strong></td><td>{{payload.requestedOn}}</td></tr>\n<tr><td><strong>Due date</strong></td><td>{{payload.dueDate}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '7c1008e8d3d5aaeecfe1f6547d387df6ea317b0bb0e0b0e75ecbaa2ddf3ca8a9',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '5e5aca686f5ca485a5d1ad17e22a68330263096036ae1808e5c75ba82eb8d076') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Quality review requested for audit {{payload.reference}}","body":"A quality assurance review has been assigned to you. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '5e5aca686f5ca485a5d1ad17e22a68330263096036ae1808e5c75ba82eb8d076',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.REPORT.QA_CLEARED — Quality review concluded
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.REPORT.QA_CLEARED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.REPORT.QA_CLEARED', 'INTERNAL_AUDIT', 'REPORT', 'Quality review concluded',
       'The quality assurance review has been concluded.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Quality review concluded', description = 'The quality assurance review has been concluded.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '27d5ec96a5cac1a3b67031819a414a10301b1038117b9f7ec2d25d3a806c00a5') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","concludedOn","qaOutcome"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"concludedOn":{"type":"string","minLength":1},"qaOutcome":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","concludedOn":"Not stated","qaOutcome":"Cleared with no matters outstanding"}'::jsonb, 'published', '27d5ec96a5cac1a3b67031819a414a10301b1038117b9f7ec2d25d3a806c00a5',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_report_qa_cleared', 'Quality review concluded', 'The quality assurance review has been concluded.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '4498db377b93793a73e2d05b39ed8321d7c2b079975738477e0ae162668a76e4') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Quality review concluded for audit {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nThe quality assurance review has been concluded.\n\nEngagement title: {{payload.engagementTitle}}\nConcluded on: {{payload.concludedOn}}\nQa outcome: {{payload.qaOutcome}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The quality assurance review has been concluded.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Concluded on</strong></td><td>{{payload.concludedOn}}</td></tr>\n<tr><td><strong>Qa outcome</strong></td><td>{{payload.qaOutcome}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '4498db377b93793a73e2d05b39ed8321d7c2b079975738477e0ae162668a76e4',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'ac498e94b67bcd8792b45fb5be3c57a1fd7568bf4b3003b446e32e410a46cb07') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Quality review concluded for audit {{payload.reference}}","body":"The quality assurance review has been concluded. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'ac498e94b67bcd8792b45fb5be3c57a1fd7568bf4b3003b446e32e410a46cb07',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.REPORT.ISSUED — Final audit report issued
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.REPORT.ISSUED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.REPORT.ISSUED', 'INTERNAL_AUDIT', 'REPORT', 'Final audit report issued',
       'The final audit report has been formally issued.', 'legal_mandatory', 'urgent',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Final audit report issued', description = 'The final audit report has been formally issued.',
           communication_class = 'legal_mandatory',
           default_priority = 'urgent', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '4521f0132a04046d7edb7136f12df8b14bd0c2edb615fc33600f90b709060cd6') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","engagementTitle","issuedOn","versionNumber","overallOpinion"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1},"issuedOn":{"type":"string","minLength":1},"versionNumber":{"type":"string","minLength":1},"overallOpinion":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","engagementTitle":"Contributions collection and posting","issuedOn":"20 October 2026","versionNumber":"2","overallOpinion":"Partially satisfactory"}'::jsonb, 'published', '4521f0132a04046d7edb7136f12df8b14bd0c2edb615fc33600f90b709060cd6',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_report_issued', 'Final audit report issued', 'The final audit report has been formally issued.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '6b6558b858d19946a251ad653eb805b0068193035d6168dedd54e7f8100d19c0') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Final internal audit report {{payload.reference}} issued","text":"Dear {{payload.subjectName}},\n\nThe final internal audit report has been issued.\n\nEngagement title: {{payload.engagementTitle}}\nIssued on: {{payload.issuedOn}}\nVersion number: {{payload.versionNumber}}\nOverall opinion: {{payload.overallOpinion}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The final internal audit report has been issued.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Issued on</strong></td><td>{{payload.issuedOn}}</td></tr>\n<tr><td><strong>Version number</strong></td><td>{{payload.versionNumber}}</td></tr>\n<tr><td><strong>Overall opinion</strong></td><td>{{payload.overallOpinion}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '6b6558b858d19946a251ad653eb805b0068193035d6168dedd54e7f8100d19c0',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '9e498cb8cc3fc9dc411ce34df3522e3e857e208460f88ec052f8ba887f529d26') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Final internal audit report {{payload.reference}} issued","body":"The final internal audit report has been issued. Engagement title: {{payload.engagementTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '9e498cb8cc3fc9dc411ce34df3522e3e857e208460f88ec052f8ba887f529d26',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.ASSIGNED — Corrective action assigned
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.ASSIGNED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.ASSIGNED', 'INTERNAL_AUDIT', 'ACTION', 'Corrective action assigned',
       'A corrective action has been assigned to an action owner.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Corrective action assigned', description = 'A corrective action has been assigned to an action owner.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '6df42c779f8382c1120e01653a6cdcb4a738e5f4903a1bc3089f3e59d20d4b1f') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","severity","targetDate","engagementTitle"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"severity":{"type":"string","minLength":1},"targetDate":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","severity":"High","targetDate":"30 November 2026","engagementTitle":"Contributions collection and posting"}'::jsonb, 'published', '6df42c779f8382c1120e01653a6cdcb4a738e5f4903a1bc3089f3e59d20d4b1f',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_assigned', 'Corrective action assigned', 'A corrective action has been assigned to an action owner.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'ef5ba7bb516ae69f5224a4d08d160e16f3015f4bb4f8cb25743a3a25f70293b4') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Corrective action {{payload.reference}} assigned to you","text":"Dear {{payload.subjectName}},\n\nA corrective action arising from an internal audit has been assigned to you.\n\nAction title: {{payload.actionTitle}}\nSeverity: {{payload.severity}}\nTarget date: {{payload.targetDate}}\nEngagement title: {{payload.engagementTitle}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A corrective action arising from an internal audit has been assigned to you.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Severity</strong></td><td>{{payload.severity}}</td></tr>\n<tr><td><strong>Target date</strong></td><td>{{payload.targetDate}}</td></tr>\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'ef5ba7bb516ae69f5224a4d08d160e16f3015f4bb4f8cb25743a3a25f70293b4',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'ca760a4edad20cb9f6d744c7e0bd43d3946a1302a4a92b6cac5b2b856ac29478') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Corrective action {{payload.reference}} assigned to you","body":"A corrective action arising from an internal audit has been assigned to you. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'ca760a4edad20cb9f6d744c7e0bd43d3946a1302a4a92b6cac5b2b856ac29478',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.DUE_SOON — Corrective action due soon
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.DUE_SOON';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.DUE_SOON', 'INTERNAL_AUDIT', 'ACTION', 'Corrective action due soon',
       'A corrective action is approaching its agreed target date.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Corrective action due soon', description = 'A corrective action is approaching its agreed target date.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'b2ed23abe807142606e908703e743c70aa49fd3b5cb17aecee901de7992953c1') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","targetDate","daysRemaining"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"targetDate":{"type":"string","minLength":1},"daysRemaining":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","targetDate":"30 November 2026","daysRemaining":"3"}'::jsonb, 'published', 'b2ed23abe807142606e908703e743c70aa49fd3b5cb17aecee901de7992953c1',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_due_soon', 'Corrective action due soon', 'A corrective action is approaching its agreed target date.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'bc0cbe965a76b1c0996fb6f6663fe21e0d1b60f354da70757c5f1273da9f26e2') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Corrective action {{payload.reference}} is due soon","text":"Dear {{payload.subjectName}},\n\nA corrective action assigned to you is approaching its target date.\n\nAction title: {{payload.actionTitle}}\nTarget date: {{payload.targetDate}}\nDays remaining: {{payload.daysRemaining}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A corrective action assigned to you is approaching its target date.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Target date</strong></td><td>{{payload.targetDate}}</td></tr>\n<tr><td><strong>Days remaining</strong></td><td>{{payload.daysRemaining}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'bc0cbe965a76b1c0996fb6f6663fe21e0d1b60f354da70757c5f1273da9f26e2',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '3ce0afb67ab0e96556651450ebc95160c08c85c53e86d4fb44d2855fb5326d76') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Corrective action {{payload.reference}} is due soon","body":"A corrective action assigned to you is approaching its target date. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '3ce0afb67ab0e96556651450ebc95160c08c85c53e86d4fb44d2855fb5326d76',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.OVERDUE — Corrective action overdue
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.OVERDUE';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.OVERDUE', 'INTERNAL_AUDIT', 'ACTION', 'Corrective action overdue',
       'A corrective action has passed its agreed target date.', 'transactional', 'urgent',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Corrective action overdue', description = 'A corrective action has passed its agreed target date.',
           communication_class = 'transactional',
           default_priority = 'urgent', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '51900b02e4e95047c26fa159785ad14a818492bb8eaec4fa1973d3a7fd8a064a') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","targetDate","daysOverdue"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"targetDate":{"type":"string","minLength":1},"daysOverdue":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","targetDate":"30 November 2026","daysOverdue":"5"}'::jsonb, 'published', '51900b02e4e95047c26fa159785ad14a818492bb8eaec4fa1973d3a7fd8a064a',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_overdue', 'Corrective action overdue', 'A corrective action has passed its agreed target date.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '28128abc4c2f6001a533af0185270454b454a95aebbc028056f42a036dc0d8c9') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Corrective action {{payload.reference}} is overdue","text":"Dear {{payload.subjectName}},\n\nA corrective action assigned to you is now overdue.\n\nAction title: {{payload.actionTitle}}\nTarget date: {{payload.targetDate}}\nDays overdue: {{payload.daysOverdue}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A corrective action assigned to you is now overdue.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Target date</strong></td><td>{{payload.targetDate}}</td></tr>\n<tr><td><strong>Days overdue</strong></td><td>{{payload.daysOverdue}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '28128abc4c2f6001a533af0185270454b454a95aebbc028056f42a036dc0d8c9',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '3fbdb3022c820a01a76416da0d1e796d272e607a734a4b452a04134c8ffb367b') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Corrective action {{payload.reference}} is overdue","body":"A corrective action assigned to you is now overdue. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '3fbdb3022c820a01a76416da0d1e796d272e607a734a4b452a04134c8ffb367b',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.ESCALATED — Corrective action escalated
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.ESCALATED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.ESCALATED', 'INTERNAL_AUDIT', 'ACTION', 'Corrective action escalated',
       'An overdue corrective action has been escalated to audit leadership.', 'operational', 'urgent',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Corrective action escalated', description = 'An overdue corrective action has been escalated to audit leadership.',
           communication_class = 'operational',
           default_priority = 'urgent', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'db5b0ce6be02cdf9e4149a442d4872afc94b73df57def873f7a993828a67ee70') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","targetDate","daysOverdue","ownerName"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"targetDate":{"type":"string","minLength":1},"daysOverdue":{"type":"string","minLength":1},"ownerName":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","targetDate":"30 November 2026","daysOverdue":"5","ownerName":"Director of Contributions"}'::jsonb, 'published', 'db5b0ce6be02cdf9e4149a442d4872afc94b73df57def873f7a993828a67ee70',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_escalated', 'Corrective action escalated', 'An overdue corrective action has been escalated to audit leadership.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '27486f25db68a0c4354a7f648acb29854383a75fc742f1a40b69effc76c28889') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Escalation: corrective action {{payload.reference}} overdue","text":"Dear {{payload.subjectName}},\n\nA corrective action remains overdue and has been escalated.\n\nAction title: {{payload.actionTitle}}\nTarget date: {{payload.targetDate}}\nDays overdue: {{payload.daysOverdue}}\nOwner name: {{payload.ownerName}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A corrective action remains overdue and has been escalated.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Target date</strong></td><td>{{payload.targetDate}}</td></tr>\n<tr><td><strong>Days overdue</strong></td><td>{{payload.daysOverdue}}</td></tr>\n<tr><td><strong>Owner name</strong></td><td>{{payload.ownerName}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '27486f25db68a0c4354a7f648acb29854383a75fc742f1a40b69effc76c28889',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '7ef84749b3977cef113bdacf0288a5579ff5cd578b1d10ae67182c14611c4520') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Escalation: corrective action {{payload.reference}} overdue","body":"A corrective action remains overdue and has been escalated. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '7ef84749b3977cef113bdacf0288a5579ff5cd578b1d10ae67182c14611c4520',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED — Action progress recorded
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED', 'INTERNAL_AUDIT', 'ACTION', 'Action progress recorded',
       'The action owner has recorded progress against a corrective action.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Action progress recorded', description = 'The action owner has recorded progress against a corrective action.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '549ad4936fb9603f19a98cee6d07a02a44ccb6090b5341102603fb498d52a4ac') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","progressPercent","progressNote"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"progressPercent":{"type":"string","minLength":1},"progressNote":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","progressPercent":"60","progressNote":"Reviewer appointed and procedure drafted"}'::jsonb, 'published', '549ad4936fb9603f19a98cee6d07a02a44ccb6090b5341102603fb498d52a4ac',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_progress_recorded', 'Action progress recorded', 'The action owner has recorded progress against a corrective action.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'cb106b91f1cc2035365b6b3270f838ccce319ff1a40e9d659654dd89ae7568e3') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Progress recorded on action {{payload.reference}}","body":"Progress has been recorded against a corrective action. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'cb106b91f1cc2035365b6b3270f838ccce319ff1a40e9d659654dd89ae7568e3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.COMPLETION_SUBMITTED — Action completion submitted
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.COMPLETION_SUBMITTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.COMPLETION_SUBMITTED', 'INTERNAL_AUDIT', 'ACTION', 'Action completion submitted',
       'Management has submitted a corrective action as complete, awaiting verification.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Action completion submitted', description = 'Management has submitted a corrective action as complete, awaiting verification.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '003f0a6ddccc315819327e9f16376430adfa6fdb88c18174ce379c1329217fde') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","submittedOn","completionSummary"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"submittedOn":{"type":"string","minLength":1},"completionSummary":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","submittedOn":"14 August 2026","completionSummary":"Procedure issued and first review completed"}'::jsonb, 'published', '003f0a6ddccc315819327e9f16376430adfa6fdb88c18174ce379c1329217fde',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_completion_submitted', 'Action completion submitted', 'Management has submitted a corrective action as complete, awaiting verification.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '2a3932b9f560bc448b7ed38f177783d7426f7a0b6502768e84617516208750b5') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Completion submitted for action {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nA corrective action has been submitted as complete and awaits audit verification.\n\nAction title: {{payload.actionTitle}}\nSubmitted on: {{payload.submittedOn}}\nCompletion summary: {{payload.completionSummary}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A corrective action has been submitted as complete and awaits audit verification.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Submitted on</strong></td><td>{{payload.submittedOn}}</td></tr>\n<tr><td><strong>Completion summary</strong></td><td>{{payload.completionSummary}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '2a3932b9f560bc448b7ed38f177783d7426f7a0b6502768e84617516208750b5',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'de521ef2f3a2f24999b54815ea4c74998f7a63880cd3700fb46c90b65f0ee6a0') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Completion submitted for action {{payload.reference}}","body":"A corrective action has been submitted as complete and awaits audit verification. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'de521ef2f3a2f24999b54815ea4c74998f7a63880cd3700fb46c90b65f0ee6a0',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.VERIFIED — Action verified by Internal Audit
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.VERIFIED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.VERIFIED', 'INTERNAL_AUDIT', 'ACTION', 'Action verified by Internal Audit',
       'Internal Audit verified that the corrective action is effective.', 'transactional', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Action verified by Internal Audit', description = 'Internal Audit verified that the corrective action is effective.',
           communication_class = 'transactional',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'd47115563b8ab32f87202c9f482dcfb90967a4b92a8bff5727d89c22d13e8ff6') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","verifiedOn","verificationComment"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"verifiedOn":{"type":"string","minLength":1},"verificationComment":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","verifiedOn":"5 December 2026","verificationComment":"Evidence inspected for October and November 2026"}'::jsonb, 'published', 'd47115563b8ab32f87202c9f482dcfb90967a4b92a8bff5727d89c22d13e8ff6',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_verified', 'Action verified by Internal Audit', 'Internal Audit verified that the corrective action is effective.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '10ce80e215a71b1aff7ba901853ddf2342952e8c9d6a6ddb05e02bf3ac549bb2') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Corrective action {{payload.reference}} verified","text":"Dear {{payload.subjectName}},\n\nInternal Audit has verified your corrective action as effective.\n\nAction title: {{payload.actionTitle}}\nVerified on: {{payload.verifiedOn}}\nVerification comment: {{payload.verificationComment}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>Internal Audit has verified your corrective action as effective.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Verified on</strong></td><td>{{payload.verifiedOn}}</td></tr>\n<tr><td><strong>Verification comment</strong></td><td>{{payload.verificationComment}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '10ce80e215a71b1aff7ba901853ddf2342952e8c9d6a6ddb05e02bf3ac549bb2',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'f49a5d652d9647aa1d8bb1be1b02d7140441d3bfd9a8a83c56bf5200d049ad63') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Corrective action {{payload.reference}} verified","body":"Internal Audit has verified your corrective action as effective. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'f49a5d652d9647aa1d8bb1be1b02d7140441d3bfd9a8a83c56bf5200d049ad63',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.VERIFICATION_REJECTED — Action verification rejected
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.VERIFICATION_REJECTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.VERIFICATION_REJECTED', 'INTERNAL_AUDIT', 'ACTION', 'Action verification rejected',
       'Internal Audit rejected the claimed completion of a corrective action.', 'transactional', 'urgent',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Action verification rejected', description = 'Internal Audit rejected the claimed completion of a corrective action.',
           communication_class = 'transactional',
           default_priority = 'urgent', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '28c2de19dbe182af0434281c4032d97377e52034c7e560b059ea79b74355c21e') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","decidedOn","rejectionReason","targetDate"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"decidedOn":{"type":"string","minLength":1},"rejectionReason":{"type":"string","minLength":1},"targetDate":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","decidedOn":"19 August 2026","rejectionReason":"Evidence supplied covered one month only","targetDate":"30 November 2026"}'::jsonb, 'published', '28c2de19dbe182af0434281c4032d97377e52034c7e560b059ea79b74355c21e',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_verification_rejected', 'Action verification rejected', 'Internal Audit rejected the claimed completion of a corrective action.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '94fb0191966c68f695c5876b098106dc6c48d2cd89937ec07cbc77c500e05d43') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Verification rejected for action {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nInternal Audit could not verify the completion of your corrective action.\n\nAction title: {{payload.actionTitle}}\nDecided on: {{payload.decidedOn}}\nRejection reason: {{payload.rejectionReason}}\nTarget date: {{payload.targetDate}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>Internal Audit could not verify the completion of your corrective action.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Decided on</strong></td><td>{{payload.decidedOn}}</td></tr>\n<tr><td><strong>Rejection reason</strong></td><td>{{payload.rejectionReason}}</td></tr>\n<tr><td><strong>Target date</strong></td><td>{{payload.targetDate}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '94fb0191966c68f695c5876b098106dc6c48d2cd89937ec07cbc77c500e05d43',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'f4f8480e53af02acf593b5d9611fa815af52a9cbe9eb99d97d198a079885b592') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Verification rejected for action {{payload.reference}}","body":"Internal Audit could not verify the completion of your corrective action. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'f4f8480e53af02acf593b5d9611fa815af52a9cbe9eb99d97d198a079885b592',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.EXTENSION_REQUESTED — Action extension requested
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.EXTENSION_REQUESTED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.EXTENSION_REQUESTED', 'INTERNAL_AUDIT', 'ACTION', 'Action extension requested',
       'An extension to the agreed target date has been requested.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Action extension requested', description = 'An extension to the agreed target date has been requested.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'db2c69b4af328225c61aa249d6e04b6967e04a2b047bb9a73174d1cfb9858bd3') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","targetDate","requestedDate","extensionReason"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"targetDate":{"type":"string","minLength":1},"requestedDate":{"type":"string","minLength":1},"extensionReason":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","targetDate":"30 November 2026","requestedDate":"31 January 2027","extensionReason":"System change required to produce the reconciliation report"}'::jsonb, 'published', 'db2c69b4af328225c61aa249d6e04b6967e04a2b047bb9a73174d1cfb9858bd3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_extension_requested', 'Action extension requested', 'An extension to the agreed target date has been requested.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'f6c144e86de40c54cb7796ac5e18060df00daf3372307190b0f23ca8aebb094c') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Extension requested for action {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nAn extension to a corrective action target date has been requested.\n\nAction title: {{payload.actionTitle}}\nTarget date: {{payload.targetDate}}\nRequested date: {{payload.requestedDate}}\nExtension reason: {{payload.extensionReason}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>An extension to a corrective action target date has been requested.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Target date</strong></td><td>{{payload.targetDate}}</td></tr>\n<tr><td><strong>Requested date</strong></td><td>{{payload.requestedDate}}</td></tr>\n<tr><td><strong>Extension reason</strong></td><td>{{payload.extensionReason}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', 'f6c144e86de40c54cb7796ac5e18060df00daf3372307190b0f23ca8aebb094c',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '304f5e73d803be9cfe74fb353782e1986c6eb12105a160ecba2d5af8d02aa7fb') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Extension requested for action {{payload.reference}}","body":"An extension to a corrective action target date has been requested. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '304f5e73d803be9cfe74fb353782e1986c6eb12105a160ecba2d5af8d02aa7fb',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.EXTENSION_DECIDED — Action extension decided
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.EXTENSION_DECIDED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.EXTENSION_DECIDED', 'INTERNAL_AUDIT', 'ACTION', 'Action extension decided',
       'A decision has been taken on a requested target-date extension.', 'transactional', 'high',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Action extension decided', description = 'A decision has been taken on a requested target-date extension.',
           communication_class = 'transactional',
           default_priority = 'high', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'e5f6095927359e4a94e42293e00795725231d6afa759551923fb26d04af09821') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","extensionOutcome","targetDate","decisionReason"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"extensionOutcome":{"type":"string","minLength":1},"targetDate":{"type":"string","minLength":1},"decisionReason":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","extensionOutcome":"Approved","targetDate":"30 November 2026","decisionReason":"Coverage of the payments cycle was insufficient"}'::jsonb, 'published', 'e5f6095927359e4a94e42293e00795725231d6afa759551923fb26d04af09821',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_extension_decided', 'Action extension decided', 'A decision has been taken on a requested target-date extension.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '8409856afa3c34db331d426776f3b914d488a3436cae0dc7599421634cd49d21') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Extension decision for action {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nA decision has been made on your requested extension.\n\nAction title: {{payload.actionTitle}}\nExtension outcome: {{payload.extensionOutcome}}\nTarget date: {{payload.targetDate}}\nDecision reason: {{payload.decisionReason}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A decision has been made on your requested extension.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Extension outcome</strong></td><td>{{payload.extensionOutcome}}</td></tr>\n<tr><td><strong>Target date</strong></td><td>{{payload.targetDate}}</td></tr>\n<tr><td><strong>Decision reason</strong></td><td>{{payload.decisionReason}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '8409856afa3c34db331d426776f3b914d488a3436cae0dc7599421634cd49d21',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '5dc0b1231b4fa2352d66d68268bdf85196124fd7ac3687f0a35778c2f87cb356') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Extension decision for action {{payload.reference}}","body":"A decision has been made on your requested extension. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '5dc0b1231b4fa2352d66d68268bdf85196124fd7ac3687f0a35778c2f87cb356',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.ACTION.CLOSED — Corrective action closed
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.ACTION.CLOSED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.ACTION.CLOSED', 'INTERNAL_AUDIT', 'ACTION', 'Corrective action closed',
       'A corrective action has been formally closed.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Corrective action closed', description = 'A corrective action has been formally closed.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = 'b328e839a3e09c0cdd44289f38722541e72f5aedd348b4478bb5c20ba2ad702c') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","actionTitle","closedOn","closureBasis"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"actionTitle":{"type":"string","minLength":1},"closedOn":{"type":"string","minLength":1},"closureBasis":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","actionTitle":"Introduce independent monthly reconciliation review","closedOn":"15 December 2026","closureBasis":"Verified effective by Internal Audit"}'::jsonb, 'published', 'b328e839a3e09c0cdd44289f38722541e72f5aedd348b4478bb5c20ba2ad702c',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_action_closed', 'Corrective action closed', 'A corrective action has been formally closed.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '9a17dc98cfac990bc3a05c1531b9048d5a14a22636f12866125b1c3577599fa8') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Corrective action {{payload.reference}} closed","text":"Dear {{payload.subjectName}},\n\nA corrective action has been formally closed.\n\nAction title: {{payload.actionTitle}}\nClosed on: {{payload.closedOn}}\nClosure basis: {{payload.closureBasis}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A corrective action has been formally closed.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Action title</strong></td><td>{{payload.actionTitle}}</td></tr>\n<tr><td><strong>Closed on</strong></td><td>{{payload.closedOn}}</td></tr>\n<tr><td><strong>Closure basis</strong></td><td>{{payload.closureBasis}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '9a17dc98cfac990bc3a05c1531b9048d5a14a22636f12866125b1c3577599fa8',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '8c5f3e04e204c878b824c5fef2278d817e0ea2d6d212db7f13bf9854f011ca10') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Corrective action {{payload.reference}} closed","body":"A corrective action has been formally closed. Action title: {{payload.actionTitle}}. Reference {{payload.reference}}."}'::jsonb, 'published', '8c5f3e04e204c878b824c5fef2278d817e0ea2d6d212db7f13bf9854f011ca10',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FOLLOWUP.SCHEDULED — Follow-up review scheduled
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FOLLOWUP.SCHEDULED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FOLLOWUP.SCHEDULED', 'INTERNAL_AUDIT', 'FOLLOWUP', 'Follow-up review scheduled',
       'A follow-up review has been scheduled for a closed engagement or action.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Follow-up review scheduled', description = 'A follow-up review has been scheduled for a closed engagement or action.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '0714990cfffc6eee51a6f874a812c0ab5c83ae4841508627b217885f45effe83') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","followupSubject","scheduledFor","engagementTitle"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"followupSubject":{"type":"string","minLength":1},"scheduledFor":{"type":"string","minLength":1},"engagementTitle":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","followupSubject":"Contributions reconciliation review","scheduledFor":"15 March 2027","engagementTitle":"Contributions collection and posting"}'::jsonb, 'published', '0714990cfffc6eee51a6f874a812c0ab5c83ae4841508627b217885f45effe83',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_followup_scheduled', 'Follow-up review scheduled', 'A follow-up review has been scheduled for a closed engagement or action.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '5c307d1d725e78d27e1396fe11b530ee054c3a30c7b31bcf5b28d603a5e8ee05') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Follow-up review scheduled — {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nA follow-up review has been scheduled.\n\nFollowup subject: {{payload.followupSubject}}\nScheduled for: {{payload.scheduledFor}}\nEngagement title: {{payload.engagementTitle}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>A follow-up review has been scheduled.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Followup subject</strong></td><td>{{payload.followupSubject}}</td></tr>\n<tr><td><strong>Scheduled for</strong></td><td>{{payload.scheduledFor}}</td></tr>\n<tr><td><strong>Engagement title</strong></td><td>{{payload.engagementTitle}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '5c307d1d725e78d27e1396fe11b530ee054c3a30c7b31bcf5b28d603a5e8ee05',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = 'cb6f8b5feeef8b41cfcab6d16ee418be1ff3f1b45dd26dbecf559062ea76f706') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Follow-up review scheduled — {{payload.reference}}","body":"A follow-up review has been scheduled. Followup subject: {{payload.followupSubject}}. Reference {{payload.reference}}."}'::jsonb, 'published', 'cb6f8b5feeef8b41cfcab6d16ee418be1ff3f1b45dd26dbecf559062ea76f706',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FOLLOWUP.OUTCOME_RECORDED — Follow-up outcome recorded
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FOLLOWUP.OUTCOME_RECORDED';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FOLLOWUP.OUTCOME_RECORDED', 'INTERNAL_AUDIT', 'FOLLOWUP', 'Follow-up outcome recorded',
       'The outcome of a follow-up review has been recorded.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Follow-up outcome recorded', description = 'The outcome of a follow-up review has been recorded.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '9aba85b9cc976c8b12fd7621df5201f190b2dff7fffbf84ae2ab600ef5daabd5') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","followupSubject","recordedOn","followupOutcome"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"followupSubject":{"type":"string","minLength":1},"recordedOn":{"type":"string","minLength":1},"followupOutcome":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","followupSubject":"Contributions reconciliation review","recordedOn":"18 March 2027","followupOutcome":"Implemented and operating effectively"}'::jsonb, 'published', '9aba85b9cc976c8b12fd7621df5201f190b2dff7fffbf84ae2ab600ef5daabd5',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_followup_outcome_recorded', 'Follow-up outcome recorded', 'The outcome of a follow-up review has been recorded.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '31becc623a6bc5b44bc0c7f6154bfecafaabf0f51a4013c7557127cb66ff5581') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Follow-up outcome recorded — {{payload.reference}}","text":"Dear {{payload.subjectName}},\n\nThe outcome of a follow-up review has been recorded.\n\nFollowup subject: {{payload.followupSubject}}\nRecorded on: {{payload.recordedOn}}\nFollowup outcome: {{payload.followupOutcome}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>The outcome of a follow-up review has been recorded.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Followup subject</strong></td><td>{{payload.followupSubject}}</td></tr>\n<tr><td><strong>Recorded on</strong></td><td>{{payload.recordedOn}}</td></tr>\n<tr><td><strong>Followup outcome</strong></td><td>{{payload.followupOutcome}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '31becc623a6bc5b44bc0c7f6154bfecafaabf0f51a4013c7557127cb66ff5581',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '09f1f4010d9cb6941e5ee1f9d98f0b443fcd4111cb2009922ad0b16aebb8f9ce') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Follow-up outcome recorded — {{payload.reference}}","body":"The outcome of a follow-up review has been recorded. Followup subject: {{payload.followupSubject}}. Reference {{payload.reference}}."}'::jsonb, 'published', '09f1f4010d9cb6941e5ee1f9d98f0b443fcd4111cb2009922ad0b16aebb8f9ce',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;

-- INTERNAL_AUDIT.FOLLOWUP.CARRIED_FORWARD — Open matter carried forward
DO $$
DECLARE
  v_event uuid;
  v_family uuid;
  v_version integer;
BEGIN
  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = 'INTERNAL_AUDIT.FOLLOWUP.CARRIED_FORWARD';
  IF v_event IS NULL THEN
    v_event := gen_random_uuid();
    INSERT INTO public.omni_comms_event_definition
      (id, code, module_code, entity_type, name, description, communication_class,
       default_priority, status, created_at, created_by, updated_at, updated_by)
    VALUES (v_event, 'INTERNAL_AUDIT.FOLLOWUP.CARRIED_FORWARD', 'INTERNAL_AUDIT', 'FOLLOWUP', 'Open matter carried forward',
       'An open matter has been carried forward into the next plan year.', 'operational', 'normal',
       'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_definition
       SET name = 'Open matter carried forward', description = 'An open matter has been carried forward into the next plan year.',
           communication_class = 'operational',
           default_priority = 'normal', status = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE id = v_event;
  END IF;

  -- Published event contract (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                  WHERE event_definition_id = v_event AND status = 'published'
                    AND checksum = '5a54b931d5303c9bf4adbfd7fe77506a6cb0bbec31c4d777f31c73b8551d8c2c') THEN
    UPDATE public.omni_comms_event_contract
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;
    INSERT INTO public.omni_comms_event_contract
      (id, event_definition_id, version_number, json_schema, sample_payload, status,
       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)
    VALUES (gen_random_uuid(), v_event, v_version, '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,"required":["subjectName","reference","followupSubject","fromPlanYear","toPlanYear"],"properties":{"subjectName":{"type":"string","minLength":1},"reference":{"type":"string","minLength":1},"followupSubject":{"type":"string","minLength":1},"fromPlanYear":{"type":"string","minLength":1},"toPlanYear":{"type":"string","minLength":1}}}'::jsonb,
       '{"subjectName":"Marcia Liburd","reference":"IA-2026-000117","followupSubject":"Contributions reconciliation review","fromPlanYear":"2026","toPlanYear":"2027"}'::jsonb, 'published', '5a54b931d5303c9bf4adbfd7fe77506a6cb0bbec31c4d777f31c73b8551d8c2c',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Event-scoped template family.
  SELECT id INTO v_family FROM public.omni_comms_template_family
   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;
  IF v_family IS NULL THEN
    v_family := gen_random_uuid();
    INSERT INTO public.omni_comms_template_family
      (id, code, name, description, scope_type, organization_id, department_id,
       event_definition_id, status, activated_at, activated_by, created_at, created_by,
       updated_at, updated_by)
    VALUES (v_family, 'ia_internal_audit_followup_carried_forward', 'Open matter carried forward', 'An open matter has been carried forward into the next plan year.',
       'event', '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, v_event, 'active', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  END IF;

  -- Published email template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'email'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '6aea313e5c9afe38f0d9665bec2f9b57239ed7985e599a9b11a6369231ffd84c') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'email' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'email' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'email', 'en-US',
       '{"subject":"Matter {{payload.reference}} carried forward","text":"Dear {{payload.subjectName}},\n\nAn open audit matter has been carried forward into the next plan year.\n\nFollowup subject: {{payload.followupSubject}}\nFrom plan year: {{payload.fromPlanYear}}\nTo plan year: {{payload.toPlanYear}}\n\nReference: {{payload.reference}}\n\nThis message was issued by the Internal Audit unit of the\nSt. Kitts & Nevis Social Security Board.","html":"<p>Dear {{payload.subjectName}},</p>\n<p>An open audit matter has been carried forward into the next plan year.</p>\n<table role=\"presentation\" cellpadding=\"6\" cellspacing=\"0\">\n<tr><td><strong>Followup subject</strong></td><td>{{payload.followupSubject}}</td></tr>\n<tr><td><strong>From plan year</strong></td><td>{{payload.fromPlanYear}}</td></tr>\n<tr><td><strong>To plan year</strong></td><td>{{payload.toPlanYear}}</td></tr>\n<tr><td><strong>Reference</strong></td><td>{{payload.reference}}</td></tr>\n</table>\n<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>"}'::jsonb, 'published', '6aea313e5c9afe38f0d9665bec2f9b57239ed7985e599a9b11a6369231ffd84c',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2', 'cce3a2af-288a-4a60-b6fe-b0369c8084d7');
  END IF;

  -- Department-scoped email route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'email'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'email', true, true,
       100, v_family, 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'email'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Published in_app template version (content-addressed).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version
                  WHERE template_family_id = v_family AND channel = 'in_app'
                    AND locale = 'en-US' AND status = 'published'
                    AND checksum = '57a320839f3a85c06b4c47d6e42f8dbc65a7cf74193e9f7b7eddca821351b8d3') THEN
    UPDATE public.omni_comms_template_version
       SET status = 'retired', retired_at = now(), retired_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
           retirement_reason = 'Superseded by the generated Internal Audit template library',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE template_family_id = v_family
       AND channel = 'in_app' AND locale = 'en-US' AND status = 'published';
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
      FROM public.omni_comms_template_version
     WHERE template_family_id = v_family AND channel = 'in_app' AND locale = 'en-US';
    INSERT INTO public.omni_comms_template_version
      (id, template_family_id, version_number, channel, locale, content, status, checksum,
       approved_at, approved_by, published_at, published_by, created_at, created_by,
       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)
    VALUES (gen_random_uuid(), v_family, v_version, 'in_app', 'en-US',
       '{"title":"Matter {{payload.reference}} carried forward","body":"An open audit matter has been carried forward into the next plan year. Followup subject: {{payload.followupSubject}}. Reference {{payload.reference}}."}'::jsonb, 'published', '57a320839f3a85c06b4c47d6e42f8dbc65a7cf74193e9f7b7eddca821351b8d3',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), NULL, now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       'pinned', 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f', '3c14453d-b1eb-49dd-9180-ed2b09f6b881');
  END IF;

  -- Department-scoped in_app route.
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route
                  WHERE event_definition_id = v_event AND channel = 'in_app'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_event_route
      (id, organization_id, department_id, event_definition_id, channel, is_required,
       is_enabled, priority, template_family_id, sender_identity_id,
       sender_resolution_policy, preference_policy, lifecycle_state, created_at,
       created_by, updated_at, updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', v_event, 'in_app', true, true,
       200, v_family, '0657bcdc-50d8-44cb-a860-47fdbcade4df', 'explicit', 'honour', 'active',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_event_route
       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND channel = 'in_app'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;

  -- Active INTERNAL_AUDIT producer binding (queued only).
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding
                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
                    AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9') THEN
    INSERT INTO public.omni_comms_producer_event_binding
      (id, organization_id, department_id, caller_module_code, event_definition_id,
       allowed_modes, status, integration_reference, created_at, created_by, updated_at,
       updated_by, activated_at, activated_by)
    VALUES (gen_random_uuid(), '69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'INTERNAL_AUDIT', v_event,
       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', now(), '08655ffc-6bb2-4eea-bc5b-502c52cdcf85');
  ELSE
    UPDATE public.omni_comms_producer_event_binding
       SET status = 'active', allowed_modes = ARRAY['queued']::text[],
           activated_at = COALESCE(activated_at, now()),
           activated_by = COALESCE(activated_by, '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'),
           updated_at = now(), updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'
       AND organization_id = '69afc88b-da5c-4f41-a1e7-199e1ee1d416' AND department_id = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  END IF;
END $$;
