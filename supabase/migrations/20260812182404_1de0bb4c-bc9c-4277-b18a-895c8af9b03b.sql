
-- ═══════════════════════════════════════════════════════════════════════
-- Omni-Comms — genuine production LIVE release state (Benefits Email).
-- ═══════════════════════════════════════════════════════════════════════

-- ── A. Constraints ────────────────────────────────────────────────────
ALTER TABLE public.omni_comms_channel_release_control
  DROP CONSTRAINT IF EXISTS omni_comms_release_control_proposed_state_chk;
ALTER TABLE public.omni_comms_channel_release_control
  ADD CONSTRAINT omni_comms_release_control_proposed_state_chk
  CHECK (proposed_state IS NULL OR proposed_state = ANY (
    ARRAY['configuration','test_only','controlled_pilot','live','disabled']));

ALTER TABLE public.omni_comms_channel_release_control
  ALTER COLUMN max_messages_total DROP NOT NULL;

ALTER TABLE public.omni_comms_channel_release_control
  DROP CONSTRAINT IF EXISTS omni_comms_release_control_total_chk;
ALTER TABLE public.omni_comms_channel_release_control
  ADD CONSTRAINT omni_comms_release_control_total_chk
  CHECK (max_messages_total IS NULL
         OR (max_messages_total >= 1 AND max_messages_total <= 500));

ALTER TABLE public.omni_comms_channel_release_control
  DROP CONSTRAINT IF EXISTS omni_comms_release_control_ladder_chk;
ALTER TABLE public.omni_comms_channel_release_control
  ADD CONSTRAINT omni_comms_release_control_ladder_chk
  CHECK (max_messages_per_hour <= max_messages_per_day
         AND (max_messages_total IS NULL OR max_messages_per_day <= max_messages_total));

-- ── B. Scheduler run evidence ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.omni_comms_scheduler_run (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worker text NOT NULL,
  execution_context text NOT NULL DEFAULT 'scheduler',
  channel text NOT NULL DEFAULT 'email',
  scanned_jobs integer NOT NULL DEFAULT 0,
  claimed_jobs integer NOT NULL DEFAULT 0,
  blocker text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.omni_comms_scheduler_run TO authenticated;
GRANT ALL ON public.omni_comms_scheduler_run TO service_role;
ALTER TABLE public.omni_comms_scheduler_run ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "omni comms viewers read scheduler runs" ON public.omni_comms_scheduler_run;
CREATE POLICY "omni comms viewers read scheduler runs"
ON public.omni_comms_scheduler_run FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(), 'omni_comms', 'view'));

CREATE INDEX IF NOT EXISTS omni_comms_scheduler_run_created_idx
  ON public.omni_comms_scheduler_run (created_at DESC);

-- ── C. Benefits Product Definition communication configuration ────────
CREATE TABLE IF NOT EXISTS public.omni_comms_product_communication_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.bn_product(id) ON DELETE CASCADE,
  module_code text NOT NULL DEFAULT 'BENEFITS',
  event_code text NOT NULL,
  business_trigger text NOT NULL DEFAULT 'claim_submitted',
  channel text NOT NULL DEFAULT 'email',
  is_enabled boolean NOT NULL DEFAULT true,
  delivery_mode text NOT NULL DEFAULT 'queued',
  recipient_source text NOT NULL DEFAULT 'business_request',
  sender_profile_code text,
  template_family_code text,
  production_status text NOT NULL DEFAULT 'configured',
  data_origin text NOT NULL DEFAULT 'system_seed',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT omni_comms_product_comm_channel_chk CHECK (channel = 'email'),
  CONSTRAINT omni_comms_product_comm_mode_chk
    CHECK (delivery_mode = ANY (ARRAY['dry_run','shadow','queued'])),
  CONSTRAINT omni_comms_product_comm_recipient_chk
    CHECK (recipient_source = ANY (ARRAY['business_request','configured_contact'])),
  CONSTRAINT omni_comms_product_comm_unique UNIQUE (product_id, event_code, channel)
);
GRANT SELECT ON public.omni_comms_product_communication_config TO authenticated;
GRANT ALL ON public.omni_comms_product_communication_config TO service_role;
ALTER TABLE public.omni_comms_product_communication_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "omni comms viewers read product comms" ON public.omni_comms_product_communication_config;
CREATE POLICY "omni comms viewers read product comms"
ON public.omni_comms_product_communication_config FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(), 'omni_comms', 'view'));

CREATE OR REPLACE FUNCTION public.omni_comms_product_communication_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS omni_comms_product_communication_touch_trg
  ON public.omni_comms_product_communication_config;
CREATE TRIGGER omni_comms_product_communication_touch_trg
BEFORE UPDATE ON public.omni_comms_product_communication_config
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_product_communication_touch();

-- Idempotent seed: every ACTIVE Benefits product supports claim submission.
INSERT INTO public.omni_comms_product_communication_config (
  organization_id, product_id, module_code, event_code, business_trigger,
  channel, is_enabled, delivery_mode, recipient_source, production_status)
SELECT rc.organization_id, p.id, 'BENEFITS', 'BENEFITS.CLAIM.SUBMITTED',
       'claim_submitted', 'email', true, 'queued', 'business_request', 'configured'
FROM public.bn_product p
CROSS JOIN LATERAL (
  SELECT organization_id FROM public.omni_comms_channel_release_control
  WHERE data_origin <> 'reference_seed' ORDER BY created_at LIMIT 1) rc
WHERE upper(p.status) = 'ACTIVE' AND rc.organization_id IS NOT NULL
ON CONFLICT (product_id, event_code, channel) DO NOTHING;

