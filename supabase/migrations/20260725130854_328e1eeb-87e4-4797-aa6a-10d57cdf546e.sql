
CREATE OR REPLACE FUNCTION public.get_controlled_live_certification(p_certification_id uuid)
 RETURNS SETOF communication_controlled_live_certification
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  v_is_admin := public.is_comm_hub_admin(v_uid);
  RETURN QUERY
  SELECT c.* FROM public.communication_controlled_live_certification c
    LEFT JOIN public.communication_controlled_live_execution e ON e.id = c.execution_id
   WHERE c.id = p_certification_id
     AND (v_is_admin OR e.requested_by = v_uid);
END; $function$;

CREATE OR REPLACE FUNCTION public.record_controlled_live_manual_verification(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cert_id UUID := (p_payload->>'certification_id')::uuid;
  v_received BOOLEAN := (p_payload->>'received')::boolean;
  v_recipient TEXT := lower(trim(p_payload->>'verified_recipient'));
  v_note TEXT := p_payload->>'note';
  v_received_at TIMESTAMPTZ := COALESCE(NULLIF(p_payload->>'received_at','')::timestamptz, now());
  v_uid UUID := auth.uid();
  v_row public.communication_controlled_live_certification%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN
    RAISE EXCEPTION 'admin role required for manual controlled-live verification';
  END IF;
  IF v_cert_id IS NULL THEN RAISE EXCEPTION 'certification_id required'; END IF;

  SELECT * INTO v_row FROM public.communication_controlled_live_certification
   WHERE id = v_cert_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'certification not found'; END IF;

  IF v_row.status <> 'PROVIDER_ACCEPTED' THEN
    RAISE EXCEPTION 'manual verification only permitted while status = PROVIDER_ACCEPTED (current: %)', v_row.status;
  END IF;

  IF v_row.provider_name IS NULL OR v_row.provider_name = 'stub' THEN
    RAISE EXCEPTION 'manual inbox verification is not applicable to a controlled-stub simulation';
  END IF;

  IF v_received IS TRUE AND (v_recipient IS NULL OR length(v_recipient) = 0) THEN
    RAISE EXCEPTION 'verified_recipient required when received = true';
  END IF;

  UPDATE public.communication_controlled_live_certification
     SET manual_verification_status = CASE WHEN v_received THEN 'CONFIRMED' ELSE 'NOT_RECEIVED' END,
         manual_verification_received_at = CASE WHEN v_received THEN v_received_at ELSE NULL END,
         manual_verification_recipient = CASE WHEN v_received THEN v_recipient ELSE NULL END,
         manual_verification_note = v_note,
         manual_verified_by = v_uid,
         manual_verified_at = now(),
         status = CASE WHEN v_received THEN 'DELIVERY_CONFIRMED_MANUALLY' ELSE status END
   WHERE id = v_cert_id
   RETURNING * INTO v_row;

  BEGIN
    INSERT INTO public.communication_hub_control_audit (action, actor_id, reason, payload)
    VALUES (
      'controlled_live_manual_verification', v_uid,
      COALESCE(v_note,'manual inbox verification'),
      jsonb_build_object(
        'certification_id', v_row.id, 'execution_id', v_row.execution_id,
        'received', v_received, 'verified_recipient', v_recipient,
        'received_at', v_received_at)
    );
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

  RETURN jsonb_build_object('ok', true,
    'certification_id', v_row.id, 'status', v_row.status,
    'manual_verification_status', v_row.manual_verification_status,
    'manual_verified_at', v_row.manual_verified_at);
END; $function$;
