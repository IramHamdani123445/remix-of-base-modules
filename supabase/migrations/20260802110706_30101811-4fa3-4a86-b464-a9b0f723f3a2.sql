-- ============================================================
-- Omni-Comms C4B — Generic Channel Policies and Department Overrides
-- Additive + corrective. No new logical DB object.
-- ============================================================

-- ---------- 1. Columns ----------
ALTER TABLE public.omni_comms_channel_setting
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS operational_state text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS department_override_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS per_day_limit integer,
  ADD COLUMN IF NOT EXISTS max_recipients_per_request integer,
  ADD COLUMN IF NOT EXISTS retry_profile text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS request_timeout_seconds integer,
  ADD COLUMN IF NOT EXISTS retention_days integer,
  ADD COLUMN IF NOT EXISTS cost_currency text,
  ADD COLUMN IF NOT EXISTS daily_cost_limit_minor bigint,
  ADD COLUMN IF NOT EXISTS per_message_cost_limit_minor bigint,
  ADD COLUMN IF NOT EXISTS channel_policy_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------- 2. Backfill ----------
UPDATE public.omni_comms_channel_setting
   SET operational_state = CASE WHEN enabled THEN 'configuration' ELSE 'disabled' END,
       retry_profile = 'none',
       channel_policy_config = '{}'::jsonb,
       department_override_enabled = true,
       data_origin = 'user';

-- ---------- 3. Legacy live-delivery reset (audited) ----------
DO $mig$
DECLARE r record; v_cnt integer := 0;
BEGIN
  FOR r IN SELECT * FROM public.omni_comms_channel_setting WHERE live_delivery_enabled LOOP
    v_cnt := v_cnt + 1;
    BEGIN
      PERFORM public.omni_comms_priv_write_channel_audit(
        r.updated_by, 'update', 'channel_setting', r.id, r.channel,
        to_jsonb(r), to_jsonb(r) || jsonb_build_object('live_delivery_enabled', false),
        'c4b_legacy_live_flag_reset');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  UPDATE public.omni_comms_channel_setting SET live_delivery_enabled = false WHERE live_delivery_enabled;
  RAISE NOTICE 'c4b legacy live flags reset: %', v_cnt;
END $mig$;

-- ---------- 4. Constraints ----------
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
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_config_size_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_config_object_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_channel_setting_no_live_chk;

ALTER TABLE public.omni_comms_channel_setting
  ADD CONSTRAINT omni_comms_channel_setting_data_origin_chk
    CHECK (data_origin IN ('system_seed','user','reference_seed')),
  ADD CONSTRAINT omni_comms_channel_setting_op_state_chk
    CHECK (operational_state IN ('disabled','configuration','test_only','pilot_ready')),
  ADD CONSTRAINT omni_comms_channel_setting_retry_profile_chk
    CHECK (retry_profile IN ('none','conservative','standard')),
  ADD CONSTRAINT omni_comms_channel_setting_enabled_mirror_chk
    CHECK (enabled = (operational_state <> 'disabled')),
  ADD CONSTRAINT omni_comms_channel_setting_org_override_chk
    CHECK (department_id IS NOT NULL OR department_override_enabled),
  ADD CONSTRAINT omni_comms_channel_setting_per_day_chk
    CHECK (per_day_limit IS NULL OR (per_day_limit >= 1 AND per_day_limit <= 10000000)),
  ADD CONSTRAINT omni_comms_channel_setting_day_ge_minute_chk
    CHECK (per_day_limit IS NULL OR per_minute_limit IS NULL OR per_day_limit >= per_minute_limit),
  ADD CONSTRAINT omni_comms_channel_setting_recipients_chk
    CHECK (max_recipients_per_request IS NULL OR (max_recipients_per_request >= 1 AND max_recipients_per_request <= 100000)),
  ADD CONSTRAINT omni_comms_channel_setting_timeout_chk
    CHECK (request_timeout_seconds IS NULL OR (request_timeout_seconds >= 1 AND request_timeout_seconds <= 300)),
  ADD CONSTRAINT omni_comms_channel_setting_retention_chk
    CHECK (retention_days IS NULL OR (retention_days >= 1 AND retention_days <= 3650)),
  ADD CONSTRAINT omni_comms_channel_setting_currency_chk
    CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT omni_comms_channel_setting_daily_cost_chk
    CHECK (daily_cost_limit_minor IS NULL OR (daily_cost_limit_minor >= 0 AND daily_cost_limit_minor <= 1000000000000000)),
  ADD CONSTRAINT omni_comms_channel_setting_msg_cost_chk
    CHECK (per_message_cost_limit_minor IS NULL OR (per_message_cost_limit_minor >= 0 AND per_message_cost_limit_minor <= 1000000000000000)),
  ADD CONSTRAINT omni_comms_channel_setting_cost_currency_req_chk
    CHECK ((daily_cost_limit_minor IS NULL AND per_message_cost_limit_minor IS NULL) OR cost_currency IS NOT NULL),
  ADD CONSTRAINT omni_comms_channel_setting_cost_ceiling_chk
    CHECK (daily_cost_limit_minor IS NULL OR per_message_cost_limit_minor IS NULL
           OR per_message_cost_limit_minor <= daily_cost_limit_minor),
  ADD CONSTRAINT omni_comms_channel_setting_config_object_chk
    CHECK (jsonb_typeof(channel_policy_config) = 'object'),
  ADD CONSTRAINT omni_comms_channel_setting_config_size_chk
    CHECK (length(channel_policy_config::text) <= 4000),
  ADD CONSTRAINT omni_comms_channel_setting_no_live_chk
    CHECK (live_delivery_enabled = false);

