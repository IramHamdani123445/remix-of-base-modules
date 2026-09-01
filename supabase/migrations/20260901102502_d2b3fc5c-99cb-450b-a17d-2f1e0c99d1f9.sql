CREATE OR REPLACE FUNCTION public.bn_evidence_checklist_blocking_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mandatory BOOLEAN := false;
BEGIN
  SELECT COALESCE(dr.requirement_level, '') = 'MANDATORY'
         OR COALESCE(dr.blocks_decision, false)
         OR COALESCE(dr.blocks_submission, false)
    INTO v_mandatory
  FROM public.bn_doc_requirement dr
  WHERE dr.id = NEW.requirement_id;

  IF COALESCE(v_mandatory, false) THEN
    NEW.is_blocking := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_bn_evidence_checklist_blocking_default ON public.bn_evidence_checklist;
CREATE TRIGGER zz_bn_evidence_checklist_blocking_default
BEFORE INSERT ON public.bn_evidence_checklist
FOR EACH ROW EXECUTE FUNCTION public.bn_evidence_checklist_blocking_default();

UPDATE public.bn_evidence_checklist ec
SET is_blocking = true,
    modified_at = now()
FROM public.bn_doc_requirement dr
WHERE dr.id = ec.requirement_id
  AND ec.is_blocking = false
  AND UPPER(COALESCE(ec.status, '')) NOT IN ('FULFILLED', 'VERIFIED', 'WAIVED')
  AND (COALESCE(dr.requirement_level, '') = 'MANDATORY' OR COALESCE(dr.blocks_decision, false));