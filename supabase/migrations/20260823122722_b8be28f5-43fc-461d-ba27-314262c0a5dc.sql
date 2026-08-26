-- Finding disposition (classification)
ALTER TABLE public.ce_inspection_findings
  ADD COLUMN IF NOT EXISTS disposition varchar(32) NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS reviewed_by varchar(64),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS converted_by varchar(64),
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.ce_inspection_findings
    ADD CONSTRAINT ce_inspection_findings_disposition_chk
    CHECK (disposition IN ('PENDING_REVIEW','INFORMATIONAL','FLAG_FOR_REVIEW','VIOLATION_CANDIDATE','CONVERTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.ce_inspection_findings
   SET disposition = 'CONVERTED'
 WHERE violation_created IS TRUE AND disposition <> 'CONVERTED';

-- Traceability: violation -> originating finding
ALTER TABLE public.ce_violations
  ADD COLUMN IF NOT EXISTS source_finding_id uuid;

UPDATE public.ce_violations v
   SET source_finding_id = f.id
  FROM public.ce_inspection_findings f
 WHERE f.violation_id = v.id AND v.source_finding_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ce_violations_source_finding
  ON public.ce_violations (source_finding_id) WHERE source_finding_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_ce_finding_conversion_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.violation_created,false) AND COALESCE(NEW.violation_created,false)
     AND NEW.violation_id IS DISTINCT FROM OLD.violation_id THEN
    RAISE EXCEPTION 'Finding % has already been converted to violation % (duplicate conversion blocked)',
      OLD.id, OLD.violation_id USING ERRCODE = '23505';
  END IF;

  IF COALESCE(NEW.violation_created,false) AND NOT COALESCE(OLD.violation_created,false) THEN
    IF OLD.disposition NOT IN ('VIOLATION_CANDIDATE','PENDING_REVIEW') THEN
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
            jsonb_build_object('disposition','CONVERTED','violation_id', NEW.violation_id),
            NEW.converted_by, now());
  ELSIF NEW.disposition IS DISTINCT FROM OLD.disposition THEN
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
    INSERT INTO public.ce_audit_log(entity_type, entity_id, action, description, old_values, new_values, performed_by, performed_at)
    VALUES ('ce_inspection_finding', OLD.id, 'CLASSIFY_FINDING',
            'Inspection finding disposition changed',
            jsonb_build_object('disposition', OLD.disposition),
            jsonb_build_object('disposition', NEW.disposition, 'review_notes', NEW.review_notes),
            COALESCE(NEW.reviewed_by, NEW.updated_by), now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_finding_conversion_guard ON public.ce_inspection_findings;
CREATE TRIGGER trg_ce_finding_conversion_guard
BEFORE UPDATE ON public.ce_inspection_findings
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_finding_conversion_guard();