-- ── D. Live-aware prerequisites ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_prerequisites(
  p_organization_id uuid, p_department_id uuid, p_channel text,
  p_release_control_id uuid, p_deployed_revision text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_policy public.omni_comms_channel_setting;
  v_cert jsonb;
  v_env text;
  v_provider_account uuid;
  v_run public.omni_comms_channel_test_run;
  v_delivery public.omni_comms_channel_test_delivery;
  v_delivered boolean := false;
  v_bad boolean := false;
  v_dep_ok boolean;
  v_events text[];
  v_callers text[];
  v_live boolean := false;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_release_control_id;
  v_policy := public.omni_comms_priv_channel_test_effective_policy(p_organization_id, p_department_id, p_channel);
  v_cert := public.omni_comms_priv_runtime_certification();
  v_env := public.omni_comms_priv_runtime_environment();
  v_dep_ok := p_department_id IS NULL
    OR public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);
  v_events := coalesce(v_rel.permitted_event_codes, '{}');
  v_callers := coalesce(v_rel.permitted_caller_modules, '{}');
  v_live := coalesce(v_rel.release_state,'') = 'live'
            OR coalesce(v_rel.proposed_state,'') = 'live';

  SELECT pa.id INTO v_provider_account
  FROM public.omni_comms_provider_account pa
  WHERE pa.organization_id = p_organization_id
    AND pa.status = 'active' AND pa.data_origin <> 'reference_seed'
  ORDER BY (pa.verification_status = 'verified') DESC
  LIMIT 1;

  SELECT * INTO v_run FROM public.omni_comms_channel_test_run r
  WHERE r.organization_id = p_organization_id AND r.channel = p_channel AND r.status = 'passed'
  ORDER BY r.created_at DESC LIMIT 1;

  SELECT * INTO v_delivery FROM public.omni_comms_channel_test_delivery d
  WHERE d.organization_id = p_organization_id AND d.channel = p_channel AND d.status = 'accepted'
  ORDER BY d.created_at DESC LIMIT 1;

  IF v_delivery.id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.omni_comms_channel_test_delivery_event e
      WHERE e.delivery_id = v_delivery.id AND e.signature_verified AND e.event_type = 'delivered')
      INTO v_delivered;
    SELECT EXISTS (SELECT 1 FROM public.omni_comms_channel_test_delivery_event e
      WHERE e.delivery_id = v_delivery.id AND e.signature_verified
        AND e.event_type IN ('bounced','complained'))
      INTO v_bad;
  END IF;

  RETURN jsonb_build_array(
    jsonb_build_object('sequence',1,'code','tenant_access','state',CASE WHEN p_organization_id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Organisation scope resolved.'),
    jsonb_build_object('sequence',2,'code','department_access','state',CASE WHEN v_dep_ok THEN 'passed' ELSE 'failed' END,'detail','Department belongs to the organisation.'),
    jsonb_build_object('sequence',3,'code','channel_supported','state',CASE WHEN p_channel = 'email' THEN 'passed' ELSE 'failed' END,'detail','Release Control supports Email only.'),
    jsonb_build_object('sequence',4,'code','release_not_reference','state',CASE WHEN v_rel.id IS NOT NULL AND v_rel.data_origin <> 'reference_seed' THEN 'passed' ELSE 'failed' END,'detail','Genuine (non-reference) release record required.'),
    jsonb_build_object('sequence',5,'code','effective_policy_present','state',CASE WHEN v_policy.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Effective genuine Email policy resolved.'),
    jsonb_build_object('sequence',6,'code','policy_test_or_pilot_state','state',CASE WHEN v_policy.operational_state IN ('test_only','pilot_ready') THEN 'passed' ELSE 'failed' END,'detail','Policy operational state must be test_only or pilot_ready.'),
    jsonb_build_object('sequence',7,'code','provider_present','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider p WHERE p.channel='email' AND p.status='active') THEN 'passed' ELSE 'failed' END,'detail','Active Email provider adapter present.'),
    jsonb_build_object('sequence',8,'code','provider_account_active','state',CASE WHEN v_provider_account IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Active genuine provider account present.'),
    jsonb_build_object('sequence',9,'code','provider_credentials_complete','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s WHERE s.provider_account_id = v_provider_account AND s.purpose='api_key') THEN 'passed' ELSE 'failed' END,'detail','Canonical api_key secret reference present.'),
    jsonb_build_object('sequence',10,'code','provider_credentials_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account pa WHERE pa.id=v_provider_account AND public.omni_comms_provider_credential_send_ready(pa.verification_status, pa.verification_result_code)) THEN 'passed' ELSE 'failed' END,'detail','Provider credentials are sending-ready (verified, or a restricted sending-only provider key authenticated by the provider).'),
    jsonb_build_object('sequence',11,'code','sender_identity_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_identity i WHERE i.organization_id=p_organization_id AND i.channel='email' AND i.status='active' AND i.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail','Active genuine sender identity present.'),
    jsonb_build_object('sequence',12,'code','sending_domain_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel='email' AND e.endpoint_type='sending_domain' AND e.status='active' AND e.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail','Active sending domain configured.'),
    jsonb_build_object('sequence',13,'code','sending_domain_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel='email' AND e.endpoint_type='sending_domain' AND e.status='active' AND e.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail','Sending domain verified with the provider.'),
    jsonb_build_object('sequence',14,'code','callback_endpoint_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel='email' AND e.endpoint_type='event_callback' AND e.status='active') THEN 'passed' ELSE 'failed' END,'detail','Event callback endpoint configured.'),
    jsonb_build_object('sequence',15,'code','binding_active','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel='email' AND b.status='active' AND b.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END,'detail','Active identity-to-provider binding present.'),
    jsonb_build_object('sequence',16,'code','binding_provider_verified','state',CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel='email' AND b.status='active' AND b.verification_status='verified') THEN 'passed' ELSE 'failed' END,'detail','Binding verified by the provider.'),
    jsonb_build_object('sequence',17,'code','current_preflight_passed','state',CASE WHEN v_run.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Current configuration preflight passed.'),
    jsonb_build_object('sequence',18,'code','technical_provider_delivery_accepted','state',CASE WHEN v_delivery.id IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Technical provider delivery accepted.'),
    jsonb_build_object('sequence',19,'code','signed_delivery_callback_received','state',CASE WHEN v_delivered THEN 'passed' ELSE 'failed' END,'detail','Signature-verified delivered callback received.'),
    jsonb_build_object('sequence',20,'code','no_bounce_or_complaint_evidence','state',CASE WHEN v_bad THEN 'failed' ELSE 'passed' END,'detail','No bounced or complained outcome on the current technical delivery.'),
    jsonb_build_object('sequence',21,'code','producer_binding_active','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec CROSS JOIN unnest(v_callers) cm
        WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_producer_event_binding pb
          JOIN public.omni_comms_event_definition ed ON ed.id = pb.event_definition_id
          WHERE pb.organization_id = p_organization_id AND pb.status='active'
            AND 'queued' = ANY (pb.allowed_modes)
            AND ed.code = ec AND ed.status = 'active'
            AND pb.caller_module_code = cm)
      ) THEN 'passed' ELSE 'failed' END,'detail','Active producer-event binding permitting queued mode for every permitted event/caller pair.'),
    jsonb_build_object('sequence',22,'code','event_route_active','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_event_route r
          JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
          WHERE r.organization_id = p_organization_id AND r.channel='email'
            AND r.is_enabled AND r.lifecycle_state='active' AND ed.code = ec)
      ) THEN 'passed' ELSE 'failed' END,'detail','Enabled active Email event route present for every permitted event.'),
    jsonb_build_object('sequence',23,'code','template_family_active','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_event_route r
          JOIN public.omni_comms_template_family tf ON tf.id = r.template_family_id
          JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
          WHERE r.organization_id = p_organization_id AND r.channel='email'
            AND tf.status='active' AND ed.code = ec)
      ) THEN 'passed' ELSE 'failed' END,'detail','Route resolves an active template family.'),
    jsonb_build_object('sequence',24,'code','published_template_version_present','state',CASE WHEN coalesce(array_length(v_events,1),0) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(v_events) ec WHERE NOT EXISTS (
          SELECT 1 FROM public.omni_comms_event_route r
          JOIN public.omni_comms_template_version tv ON tv.template_family_id = r.template_family_id
          JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
          WHERE r.organization_id = p_organization_id AND r.channel='email'
            AND tv.channel='email' AND tv.status='published' AND ed.code = ec)
      ) THEN 'passed' ELSE 'failed' END,'detail','Published Email template version present.'),
    jsonb_build_object('sequence',25,'code','runtime_environment_known','state',CASE WHEN coalesce(v_env,'unknown') IN ('production','non_production') THEN 'passed' ELSE 'failed' END,'detail','Runtime environment is authoritative.'),
    jsonb_build_object('sequence',26,'code','runtime_certification_effective','state',CASE WHEN v_cert->>'certification_state' = 'certified' AND coalesce(v_cert->>'certified_commit','') ~ '^[0-9a-f]{40}$' AND coalesce(v_cert->>'workflow_run_id','') <> '' AND (v_cert->>'certified_at') IS NOT NULL THEN 'passed' ELSE 'failed' END,'detail','Protected runtime certification record is effective.'),
    jsonb_build_object('sequence',27,'code','deployed_revision_matches_certification','state',CASE WHEN lower(coalesce(p_deployed_revision, public.omni_comms_priv_observed_deployed_revision(), '')) ~ '^[0-9a-f]{40}$' AND lower(coalesce(p_deployed_revision, public.omni_comms_priv_observed_deployed_revision(), '')) = lower(coalesce(v_cert->>'certified_commit','x')) THEN 'passed' ELSE 'failed' END,'detail','Deployed Edge revision equals the certified commit (full 40-character SHA).'),
    jsonb_build_object('sequence',28,'code','release_time_window_valid','state',CASE
        WHEN v_live THEN CASE WHEN v_rel.release_expires_at IS NULL OR v_rel.release_expires_at > now() THEN 'passed' ELSE 'failed' END
        WHEN v_rel.release_expires_at IS NOT NULL AND v_rel.release_expires_at > now() AND v_rel.release_expires_at <= coalesce(v_rel.release_starts_at, now()) + interval '7 days' THEN 'passed'
        ELSE 'failed' END,'detail',CASE WHEN v_live THEN 'A live release runs continuously; an optional expiry must be in the future.' ELSE 'Expiry is in the future and the pilot window does not exceed seven days.' END),
    jsonb_build_object('sequence',29,'code','release_volume_limits_valid','state',CASE WHEN v_rel.id IS NOT NULL AND v_rel.max_recipients_per_request BETWEEN 1 AND 10 AND v_rel.max_messages_per_hour <= v_rel.max_messages_per_day AND (v_rel.max_messages_total IS NULL OR v_rel.max_messages_per_day <= v_rel.max_messages_total) THEN 'passed' ELSE 'failed' END,'detail','Volume limits are within bounds and correctly laddered.'),
    jsonb_build_object('sequence',30,'code','pilot_recipient_rules_present','state',CASE
        WHEN v_live THEN 'passed'
        WHEN v_rel.id IS NOT NULL AND jsonb_array_length(v_rel.pilot_recipient_rules) BETWEEN 1 AND 20 THEN 'passed'
        ELSE 'failed' END,'detail',CASE WHEN v_live THEN 'Live operation takes the recipient from the business request; no allowlist is maintained.' ELSE 'Masked/hashed pilot recipient rules present.' END),
    jsonb_build_object('sequence',31,'code','live_delivery_legacy_flag_false','state',CASE WHEN coalesce(v_policy.live_delivery_enabled,false) = false THEN 'passed' ELSE 'failed' END,'detail','Legacy live_delivery_enabled flag remains false; scoped Release Control governs sending.'),
    jsonb_build_object('sequence',32,'code','business_dispatch_dispatcher_installed','state',CASE WHEN public.omni_comms_priv_business_dispatch_installed() THEN 'passed' ELSE 'failed' END,'detail','Controlled business dispatch RPCs are installed; without them dispatch fails closed.')
  );
END;
$function$;

-- ── E. Live-aware release decision oracle ─────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_decision(
  p_organization_id uuid, p_department_id uuid, p_channel text, p_event_code text,
  p_caller_module_code text, p_mode text, p_recipient_hashes text[],
  p_requested_message_count integer, p_deployed_revision text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_allowed boolean := false;
  v_code text := 'release_control_missing';
  v_hour integer := 0; v_day integer := 0; v_total integer := 0;
  v_perm_event boolean := false; v_perm_caller boolean := false;
  v_mode_ok boolean := false; v_rules_ok boolean := false;
  v_match_count integer := 0;
  v_revision_match boolean := false;
  v_prereq jsonb := '[]'::jsonb;
  v_prereq_codes jsonb := '[]'::jsonb;
  v_live boolean := false;
  v_count integer := 0;
BEGIN
  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, p_channel);

  IF v_rel.id IS NOT NULL THEN
    v_live := v_rel.release_state = 'live';
    v_perm_event := p_event_code = ANY (coalesce(v_rel.permitted_event_codes,'{}'));
    v_perm_caller := p_caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules,'{}'))
                     AND p_caller_module_code <> 'OMNI_COMMS_ADMIN_DRY_RUN';
    v_mode_ok := p_mode = ANY (coalesce(v_rel.permitted_modes,'{}')) AND p_mode = 'queued';
    v_count := coalesce(array_length(p_recipient_hashes,1),0);

    IF v_live THEN
      -- LIVE: the recipient is supplied by the canonical business request.
      -- No administrator-maintained allowlist governs production sending.
      v_match_count := v_count;
      v_rules_ok := v_count > 0 AND v_count <= v_rel.max_recipients_per_request
                    AND NOT EXISTS (SELECT 1 FROM unnest(p_recipient_hashes) h
                                    WHERE coalesce(btrim(h),'') = '');
    ELSE
      SELECT count(*) INTO v_match_count
      FROM unnest(coalesce(p_recipient_hashes,'{}')) h
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_rel.pilot_recipient_rules) r
        WHERE r->>'target_hash' = lower(h));
      v_rules_ok := v_count > 0 AND v_count <= v_rel.max_recipients_per_request
                    AND v_match_count = v_count;
    END IF;

    SELECT count(*) INTO v_hour FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id AND j.created_at > now() - interval '1 hour';
    SELECT count(*) INTO v_day FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id AND j.created_at > now() - interval '1 day';
    SELECT count(*) INTO v_total FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id;

    v_revision_match := lower(coalesce(p_deployed_revision,'')) = lower(coalesce(v_rel.approved_commit,'x'));

    v_prereq := public.omni_comms_priv_channel_release_prerequisites(
      p_organization_id, p_department_id, p_channel, v_rel.id, p_deployed_revision);
    SELECT coalesce(jsonb_agg(jsonb_build_object('code', e->>'code', 'state', e->>'state')
                              ORDER BY (e->>'sequence')::int), '[]'::jsonb)
      INTO v_prereq_codes
    FROM jsonb_array_elements(v_prereq) e;

    IF v_rel.release_state = 'suspended' THEN v_code := 'release_not_active';
    ELSIF v_rel.release_state NOT IN ('controlled_pilot','live') THEN v_code := 'release_not_active';
    ELSIF NOT v_live AND (v_rel.release_expires_at IS NULL OR v_rel.release_expires_at <= now()) THEN v_code := 'release_expired';
    ELSIF v_live AND v_rel.release_expires_at IS NOT NULL AND v_rel.release_expires_at <= now() THEN v_code := 'release_expired';
    ELSIF v_rel.release_starts_at IS NOT NULL AND v_rel.release_starts_at > now() THEN v_code := 'release_not_active';
    ELSIF NOT v_perm_event OR NOT v_perm_caller OR NOT v_mode_ok OR NOT v_rules_ok THEN v_code := 'release_scope_denied';
    ELSIF v_hour + coalesce(p_requested_message_count,1) > v_rel.max_messages_per_hour
       OR v_day + coalesce(p_requested_message_count,1) > v_rel.max_messages_per_day
       OR (v_rel.max_messages_total IS NOT NULL
           AND v_total + coalesce(p_requested_message_count,1) > v_rel.max_messages_total) THEN v_code := 'release_limit_exceeded';
    ELSIF NOT v_revision_match THEN v_code := 'release_scope_denied';
    ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(v_prereq) e WHERE e->>'state' = 'failed')
      THEN v_code := 'release_prerequisites_failed';
    ELSE v_allowed := true; v_code := 'release_allowed';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'code', v_code,
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', p_channel,
    'release_control_id', v_rel.id,
    'release_version', v_rel.release_version,
    'release_state', v_rel.release_state,
    'release_fingerprint', v_rel.release_fingerprint,
    'release_expires_at', v_rel.release_expires_at,
    'live_release', v_live,
    'recipient_source', CASE WHEN v_live THEN 'business_request' ELSE 'pilot_allowlist' END,
    'permitted_event', v_perm_event,
    'permitted_caller', v_perm_caller,
    'mode_allowed', v_mode_ok,
    'recipient_rules_satisfied', v_rules_ok,
    'recipient_rule_match_count', v_match_count,
    'requested_message_count', coalesce(p_requested_message_count, 1),
    'current_hourly_count', v_hour,
    'current_daily_count', v_day,
    'current_total_count', v_total,
    'max_messages_per_hour', v_rel.max_messages_per_hour,
    'max_messages_per_day', v_rel.max_messages_per_day,
    'max_messages_total', v_rel.max_messages_total,
    'certified_commit', v_rel.approved_commit,
    'deployed_revision_match', v_revision_match,
    'prerequisite_codes', v_prereq_codes,
    'business_dispatch_enabled', (v_allowed AND to_regprocedure('public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)') IS NOT NULL)
  );
