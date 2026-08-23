-- 1. Repair legacy CONVERTED findings with no linked violation
INSERT INTO public.ce_audit_log(entity_type, entity_id, action, description, old_values, new_values, performed_by, performed_at)
SELECT 'ce_inspection_finding', f.id, 'REPAIR_ORPHAN_CONVERSION',
       'Finding was marked CONVERTED but no violation exists; restored to VIOLATION_CANDIDATE',
       jsonb_build_object('disposition', f.disposition, 'violation_created', f.violation_created),
       jsonb_build_object('disposition', 'VIOLATION_CANDIDATE', 'violation_created', false),
       'system_repair', now()
FROM public.ce_inspection_findings f
WHERE f.disposition = 'CONVERTED' AND f.violation_id IS NULL;

UPDATE public.ce_inspection_findings
SET disposition = 'VIOLATION_CANDIDATE',
    violation_created = false,
    converted_by = NULL,
    converted_at = NULL,
    review_notes = COALESCE(review_notes, 'Restored: legacy CONVERTED flag had no resulting violation.'),
    updated_at = now(),
    updated_by = 'system_repair'
WHERE disposition = 'CONVERTED' AND violation_id IS NULL;

-- 2. Violation type conversion policy configuration
ALTER TABLE public.ce_violation_types
  ADD COLUMN IF NOT EXISTS conversion_policy varchar(30) NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN IF NOT EXISTS requires_supervisor_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maker_checker_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inspection_eligible boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ce_violation_types_conversion_policy_chk') THEN
    ALTER TABLE public.ce_violation_types
      ADD CONSTRAINT ce_violation_types_conversion_policy_chk
      CHECK (conversion_policy IN ('DIRECT','REVIEW_REQUIRED','INFORMATIONAL_ONLY'));
  END IF;
END $$;

UPDATE public.ce_violation_types
SET conversion_policy = 'REVIEW_REQUIRED',
    requires_supervisor_review = true,
    maker_checker_required = true
WHERE code IN ('UNDER_DECLARATION','EMPLOYEE_DISCREPANCY','SEVERANCE_OMISSION','UNREGISTERED_EMPLOYER','LEGAL_DEFAULT');

-- 3. Candidate violation type on findings
ALTER TABLE public.ce_inspection_findings
  ADD COLUMN IF NOT EXISTS candidate_violation_type_id uuid REFERENCES public.ce_violation_types(id);

