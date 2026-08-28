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

  -- DEF-16: final database recipient eligibility gate.
  -- Mirrors the canonical upstream contract in
  -- public.omni_comms_priv_channel_release_decision (r->>'target_hash' = lower(hash)).
  -- Controlled pilots are governed by the effective release allowlist; the database
  -- must fail closed independently of any upstream decision.
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
    IF v_cap.certification_safe IS NOT TRUE
       OR v_cap.requires_external_credentials IS TRUE THEN
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