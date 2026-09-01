CREATE SEQUENCE IF NOT EXISTS public.ia_finding_ref_seq;
CREATE SEQUENCE IF NOT EXISTS public.ia_working_paper_ref_seq;

CREATE OR REPLACE FUNCTION public.ia_assign_finding_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.finding_id IS NULL OR btrim(NEW.finding_id) = '' THEN
    LOOP
      NEW.finding_id := 'FND-' || to_char(COALESCE(NEW.created_at, now()), 'YYYY') || '-' ||
                        lpad(nextval('public.ia_finding_ref_seq')::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ia_findings f WHERE f.finding_id = NEW.finding_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_assign_working_paper_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.working_paper_id IS NULL OR btrim(NEW.working_paper_id) = '' THEN
    LOOP
      NEW.working_paper_id := 'WP-' || to_char(COALESCE(NEW.created_at, now()), 'YYYY') || '-' ||
                              lpad(nextval('public.ia_working_paper_ref_seq')::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ia_working_papers w WHERE w.working_paper_id = NEW.working_paper_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ia_assign_finding_reference ON public.ia_findings;
CREATE TRIGGER zz_ia_assign_finding_reference
BEFORE INSERT ON public.ia_findings
FOR EACH ROW EXECUTE FUNCTION public.ia_assign_finding_reference();

DROP TRIGGER IF EXISTS zz_ia_assign_working_paper_reference ON public.ia_working_papers;
CREATE TRIGGER zz_ia_assign_working_paper_reference
BEFORE INSERT ON public.ia_working_papers
FOR EACH ROW EXECUTE FUNCTION public.ia_assign_working_paper_reference();

SELECT setval('public.ia_finding_ref_seq', GREATEST(1, (SELECT count(*) FROM public.ia_findings)));
SELECT setval('public.ia_working_paper_ref_seq', GREATEST(1, (SELECT count(*) FROM public.ia_working_papers)));