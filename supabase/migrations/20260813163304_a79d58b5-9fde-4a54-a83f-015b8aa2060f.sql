CREATE OR REPLACE FUNCTION public.omni_comms_priv_live_delivery_cancel_request(
  p_actor uuid, p_organization_id uuid, p_department_id uuid,
  p_channel text, p_correlation_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rel public.omni_comms_channel_release_control;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'OC401 authentication_required'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor, p_organization_id, p_department_id);
  IF NOT public.has_permission(p_actor, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING DETAIL='operate';
  END IF;

  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control r
   WHERE r.id = (public.omni_comms_priv_channel_release_effective(
                   p_organization_id, p_department_id, p_channel)).id
   FOR UPDATE;
  IF v_rel.id IS NULL THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'release_control_missing');
  END IF;
  IF v_rel.proposed_state IS NULL THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'no_pending_request',
      'release_state', v_rel.release_state);
  END IF;

  UPDATE public.omni_comms_channel_release_control SET
    proposed_state = NULL, proposal_reason = NULL, proposed_by = NULL,
    proposed_at = NULL, proposal_expires_at = NULL,
    release_version = release_version + 1,
    updated_by = p_actor
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_withdrawn', v_rel.release_state, v_rel.release_state,
    public.omni_comms_priv_normalize_reason(
      'Operator withdrew the request for automatic delivery.', true),
    p_actor, p_correlation_id, NULL, '{}'::jsonb);

  RETURN jsonb_build_object('cancelled', true, 'release_state', v_rel.release_state);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_live_delivery_cancel_request(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_live_delivery_cancel_request(uuid,uuid,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_live_delivery_cancel_request(uuid,uuid,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_live_delivery_cancel_request(uuid,uuid,uuid,text,text) TO service_role;