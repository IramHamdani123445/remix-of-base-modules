-- =====================================================================
-- Omni-Comms C5B Closure — FAIL-SAFE ROLLBACK REHEARSAL
-- =====================================================================
-- WARNING: This script is destructive by intent and is therefore written
-- as a REHEARSAL. It runs inside a transaction that ends in ROLLBACK, so
-- nothing is removed when it is executed as-is.
--
-- To perform a real rollback, an authorised operator must deliberately
-- replace the final ROLLBACK; with COMMIT; after taking a backup and
-- confirming that no C5B evidence is required for audit.
--
-- Scope: Channels C5B Closure only (retry-safe controlled Resend test
-- delivery). It must not touch live business sending, templates, routing,
-- producers or any earlier epic.
-- =====================================================================

BEGIN;

-- 1. Attempt ledger introduced by the closure.
DROP TABLE IF EXISTS public.omni_comms_channel_test_delivery_attempt CASCADE;

-- 2. Retry-safety columns added to the delivery ledger.
ALTER TABLE public.omni_comms_channel_test_delivery
  DROP COLUMN IF EXISTS claim_token,
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS provider_idempotency_key,
  DROP COLUMN IF EXISTS provider_payload_hash;

-- 3. Approval window, volume and spacing controls.
ALTER TABLE public.omni_comms_channel_setting
  DROP COLUMN IF EXISTS controlled_test_approval_expires_at,
  DROP COLUMN IF EXISTS controlled_test_max_deliveries,
  DROP COLUMN IF EXISTS controlled_test_min_interval_seconds;

-- 4. Closure-specific helpers.
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_effective_policy(uuid, text, uuid) CASCADE;

-- 5. Proof that the rollback leaves no C5B closure objects behind.
SELECT to_regclass('public.omni_comms_channel_test_delivery_attempt') AS attempt_ledger_after_rollback;

-- =====================================================================
-- FAIL-SAFE TERMINATOR — do not remove.
-- =====================================================================
ROLLBACK;
