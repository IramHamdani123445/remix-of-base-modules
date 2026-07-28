-- Epic 4 Story 1 — Documented rollback for Provider / Sender / Channel foundation.
-- Documentation only. Do NOT execute against a production database without
-- explicit approval and a fresh dependency check.
--
-- Preserves Epic 1, Epic 2, Epic 3, Legacy artefacts, public.core_audit_log,
-- navigation records, permissions and secrets.
--
-- Execute in the exact order below. No CASCADE anywhere.

BEGIN;

-- 1. Triggers.
DROP TRIGGER IF EXISTS omni_comms_channel_setting_guard      ON public.omni_comms_channel_setting;
DROP TRIGGER IF EXISTS omni_comms_binding_guard              ON public.omni_comms_sender_provider_binding;
DROP TRIGGER IF EXISTS omni_comms_sender_identity_guard      ON public.omni_comms_sender_identity;
DROP TRIGGER IF EXISTS omni_comms_provider_account_lifecycle_guard ON public.omni_comms_provider_account;
DROP TRIGGER IF EXISTS omni_comms_provider_lifecycle_guard   ON public.omni_comms_provider;

-- 2. Tables (leaf → root dependency order).
DROP TABLE IF EXISTS public.omni_comms_channel_setting;
DROP TABLE IF EXISTS public.omni_comms_sender_provider_binding;
DROP TABLE IF EXISTS public.omni_comms_sender_identity;
DROP TABLE IF EXISTS public.omni_comms_provider_account;
DROP TABLE IF EXISTS public.omni_comms_provider;

-- 3. Story-scoped helper functions.
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_setting_guard();
DROP FUNCTION IF EXISTS public.omni_comms_priv_binding_guard();
DROP FUNCTION IF EXISTS public.omni_comms_priv_sender_identity_guard();
DROP FUNCTION IF EXISTS public.omni_comms_priv_provider_account_lifecycle_guard();
DROP FUNCTION IF EXISTS public.omni_comms_priv_provider_lifecycle_guard();
DROP FUNCTION IF EXISTS public.omni_comms_priv_validate_timezone(text);

ROLLBACK;  -- Replace with COMMIT only after explicit approval.
