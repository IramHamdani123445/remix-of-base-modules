-- ============================================================
-- Omni-Comms C4B rollback — Generic Channel Policies
-- Restores the pre-C4B shape of public.omni_comms_channel_setting.
--
-- SAFETY:
--   * No policy row is deleted.
--   * Live delivery is never enabled by this script.
--   * Defaults to ROLLBACK. Change the final statement to COMMIT deliberately.
-- ============================================================
BEGIN;

-- 1. Drop C4B RPCs -------------------------------------------------------
DROP FUNCTION IF EXISTS public.omni_comms_channel_policy_upsert(uuid,timestamptz,uuid,uuid,text,jsonb,jsonb,text);
DROP FUNCTION IF EXISTS public.omni_comms_channel_policy_summary(uuid,uuid,text,boolean);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_policy_upsert(uuid,uuid,timestamptz,uuid,uuid,text,jsonb,jsonb,text);
DROP FUNCTION IF EXISTS public.omni_comms_priv_channel_policy_json(public.omni_comms_channel_setting);
DROP FUNCTION IF EXISTS public.omni_comms_priv_normalize_channel_policy(text,jsonb,jsonb);

-- 2. Restore the legacy Email policy RPC ---------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_setting_upsert(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_department_id uuid, p_channel text, p_enabled boolean,
  p_live_delivery_enabled boolean, p_quiet_hours_start time,
  p_quiet_hours_end time, p_quiet_hours_timezone text,
  p_per_minute_limit integer, p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','extensions'
AS $function$
DECLARE v_uid uuid;
  v_before public.omni_comms_channel_setting%ROWTYPE;
  v_after  public.omni_comms_channel_setting%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_channel IS NULL OR p_channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='email_channel_only_in_build2'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_channel_setting(
      organization_id,department_id,channel,enabled,live_delivery_enabled,
      quiet_hours_start,quiet_hours_end,quiet_hours_timezone,per_minute_limit,
      created_by,updated_by)
    VALUES(p_organization_id,p_department_id,p_channel,
      COALESCE(p_enabled,false),false,
      p_quiet_hours_start,p_quiet_hours_end,p_quiet_hours_timezone,
      p_per_minute_limit,v_uid,v_uid)
    RETURNING * INTO v_after;
    PERFORM public.omni_comms_priv_write_channel_audit(
      v_uid,'create','channel_setting',v_after.id,p_channel,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;
  SELECT * INTO v_before FROM public.omni_comms_channel_setting WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001',DETAIL='channel_setting'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001',DETAIL='updated_at_mismatch'; END IF;
  UPDATE public.omni_comms_channel_setting
     SET enabled=COALESCE(p_enabled,enabled),
         quiet_hours_start=p_quiet_hours_start,
         quiet_hours_end=p_quiet_hours_end,
         quiet_hours_timezone=p_quiet_hours_timezone,
         per_minute_limit=p_per_minute_limit,
         updated_by=v_uid, updated_at=now()
   WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid,'update','channel_setting',p_id,v_after.channel,to_jsonb(v_before),to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $function$;

-- 3. Restore the pre-C4B guard trigger function --------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_setting_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    IF NOT public.omni_comms_priv_verify_department_ownership(NEW.department_id, NEW.organization_id) THEN
      RAISE EXCEPTION 'omni_comms_channel_setting department does not belong to organization'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.quiet_hours_timezone IS NOT NULL THEN
    IF NOT public.omni_comms_priv_validate_timezone(NEW.quiet_hours_timezone) THEN
      RAISE EXCEPTION 'omni_comms_channel_setting invalid timezone %', NEW.quiet_hours_timezone
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- 4. Restore prior unique indexes ---------------------------------------
DROP INDEX IF EXISTS public.omni_comms_channel_setting_org_genuine_uk;
DROP INDEX IF EXISTS public.omni_comms_channel_setting_dept_genuine_uk;
DROP INDEX IF EXISTS public.omni_comms_channel_setting_org_reference_uk;
DROP INDEX IF EXISTS public.omni_comms_channel_setting_dept_reference_uk;

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_channel_setting_org_scope_uk
  ON public.omni_comms_channel_setting (organization_id, channel)
  WHERE department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_channel_setting_dept_scope_uk
  ON public.omni_comms_channel_setting (organization_id, department_id, channel)
  WHERE department_id IS NOT NULL;

-- 5. Drop C4B constraints and columns (rows are preserved) ---------------
ALTER TABLE public.omni_comms_channel_setting
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_data_origin_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_op_state_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_retry_profile_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_enabled_mirror_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_org_override_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_per_day_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_day_ge_minute_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_recipients_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_timeout_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_retention_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_currency_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_daily_cost_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_msg_cost_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_cost_currency_req_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_cost_ceiling_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_config_object_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_config_size_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_no_live_chk;

ALTER TABLE public.omni_comms_channel_setting
  DROP COLUMN IF EXISTS data_origin,
  DROP COLUMN IF EXISTS operational_state,
  DROP COLUMN IF EXISTS department_override_enabled,
  DROP COLUMN IF EXISTS per_day_limit,
  DROP COLUMN IF EXISTS max_recipients_per_request,
  DROP COLUMN IF EXISTS retry_profile,
  DROP COLUMN IF EXISTS request_timeout_seconds,
  DROP COLUMN IF EXISTS retention_days,
  DROP COLUMN IF EXISTS cost_currency,
  DROP COLUMN IF EXISTS daily_cost_limit_minor,
  DROP COLUMN IF EXISTS per_message_cost_limit_minor,
  DROP COLUMN IF EXISTS channel_policy_config;

-- Live delivery stays OFF after rollback.
UPDATE public.omni_comms_channel_setting SET live_delivery_enabled = false
 WHERE live_delivery_enabled;

-- ============================================================
ROLLBACK; -- change to COMMIT deliberately
