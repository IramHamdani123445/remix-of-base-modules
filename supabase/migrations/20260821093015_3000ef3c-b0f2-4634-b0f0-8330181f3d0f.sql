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
      v_parts := array_append(v_parts, format(
        'Your most recent claim, reference %s, is currently %s%s.',
        coalesce(v_claim.claim_number, 'on file'),
        replace(lower(coalesce(v_claim.status, 'in progress')), '_', ' '),
        CASE WHEN v_claim.as_of IS NULL THEN ''
             ELSE ', as at ' || to_char(v_claim.as_of::date, 'FMDD FMMonth YYYY') END));
    ELSE
      v_parts := array_append(v_parts, 'We have no benefit claim on record for you.'::text);
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
      v_parts := array_append(v_parts, format(
        'Your next benefit payment is %s dollars, due on %s.',
        public.omni_comms_priv_inbound_voice_money(coalesce(v_pay.net_amount, v_pay.gross_amount)),
        to_char(v_pay.due_date::date, 'FMDD FMMonth YYYY')));
    ELSE
      v_parts := array_append(v_parts, 'There is no scheduled benefit payment at this time.'::text);
    END IF;

  ELSIF p_subject_kind = 'employer' THEN
    SELECT current_arrears, current_penalty, total_outstanding
      INTO v_arr
      FROM public.ce_v_employer_arrears_summary
     WHERE regno = p_subject_key;

    IF FOUND AND coalesce(v_arr.total_outstanding, 0) > 0 THEN
      v_parts := array_append(v_parts, format(
        'Your outstanding contribution arrears are %s dollars, with penalties of %s dollars, giving a total balance of %s dollars.',
        public.omni_comms_priv_inbound_voice_money(v_arr.current_arrears),
        public.omni_comms_priv_inbound_voice_money(v_arr.current_penalty),
        public.omni_comms_priv_inbound_voice_money(v_arr.total_outstanding)));
    ELSE
      v_parts := array_append(v_parts, 'Our records show no outstanding contribution arrears or penalties.'::text);
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