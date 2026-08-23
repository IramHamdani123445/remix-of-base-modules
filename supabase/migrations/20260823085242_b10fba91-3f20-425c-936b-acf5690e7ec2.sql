-- 1. Violation amount consistency: total must always equal principal + penalty + interest
CREATE OR REPLACE FUNCTION public.fn_ce_violation_amount_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sum numeric;
BEGIN
  v_sum := round(coalesce(NEW.principal_amount,0) + coalesce(NEW.penalty_amount,0) + coalesce(NEW.interest_amount,0), 2);
  IF NEW.total_amount IS NULL
     OR (v_sum > 0 AND abs(coalesce(NEW.total_amount,0) - v_sum) > 0.001)
     OR (v_sum = 0 AND coalesce(NEW.total_amount,0) = 0) THEN
    NEW.total_amount := v_sum;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_violation_amount_consistency ON public.ce_violations;
CREATE TRIGGER trg_ce_violation_amount_consistency
BEFORE INSERT OR UPDATE OF principal_amount, penalty_amount, interest_amount, total_amount
ON public.ce_violations
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_violation_amount_consistency();

-- 2. Case financial roll-up from linked violations (only for cases that have linked violations)
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
  SELECT count(*), coalesce(sum(principal_amount),0), coalesce(sum(penalty_amount),0),
         coalesce(sum(interest_amount),0), coalesce(sum(total_amount),0)
    INTO v_n, v_p, v_pen, v_int, v_tot
  FROM public.ce_violations
  WHERE case_id = p_case_id AND coalesce(is_deleted,false) = false;

  IF v_n = 0 THEN RETURN; END IF;

  UPDATE public.ce_cases
     SET total_principal = v_p,
         total_penalties = round(v_pen + v_int, 2),
         total_amount    = v_tot,
         updated_at      = now()
   WHERE id = p_case_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ce_recalc_case_financials(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ce_violation_case_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.case_id IS NOT NULL AND OLD.case_id IS DISTINCT FROM NEW.case_id THEN
    PERFORM public.fn_ce_recalc_case_financials(OLD.case_id);
  END IF;
  IF NEW.case_id IS NOT NULL THEN
    PERFORM public.fn_ce_recalc_case_financials(NEW.case_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_violation_case_rollup ON public.ce_violations;
CREATE TRIGGER trg_ce_violation_case_rollup
AFTER INSERT OR UPDATE OF case_id, principal_amount, penalty_amount, interest_amount, total_amount, is_deleted
ON public.ce_violations
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_violation_case_rollup();

-- 3. Unassigned / triage visibility: authoritative operational ownership view
CREATE OR REPLACE VIEW public.ce_v_violation_ownership AS
SELECT
  v.id,
  v.violation_number,
  v.employer_id,
  v.employer_name,
  v.status,
  v.priority,
  v.total_amount,
  v.zone_id,
  z.zone_code,
  v.assigned_queue_id,
  q.queue_code,
  q.queue_type,
  v.assigned_to_user_id,
  v.assigned_to_name,
  v.assignment_method,
  v.assigned_at,
  v.created_at,
  CASE
    WHEN v.status IN ('RESOLVED','CLOSED','CANCELLED') THEN 'CLOSED'
    WHEN v.assigned_to_user_id IS NOT NULL THEN 'OFFICER'
    WHEN v.assigned_queue_id IS NOT NULL THEN 'QUEUE'
    ELSE 'UNASSIGNED'
  END AS ownership_state
FROM public.ce_violations v
LEFT JOIN public.ce_zones z ON z.id = v.zone_id
LEFT JOIN public.ce_assignment_queues q ON q.id = v.assigned_queue_id
WHERE coalesce(v.is_deleted,false) = false;

GRANT SELECT ON public.ce_v_violation_ownership TO authenticated, anon, service_role;