-- ---------- 5. Partial unique indexes (genuine / reference coexistence) ----------
DROP INDEX IF EXISTS public.omni_comms_channel_setting_org_scope_uk;
DROP INDEX IF EXISTS public.omni_comms_channel_setting_dept_scope_uk;

CREATE UNIQUE INDEX omni_comms_channel_setting_org_genuine_uk
  ON public.omni_comms_channel_setting (organization_id, channel)
  WHERE department_id IS NULL AND data_origin <> 'reference_seed';
CREATE UNIQUE INDEX omni_comms_channel_setting_dept_genuine_uk
  ON public.omni_comms_channel_setting (organization_id, department_id, channel)
  WHERE department_id IS NOT NULL AND data_origin <> 'reference_seed';
CREATE UNIQUE INDEX omni_comms_channel_setting_org_reference_uk
  ON public.omni_comms_channel_setting (organization_id, channel)
  WHERE department_id IS NULL AND data_origin = 'reference_seed';
CREATE UNIQUE INDEX omni_comms_channel_setting_dept_reference_uk
  ON public.omni_comms_channel_setting (organization_id, department_id, channel)
  WHERE department_id IS NOT NULL AND data_origin = 'reference_seed';

-- ---------- 6. Fail-closed guard (live delivery + enabled mirror) ----------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_setting_guard()
RETURNS trigger
LANGUAGE plpgsql
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

  -- Live delivery is governed by future Release Control; never settable here.
  IF COALESCE(NEW.live_delivery_enabled,false) THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='live_delivery_governed_by_release_control';
  END IF;
  NEW.live_delivery_enabled := false;

  -- Organisation-scope policies always allow department overrides conceptually.
  IF NEW.department_id IS NULL THEN NEW.department_override_enabled := true; END IF;

  -- enabled is a compatibility mirror owned by the policy worker.
  NEW.enabled := (NEW.operational_state <> 'disabled');

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- ---------- 7. Bounded policy normaliser ----------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_normalize_channel_policy(
  p_channel text,
  p_common_policy jsonb,
  p_channel_policy_config jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_ch text; v_common jsonb; v_cfg jsonb; v_out jsonb := '{}'::jsonb;
  v_allowed text[]; v_key text; v_k text;
  v_state text; v_retry text; v_cur text;
  v_pm int; v_pd int; v_mr int; v_to int; v_rd int;
  v_dc bigint; v_mc bigint;
  v_qs text; v_qe text; v_tz text;
  v_arr text[]; v_e text; v_i int; v_mode text; v_codes text[];
BEGIN
  v_ch := btrim(coalesce(p_channel,''));
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel';
  END IF;
  v_common := coalesce(p_common_policy, '{}'::jsonb);
  v_cfg := coalesce(p_channel_policy_config, '{}'::jsonb);
  IF jsonb_typeof(v_common) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='common_policy_not_object'; END IF;
  IF jsonb_typeof(v_cfg) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_policy_config_not_object'; END IF;

  -- ---- common keys allowlist
  v_allowed := ARRAY['operational_state','department_override_enabled','per_minute_limit','per_day_limit',
    'max_recipients_per_request','quiet_hours_start','quiet_hours_end','quiet_hours_timezone',
    'retry_profile','request_timeout_seconds','retention_days','cost_currency',
    'daily_cost_limit_minor','per_message_cost_limit_minor'];
  FOR v_key IN SELECT jsonb_object_keys(v_common) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_common_field:'||v_key;
    END IF;
  END LOOP;

  v_state := coalesce(v_common->>'operational_state','disabled');
  IF v_state NOT IN ('disabled','configuration','test_only','pilot_ready') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_operational_state'; END IF;

  v_retry := coalesce(v_common->>'retry_profile','none');
  IF v_retry NOT IN ('none','conservative','standard') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_retry_profile'; END IF;

  IF v_common ? 'per_minute_limit' AND jsonb_typeof(v_common->'per_minute_limit') <> 'null' THEN
    IF jsonb_typeof(v_common->'per_minute_limit') <> 'number' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_minute_limit_not_integer'; END IF;
    v_pm := (v_common->>'per_minute_limit')::numeric::int;
    IF v_pm < 1 OR v_pm > 100000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_minute_limit_out_of_range'; END IF;
  END IF;
  IF v_common ? 'per_day_limit' AND jsonb_typeof(v_common->'per_day_limit') <> 'null' THEN
    IF jsonb_typeof(v_common->'per_day_limit') <> 'number' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_day_limit_not_integer'; END IF;
    v_pd := (v_common->>'per_day_limit')::numeric::int;
    IF v_pd < 1 OR v_pd > 10000000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_day_limit_out_of_range'; END IF;
  END IF;
  IF v_pd IS NOT NULL AND v_pm IS NOT NULL AND v_pd < v_pm THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_day_limit_below_per_minute_limit'; END IF;

  IF v_common ? 'max_recipients_per_request' AND jsonb_typeof(v_common->'max_recipients_per_request') <> 'null' THEN
    IF jsonb_typeof(v_common->'max_recipients_per_request') <> 'number' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_recipients_not_integer'; END IF;
    v_mr := (v_common->>'max_recipients_per_request')::numeric::int;
    IF v_mr < 1 OR v_mr > 100000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_recipients_out_of_range'; END IF;
  END IF;

  v_qs := nullif(btrim(coalesce(v_common->>'quiet_hours_start','')),'');
  v_qe := nullif(btrim(coalesce(v_common->>'quiet_hours_end','')),'');
  v_tz := nullif(btrim(coalesce(v_common->>'quiet_hours_timezone','')),'');
  IF (v_qs IS NULL) <> (v_qe IS NULL) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='quiet_hours_pair_required'; END IF;
  IF v_qs IS NOT NULL THEN
    IF v_qs !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR v_qe !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='quiet_hours_invalid_time'; END IF;
    IF v_qs = v_qe THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='quiet_hours_must_differ'; END IF;
    IF v_tz IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='quiet_hours_timezone_required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='quiet_hours_timezone_unknown'; END IF;
  ELSE
    v_tz := NULL;
  END IF;

  IF v_common ? 'request_timeout_seconds' AND jsonb_typeof(v_common->'request_timeout_seconds') <> 'null' THEN
    IF jsonb_typeof(v_common->'request_timeout_seconds') <> 'number' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='request_timeout_not_integer'; END IF;
    v_to := (v_common->>'request_timeout_seconds')::numeric::int;
    IF v_to < 1 OR v_to > 300 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='request_timeout_out_of_range'; END IF;
  END IF;
  IF v_common ? 'retention_days' AND jsonb_typeof(v_common->'retention_days') <> 'null' THEN
    IF jsonb_typeof(v_common->'retention_days') <> 'number' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='retention_days_not_integer'; END IF;
    v_rd := (v_common->>'retention_days')::numeric::int;
    IF v_rd < 1 OR v_rd > 3650 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='retention_days_out_of_range'; END IF;
  END IF;

  v_cur := nullif(btrim(upper(coalesce(v_common->>'cost_currency',''))),'');
  IF v_cur IS NOT NULL AND v_cur !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='cost_currency_invalid'; END IF;

  IF v_common ? 'daily_cost_limit_minor' AND jsonb_typeof(v_common->'daily_cost_limit_minor') <> 'null' THEN
    IF jsonb_typeof(v_common->'daily_cost_limit_minor') <> 'number' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='daily_cost_limit_not_integer'; END IF;
    v_dc := (v_common->>'daily_cost_limit_minor')::numeric::bigint;
    IF v_dc < 0 OR v_dc > 1000000000000000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='daily_cost_limit_out_of_range'; END IF;
  END IF;
  IF v_common ? 'per_message_cost_limit_minor' AND jsonb_typeof(v_common->'per_message_cost_limit_minor') <> 'null' THEN
    IF jsonb_typeof(v_common->'per_message_cost_limit_minor') <> 'number' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_message_cost_limit_not_integer'; END IF;
    v_mc := (v_common->>'per_message_cost_limit_minor')::numeric::bigint;
    IF v_mc < 0 OR v_mc > 1000000000000000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_message_cost_limit_out_of_range'; END IF;
  END IF;
  IF (v_dc IS NOT NULL OR v_mc IS NOT NULL) AND v_cur IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='cost_currency_required'; END IF;
  IF v_dc IS NOT NULL AND v_mc IS NOT NULL AND v_mc > v_dc THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='per_message_cost_exceeds_daily'; END IF;

  -- ---- channel-specific configuration
  DECLARE v_norm jsonb := '{}'::jsonb;
  BEGIN
    IF v_ch = 'email' THEN
      v_allowed := ARRAY['max_attachment_bytes','allowed_attachment_extensions'];
    ELSIF v_ch = 'sms' THEN
      v_allowed := ARRAY['country_mode','country_codes','max_segments','unicode_allowed'];
    ELSIF v_ch = 'whatsapp' THEN
      v_allowed := ARRAY['country_mode','country_codes','max_media_bytes','inbound_enabled'];
    ELSIF v_ch = 'push' THEN
      v_allowed := ARRAY['max_ttl_seconds','max_data_payload_bytes'];
    ELSIF v_ch = 'in_app' THEN
      v_allowed := ARRAY['expiry_hours','acknowledgement_mode','max_visible_per_user'];
    ELSE
      v_allowed := ARRAY['max_document_bytes','batch_size_limit','archive_retention_days'];
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_cfg) LOOP
      IF NOT (v_key = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_channel_policy_key:'||v_key;
      END IF;
    END LOOP;

    -- integer helper inline per key
    FOR v_key IN SELECT unnest(v_allowed) LOOP
      IF v_cfg ? v_key AND jsonb_typeof(v_cfg->v_key) = 'null' THEN
        v_cfg := v_cfg - v_key;
      END IF;
    END LOOP;

    IF v_ch = 'email' THEN
      IF v_cfg ? 'max_attachment_bytes' THEN
        IF jsonb_typeof(v_cfg->'max_attachment_bytes') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_attachment_bytes_not_integer'; END IF;
        v_i := (v_cfg->>'max_attachment_bytes')::numeric::int;
        IF v_i < 0 OR v_i > 26214400 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_attachment_bytes_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('max_attachment_bytes', v_i);
      END IF;
      IF v_cfg ? 'allowed_attachment_extensions' THEN
        IF jsonb_typeof(v_cfg->'allowed_attachment_extensions') <> 'array' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='allowed_attachment_extensions_not_array'; END IF;
        SELECT array_agg(DISTINCT lower(btrim(ltrim(x,'.'))) ORDER BY lower(btrim(ltrim(x,'.'))))
          INTO v_arr
          FROM jsonb_array_elements_text(v_cfg->'allowed_attachment_extensions') AS t(x);
        v_arr := coalesce(v_arr, ARRAY[]::text[]);
        IF array_length(v_arr,1) > 20 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='allowed_attachment_extensions_too_many'; END IF;
        FOREACH v_e IN ARRAY v_arr LOOP
          IF v_e !~ '^[a-z0-9]{1,10}$' THEN
            RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='allowed_attachment_extension_invalid:'||v_e; END IF;
        END LOOP;
        v_norm := v_norm || jsonb_build_object('allowed_attachment_extensions', to_jsonb(v_arr));
      END IF;

    ELSIF v_ch IN ('sms','whatsapp') THEN
      v_mode := coalesce(v_cfg->>'country_mode','unrestricted');
      IF v_mode NOT IN ('unrestricted','allowlist','denylist') THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_country_mode'; END IF;
      IF v_cfg ? 'country_codes' THEN
        IF jsonb_typeof(v_cfg->'country_codes') <> 'array' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='country_codes_not_array'; END IF;
        SELECT array_agg(DISTINCT upper(btrim(x)) ORDER BY upper(btrim(x))) INTO v_codes
          FROM jsonb_array_elements_text(v_cfg->'country_codes') AS t(x);
      END IF;
      v_codes := coalesce(v_codes, ARRAY[]::text[]);
      IF coalesce(array_length(v_codes,1),0) > 50 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='country_codes_too_many'; END IF;
      FOREACH v_e IN ARRAY v_codes LOOP
        IF v_e !~ '^[A-Z]{2}$' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_country_code:'||v_e; END IF;
      END LOOP;
      IF v_mode = 'unrestricted' AND coalesce(array_length(v_codes,1),0) > 0 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unrestricted_requires_empty_country_codes'; END IF;
      IF v_mode <> 'unrestricted' AND coalesce(array_length(v_codes,1),0) = 0 THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='country_codes_required'; END IF;
      v_norm := v_norm || jsonb_build_object('country_mode', v_mode, 'country_codes', to_jsonb(v_codes));

      IF v_ch = 'sms' THEN
        IF v_cfg ? 'max_segments' THEN
          IF jsonb_typeof(v_cfg->'max_segments') <> 'number' THEN
            RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_segments_not_integer'; END IF;
          v_i := (v_cfg->>'max_segments')::numeric::int;
          IF v_i < 1 OR v_i > 10 THEN
            RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_segments_out_of_range'; END IF;
          v_norm := v_norm || jsonb_build_object('max_segments', v_i);
        END IF;
        IF v_cfg ? 'unicode_allowed' THEN
          IF jsonb_typeof(v_cfg->'unicode_allowed') <> 'boolean' THEN
            RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unicode_allowed_not_boolean'; END IF;
          v_norm := v_norm || jsonb_build_object('unicode_allowed', (v_cfg->>'unicode_allowed')::boolean);
        END IF;
      ELSE
        IF v_cfg ? 'max_media_bytes' THEN
          IF jsonb_typeof(v_cfg->'max_media_bytes') <> 'number' THEN
            RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_media_bytes_not_integer'; END IF;
          v_i := (v_cfg->>'max_media_bytes')::numeric::int;
          IF v_i < 0 OR v_i > 16777216 THEN
            RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_media_bytes_out_of_range'; END IF;
          v_norm := v_norm || jsonb_build_object('max_media_bytes', v_i);
        END IF;
        IF v_cfg ? 'inbound_enabled' THEN
          IF jsonb_typeof(v_cfg->'inbound_enabled') <> 'boolean' THEN
            RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='inbound_enabled_not_boolean'; END IF;
          v_norm := v_norm || jsonb_build_object('inbound_enabled', (v_cfg->>'inbound_enabled')::boolean);
        END IF;
      END IF;

    ELSIF v_ch = 'push' THEN
      IF v_cfg ? 'max_ttl_seconds' THEN
        IF jsonb_typeof(v_cfg->'max_ttl_seconds') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_ttl_seconds_not_integer'; END IF;
        v_i := (v_cfg->>'max_ttl_seconds')::numeric::int;
        IF v_i < 0 OR v_i > 2419200 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_ttl_seconds_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('max_ttl_seconds', v_i);
      END IF;
      IF v_cfg ? 'max_data_payload_bytes' THEN
        IF jsonb_typeof(v_cfg->'max_data_payload_bytes') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_data_payload_bytes_not_integer'; END IF;
        v_i := (v_cfg->>'max_data_payload_bytes')::numeric::int;
        IF v_i < 0 OR v_i > 4096 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_data_payload_bytes_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('max_data_payload_bytes', v_i);
      END IF;

    ELSIF v_ch = 'in_app' THEN
      IF v_cfg ? 'expiry_hours' THEN
        IF jsonb_typeof(v_cfg->'expiry_hours') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='expiry_hours_not_integer'; END IF;
        v_i := (v_cfg->>'expiry_hours')::numeric::int;
        IF v_i < 1 OR v_i > 8760 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='expiry_hours_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('expiry_hours', v_i);
      END IF;
      IF v_cfg ? 'acknowledgement_mode' THEN
        IF (v_cfg->>'acknowledgement_mode') NOT IN ('none','read','explicit') THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_acknowledgement_mode'; END IF;
        v_norm := v_norm || jsonb_build_object('acknowledgement_mode', v_cfg->>'acknowledgement_mode');
      END IF;
      IF v_cfg ? 'max_visible_per_user' THEN
        IF jsonb_typeof(v_cfg->'max_visible_per_user') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_visible_per_user_not_integer'; END IF;
        v_i := (v_cfg->>'max_visible_per_user')::numeric::int;
        IF v_i < 1 OR v_i > 500 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_visible_per_user_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('max_visible_per_user', v_i);
      END IF;

    ELSE -- print
      IF v_cfg ? 'max_document_bytes' THEN
        IF jsonb_typeof(v_cfg->'max_document_bytes') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_document_bytes_not_integer'; END IF;
        v_i := (v_cfg->>'max_document_bytes')::numeric::int;
        IF v_i < 1 OR v_i > 52428800 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_document_bytes_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('max_document_bytes', v_i);
      END IF;
      IF v_cfg ? 'batch_size_limit' THEN
        IF jsonb_typeof(v_cfg->'batch_size_limit') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='batch_size_limit_not_integer'; END IF;
        v_i := (v_cfg->>'batch_size_limit')::numeric::int;
        IF v_i < 1 OR v_i > 10000 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='batch_size_limit_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('batch_size_limit', v_i);
      END IF;
      IF v_cfg ? 'archive_retention_days' THEN
        IF jsonb_typeof(v_cfg->'archive_retention_days') <> 'number' THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='archive_retention_days_not_integer'; END IF;
        v_i := (v_cfg->>'archive_retention_days')::numeric::int;
        IF v_i < 1 OR v_i > 3650 THEN
          RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='archive_retention_days_out_of_range'; END IF;
        v_norm := v_norm || jsonb_build_object('archive_retention_days', v_i);
      END IF;
    END IF;

    IF length(v_norm::text) > 4000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_policy_config_too_large'; END IF;

    v_out := jsonb_build_object(
      'channel', v_ch,
      'common', jsonb_build_object(
        'operational_state', v_state,
        'department_override_enabled', coalesce((v_common->>'department_override_enabled')::boolean, true),
        'per_minute_limit', to_jsonb(v_pm),
        'per_day_limit', to_jsonb(v_pd),
        'max_recipients_per_request', to_jsonb(v_mr),
        'quiet_hours_start', to_jsonb(v_qs),
        'quiet_hours_end', to_jsonb(v_qe),
        'quiet_hours_timezone', to_jsonb(v_tz),
        'retry_profile', v_retry,
        'request_timeout_seconds', to_jsonb(v_to),
        'retention_days', to_jsonb(v_rd),
        'cost_currency', to_jsonb(v_cur),
        'daily_cost_limit_minor', to_jsonb(v_dc),
        'per_message_cost_limit_minor', to_jsonb(v_mc)
      ),
      'channel_policy_config', v_norm
    );
  END;
  RETURN v_out;
END;
$function$;

-- ---------- 8. Policy projection helper ----------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_policy_json(p_row public.omni_comms_channel_setting)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog','public'
AS $function$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'organization_id', p_row.organization_id,
    'department_id', p_row.department_id,
    'department_name', (SELECT d.name FROM public.core_department d WHERE d.id = p_row.department_id),
    'channel', p_row.channel,
    'operational_state', p_row.operational_state,
    'department_override_enabled', p_row.department_override_enabled,
    'enabled', p_row.enabled,
    'live_delivery_enabled', p_row.live_delivery_enabled,
    'per_minute_limit', p_row.per_minute_limit,
    'per_day_limit', p_row.per_day_limit,
    'max_recipients_per_request', p_row.max_recipients_per_request,
    'quiet_hours_start', to_char(p_row.quiet_hours_start,'HH24:MI'),
    'quiet_hours_end', to_char(p_row.quiet_hours_end,'HH24:MI'),
    'quiet_hours_timezone', p_row.quiet_hours_timezone,
    'retry_profile', p_row.retry_profile,
    'request_timeout_seconds', p_row.request_timeout_seconds,
    'retention_days', p_row.retention_days,
    'cost_currency', p_row.cost_currency,
    'daily_cost_limit_minor', p_row.daily_cost_limit_minor,
    'per_message_cost_limit_minor', p_row.per_message_cost_limit_minor,
    'channel_policy_config', p_row.channel_policy_config,
    'data_origin', p_row.data_origin,
    'created_at', p_row.created_at,
    'created_by', p_row.created_by,
    'updated_at', p_row.updated_at,
    'updated_by', p_row.updated_by
  );
