
-- Canonical non-blocking (terminal) arrangement statuses
CREATE OR REPLACE FUNCTION public.ce_arrangement_terminal_statuses()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['COMPLETED','CANCELLED','SUPERSEDED','CLOSED','REJECTED','WITHDRAWN']::text[]
$$;

-- Blocking arrangement lookup (used by UI and by the guard)
CREATE OR REPLACE FUNCTION public.ce_arrangement_blocking_lookup(p_employer_id text)
RETURNS TABLE(id uuid, arrangement_number text, status text, case_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.arrangement_number::text, a.status::text, a.case_id
  FROM public.ce_payment_arrangements a
  WHERE a.employer_id = p_employer_id
    AND upper(a.status::text) <> ALL (public.ce_arrangement_terminal_statuses())
  ORDER BY a.created_at DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.ce_arrangement_blocking_lookup(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_arrangement_terminal_statuses() TO authenticated, service_role;

-- Guard: compliance arrangements
CREATE OR REPLACE FUNCTION public.ce_enforce_single_open_arrangement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_existing record;
BEGIN
  IF NEW.employer_id IS NULL THEN RETURN NEW; END IF;
  IF upper(coalesce(NEW.status::text,'')) = ANY (public.ce_arrangement_terminal_statuses()) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ce_arrangement:' || NEW.employer_id));

  SELECT a.id, a.arrangement_number, a.status INTO v_existing
  FROM public.ce_payment_arrangements a
  WHERE a.employer_id = NEW.employer_id
    AND a.id <> NEW.id
    AND upper(a.status::text) <> ALL (public.ce_arrangement_terminal_statuses())
  ORDER BY a.created_at
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CE409 concurrent_arrangement_blocked: employer % already has a non-completed payment arrangement (% / %).',
      NEW.employer_id, v_existing.arrangement_number, v_existing.status
      USING ERRCODE = '23505',
            DETAIL = v_existing.id::text,
            HINT = 'Complete, cancel or supersede the existing arrangement before creating a new one.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_single_open_arrangement ON public.ce_payment_arrangements;
CREATE TRIGGER trg_ce_single_open_arrangement
BEFORE INSERT ON public.ce_payment_arrangements
FOR EACH ROW EXECUTE FUNCTION public.ce_enforce_single_open_arrangement();

-- Guard: canonical core arrangements (supersede flows exempt)
CREATE OR REPLACE FUNCTION public.core_enforce_single_open_arrangement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_existing record;
BEGIN
  IF NEW.debtor_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.superseded_from_arrangement_id IS NOT NULL THEN RETURN NEW; END IF;
  IF upper(coalesce(NEW.status::text,'')) = ANY (public.ce_arrangement_terminal_statuses()) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('core_arrangement:' || coalesce(NEW.debtor_type::text,'EMPLOYER') || ':' || NEW.debtor_id));

  SELECT a.id, a.arrangement_no, a.status INTO v_existing
  FROM public.core_payment_arrangement a
  WHERE a.debtor_id = NEW.debtor_id
    AND coalesce(a.debtor_type::text,'EMPLOYER') = coalesce(NEW.debtor_type::text,'EMPLOYER')
    AND a.id <> NEW.id
    AND upper(a.status::text) <> ALL (public.ce_arrangement_terminal_statuses())
  ORDER BY a.created_at
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CE409 concurrent_arrangement_blocked: debtor % already has a non-completed payment arrangement (% / %).',
      NEW.debtor_id, v_existing.arrangement_no, v_existing.status
      USING ERRCODE = '23505',
            DETAIL = v_existing.id::text,
            HINT = 'Complete, cancel or supersede the existing arrangement before creating a new one.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_core_single_open_arrangement ON public.core_payment_arrangement;
CREATE TRIGGER trg_core_single_open_arrangement
BEFORE INSERT ON public.core_payment_arrangement
FOR EACH ROW EXECUTE FUNCTION public.core_enforce_single_open_arrangement();
