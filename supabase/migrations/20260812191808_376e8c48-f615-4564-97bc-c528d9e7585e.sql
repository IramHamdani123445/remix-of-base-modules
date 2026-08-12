-- ═══════════════════════════════════════════════════════════════════════
-- OMNI-COMMS BENEFITS FINAL LIVE PRE-APPROVAL
-- 1. Scheduler nonce defect, 2. idempotent cron, 3. truthful scheduler
-- health, 4. product communication admin layer, 5. corrective seed.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Scheduler nonce minting defect ──────────────────────────────────
-- pgcrypto lives in the `extensions` schema; the previous search_path made
-- gen_random_bytes unresolvable, so EVERY cron tick failed before the Edge
-- dispatcher was ever reached.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_scheduler_issue_ticket()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_nonce text;
BEGIN
  DELETE FROM public.omni_comms_scheduler_ticket
   WHERE expires_at < now() - interval '1 hour';
  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.omni_comms_scheduler_ticket (nonce) VALUES (v_nonce);
  RETURN v_nonce;
END $function$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_issue_ticket() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_issue_ticket() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text) FROM anon, authenticated;

-- ── 2. Exactly one canonical automatic dispatch schedule ───────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'omni-comms-dispatch-every-minute'
  LOOP PERFORM cron.unschedule(r.jobid); END LOOP;

  PERFORM cron.schedule(
    'omni-comms-dispatch-every-minute',
    '* * * * *',
    $cron$
  SELECT net.http_post(
    url := 'https://xynceskeiiisiefqlgxo.supabase.co/functions/v1/omni-comms-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5bmNlc2tlaWlpc2llZnFsZ3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTQxMDAsImV4cCI6MjA4ODczMDEwMH0.kVVysArl8ujrAHpHLtNx7xifYyq02ulIE5c4WKKSXCI',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5bmNlc2tlaWlpc2llZnFsZ3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTQxMDAsImV4cCI6MjA4ODczMDEwMH0.kVVysArl8ujrAHpHLtNx7xifYyq02ulIE5c4WKKSXCI',
      'x-omni-comms-dispatch-ticket', 'scheduler',
      'x-omni-comms-scheduler-nonce', public.omni_comms_priv_scheduler_issue_ticket()
    ),
    body := jsonb_build_object('batchLimit', 5),
    timeout_milliseconds := 20000
  );
    $cron$);
END $$;

-- ── 3. Product communication change history ────────────────────────────
CREATE TABLE IF NOT EXISTS public.omni_comms_product_communication_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  product_id uuid NOT NULL,
  event_code text NOT NULL,
  channel text NOT NULL,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.omni_comms_product_communication_audit TO authenticated;
GRANT ALL ON public.omni_comms_product_communication_audit TO service_role;
ALTER TABLE public.omni_comms_product_communication_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "omni comms viewers read product comm audit"
  ON public.omni_comms_product_communication_audit;
CREATE POLICY "omni comms viewers read product comm audit"
ON public.omni_comms_product_communication_audit FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(), 'omni_comms', 'view'));
CREATE INDEX IF NOT EXISTS omni_comms_product_communication_audit_product_idx
  ON public.omni_comms_product_communication_audit (product_id, created_at DESC);

-- ── 4. Corrective seed ─────────────────────────────────────────────────
-- The initial seed enabled EVERY active product. A product only participates
-- in claim-submitted acknowledgement when it actually accepts claim intake:
-- it must have at least one product version and at least one application
-- channel configuration. Nothing is deleted; non-participating products are
-- marked not applicable and disabled.
UPDATE public.omni_comms_product_communication_config c
   SET is_enabled = false,
       production_status = 'not_applicable',
       updated_at = now()
 WHERE c.event_code = 'BENEFITS.CLAIM.SUBMITTED'
   AND NOT (
     EXISTS (SELECT 1 FROM public.bn_product_version v WHERE v.product_id = c.product_id)
     AND EXISTS (SELECT 1 FROM public.bn_product_channel_config ch WHERE ch.product_id = c.product_id)
   );

