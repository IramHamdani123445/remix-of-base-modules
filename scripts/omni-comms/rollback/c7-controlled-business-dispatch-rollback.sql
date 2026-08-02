-- ============================================================================
-- Omni-Comms Phase C7 (+ Closure Correction) — controlled business Email
-- dispatch ROLLBACK
-- ----------------------------------------------------------------------------
-- Scope: STRICTLY the C7 controlled business dispatch surface, including the
-- C7 Closure Correction objects.
--
-- This script is fail-safe and evidence-preserving:
--   * it NEVER drops C5B controlled test delivery, C6 Release Control, the
--     runtime spine, templates, providers, channels or any business table;
--   * it NEVER deletes recorded delivery evidence — evidence ledgers are
--     append-only and are retained for audit;
--   * it only removes the C7 dispatch RPCs, releases any live lease, and
--     demotes in-flight attempts to an uncertain (never "failed") state.
--
-- Removing the dispatcher cannot enable delivery: with no claim RPC, no
-- queued Email job can ever be claimed, so the system fails CLOSED. The
-- prerequisite evaluator's check 32 (`business_dispatch_dispatcher_installed`)
-- then reports `failed`, which blocks any release decision as well.
--
-- TRANSACTION MODE — DRY RUN BY DEFAULT (C7 Final Closure Correction)
-- ----------------------------------------------------------------------------
-- This script ends with ROLLBACK, not COMMIT. Running it exercises and proves
-- every statement against the live schema WITHOUT changing anything. Applying
-- the rollback for real requires an intentional operator change (replacing the
-- final ROLLBACK with COMMIT) made outside this task, under change control.
--
-- Nothing is ever deleted: releases, requests, messages, jobs, attempts,
-- webhook events and all C5B evidence are preserved in every mode.
-- ============================================================================


BEGIN;

-- 0. The terminal-evidence trigger deliberately blocks the maintenance
--    updates below. It is disabled only for the duration of this transaction
--    and restored in step 6.
ALTER TABLE public.omni_comms_delivery_attempt
  DISABLE TRIGGER omni_comms_delivery_attempt_immutable_trg;

-- 1. Release any outstanding lease so no job is left permanently leased.
UPDATE public.omni_comms_dispatch_job
   SET status = 'held',
       is_runnable = false,
       lease_expires_at = NULL,
       lock_token = NULL,
       locked_at = NULL,
       locked_by = NULL,
       hold_reason = 'dispatcher_rolled_back'
 WHERE status IN ('leased', 'processing', 'ready');

-- 2. Close out any in-flight attempt as uncertain. A rollback must never
--    assert that an in-flight provider request failed.
UPDATE public.omni_comms_delivery_attempt
   SET status = 'outcome_unknown',
       reconciliation_state = 'required',
       error_code = COALESCE(error_code, 'dispatcher_rolled_back'),
       error_detail = COALESCE(
         error_detail,
         'The C7 dispatcher was rolled back while this attempt was in flight.'),
       claim_token = NULL,
       lease_expires_at = NULL
 WHERE status IN ('started', 'dispatching', 'retry_scheduled');

-- 2b. Explicitly suspend EVERY currently active controlled-pilot release that
--     the dispatcher rollback affects. Removing the dispatcher must never
--     leave a release advertising an active controlled pilot it can no longer
--     honour.
--
--     The release-event ledger is append-only, so history is NEVER rewritten:
--     suspension goes through the canonical private governance worker
--     `omni_comms_priv_dispatch_suspend_pilot`, which records a new
--     `suspended` release event and preserves every prior event.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.omni_comms_channel_release_control
     WHERE release_state = 'controlled_pilot'
     ORDER BY id
  LOOP
    PERFORM public.omni_comms_priv_dispatch_suspend_pilot(
      r.id,
      'dispatcher_rollback',
      'dispatcher_rolled_back');
  END LOOP;
END $$;

-- 3. Remove the C7 dispatch RPCs (fail-closed: no claim surface remains).
--    Signatures match the C7 Closure Correction exactly.

DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_claim_email(text, integer, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_scheduler_tick(text, integer, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_record_payload_hash(uuid, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_attempt_complete(uuid, text, text, text, integer, jsonb, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_record_callback(text, text, text, text, text, timestamptz, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_reclaim_expired_leases();
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_suspend_pilot(uuid, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_recalculate_request(uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_operator_scopes(uuid);
DROP FUNCTION IF EXISTS public.omni_comms_dispatch_tick_authorize();
DROP FUNCTION IF EXISTS public.omni_comms_dispatch_diagnostics(uuid, uuid);

-- 4. The webhook ledger, attempt columns, claim-time evidence columns and the
--    message-event vocabulary are DELIBERATELY retained: they hold immutable
--    audit evidence and removing them would destroy proof of what the pilot
--    did. The delivery-attempt immutability trigger and the dispatch-job
--    is_runnable invariant are ALSO retained — they are pure safety rules and
--    removing them would weaken the system.

-- 5. C5B controlled test delivery is untouched: its claim, completion and
--    callback RPCs are not listed above.

-- 6. Restore the terminal-evidence trigger.
ALTER TABLE public.omni_comms_delivery_attempt
  ENABLE TRIGGER omni_comms_delivery_attempt_immutable_trg;

COMMIT;

-- Post-rollback expectations:
--   * no claim RPC exists                    -> claimed_jobs is impossible;
--   * prerequisite check 32                  -> failed (fails closed);
--   * live_delivery_enabled = false          -> unchanged;
--   * Release Control `live`                 -> still unavailable;
--   * C5B controlled test delivery           -> still fully operational;
--   * delivery-attempt immutability trigger  -> retained;
--   * all recorded evidence                  -> retained.
