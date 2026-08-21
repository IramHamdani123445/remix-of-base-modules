-- =====================================================================
-- BUG-14 — governed calculation boundary repair
--   * guards run as SECURITY DEFINER so the boundary check is evaluated
--   * boundary signal becomes an unforgeable per-transaction token
--   * internal helpers stay revoked from PUBLIC / anon / authenticated
-- =====================================================================

-- 1. Internal boundary secret (never readable by client roles) ---------
CREATE TABLE IF NOT EXISTS public.bn_calc_boundary_secret (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  secret text NOT NULL DEFAULT (gen_random_uuid()::text || gen_random_uuid()::text),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bn_calc_boundary_secret (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE public.bn_calc_boundary_secret FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.bn_calc_boundary_secret TO service_role;

-- 2. Token-based boundary helpers --------------------------------------
CREATE OR REPLACE FUNCTION public._bn_calc_boundary_token()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(s.secret || ':' || txid_current()::text || ':bn_calc_boundary')
  FROM public.bn_calc_boundary_secret s WHERE s.id;
$$;

CREATE OR REPLACE FUNCTION public._bn_calc_boundary_enter()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('bn.calc_boundary', public._bn_calc_boundary_token(), true);
END;
$$;

CREATE OR REPLACE FUNCTION public._bn_calc_in_boundary()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current text := coalesce(current_setting('bn.calc_boundary', true), '');
BEGIN
  IF v_current = '' THEN RETURN false; END IF;
  RETURN v_current = public._bn_calc_boundary_token();
END;
$$;

-- 3. Guards must run with owner privileges so the check can execute ----
CREATE OR REPLACE FUNCTION public._bn_calc_guard_formula_version()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._bn_calc_in_boundary() THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF upper(OLD.governance_status) <> 'DRAFT' THEN
      RAISE EXCEPTION 'BN_CALC_IMMUTABLE_FORMULA_VERSION: cannot delete % version %',
        OLD.governance_status, OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF upper(OLD.governance_status) <> 'DRAFT'
     AND (NEW.expression IS DISTINCT FROM OLD.expression
       OR NEW.steps_json IS DISTINCT FROM OLD.steps_json
       OR NEW.expression_type IS DISTINCT FROM OLD.expression_type
       OR NEW.output_variable IS DISTINCT FROM OLD.output_variable
       OR NEW.rounding_rule IS DISTINCT FROM OLD.rounding_rule) THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_FORMULA_VERSION: % version % semantics are frozen — use versioned succession',
      OLD.governance_status, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._bn_calc_guard_rate_table_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_table uuid;
BEGIN
  IF public._bn_calc_in_boundary() THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_table := CASE TG_OP WHEN 'DELETE' THEN OLD.rate_table_id ELSE NEW.rate_table_id END;
  SELECT upper(status) INTO v_status FROM public.bn_rate_table WHERE id = v_table;
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_RATE_TABLE: table % is % — use the governed boundary and versioned succession',
      v_table, v_status;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- 4. Re-assert revocations (helpers must never be client-callable) -----
REVOKE ALL ON FUNCTION public._bn_calc_boundary_token() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_boundary_enter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_in_boundary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_guard_formula_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_calc_guard_rate_table_row() FROM PUBLIC, anon, authenticated;