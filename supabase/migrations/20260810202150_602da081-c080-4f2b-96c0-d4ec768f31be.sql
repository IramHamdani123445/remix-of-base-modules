-- Omni-Comms — sender catalogue bootstrap safety hardening.

ALTER TABLE public.omni_comms_sender_identity
  ADD COLUMN IF NOT EXISTS catalogue_sender_code text;

COMMENT ON COLUMN public.omni_comms_sender_identity.catalogue_sender_code IS
  'Operator-approved equivalence to a production catalogue sender code.';

CREATE OR REPLACE FUNCTION public.omni_comms_priv_sender_usage(p_sender_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog','public'
AS $function$
  SELECT jsonb_build_object(
    'routes', (SELECT count(*) FROM public.omni_comms_event_route r
                WHERE r.sender_identity_id = p_sender_id),
    'bindings', (SELECT count(*) FROM public.omni_comms_sender_provider_binding b
                  WHERE b.sender_identity_id = p_sender_id),
    'messages', (SELECT count(*) FROM public.omni_comms_message m
                  WHERE m.sender_identity_id = p_sender_id),
    'module_assignments', (SELECT count(*) FROM public.omni_comms_module_sender_profile a
                            WHERE a.sender_identity_id = p_sender_id
                              AND a.status <> 'retired'),
    'tests', (SELECT count(*) FROM public.omni_comms_channel_test_run t
               WHERE t.sender_identity_id = p_sender_id)
             + (SELECT count(*) FROM public.omni_comms_channel_test_delivery d
                 WHERE d.sender_identity_id = p_sender_id));
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_sender_usage(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.omni_comms_priv_sender_catalogue();

CREATE FUNCTION public.omni_comms_priv_sender_catalogue()
RETURNS TABLE (
  sender_code text, local_part text, department_code text,
  name_suffix text, audience text, tier text, purpose text,
  department_required boolean, scope_note text
)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $function$
  SELECT * FROM (VALUES
    ('platform_notifications','notifications',NULL,'Notifications','external','production_now','General external organisation and platform notifications',false,'organisation_wide_platform_scope'),
    ('registration_department','registration','REGISTRATION','Registration','external','production_now','Employer and registration correspondence',true,'owned_by_registration_department'),
    ('identity_services','identity','REGISTRATION','Identity Services','external','production_now','Insured-person identity, profile and registration correspondence',true,'insured_person_identity_owned_by_registration_department'),
    ('contributions_department','contributions',NULL,'Contributions','external','production_now','Contribution history, filing and contribution correspondence',false,'no_contributions_department_in_master_data_organisation_wide_scope'),
    ('finance_department','finance','FINANCE','Finance','external','production_now','Finance correspondence',true,'owned_by_finance_department'),
    ('compliance_department','compliance','COMPLIANCE','Compliance','external','production_now','Compliance and enforcement correspondence',true,'owned_by_compliance_department'),
    ('benefits_department','benefits','BENEFITS','Benefits','external','production_now','Benefits correspondence',true,'owned_by_benefits_department'),
    ('claims_services','claims','BENEFITS','Claims Services','external','production_now','Claim intake, status and service correspondence',true,'owned_by_benefits_department'),
    ('internal_notifications','internal-notifications',NULL,'Internal Notifications','internal','production_now','Internal assignment, status and workflow notifications',false,'organisation_wide_internal_scope'),
    ('legal_department','legal','LEGAL','Legal','external','production_now','Legal correspondence',true,'owned_by_legal_department'),
    ('medical_services','medical',NULL,'Medical Services','external','future','Medical assessment correspondence',false,'future_profile'),
    ('doctor_services','doctors',NULL,'Doctor Services','external','future','Medical provider correspondence',false,'future_profile'),
    ('workflow_notifications','workflow',NULL,'Workflow Notifications','internal','future','Workflow task notifications',false,'future_profile'),
    ('audit_department','audit','INTERNAL_AUDIT','Audit','internal','future','Audit correspondence',false,'future_profile'),
    ('reports_delivery','reports',NULL,'Reports','external','future','Report delivery',false,'future_profile')
  ) AS t(sender_code, local_part, department_code, name_suffix, audience, tier, purpose,
         department_required, scope_note);
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_sender_catalogue() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_sender_catalogue_bootstrap(
  p_organization_id uuid,
  p_apply boolean DEFAULT false,
  p_channel text DEFAULT 'email',
  p_domain text DEFAULT 'secureserve.biz',
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_uid uuid; v_short text; v_plan jsonb := '[]'::jsonb;
  v_created int := 0; v_existing int := 0; v_conflicts int := 0; v_future int := 0;
  v_blocked int := 0;
  v_rec record; v_sender public.omni_comms_sender_identity%ROWTYPE;
  v_dept uuid; v_addr text; v_status text; v_detail text; v_id uuid;
  v_endpoint_id uuid; v_provider_id uuid; v_domain_ready boolean := false;
  v_domain_blocker text; v_updated timestamptz;
  v_verify public.omni_comms_domain_verification%ROWTYPE;
  v_readiness jsonb; v_usage jsonb; v_total int;
BEGIN
  v_uid := public.omni_comms_priv_require_capability(
    CASE WHEN COALESCE(p_apply,false) THEN 'configure' ELSE 'view' END);
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT COALESCE(NULLIF(btrim(o.short_name),''), o.legal_name) INTO v_short
    FROM public.core_organization o WHERE o.id = p_organization_id;
  IF v_short IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='organization';
  END IF;

  SELECT e.id, e.provider_account_id INTO v_endpoint_id, v_provider_id
    FROM public.omni_comms_channel_endpoint e
   WHERE e.channel = p_channel
     AND e.endpoint_type = 'sending_domain'
     AND e.status = 'active'
     AND lower(e.endpoint_config->>'domain_name') = lower(p_domain)
   LIMIT 1;

  SELECT * INTO v_verify FROM public.omni_comms_domain_verification d
   WHERE d.organization_id = p_organization_id
     AND lower(d.domain_name) = lower(p_domain)
     AND (v_endpoint_id IS NULL OR d.channel_endpoint_id = v_endpoint_id)
   ORDER BY d.updated_at DESC LIMIT 1;

  IF v_verify.id IS NULL THEN
    v_domain_ready := false;
    v_domain_blocker := 'No sending-domain verification record exists for this domain.';
  ELSE
    v_readiness := public.omni_comms_priv_domain_readiness(v_verify);
    v_domain_ready := COALESCE((v_readiness->>'readyForProviderAccount')::boolean, false);
    v_domain_blocker := v_readiness->>'readinessBlocker';
  END IF;

  IF v_domain_ready AND NOT EXISTS (
       SELECT 1 FROM public.omni_comms_provider_account pa
        WHERE pa.id = v_provider_id AND pa.status = 'active') THEN
    v_domain_ready := false;
    v_domain_blocker := 'The provider account for this sending domain is not active.';
  END IF;

  FOR v_rec IN SELECT * FROM public.omni_comms_priv_sender_catalogue() LOOP
    v_status := NULL; v_detail := NULL; v_id := NULL; v_dept := NULL;
    v_sender := NULL; v_usage := NULL;
    v_addr := v_rec.local_part || '@' || p_domain;

    IF v_rec.department_code IS NOT NULL THEN
      SELECT d.id INTO v_dept FROM public.core_department d
       WHERE d.organization_id = p_organization_id
         AND d.code = v_rec.department_code
         AND COALESCE(d.is_active, true)
       LIMIT 1;
    END IF;

    SELECT * INTO v_sender FROM public.omni_comms_sender_identity s
     WHERE s.organization_id = p_organization_id
       AND s.channel = p_channel
       AND s.code = v_rec.sender_code
       AND s.status <> 'retired'
     LIMIT 1;

    IF v_sender.id IS NULL THEN
      SELECT * INTO v_sender FROM public.omni_comms_sender_identity s
       WHERE s.organization_id = p_organization_id
         AND s.channel = p_channel
         AND s.catalogue_sender_code = v_rec.sender_code
         AND s.status <> 'retired'
       LIMIT 1;
      IF v_sender.id IS NOT NULL THEN
        v_status := 'existing_equivalent';
        v_detail := 'operator_approved_equivalent_sender';
        v_id := v_sender.id;
      END IF;
    ELSE
      v_status := 'existing'; v_id := v_sender.id;
      IF lower(COALESCE(v_sender.from_address,'')) <> lower(v_addr) THEN
        v_status := 'conflict'; v_detail := 'existing_sender_uses_different_address';
      END IF;
    END IF;

    IF v_status IS NULL THEN
      SELECT * INTO v_sender FROM public.omni_comms_sender_identity s
       WHERE s.organization_id = p_organization_id
         AND s.channel = p_channel
         AND s.data_origin <> 'reference_seed'
         AND s.status <> 'retired'
         AND lower(COALESCE(s.from_address,'')) = lower(v_addr)
       LIMIT 1;
      IF v_sender.id IS NOT NULL THEN
        v_status := 'conflict';
        v_detail := 'address_already_used_by_sender_code_' || COALESCE(v_sender.code,'unknown');
        v_id := v_sender.id;
      END IF;
    END IF;

    IF v_status IS NULL AND v_rec.tier = 'future' THEN
      v_status := 'future_not_required';
      v_detail := 'no_registered_module_requires_this_profile';
    END IF;

    IF v_status IS NULL AND v_rec.department_required AND v_dept IS NULL THEN
      v_status := 'blocked';
      v_detail := 'department_not_resolved_' || v_rec.department_code;
    END IF;

    IF v_status IS NULL THEN
      IF COALESCE(p_apply,false) THEN
        v_id := public.omni_comms_sender_identity_upsert_draft(
          NULL, NULL, p_organization_id, v_dept, NULL,
          v_rec.sender_code, v_short || ' ' || v_rec.name_suffix,
          v_addr, v_short || ' ' || v_rec.name_suffix, NULL, p_correlation_id);
        UPDATE public.omni_comms_sender_identity
           SET audience = v_rec.audience
         WHERE id = v_id;
        v_status := 'created';
        IF v_domain_ready THEN
          SELECT updated_at INTO v_updated FROM public.omni_comms_sender_identity WHERE id = v_id;
          BEGIN
            PERFORM public.omni_comms_sender_identity_activate(v_id, v_updated, p_correlation_id);
            v_detail := 'activated';
          EXCEPTION WHEN others THEN
            v_detail := 'created_draft_activation_blocked';
          END;
        ELSE
          v_detail := 'created_draft_domain_not_ready';
        END IF;
        SELECT * INTO v_sender FROM public.omni_comms_sender_identity WHERE id = v_id;
      ELSE
        v_status := 'will_create';
        v_detail := CASE WHEN v_domain_ready
                         THEN 'will_create_and_activate'
                         ELSE 'will_create_as_draft_domain_not_ready' END;
      END IF;
    END IF;

    IF v_id IS NOT NULL THEN
      v_usage := public.omni_comms_priv_sender_usage(v_id);
    END IF;

    IF v_status = 'created' THEN v_created := v_created + 1;
    ELSIF v_status IN ('existing','existing_equivalent') THEN v_existing := v_existing + 1;
    ELSIF v_status = 'conflict' THEN v_conflicts := v_conflicts + 1;
    ELSIF v_status = 'blocked' THEN v_blocked := v_blocked + 1;
    ELSIF v_status = 'future_not_required' THEN v_future := v_future + 1;
    END IF;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'sender_code', v_rec.sender_code,
      'tier', v_rec.tier,
      'purpose', v_rec.purpose,
      'audience', v_rec.audience,
      'status', v_status,
      'detail', v_detail,
      'sender_identity_id', v_id,
      'organization_id', p_organization_id,
      'department_code', v_rec.department_code,
      'department_required', v_rec.department_required,
      'department_resolved', v_dept IS NOT NULL,
      'scope_note', v_rec.scope_note,
      'department_id', COALESCE(v_sender.department_id, v_dept),
      'display_name', COALESCE(v_sender.display_name, v_short || ' ' || v_rec.name_suffix),
      'from_address', COALESCE(v_sender.from_address, v_addr),
      'existing_sender_code', v_sender.code,
      'reply_to_address', v_sender.reply_to_address,
      'sender_status', v_sender.status,
      'usage', v_usage,
      'channel_endpoint_id', v_endpoint_id,
      'provider_account_id', v_provider_id));
  END LOOP;

  SELECT count(*) INTO v_total FROM public.omni_comms_priv_sender_catalogue();

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'organization_short_name', v_short,
    'channel', p_channel,
    'domain', p_domain,
    'domain_ready', v_domain_ready,
    'domain_readiness_blocker', v_domain_blocker,
    'applied', COALESCE(p_apply,false),
    'total_definitions', v_total,
    'created', v_created,
    'existing', v_existing,
    'conflicts', v_conflicts,
    'blocked', v_blocked,
    'future', v_future,
    'plan', v_plan,
    'generated_at', now());
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_sender_catalogue_bootstrap(uuid, boolean, text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_sender_catalogue_resolve_conflict(
  p_organization_id uuid,
  p_sender_identity_id uuid,
  p_catalogue_sender_code text,
  p_action text,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_sender_identity%ROWTYPE;
        v_before jsonb; v_usage jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  IF p_action NOT IN ('approve_equivalent','rename_to_catalogue_code') THEN
    RAISE EXCEPTION 'OC400 invalid_input' USING ERRCODE='P0001', DETAIL='action';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_priv_sender_catalogue() c
                  WHERE c.sender_code = p_catalogue_sender_code) THEN
    RAISE EXCEPTION 'OC400 invalid_input' USING ERRCODE='P0001', DETAIL='catalogue_sender_code';
  END IF;

  SELECT * INTO v_row FROM public.omni_comms_sender_identity
   WHERE id = p_sender_identity_id AND organization_id = p_organization_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'OC409 concurrent_update' USING ERRCODE='P0001', DETAIL='sender_identity';
  END IF;

  v_before := to_jsonb(v_row);
  v_usage := public.omni_comms_priv_sender_usage(v_row.id);

  IF p_action = 'rename_to_catalogue_code' THEN
    IF COALESCE((v_usage->>'routes')::int,0) > 0
       OR COALESCE((v_usage->>'messages')::int,0) > 0 THEN
      RAISE EXCEPTION 'OC409 sender_in_use' USING ERRCODE='P0001', DETAIL='rename_blocked_by_usage';
    END IF;
    IF EXISTS (SELECT 1 FROM public.omni_comms_sender_identity s
                WHERE s.organization_id = p_organization_id
                  AND s.channel = v_row.channel
                  AND s.code = p_catalogue_sender_code
                  AND s.id <> v_row.id
                  AND s.status <> 'retired') THEN
      RAISE EXCEPTION 'OC409 duplicate' USING ERRCODE='P0001', DETAIL='catalogue_code_in_use';
    END IF;
    UPDATE public.omni_comms_sender_identity
       SET code = p_catalogue_sender_code,
           catalogue_sender_code = p_catalogue_sender_code,
           updated_at = now(), updated_by = v_uid
     WHERE id = v_row.id RETURNING * INTO v_row;
  ELSE
    UPDATE public.omni_comms_sender_identity
       SET catalogue_sender_code = p_catalogue_sender_code,
           updated_at = now(), updated_by = v_uid
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, 'update', 'sender_identity', v_row.id, v_row.code,
    v_before, to_jsonb(v_row), p_correlation_id);

  RETURN jsonb_build_object(
    'sender_identity_id', v_row.id,
    'code', v_row.code,
    'catalogue_sender_code', v_row.catalogue_sender_code,
    'action', p_action,
    'updated_at', v_row.updated_at);
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_sender_catalogue_resolve_conflict(
  uuid, uuid, text, text, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_module_sender_profile_bootstrap(
  p_organization_id uuid,
  p_apply boolean DEFAULT false,
  p_channel text DEFAULT 'email',
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_plan jsonb := '[]'::jsonb; v_created int := 0; v_existing int := 0;
        v_blocked int := 0; v_not_required int := 0; v_rec record;
        v_sender public.omni_comms_sender_identity%ROWTYPE;
        v_mod boolean; v_row public.omni_comms_module_sender_profile%ROWTYPE;
        v_status text; v_detail text; v_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability(
    CASE WHEN COALESCE(p_apply,false) THEN 'configure' ELSE 'view' END);
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  FOR v_rec IN
    SELECT * FROM (VALUES
      ('BENEFITS','default','benefits_department',true,false),
      ('BENEFITS','transactional','benefits_department',true,false),
      ('BENEFITS','legal','benefits_department',true,false),
      ('BENEFITS','service','claims_services',true,false),
      ('EMPLOYER_REGISTRATION','default','registration_department',true,false),
      ('EMPLOYER_REGISTRATION','transactional','registration_department',true,false),
      ('INSURED_PERSON','default','identity_services',true,false),
      ('INSURED_PERSON','service','platform_notifications',true,false),
      ('INSURED_PERSON','transactional','contributions_department',true,false),
      ('COMPLIANCE','default','compliance_department',true,false),
      ('COMPLIANCE','transactional','compliance_department',true,false),
      ('COMPLIANCE','legal','compliance_department',true,false),
      ('COMPLIANCE','service','compliance_department',true,false),
      ('COMPLIANCE','service','internal_notifications',false,false),
      ('FINANCE','default','finance_department',true,false),
      ('FINANCE','transactional','finance_department',true,false),
      ('LEGAL','default','legal_department',true,false),
      ('LEGAL','legal','legal_department',true,false),
      ('LEGAL','service','internal_notifications',false,false),
      ('PLATFORM','default','platform_notifications',true,false),
      ('PLATFORM','service','platform_notifications',true,false),
      ('PLATFORM','service','internal_notifications',false,false),
      ('OMNI_COMMS_DIRECT','default',NULL,false,true),
      ('OMNI_COMMS_ADMIN_DRY_RUN','default',NULL,false,true),
      ('REGISTRATION','default','registration_department',true,false),
      ('C3','default','contributions_department',true,false),
      ('CONTRIBUTIONS','default','contributions_department',true,false),
      ('WORKFLOW','default','workflow_notifications',true,false),
      ('AUDIT','default','audit_department',true,false),
      ('APPEALS','default','legal_department',true,false),
      ('MEDICAL','default','medical_services',true,false),
      ('DOCTORS','default','doctor_services',true,false),
      ('REPORTS','default','reports_delivery',true,false)
    ) AS t(module_code, profile_role, sender_code, is_default, technical)
  LOOP
    v_status := NULL; v_detail := NULL; v_id := NULL; v_sender := NULL; v_row := NULL;

    IF v_rec.technical THEN
      v_status := 'not_required'; v_detail := 'no_business_sender_required';
    ELSE
      SELECT r.is_active INTO v_mod
        FROM public.omni_comms_caller_module_registry r
       WHERE r.module_code = v_rec.module_code;

      IF v_mod IS NULL THEN
        v_status := 'blocked'; v_detail := 'caller_module_not_registered';
      ELSIF NOT v_mod THEN
        v_status := 'blocked'; v_detail := 'caller_module_inactive';
      ELSE
        SELECT * INTO v_sender FROM public.omni_comms_sender_identity s
         WHERE s.organization_id = p_organization_id
           AND s.channel = p_channel
           AND (s.code = v_rec.sender_code OR s.catalogue_sender_code = v_rec.sender_code)
           AND s.data_origin <> 'reference_seed'
           AND s.status <> 'retired'
         ORDER BY (s.code = v_rec.sender_code) DESC
         LIMIT 1;
        IF v_sender.id IS NULL THEN
          v_status := 'blocked'; v_detail := 'sender_not_defined';
        ELSIF v_sender.status <> 'active' THEN
          v_status := 'blocked'; v_detail := 'sender_not_active';
        END IF;
      END IF;
    END IF;

    IF v_status IS NULL THEN
      SELECT * INTO v_row FROM public.omni_comms_module_sender_profile m
       WHERE m.organization_id = p_organization_id
         AND m.caller_module_code = v_rec.module_code
         AND m.channel = p_channel
         AND m.profile_role = v_rec.profile_role
         AND m.sender_identity_id = v_sender.id
         AND m.status <> 'retired'
       LIMIT 1;

      IF v_row.id IS NOT NULL THEN
        v_status := 'existing'; v_id := v_row.id;
      ELSIF v_rec.is_default AND EXISTS (
        SELECT 1 FROM public.omni_comms_module_sender_profile m
         WHERE m.organization_id = p_organization_id
           AND m.caller_module_code = v_rec.module_code
           AND m.channel = p_channel
           AND m.profile_role = v_rec.profile_role
           AND m.is_default
           AND m.status = 'active') THEN
        v_status := 'existing'; v_detail := 'different_default_sender_configured';
        SELECT m.id INTO v_id FROM public.omni_comms_module_sender_profile m
         WHERE m.organization_id = p_organization_id
           AND m.caller_module_code = v_rec.module_code
           AND m.channel = p_channel
           AND m.profile_role = v_rec.profile_role
           AND m.is_default AND m.status = 'active' LIMIT 1;
      ELSIF COALESCE(p_apply,false) THEN
        INSERT INTO public.omni_comms_module_sender_profile(
          organization_id, department_id, caller_module_code, channel,
          sender_identity_id, profile_role, is_default, allow_event_override,
          allow_organization_fallback, status, data_origin,
          created_by, updated_by, activated_at, activated_by)
        VALUES (p_organization_id, v_sender.department_id, v_rec.module_code, p_channel,
          v_sender.id, v_rec.profile_role, v_rec.is_default, true,
          false, 'active', 'system_seed', v_uid, v_uid, now(), v_uid)
        RETURNING * INTO v_row;
        v_status := 'created'; v_id := v_row.id;
        PERFORM public.omni_comms_priv_write_channel_audit(
          v_uid,'create','module_sender_profile',v_row.id,v_row.caller_module_code,
          NULL,to_jsonb(v_row),p_correlation_id);
      ELSE
        v_status := 'will_create';
      END IF;
    END IF;

    IF v_status = 'created' THEN v_created := v_created + 1;
    ELSIF v_status = 'existing' THEN v_existing := v_existing + 1;
    ELSIF v_status = 'blocked' THEN v_blocked := v_blocked + 1;
    ELSIF v_status = 'not_required' THEN v_not_required := v_not_required + 1;
    END IF;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'caller_module_code', v_rec.module_code,
      'profile_role', v_rec.profile_role,
      'is_default', v_rec.is_default,
      'sender_code', v_rec.sender_code,
      'status', v_status,
      'detail', v_detail,
      'assignment_id', v_id,
      'sender_identity_id', v_sender.id,
      'sender_status', v_sender.status,
      'department_id', v_sender.department_id));
  END LOOP;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'channel', p_channel,
    'applied', COALESCE(p_apply,false),
    'created', v_created,
    'existing', v_existing,
    'blocked', v_blocked,
    'not_required', v_not_required,
    'plan', v_plan,
    'generated_at', now());
END; $function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_module_sender_profile_bootstrap(uuid, boolean, text, text)
  TO authenticated, service_role;