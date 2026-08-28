UPDATE public.omni_comms_channel_adapter_capability
   SET certification_safe = true,
       notes = 'Tenant-owned operational email adapter. Approved for controlled pilot: verified sending domain, secret-ref pattern and pilot recipient allowlist remain enforced.',
       updated_at = now()
 WHERE adapter_code = 'resend_email';

CREATE OR REPLACE FUNCTION public.omni_comms_priv_evaluate_dispatch_authorization(p_organization_id uuid, p_department_id uuid, p_channel text, p_caller_module_code text, p_mode text, p_recipient_hash text, p_adapter_code text, p_request_created_at timestamp with time zone, p_deployed_revision text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_marker public.platform_environment_marker%ROWTYPE;
  v_rel    public.omni_comms_channel_release_control%ROWTYPE;
  v_act    public.omni_comms_dispatch_activation%ROWTYPE;
  v_cap    public.omni_comms_channel_adapter_capability%ROWTYPE;
  v_env    text;
  v_rev    text := lower(btrim(coalesce(p_deployed_revision,'')));
  v_hash   text := lower(btrim(coalesce(p_recipient_hash,'')));
BEGIN
  IF p_organization_id IS NULL OR coalesce(p_channel,'') = '' THEN
    RETURN 'authorization_input_missing';
  END IF;

  v_env := public.omni_comms_priv_runtime_environment();
  IF v_env IS DISTINCT FROM 'non_production' THEN
    RETURN 'environment_not_certified';
  END IF;

  SELECT * INTO v_marker FROM public.platform_environment_marker LIMIT 1;
  IF v_marker.project_ref IS NULL THEN
    RETURN 'environment_marker_missing';
  END IF;
  IF coalesce(v_marker.environment_kind,'') <> 'TEST'
     OR v_marker.allows_controlled_test_activation IS NOT TRUE THEN
    RETURN 'environment_not_test_activatable';
  END IF;

  v_rel := public.omni_comms_priv_channel_release_effective(
             p_organization_id, p_department_id, p_channel);
  IF v_rel.id IS NULL THEN RETURN 'release_control_missing'; END IF;
  IF coalesce(v_rel.release_state,'disabled') <> 'controlled_pilot' THEN
    RETURN 'release_not_controlled_pilot';
  END IF;
  IF v_rel.release_expires_at IS NULL OR v_rel.release_expires_at <= now() THEN
    RETURN 'pilot_expired';
  END IF;
  IF coalesce(p_caller_module_code,'') = ''
     OR NOT (p_caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules, ARRAY[]::text[]))) THEN
    RETURN 'module_not_in_pilot_scope';
  END IF;
  IF coalesce(p_mode,'') <> 'queued'
     OR NOT ('queued' = ANY (coalesce(v_rel.permitted_modes, ARRAY[]::text[]))) THEN
    RETURN 'mode_not_queued';
  END IF;
  IF v_rel.approved_commit IS NULL OR v_rel.approved_commit !~ '^[0-9a-f]{40}$' THEN
    RETURN 'release_revision_not_approved';
  END IF;
  IF v_rev <> '' AND v_rev IS DISTINCT FROM lower(v_rel.approved_commit) THEN
    RETURN 'runtime_revision_not_approved';
  END IF;

  IF v_hash = '' THEN
    RETURN 'recipient_not_allowlisted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(v_rel.pilot_recipient_rules, '[]'::jsonb)) r
    WHERE r->>'target_hash' = v_hash
  ) THEN
    RETURN 'recipient_not_allowlisted';
  END IF;

  IF p_adapter_code IS NOT NULL THEN
    SELECT * INTO v_cap FROM public.omni_comms_channel_adapter_capability
      WHERE adapter_code = p_adapter_code;
    IF v_cap.adapter_code IS NULL OR v_cap.enabled IS NOT TRUE THEN
      RETURN 'provider_not_supported';
    END IF;
    IF v_cap.certification_safe IS NOT TRUE THEN
      RETURN 'provider_not_certification_safe';
    END IF;
  END IF;

  SELECT * INTO v_act FROM public.omni_comms_dispatch_activation WHERE singleton;
  IF v_act.certified_from IS NULL THEN
    RETURN 'runtime_privileged_certification_pending';
  END IF;
  IF lower(coalesce(v_act.certified_revision,'')) IS DISTINCT FROM lower(v_rel.approved_commit) THEN
    RETURN 'certification_revision_mismatch';
  END IF;
  IF coalesce(v_act.project_ref,'') IS DISTINCT FROM coalesce(v_marker.project_ref,'') THEN
    RETURN 'project_ref_mismatch';
  END IF;
  IF p_request_created_at IS NULL OR p_request_created_at < v_act.certified_from THEN
    RETURN 'historical_job_not_authorized';
  END IF;

  RETURN NULL;
