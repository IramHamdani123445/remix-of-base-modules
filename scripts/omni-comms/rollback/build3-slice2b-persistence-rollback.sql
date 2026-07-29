-- =====================================================================
-- Omni-Comms Accelerated Build 3 — Slice 2b ROLLBACK
--
-- Removes ONLY Slice 2b artifacts:
--   * public.omni_comms_priv_send_communication (persistence RPC)
--
-- Preserves:
--   * All Slice 1 runtime tables and their triggers.
--   * Build 1 shared-asset objects.
--   * Build 2 provider/sender/binding/channel objects.
--   * UI stabilization changes and route registry.
--   * All Object/Route/Integration/Queue registries.
--
-- Manual TypeScript rollback (out of scope for this SQL):
--   * Restore src/platform/omni-comms/sendCommunication.ts to the
--     Slice 2a skeleton (returning runtime_not_available).
--   * Delete src/platform/omni-comms/runtime/canonicalize.ts,
--     fingerprint.ts, runtimeErrors.ts, sendCommunicationRuntime.ts.
--   * Revert the "Slice 2b" foundationStatus rows and reset the
--     manifest currentStory/nextStep pointers to the Slice 2a state.
-- =====================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.omni_comms_priv_send_communication(
  uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[]
);

COMMIT;

SELECT 'BUILD 3 SLICE 2B ROLLBACK OK' AS status;
