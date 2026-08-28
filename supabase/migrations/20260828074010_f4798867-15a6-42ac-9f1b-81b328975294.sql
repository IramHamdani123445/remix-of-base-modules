-- Omni-Comms Runtime Delivery Foundation Closure
-- DEF-13 / DEF-14 / DEF-15 / Database dispatch authority.
-- NOTHING is activated: the dispatch activation record is created EMPTY, so
-- every governed evaluation still fails closed with
-- `runtime_privileged_certification_pending`.

CREATE TABLE IF NOT EXISTS public.omni_comms_channel_adapter_capability (
  adapter_code                   text PRIMARY KEY,
  channel                        text NOT NULL,
  display_name                   text NOT NULL,
  enabled                        boolean NOT NULL DEFAULT true,
  requires_external_credentials  boolean NOT NULL DEFAULT true,
  requires_verified_sender_domain boolean NOT NULL DEFAULT false,
  supports_attachments           boolean NOT NULL DEFAULT false,
  supports_callbacks             boolean NOT NULL DEFAULT false,
  contacts_external_provider     boolean NOT NULL DEFAULT true,
  certification_safe             boolean NOT NULL DEFAULT false,
  secret_ref_pattern             text,
  notes                          text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.omni_comms_channel_adapter_capability TO authenticated;
GRANT ALL    ON public.omni_comms_channel_adapter_capability TO service_role;
ALTER TABLE public.omni_comms_channel_adapter_capability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_adapter_capability_read ON public.omni_comms_channel_adapter_capability;
CREATE POLICY omni_comms_adapter_capability_read
  ON public.omni_comms_channel_adapter_capability
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.omni_comms_channel_adapter_capability
  (adapter_code, channel, display_name, requires_external_credentials,
   requires_verified_sender_domain, supports_attachments, supports_callbacks,
   contacts_external_provider, certification_safe, secret_ref_pattern, notes)
VALUES
  ('resend_email','email','Resend Email', true, true, true, true, true, false,
   '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$','Live external email provider.'),
  ('simulation_email','email','Simulation Email', false, false, true, false, false, true,
   NULL,'Internal simulation adapter. Contacts no provider and delivers nothing externally.'),
  ('internal_in_app','in_app','Internal In-App Inbox', false, false, false, false, false, true,
   NULL,'Internal projection into in_app_notifications.'),
  ('simulation_inapp','in_app','Simulation In-App', false, false, false, false, false, true,
   NULL,'Internal simulation adapter for the in-app inbox.'),
  ('simulation_sms','sms','Simulation SMS', false, false, false, false, false, true,
   NULL,'Internal simulation adapter. Contacts no provider.'),
  ('twilio_sms','sms','Twilio SMS', true, false, false, true, true, false,
   '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$', NULL),
  ('twilio_whatsapp','whatsapp','Twilio WhatsApp', true, false, true, true, true, false,
   '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$', NULL),
  ('twilio_voice','voice','Twilio Voice', true, false, false, true, true, false,
   '^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$', NULL),
  ('firebase_push','push','Firebase Push', true, false, false, true, true, false,
   '^OMNI_COMMS_FCM_[A-Z0-9]+(_[A-Z0-9]+)*$', NULL),
  ('outbound_webhook','webhook','Outbound Webhook', true, false, false, true, true, false,
   '^OMNI_COMMS_WEBHOOK_[A-Z0-9]+(_[A-Z0-9]+)*$', NULL),
  ('print_spool','print','Physical Print Spool', false, false, true, false, false, false,
   NULL,'Physical production path; certified separately.')
ON CONFLICT (adapter_code) DO UPDATE
  SET channel = EXCLUDED.channel,
      display_name = EXCLUDED.display_name,
      requires_external_credentials = EXCLUDED.requires_external_credentials,
      requires_verified_sender_domain = EXCLUDED.requires_verified_sender_domain,
      supports_attachments = EXCLUDED.supports_attachments,
      supports_callbacks = EXCLUDED.supports_callbacks,
      contacts_external_provider = EXCLUDED.contacts_external_provider,
      certification_safe = EXCLUDED.certification_safe,
      secret_ref_pattern = EXCLUDED.secret_ref_pattern,
      notes = EXCLUDED.notes,
      updated_at = now();

CREATE TABLE IF NOT EXISTS public.omni_comms_dispatch_activation (
  singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  certified_from     timestamptz,
  certified_revision text,
  environment_kind   text,
  project_ref        text,
  activated_by       uuid,
  activated_at       timestamptz,
  note               text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.omni_comms_dispatch_activation TO authenticated;
GRANT ALL    ON public.omni_comms_dispatch_activation TO service_role;
ALTER TABLE public.omni_comms_dispatch_activation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_dispatch_activation_read ON public.omni_comms_dispatch_activation;
CREATE POLICY omni_comms_dispatch_activation_read
  ON public.omni_comms_dispatch_activation
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.omni_comms_dispatch_activation (singleton)
VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_evaluate_dispatch_authorization(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_caller_module_code text,
  p_mode text,
  p_recipient_hash text,
  p_adapter_code text,
  p_request_created_at timestamptz,
  p_deployed_revision text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_marker public.platform_environment_marker%ROWTYPE;
  v_rel    public.omni_comms_channel_release_control%ROWTYPE;
  v_act    public.omni_comms_dispatch_activation%ROWTYPE;
  v_cap    public.omni_comms_channel_adapter_capability%ROWTYPE;
  v_env    text;
  v_rev    text := lower(btrim(coalesce(p_deployed_revision,'')));
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
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_evaluate_dispatch_authorization(
  uuid, uuid, text, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_evaluate_dispatch_authorization(
  uuid, uuid, text, text, text, text, text, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_evaluate_dispatch_authorization(
  uuid, uuid, text, text, text, text, text, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_evaluate_dispatch_authorization(
  uuid, uuid, text, text, text, text, text, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_set_dispatch_certified_from(
  p_certified_revision text,
  p_project_ref text,
  p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_marker public.platform_environment_marker%ROWTYPE;
  v_cert   public.omni_comms_runtime_certification%ROWTYPE;
  v_rev    text := lower(btrim(coalesce(p_certified_revision,'')));
BEGIN
  IF v_rev !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'OC422 invalid_revision' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_marker FROM public.platform_environment_marker LIMIT 1;
  IF v_marker.project_ref IS NULL
     OR coalesce(v_marker.environment_kind,'') <> 'TEST'
     OR v_marker.allows_controlled_test_activation IS NOT TRUE THEN
    RAISE EXCEPTION 'OC403 environment_not_test_activatable' USING ERRCODE='P0001';
  END IF;
  IF coalesce(p_project_ref,'') IS DISTINCT FROM v_marker.project_ref THEN
    RAISE EXCEPTION 'OC403 project_ref_mismatch' USING ERRCODE='P0001';
  END IF;
  IF public.omni_comms_priv_runtime_environment() IS DISTINCT FROM 'non_production' THEN
    RAISE EXCEPTION 'OC403 environment_not_certified' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_cert FROM public.omni_comms_runtime_certification WHERE singleton;
  IF lower(coalesce(v_cert.certified_commit,'')) IS DISTINCT FROM v_rev
     OR lower(coalesce(v_cert.observed_runtime_revision,'')) IS DISTINCT FROM v_rev
     OR lower(coalesce(v_cert.observed_dispatcher_revision,'')) IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'OC409 revision_not_uniformly_observed' USING ERRCODE='P0001';
  END IF;

  UPDATE public.omni_comms_dispatch_activation
     SET certified_from     = now(),
         certified_revision = v_rev,
         environment_kind   = v_marker.environment_kind,
         project_ref        = v_marker.project_ref,
         activated_by       = auth.uid(),
         activated_at       = now(),
         note               = left(coalesce(p_note,''), 500),
         updated_at         = now()
   WHERE singleton;

  RETURN jsonb_build_object('certified_revision', v_rev, 'certified_from', now());
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_set_dispatch_certified_from(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_set_dispatch_certified_from(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_set_dispatch_certified_from(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_set_dispatch_certified_from(text, text, text) TO service_role;

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.in_app_notifications TO authenticated;
GRANT ALL ON public.in_app_notifications TO service_role;

DROP POLICY IF EXISTS in_app_notifications_owner_select ON public.in_app_notifications;
CREATE POLICY in_app_notifications_owner_select
  ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS in_app_notifications_owner_update ON public.in_app_notifications;
CREATE POLICY in_app_notifications_owner_update
  ON public.in_app_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());