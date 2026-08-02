-- ═══════════════════════════════════════════════════════════════════
-- Omni-Comms Channels C2 CLOSURE
--  1. reference_seed provider accounts are read-only + non-operational
--  2. legacy omni_comms_provider_account.secret_ref = Resend-only mirror
--  3. disabled -> active reactivation
--  4. reference read boundary requires omni_comms.configure
-- No sending, dispatch, template, event or Legacy Hub object is touched.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. legacy compatibility column becomes nullable ───────────────
ALTER TABLE public.omni_comms_provider_account
  ALTER COLUMN secret_ref DROP NOT NULL;

ALTER TABLE public.omni_comms_provider_account
  DROP CONSTRAINT IF EXISTS omni_comms_provider_account_secret_ref_chk;

ALTER TABLE public.omni_comms_provider_account
  ADD CONSTRAINT omni_comms_provider_account_secret_ref_chk
  CHECK (secret_ref IS NULL
         OR (secret_ref ~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$'
             AND char_length(secret_ref) BETWEEN 16 AND 96));

-- ─── 2. compatibility synchroniser (Resend email only) ─────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_sync_legacy_secret_ref(p_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_ref text; v_is_resend boolean;
BEGIN
  SELECT (p.adapter_key = 'resend' AND p.channel = 'email')
    INTO v_is_resend
    FROM public.omni_comms_provider_account a
    JOIN public.omni_comms_provider p ON p.id = a.provider_id
   WHERE a.id = p_account_id;

  IF NOT COALESCE(v_is_resend, false) THEN
    UPDATE public.omni_comms_provider_account
       SET secret_ref = NULL
     WHERE id = p_account_id AND secret_ref IS NOT NULL;
    RETURN;
  END IF;

  SELECT s.secret_ref INTO v_ref
    FROM public.omni_comms_provider_account_secret_ref s
   WHERE s.provider_account_id = p_account_id
     AND s.purpose = 'api_key'
     AND public.omni_comms_priv_is_secret_ref_name(s.secret_ref);

  UPDATE public.omni_comms_provider_account
     SET secret_ref = v_ref
   WHERE id = p_account_id AND secret_ref IS DISTINCT FROM v_ref;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_sync_legacy_secret_ref(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_sync_legacy_secret_ref(uuid) TO service_role;

-- ─── 3. safe backfill of existing rows ─────────────────────────────
-- Resend accounts: (re)mirror the validated api_key child reference.
UPDATE public.omni_comms_provider_account a
   SET secret_ref = s.secret_ref
  FROM public.omni_comms_provider p,
       public.omni_comms_provider_account_secret_ref s
 WHERE p.id = a.provider_id
   AND p.adapter_key = 'resend' AND p.channel = 'email'
   AND s.provider_account_id = a.id AND s.purpose = 'api_key'
   AND a.secret_ref IS DISTINCT FROM s.secret_ref;

-- Non-Resend accounts: clear the legacy column once child refs are confirmed.
UPDATE public.omni_comms_provider_account a
   SET secret_ref = NULL
 WHERE a.secret_ref IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.omni_comms_provider p
                WHERE p.id = a.provider_id
                  AND NOT (p.adapter_key = 'resend' AND p.channel = 'email'))
   AND NOT EXISTS (
     SELECT 1 FROM public.omni_comms_provider_credential_requirement r
      WHERE r.provider_id = a.provider_id AND r.required
        AND NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                         WHERE s.provider_account_id = a.id AND s.purpose = r.purpose));

-- Resend accounts with no valid api_key child row: clear the mirror.
UPDATE public.omni_comms_provider_account a
   SET secret_ref = NULL
 WHERE a.secret_ref IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.omni_comms_provider p
                WHERE p.id = a.provider_id
                  AND p.adapter_key = 'resend' AND p.channel = 'email')
   AND NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                    WHERE s.provider_account_id = a.id AND s.purpose = 'api_key'
                      AND public.omni_comms_priv_is_secret_ref_name(s.secret_ref));

