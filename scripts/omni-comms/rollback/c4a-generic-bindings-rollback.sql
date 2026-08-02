-- ═══════════════════════════════════════════════════════════════════
-- Omni-Comms Channels C4A — rollback
--
-- Scope: ONLY the C4A generic binding surface. This script never touches
-- the Legacy Communication Hub, and never deletes a binding row: the
-- pre-C4A binding records, identifiers, priorities and history survive.
--
-- Effect:
--   1. drops the generic binding RPCs and workers;
--   2. restores the Email-only binding wrappers to direct implementations
--      that call the pre-C4A table shape;
--   3. drops the C4A columns, constraints and indexes;
--   4. restores the original uniqueness rule.
--
-- Run inside a transaction and verify with
-- scripts/omni-comms/verify-c4a-generic-bindings.sql BEFORE committing.
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

DROP FUNCTION IF EXISTS public.omni_comms_channel_binding_summary(uuid,uuid,text,boolean);
DROP FUNCTION IF EXISTS public.omni_comms_channel_binding_upsert_draft(uuid,timestamptz,uuid,uuid,text,uuid,uuid,uuid,integer,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_binding_set_lifecycle(uuid,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_binding_upsert(uuid,uuid,timestamptz,uuid,uuid,text,uuid,uuid,uuid,integer,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_binding_lifecycle(uuid,uuid,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_record_binding_verification(uuid,uuid,timestamptz,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_validate_binding(uuid,uuid,uuid,text,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.omni_comms_priv_binding_endpoint_requirement(text);

-- Restore pre-C4A Email binding behaviour (direct table writes).
CREATE OR REPLACE FUNCTION public.omni_comms_binding_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_sender_identity_id uuid,
  p_provider_account_id uuid, p_priority integer, p_external_sender_ref text,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_sender_provider_binding(
      sender_identity_id, provider_account_id, priority, external_sender_ref,
      status, verification_status, created_by, updated_by)
    VALUES(p_sender_identity_id, p_provider_account_id,
      COALESCE(p_priority,100), NULLIF(btrim(coalesce(p_external_sender_ref,'')),''),
      'draft','unverified', v_uid, v_uid)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  UPDATE public.omni_comms_sender_provider_binding
     SET sender_identity_id = p_sender_identity_id,
         provider_account_id = p_provider_account_id,
         priority = COALESCE(p_priority,100),
         external_sender_ref = NULLIF(btrim(coalesce(p_external_sender_ref,'')),''),
         updated_by = v_uid, updated_at = now()
   WHERE id = p_id AND updated_at IS NOT DISTINCT FROM p_expected_updated_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  RETURN p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_binding_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  UPDATE public.omni_comms_sender_provider_binding
     SET status='active', activated_by=COALESCE(activated_by, v_uid),
         updated_by=v_uid, updated_at=now()
   WHERE id=p_id AND updated_at IS NOT DISTINCT FROM p_expected_updated_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  RETURN p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_binding_record_verification(
  p_id uuid, p_expected_updated_at timestamptz, p_status text,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  UPDATE public.omni_comms_sender_provider_binding
     SET verification_status = p_status, updated_by = v_uid, updated_at = now()
   WHERE id=p_id AND updated_at IS NOT DISTINCT FROM p_expected_updated_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch';
  END IF;
  RETURN p_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.omni_comms_binding_record_verification(uuid,timestamptz,text,text)
  TO authenticated, service_role;

-- Any binding suspended by C4A returns to the pre-C4A active state.
UPDATE public.omni_comms_sender_provider_binding
   SET status = 'active' WHERE status = 'disabled';

DROP INDEX IF EXISTS public.omni_comms_binding_combination_uk;
DROP INDEX IF EXISTS public.omni_comms_binding_scope_priority_uk;
DROP INDEX IF EXISTS public.omni_comms_binding_org_channel_ix;

ALTER TABLE public.omni_comms_sender_provider_binding
  DROP CONSTRAINT IF EXISTS omni_comms_binding_channel_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_origin_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_verification_source_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_verification_pairing_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_result_code_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_verification_detail_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_external_ref_shape_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_status_chk;

ALTER TABLE public.omni_comms_sender_provider_binding
  ADD CONSTRAINT omni_comms_binding_status_chk
    CHECK (status IN ('draft','active','retired'));

ALTER TABLE public.omni_comms_sender_provider_binding
  DROP COLUMN IF EXISTS organization_id,
  DROP COLUMN IF EXISTS department_id,
  DROP COLUMN IF EXISTS channel,
  DROP COLUMN IF EXISTS channel_endpoint_id,
  DROP COLUMN IF EXISTS data_origin,
  DROP COLUMN IF EXISTS verification_source,
  DROP COLUMN IF EXISTS verification_result_code,
  DROP COLUMN IF EXISTS verification_detail,
  DROP COLUMN IF EXISTS verification_checked_at,
  DROP COLUMN IF EXISTS disabled_at,
  DROP COLUMN IF EXISTS disabled_by;

ALTER TABLE public.omni_comms_sender_provider_binding
  ADD CONSTRAINT omni_comms_binding_unique_pair_uk
    UNIQUE (sender_identity_id, provider_account_id);

-- COMMIT;  -- uncomment only after verification passes
ROLLBACK;
