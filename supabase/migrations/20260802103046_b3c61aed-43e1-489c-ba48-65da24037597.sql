-- Omni-Comms Channels C4A — Generic Identity-to-Provider Bindings

ALTER TABLE public.omni_comms_sender_provider_binding
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS channel_endpoint_id uuid
    REFERENCES public.omni_comms_channel_endpoint(id),
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS verification_source text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verification_result_code text,
  ADD COLUMN IF NOT EXISTS verification_detail text,
  ADD COLUMN IF NOT EXISTS verification_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid;

UPDATE public.omni_comms_sender_provider_binding b
   SET organization_id = COALESCE(b.organization_id, i.organization_id),
       channel         = COALESCE(b.channel, i.channel),
       department_id   = COALESCE(b.department_id, i.department_id)
  FROM public.omni_comms_sender_identity i
 WHERE i.id = b.sender_identity_id;

UPDATE public.omni_comms_sender_provider_binding b
   SET data_origin = 'reference_seed'
  FROM public.omni_comms_sender_identity i,
       public.omni_comms_provider_account a
 WHERE i.id = b.sender_identity_id
   AND a.id = b.provider_account_id
   AND (i.data_origin = 'reference_seed' OR a.data_origin = 'reference_seed');

UPDATE public.omni_comms_sender_provider_binding
   SET verification_source = CASE
         WHEN verification_status IN ('verified','failed') THEN 'legacy_manual'
         ELSE 'none' END
 WHERE verification_source = 'none';

ALTER TABLE public.omni_comms_sender_provider_binding
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN channel SET NOT NULL;

ALTER TABLE public.omni_comms_sender_provider_binding
  DROP CONSTRAINT IF EXISTS omni_comms_binding_status_chk,
  DROP CONSTRAINT IF EXISTS omni_comms_binding_activated_meta_chk;

ALTER TABLE public.omni_comms_sender_provider_binding
  ADD CONSTRAINT omni_comms_binding_status_chk
    CHECK (status IN ('draft','active','disabled','retired')),
  ADD CONSTRAINT omni_comms_binding_activated_meta_chk
    CHECK ((status = 'draft' AND activated_at IS NULL AND activated_by IS NULL)
           OR status IN ('active','disabled','retired')),
  ADD CONSTRAINT omni_comms_binding_channel_chk
    CHECK (channel IN ('email','sms','whatsapp','push','in_app','print')),
  ADD CONSTRAINT omni_comms_binding_origin_chk
    CHECK (data_origin IN ('system_seed','user','reference_seed')),
  ADD CONSTRAINT omni_comms_binding_verification_source_chk
    CHECK (verification_source IN ('none','provider','service','legacy_manual')),
  ADD CONSTRAINT omni_comms_binding_verification_pairing_chk
    CHECK ((verification_status IN ('unverified','pending') AND verification_source = 'none')
           OR (verification_status IN ('verified','failed') AND verification_source <> 'none')),
  ADD CONSTRAINT omni_comms_binding_result_code_chk
    CHECK (verification_result_code IS NULL
           OR (verification_result_code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
               AND char_length(verification_result_code) <= 64)),
  ADD CONSTRAINT omni_comms_binding_verification_detail_chk
    CHECK (verification_detail IS NULL OR char_length(verification_detail) <= 500),
  ADD CONSTRAINT omni_comms_binding_external_ref_shape_chk
    CHECK (external_sender_ref IS NULL
           OR external_sender_ref ~ '^[A-Za-z0-9][A-Za-z0-9 ._:@+/-]{0,127}$');

ALTER TABLE public.omni_comms_sender_provider_binding
  DROP CONSTRAINT IF EXISTS omni_comms_binding_unique_pair_uk;
DROP INDEX IF EXISTS public.omni_comms_binding_unique_pair_uk;
ALTER TABLE public.omni_comms_sender_provider_binding
  DROP CONSTRAINT IF EXISTS omni_comms_binding_active_priority_uk;
