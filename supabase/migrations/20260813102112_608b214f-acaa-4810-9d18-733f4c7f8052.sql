-- 1. Purpose-bound scheduler tickets ------------------------------------
ALTER TABLE public.omni_comms_scheduler_ticket
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'dispatch';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.omni_comms_scheduler_ticket'::regclass
      AND conname = 'omni_comms_scheduler_ticket_purpose_chk'
  ) THEN
    ALTER TABLE public.omni_comms_scheduler_ticket
      ADD CONSTRAINT omni_comms_scheduler_ticket_purpose_chk
      CHECK (purpose IN ('dispatch','business_event_ingest'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_scheduler_issue_ticket(
  p_purpose text DEFAULT 'dispatch')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nonce text;
  v_purpose text := coalesce(nullif(btrim(p_purpose), ''), 'dispatch');
BEGIN
  IF v_purpose NOT IN ('dispatch','business_event_ingest') THEN
    RAISE EXCEPTION 'OC422 scheduler_purpose_invalid' USING ERRCODE='P0001';
  END IF;
  DELETE FROM public.omni_comms_scheduler_ticket
   WHERE expires_at < now() - interval '1 hour';
  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.omni_comms_scheduler_ticket (nonce, purpose)
  VALUES (v_nonce, v_purpose);
  RETURN v_nonce;
END $$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_scheduler_consume_ticket(
  p_nonce text, p_purpose text DEFAULT 'dispatch')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_purpose text := coalesce(nullif(btrim(p_purpose), ''), 'dispatch');
BEGIN
  UPDATE public.omni_comms_scheduler_ticket
     SET consumed_at = now(), updated_at = now()
   WHERE nonce = coalesce(p_nonce,'')
     AND consumed_at IS NULL
     AND expires_at > now()
     AND purpose = v_purpose
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_issue_ticket(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_scheduler_issue_ticket(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text, text) TO service_role;

-- 2. Trusted system producer authorisation (no operator identity) --------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_authorize_system_producer_event(
  p_organization_id uuid,
  p_caller_module_code text,
  p_event_code text,
  p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_binding uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'organization_required');
  END IF;
  IF p_mode IS DISTINCT FROM 'queued' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'mode_invalid');
  END IF;

  SELECT b.id INTO v_binding
  FROM public.omni_comms_producer_event_binding b
  JOIN public.omni_comms_event_definition e ON e.id = b.event_definition_id
  WHERE b.organization_id = p_organization_id
    AND b.caller_module_code = upper(btrim(coalesce(p_caller_module_code,'')))
    AND e.code = btrim(coalesce(p_event_code,''))
    AND b.status = 'active'
  LIMIT 1;

  IF v_binding IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'producer_event_not_authorized');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'code', 'authorized', 'binding_id', v_binding);
END $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_system_producer_event(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_authorize_system_producer_event(uuid, text, text, text) TO service_role;

-- 3. Read-only outbox health --------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_business_event_outbox_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending',      count(*) FILTER (WHERE status = 'pending'),
    'processing',   count(*) FILTER (WHERE status = 'processing'),
    'processed',    count(*) FILTER (WHERE status = 'processed'),
    'blocked',      count(*) FILTER (WHERE status = 'blocked'),
    'needs_review', count(*) FILTER (WHERE status = 'needs_review'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status = 'pending'),
    'checked_at', now()
  )
  FROM public.omni_comms_business_event_outbox;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_business_event_outbox_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_business_event_outbox_health() TO authenticated, service_role;

-- 4. Automatic ingest tick ----------------------------------------------
SELECT cron.unschedule('omni-comms-business-event-ingest-every-minute')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'omni-comms-business-event-ingest-every-minute'
);

SELECT cron.schedule(
  'omni-comms-business-event-ingest-every-minute',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xynceskeiiisiefqlgxo.supabase.co/functions/v1/omni-comms-business-event-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5bmNlc2tlaWlpc2llZnFsZ3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTQxMDAsImV4cCI6MjA4ODczMDEwMH0.kVVysArl8ujrAHpHLtNx7xifYyq02ulIE5c4WKKSXCI',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5bmNlc2tlaWlpc2llZnFsZ3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTQxMDAsImV4cCI6MjA4ODczMDEwMH0.kVVysArl8ujrAHpHLtNx7xifYyq02ulIE5c4WKKSXCI',
      'x-omni-comms-ingest-ticket', 'scheduler',
      'x-omni-comms-scheduler-nonce', public.omni_comms_priv_scheduler_issue_ticket('business_event_ingest')
    ),
    body := jsonb_build_object('batchLimit', 10),
    timeout_milliseconds := 25000
  );
  $cron$
);
