-- =====================================================================
-- WARNING — DESTRUCTIVE
-- Executing this rollback with COMMIT permanently removes the immutable
-- C5A preflight history.
--
-- This script therefore ends in ROLLBACK by default. Nothing is destroyed
-- unless a reviewer explicitly enables the COMMIT line after approval.
-- =====================================================================
-- Omni-Comms Channels C5A — rollback (Test Centre preflight + ledger only).
-- Scope: strictly the objects introduced by C5A. Touches nothing else.
--
-- Not touched by this script (explicit negative scope):
--   - Provider Accounts, Channel Identities, Channel Endpoints,
--     Channel Bindings, Channel Policies.
--   - Runtime delivery objects (request / message / dispatch job /
--     delivery attempt) — this script contains no statement against them.
--   - Legacy Communication Hub objects.
BEGIN;

DROP FUNCTION IF EXISTS public.omni_comms_channel_test_centre_summary(uuid,uuid,text,uuid,integer);
DROP FUNCTION IF EXISTS public.omni_comms_channel_test_run_preflight(uuid,uuid,text,uuid,text,jsonb,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_run_json(public.omni_comms_channel_test_run, boolean);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_checklist(text,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_normalize_payload(text,jsonb);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_normalize_target(text,text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_config_fingerprint(uuid,uuid,text,uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_config_snapshot(uuid,uuid,text,uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_sha256(text);

DROP TRIGGER IF EXISTS omni_comms_ctr_immutable_trg ON public.omni_comms_channel_test_run;
DROP TABLE IF EXISTS public.omni_comms_channel_test_run;
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_test_run_immutable();

-- COMMIT;  -- enable only after explicit approval to destroy C5A history
ROLLBACK;
