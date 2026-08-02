-- ═══════════════════════════════════════════════════════════════════
-- Omni-Comms Channels C2 — generic provider accounts + multi credential refs
-- Additive only. No deletes, no retires, no runtime/dispatch changes,
-- no Legacy Communication Hub objects touched.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. data_origin classification ─────────────────────────────────
ALTER TABLE public.omni_comms_provider
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'system_seed';
ALTER TABLE public.omni_comms_provider_account
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'user';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_provider_data_origin_chk') THEN
    ALTER TABLE public.omni_comms_provider
      ADD CONSTRAINT omni_comms_provider_data_origin_chk
      CHECK (data_origin IN ('system_seed','user','reference_seed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_provider_account_data_origin_chk') THEN
    ALTER TABLE public.omni_comms_provider_account
      ADD CONSTRAINT omni_comms_provider_account_data_origin_chk
      CHECK (data_origin IN ('system_seed','user','reference_seed'));
  END IF;
END $$;

-- idempotent backfill
UPDATE public.omni_comms_provider
   SET data_origin='reference_seed'
 WHERE data_origin <> 'reference_seed'
   AND (code LIKE 'simulation\_%' OR adapter_key LIKE 'simulation\_%');
UPDATE public.omni_comms_provider
   SET data_origin='system_seed'
 WHERE data_origin NOT IN ('reference_seed')
   AND adapter_key='resend';

UPDATE public.omni_comms_provider_account a
   SET data_origin='reference_seed'
 WHERE a.data_origin <> 'reference_seed'
   AND (a.code LIKE 'simulation\_%'
        OR a.code LIKE 'ref\_sim\_%'
        OR a.secret_ref LIKE 'OMNI\_COMMS\_SIMULATION\_%'
        OR EXISTS (SELECT 1 FROM public.omni_comms_provider p
                    WHERE p.id=a.provider_id AND p.data_origin='reference_seed'));
UPDATE public.omni_comms_provider_account
   SET data_origin='user'
 WHERE data_origin NOT IN ('reference_seed','user');

-- ─── 2. generic provider-account fields ────────────────────────────
ALTER TABLE public.omni_comms_provider_account
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS provider_account_reference text;

-- backfill BEFORE the consistency constraint is installed
UPDATE public.omni_comms_provider_account
   SET environment = CASE WHEN sandbox_mode THEN 'sandbox' ELSE 'production' END
 WHERE (sandbox_mode = true  AND environment NOT IN ('sandbox','staging'))
    OR (sandbox_mode = false AND environment <> 'production');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_provider_account_environment_chk') THEN
    ALTER TABLE public.omni_comms_provider_account
      ADD CONSTRAINT omni_comms_provider_account_environment_chk
      CHECK (environment IN ('sandbox','staging','production'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_provider_account_env_sandbox_chk') THEN
    ALTER TABLE public.omni_comms_provider_account
      ADD CONSTRAINT omni_comms_provider_account_env_sandbox_chk
      CHECK ((environment='production' AND sandbox_mode=false)
          OR (environment IN ('sandbox','staging') AND sandbox_mode=true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='omni_comms_provider_account_reference_chk') THEN
    ALTER TABLE public.omni_comms_provider_account
      ADD CONSTRAINT omni_comms_provider_account_reference_chk
      CHECK (provider_account_reference IS NULL
             OR (char_length(btrim(provider_account_reference)) BETWEEN 1 AND 120
                 AND provider_account_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'));
  END IF;
END $$;

-- ─── 3. provider credential requirements ───────────────────────────
CREATE TABLE IF NOT EXISTS public.omni_comms_provider_credential_requirement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.omni_comms_provider(id) ON DELETE RESTRICT,
  purpose text NOT NULL,
  display_name text NOT NULL,
  description text,
  required boolean NOT NULL DEFAULT true,
  secret_ref_pattern text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_pcr_provider_purpose_uk UNIQUE (provider_id, purpose),
  CONSTRAINT omni_comms_pcr_purpose_chk
    CHECK (purpose ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(purpose) BETWEEN 2 AND 48),
  CONSTRAINT omni_comms_pcr_display_name_chk
    CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120),
  CONSTRAINT omni_comms_pcr_description_chk
    CHECK (description IS NULL OR char_length(description) <= 400),
  CONSTRAINT omni_comms_pcr_pattern_chk
    CHECK (char_length(secret_ref_pattern) BETWEEN 3 AND 200)
);

REVOKE ALL ON public.omni_comms_provider_credential_requirement FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omni_comms_provider_credential_requirement TO service_role;
ALTER TABLE public.omni_comms_provider_credential_requirement ENABLE ROW LEVEL SECURITY;

-- ─── 4. account secret references ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.omni_comms_provider_account_secret_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid NOT NULL
    REFERENCES public.omni_comms_provider_account(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  secret_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_pasr_account_purpose_uk UNIQUE (provider_account_id, purpose),
  CONSTRAINT omni_comms_pasr_purpose_chk
    CHECK (purpose ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(purpose) BETWEEN 2 AND 48),
  CONSTRAINT omni_comms_pasr_secret_ref_chk
    CHECK (secret_ref ~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$'
           AND char_length(secret_ref) BETWEEN 16 AND 96)
);

CREATE INDEX IF NOT EXISTS omni_comms_pasr_account_idx
  ON public.omni_comms_provider_account_secret_ref(provider_account_id);

REVOKE ALL ON public.omni_comms_provider_account_secret_ref FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.omni_comms_provider_account_secret_ref TO service_role;
ALTER TABLE public.omni_comms_provider_account_secret_ref ENABLE ROW LEVEL SECURITY;

-- ─── 5. seed the genuine Resend requirement (idempotent) ───────────
INSERT INTO public.omni_comms_provider_credential_requirement
  (provider_id, purpose, display_name, description, required, secret_ref_pattern, sort_order)
SELECT p.id, 'api_key', 'Resend API key',
       'Edge Function secret reference name holding the Resend API key. Never the key value.',
       true, '^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$', 1
  FROM public.omni_comms_provider p
 WHERE p.adapter_key='resend' AND p.channel='email'
ON CONFLICT (provider_id, purpose) DO NOTHING;

-- ─── 6. backfill existing account secret refs (idempotent) ─────────
INSERT INTO public.omni_comms_provider_account_secret_ref
  (provider_account_id, purpose, secret_ref, created_by, updated_by)
SELECT a.id, 'api_key', a.secret_ref, a.created_by, a.updated_by
  FROM public.omni_comms_provider_account a
  JOIN public.omni_comms_provider p ON p.id=a.provider_id
 WHERE p.adapter_key='resend' AND p.channel='email'
   AND a.secret_ref ~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$'
ON CONFLICT (provider_account_id, purpose) DO NOTHING;

-- ═══ 7. private helpers ════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_is_secret_ref_name(p_ref text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
  SELECT p_ref IS NOT NULL
     AND p_ref ~ '^OMNI_COMMS_[A-Z0-9]+(_[A-Z0-9]+)*$'
     AND char_length(p_ref) BETWEEN 16 AND 96;
$$;

/**
 * Generic credential-reference validation + atomic replacement.
 * p_refs: [{"purpose":"api_key","secret_ref":"OMNI_COMMS_RESEND_PRIMARY"}]
 * Returns TRUE when the resulting reference set differs from the previous one.
 */
CREATE OR REPLACE FUNCTION public.omni_comms_priv_apply_account_secret_refs(
  p_actor_id uuid, p_account_id uuid, p_provider_id uuid, p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_item jsonb; v_purpose text; v_ref text; v_pattern text; v_req boolean;
        v_before jsonb; v_after jsonb; v_seen text[] := ARRAY[]::text[];
BEGIN
  IF p_refs IS NULL OR jsonb_typeof(p_refs) <> 'array' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_refs_array_required';
  END IF;

  SELECT COALESCE(jsonb_object_agg(purpose, secret_ref), '{}'::jsonb) INTO v_before
    FROM public.omni_comms_provider_account_secret_ref WHERE provider_account_id=p_account_id;

  FOR v_item IN SELECT jsonb_array_elements(p_refs) LOOP
    v_purpose := btrim(COALESCE(v_item->>'purpose',''));
    v_ref     := btrim(COALESCE(v_item->>'secret_ref',''));
    IF v_purpose = '' OR v_ref = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_ref_empty';
    END IF;
    IF v_purpose = ANY(v_seen) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='duplicate_credential_purpose';
    END IF;
    v_seen := v_seen || v_purpose;

    SELECT secret_ref_pattern, required INTO v_pattern, v_req
      FROM public.omni_comms_provider_credential_requirement
     WHERE provider_id=p_provider_id AND purpose=v_purpose;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='unknown_credential_purpose';
    END IF;
    IF NOT public.omni_comms_priv_is_secret_ref_name(v_ref) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_ref_pattern';
    END IF;
    IF v_ref !~ v_pattern THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_ref_pattern';
    END IF;
  END LOOP;

  -- every required purpose must be supplied
  IF EXISTS (SELECT 1 FROM public.omni_comms_provider_credential_requirement r
              WHERE r.provider_id=p_provider_id AND r.required
                AND NOT (r.purpose = ANY(v_seen))) THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='missing_required_credential';
  END IF;

  DELETE FROM public.omni_comms_provider_account_secret_ref
   WHERE provider_account_id=p_account_id
     AND NOT (purpose = ANY(v_seen));

  FOR v_item IN SELECT jsonb_array_elements(p_refs) LOOP
    INSERT INTO public.omni_comms_provider_account_secret_ref
      (provider_account_id, purpose, secret_ref, created_by, updated_by)
    VALUES (p_account_id, btrim(v_item->>'purpose'), btrim(v_item->>'secret_ref'), p_actor_id, p_actor_id)
    ON CONFLICT (provider_account_id, purpose) DO UPDATE
      SET secret_ref=EXCLUDED.secret_ref, updated_by=p_actor_id, updated_at=now()
      WHERE public.omni_comms_provider_account_secret_ref.secret_ref IS DISTINCT FROM EXCLUDED.secret_ref;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(purpose, secret_ref), '{}'::jsonb) INTO v_after
    FROM public.omni_comms_provider_account_secret_ref WHERE provider_account_id=p_account_id;

  RETURN v_before IS DISTINCT FROM v_after;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_apply_account_secret_refs(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_apply_account_secret_refs(uuid,uuid,uuid,jsonb) TO service_role;

/** Keep the legacy Resend compatibility mirror in step with the api_key ref. */
CREATE OR REPLACE FUNCTION public.omni_comms_priv_sync_legacy_secret_ref(p_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_ref text;
BEGIN
  SELECT s.secret_ref INTO v_ref
    FROM public.omni_comms_provider_account_secret_ref s
    JOIN public.omni_comms_provider_account a ON a.id=s.provider_account_id
    JOIN public.omni_comms_provider p ON p.id=a.provider_id
   WHERE s.provider_account_id=p_account_id AND s.purpose='api_key' AND p.adapter_key='resend';
  IF v_ref IS NOT NULL THEN
    UPDATE public.omni_comms_provider_account
       SET secret_ref=v_ref
     WHERE id=p_account_id AND secret_ref IS DISTINCT FROM v_ref;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_sync_legacy_secret_ref(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_sync_legacy_secret_ref(uuid) TO service_role;

-- ═══ 8. generic private upsert worker ══════════════════════════════
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
        -- temporary placeholder; replaced by the api_key mirror below when applicable
        COALESCE((SELECT btrim(x->>'secret_ref') FROM jsonb_array_elements(p_secret_refs) x
                   WHERE x->>'purpose'='api_key' LIMIT 1),
                 (SELECT btrim(x->>'secret_ref') FROM jsonb_array_elements(p_secret_refs) x LIMIT 1)),
        v_region, v_sandbox, v_env, v_ref, 'user',
        'draft', p_actor_id, p_actor_id, 'unverified', NULL, NULL, NULL)
      RETURNING * INTO v_after;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 conflict' USING ERRCODE='P0001', DETAIL='account_code_exists';
      WHEN check_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL=SQLERRM;
      WHEN not_null_violation THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='secret_refs_required';
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

  PERFORM public.omni_comms_priv_sync_legacy_secret_ref(p_id);
  SELECT * INTO v_after FROM public.omni_comms_provider_account WHERE id=p_id;
  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,'update_draft','provider_account',p_id,v_after.code,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_account_upsert(uuid,uuid,timestamptz,uuid,text,uuid,text,text,text,text,text,jsonb,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_account_upsert(uuid,uuid,timestamptz,uuid,text,uuid,text,text,text,text,text,jsonb,boolean,text) TO service_role;

-- ═══ 9. generic private lifecycle worker ═══════════════════════════
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
  IF p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='retired_is_terminal'; END IF;

  SELECT * INTO v_prov FROM public.omni_comms_provider WHERE id=v_before.provider_id;

  IF v_action='activate' THEN
    IF v_before.status <> 'draft' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft'; END IF;
    IF v_prov.status <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='provider_not_active'; END IF;
    IF EXISTS (SELECT 1 FROM public.omni_comms_provider_credential_requirement r
                WHERE r.provider_id=v_before.provider_id AND r.required
                  AND NOT EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s
                                   WHERE s.provider_account_id=v_before.id AND s.purpose=r.purpose)) THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='missing_required_credential'; END IF;
    IF v_prov.adapter_key='resend' AND v_before.verification_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='provider_verification_required'; END IF;
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

-- ═══ 10. public generic RPCs ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_channel_provider_account_summary(
  p_organization_id uuid, p_channel text, p_include_reference boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_channel text; v_providers jsonb; v_reqs jsonb;
        v_accounts jsonb; v_ref_accounts jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_channel := btrim(COALESCE(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_channel NOT IN ('email','sms','whatsapp','push','in_app','webhook','print','voice') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',p.id,'code',p.code,'display_name',p.display_name,'channel',p.channel,
           'adapter_key',p.adapter_key,'status',p.status,'data_origin',p.data_origin,
           'updated_at',p.updated_at) ORDER BY p.code),'[]'::jsonb)
    INTO v_providers
    FROM public.omni_comms_provider p
   WHERE p.channel=v_channel AND p.status='active'
     AND (p.data_origin <> 'reference_seed' OR COALESCE(p_include_reference,false));

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
    'reference_accounts', CASE WHEN COALESCE(p_include_reference,false) THEN v_ref_accounts ELSE '[]'::jsonb END,
    'reference_account_count', jsonb_array_length(v_ref_accounts),
    'generated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_provider_account_summary(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_provider_account_summary(uuid,text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_provider_account_upsert_draft(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_channel text,
  p_provider_id uuid,
  p_code text,
  p_display_name text,
  p_environment text,
  p_region text DEFAULT NULL,
  p_provider_account_reference text DEFAULT NULL,
  p_secret_refs jsonb DEFAULT '[]'::jsonb,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_account_upsert(
    v_uid, p_id, p_expected_updated_at, p_organization_id, p_channel, p_provider_id,
    p_code, p_display_name, p_environment, p_region, p_provider_account_reference,
    p_secret_refs, false, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_provider_account_upsert_draft(uuid,timestamptz,uuid,text,uuid,text,text,text,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_provider_account_upsert_draft(uuid,timestamptz,uuid,text,uuid,text,text,text,text,text,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_provider_account_set_lifecycle(
  p_id uuid, p_expected_updated_at timestamptz, p_action text,
  p_reason text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_account_lifecycle(
    v_uid, p_id, p_expected_updated_at, p_action, p_reason, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_provider_account_set_lifecycle(uuid,timestamptz,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_provider_account_set_lifecycle(uuid,timestamptz,text,text,text) TO authenticated, service_role;

-- ═══ 11. legacy email RPCs become thin wrappers ════════════════════
CREATE OR REPLACE FUNCTION public.omni_comms_provider_account_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_code text, p_display_name text, p_secret_ref text,
  p_region text DEFAULT NULL, p_sandbox_mode boolean DEFAULT false,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid; v_pid uuid; v_org uuid; v_ref text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  v_pid := public.omni_comms_priv_email_provider_id();
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='email_provider_missing'; END IF;
  v_org := p_organization_id;
  IF p_id IS NOT NULL THEN
    SELECT organization_id, provider_account_reference INTO v_org, v_ref
      FROM public.omni_comms_provider_account WHERE id=p_id;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_account'; END IF;
  END IF;
  RETURN public.omni_comms_priv_channel_account_upsert(
    v_uid, p_id, p_expected_updated_at, v_org, 'email', v_pid,
    p_code, p_display_name,
    CASE WHEN COALESCE(p_sandbox_mode,false) THEN 'sandbox' ELSE 'production' END,
    p_region, v_ref,
    jsonb_build_array(jsonb_build_object('purpose','api_key','secret_ref',btrim(COALESCE(p_secret_ref,'')))),
    false, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_provider_account_upsert_draft(uuid,timestamptz,uuid,text,text,text,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_provider_account_upsert_draft(uuid,timestamptz,uuid,text,text,text,text,boolean,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_provider_account_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_account_lifecycle(
    v_uid, p_id, p_expected_updated_at, 'activate', NULL, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_provider_account_activate(uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_provider_account_activate(uuid,timestamptz,text) TO authenticated, service_role;

-- ═══ 12. verification context resolves the child api_key ref ═══════
CREATE OR REPLACE FUNCTION public.omni_comms_priv_provider_account_verification_context(
  p_actor_id uuid, p_organization_id uuid, p_provider_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_row public.omni_comms_provider_account%ROWTYPE;
        v_adapter text; v_channel text; v_secret_ref text; v_pattern text;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'code','authentication_required'); END IF;
  IF NOT public.has_permission(p_actor_id,'omni_comms','configure') THEN
    RETURN jsonb_build_object('allowed',false,'code','permission_denied'); END IF;
  BEGIN
    PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('allowed',false,'code','organization_access_denied');
  END;
  SELECT * INTO v_row FROM public.omni_comms_provider_account
   WHERE id=p_provider_account_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed',false,'code','not_found'); END IF;
  SELECT adapter_key, channel INTO v_adapter, v_channel
    FROM public.omni_comms_provider WHERE id=v_row.provider_id;
  IF v_adapter IS DISTINCT FROM 'resend' OR v_channel IS DISTINCT FROM 'email' THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete'); END IF;

  -- canonical source: the child api_key credential reference
  SELECT s.secret_ref INTO v_secret_ref
    FROM public.omni_comms_provider_account_secret_ref s
   WHERE s.provider_account_id=v_row.id AND s.purpose='api_key';
  SELECT r.secret_ref_pattern INTO v_pattern
    FROM public.omni_comms_provider_credential_requirement r
   WHERE r.provider_id=v_row.provider_id AND r.purpose='api_key';

  IF v_secret_ref IS NULL OR v_pattern IS NULL OR v_secret_ref !~ v_pattern
     OR NOT public.omni_comms_priv_is_secret_ref_name(v_secret_ref) THEN
    RETURN jsonb_build_object('allowed',false,'code','configuration_incomplete'); END IF;

  RETURN jsonb_build_object(
    'allowed', true, 'code','ok',
    'account_id', v_row.id, 'account_code', v_row.code,
    'secret_ref', v_secret_ref,
    'status', v_row.status, 'sandbox_mode', v_row.sandbox_mode,
    'environment', v_row.environment,
    'updated_at', v_row.updated_at);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid) TO service_role;

-- ═══ 13. email config summary exposes the new generic fields ═══════
CREATE OR REPLACE FUNCTION public.omni_comms_email_config_summary(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','extensions' AS $function$
DECLARE v_uid uuid; v_pid uuid; v_provider jsonb; v_accounts jsonb; v_senders jsonb;
        v_bindings jsonb; v_setting jsonb; v_ready boolean;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_required'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);
  v_pid := public.omni_comms_priv_email_provider_id();
  IF v_pid IS NULL THEN v_provider := NULL;
  ELSE
    SELECT jsonb_build_object('id',id,'code',code,'status',status,'updated_at',updated_at,'activated_at',activated_at)
      INTO v_provider FROM public.omni_comms_provider WHERE id=v_pid;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',a.id,'code',a.code,'display_name',a.display_name,'secret_ref',a.secret_ref,
      'region',a.region,'sandbox_mode',a.sandbox_mode,'status',a.status,
      'environment',a.environment,'data_origin',a.data_origin,
      'provider_account_reference',a.provider_account_reference,
      'health_state',a.health_state,'health_checked_at',a.health_checked_at,'updated_at',a.updated_at,
      'verification_status',a.verification_status,
      'verification_result_code',a.verification_result_code,
      'verification_detail',a.verification_detail,
      'verification_checked_at',a.verification_checked_at
    ) ORDER BY a.created_at),'[]'::jsonb) INTO v_accounts
    FROM public.omni_comms_provider_account a
   WHERE a.organization_id=p_organization_id AND a.provider_id=v_pid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,
      'from_address',from_address,'from_name',from_name,'reply_to_address',reply_to_address,
      'status',status,'department_id',department_id,'event_definition_id',event_definition_id,
      'updated_at',updated_at
    ) ORDER BY created_at),'[]'::jsonb) INTO v_senders
    FROM public.omni_comms_sender_identity
   WHERE organization_id=p_organization_id AND channel='email';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',b.id,'sender_identity_id',b.sender_identity_id,
      'provider_account_id',b.provider_account_id,'priority',b.priority,
      'external_sender_ref',b.external_sender_ref,
      'verification_status',b.verification_status,'verified_at',b.verified_at,
      'status',b.status,'updated_at',b.updated_at
    ) ORDER BY b.created_at),'[]'::jsonb) INTO v_bindings
    FROM public.omni_comms_sender_provider_binding b
    JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
   WHERE s.organization_id=p_organization_id AND s.channel='email';
  SELECT jsonb_build_object(
      'id',id,'department_id',department_id,'enabled',enabled,
      'live_delivery_enabled',live_delivery_enabled,
      'quiet_hours_start',quiet_hours_start,'quiet_hours_end',quiet_hours_end,
      'quiet_hours_timezone',quiet_hours_timezone,'per_minute_limit',per_minute_limit,
      'updated_at',updated_at) INTO v_setting
    FROM public.omni_comms_channel_setting
   WHERE organization_id=p_organization_id AND department_id IS NULL AND channel='email' LIMIT 1;
  v_ready :=
      v_provider IS NOT NULL AND (v_provider->>'status')='active'
      AND EXISTS(SELECT 1 FROM public.omni_comms_provider_account
                  WHERE organization_id=p_organization_id AND provider_id=v_pid
                    AND status='active' AND verification_status='verified'
                    AND data_origin <> 'reference_seed')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_identity
                  WHERE organization_id=p_organization_id AND channel='email' AND status='active')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_provider_binding b
                  JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
                 WHERE s.organization_id=p_organization_id AND s.channel='email'
                   AND b.status='active' AND b.verification_status='verified')
      AND v_setting IS NOT NULL AND (v_setting->>'enabled')::boolean=true;
  RETURN jsonb_build_object(
    'organization_id',p_organization_id,'provider',v_provider,
    'provider_accounts',v_accounts,'sender_identities',v_senders,
    'bindings',v_bindings,'channel_setting',v_setting,
    'email_send_ready',v_ready,'generated_at',now());
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_email_config_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_email_config_summary(uuid) TO authenticated, service_role;