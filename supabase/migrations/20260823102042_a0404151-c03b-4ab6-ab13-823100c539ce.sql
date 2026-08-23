CREATE OR REPLACE FUNCTION public.fn_ce_recalc_case_financials(p_case_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
  v_p numeric; v_pen numeric; v_int numeric; v_tot numeric;
BEGIN
  IF p_case_id IS NULL THEN RETURN; END IF;

  -- Population must match ce_v_violation_financials: a violation belongs to a
  -- case either through ce_violations.case_id or through the ce_case_violations
  -- junction. Summing only the direct column left junction-linked money off the
  -- case roll-up and made list, detail and exposure figures disagree.
  SELECT count(*),
         coalesce(sum(coalesce(v.principal_amount,0)),0),
         coalesce(sum(coalesce(v.penalty_amount,0)),0),
         coalesce(sum(coalesce(v.interest_amount,0)),0),
         coalesce(sum(coalesce(v.total_amount,
                               coalesce(v.principal_amount,0)
                             + coalesce(v.penalty_amount,0)
                             + coalesce(v.interest_amount,0))),0)
    INTO v_n, v_p, v_pen, v_int, v_tot
  FROM public.ce_violations v
  WHERE coalesce(v.is_deleted,false) = false
    AND (v.case_id = p_case_id
         OR EXISTS (SELECT 1 FROM public.ce_case_violations cv
                     WHERE cv.violation_id = v.id AND cv.case_id = p_case_id));

  IF v_n = 0 THEN RETURN; END IF;

  UPDATE public.ce_cases
     SET total_principal = round(v_p, 2),
         total_penalties = round(v_pen, 2),
         total_interest  = round(v_int, 2),
         total_amount    = round(v_tot, 2),
         updated_at      = now()
   WHERE id = p_case_id;
END;
$$;

-- Junction changes must also refresh the owning case roll-up.
CREATE OR REPLACE FUNCTION public.fn_ce_case_violation_link_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.case_id IS NOT NULL THEN
    PERFORM public.fn_ce_recalc_case_financials(OLD.case_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.case_id IS NOT NULL THEN
    PERFORM public.fn_ce_recalc_case_financials(NEW.case_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_case_violation_link_rollup ON public.ce_case_violations;
CREATE TRIGGER trg_ce_case_violation_link_rollup
AFTER INSERT OR UPDATE OR DELETE ON public.ce_case_violations
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_case_violation_link_rollup();

-- Normalise every existing case that has linked violations.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT c.id
    FROM public.ce_cases c
    WHERE coalesce(c.is_deleted,false) = false
      AND (EXISTS (SELECT 1 FROM public.ce_violations v WHERE v.case_id = c.id AND coalesce(v.is_deleted,false)=false)
        OR EXISTS (SELECT 1 FROM public.ce_case_violations cv
                     JOIN public.ce_violations v2 ON v2.id = cv.violation_id AND coalesce(v2.is_deleted,false)=false
                    WHERE cv.case_id = c.id))
  LOOP
    PERFORM public.fn_ce_recalc_case_financials(r.id);
  END LOOP;
END $$;