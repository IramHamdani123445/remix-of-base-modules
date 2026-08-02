-- Omni-Comms Channels C3B — rollback for the channel-endpoint objects.
--
-- Scope: ONLY the objects introduced by C3B. This script does not touch the
-- Legacy Communication Hub, notification_*, core_template*, or any object from
-- Channels C1, C2 or C3A.
--
-- Run inside a transaction and verify before committing.

BEGIN;

-- 1. Public RPCs -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_channel_endpoint_set_lifecycle(
  uuid, timestamptz, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_endpoint_upsert_draft(
  uuid, timestamptz, uuid, uuid, text, uuid, text, text, text, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_endpoint_summary(
  uuid, uuid, text, boolean);

-- 2. Private workers and normalisers ---------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_endpoint_lifecycle(
  uuid, timestamptz, text, text, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_endpoint_upsert(
  uuid, timestamptz, uuid, uuid, text, uuid, text, text, text, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_normalize_channel_endpoint(
  text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.omni_comms_priv_normalize_endpoint_url(text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_normalize_endpoint_domain(text);

-- 3. Tables (secret references first — child of the endpoint) --------------
DROP TABLE IF EXISTS public.omni_comms_channel_endpoint_secret_ref;
DROP TABLE IF EXISTS public.omni_comms_channel_endpoint;

-- 4. Email configuration summary --------------------------------------------
-- The C3B migration extended public.omni_comms_email_config_summary with an
-- `endpoints` key. Re-apply the immediately preceding C3A definition of that
-- function after running this script; it is unchanged apart from that key.

COMMIT;