END;
$function$;

UPDATE public.omni_comms_sender_identity
   SET data_origin = 'user',
       department_id = NULL,
       display_name = 'Internal Audit Notifications',
       from_name = 'SSB Internal Audit',
       from_address = 'internal.audit@secureserve.biz',
       reply_to_address = 'internal.audit@secureserve.biz',
       status = 'active',
       updated_at = now()
 WHERE code = 'ia_department_sender';

UPDATE public.omni_comms_sender_provider_binding b
   SET status = 'retired',
       retirement_reason = 'Superseded by the operational Resend binding (reuse of the existing email provider account).',
       updated_at = now()
  FROM public.omni_comms_sender_identity si, public.omni_comms_provider_account pa
 WHERE b.sender_identity_id = si.id
   AND b.provider_account_id = pa.id
   AND si.code IN ('ia_department_sender','benefits_department')
   AND pa.code = 'ref_sim_email'
   AND b.status = 'active';

INSERT INTO public.omni_comms_sender_provider_binding
  (sender_identity_id, provider_account_id, channel, channel_endpoint_id, priority,
   status, verification_status, verified_at, verification_source, verification_result_code,
   verification_detail, verification_checked_at, data_origin, organization_id, department_id)
SELECT si.id, pa.id, 'email', '44c36c91-d22e-444d-a465-fd224d2ede9e'::uuid, 1,
       'draft', 'verified', now(), 'service', 'configuration_verified',
       'Reuses the verified secureserve.biz sending domain and the existing operational Resend account.',
       now(), 'user', si.organization_id, NULL
  FROM public.omni_comms_sender_identity si
  CROSS JOIN public.omni_comms_provider_account pa
 WHERE si.code = 'ia_department_sender'
   AND pa.code = 'omni_pilot_sandbox'
   AND NOT EXISTS (
     SELECT 1 FROM public.omni_comms_sender_provider_binding x
      WHERE x.sender_identity_id = si.id AND x.provider_account_id = pa.id
        AND x.status IN ('draft','active'));

UPDATE public.omni_comms_sender_provider_binding b
   SET status = 'active', activated_at = now()
  FROM public.omni_comms_sender_identity si, public.omni_comms_provider_account pa
 WHERE b.sender_identity_id = si.id
   AND b.provider_account_id = pa.id
   AND si.code = 'ia_department_sender'
   AND pa.code = 'omni_pilot_sandbox'
   AND b.status = 'draft';

UPDATE public.omni_comms_sender_provider_binding b
   SET priority = 1, updated_at = now()
  FROM public.omni_comms_sender_identity si, public.omni_comms_provider_account pa
 WHERE b.sender_identity_id = si.id
   AND b.provider_account_id = pa.id
   AND si.code IN ('benefits_department','compliance')
   AND pa.code = 'omni_pilot_sandbox'
   AND b.status = 'active';

UPDATE public.omni_comms_event_route r
   SET sender_identity_id = (SELECT id FROM public.omni_comms_sender_identity WHERE code = 'ia_department_sender'),
       updated_at = now()
  FROM public.omni_comms_event_definition ed
 WHERE ed.id = r.event_definition_id
   AND ed.code LIKE 'INTERNAL_AUDIT.%'
   AND r.channel = 'email';

UPDATE public.omni_comms_channel_release_control
   SET pilot_recipient_rules = pilot_recipient_rules || jsonb_build_object(
         'target_hash', public.omni_comms_priv_channel_test_normalize_target('email','rohit@mishainfotech.com')->>'target_hash',
         'target_type', 'email_address',
         'target_masked', 'r***@mishainfotech.com'),
       updated_at = now()
 WHERE channel = 'email'
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(pilot_recipient_rules) x
      WHERE x->>'target_hash' = public.omni_comms_priv_channel_test_normalize_target('email','rohit@mishainfotech.com')->>'target_hash');

UPDATE public.omni_comms_channel_release_control
   SET pilot_recipient_rules = pilot_recipient_rules || jsonb_build_object(
         'target_hash', public.omni_comms_priv_channel_test_normalize_target('in_app','08655ffc-6bb2-4eea-bc5b-502c52cdcf85')->>'target_hash',
         'target_type', 'user_reference',
         'target_masked', '08****85'),
       updated_at = now()
 WHERE channel = 'in_app'
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(pilot_recipient_rules) x
      WHERE x->>'target_hash' = public.omni_comms_priv_channel_test_normalize_target('in_app','08655ffc-6bb2-4eea-bc5b-502c52cdcf85')->>'target_hash');