$function$;

-- ---------- 9. Summary RPC ----------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_policy_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_include_reference boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_uid uuid; v_ch text; v_can_configure boolean; v_allow_ref boolean;
  v_org public.omni_comms_channel_setting%ROWTYPE;
  v_dept public.omni_comms_channel_setting%ROWTYPE;
  v_org_found boolean := false; v_dept_found boolean := false;
  v_eff jsonb := 'null'::jsonb; v_src text := 'none';
  v_ref jsonb := '[]'::jsonb; v_ref_count integer := 0;
  v_dept_name text; v_override_count integer := 0;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_ch := btrim(coalesce(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  IF p_department_id IS NOT NULL
     AND NOT public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_organization_mismatch'; END IF;

  v_can_configure := public.has_permission(v_uid,'omni_comms','configure');
  v_allow_ref := COALESCE(p_include_reference,false) AND v_can_configure;

  SELECT * INTO v_org FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND department_id IS NULL
     AND channel = v_ch AND data_origin <> 'reference_seed';
  v_org_found := FOUND;

  IF p_department_id IS NOT NULL THEN
    SELECT * INTO v_dept FROM public.omni_comms_channel_setting
     WHERE organization_id = p_organization_id AND department_id = p_department_id
       AND channel = v_ch AND data_origin <> 'reference_seed';
    v_dept_found := FOUND;
    SELECT name INTO v_dept_name FROM public.core_department WHERE id = p_department_id;
  END IF;

  SELECT count(*) INTO v_override_count FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND department_id IS NOT NULL
     AND channel = v_ch AND data_origin <> 'reference_seed';

  IF v_dept_found AND v_dept.department_override_enabled THEN
    v_eff := public.omni_comms_priv_channel_policy_json(v_dept); v_src := 'department_override';
  ELSIF v_org_found THEN
    v_eff := public.omni_comms_priv_channel_policy_json(v_org); v_src := 'organisation_baseline';
  ELSE
    v_eff := 'null'::jsonb; v_src := 'none';
  END IF;

  SELECT count(*) INTO v_ref_count FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND channel = v_ch
     AND data_origin = 'reference_seed'
     AND (p_department_id IS NULL OR department_id IS NULL OR department_id = p_department_id);

  IF v_allow_ref THEN
    SELECT COALESCE(jsonb_agg(public.omni_comms_priv_channel_policy_json(s) ORDER BY s.created_at),'[]'::jsonb)
      INTO v_ref
      FROM public.omni_comms_channel_setting s
     WHERE s.organization_id = p_organization_id AND s.channel = v_ch
       AND s.data_origin = 'reference_seed'
       AND (p_department_id IS NULL OR s.department_id IS NULL OR s.department_id = p_department_id);
    v_ref_count := 0;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'department_name', v_dept_name,
    'channel', v_ch,
    'organization_policy', CASE WHEN v_org_found THEN public.omni_comms_priv_channel_policy_json(v_org) ELSE 'null'::jsonb END,
    'department_policy', CASE WHEN v_dept_found THEN public.omni_comms_priv_channel_policy_json(v_dept) ELSE 'null'::jsonb END,
    'effective_policy', v_eff,
    'effective_source', v_src,
    'department_override_count', v_override_count,
    'reference_policies', v_ref,
    'hidden_reference_count', v_ref_count,
    'can_configure', v_can_configure,
    'generated_at', now()
  );
END;
$function$;

-- ---------- 10. Private mutation worker ----------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_policy_upsert(
  p_actor_id uuid,
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_common_policy jsonb,
  p_channel_policy_config jsonb,
  p_correlation_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_norm jsonb; v_c jsonb; v_cfg jsonb;
  v_before public.omni_comms_channel_setting%ROWTYPE;
  v_after  public.omni_comms_channel_setting%ROWTYPE;
  v_override boolean; v_action text;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, p_department_id);
  IF p_department_id IS NOT NULL
     AND NOT public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_organization_mismatch'; END IF;

  v_norm := public.omni_comms_priv_normalize_channel_policy(p_channel, p_common_policy, p_channel_policy_config);
  v_c := v_norm->'common';
  v_cfg := v_norm->'channel_policy_config';
  v_override := CASE WHEN p_department_id IS NULL THEN true
                     ELSE COALESCE((v_c->>'department_override_enabled')::boolean, true) END;

  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public.omni_comms_channel_setting(
        organization_id, department_id, channel, enabled, live_delivery_enabled,
        operational_state, department_override_enabled, data_origin,
        per_minute_limit, per_day_limit, max_recipients_per_request,
        quiet_hours_start, quiet_hours_end, quiet_hours_timezone,
        retry_profile, request_timeout_seconds, retention_days,
        cost_currency, daily_cost_limit_minor, per_message_cost_limit_minor,
        channel_policy_config, created_by, updated_by)
      VALUES(
        p_organization_id, p_department_id, v_norm->>'channel',
        (v_c->>'operational_state') <> 'disabled', false,
        v_c->>'operational_state', v_override, 'user',
        (v_c->>'per_minute_limit')::int, (v_c->>'per_day_limit')::int,
        (v_c->>'max_recipients_per_request')::int,
        (v_c->>'quiet_hours_start')::time, (v_c->>'quiet_hours_end')::time,
        v_c->>'quiet_hours_timezone',
        v_c->>'retry_profile', (v_c->>'request_timeout_seconds')::int,
        (v_c->>'retention_days')::int, v_c->>'cost_currency',
        (v_c->>'daily_cost_limit_minor')::bigint,
        (v_c->>'per_message_cost_limit_minor')::bigint,
        v_cfg, p_actor_id, p_actor_id)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 duplicate_channel_policy' USING ERRCODE='P0001', DETAIL='genuine_policy_scope_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    END;
    PERFORM public.omni_comms_priv_write_channel_audit(
      p_actor_id,
      CASE WHEN p_department_id IS NULL THEN 'create_organisation_policy' ELSE 'create_department_override' END,
      'channel_setting', v_after.id, v_after.channel, NULL, to_jsonb(v_after), p_correlation_id);
    RETURN v_after.id;
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_channel_setting WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='channel_policy'; END IF;
  IF v_before.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='reference_policy_read_only'; END IF;
  IF v_before.organization_id <> p_organization_id
     OR v_before.department_id IS DISTINCT FROM p_department_id
     OR v_before.channel <> (v_norm->>'channel') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='policy_scope_immutable'; END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='expected_updated_at_required'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;

  BEGIN
    UPDATE public.omni_comms_channel_setting
       SET operational_state = v_c->>'operational_state',
           enabled = (v_c->>'operational_state') <> 'disabled',
           live_delivery_enabled = false,
           department_override_enabled = v_override,
           per_minute_limit = (v_c->>'per_minute_limit')::int,
           per_day_limit = (v_c->>'per_day_limit')::int,
           max_recipients_per_request = (v_c->>'max_recipients_per_request')::int,
           quiet_hours_start = (v_c->>'quiet_hours_start')::time,
           quiet_hours_end = (v_c->>'quiet_hours_end')::time,
           quiet_hours_timezone = v_c->>'quiet_hours_timezone',
           retry_profile = v_c->>'retry_profile',
           request_timeout_seconds = (v_c->>'request_timeout_seconds')::int,
           retention_days = (v_c->>'retention_days')::int,
           cost_currency = v_c->>'cost_currency',
           daily_cost_limit_minor = (v_c->>'daily_cost_limit_minor')::bigint,
           per_message_cost_limit_minor = (v_c->>'per_message_cost_limit_minor')::bigint,
           channel_policy_config = v_cfg,
           updated_by = p_actor_id, updated_at = now()
     WHERE id = p_id RETURNING * INTO v_after;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;

  v_action := CASE
    WHEN p_department_id IS NULL THEN 'update_organisation_policy'
    WHEN v_before.department_override_enabled AND NOT v_after.department_override_enabled THEN 'disable_department_override'
    WHEN NOT v_before.department_override_enabled AND v_after.department_override_enabled THEN 'enable_department_override'
    ELSE 'update_department_override' END;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id, v_action, 'channel_setting', p_id, v_after.channel,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END;
$function$;

-- ---------- 11. Public mutation RPC ----------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_policy_upsert(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_common_policy jsonb,
  p_channel_policy_config jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_policy_upsert(
    v_uid, p_id, p_expected_updated_at, p_organization_id, p_department_id,
    p_channel, p_common_policy, p_channel_policy_config, p_correlation_id);
END;
$function$;

-- ---------- 12. Legacy Email wrapper ----------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_setting_upsert(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_department_id uuid, p_channel text, p_enabled boolean,
  p_live_delivery_enabled boolean, p_quiet_hours_start time,
  p_quiet_hours_end time, p_quiet_hours_timezone text,
  p_per_minute_limit integer, p_correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_uid uuid; v_common jsonb; v_existing public.omni_comms_channel_setting%ROWTYPE;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_channel IS NULL OR p_channel <> 'email' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='email_channel_only_in_build2'; END IF;
  IF COALESCE(p_live_delivery_enabled,false) THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE='P0001', DETAIL='live_delivery_governed_by_release_control'; END IF;

  v_common := jsonb_build_object(
    'operational_state', CASE WHEN COALESCE(p_enabled,false) THEN 'configuration' ELSE 'disabled' END,
    'department_override_enabled', true,
    'per_minute_limit', to_jsonb(p_per_minute_limit),
    'quiet_hours_start', to_jsonb(to_char(p_quiet_hours_start,'HH24:MI')),
    'quiet_hours_end', to_jsonb(to_char(p_quiet_hours_end,'HH24:MI')),
    'quiet_hours_timezone', to_jsonb(p_quiet_hours_timezone)
  );

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.omni_comms_channel_setting WHERE id = p_id;
    IF FOUND THEN
      v_common := v_common
        || jsonb_build_object(
             'per_day_limit', to_jsonb(v_existing.per_day_limit),
             'max_recipients_per_request', to_jsonb(v_existing.max_recipients_per_request),
             'retry_profile', v_existing.retry_profile,
             'request_timeout_seconds', to_jsonb(v_existing.request_timeout_seconds),
             'retention_days', to_jsonb(v_existing.retention_days),
             'cost_currency', to_jsonb(v_existing.cost_currency),
             'daily_cost_limit_minor', to_jsonb(v_existing.daily_cost_limit_minor),
             'per_message_cost_limit_minor', to_jsonb(v_existing.per_message_cost_limit_minor),
             'department_override_enabled', to_jsonb(v_existing.department_override_enabled));
      RETURN public.omni_comms_priv_channel_policy_upsert(
        v_uid, p_id, p_expected_updated_at, p_organization_id, p_department_id,
        'email', v_common, v_existing.channel_policy_config, p_correlation_id);
    END IF;
  END IF;

  RETURN public.omni_comms_priv_channel_policy_upsert(
    v_uid, p_id, p_expected_updated_at, p_organization_id, p_department_id,
    'email', v_common, '{}'::jsonb, p_correlation_id);
END;
$function$;

-- ---------- 13. Grants ----------
REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_channel_policy(text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_policy_upsert(uuid,uuid,timestamptz,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_policy_json(public.omni_comms_channel_setting) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_normalize_channel_policy(text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_policy_upsert(uuid,uuid,timestamptz,uuid,uuid,text,jsonb,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_policy_json(public.omni_comms_channel_setting) TO service_role;

REVOKE ALL ON FUNCTION public.omni_comms_channel_policy_summary(uuid,uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_channel_policy_upsert(uuid,timestamptz,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_policy_summary(uuid,uuid,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_policy_upsert(uuid,timestamptz,uuid,uuid,text,jsonb,jsonb,text) TO authenticated, service_role;