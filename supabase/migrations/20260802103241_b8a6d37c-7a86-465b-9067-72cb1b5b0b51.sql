CREATE OR REPLACE FUNCTION public.omni_comms_priv_binding_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public' AS $$
DECLARE
  v_sender_org uuid; v_sender_channel text;
  v_account_org uuid; v_provider_id uuid; v_provider_channel text;
BEGIN
  SELECT organization_id, channel INTO v_sender_org, v_sender_channel
    FROM public.omni_comms_sender_identity WHERE id = NEW.sender_identity_id;
  SELECT pa.organization_id, pa.provider_id, p.channel
    INTO v_account_org, v_provider_id, v_provider_channel
    FROM public.omni_comms_provider_account pa
    JOIN public.omni_comms_provider p ON p.id = pa.provider_id
    WHERE pa.id = NEW.provider_account_id;

  IF v_sender_org IS NULL OR v_account_org IS NULL THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding referenced rows missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_sender_org <> v_account_org THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding organisation mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_sender_channel <> v_provider_channel THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding channel mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.channel IS DISTINCT FROM v_sender_channel THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding channel mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_sender_org THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding organisation mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding must be inserted in draft status'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('draft','active','disabled','retired') THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding invalid status %', NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding retired status is terminal' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding cannot revert to draft' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'disabled' THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding draft cannot be disabled' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'active' AND OLD.status = 'draft' AND NEW.activated_at IS NULL THEN
    NEW.activated_at := now();
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS NULL THEN
    RAISE EXCEPTION 'omni_comms_sender_provider_binding activated_at cannot be cleared' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'retired' AND OLD.status <> 'retired' THEN
    IF NEW.retired_at IS NULL THEN NEW.retired_at := now(); END IF;
    IF NEW.retirement_reason IS NULL OR char_length(btrim(NEW.retirement_reason)) < 1 THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding retirement requires a reason' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status = 'retired' THEN
    IF OLD.retired_at IS DISTINCT FROM NEW.retired_at
       OR OLD.retired_by IS DISTINCT FROM NEW.retired_by
       OR OLD.retirement_reason IS DISTINCT FROM NEW.retirement_reason THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding retirement metadata is immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.status IN ('active','disabled','retired') THEN
    IF OLD.sender_identity_id <> NEW.sender_identity_id
       OR OLD.provider_account_id <> NEW.provider_account_id
       OR OLD.channel_endpoint_id IS DISTINCT FROM NEW.channel_endpoint_id THEN
      RAISE EXCEPTION 'omni_comms_sender_provider_binding identity is immutable after activation'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;