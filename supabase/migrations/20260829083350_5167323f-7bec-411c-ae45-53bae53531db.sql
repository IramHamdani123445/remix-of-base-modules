CREATE OR REPLACE FUNCTION public.ce_partial_payment_posting_guard_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_period date;
  v_liability numeric;
  v_already numeric;
  v_total numeric;
  v_auth public.ce_partial_payment_requests;
  v_auth_used numeric;
BEGIN
  IF NOT public.ce_feature_flag_enabled('compliance.payment.partial_payment') THEN
    RETURN NEW;
  END IF;

  -- Contribution-liability postings only. Arrangement instalments are
  -- governed by the payment arrangement rules, not by DR-004.
  IF coalesce(NEW.target_type,'') NOT IN ('dues','penalty','interest') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_period := to_date(nullif(NEW.target_period,''),'YYYY-MM');
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF v_period IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce((public.ce_pp_liability(NEW.employer_id, v_period)->>'total_outstanding')::numeric,0)
    INTO v_liability;
  IF v_liability <= 0 THEN
    RETURN NEW;
  END IF;

  -- A payment may be split across dues / penalty / interest rows: judge the
  -- period as a whole so a genuine full settlement is never treated as partial.
  SELECT coalesce(sum(allocated_amount),0) INTO v_already
  FROM public.ce_payment_allocations
  WHERE employer_id = NEW.employer_id
    AND target_period = NEW.target_period
    AND target_type IN ('dues','penalty','interest')
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  v_total := round(v_already + coalesce(NEW.allocated_amount,0), 2);
  IF v_total >= round(v_liability, 2) THEN
    RETURN NEW; -- full settlement of the period
  END IF;

  v_auth := public.ce_partial_payment_authority_for(NEW.employer_id, v_period);
  IF v_auth.id IS NULL THEN
    RAISE EXCEPTION 'CE-PP-403: a partial payment for % period % requires an approved payment authority',
      NEW.employer_id, to_char(v_period,'YYYY-MM') USING ERRCODE='42501';
  END IF;

  v_auth_used := round(coalesce(v_auth.approved_amount,0), 2);
  IF v_total > v_auth_used THEN
    RAISE EXCEPTION 'CE-PP-422: allocations of % for period % exceed the approved payment authority % (%)',
      v_total, to_char(v_period,'YYYY-MM'), v_auth.authority_number, v_auth_used
      USING ERRCODE='22023';
  END IF;

  NEW.notes := coalesce(NEW.notes,'') ||
    CASE WHEN coalesce(NEW.notes,'') = '' THEN '' ELSE ' | ' END ||
    'Authority ' || coalesce(v_auth.authority_number,'');
  RETURN NEW;
END $function$;