-- ── 5. Effective (inherited) template & sender resolution ──────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_product_communication_effective(
  p_organization_id uuid, p_event_code text, p_channel text,
  p_template_override text, p_sender_override text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'template_source', CASE WHEN nullif(p_template_override,'') IS NULL
                            THEN 'event_route_default' ELSE 'product_override' END,
    'effective_template_code', coalesce(nullif(p_template_override,''), (
      SELECT tf.code FROM public.omni_comms_event_route r
      JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
      JOIN public.omni_comms_template_family tf ON tf.id = r.template_family_id
      WHERE d.code = p_event_code AND r.channel = p_channel
        AND r.organization_id = p_organization_id
        AND r.lifecycle_state = 'active' AND r.is_enabled
      ORDER BY r.priority NULLS LAST LIMIT 1)),
    'sender_source', CASE WHEN nullif(p_sender_override,'') IS NULL
                          THEN 'module_default' ELSE 'product_override' END,
    'effective_sender_code', coalesce(nullif(p_sender_override,''), (
      SELECT si.code FROM public.omni_comms_module_sender_profile sp
      JOIN public.omni_comms_sender_identity si ON si.id = sp.sender_identity_id
      WHERE sp.organization_id = p_organization_id
        AND sp.caller_module_code = 'BENEFITS' AND sp.channel = p_channel
        AND sp.status = 'active'
      ORDER BY sp.is_default DESC LIMIT 1)));
$function$;

-- ── 6. Product Definition read model (per product) ─────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_product_communication_read(
  p_organization_id uuid, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid; v_product public.bn_product; v_applicable boolean;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);
  SELECT * INTO v_product FROM public.bn_product WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'OC404 product_not_found' USING ERRCODE='P0001', DETAIL='product_not_found';
  END IF;
  v_applicable :=
    EXISTS (SELECT 1 FROM public.bn_product_version v WHERE v.product_id = p_product_id)
    AND EXISTS (SELECT 1 FROM public.bn_product_channel_config ch WHERE ch.product_id = p_product_id);

  RETURN jsonb_build_object(
    'product', jsonb_build_object(
      'product_id', v_product.id, 'benefit_code', v_product.benefit_code,
      'benefit_name', v_product.benefit_name, 'status', v_product.status,
      'claim_intake_applicable', v_applicable),
    'live_event_code', 'BENEFITS.CLAIM.SUBMITTED',
    'events', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'event_code') FROM (
        SELECT jsonb_build_object(
          'event_code', c.event_code,
          'business_trigger', c.business_trigger,
          'channel', c.channel,
          'enabled', c.is_enabled,
          'delivery_mode', c.delivery_mode,
          'recipient_source', c.recipient_source,
          'template_override', c.template_family_code,
          'sender_override', c.sender_profile_code,
          'production_status', c.production_status,
          'updated_at', c.updated_at,
          'configured', true)
          || public.omni_comms_priv_product_communication_effective(
               p_organization_id, c.event_code, c.channel,
               c.template_family_code, c.sender_profile_code) AS x
        FROM public.omni_comms_product_communication_config c
        WHERE c.product_id = p_product_id AND c.organization_id = p_organization_id
      ) s), '[]'::jsonb),
    'available_events', coalesce((
      SELECT jsonb_agg(jsonb_build_object('event_code', d.code, 'event_name', d.name,
             'configured', EXISTS (SELECT 1 FROM public.omni_comms_product_communication_config c
                                    WHERE c.product_id = p_product_id AND c.event_code = d.code))
             ORDER BY d.code)
      FROM public.omni_comms_event_definition d
      WHERE d.module_code = 'BENEFITS' AND d.status = 'active'), '[]'::jsonb),
    'generated_at', now());
END; $function$;
GRANT EXECUTE ON FUNCTION public.omni_comms_product_communication_read(uuid, uuid) TO authenticated;

