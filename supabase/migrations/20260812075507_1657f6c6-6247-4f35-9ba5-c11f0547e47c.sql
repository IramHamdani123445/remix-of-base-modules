-- 1. Material-only policy projection for the test configuration fingerprint.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_policy_material_json(p_row public.omni_comms_channel_setting)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'organization_id', p_row.organization_id,
    'department_id', p_row.department_id,
    'channel', p_row.channel,
    'operational_state', p_row.operational_state,
    'department_override_enabled', p_row.department_override_enabled,
    'enabled', p_row.enabled,
    'live_delivery_enabled', p_row.live_delivery_enabled,
    'per_minute_limit', p_row.per_minute_limit,
    'per_day_limit', p_row.per_day_limit,
    'max_recipients_per_request', p_row.max_recipients_per_request,
    'quiet_hours_start', to_char(p_row.quiet_hours_start,'HH24:MI'),
    'quiet_hours_end', to_char(p_row.quiet_hours_end,'HH24:MI'),
    'quiet_hours_timezone', p_row.quiet_hours_timezone,
    'retry_profile', p_row.retry_profile,
    'request_timeout_seconds', p_row.request_timeout_seconds,
    'retention_days', p_row.retention_days,
    'cost_currency', p_row.cost_currency,
    'daily_cost_limit_minor', p_row.daily_cost_limit_minor,
    'per_message_cost_limit_minor', p_row.per_message_cost_limit_minor,
    'channel_policy_config', p_row.channel_policy_config,
    'data_origin', p_row.data_origin
  );
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_policy_material_json(public.omni_comms_channel_setting) FROM PUBLIC, anon, authenticated;

-- 2. Fingerprint snapshot v3 — material sending configuration only.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_config_snapshot(p_organization_id uuid, p_department_id uuid, p_channel text, p_binding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  b public.omni_comms_sender_provider_binding%ROWTYPE;
  a public.omni_comms_provider_account%ROWTYPE;
  i public.omni_comms_sender_identity%ROWTYPE;
  e public.omni_comms_channel_endpoint%ROWTYPE;
  s_org public.omni_comms_channel_setting%ROWTYPE;
  s_dept public.omni_comms_channel_setting%ROWTYPE;
  s_eff public.omni_comms_channel_setting%ROWTYPE;
  v_policy jsonb := 'null'::jsonb;
  v_policy_source text := 'none';
  v_dept_found boolean := false;
  v_req_total integer := 0;
  v_req_met integer := 0;
  v_acct_ref_count integer := 0;
  v_acct_ref_digest text := public.omni_comms_priv_channel_test_sha256('');
  v_ep_ref_count integer := 0;
  v_ep_ref_digest text := public.omni_comms_priv_channel_test_sha256('');
BEGIN
  IF p_binding_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='binding_required';
  END IF;

  SELECT * INTO b FROM public.omni_comms_sender_provider_binding WHERE id = p_binding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='binding_not_found';
  END IF;
  IF b.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='binding_organization_mismatch';
  END IF;
  IF b.channel IS DISTINCT FROM p_channel THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='binding_channel_mismatch';
  END IF;

  SELECT * INTO a FROM public.omni_comms_provider_account WHERE id = b.provider_account_id;
  SELECT * INTO i FROM public.omni_comms_sender_identity   WHERE id = b.sender_identity_id;
  IF b.channel_endpoint_id IS NOT NULL THEN
    SELECT * INTO e FROM public.omni_comms_channel_endpoint WHERE id = b.channel_endpoint_id;
  END IF;

  SELECT * INTO s_org FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND department_id IS NULL
     AND channel = p_channel AND data_origin <> 'reference_seed';

  IF p_department_id IS NOT NULL THEN
    SELECT * INTO s_dept FROM public.omni_comms_channel_setting
     WHERE organization_id = p_organization_id AND department_id = p_department_id
       AND channel = p_channel AND data_origin <> 'reference_seed';
    v_dept_found := FOUND;
  END IF;

  IF v_dept_found AND coalesce(s_dept.department_override_enabled,false) THEN
    s_eff := s_dept;
    v_policy := public.omni_comms_priv_channel_policy_material_json(s_dept);
    v_policy_source := 'department_override';
  ELSIF s_org.id IS NOT NULL THEN
    s_eff := s_org;
    v_policy := public.omni_comms_priv_channel_policy_material_json(s_org);
    v_policy_source := 'organisation_baseline';
  END IF;

  IF a.id IS NOT NULL THEN
    SELECT count(*) INTO v_req_total
      FROM public.omni_comms_provider_credential_requirement r
     WHERE r.provider_id = a.provider_id AND r.required = true;

    SELECT count(*) INTO v_req_met
      FROM public.omni_comms_provider_credential_requirement r
      JOIN public.omni_comms_provider_account_secret_ref sr
        ON sr.provider_account_id = a.id AND sr.purpose = r.purpose
       AND btrim(coalesce(sr.secret_ref,'')) <> ''
     WHERE r.provider_id = a.provider_id AND r.required = true;

    -- Credential reference metadata: purpose + storage mode + secret NAME only.
    -- A replaced credential VALUE is proven by the test itself, not by an
    -- audit timestamp, so the fingerprint stays stable across housekeeping.
    SELECT count(*),
           public.omni_comms_priv_channel_test_sha256(
             coalesce(string_agg(
               sr.purpose || '|' || coalesce(sr.storage_mode,'') || '|' || coalesce(sr.secret_ref,''),
               E'\n' ORDER BY sr.purpose, sr.id), ''))
      INTO v_acct_ref_count, v_acct_ref_digest
      FROM public.omni_comms_provider_account_secret_ref sr
     WHERE sr.provider_account_id = a.id;
  END IF;

  IF e.id IS NOT NULL THEN
    SELECT count(*),
           public.omni_comms_priv_channel_test_sha256(
             coalesce(string_agg(
               sr.purpose || '|' || coalesce(sr.secret_ref,''),
               E'\n' ORDER BY sr.purpose, sr.id), ''))
      INTO v_ep_ref_count, v_ep_ref_digest
      FROM public.omni_comms_channel_endpoint_secret_ref sr
     WHERE sr.channel_endpoint_id = e.id;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'schema_version', 3,
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', p_channel,
    'endpoint_requirement', public.omni_comms_priv_binding_endpoint_requirement(p_channel),
    'binding', jsonb_build_object(
      'id', b.id,
      'status', b.status,
      'priority', b.priority,
      'verification_status', b.verification_status,
      'verification_source', b.verification_source,
      'verification_result_code', b.verification_result_code,
      'data_origin', b.data_origin,
      'department_id', b.department_id
    ),
    'provider_account', CASE WHEN a.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', a.id,
      'provider_id', a.provider_id,
      'code', a.code,
      'status', a.status,
      'environment', a.environment,
      'region', a.region,
      'verification_status', a.verification_status,
      'verification_result_code', a.verification_result_code,
      'data_origin', a.data_origin,
      'credential_reference_count', v_acct_ref_count,
      'credential_reference_digest', v_acct_ref_digest,
      'required_credential_count', v_req_total,
      'satisfied_credential_count', v_req_met
    ) END,
    'identity', CASE WHEN i.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', i.id,
      'code', i.code,
      'status', i.status,
      'identity_type', i.identity_type,
      'identity_config', coalesce(i.identity_config, '{}'::jsonb),
      'data_origin', i.data_origin,
      'department_id', i.department_id
    ) END,
    'endpoint', CASE WHEN e.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', e.id,
      'code', e.code,
      'status', e.status,
      'endpoint_type', e.endpoint_type,
      'endpoint_config', coalesce(e.endpoint_config, '{}'::jsonb),
      'verification_status', e.verification_status,
      'data_origin', e.data_origin,
      'secret_reference_count', v_ep_ref_count,
      'secret_reference_digest', v_ep_ref_digest,
      'department_id', e.department_id
    ) END,
    'policy', v_policy,
    'policy_id', s_eff.id,
    'policy_source', v_policy_source
  ));
