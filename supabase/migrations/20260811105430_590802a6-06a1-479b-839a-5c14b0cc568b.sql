-- 1. Service-role-only recorder for REJECTED inbound callbacks.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_webhook_record_rejection(
  p_provider_code text,
  p_provider_event_id text,
  p_provider_account_id uuid,
  p_reason text,
  p_payload_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_org uuid;
  v_reason text := left(coalesce(p_reason,'unknown'), 64);
  v_event_id text := coalesce(nullif(p_provider_event_id,''),
                              'rejected:' || gen_random_uuid()::text);
  v_digest text := CASE WHEN coalesce(p_payload_digest,'') ~ '^sha256:[0-9a-f]{64}$'
                        THEN p_payload_digest
                        ELSE 'sha256:' || encode(digest(v_event_id,'sha256'),'hex') END;
BEGIN
  IF p_provider_account_id IS NOT NULL THEN
    SELECT organization_id INTO v_org
      FROM public.omni_comms_provider_account
     WHERE id = p_provider_account_id;
  END IF;

  INSERT INTO public.omni_comms_webhook_event (
    provider_code, provider_event_id, provider_message_id,
    raw_event_type, normalized_event_type, signature_verified,
    scope, organization_id, payload_summary, payload_digest, processing_result
  ) VALUES (
    coalesce(nullif(p_provider_code,''),'resend_email'),
    v_event_id, NULL,
    'callback.rejected', NULL, false,
    'unmatched', v_org,
    jsonb_build_object('rejection_reason', v_reason,
                       'provider_account_id', p_provider_account_id),
    v_digest, 'rejected'
  )
  ON CONFLICT (provider_code, provider_event_id) DO NOTHING;

  RETURN jsonb_build_object('recorded', true, 'reason', v_reason);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_webhook_record_rejection(text,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_webhook_record_rejection(text,text,uuid,text,text) TO service_role;

-- 2. Read-only callback health summary for the admin Delivery callbacks card.
CREATE OR REPLACE FUNCTION public.omni_comms_channel_callback_health(
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
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
    SELECT e.*,
           nullif(e.payload_summary->>'provider_account_id','')::uuid AS acct
      FROM public.omni_comms_webhook_event e
     WHERE e.organization_id = p_organization_id
  ), agg AS (
    SELECT ac.id,
           ac.code,
           ac.display_name,
           count(*) FILTER (WHERE ev.signature_verified) AS accepted_count,
           count(*) FILTER (WHERE ev.processing_result = 'rejected') AS rejected_count,
           max(ev.received_at) FILTER (WHERE ev.signature_verified) AS last_accepted_at,
           max(ev.received_at) FILTER (WHERE ev.processing_result = 'rejected') AS last_rejected_at
      FROM accounts ac
      LEFT JOIN ev ON ev.acct = ac.id OR ev.acct IS NULL
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
              SELECT left(coalesce(e2.payload_summary->>'rejection_reason','unknown'),64)
                FROM ev e2
               WHERE e2.processing_result = 'rejected'
                 AND (e2.acct = g.id OR e2.acct IS NULL)
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
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_callback_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_callback_health(uuid) TO authenticated, service_role;