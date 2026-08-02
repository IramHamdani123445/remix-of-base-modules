-- ============================================================================
-- Omni-Comms Phase C6 closure correction (additive / idempotent)
-- ============================================================================

-- 1. Canonical dispatch-job release decision snapshot -------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_version')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_version_at_decision') THEN
    ALTER TABLE public.omni_comms_dispatch_job RENAME COLUMN release_version TO release_version_at_decision;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_state_snapshot')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_state_at_decision') THEN
    ALTER TABLE public.omni_comms_dispatch_job RENAME COLUMN release_state_snapshot TO release_state_at_decision;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_fingerprint')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_fingerprint_at_decision') THEN
    ALTER TABLE public.omni_comms_dispatch_job RENAME COLUMN release_fingerprint TO release_fingerprint_at_decision;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_expires_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='omni_comms_dispatch_job'
               AND column_name='release_expires_at_decision') THEN
    ALTER TABLE public.omni_comms_dispatch_job RENAME COLUMN release_expires_at TO release_expires_at_decision;
  END IF;
END
$$;

ALTER TABLE public.omni_comms_dispatch_job
  ADD COLUMN IF NOT EXISTS release_control_id uuid,
  ADD COLUMN IF NOT EXISTS release_version_at_decision integer,
  ADD COLUMN IF NOT EXISTS release_state_at_decision text,
  ADD COLUMN IF NOT EXISTS release_fingerprint_at_decision text,
  ADD COLUMN IF NOT EXISTS release_expires_at_decision timestamptz,
  ADD COLUMN IF NOT EXISTS release_decision_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS release_decision_at timestamptz;

ALTER TABLE public.omni_comms_dispatch_job
  ALTER COLUMN release_decision_snapshot DROP NOT NULL;

ALTER TABLE public.omni_comms_dispatch_job
  ALTER COLUMN release_decision_snapshot DROP DEFAULT;

-- Bounded, recipient-free decision snapshot ----------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_release_decision_snapshot_bounded(p_snapshot jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_snapshot IS NULL
     OR (
       jsonb_typeof(p_snapshot) = 'object'
       AND length(p_snapshot::text) <= 8192
       -- no raw email address, no rendered content, no credential material
       AND p_snapshot::text !~* '[A-Za-z0-9._%%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
       AND p_snapshot::text !~* '(secret_ref|secret_name|api_key|authorization|bearer |password|rendered_|body_html|body_text)'
     );
$$;

ALTER TABLE public.omni_comms_dispatch_job
  DROP CONSTRAINT IF EXISTS omni_comms_dispatch_job_release_snapshot_bounded;
ALTER TABLE public.omni_comms_dispatch_job
  ADD CONSTRAINT omni_comms_dispatch_job_release_snapshot_bounded
  CHECK (public.omni_comms_priv_release_decision_snapshot_bounded(release_decision_snapshot));

-- 2. Release-event ledger immutability (OC412) --------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_release_event_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'OC412 immutable_release_event'
    USING ERRCODE = '42501',
          DETAIL = 'omni_comms_channel_release_event is append-only; update and delete are rejected for every role, including service_role.';
END;
$$;

DROP TRIGGER IF EXISTS omni_comms_release_event_append_only ON public.omni_comms_channel_release_event;
CREATE TRIGGER omni_comms_release_event_append_only
  BEFORE UPDATE OR DELETE ON public.omni_comms_channel_release_event
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_release_event_append_only();

-- 3. Private runtime oracles remain service-role only -------------------------
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_evaluate_decision(uuid, uuid, text, text, text, text, jsonb);

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_decision(uuid, uuid, text, text, text, text, text[], integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_release_decision(uuid, uuid, text, text, text, text, text[], integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_prerequisites(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_release_prerequisites(uuid, uuid, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_approve_activate(uuid, uuid, timestamptz, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_release_approve_activate(uuid, uuid, timestamptz, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.omni_comms_priv_release_decision_snapshot_bounded(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_release_decision_snapshot_bounded(jsonb) TO service_role;

-- 4. C6 invariant: every job stays held and non-runnable ----------------------
UPDATE public.omni_comms_dispatch_job SET is_runnable = false WHERE is_runnable IS TRUE;