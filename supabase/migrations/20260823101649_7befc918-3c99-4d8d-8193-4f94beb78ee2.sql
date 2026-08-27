CREATE OR REPLACE FUNCTION public.fn_ce_violation_status_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
  v_old text := upper(coalesce(OLD.status, ''));
  v_new text := upper(coalesce(NEW.status, ''));
BEGIN
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE v_old
    WHEN 'OPEN'         THEN ARRAY['IN_PROGRESS','UNDER_REVIEW','ESCALATED','RESOLVED','CANCELLED']
    WHEN 'IN_PROGRESS'  THEN ARRAY['UNDER_REVIEW','ESCALATED','RESOLVED','CANCELLED']
    WHEN 'UNDER_REVIEW' THEN ARRAY['IN_PROGRESS','ESCALATED','RESOLVED','CANCELLED']
    WHEN 'ESCALATED'    THEN ARRAY['UNDER_REVIEW','RESOLVED','CANCELLED']
    WHEN 'RESOLVED'     THEN ARRAY['CLOSED','OPEN']
    WHEN 'CLOSED'       THEN ARRAY['OPEN']
    WHEN 'CANCELLED'    THEN ARRAY['OPEN']
    ELSE NULL
  END;

  IF v_allowed IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (v_new = ANY (v_allowed)) THEN
    RAISE EXCEPTION
      'Forbidden violation status transition % -> % (allowed from %: %)',
      v_old, v_new, v_old, array_to_string(v_allowed, ', ')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_violation_status_transition_guard ON public.ce_violations;
CREATE TRIGGER trg_ce_violation_status_transition_guard
BEFORE UPDATE OF status ON public.ce_violations
FOR EACH ROW
EXECUTE FUNCTION public.fn_ce_violation_status_transition_guard();