DROP INDEX IF EXISTS public.omni_comms_binding_active_priority_uk;

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_binding_combination_uk
  ON public.omni_comms_sender_provider_binding (
    sender_identity_id, provider_account_id,
    COALESCE(channel_endpoint_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status <> 'retired';

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_binding_scope_priority_uk
  ON public.omni_comms_sender_provider_binding (
    organization_id, channel, sender_identity_id,
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid), priority)
  WHERE status IN ('draft','active');

CREATE INDEX IF NOT EXISTS omni_comms_binding_org_channel_ix
  ON public.omni_comms_sender_provider_binding (organization_id, channel, status);

REVOKE ALL ON TABLE public.omni_comms_sender_provider_binding
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.omni_comms_sender_provider_binding TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_binding_endpoint_requirement(
  p_channel text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog','public' AS $$
  SELECT CASE p_channel
    WHEN 'email'    THEN 'required'
    WHEN 'sms'      THEN 'optional'
    WHEN 'whatsapp' THEN 'required'
    WHEN 'push'     THEN 'forbidden'
    WHEN 'in_app'   THEN 'required'
    WHEN 'print'    THEN 'required'
    ELSE 'forbidden' END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_binding_endpoint_requirement(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_binding_endpoint_requirement(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_binding(
  p_actor_id uuid, p_organization_id uuid, p_department_id uuid, p_channel text,
  p_sender_identity_id uuid, p_provider_account_id uuid, p_channel_endpoint_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  i public.omni_comms_sender_identity%ROWTYPE;
  a public.omni_comms_provider_account%ROWTYPE;
  e public.omni_comms_channel_endpoint%ROWTYPE;
  v_acct_channel text; v_req text; v_domain text; v_sender_domain text;
BEGIN
  IF p_channel NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;

  PERFORM public.omni_comms_priv_require_tenant_access(
    p_actor_id, p_organization_id, p_department_id);

  SELECT * INTO i FROM public.omni_comms_sender_identity WHERE id = p_sender_identity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity'; END IF;
  SELECT * INTO a FROM public.omni_comms_provider_account WHERE id = p_provider_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_account'; END IF;
  SELECT p.channel INTO v_acct_channel FROM public.omni_comms_provider p WHERE p.id = a.provider_id;

  IF i.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='identity_organization_mismatch'; END IF;
  IF a.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='account_organization_mismatch'; END IF;
  IF i.channel IS DISTINCT FROM p_channel THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='identity_channel_mismatch'; END IF;
  IF v_acct_channel IS DISTINCT FROM p_channel THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_channel_mismatch'; END IF;
  IF i.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_identity_not_allowed'; END IF;
  IF a.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_provider_account_not_allowed'; END IF;
  IF i.status = 'retired' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='identity_retired'; END IF;
  IF a.status = 'retired' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_account_retired'; END IF;

  IF p_department_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.core_department d
                    WHERE d.id = p_department_id AND d.organization_id = p_organization_id) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_organization_mismatch'; END IF;
  END IF;
  IF i.department_id IS NOT NULL THEN
    IF p_department_id IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='identity_department_scope_required'; END IF;
    IF p_department_id IS DISTINCT FROM i.department_id THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='identity_department_scope_mismatch'; END IF;
  END IF;

  v_req := public.omni_comms_priv_binding_endpoint_requirement(p_channel);
  IF p_channel_endpoint_id IS NULL THEN
    IF v_req = 'required' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_endpoint_required'; END IF;
    RETURN;
  END IF;
  IF v_req = 'forbidden' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_endpoint_not_supported'; END IF;

  SELECT * INTO e FROM public.omni_comms_channel_endpoint WHERE id = p_channel_endpoint_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='channel_endpoint'; END IF;
  IF e.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001', DETAIL='endpoint_organization_mismatch'; END IF;
  IF e.channel IS DISTINCT FROM p_channel THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_channel_mismatch'; END IF;
  IF e.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_endpoint_not_allowed'; END IF;
  IF e.status = 'retired' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_retired'; END IF;
  IF e.department_id IS NOT NULL AND e.department_id IS DISTINCT FROM p_department_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_department_scope_mismatch'; END IF;

  IF p_channel = 'email' THEN
    IF e.endpoint_type <> 'sending_domain' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_type_not_allowed'; END IF;
    IF e.provider_account_id IS DISTINCT FROM p_provider_account_id THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_provider_account_mismatch'; END IF;
    v_domain := lower(btrim(coalesce(e.endpoint_config->>'domain_name','')));
    v_sender_domain := lower(split_part(coalesce(i.identity_config->>'from_address', i.from_address,''),'@',2));
    IF v_domain = '' OR v_sender_domain IS DISTINCT FROM v_domain THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='sender_domain_mismatch'; END IF;
  ELSIF p_channel = 'sms' THEN
    IF e.endpoint_type NOT IN ('delivery_callback','inbound_callback') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_type_not_allowed'; END IF;
    IF e.provider_account_id IS DISTINCT FROM p_provider_account_id THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_provider_account_mismatch'; END IF;
  ELSIF p_channel = 'whatsapp' THEN
    IF e.endpoint_type <> 'business_webhook' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_type_not_allowed'; END IF;
    IF e.provider_account_id IS DISTINCT FROM p_provider_account_id THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_provider_account_mismatch'; END IF;
  ELSIF p_channel = 'in_app' THEN
    IF e.endpoint_type <> 'realtime_endpoint' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_type_not_allowed'; END IF;
    IF e.provider_account_id IS NOT NULL
       AND e.provider_account_id IS DISTINCT FROM p_provider_account_id THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_provider_account_mismatch'; END IF;
  ELSIF p_channel = 'print' THEN
    IF e.endpoint_type <> 'render_service' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_type_not_allowed'; END IF;
    IF coalesce(e.endpoint_config->>'service_mode','') = 'https' THEN
      IF e.provider_account_id IS DISTINCT FROM p_provider_account_id THEN
        RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_provider_account_mismatch'; END IF;
    ELSIF e.provider_account_id IS NOT NULL
          AND e.provider_account_id IS DISTINCT FROM p_provider_account_id THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='endpoint_provider_account_mismatch';
    END IF;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_binding(uuid,uuid,uuid,text,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_validate_binding(uuid,uuid,uuid,text,uuid,uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_binding_upsert(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_organization_id uuid, p_department_id uuid, p_channel text,
  p_sender_identity_id uuid, p_provider_account_id uuid, p_channel_endpoint_id uuid,
  p_priority integer, p_external_sender_ref text, p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_before public.omni_comms_sender_provider_binding%ROWTYPE;
  v_after  public.omni_comms_sender_provider_binding%ROWTYPE;
  v_prio integer; v_ref text; v_reset boolean := false; v_dept uuid;
BEGIN
  v_prio := COALESCE(p_priority, 100);
  IF v_prio < 1 OR v_prio > 1000 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='priority_out_of_range'; END IF;
  v_ref := NULLIF(btrim(coalesce(p_external_sender_ref,'')),'');
  IF v_ref IS NOT NULL AND (char_length(v_ref) > 128
     OR v_ref !~ '^[A-Za-z0-9][A-Za-z0-9 ._:@+/-]{0,127}$') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_provider_identity_reference'; END IF;
  v_dept := p_department_id;

  PERFORM public.omni_comms_priv_validate_binding(
    p_actor_id, p_organization_id, v_dept, p_channel,
    p_sender_identity_id, p_provider_account_id, p_channel_endpoint_id);

  IF EXISTS (
    SELECT 1 FROM public.omni_comms_sender_provider_binding b
     WHERE b.status <> 'retired'
       AND b.sender_identity_id = p_sender_identity_id
       AND b.provider_account_id = p_provider_account_id
       AND b.channel_endpoint_id IS NOT DISTINCT FROM p_channel_endpoint_id
       AND (p_id IS NULL OR b.id <> p_id)) THEN
    RAISE EXCEPTION 'OC409 duplicate_binding' USING ERRCODE='P0001', DETAIL='duplicate_binding_combination'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.omni_comms_sender_provider_binding b
     WHERE b.status IN ('draft','active')
       AND b.organization_id = p_organization_id
       AND b.channel = p_channel
       AND b.sender_identity_id = p_sender_identity_id
       AND b.department_id IS NOT DISTINCT FROM v_dept
       AND b.priority = v_prio
       AND (p_id IS NULL OR b.id <> p_id)) THEN
    RAISE EXCEPTION 'OC409 duplicate_priority' USING ERRCODE='P0001', DETAIL='duplicate_scope_priority'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_sender_provider_binding(
      organization_id, department_id, channel, sender_identity_id,
      provider_account_id, channel_endpoint_id, priority, external_sender_ref,
      status, data_origin, verification_status, verification_source,
      created_by, updated_by)
    VALUES(p_organization_id, v_dept, p_channel, p_sender_identity_id,
      p_provider_account_id, p_channel_endpoint_id, v_prio, v_ref,
      'draft','user','unverified','none', p_actor_id, p_actor_id)
    RETURNING * INTO v_after;
    PERFORM public.omni_comms_priv_write_channel_audit(
      p_actor_id,'create','binding',v_after.id,v_after.id::text,NULL,
      to_jsonb(v_after),p_correlation_id);
    RETURN v_after.id;
  END IF;

  SELECT * INTO v_before FROM public.omni_comms_sender_provider_binding
   WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='binding'; END IF;
  IF v_before.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_binding_read_only'; END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='expected_updated_at_required'; END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft'; END IF;

  v_reset := (v_before.sender_identity_id IS DISTINCT FROM p_sender_identity_id)
          OR (v_before.provider_account_id IS DISTINCT FROM p_provider_account_id)
          OR (v_before.channel_endpoint_id IS DISTINCT FROM p_channel_endpoint_id)
          OR (v_before.department_id IS DISTINCT FROM v_dept)
          OR (v_before.external_sender_ref IS DISTINCT FROM v_ref);

  UPDATE public.omni_comms_sender_provider_binding
     SET organization_id = p_organization_id,
         department_id = v_dept,
         channel = p_channel,
         sender_identity_id = p_sender_identity_id,
         provider_account_id = p_provider_account_id,
         channel_endpoint_id = p_channel_endpoint_id,
         priority = v_prio,
         external_sender_ref = v_ref,
         verification_status = CASE WHEN v_reset THEN 'unverified' ELSE verification_status END,
         verification_source = CASE WHEN v_reset THEN 'none' ELSE verification_source END,
         verification_result_code = CASE WHEN v_reset THEN NULL ELSE verification_result_code END,
         verification_detail = CASE WHEN v_reset THEN NULL ELSE verification_detail END,
         verification_checked_at = CASE WHEN v_reset THEN NULL ELSE verification_checked_at END,
         verified_at = CASE WHEN v_reset THEN NULL ELSE verified_at END,
         updated_by = p_actor_id, updated_at = now()
   WHERE id = p_id RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,'update','binding',p_id,p_id::text,to_jsonb(v_before),
    to_jsonb(v_after),p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_binding_upsert(uuid,uuid,timestamptz,uuid,uuid,text,uuid,uuid,uuid,integer,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_binding_upsert(uuid,uuid,timestamptz,uuid,uuid,text,uuid,uuid,uuid,integer,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_binding_lifecycle(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_action text, p_reason text, p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_before public.omni_comms_sender_provider_binding%ROWTYPE;
  v_after  public.omni_comms_sender_provider_binding%ROWTYPE;
  v_reason text; v_istatus text; v_astatus text; v_estatus text;
BEGIN
  IF p_action NOT IN ('activate','disable','retire') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_action'; END IF;
  SELECT * INTO v_before FROM public.omni_comms_sender_provider_binding
   WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='binding'; END IF;
  IF v_before.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_binding_non_operational'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;
  IF v_before.status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='binding_retired'; END IF;

  PERFORM public.omni_comms_priv_require_tenant_access(
    p_actor_id, v_before.organization_id, v_before.department_id);

  IF p_action = 'activate' THEN
    IF v_before.status NOT IN ('draft','disabled') THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_draft_or_disabled'; END IF;
    PERFORM public.omni_comms_priv_validate_binding(
      p_actor_id, v_before.organization_id, v_before.department_id, v_before.channel,
      v_before.sender_identity_id, v_before.provider_account_id, v_before.channel_endpoint_id);
    SELECT status INTO v_istatus FROM public.omni_comms_sender_identity
      WHERE id = v_before.sender_identity_id;
    IF v_istatus <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='identity_not_active'; END IF;
    SELECT status INTO v_astatus FROM public.omni_comms_provider_account
      WHERE id = v_before.provider_account_id;
    IF v_astatus <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='provider_account_not_active'; END IF;
    IF v_before.channel_endpoint_id IS NOT NULL THEN
      SELECT status INTO v_estatus FROM public.omni_comms_channel_endpoint
        WHERE id = v_before.channel_endpoint_id;
      IF v_estatus <> 'active' THEN
        RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='channel_endpoint_not_active'; END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.omni_comms_sender_provider_binding b
       WHERE b.id <> v_before.id AND b.status IN ('draft','active')
         AND b.organization_id = v_before.organization_id
         AND b.channel = v_before.channel
         AND b.sender_identity_id = v_before.sender_identity_id
         AND b.department_id IS NOT DISTINCT FROM v_before.department_id
         AND b.priority = v_before.priority) THEN
      RAISE EXCEPTION 'OC409 duplicate_priority' USING ERRCODE='P0001', DETAIL='duplicate_scope_priority'; END IF;

    UPDATE public.omni_comms_sender_provider_binding
       SET status='active', activated_at=COALESCE(activated_at, now()),
           activated_by=COALESCE(activated_by, p_actor_id),
           disabled_at=NULL, disabled_by=NULL,
           updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSIF p_action = 'disable' THEN
    IF v_before.status <> 'active' THEN
      RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='must_be_active'; END IF;
    UPDATE public.omni_comms_sender_provider_binding
       SET status='disabled', disabled_at=now(), disabled_by=p_actor_id,
           updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;

  ELSE
    v_reason := NULLIF(btrim(coalesce(p_reason,'')),'');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='retirement_reason_required'; END IF;
    UPDATE public.omni_comms_sender_provider_binding
       SET status='retired', retired_at=now(), retired_by=p_actor_id,
           retirement_reason=v_reason, updated_by=p_actor_id, updated_at=now()
     WHERE id=p_id RETURNING * INTO v_after;
  END IF;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id, p_action, 'binding', p_id, p_id::text,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_binding_lifecycle(uuid,uuid,timestamptz,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_binding_lifecycle(uuid,uuid,timestamptz,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_record_binding_verification(
  p_actor_id uuid, p_id uuid, p_expected_updated_at timestamptz,
  p_verification_status text, p_verification_source text,
  p_result_code text, p_detail text, p_correlation_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_before public.omni_comms_sender_provider_binding%ROWTYPE;
  v_after  public.omni_comms_sender_provider_binding%ROWTYPE;
  v_code text; v_detail text;
BEGIN
  IF p_verification_source NOT IN ('provider','service') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='untrusted_verification_source'; END IF;
  IF p_verification_status NOT IN ('unverified','pending','verified','failed') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_verification_status'; END IF;
  v_code := NULLIF(btrim(coalesce(p_result_code,'')),'');
  IF v_code IS NOT NULL AND (char_length(v_code) > 64
     OR v_code !~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_result_code'; END IF;
  v_detail := NULLIF(btrim(coalesce(p_detail,'')),'');
  IF v_detail IS NOT NULL AND char_length(v_detail) > 500 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='detail_too_long'; END IF;

  SELECT * INTO v_before FROM public.omni_comms_sender_provider_binding
   WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='binding'; END IF;
  IF v_before.data_origin = 'reference_seed' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='reference_binding_non_operational'; END IF;
  IF p_expected_updated_at IS NOT NULL
     AND v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='updated_at_mismatch'; END IF;

  UPDATE public.omni_comms_sender_provider_binding
     SET verification_status = p_verification_status,
         verification_source = CASE WHEN p_verification_status IN ('unverified','pending')
                                    THEN 'none' ELSE p_verification_source END,
         verification_result_code = v_code,
         verification_detail = v_detail,
         verification_checked_at = now(),
         verified_at = CASE WHEN p_verification_status = 'verified' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_id RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_channel_audit(
    p_actor_id,'verification_'||p_verification_status,'binding',p_id,p_id::text,
    to_jsonb(v_before), to_jsonb(v_after), p_correlation_id);
  RETURN p_id;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_record_binding_verification(uuid,uuid,timestamptz,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_record_binding_verification(uuid,uuid,timestamptz,text,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_binding_summary(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email', p_include_reference boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_uid uuid; v_ch text; v_can_configure boolean; v_allow_ref boolean;
  v_identities jsonb; v_accounts jsonb; v_endpoints jsonb;
  v_bindings jsonb; v_ref jsonb; v_ref_count integer;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_ch := btrim(coalesce(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_can_configure := public.has_permission(v_uid,'omni_comms','configure');
  v_allow_ref := COALESCE(p_include_reference,false) AND v_can_configure;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',i.id,'code',i.code,'display_name',i.display_name,
      'identity_type',i.identity_type,'channel',i.channel,
      'identity_value',COALESCE(i.identity_config->>'from_address', i.from_address,
                                i.identity_config->>'sender_value',
                                i.identity_config->>'display_number',
                                i.identity_config->>'application_code',
                                i.identity_config->>'issuing_authority'),
      'department_id',i.department_id,'department_name',d.name,
      'status',i.status,'data_origin',i.data_origin
    ) ORDER BY i.code),'[]'::jsonb) INTO v_identities
    FROM public.omni_comms_sender_identity i
    LEFT JOIN public.core_department d ON d.id = i.department_id
   WHERE i.organization_id = p_organization_id
     AND i.channel = v_ch AND i.data_origin <> 'reference_seed'
     AND i.status <> 'retired'
     AND (p_department_id IS NULL OR i.department_id IS NULL
          OR i.department_id = p_department_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',a.id,'code',a.code,'display_name',a.display_name,
      'adapter_key',p.adapter_key,'environment',a.environment,
      'status',a.status,'verification_status',a.verification_status,
      'data_origin',a.data_origin
    ) ORDER BY a.code),'[]'::jsonb) INTO v_accounts
    FROM public.omni_comms_provider_account a
    JOIN public.omni_comms_provider p ON p.id = a.provider_id
   WHERE a.organization_id = p_organization_id AND p.channel = v_ch
     AND a.data_origin <> 'reference_seed' AND a.status <> 'retired';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id,'code',e.code,'display_name',e.display_name,
      'endpoint_type',e.endpoint_type,'provider_account_id',e.provider_account_id,
      'endpoint_config',e.endpoint_config,
      'department_id',e.department_id,'department_name',d.name,
      'status',e.status,'verification_status',e.verification_status,
      'data_origin',e.data_origin
    ) ORDER BY e.code),'[]'::jsonb) INTO v_endpoints
    FROM public.omni_comms_channel_endpoint e
    LEFT JOIN public.core_department d ON d.id = e.department_id
   WHERE e.organization_id = p_organization_id AND e.channel = v_ch
     AND e.data_origin <> 'reference_seed' AND e.status <> 'retired'
     AND (p_department_id IS NULL OR e.department_id IS NULL
          OR e.department_id = p_department_id);

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.priority, x.created_at),'[]'::jsonb)
    INTO v_bindings
    FROM (
      SELECT b.id, b.organization_id, b.department_id, d.name AS department_name,
             b.channel, b.sender_identity_id, i.code AS identity_code,
             i.display_name AS identity_display_name, i.identity_type,
             COALESCE(i.identity_config->>'from_address', i.from_address,
                      i.identity_config->>'sender_value',
                      i.identity_config->>'display_number',
                      i.identity_config->>'application_code',
                      i.identity_config->>'issuing_authority') AS identity_value,
             b.provider_account_id, a.code AS provider_account_code,
             a.display_name AS provider_account_display_name, p.adapter_key,
             b.channel_endpoint_id, e.code AS endpoint_code,
             e.display_name AS endpoint_display_name, e.endpoint_type,
             b.priority, b.external_sender_ref, b.status, b.data_origin,
             b.verification_status, b.verification_source,
             b.verification_result_code, b.verification_detail,
             b.verification_checked_at, b.verified_at, b.activated_at,
             b.disabled_at, b.retired_at, b.retirement_reason,
             b.created_at, b.updated_at
        FROM public.omni_comms_sender_provider_binding b
        JOIN public.omni_comms_sender_identity i ON i.id = b.sender_identity_id
        JOIN public.omni_comms_provider_account a ON a.id = b.provider_account_id
        JOIN public.omni_comms_provider p ON p.id = a.provider_id
        LEFT JOIN public.omni_comms_channel_endpoint e ON e.id = b.channel_endpoint_id
        LEFT JOIN public.core_department d ON d.id = b.department_id
       WHERE b.organization_id = p_organization_id AND b.channel = v_ch
         AND b.data_origin <> 'reference_seed'
         AND (p_department_id IS NULL OR b.department_id IS NULL
              OR b.department_id = p_department_id)
    ) x;

  SELECT count(*) INTO v_ref_count
    FROM public.omni_comms_sender_provider_binding b
   WHERE b.organization_id = p_organization_id AND b.channel = v_ch
     AND b.data_origin = 'reference_seed'
     AND (p_department_id IS NULL OR b.department_id IS NULL
          OR b.department_id = p_department_id);

  IF v_allow_ref THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.priority, x.created_at),'[]'::jsonb)
      INTO v_ref
      FROM (
        SELECT b.id, b.organization_id, b.department_id, d.name AS department_name,
               b.channel, b.sender_identity_id, i.code AS identity_code,
               i.display_name AS identity_display_name, i.identity_type,
               COALESCE(i.identity_config->>'from_address', i.from_address) AS identity_value,
               b.provider_account_id, a.code AS provider_account_code,
               a.display_name AS provider_account_display_name, p.adapter_key,
               b.channel_endpoint_id, e.code AS endpoint_code,
               e.display_name AS endpoint_display_name, e.endpoint_type,
               b.priority, b.external_sender_ref, b.status, b.data_origin,
               b.verification_status, b.verification_source,
               b.verification_result_code, b.verification_detail,
               b.verification_checked_at, b.verified_at, b.activated_at,
               b.disabled_at, b.retired_at, b.retirement_reason,
               b.created_at, b.updated_at
          FROM public.omni_comms_sender_provider_binding b
          JOIN public.omni_comms_sender_identity i ON i.id = b.sender_identity_id
          JOIN public.omni_comms_provider_account a ON a.id = b.provider_account_id
          JOIN public.omni_comms_provider p ON p.id = a.provider_id
          LEFT JOIN public.omni_comms_channel_endpoint e ON e.id = b.channel_endpoint_id
          LEFT JOIN public.core_department d ON d.id = b.department_id
         WHERE b.organization_id = p_organization_id AND b.channel = v_ch
           AND b.data_origin = 'reference_seed'
           AND (p_department_id IS NULL OR b.department_id IS NULL
                OR b.department_id = p_department_id)
      ) x;
  ELSE
    v_ref := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', v_ch,
    'identities', v_identities,
    'provider_accounts', v_accounts,
    'endpoints', v_endpoints,
    'bindings', v_bindings,
    'reference_bindings', v_ref,
    'reference_binding_count', v_ref_count,
    'generated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_binding_summary(uuid,uuid,text,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_binding_summary(uuid,uuid,text,boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_binding_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_organization_id uuid,
  p_department_id uuid, p_channel text, p_sender_identity_id uuid,
  p_provider_account_id uuid, p_channel_endpoint_id uuid, p_priority integer,
  p_external_sender_ref text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_binding_upsert(
    v_uid, p_id, p_expected_updated_at, p_organization_id, p_department_id,
    p_channel, p_sender_identity_id, p_provider_account_id, p_channel_endpoint_id,
    p_priority, p_external_sender_ref, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_binding_upsert_draft(uuid,timestamptz,uuid,uuid,text,uuid,uuid,uuid,integer,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_binding_upsert_draft(uuid,timestamptz,uuid,uuid,text,uuid,uuid,uuid,integer,text,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_binding_set_lifecycle(
  p_id uuid, p_expected_updated_at timestamptz, p_action text,
  p_reason text DEFAULT NULL, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_binding_lifecycle(
    v_uid, p_id, p_expected_updated_at, p_action, p_reason, p_correlation_id);
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_channel_binding_set_lifecycle(uuid,timestamptz,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_binding_set_lifecycle(uuid,timestamptz,text,text,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_binding_upsert_draft(
  p_id uuid, p_expected_updated_at timestamptz, p_sender_identity_id uuid,
  p_provider_account_id uuid, p_priority integer, p_external_sender_ref text,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_uid uuid; i public.omni_comms_sender_identity%ROWTYPE;
  v_endpoint uuid; v_count integer; v_dept uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO i FROM public.omni_comms_sender_identity WHERE id = p_sender_identity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='sender_identity'; END IF;
  v_dept := COALESCE(
    (SELECT b.department_id FROM public.omni_comms_sender_provider_binding b WHERE b.id = p_id),
    i.department_id);

  IF public.omni_comms_priv_binding_endpoint_requirement(i.channel) = 'required' THEN
    SELECT count(*), min(e.id) INTO v_count, v_endpoint
      FROM public.omni_comms_channel_endpoint e
     WHERE e.organization_id = i.organization_id
       AND e.channel = i.channel
       AND e.status = 'active'
       AND e.data_origin <> 'reference_seed'
       AND e.provider_account_id IS NOT DISTINCT FROM p_provider_account_id
       AND (i.channel <> 'email' OR (e.endpoint_type = 'sending_domain'
            AND lower(coalesce(e.endpoint_config->>'domain_name','')) =
                lower(split_part(coalesce(i.identity_config->>'from_address', i.from_address,''),'@',2))));
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',
        DETAIL='legacy_binding_endpoint_ambiguous'; END IF;
  END IF;

  RETURN public.omni_comms_priv_channel_binding_upsert(
    v_uid, p_id, p_expected_updated_at, i.organization_id, v_dept, i.channel,
    p_sender_identity_id, p_provider_account_id, v_endpoint, p_priority,
    p_external_sender_ref, p_correlation_id);
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_binding_activate(
  p_id uuid, p_expected_updated_at timestamptz, p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_channel_binding_lifecycle(
    v_uid, p_id, p_expected_updated_at, 'activate', NULL, p_correlation_id);
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_binding_record_verification(
  p_id uuid, p_expected_updated_at timestamptz, p_status text,
  p_correlation_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public' AS $$
BEGIN
  RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001',
    DETAIL='manual_binding_verification_removed';
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_binding_record_verification(uuid,timestamptz,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_binding_record_verification(uuid,timestamptz,text,text)
  TO service_role;