END;
$function$;

-- ── F. Propose production live (maker) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_propose_live(
  p_id uuid, p_expected_updated_at timestamp with time zone,
  p_reason text, p_correlation_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_rel.organization_id, v_rel.department_id);
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
  -- A controlled pilot delivery is NOT a precondition for production live.
  IF v_rel.release_state NOT IN ('test_only','controlled_pilot','suspended') THEN
    RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023';
  END IF;

  UPDATE public.omni_comms_channel_release_control SET
    proposed_state = 'live',
    proposal_reason = public.omni_comms_priv_normalize_reason(p_reason, true),
    proposed_by = v_actor,
    proposed_at = now(),
    proposal_expires_at = now() + interval '24 hours',
    approved_by = NULL, approved_at = NULL, approval_note = NULL,
    updated_by = v_actor
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_proposed', v_rel.release_state, 'live',
    v_rel.proposal_reason, v_actor, p_correlation_id, NULL, '{}'::jsonb);

  RETURN public.omni_comms_priv_channel_release_json(v_rel);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_release_control_propose_live(uuid, timestamptz, text, text) TO authenticated;

-- ── G. Approve and activate production live (checker) ─────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_approve_live(
  p_actor_id uuid, p_release_control_id uuid,
  p_expected_updated_at timestamp with time zone, p_expected_fingerprint text,
  p_deployed_revision text, p_approval_note text, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_checks jsonb;
  v_blockers integer;
  v_cert jsonb;
  v_from text;
  v_attached integer := 0;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
   WHERE id = p_release_control_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF NOT public.has_permission(p_actor_id, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'release_approval_permission_required' USING ERRCODE='42501';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(
    p_actor_id, v_rel.organization_id, v_rel.department_id);
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
  IF v_rel.proposed_state IS DISTINCT FROM 'live' THEN RAISE EXCEPTION 'release_proposal_missing' USING ERRCODE='22023'; END IF;
  IF v_rel.release_fingerprint <> coalesce(p_expected_fingerprint,'') THEN RAISE EXCEPTION 'release_proposal_fingerprint_changed' USING ERRCODE='22023'; END IF;
  IF v_rel.proposal_expires_at IS NULL OR v_rel.proposal_expires_at <= now() THEN RAISE EXCEPTION 'release_proposal_expired' USING ERRCODE='22023'; END IF;
  IF v_rel.proposed_by = p_actor_id THEN RAISE EXCEPTION 'segregation_of_duties_violation' USING ERRCODE='42501'; END IF;
  IF v_rel.release_state NOT IN ('test_only','controlled_pilot','suspended') THEN
    RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023';
  END IF;

  v_checks := public.omni_comms_priv_channel_release_prerequisites(
    v_rel.organization_id, v_rel.department_id, v_rel.channel, v_rel.id, p_deployed_revision);
  SELECT count(*) INTO v_blockers FROM jsonb_array_elements(v_checks) c
   WHERE c->>'state' <> 'passed';
  IF v_blockers > 0 THEN
    PERFORM public.omni_comms_priv_channel_release_record_event(
      v_rel, 'release_gate_denied', v_rel.release_state, 'live',
      'prerequisites_failed', p_actor_id, p_correlation_id, p_deployed_revision,
      jsonb_build_object('blocker_count', v_blockers));
    RAISE EXCEPTION 'release_prerequisites_failed' USING ERRCODE='22023';
  END IF;

  v_cert := public.omni_comms_priv_runtime_certification();
  v_from := v_rel.release_state;

  UPDATE public.omni_comms_channel_release_control SET
    release_state = 'live',
    release_version = release_version + 1,
    proposed_state = NULL,
    approved_by = p_actor_id,
    approved_at = now(),
    approval_note = left(coalesce(p_approval_note,''), 500),
    activated_by = p_actor_id,
    activated_at = now(),
    suspended_by = NULL, suspended_at = NULL, suspension_reason = NULL,
    approved_commit = v_cert->>'certified_commit',
    certification_workflow_run_id = v_cert->>'workflow_run_id',
    certification_recorded_at = (v_cert->>'certified_at')::timestamptz,
    updated_by = p_actor_id
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  -- Attach the FINAL live decision snapshot to every safe, never-attempted
  -- held business job inside the exact live scope. Nothing is sent here.
  WITH safe AS (
    SELECT j.id
    FROM public.omni_comms_dispatch_job j
    JOIN public.omni_comms_message m ON m.id = j.message_id
    JOIN public.omni_comms_request r ON r.id = j.request_id
    JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
    WHERE j.organization_id = v_rel.organization_id
      AND (v_rel.department_id IS NULL OR m.department_id = v_rel.department_id)
      AND j.channel = 'email' AND j.mode = 'queued' AND j.status = 'held'
      AND j.attempt_count = 0
      AND j.release_control_id IS NULL
      AND j.release_decision_at IS NULL
      AND m.status IN ('held','queued')
      AND m.sender_identity_id IS NOT NULL
      AND m.provider_account_id IS NOT NULL
      AND coalesce(m.rendered_checksum,'') <> ''
      AND ed.code = ANY (coalesce(v_rel.permitted_event_codes,'{}'))
      AND r.caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules,'{}'))
      AND r.mode = ANY (coalesce(v_rel.permitted_modes,'{}'))
      AND NOT EXISTS (SELECT 1 FROM public.omni_comms_delivery_attempt a
                      WHERE a.dispatch_job_id = j.id)
  )
  UPDATE public.omni_comms_dispatch_job j SET
    release_control_id = v_rel.id,
    release_version_at_decision = v_rel.release_version,
    release_state_at_decision = v_rel.release_state,
    release_fingerprint_at_decision = v_rel.release_fingerprint,
    release_expires_at_decision = v_rel.release_expires_at,
    release_decision_at = now(),
    hold_reason = NULL,
    release_decision_snapshot = jsonb_build_object(
      'event_matched', true, 'caller_matched', true, 'mode_matched', true,
      'recipient_source', 'business_request',
      'max_recipients_per_request', v_rel.max_recipients_per_request,
      'max_messages_per_hour', v_rel.max_messages_per_hour,
      'max_messages_per_day', v_rel.max_messages_per_day,
      'max_messages_total', v_rel.max_messages_total,
      'certification_state', v_cert->>'certification_state',
      'certified_commit', v_cert->>'certified_commit',
      'authorized_at', now()),
    updated_at = now()
  FROM safe WHERE j.id = safe.id;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_approved', v_from, 'live',
    p_approval_note, p_actor_id, p_correlation_id, p_deployed_revision, '{}'::jsonb);
  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_activated', v_from, 'live',
    NULL, p_actor_id, p_correlation_id, p_deployed_revision,
    jsonb_build_object('authorized_job_count', v_attached, 'automatic_dispatch', true));

  RETURN public.omni_comms_priv_channel_release_json(v_rel)
         || jsonb_build_object('attached_dispatch_job_count', v_attached);
