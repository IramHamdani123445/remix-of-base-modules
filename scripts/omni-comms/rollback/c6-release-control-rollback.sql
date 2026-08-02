-- ============================================================================
-- Omni-Comms Phase C6 — Release Control rollback
--
-- SAFETY: this script runs inside a transaction that ends in ROLLBACK by
-- default. Nothing is dropped unless an operator deliberately edits the final
-- statement to COMMIT after reviewing the output.
--
-- Scope: Phase C6 objects ONLY (including the C6 closure correction). It never
-- touches C1–C5B objects, the runtime spine, provider credentials, or any
-- Legacy Communication Hub object. It contains no DROP/DELETE/TRUNCATE against
-- any C5B object.
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

-- Public administration RPCs -------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_summary(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_upsert_configuration(uuid, timestamptz, uuid, uuid, text, text[], text[], text[], jsonb, integer, integer, integer, integer, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_set_basic_state(uuid, timestamptz, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_propose_pilot(uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_cancel_proposal(uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_release_control_suspend(uuid, timestamptz, text, text);

-- Private helpers and the runtime decision oracle -----------------------------
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_decision(uuid, uuid, text, text, text, text, text[], integer, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_approve_activate(uuid, uuid, timestamptz, text, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_prerequisites(uuid, uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_effective(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_expire_if_due(uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_recipient_rules(text, jsonb);

-- Dispatch-job release snapshot columns (C6 additions only) ------------------
ALTER TABLE public.omni_comms_dispatch_job
  DROP CONSTRAINT IF EXISTS omni_comms_dispatch_job_release_snapshot_bounded;

ALTER TABLE public.omni_comms_dispatch_job
  DROP COLUMN IF EXISTS release_control_id,
  DROP COLUMN IF EXISTS release_version_at_decision,
  DROP COLUMN IF EXISTS release_state_at_decision,
  DROP COLUMN IF EXISTS release_fingerprint_at_decision,
  DROP COLUMN IF EXISTS release_expires_at_decision,
  DROP COLUMN IF EXISTS release_decision_snapshot,
  DROP COLUMN IF EXISTS release_decision_at;

DROP FUNCTION IF EXISTS public.omni_comms_priv_release_decision_snapshot_bounded(jsonb);

-- Tables (child first) plus their row-scoped functions ------------------------
DROP TABLE IF EXISTS public.omni_comms_channel_release_event;
DROP TABLE IF EXISTS public.omni_comms_channel_release_control;
DROP FUNCTION IF EXISTS public.omni_comms_priv_release_event_append_only();
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_release_control_guard();

-- Post-removal proof ---------------------------------------------------------
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'omni_comms_channel_release%';

-- Proof that every C5B object survives the rollback.
SELECT 'c5b_tables_after_rollback' AS check, count(*) = 4 AS passed
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('omni_comms_channel_test_run',
                    'omni_comms_channel_test_delivery',
                    'omni_comms_channel_test_delivery_attempt',
                    'omni_comms_channel_test_delivery_event');

-- Default: DO NOT APPLY.
ROLLBACK;
