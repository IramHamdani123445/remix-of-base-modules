-- =====================================================================
-- Rollback — Accelerated Build 3 Slice 1 runtime foundation.
-- Rehearsal-only. Do NOT run against Live without written authorization.
-- Drops the seven runtime tables, their triggers/helpers, and the verifier
-- probe added in the Slice 1 migrations. Data in those tables is destroyed.
-- =====================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.omni_comms_priv_slice1_verify();

DROP TABLE IF EXISTS public.omni_comms_message_event      CASCADE;
DROP TABLE IF EXISTS public.omni_comms_delivery_attempt   CASCADE;
DROP TABLE IF EXISTS public.omni_comms_dispatch_job       CASCADE;
DROP TABLE IF EXISTS public.omni_comms_message            CASCADE;
DROP TABLE IF EXISTS public.omni_comms_recipient          CASCADE;
DROP TABLE IF EXISTS public.omni_comms_request            CASCADE;
DROP TABLE IF EXISTS public.omni_comms_event_route        CASCADE;

-- Uncomment to commit:
-- COMMIT;
ROLLBACK;