END;
$function$;

-- ── H. Automatic live snapshot on newly created business jobs ─────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_job_live_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_dept uuid; v_email text; v_event text; v_caller text; v_hash text;
  v_dec jsonb;
BEGIN
  IF NEW.channel <> 'email' OR NEW.mode <> 'queued'
     OR NEW.release_control_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT m.department_id, rc.email_destination INTO v_dept, v_email
  FROM public.omni_comms_message m
  LEFT JOIN public.omni_comms_recipient rc ON rc.id = m.recipient_id
  WHERE m.id = NEW.message_id;

  SELECT ed.code, r.caller_module_code INTO v_event, v_caller
  FROM public.omni_comms_request r
  JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
  WHERE r.id = NEW.request_id;

  v_rel := public.omni_comms_priv_channel_release_effective(NEW.organization_id, v_dept, 'email');
  IF v_rel.id IS NULL OR v_rel.release_state <> 'live' THEN RETURN NEW; END IF;

  v_hash := lower(public.omni_comms_priv_channel_test_normalize_target(
              'email', coalesce(v_email,'')) ->> 'target_hash');
  IF coalesce(v_hash,'') = '' THEN RETURN NEW; END IF;

  v_dec := public.omni_comms_priv_channel_release_decision(
    NEW.organization_id, v_dept, 'email', v_event, v_caller, 'queued',
    ARRAY[v_hash], 1, v_rel.approved_commit);

  IF coalesce((v_dec->>'allowed')::boolean, false) IS TRUE THEN
    NEW.release_control_id := v_rel.id;
    NEW.release_version_at_decision := v_rel.release_version;
    NEW.release_state_at_decision := v_rel.release_state;
    NEW.release_fingerprint_at_decision := v_rel.release_fingerprint;
    NEW.release_expires_at_decision := v_rel.release_expires_at;
    NEW.release_decision_at := now();
    NEW.release_decision_snapshot := jsonb_build_object(
      'event_matched', true, 'caller_matched', true, 'mode_matched', true,
      'recipient_source', 'business_request',
      'release_state', 'live',
      'certified_commit', v_rel.approved_commit,
      'authorized_at', now());
    NEW.hold_reason := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa_omni_comms_dispatch_job_live_snapshot
  ON public.omni_comms_dispatch_job;