-- ─── 4. upsert worker: reference accounts read-only, NULL legacy ───
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_account_upsert(
  p_actor_id uuid,
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_channel text,
  p_provider_id uuid,
  p_code text,
  p_display_name text,
  p_environment text,
  p_region text,
  p_account_reference text,
  p_secret_refs jsonb,
  p_allow_reference_provider boolean,
  p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_prov public.omni_comms_provider%ROWTYPE;
        v_before public.omni_comms_provider_account%ROWTYPE;
        v_after  public.omni_comms_provider_account%ROWTYPE;
        v_region text; v_ref text; v_env text; v_sandbox boolean;
        v_id uuid; v_refs_changed boolean; v_reset boolean;
BEGIN
  v_env := btrim(COALESCE(p_environment,''));
  IF v_env NOT IN ('sandbox','staging','production') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_environment'; END IF;
  v_sandbox := (v_env <> 'production');
  v_region := NULLIF(btrim(COALESCE(p_region,'')),'');
  v_ref    := NULLIF(btrim(COALESCE(p_account_reference,'')),'');

  SELECT * INTO v_prov FROM public.omni_comms_provider WHERE id=p_provider_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider'; END IF;
  IF v_prov.status <> 'active' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='provider_not_active'; END IF;
  IF v_prov.channel IS DISTINCT FROM btrim(COALESCE(p_channel,'')) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_channel_mismatch'; END IF;
  IF v_prov.data_origin='reference_seed' AND NOT COALESCE(p_allow_reference_provider,false) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_provider_not_selectable'; END IF;

  IF p_id IS NULL THEN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, NULL);
    BEGIN
      INSERT INTO public.omni_comms_provider_account(
        organization_id, provider_id, code, display_name, secret_ref, region,
        sandbox_mode, environment, provider_account_reference, data_origin,
        status, created_by, updated_by,
        verification_status, verification_result_code, verification_detail, verification_checked_at)
      VALUES(p_organization_id, p_provider_id, btrim(p_code), btrim(p_display_name),
        -- canonical credential model is the child reference table; the legacy
        -- column is populated only by the Resend compatibility synchroniser.
        NULL,
        v_region, v_sandbox, v_env, v_ref, 'user',
        'draft', p_actor_id, p_actor_id, 'unverified', NULL, NULL, NULL)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='account_code_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
    END;
    v_id := v_after.id;
    PERFORM public.omni_comms_priv_apply_account_secret_refs(p_actor_id, v_id, p_provider_id, p_secret_refs);
    PERFORM public.omni_comms_priv_sync_legacy_secret_ref(v_id);
    SELECT * INTO v_after FROM public.omni_comms_provider_account WHERE id=v_id;
    PERFORM public.omni_comms_priv_write_channel_audit(
      p_actor_id,'create','provider_account',v_id,v_after.code,NULL,to_jsonb(v_after),p_correlation_id);
    RETURN v_id;
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_provider_account WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_account'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, v_before.organization_id, NULL);
  IF v_before.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='reference_account_read_only'; END IF;
  IF p_organization_id IS NOT NULL AND v_before.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='organization_mismatch'; END IF;
  IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft'; END IF;

  v_refs_changed := public.omni_comms_priv_apply_account_secret_refs(
    p_actor_id, p_id, p_provider_id, p_secret_refs);

  v_reset := v_refs_changed
          OR (v_before.provider_id  IS DISTINCT FROM p_provider_id)
          OR (v_before.environment  IS DISTINCT FROM v_env)
          OR (v_before.sandbox_mode IS DISTINCT FROM v_sandbox)
          OR (v_before.region       IS DISTINCT FROM v_region)
          OR (v_before.provider_account_reference IS DISTINCT FROM v_ref);

  BEGIN
    UPDATE public.omni_comms_provider_account
       SET code=btrim(p_code), display_name=btrim(p_display_name),
           provider_id=p_provider_id, region=v_region,
           sandbox_mode=v_sandbox, environment=v_env,
           provider_account_reference=v_ref,
           updated_by=p_actor_id, updated_at=now(),
           health_state             = CASE WHEN v_reset THEN 'unknown'    ELSE health_state END,
           health_checked_at        = CASE WHEN v_reset THEN NULL         ELSE health_checked_at END,
           verification_status      = CASE WHEN v_reset THEN 'unverified' ELSE verification_status END,
           verification_result_code = CASE WHEN v_reset THEN NULL         ELSE verification_result_code END,
           verification_detail      = CASE WHEN v_reset THEN NULL         ELSE verification_detail END,
           verification_checked_at  = CASE WHEN v_reset THEN NULL         ELSE verification_checked_at END
     WHERE id=p_id RETURNING * INTO v_after;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='account_code_exists';
    WHEN check_violation THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
  END;

  -- recalculated after any provider change: Resend mirrors api_key, others NULL
  PERFORM public.omni_comms_priv_sync_legacy_secret_ref(p_id);
  SELECT * INTO v_after FROM public.omni_comms_provider_account WHERE id=p_id;
  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,'update_draft','provider_account',p_id,v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_account_upsert(uuid,uuid,timestamptz,uuid,text,uuid,text,text,text,text,text,jsonb,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_account_upsert(uuid,uuid,timestamptz,uuid,text,uuid,text,text,text,text,text,jsonb,boolean,text) TO service_role;

-- ─── 5. lifecycle worker: reference rejection + reactivation ───────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_account_lifecycle(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_action text, p_reason text, p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_before public.omni_comms_provider_account%ROWTYPE;
        v_after  public.omni_comms_provider_account%ROWTYPE;
        v_prov public.omni_comms_provider%ROWTYPE; v_action text; v_reason text;
BEGIN
  v_action := btrim(COALESCE(p_action,''));
  IF v_action NOT IN ('activate','disable','retire') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_lifecycle_action'; END IF;

  SELECT * INTO v_before FROM public.omni_comms_provider_account WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_account'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, v_before.organization_id, NULL);
  IF v_before.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='reference_account_non_operational'; END IF;
  IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='retired_is_terminal'; END IF;

  SELECT * INTO v_prov FROM public.omni_comms_provider WHERE id=v_before.provider_id;

  IF v_action='activate' THEN
    IF v_before.status NOT IN ('draft','disabled') THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft_or_disabled'; END IF;
    IF v_prov.status <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='provider_not_active'; END IF;
    IF EXISTS (SELECT 1 FROM public.omni_comms_provider_credential_requirement r
                WHERE r.provider_id=v_before.provider_id AND r.required
                  AND NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                                   WHERE s.provider_account_id=v_before.id AND s.purpose=r.purpose)) THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='missing_required_credential'; END IF;
    IF v_prov.adapter_key='resend' AND v_before.verification_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='provider_verification_required'; END IF;
    -- verification state is preserved on reactivation
    UPDATE public.omni_comms_provider_account
       SET status='active', activated_at=now(), activated_by=p_actor_id,
           updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSIF v_action='disable' THEN
    IF v_before.status <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_active'; END IF;
    UPDATE public.omni_comms_provider_account
       SET status='disabled', updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSE
    v_reason := NULLIF(btrim(COALESCE(p_reason,'')),'');
    IF v_reason IS NULL OR char_length(v_reason) > 2000 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='retirement_reason_required'; END IF;
    UPDATE public.omni_comms_provider_account
       SET status='retired', retired_at=now(), retired_by=p_actor_id,
           retirement_reason=v_reason, updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id, v_action, 'provider_account', p_id, v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_account_lifecycle(uuid,uuid,timestamptz,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_account_lifecycle(uuid,uuid,timestamptz,text,text,text) TO service_role;

-- ─── 6. reference-read boundary requires omni_comms.configure ──────
CREATE OR REPLACE FUNCTION public.omni_comms_channel_provider_account_summary(
  p_organization_id uuid, p_channel text, p_include_reference boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_channel text; v_providers jsonb; v_reqs jsonb;
        v_accounts jsonb; v_ref_accounts jsonb; v_include boolean;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_channel := btrim(COALESCE(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_channel NOT IN ('email','sms','whatsapp','push','in_app','webhook','print','voice') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  -- reference rows are visible only to a configure-capable actor
  v_include := COALESCE(p_include_reference,false)
               AND public.has_permission(v_uid,'omni_comms','configure');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',p.id,'code',p.code,'display_name',p.display_name,'channel',p.channel,
           'adapter_key',p.adapter_key,'status',p.status,'data_origin',p.data_origin,
           'updated_at',p.updated_at) ORDER BY p.code),'[]'::jsonb)
    INTO v_providers
    FROM public.omni_comms_provider p
   WHERE p.channel=v_channel AND p.status='active'
     AND (p.data_origin <> 'reference_seed' OR v_include);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',r.id,'provider_id',r.provider_id,'purpose',r.purpose,
           'display_name',r.display_name,'description',r.description,
           'required',r.required,'secret_ref_pattern',r.secret_ref_pattern,
           'sort_order',r.sort_order) ORDER BY r.sort_order, r.purpose),'[]'::jsonb)
    INTO v_reqs
    FROM public.omni_comms_provider_credential_requirement r
    JOIN public.omni_comms_provider p ON p.id=r.provider_id
   WHERE p.channel=v_channel AND p.status='active';

  WITH acct AS (
    SELECT a.*, p.adapter_key, p.channel AS provider_channel
      FROM public.omni_comms_provider_account a
      JOIN public.omni_comms_provider p ON p.id=a.provider_id
     WHERE a.organization_id=p_organization_id AND p.channel=v_channel
  ), shaped AS (
    SELECT a.data_origin AS origin, jsonb_build_object(
      'id',a.id,'code',a.code,'display_name',a.display_name,
      'provider_id',a.provider_id,'provider_adapter_key',a.adapter_key,
      'channel',a.provider_channel,
      'environment',a.environment,'region',a.region,
      'provider_account_reference',a.provider_account_reference,
      'status',a.status,'data_origin',a.data_origin,
      'health_state',a.health_state,'health_checked_at',a.health_checked_at,
      'verification_status',a.verification_status,
      'verification_result_code',a.verification_result_code,
      'verification_detail',a.verification_detail,
      'verification_checked_at',a.verification_checked_at,
      'updated_at',a.updated_at,
      'secret_ref_purposes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('purpose',s.purpose,'secret_ref',s.secret_ref)
                         ORDER BY s.purpose)
          FROM public.omni_comms_provider_account_secret_ref s
         WHERE s.provider_account_id=a.id),'[]'::jsonb),
      'required_credential_count', (
        SELECT count(*) FROM public.omni_comms_provider_credential_requirement r
         WHERE r.provider_id=a.provider_id AND r.required),
      'configured_credential_count', (
        SELECT count(*) FROM public.omni_comms_provider_account_secret_ref s
          JOIN public.omni_comms_provider_credential_requirement r
            ON r.provider_id=a.provider_id AND r.purpose=s.purpose AND r.required
         WHERE s.provider_account_id=a.id)
    ) AS row_json, a.created_at
    FROM acct a
  )
  SELECT
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin <> 'reference_seed'),'[]'::jsonb),
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin = 'reference_seed'),'[]'::jsonb)
    INTO v_accounts, v_ref_accounts
  FROM shaped;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'channel', v_channel,
    'providers', v_providers,
    'credential_requirements', v_reqs,
    'accounts', v_accounts,
    'reference_accounts', CASE WHEN v_include THEN v_ref_accounts ELSE '[]'::jsonb END,
    'reference_account_count', CASE WHEN v_include THEN jsonb_array_length(v_ref_accounts) ELSE 0 END,
    'generated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_provider_account_summary(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_provider_account_summary(uuid,text,boolean) TO authenticated, service_role;