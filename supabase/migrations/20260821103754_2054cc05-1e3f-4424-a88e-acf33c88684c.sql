CREATE OR REPLACE FUNCTION public.omni_comms_priv_inbound_voice_section(
  p_subject_kind text,
  p_subject_key text,
  p_section text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parts text[] := ARRAY[]::text[];
  v_w record;
  v_c integer;
  v_claim record;
  v_pi record;
  v_f record;
  v_p record;
  v_arr record;
BEGIN
  IF p_section = 'summary' THEN
    RETURN public.omni_comms_priv_inbound_voice_summary(p_subject_kind, p_subject_key);
  END IF;

  IF p_subject_kind = 'person' THEN
    IF p_section = 'contribution' THEN
      SELECT w.period, w.total_wages, w.ip_ss_amt, e.name AS employer_name
        INTO v_w
        FROM public.ip_wages w
        LEFT JOIN public.er_master e ON e.regno = w.payer_id
       WHERE w.ssn = p_subject_key
       ORDER BY w.period DESC NULLS LAST, coalesce(w.date_modified, w.date_entered) DESC NULLS LAST
       LIMIT 1;

      IF FOUND THEN
        v_parts := array_append(v_parts, format(
          'Your most recent contribution record is for the period %s%s. Wages reported were %s dollars and your employee contribution was %s dollars.',
          coalesce(to_char(v_w.period::date, 'FMMonth YYYY'), 'on file'),
          CASE WHEN v_w.employer_name IS NULL THEN '' ELSE ', reported by ' || v_w.employer_name END,
          public.omni_comms_priv_inbound_voice_money(v_w.total_wages),
          public.omni_comms_priv_inbound_voice_money(v_w.ip_ss_amt))::text);

        SELECT count(*) INTO v_c
          FROM public.ip_wages w
         WHERE w.ssn = p_subject_key
           AND w.period >= (current_date - interval '12 months');
        v_parts := array_append(v_parts, format(
          'In the last twelve months we have %s contribution %s recorded for you.',
          coalesce(v_c, 0),
          CASE WHEN coalesce(v_c, 0) = 1 THEN 'period' ELSE 'periods' END)::text);
      ELSE
        v_parts := array_append(v_parts, 'We have no contribution records on file for you.'::text);
      END IF;

    ELSIF p_section = 'status' THEN
      SELECT claim_number, status, coalesce(decision_date, submission_date, claim_date) AS as_of
        INTO v_claim
        FROM public.bn_claim
       WHERE ssn = p_subject_key
       ORDER BY coalesce(decision_date, submission_date, claim_date, entered_at) DESC NULLS LAST
       LIMIT 1;

      IF FOUND THEN
        v_parts := array_append(v_parts, format(
          'Your latest claim, reference %s, is currently %s%s.',
          coalesce(v_claim.claim_number, 'on file'),
          replace(lower(coalesce(v_claim.status, 'in progress')), '_', ' '),
          CASE WHEN v_claim.as_of IS NULL THEN ''
               ELSE ', as at ' || to_char(v_claim.as_of::date, 'FMDD FMMonth YYYY') END)::text);
      ELSE
        v_parts := array_append(v_parts, 'We have no benefit claim on record for you.'::text);
      END IF;

      SELECT amount, status, coalesce(paid_date, due_date) AS as_of
        INTO v_pi
        FROM public.bn_payment_instruction
       WHERE ssn = p_subject_key
       ORDER BY coalesce(paid_date, due_date, created_at) DESC NULLS LAST
       LIMIT 1;

      IF FOUND THEN
        v_parts := array_append(v_parts, format(
          'Your most recent payment of %s dollars is %s%s.',
          public.omni_comms_priv_inbound_voice_money(v_pi.amount),
          replace(lower(coalesce(v_pi.status, 'in progress')), '_', ' '),
          CASE WHEN v_pi.as_of IS NULL THEN ''
               ELSE ', dated ' || to_char(v_pi.as_of::date, 'FMDD FMMonth YYYY') END)::text);
      ELSE
        v_parts := array_append(v_parts, 'We have no benefit payment on record for you.'::text);
      END IF;
    END IF;

  ELSIF p_subject_kind = 'employer' THEN
    IF p_section = 'contribution' THEN
      SELECT last_filing_period, last_filing_date, is_current, missed_filings_12m, total_filings_12m
        INTO v_f
        FROM public.ce_v_employer_filing_status
       WHERE regno = p_subject_key;

      IF FOUND AND v_f.last_filing_period IS NOT NULL THEN
        v_parts := array_append(v_parts, format(
          'Your last contribution submission was for the period %s%s.',
          to_char(v_f.last_filing_period::date, 'FMMonth YYYY'),
          CASE WHEN v_f.last_filing_date IS NULL THEN ''
               ELSE ', filed on ' || to_char(v_f.last_filing_date::date, 'FMDD FMMonth YYYY') END)::text);
        v_parts := array_append(v_parts, format(
          'You have %s submissions in the last twelve months and %s missed. Your filings are %s.',
          coalesce(v_f.total_filings_12m, 0),
          coalesce(v_f.missed_filings_12m, 0),
          CASE WHEN coalesce(v_f.is_current, false) THEN 'up to date' ELSE 'not up to date' END)::text);
      ELSE
        v_parts := array_append(v_parts, 'We have no contribution submission on record for your registration.'::text);
      END IF;

    ELSIF p_section = 'status' THEN
      SELECT last_payment_date, last_payment_period, total_payments_12m, total_amount_12m
        INTO v_p
        FROM public.ce_v_employer_payment_status
       WHERE regno = p_subject_key;

      IF FOUND AND v_p.last_payment_date IS NOT NULL THEN
        v_parts := array_append(v_parts, format(
          'Your last payment was received on %s%s.',
          to_char(v_p.last_payment_date::date, 'FMDD FMMonth YYYY'),
          CASE WHEN v_p.last_payment_period IS NULL THEN ''
               ELSE ', for the period ' || to_char(v_p.last_payment_period::date, 'FMMonth YYYY') END)::text);
        v_parts := array_append(v_parts, format(
          'Over the last twelve months you have made %s payments totalling %s dollars.',
          coalesce(v_p.total_payments_12m, 0),
          public.omni_comms_priv_inbound_voice_money(v_p.total_amount_12m))::text);
      ELSE
        v_parts := array_append(v_parts, 'We have no payment on record for your registration.'::text);
      END IF;

      SELECT total_outstanding INTO v_arr
        FROM public.ce_v_employer_arrears_summary
       WHERE regno = p_subject_key;

      IF FOUND AND coalesce(v_arr.total_outstanding, 0) > 0 THEN
        v_parts := array_append(v_parts, format(
          'Your current outstanding balance is %s dollars.',
          public.omni_comms_priv_inbound_voice_money(v_arr.total_outstanding))::text);
      ELSE
        v_parts := array_append(v_parts, 'You have no outstanding balance at this time.'::text);
      END IF;
    END IF;
  END IF;

  IF array_length(v_parts, 1) IS NULL THEN
    RETURN 'We could not retrieve that information at this time. Please contact the Social Security Board office.';
  END IF;

  RETURN array_to_string(v_parts, ' ');
EXCEPTION WHEN others THEN
  RETURN 'We could not retrieve that information at this time. Please contact the Social Security Board office.';
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_inbound_voice_section(text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_inbound_voice_section(text, text, text) TO service_role;