CREATE TRIGGER aa_omni_comms_dispatch_job_live_snapshot
BEFORE INSERT ON public.omni_comms_dispatch_job
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_dispatch_job_live_snapshot();

-- ── I. Scheduler tick with run evidence ───────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(
  p_worker text, p_batch_limit integer, p_deployed_revision text,
  p_correlation_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := public.omni_comms_priv_dispatch_claim_email(
    p_worker, p_batch_limit, p_correlation_id, p_deployed_revision, NULL, 'scheduler');
  INSERT INTO public.omni_comms_scheduler_run (
    worker, execution_context, channel, scanned_jobs, claimed_jobs, blocker, detail)
  VALUES (
    left(coalesce(p_worker,'omni-comms-scheduler'),120), 'scheduler', 'email',
    coalesce((v_result->>'scanned_jobs')::int, 0),
    coalesce((v_result->>'claimed_jobs')::int, 0),
    nullif(v_result->>'blocker',''),
    jsonb_build_object('blocker_count', jsonb_array_length(coalesce(v_result->'blockers','[]'::jsonb))));
  RETURN v_result;
END; $function$;

-- ── J. Live capability readiness + production delivery evidence ───────
CREATE OR REPLACE FUNCTION public.omni_comms_live_operations_summary(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_cert jsonb; v_env text;
  v_last_run public.omni_comms_scheduler_run;
  v_scheduler_ready boolean := false;
  v_callback_ready boolean := false;
  v_safety_ready boolean := false;
  v_live boolean := false;
  v_checks jsonb;
  v_ready integer := 0;
  v_attempts int; v_accepted int; v_delivered int;
  v_last_attempt timestamptz; v_last_accepted timestamptz; v_last_delivered timestamptz;
  v_last_bounce timestamptz; v_last_complaint timestamptz; v_last_unknown timestamptz;
  v_queue_depth int;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);

  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, 'email');
  v_cert := public.omni_comms_priv_runtime_certification();
  v_env := public.omni_comms_priv_runtime_environment();
  v_live := v_rel.id IS NOT NULL AND v_rel.release_state = 'live';

  SELECT * INTO v_last_run FROM public.omni_comms_scheduler_run
  ORDER BY created_at DESC LIMIT 1;
  v_scheduler_ready := EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'omni-comms-dispatch-every-minute');

  v_callback_ready := EXISTS (
    SELECT 1 FROM public.omni_comms_channel_endpoint e
    WHERE e.organization_id = p_organization_id AND e.channel='email'
      AND e.endpoint_type='event_callback' AND e.status='active');

  v_safety_ready := v_rel.id IS NOT NULL
    AND coalesce(v_rel.release_state,'') <> 'suspended'
    AND v_rel.max_messages_per_hour IS NOT NULL
    AND v_rel.max_messages_per_day IS NOT NULL
    AND v_rel.max_recipients_per_request = 1;

  SELECT count(*), count(*) FILTER (WHERE a.status='accepted'),
         max(a.created_at), max(a.created_at) FILTER (WHERE a.status='accepted'),
         max(a.created_at) FILTER (WHERE a.status='outcome_unknown')
    INTO v_attempts, v_accepted, v_last_attempt, v_last_accepted, v_last_unknown
  FROM public.omni_comms_delivery_attempt a
  WHERE a.organization_id = p_organization_id
    AND (v_rel.id IS NULL OR a.release_control_id = v_rel.id);

  SELECT count(*) FILTER (WHERE e.event_type='delivered'),
         max(e.occurred_at) FILTER (WHERE e.event_type='delivered'),
         max(e.occurred_at) FILTER (WHERE e.event_type='bounced'),
         max(e.occurred_at) FILTER (WHERE e.event_type='complained')
    INTO v_delivered, v_last_delivered, v_last_bounce, v_last_complaint
  FROM public.omni_comms_message_event e
  WHERE e.organization_id = p_organization_id;

  SELECT count(*) INTO v_queue_depth FROM public.omni_comms_dispatch_job j
  WHERE j.organization_id = p_organization_id AND j.channel='email' AND j.mode='queued'
    AND j.status IN ('held','ready','retry_wait');

  v_checks := jsonb_build_array(
    jsonb_build_object('key','production_environment','ready', v_env = 'production',
      'detail', CASE WHEN v_env='production' THEN 'Runtime environment confirmed as production.'
                     ELSE 'Confirm the production runtime environment.' END),
    jsonb_build_object('key','deployment_certified',
      'ready', v_cert->>'certification_state' = 'certified',
      'detail', CASE WHEN v_cert->>'certification_state'='certified'
                     THEN 'The deployed revision is certified.'
                     ELSE 'Certify the deployed revision.' END),
    jsonb_build_object('key','benefits_live_release_active','ready', v_live,
      'detail', CASE WHEN v_live THEN 'A production live Email release governs Benefits sending.'
                     ELSE 'Propose and approve the Benefits production live release.' END),
    jsonb_build_object('key','business_dispatcher_ready',
      'ready', public.omni_comms_priv_business_dispatch_installed(),
      'detail','Canonical business dispatcher installed.'),
    jsonb_build_object('key','automatic_scheduler_ready','ready', v_scheduler_ready,
      'detail', CASE WHEN v_scheduler_ready THEN 'The automatic dispatcher runs every minute.'
                     ELSE 'The automatic dispatcher schedule is not installed.' END),
    jsonb_build_object('key','callback_receiver_ready','ready', v_callback_ready,
      'detail','Signed provider callback endpoint active.'),
    jsonb_build_object('key','live_safety_ready','ready', v_safety_ready,
      'detail', CASE WHEN v_safety_ready THEN 'Production quotas and safety suspension are in force.'
                     ELSE 'Production quotas are not complete.' END)
  );
  SELECT count(*) INTO v_ready FROM jsonb_array_elements(v_checks) c
   WHERE (c->>'ready')::boolean;

  RETURN jsonb_build_object(
    'release_state', v_rel.release_state,
    'live', v_live,
    'automatic_dispatch', v_live AND v_scheduler_ready,
    'readiness', jsonb_build_object('checks', v_checks, 'ready_count', v_ready, 'total', 7),
    'scheduler', jsonb_build_object(
      'installed', v_scheduler_ready,
      'frequency', 'every_minute',
      'last_run_at', v_last_run.created_at,
      'last_run_scanned', v_last_run.scanned_jobs,
      'last_run_claimed', v_last_run.claimed_jobs,
      'last_run_blocker', v_last_run.blocker),
    'quotas', jsonb_build_object(
      'max_recipients_per_request', v_rel.max_recipients_per_request,
      'max_messages_per_hour', v_rel.max_messages_per_hour,
      'max_messages_per_day', v_rel.max_messages_per_day,
      'max_messages_total', v_rel.max_messages_total),
    'scope', jsonb_build_object(
      'department_id', v_rel.department_id,
      'permitted_event_codes', to_jsonb(coalesce(v_rel.permitted_event_codes,'{}')),
      'permitted_caller_modules', to_jsonb(coalesce(v_rel.permitted_caller_modules,'{}')),
      'permitted_modes', to_jsonb(coalesce(v_rel.permitted_modes,'{}'))),
    'delivery_evidence', jsonb_build_object(
      'attempts', coalesce(v_attempts,0),
      'accepted', coalesce(v_accepted,0),
      'delivered', coalesce(v_delivered,0),
      'last_attempt_at', v_last_attempt,
      'last_accepted_at', v_last_accepted,
      'last_delivered_at', v_last_delivered,
      'last_bounce_at', v_last_bounce,
      'last_complaint_at', v_last_complaint,
      'last_outcome_unknown_at', v_last_unknown,
      'queue_depth', coalesce(v_queue_depth,0),
      'has_production_delivery', coalesce(v_attempts,0) > 0),
    'generated_at', now());
