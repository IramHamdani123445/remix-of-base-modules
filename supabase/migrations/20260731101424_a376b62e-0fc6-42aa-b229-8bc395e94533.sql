CREATE OR REPLACE FUNCTION public.fn_ce_violation_set_zone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_village VARCHAR;
  v_office VARCHAR;
  v_zone_id UUID;
BEGIN
  IF NEW.zone_id IS NOT NULL OR NEW.employer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.village_code, e.office_code
    INTO v_village, v_office
  FROM er_master e
  WHERE e.regno = NEW.employer_id;

  IF v_village IS NULL AND v_office IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT rz.zone_id INTO v_zone_id
  FROM fn_ce_resolve_zone(v_village, v_office) rz
  LIMIT 1;

  IF v_zone_id IS NOT NULL THEN
    NEW.zone_id := v_zone_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_violation_set_zone ON public.ce_violations;
CREATE TRIGGER trg_ce_violation_set_zone
BEFORE INSERT OR UPDATE OF employer_id, zone_id ON public.ce_violations
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_violation_set_zone();