-- 4. Policy resolver
CREATE OR REPLACE FUNCTION public.fn_ce_finding_conversion_policy(p_violation_type_id uuid)
RETURNS TABLE(conversion_policy text, requires_supervisor_review boolean, maker_checker_required boolean, inspection_eligible boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(t.conversion_policy, 'DIRECT')::text,
         COALESCE(t.requires_supervisor_review, false),
         COALESCE(t.maker_checker_required, false),
         COALESCE(t.inspection_eligible, true)
  FROM (SELECT 1) s
  LEFT JOIN public.ce_violation_types t ON t.id = p_violation_type_id;
$$;

-- 5. Policy-driven conversion + maker-checker guard
CREATE OR REPLACE FUNCTION public.fn_ce_finding_conversion_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_policy       text := 'DIRECT';
  v_maker_check  boolean := false;
  v_supervisor   boolean := false;
  v_eligible     boolean := true;
  v_type_id      uuid;
  v_actor        text;
BEGIN
  v_type_id := COALESCE(NEW.candidate_violation_type_id, OLD.candidate_violation_type_id);
  IF v_type_id IS NULL AND NEW.violation_id IS NOT NULL THEN
    SELECT v.violation_type_id INTO v_type_id FROM public.ce_violations v WHERE v.id = NEW.violation_id;
  END IF;
  IF v_type_id IS NOT NULL THEN
    SELECT p.conversion_policy, p.requires_supervisor_review, p.maker_checker_required, p.inspection_eligible
      INTO v_policy, v_supervisor, v_maker_check, v_eligible
    FROM public.fn_ce_finding_conversion_policy(v_type_id) p;
  END IF;

  -- duplicate conversion protection
  IF COALESCE(OLD.violation_created,false) AND COALESCE(NEW.violation_created,false)
     AND NEW.violation_id IS DISTINCT FROM OLD.violation_id THEN
    RAISE EXCEPTION 'Finding % has already been converted to violation % (duplicate conversion blocked)',
      OLD.id, OLD.violation_id USING ERRCODE = '23505';
  END IF;

  IF COALESCE(NEW.violation_created,false) AND NOT COALESCE(OLD.violation_created,false) THEN
    IF v_policy = 'INFORMATIONAL_ONLY' OR NOT v_eligible THEN
      RAISE EXCEPTION 'Violation type configuration does not permit converting inspection findings into violations'
        USING ERRCODE = '23514';
    END IF;
    IF OLD.disposition = 'INFORMATIONAL' THEN
      RAISE EXCEPTION 'Finding % is classified as informational only and cannot be converted', OLD.id
        USING ERRCODE = '23514';
    END IF;
    IF v_policy = 'REVIEW_REQUIRED' THEN
      IF OLD.disposition <> 'VIOLATION_CANDIDATE' THEN
        RAISE EXCEPTION 'Violation type requires review first: finding % must be confirmed as a violation candidate (current: %)',
          OLD.id, OLD.disposition USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.disposition NOT IN ('VIOLATION_CANDIDATE','PENDING_REVIEW') THEN
      RAISE EXCEPTION 'Finding % is classified as % and cannot be converted to a violation',
        OLD.id, OLD.disposition USING ERRCODE = '23514';
    END IF;

    NEW.disposition   := 'CONVERTED';
    NEW.converted_at  := COALESCE(NEW.converted_at, now());
    NEW.converted_by  := COALESCE(NEW.converted_by, NEW.updated_by, OLD.updated_by);

    INSERT INTO public.ce_audit_log(entity_type, entity_id, action, description, old_values, new_values, performed_by, performed_at)
    VALUES ('ce_inspection_finding', OLD.id, 'CONVERT_TO_VIOLATION',
            'Inspection finding converted to violation',
            jsonb_build_object('disposition', OLD.disposition, 'violation_created', OLD.violation_created),
            jsonb_build_object('disposition','CONVERTED','violation_id', NEW.violation_id,
                               'conversion_policy', v_policy, 'violation_type_id', v_type_id),
            NEW.converted_by, now());

  ELSIF NEW.disposition IS DISTINCT FROM OLD.disposition THEN
    v_actor := COALESCE(NEW.reviewed_by, NEW.updated_by);

    -- maker-checker: independent reviewer required to promote a flagged finding
    IF NEW.disposition = 'VIOLATION_CANDIDATE'
       AND OLD.disposition = 'FLAG_FOR_REVIEW'
       AND v_maker_check THEN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Reviewer identity is required to confirm a flagged finding' USING ERRCODE = '23514';
      END IF;
      IF v_actor = COALESCE(OLD.created_by, '') OR v_actor = COALESCE(OLD.reviewed_by, '') THEN
        RAISE EXCEPTION 'Maker-checker: % cannot approve their own finding review', v_actor
          USING ERRCODE = '42501';
      END IF;
      IF COALESCE(NULLIF(NEW.review_notes,''), NULL) IS NULL THEN
        RAISE EXCEPTION 'A decision reason is required when confirming a flagged finding' USING ERRCODE = '23514';
      END IF;
    END IF;

    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
    INSERT INTO public.ce_audit_log(entity_type, entity_id, action, description, old_values, new_values, performed_by, performed_at)
    VALUES ('ce_inspection_finding', OLD.id, 'CLASSIFY_FINDING',
            'Inspection finding disposition changed',
            jsonb_build_object('disposition', OLD.disposition),
            jsonb_build_object('disposition', NEW.disposition, 'review_notes', NEW.review_notes,
                               'candidate_violation_type_id', NEW.candidate_violation_type_id,
                               'conversion_policy', v_policy, 'maker_checker_required', v_maker_check),
            v_actor, now());
  END IF;

  RETURN NEW;
END;
$$;