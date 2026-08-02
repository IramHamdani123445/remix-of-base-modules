-- ============================================================================
-- Omni-Comms Phase C7 — Controlled business Email dispatch ROLLBACK
-- ----------------------------------------------------------------------------
-- Scope: STRICTLY the C7 controlled business dispatch surface.
--
-- This script is fail-safe and evidence-preserving:
--   * it NEVER drops C5B controlled test delivery, C6 Release Control, the
--     runtime spine, templates, providers, channels or any business table;
--   * it NEVER deletes recorded delivery evidence — evidence ledgers are
--     append-only and are retained for audit;
--   * it only removes the C7 dispatch RPCs, releases any live lease, and
--     demotes the webhook ledger back to a non-consumed state.
--
-- Removing the dispatcher cannot enable delivery: with no claim RPC, no
-- queued Email job can ever be claimed, so the system fails CLOSED.
-- ============================================================================

BEGIN;

-- 1. Release any outstanding lease so no job is left permanently leased.
UPDATE public.omni_comms_dispatch_job
   SET status = 'held',
       is_runnable = false,
       leased_until = NULL,
       lease_token = NULL
 WHERE status IN ('leased', 'processing', 'ready');

-- 2. Close out any in-flight attempt as uncertain. A rollback must never
--    assert that an in-flight provider request failed.
UPDATE public.omni_comms_delivery_attempt
   SET status = 'outcome_unknown',
       error_code = COALESCE(error_code, 'dispatcher_rolled_back'),
       error_detail = COALESCE(
         error_detail,
         'The C7 dispatcher was rolled back while this attempt was in flight.'),
       claim_token = NULL,
       lease_expires_at = NULL
 WHERE status IN ('dispatching', 'retry_scheduled');

-- 3. Remove the C7 dispatch RPCs (fail-closed: no claim surface remains).
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_claim_email(text, integer, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_attempt_complete(uuid, text, text, text, integer, jsonb, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_record_callback(text, text, text, text, text, timestamptz, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_reclaim_expired_leases();
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_suspend_pilot(uuid, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_dispatch_tick_authorize();
DROP FUNCTION IF EXISTS public.omni_comms_dispatch_diagnostics(text);

-- 4. The webhook ledger, attempt columns and message-event vocabulary are
--    DELIBERATELY retained: they hold immutable audit evidence and removing
--    them would destroy proof of what the pilot did.

COMMIT;

-- Post-rollback expectations:
--   * no claim RPC exists            -> claimed_jobs is impossible;
--   * live_delivery_enabled = false  -> unchanged;
--   * Release Control `live`         -> still unavailable;
--   * C5B controlled test delivery   -> still fully operational;
--   * all recorded evidence          -> retained.
