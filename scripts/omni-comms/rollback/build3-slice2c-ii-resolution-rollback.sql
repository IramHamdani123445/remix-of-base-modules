-- ============================================================================
-- Omni-Comms — Slice 2c-ii Batch C rollback (SQL-side).
--
-- Removes ONLY Slice 2c-ii artefacts:
--   * public.omni_comms_priv_runtime_resolution_snapshot(...)
--   * public.omni_comms_priv_finalize_resolution(...)
--   * public.omni_comms_priv_load_persisted_resolution(...)
--   * public.omni_comms_priv_next_event_sequence(...)
--   * Slice 2c-ii private helpers (see DROP section)
--
-- PRESERVES:
--   * Slice 1 runtime tables (omni_comms_batch/request/recipient/message/
--     dispatch_job/delivery_attempt/message_event).
--   * Slice 2a façade rule and canonical façade file.
--   * Slice 2b request persistence + idempotency:
--       public.omni_comms_priv_send_communication (kept intact).
--   * Slice 2c-i Edge boundary and server-authoritative fingerprint.
--   * Build 1 shared assets/layouts + core_priv_verify_department_ownership.
--   * Build 2 sender/provider/channel configuration RPCs and tables.
--   * UI stabilization; route and object registries.
--
-- Non-SQL rollback (documented for operators; cannot be executed by SQL):
--   * TypeScript: revert changes under
--       src/platform/omni-comms/architecture/checks/checkResolverBoundary.ts
--       src/__tests__/omni-comms/build3-slice2c-ii-batch-c.test.ts
--       src/platform/omni-comms/registry/readinessManifest.ts (currentStory / nextStep)
--   * Edge Function: redeploy supabase/functions/omni-comms-runtime WITHOUT
--     the resolution/** modules — Batch B wiring depends on the RPCs above.
--   * Evidence: delete
--       src/platform/omni-comms/registry/evidence/build3-slice2c-ii-resolution.md
--       src/platform/omni-comms/registry/evidence/build3-slice2c-ii-test-baseline.json
--
-- Syntax-validate mode: wrapping in an explicit transaction and rolling
-- back leaves the database unchanged. This is the intended validation
-- path in the sandbox.
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN;

-- Drop only Slice 2c-ii RPCs. Signatures use IF EXISTS to remain idempotent.
DROP FUNCTION IF EXISTS public.omni_comms_priv_runtime_resolution_snapshot(uuid, uuid, uuid, text, text[]);
DROP FUNCTION IF EXISTS public.omni_comms_priv_finalize_resolution(uuid, uuid, uuid, jsonb, jsonb, text[], text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_load_persisted_resolution(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_next_event_sequence(uuid);

-- PRESERVE marker: omni_comms_priv_send_communication is NOT dropped here.
-- (String kept in-file so verifier tests can confirm preservation intent.)

-- Roll back so this script can be used purely as a syntax-validation.
ROLLBACK;
