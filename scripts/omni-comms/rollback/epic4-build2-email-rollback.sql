-- ============================================================================
-- Omni-Comms Accelerated Build 2 — Rollback (dependency-safe).
--
-- Reverses Build 2 ONLY. Leaves Epic 4 Story 1 tables, Epic 2/3 objects,
-- shared assets, Legacy Hub, navigation and permissions untouched.
--
-- Order matters: drop public RPCs before the private helpers they depend on.
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.omni_comms_email_config_summary(uuid);
DROP FUNCTION IF EXISTS public.omni_comms_channel_setting_upsert(uuid,timestamptz,uuid,uuid,text,boolean,boolean,time,time,text,integer,text);
DROP FUNCTION IF EXISTS public.omni_comms_binding_activate(uuid,timestamptz,text);
DROP FUNCTION IF EXISTS public.omni_comms_binding_record_verification(uuid,timestamptz,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_binding_upsert_draft(uuid,timestamptz,uuid,uuid,integer,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_sender_identity_activate(uuid,timestamptz,text);
DROP FUNCTION IF EXISTS public.omni_comms_sender_identity_upsert_draft(uuid,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_provider_account_record_credential_check(uuid,timestamptz,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_provider_account_activate(uuid,timestamptz,text);
DROP FUNCTION IF EXISTS public.omni_comms_provider_account_upsert_draft(uuid,timestamptz,uuid,text,text,text,text,boolean,text);
DROP FUNCTION IF EXISTS public.omni_comms_email_provider_activate(uuid,timestamptz,text);
DROP FUNCTION IF EXISTS public.omni_comms_email_provider_ensure(text);

DROP FUNCTION IF EXISTS public.omni_comms_priv_email_provider_id();
DROP FUNCTION IF EXISTS public.omni_comms_priv_write_channel_audit(uuid,text,text,uuid,text,jsonb,jsonb,text);

COMMIT;