END;
$function$;
GRANT EXECUTE ON FUNCTION public.omni_comms_live_operations_summary(uuid, uuid) TO authenticated;

-- Product Definition communication configuration read model.
CREATE OR REPLACE FUNCTION public.omni_comms_product_communication_summary(
  p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);
  RETURN jsonb_build_object(
    'products', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.id,
        'benefit_code', p.benefit_code,
        'benefit_name', p.benefit_name,
        'status', p.status,
        'events', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'event_code', c.event_code,
            'business_trigger', c.business_trigger,
            'enabled', c.is_enabled,
            'channel', c.channel,
            'delivery_mode', c.delivery_mode,
            'recipient_source', c.recipient_source,
            'sender_profile_code', c.sender_profile_code,
            'template_family_code', c.template_family_code,
            'production_status', c.production_status) ORDER BY c.event_code)
          FROM public.omni_comms_product_communication_config c
          WHERE c.product_id = p.id AND c.organization_id = p_organization_id), '[]'::jsonb))
        ORDER BY p.benefit_code)
      FROM public.bn_product p WHERE upper(p.status) = 'ACTIVE'), '[]'::jsonb),
    'generated_at', now());
END;
$function$;
GRANT EXECUTE ON FUNCTION public.omni_comms_product_communication_summary(uuid) TO authenticated;

