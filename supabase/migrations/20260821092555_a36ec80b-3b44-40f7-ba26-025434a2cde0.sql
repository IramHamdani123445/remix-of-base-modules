DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_inbound_voice_step_core'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.omni_comms_priv_inbound_voice_step(text, text, text, text) RENAME TO omni_comms_priv_inbound_voice_step_core';
  END IF;
END
$do$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_inbound_voice_step_core(text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_inbound_voice_step_core(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_inbound_voice_step(
  p_call_sid text,
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL,
  p_digits text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_err text;
BEGIN
  RETURN public.omni_comms_priv_inbound_voice_step_core(p_call_sid, p_from, p_to, p_digits);
EXCEPTION WHEN others THEN
  v_err := SQLSTATE || ': ' || SQLERRM;
  BEGIN
    UPDATE public.omni_comms_inbound_voice_call
       SET outcome = 'error', spoken_text = v_err, updated_at = now()
     WHERE call_sid = p_call_sid;
    IF NOT FOUND THEN
      INSERT INTO public.omni_comms_inbound_voice_call
        (call_sid, from_number, to_number, step, outcome, spoken_text)
      VALUES (p_call_sid, p_from, p_to, 'failed', 'error', v_err);
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RETURN jsonb_build_object('action', 'say_hangup', 'step', 'failed',
    'text', 'Sorry, we could not complete your request right now. Please contact the Social Security Board office. Goodbye.');
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_inbound_voice_step(text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_inbound_voice_step(text, text, text, text) TO service_role;