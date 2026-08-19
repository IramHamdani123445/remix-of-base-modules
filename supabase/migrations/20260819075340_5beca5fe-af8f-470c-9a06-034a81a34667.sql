INSERT INTO public.omni_comms_runtime_endpoint (endpoint_key, endpoint_url, description)
VALUES
  ('twilio_voice_status_callback',
   'https://xynceskeiiisiefqlgxo.supabase.co/functions/v1/omni-comms-webhook-twilio-voice-status',
   'Server-derived Twilio Voice StatusCallback endpoint. Never supplied by a caller.'),
  ('twilio_voice_ivr_action',
   'https://xynceskeiiisiefqlgxo.supabase.co/functions/v1/omni-comms-webhook-twilio-voice-ivr',
   'Server-derived Twilio Voice <Gather action> endpoint. Never supplied by a caller.')
ON CONFLICT (endpoint_key) DO UPDATE
  SET endpoint_url = EXCLUDED.endpoint_url,
      description = EXCLUDED.description,
      updated_at = now();

DO $do$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_generic';
  IF v_src IS NULL THEN RAISE EXCEPTION 'generic claim missing'; END IF;

  IF position('v_ivr_action text;' in v_src) = 0 THEN
    v_src := replace(v_src, '  v_callback text;', '  v_callback text;' || chr(10) || '  v_ivr_action text;');
  END IF;

  v_src := regexp_replace(
    v_src,
    'SELECT\s+endpoint_url\s+INTO\s+v_callback\s+FROM\s+public\.omni_comms_runtime_endpoint\s+WHERE\s+endpoint_key\s*=\s*''twilio_status_callback''\s*;',
    'SELECT endpoint_url INTO v_callback FROM public.omni_comms_runtime_endpoint'
    || chr(10) || '     WHERE endpoint_key = CASE WHEN v_channel = ''voice'' THEN ''twilio_voice_status_callback'' ELSE ''twilio_status_callback'' END;'
    || chr(10) || '  SELECT endpoint_url INTO v_ivr_action FROM public.omni_comms_runtime_endpoint WHERE endpoint_key = ''twilio_voice_ivr_action'';',
    'g');

  IF position('''ivr_action_url''' in v_src) = 0 THEN
    v_src := regexp_replace(
      v_src,
      '''status_callback_url'',\s*v_callback\)',
      '''status_callback_url'', v_callback, ''ivr_action_url'', v_ivr_action)',
      'g');
  END IF;

  IF position('twilio_voice_status_callback' in v_src) = 0
     OR position('''ivr_action_url''' in v_src) = 0 THEN
    RAISE EXCEPTION 'voice callback wiring could not be applied';
  END IF;

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_claim_generic(
      p_channel text, p_batch_limit integer, p_worker text, p_correlation_id text,
      p_execution_context text, p_deployed_revision text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L
  $f$, v_src);
END
$do$;