-- ── 7. Bounded admin write ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_product_communication_update(
  p_organization_id uuid, p_product_id uuid, p_event_code text,
  p_channel text DEFAULT 'email',
  p_is_enabled boolean DEFAULT NULL,
  p_delivery_mode text DEFAULT NULL,
  p_recipient_source text DEFAULT NULL,
  p_template_override text DEFAULT NULL,
  p_sender_override text DEFAULT NULL,
  p_clear_template_override boolean DEFAULT false,
  p_clear_sender_override boolean DEFAULT false,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_before public.omni_comms_product_communication_config;
  v_after public.omni_comms_product_communication_config;
  v_mode text; v_source text; v_template text; v_sender text;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, NULL);

  IF NOT EXISTS (SELECT 1 FROM public.bn_product WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'OC404 product_not_found' USING ERRCODE='P0001', DETAIL='product_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_definition d
                  WHERE d.code = p_event_code AND d.module_code = 'BENEFITS'
                    AND d.status = 'active') THEN
    RAISE EXCEPTION 'OC422 event_not_registered' USING ERRCODE='P0001', DETAIL='event_not_registered';
  END IF;
  IF coalesce(p_channel,'') NOT IN ('email') THEN
    RAISE EXCEPTION 'OC422 channel_not_supported' USING ERRCODE='P0001', DETAIL='channel_not_supported';
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_product_communication_config
   WHERE product_id = p_product_id AND event_code = p_event_code AND channel = p_channel;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 product_event_not_configured'
      USING ERRCODE='P0001', DETAIL='product_event_not_configured';
  END IF;
  IF v_before.organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'OC403 tenant_scope_mismatch' USING ERRCODE='P0001', DETAIL='tenant_scope_mismatch';
  END IF;

  v_mode := coalesce(nullif(p_delivery_mode,''), v_before.delivery_mode);
  IF v_mode NOT IN ('queued','immediate') THEN
    RAISE EXCEPTION 'OC422 delivery_mode_invalid' USING ERRCODE='P0001', DETAIL='delivery_mode_invalid';
  END IF;
  v_source := coalesce(nullif(p_recipient_source,''), v_before.recipient_source);
  IF v_source NOT IN ('business_request','participant_contact','registered_address') THEN
    RAISE EXCEPTION 'OC422 recipient_source_invalid' USING ERRCODE='P0001', DETAIL='recipient_source_invalid';
  END IF;

  v_template := CASE WHEN p_clear_template_override THEN NULL
                     ELSE coalesce(nullif(p_template_override,''), v_before.template_family_code) END;
  IF v_template IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.omni_comms_template_family tf
       WHERE tf.code = v_template AND tf.status = 'active') THEN
    RAISE EXCEPTION 'OC422 template_not_found' USING ERRCODE='P0001', DETAIL='template_not_found';
  END IF;

  v_sender := CASE WHEN p_clear_sender_override THEN NULL
                   ELSE coalesce(nullif(p_sender_override,''), v_before.sender_profile_code) END;
  IF v_sender IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.omni_comms_sender_identity si
       WHERE si.code = v_sender AND si.organization_id = p_organization_id
         AND si.channel = p_channel AND si.status = 'active') THEN
    RAISE EXCEPTION 'OC422 sender_profile_not_permitted'
      USING ERRCODE='P0001', DETAIL='sender_profile_not_permitted';
  END IF;

  UPDATE public.omni_comms_product_communication_config
     SET is_enabled = coalesce(p_is_enabled, is_enabled),
         delivery_mode = v_mode,
         recipient_source = v_source,
         template_family_code = v_template,
         sender_profile_code = v_sender,
         updated_by = v_actor
   WHERE id = v_before.id
  RETURNING * INTO v_after;

  INSERT INTO public.omni_comms_product_communication_audit (
    organization_id, product_id, event_code, channel, action,
    before_state, after_state, reason, actor_id)
  VALUES (p_organization_id, p_product_id, p_event_code, p_channel,
    CASE WHEN p_is_enabled IS DISTINCT FROM NULL
              AND p_is_enabled IS DISTINCT FROM v_before.is_enabled
         THEN CASE WHEN p_is_enabled THEN 'enabled' ELSE 'disabled' END
         ELSE 'updated' END,
    to_jsonb(v_before) - 'id', to_jsonb(v_after) - 'id',
    left(coalesce(p_reason,''), 500), v_actor);

  RETURN public.omni_comms_product_communication_read(p_organization_id, p_product_id);
