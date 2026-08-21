CREATE TABLE IF NOT EXISTS public.omni_comms_inbound_voice_call (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid text NOT NULL UNIQUE,
  from_number text,
  to_number text,
  step text NOT NULL DEFAULT 'start',
  subject_kind text,
  subject_key text,
  attempts integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  outcome text,
  spoken_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.omni_comms_inbound_voice_call TO authenticated;
GRANT ALL ON public.omni_comms_inbound_voice_call TO service_role;
ALTER TABLE public.omni_comms_inbound_voice_call ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_inbound_voice_call_read ON public.omni_comms_inbound_voice_call;
CREATE POLICY omni_comms_inbound_voice_call_read
  ON public.omni_comms_inbound_voice_call FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_inbound_voice_digits(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_inbound_voice_money(p_value numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT to_char(coalesce(p_value, 0), 'FM999999990.00')
$$;

-- Composes the spoken reply purely from live business data.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_inbound_voice_summary(
  p_subject_kind text,
  p_subject_key text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parts text[] := ARRAY[]::text[];
  v_claim record;
  v_pay record;
  v_arr record;
BEGIN
  IF p_subject_kind = 'person' THEN
    SELECT claim_number, status, coalesce(decision_date, submission_date, claim_date) AS as_of
      INTO v_claim
      FROM public.bn_claim
     WHERE ssn = p_subject_key
     ORDER BY coalesce(decision_date, submission_date, claim_date, entered_at) DESC NULLS LAST
     LIMIT 1;

    IF FOUND THEN
      v_parts := v_parts || format(
        'Your most recent claim, reference %s, is currently %s%s.',
        coalesce(v_claim.claim_number, 'on file'),
        replace(lower(coalesce(v_claim.status, 'in progress')), '_', ' '),
        CASE WHEN v_claim.as_of IS NULL THEN ''
             ELSE ', as at ' || to_char(v_claim.as_of::date, 'DD Month YYYY') END);
    ELSE
      v_parts := v_parts || 'We have no benefit claim on record for you.';
    END IF;

    SELECT ps.net_amount, ps.gross_amount, ps.due_date
      INTO v_pay
      FROM public.bn_payment_schedule ps
      JOIN public.bn_award a ON a.id = ps.bn_award_id
     WHERE a.ssn = p_subject_key
       AND lower(coalesce(ps.status, '')) NOT IN ('paid', 'cancelled')
       AND ps.due_date IS NOT NULL
     ORDER BY ps.due_date
     LIMIT 1;

    IF FOUND THEN
      v_parts := v_parts || format(
        'Your next benefit payment is %s dollars, due on %s.',
        public.omni_comms_priv_inbound_voice_money(coalesce(v_pay.net_amount, v_pay.gross_amount)),
        to_char(v_pay.due_date::date, 'DD Month YYYY'));
    ELSE
      v_parts := v_parts || 'There is no scheduled benefit payment at this time.';
    END IF;

  ELSIF p_subject_kind = 'employer' THEN
    SELECT current_arrears, current_penalty, total_outstanding
      INTO v_arr
      FROM public.ce_v_employer_arrears_summary
     WHERE regno = p_subject_key;

    IF FOUND AND coalesce(v_arr.total_outstanding, 0) > 0 THEN
      v_parts := v_parts || format(
        'Your outstanding contribution arrears are %s dollars, with penalties of %s dollars, giving a total balance of %s dollars.',
        public.omni_comms_priv_inbound_voice_money(v_arr.current_arrears),
        public.omni_comms_priv_inbound_voice_money(v_arr.current_penalty),
        public.omni_comms_priv_inbound_voice_money(v_arr.total_outstanding));
    ELSE
      v_parts := v_parts || 'Our records show no outstanding contribution arrears or penalties.';
    END IF;
  END IF;

  IF array_length(v_parts, 1) IS NULL THEN
    RETURN 'We could not retrieve your information at this time. Please contact the Social Security Board office.';
  END IF;

  RETURN array_to_string(v_parts, ' ');
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_inbound_voice_summary(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_inbound_voice_summary(text, text) TO service_role;

-- One governed step of the inbound call. All identification, verification and
-- attempt limiting happen here; the edge boundary only renders TwiML.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_inbound_voice_step(
  p_call_sid text,
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL,
  p_digits text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_call public.omni_comms_inbound_voice_call;
  v_digits text := public.omni_comms_priv_inbound_voice_digits(p_digits);
  v_from text := public.omni_comms_priv_inbound_voice_digits(p_from);
  v_key text;
  v_dob date;
  v_entered date;
  v_text text;
BEGIN
  IF coalesce(p_call_sid, '') = '' THEN
    RETURN jsonb_build_object('action', 'say_hangup', 'text', 'Sorry, this call cannot be handled.');
  END IF;

  SELECT * INTO v_call FROM public.omni_comms_inbound_voice_call WHERE call_sid = p_call_sid;

  IF NOT FOUND THEN
    -- Identify by calling line first.
    SELECT ssn INTO v_key FROM public.ip_master
     WHERE ssn IS NOT NULL AND length(v_from) >= 7
       AND (right(public.omni_comms_priv_inbound_voice_digits(mobile), 7) = right(v_from, 7)
         OR right(public.omni_comms_priv_inbound_voice_digits(telephone), 7) = right(v_from, 7)
         OR right(public.omni_comms_priv_inbound_voice_digits(phone), 7) = right(v_from, 7))
     ORDER BY updated_at DESC NULLS LAST LIMIT 1;

    IF v_key IS NOT NULL THEN
      INSERT INTO public.omni_comms_inbound_voice_call
        (call_sid, from_number, to_number, step, subject_kind, subject_key)
      VALUES (p_call_sid, p_from, p_to, 'verify', 'person', v_key);
      RETURN jsonb_build_object('action', 'gather', 'digits', 8, 'step', 'verify',
        'text', 'Welcome to Social Security self service. For your security, please key in your date of birth as eight digits, day, month and year.');
    END IF;

    SELECT regno INTO v_key FROM public.er_master
     WHERE regno IS NOT NULL AND length(v_from) >= 7
       AND (right(public.omni_comms_priv_inbound_voice_digits(mobile), 7) = right(v_from, 7)
         OR right(public.omni_comms_priv_inbound_voice_digits(phone), 7) = right(v_from, 7))
     LIMIT 1;

    IF v_key IS NOT NULL THEN
      INSERT INTO public.omni_comms_inbound_voice_call
        (call_sid, from_number, to_number, step, subject_kind, subject_key)
      VALUES (p_call_sid, p_from, p_to, 'verify', 'employer', v_key);
      RETURN jsonb_build_object('action', 'gather', 'digits', 8, 'step', 'verify',
        'text', 'Welcome to Social Security self service. For your security, please key in your date of registration as eight digits, day, month and year.');
    END IF;

    INSERT INTO public.omni_comms_inbound_voice_call
      (call_sid, from_number, to_number, step)
    VALUES (p_call_sid, p_from, p_to, 'menu');
    RETURN jsonb_build_object('action', 'gather', 'digits', 1, 'step', 'menu',
      'text', 'Welcome to Social Security self service. For personal benefit information, press 1. For employer contribution information, press 2.');
  END IF;

  IF v_call.attempts >= 3 THEN
    RETURN jsonb_build_object('action', 'say_hangup',
      'text', 'Sorry, we could not verify your details. Please contact the Social Security Board office. Goodbye.');
  END IF;

  IF v_call.step = 'menu' THEN
    IF v_digits = '1' THEN
      UPDATE public.omni_comms_inbound_voice_call
         SET step = 'identify', subject_kind = 'person', updated_at = now()
       WHERE call_sid = p_call_sid;
      RETURN jsonb_build_object('action', 'gather', 'digits', 6, 'step', 'identify',
        'text', 'Please key in your six digit social security number.');
    ELSIF v_digits = '2' THEN
      UPDATE public.omni_comms_inbound_voice_call
         SET step = 'identify', subject_kind = 'employer', updated_at = now()
       WHERE call_sid = p_call_sid;
      RETURN jsonb_build_object('action', 'gather', 'digits', 6, 'step', 'identify',
        'text', 'Please key in your six digit employer registration number.');
    END IF;
    UPDATE public.omni_comms_inbound_voice_call
       SET attempts = attempts + 1, updated_at = now() WHERE call_sid = p_call_sid;
    RETURN jsonb_build_object('action', 'gather', 'digits', 1, 'step', 'menu',
      'text', 'Sorry, that was not a valid choice. For personal benefit information, press 1. For employer contribution information, press 2.');
  END IF;

  IF v_call.step = 'identify' THEN
    v_key := lpad(v_digits, 6, '0');
    IF v_call.subject_kind = 'person' THEN
      PERFORM 1 FROM public.ip_master WHERE ssn = v_key LIMIT 1;
    ELSE
      PERFORM 1 FROM public.er_master WHERE regno = v_key LIMIT 1;
    END IF;

    IF FOUND THEN
      UPDATE public.omni_comms_inbound_voice_call
         SET step = 'verify', subject_key = v_key, updated_at = now()
       WHERE call_sid = p_call_sid;
      RETURN jsonb_build_object('action', 'gather', 'digits', 8, 'step', 'verify',
        'text', CASE WHEN v_call.subject_kind = 'person'
                     THEN 'Thank you. For your security, please key in your date of birth as eight digits, day, month and year.'
                     ELSE 'Thank you. For your security, please key in your date of registration as eight digits, day, month and year.' END);
    END IF;

    UPDATE public.omni_comms_inbound_voice_call
       SET attempts = attempts + 1, updated_at = now() WHERE call_sid = p_call_sid;
    RETURN jsonb_build_object('action', 'gather', 'digits', 6, 'step', 'identify',
      'text', 'We could not find that number. Please key in your six digit number again.');
  END IF;

  IF v_call.step = 'verify' THEN
    IF length(v_digits) = 8 THEN
      BEGIN
        v_entered := to_date(v_digits, 'DDMMYYYY');
      EXCEPTION WHEN others THEN
        v_entered := NULL;
      END;
    END IF;

    IF v_entered IS NOT NULL THEN
      IF v_call.subject_kind = 'person' THEN
        SELECT dob INTO v_dob FROM public.ip_master WHERE ssn = v_call.subject_key LIMIT 1;
      ELSE
        SELECT registration_date::date INTO v_dob FROM public.er_master WHERE regno = v_call.subject_key LIMIT 1;
      END IF;
    END IF;

    IF v_entered IS NOT NULL AND v_dob IS NOT NULL AND v_dob = v_entered THEN
      v_text := public.omni_comms_priv_inbound_voice_summary(v_call.subject_kind, v_call.subject_key);
      UPDATE public.omni_comms_inbound_voice_call
         SET step = 'completed', verified = true, outcome = 'delivered',
             spoken_text = v_text, updated_at = now()
       WHERE call_sid = p_call_sid;
      RETURN jsonb_build_object('action', 'say_hangup', 'step', 'completed',
        'text', v_text || ' Thank you for calling. Goodbye.');
    END IF;

    UPDATE public.omni_comms_inbound_voice_call
       SET attempts = attempts + 1, outcome = 'verification_failed', updated_at = now()
     WHERE call_sid = p_call_sid;

    IF v_call.attempts + 1 >= 3 THEN
      RETURN jsonb_build_object('action', 'say_hangup', 'step', 'failed',
        'text', 'Sorry, we could not verify your details. Please contact the Social Security Board office. Goodbye.');
    END IF;

    RETURN jsonb_build_object('action', 'gather', 'digits', 8, 'step', 'verify',
      'text', 'That did not match our records. Please key in the date again as eight digits, day, month and year.');
  END IF;

  RETURN jsonb_build_object('action', 'say_hangup', 'step', 'completed',
    'text', 'Thank you for calling. Goodbye.');
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_inbound_voice_step(text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_inbound_voice_step(text, text, text, text) TO service_role;