END; $function$;

-- 3. Strictly account-scoped callback health.
CREATE OR REPLACE FUNCTION public.omni_comms_channel_callback_health(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_accounts jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required';
  END IF;
  IF NOT public.has_permission(v_actor,'omni_comms','view') THEN
    RAISE EXCEPTION 'OC403 permission_denied';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);

  WITH accounts AS (
    SELECT a.id, a.code, a.display_name
      FROM public.omni_comms_provider_account a
     WHERE a.organization_id = p_organization_id
       AND a.data_origin <> 'reference_seed'
       AND a.status <> 'retired'
  ), ev AS (
    -- Webhook receiver evidence, strictly attributed to one account.
    SELECT nullif(e.payload_summary->>'provider_account_id','')::uuid AS acct,
           e.received_at,
           e.signature_verified,
           (e.processing_result = 'rejected') AS rejected,
           left(coalesce(e.payload_summary->>'rejection_reason','unknown'),64) AS reason
      FROM public.omni_comms_webhook_event e
     WHERE e.organization_id = p_organization_id
       AND nullif(e.payload_summary->>'provider_account_id','') IS NOT NULL
    UNION ALL
    -- Verified technical-test callbacks, attributed through the delivery.
    SELECT d.provider_account_id AS acct,
           te.received_at,
           te.signature_verified,
           false AS rejected,
           NULL::text AS reason
      FROM public.omni_comms_channel_test_delivery_event te
      JOIN public.omni_comms_channel_test_delivery d ON d.id = te.delivery_id
     WHERE d.organization_id = p_organization_id
       AND te.signature_verified IS TRUE
  ), agg AS (
    SELECT ac.id, ac.code, ac.display_name,
           count(*) FILTER (WHERE ev.signature_verified AND NOT ev.rejected) AS accepted_count,
           count(*) FILTER (WHERE ev.rejected) AS rejected_count,
           max(ev.received_at) FILTER (WHERE ev.signature_verified AND NOT ev.rejected) AS last_accepted_at,
           max(ev.received_at) FILTER (WHERE ev.rejected) AS last_rejected_at
      FROM accounts ac
      LEFT JOIN ev ON ev.acct = ac.id
     GROUP BY ac.id, ac.code, ac.display_name
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'providerAccountId', g.id,
           'providerAccountCode', g.code,
           'providerAccountName', g.display_name,
           'acceptedCount', g.accepted_count,
           'rejectedCount', g.rejected_count,
           'lastAcceptedAt', g.last_accepted_at,
           'lastRejectedAt', g.last_rejected_at,
           'lastRejectionReason', (
              SELECT e2.reason FROM ev e2
               WHERE e2.rejected AND e2.acct = g.id
               ORDER BY e2.received_at DESC LIMIT 1),
           'state', CASE
              WHEN g.rejected_count > 0
                   AND (g.last_accepted_at IS NULL
                        OR g.last_rejected_at > g.last_accepted_at) THEN 'rejecting'
              WHEN g.accepted_count > 0 THEN 'healthy'
              ELSE 'never_received' END
         ) ORDER BY g.code), '[]'::jsonb)
    INTO v_accounts
    FROM agg g;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'accounts', v_accounts,
    'generatedAt', now());
END; $function$;