-- ── K. Summary capability projection understands live ─────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_summary(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid,
  p_channel text DEFAULT 'email'::text, p_history_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_can_configure boolean := false;
  v_can_operate boolean := false;
  v_cert jsonb;
  v_policy public.omni_comms_channel_setting;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);
  IF p_channel <> 'email' THEN RAISE EXCEPTION 'release_channel_not_supported' USING ERRCODE='22023'; END IF;

  BEGIN PERFORM public.omni_comms_priv_require_capability('configure'); v_can_configure := true;
  EXCEPTION WHEN OTHERS THEN v_can_configure := false; END;
  BEGIN PERFORM public.omni_comms_priv_require_capability('operate'); v_can_operate := true;
  EXCEPTION WHEN OTHERS THEN v_can_operate := false; END;

  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, p_channel);
  v_cert := public.omni_comms_priv_runtime_certification();
  v_policy := public.omni_comms_priv_channel_test_effective_policy(p_organization_id, p_department_id, p_channel);

  RETURN jsonb_build_object(
    'release', CASE WHEN v_rel.id IS NULL THEN NULL
                    ELSE public.omni_comms_priv_channel_release_json(v_rel) END,
    'scope', jsonb_build_object('organization_id', p_organization_id,
                                'department_id', p_department_id,
                                'channel', p_channel),
    'certification', v_cert,
    'runtime_environment', public.omni_comms_priv_runtime_environment(),
    'live_delivery_enabled', coalesce(v_policy.live_delivery_enabled, false),
    'prerequisites', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb
      ELSE public.omni_comms_priv_channel_release_prerequisites(
        p_organization_id, p_department_id, p_channel, v_rel.id, NULL) END,
    'usage', CASE WHEN v_rel.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
        'hourly', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 hour'),
        'daily', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 day'),
        'total', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id)) END,
    'history', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'from_state', e.from_state,
        'to_state', e.to_state, 'reason', e.reason, 'actor_id', e.actor_id,
        'release_version', e.release_version,
        'release_fingerprint', left(e.release_fingerprint, 12),
        'certified_commit', e.certified_commit,
        'occurred_at', e.occurred_at) ORDER BY e.occurred_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.omni_comms_channel_release_event
            WHERE release_control_id = v_rel.id
            ORDER BY occurred_at DESC
            LIMIT greatest(1, least(coalesce(p_history_limit,25), 200))) e) END,
    'capabilities', jsonb_build_object(
      'can_configure', v_can_configure,
      'can_operate', v_can_operate,
      'can_approve', v_can_operate AND v_rel.id IS NOT NULL
                     AND v_rel.proposed_state IN ('controlled_pilot','live')
                     AND v_rel.proposed_by IS DISTINCT FROM v_actor,
      'can_propose_live', v_can_configure AND v_rel.id IS NOT NULL
                     AND v_rel.release_state IN ('test_only','controlled_pilot','suspended'),
      'can_suspend', v_can_operate AND v_rel.release_state IN ('controlled_pilot','live')),
    'actor_id', v_actor,
    'business_dispatch_implemented', public.omni_comms_priv_business_dispatch_installed(),
    'generated_at', now()
  );
END;
$function$;
