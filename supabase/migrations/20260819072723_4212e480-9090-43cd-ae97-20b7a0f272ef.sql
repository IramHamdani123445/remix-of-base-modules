CREATE TABLE IF NOT EXISTS public.omni_comms_voice_ivr_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  message_id uuid,
  delivery_attempt_id uuid,
  provider_call_sid text NOT NULL,
  template_version_id uuid,
  digit text,
  semantic_result text NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  signature_verified boolean NOT NULL DEFAULT true,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_voice_ivr_result_identity UNIQUE (provider_call_sid, attempt_number)
);

GRANT ALL ON public.omni_comms_voice_ivr_result TO service_role;
ALTER TABLE public.omni_comms_voice_ivr_result ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_voice_ivr_record(
  p_provider_call_sid text,
  p_digits text,
  p_signature_verified boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att public.omni_comms_delivery_attempt;
  v_matches integer := 0;
  v_tv uuid;
  v_map jsonb;
  v_digit text := btrim(coalesce(p_digits,''));
  v_semantic text;
  v_attempt integer;
  v_id uuid;
BEGIN
  IF p_signature_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'OC401 signature_required' USING ERRCODE='P0001';
  END IF;
  IF btrim(coalesce(p_provider_call_sid,'')) = '' THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'call_reference_missing');
  END IF;
  IF v_digit !~ '^[0-9*#]$' THEN
    v_digit := NULL;
  END IF;

  SELECT count(*) INTO v_matches FROM public.omni_comms_delivery_attempt a
   WHERE a.provider_message_id = p_provider_call_sid;
  IF v_matches = 1 THEN
    SELECT * INTO v_att FROM public.omni_comms_delivery_attempt a
     WHERE a.provider_message_id = p_provider_call_sid;
    SELECT m.template_version_id INTO v_tv
      FROM public.omni_comms_message m WHERE m.id = v_att.message_id;
    SELECT tv.content -> 'gather_map' INTO v_map
      FROM public.omni_comms_template_version tv WHERE tv.id = v_tv;
  END IF;

  IF v_digit IS NULL THEN
    v_semantic := 'no_response';
  ELSE
    v_semantic := nullif(btrim(coalesce(v_map ->> v_digit, '')), '');
    IF v_semantic IS NULL THEN
      v_semantic := 'unmapped_response';
    END IF;
  END IF;

  SELECT coalesce(max(r.attempt_number), 0) + 1 INTO v_attempt
    FROM public.omni_comms_voice_ivr_result r
   WHERE r.provider_call_sid = p_provider_call_sid;

  INSERT INTO public.omni_comms_voice_ivr_result (
    organization_id, message_id, delivery_attempt_id, provider_call_sid,
    template_version_id, digit, semantic_result, attempt_number, signature_verified)
  VALUES (v_att.organization_id, v_att.message_id, v_att.id, p_provider_call_sid,
    v_tv, v_digit, v_semantic, v_attempt, true)
  ON CONFLICT (provider_call_sid, attempt_number) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'code', 'duplicate_response');
  END IF;

  IF v_att.id IS NOT NULL THEN
    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      status_before, status_after, safe_metadata, correlation_id, actor_type, actor_id)
    SELECT j.request_id, v_att.message_id, v_att.organization_id, 'callback_ivr_response',
           public.omni_comms_priv_next_event_sequence(j.request_id),
           NULL, NULL,
           jsonb_build_object('channel','voice','semantic_result', v_semantic,
                              'attempt_number', v_attempt),
           j.correlation_id, 'system', 'omni-comms-webhook-twilio-voice-ivr'
      FROM public.omni_comms_dispatch_job j WHERE j.id = v_att.dispatch_job_id;
  END IF;

  RETURN jsonb_build_object('recorded', true, 'code', 'ivr_response_recorded',
                            'semantic_result', v_semantic,
                            'scope', CASE WHEN v_att.id IS NULL THEN 'unmatched' ELSE 'business' END);
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_voice_ivr_record(text,text,boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_voice_ivr_record(text,text,boolean) TO service_role;