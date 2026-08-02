-- ============================================================================
-- Omni-Comms Phase C6 — Release Control rollback
--
-- SAFETY: this script runs inside a transaction that ends in ROLLBACK by
-- default. Nothing is dropped unless an operator deliberately edits the final
-- statement to COMMIT after reviewing the output.
--
-- Scope: Phase C6 objects ONLY. It never touches C1–C5B objects, the runtime
-- spine, provider credentials, or any Legacy Communication Hub object.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  RAISE WARNING 'C6 ROLLBACK REHEARSAL: this transaction ends in ROLLBACK. Change the final statement to COMMIT only after deliberate review.';
END
$$;

-- Evidence before removal ----------------------------------------------------
SELECT 'release_controls' AS object, count(*) AS rows FROM public.omni_comms_channel_release_control
UNION ALL
SELECT 'release_events', count(*) FROM public.omni_comms_channel_release_event;

-- Public RPCs ----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_summary(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_upsert_configuration(uuid, timestamptz, uuid, uuid, text, text[], text[], text[], jsonb, integer, integer, integer, integer, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_set_basic_state(uuid, timestamptz, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_propose_pilot(uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_cancel_proposal(uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_suspend(uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_evaluate_decision(uuid, uuid, text, text, text, text, jsonb);

-- Private helpers ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_approve_activate(uuid, uuid, timestamptz, text, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_prerequisites(uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_fingerprint(uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_log_event(uuid, text, text, text, text, text);

-- Dispatch-job release snapshot columns (C6 additions only) ------------------
ALTER TABLE public.omni_comms_dispatch_job
  DROP COLUMN IF EXISTS release_control_id,
  DROP COLUMN IF EXISTS release_state_at_decision,
  DROP COLUMN IF EXISTS release_version_at_decision,
  DROP COLUMN IF EXISTS release_fingerprint_at_decision,
  DROP COLUMN IF EXISTS release_decision_at;

-- Tables (child first) -------------------------------------------------------
DROP TABLE IF EXISTS public.omni_comms_channel_release_event;
DROP TABLE IF EXISTS public.omni_comms_channel_release_control;

-- Post-removal proof ---------------------------------------------------------
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'omni_comms_channel_release%';

-- Default: DO NOT APPLY.
ROLLBACK;