END; $function$;
GRANT EXECUTE ON FUNCTION public.omni_comms_product_communication_update(
  uuid, uuid, text, text, boolean, text, text, text, text, boolean, boolean, text) TO authenticated;

-- ── 8. Producer-facing resolution ──────────────────────────────────────
-- Consumed at the Benefits claim-submission boundary BEFORE an Email
-- obligation is created. Bounded, no secrets, no recipient data.
CREATE OR REPLACE FUNCTION public.omni_comms_product_communication_resolve(
  p_organization_id uuid, p_product_id uuid,
  p_event_code text DEFAULT 'BENEFITS.CLAIM.SUBMITTED',
  p_channel text DEFAULT 'email')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cfg public.omni_comms_product_communication_config;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001', DETAIL='authentication_required';
  END IF;
  IF p_product_id IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'product_unresolved');
  END IF;
  SELECT * INTO v_cfg FROM public.omni_comms_product_communication_config
   WHERE product_id = p_product_id AND event_code = p_event_code
     AND channel = p_channel AND organization_id = p_organization_id;
  IF v_cfg.id IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'not_configured');
  END IF;
  IF NOT v_cfg.is_enabled THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'disabled_for_product');
  END IF;
  RETURN jsonb_build_object('enabled', true, 'reason', 'configured',
    'channel', v_cfg.channel, 'delivery_mode', v_cfg.delivery_mode,
    'recipient_source', v_cfg.recipient_source)
    || public.omni_comms_priv_product_communication_effective(
         p_organization_id, v_cfg.event_code, v_cfg.channel,
         v_cfg.template_family_code, v_cfg.sender_profile_code);
END; $function$;
GRANT EXECUTE ON FUNCTION public.omni_comms_product_communication_resolve(uuid, uuid, text, text) TO authenticated;

-- ── 9. Truthful automatic-scheduler readiness ──────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_scheduler_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job record; v_last public.omni_comms_scheduler_run; v_last_ok timestamptz;
  v_cert jsonb; v_fresh boolean; v_ready boolean;
BEGIN
  SELECT jobname, schedule, active INTO v_job
    FROM cron.job WHERE jobname = 'omni-comms-dispatch-every-minute' LIMIT 1;
  SELECT * INTO v_last FROM public.omni_comms_scheduler_run
   WHERE execution_context = 'scheduler' ORDER BY created_at DESC LIMIT 1;
  SELECT max(created_at) INTO v_last_ok FROM public.omni_comms_scheduler_run
   WHERE execution_context = 'scheduler' AND blocker IS NULL;
  v_cert := public.omni_comms_priv_runtime_certification();
  v_fresh := v_last.created_at IS NOT NULL AND v_last.created_at > now() - interval '3 minutes';
  v_ready := v_job.jobname IS NOT NULL AND coalesce(v_job.active,false)
    AND v_fresh
    AND coalesce(v_last.blocker,'') NOT IN ('scheduler_unauthorized','deployment_not_certified','runtime_revision_mismatch')
    AND v_cert->>'certification_state' = 'certified';
  RETURN jsonb_build_object(
    'installed', v_job.jobname IS NOT NULL,
    'active', coalesce(v_job.active,false),
    'schedule', coalesce(v_job.schedule,'not_installed'),
    'frequency', CASE WHEN v_job.schedule = '* * * * *' THEN 'every minute'
                      ELSE coalesce(v_job.schedule,'not_installed') END,
    'last_run_at', v_last.created_at,
    'last_successful_run_at', v_last_ok,
    'last_run_scanned', v_last.scanned_jobs,
    'last_run_claimed', v_last.claimed_jobs,
    'last_run_blocker', v_last.blocker,
    'run_fresh', coalesce(v_fresh,false),
    'ready', coalesce(v_ready,false));
END; $function$;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_scheduler_health() TO authenticated;