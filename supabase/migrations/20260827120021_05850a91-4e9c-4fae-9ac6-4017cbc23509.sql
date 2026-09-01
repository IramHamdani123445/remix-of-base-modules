-- =====================================================================
-- INTERNAL AUDIT WAVE 2 — MIGRATION 1/3
-- Part A closures (IA-W1-D01 storage isolation, IA-W1-D02 orphan ref)
-- plus the Wave 2 lifecycle data model.
-- =====================================================================

-- ---------------------------------------------------------------
-- A1. STORAGE ENGAGEMENT ISOLATION (IA-W1-D01)
-- Canonical path: internal-audit/<engagement_id>/<class>/<entity_id>/<file>
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_storage_engagement(_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v uuid;
BEGIN
  IF _name IS NULL OR split_part(_name, '/', 1) <> 'internal-audit' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v := split_part(_name, '/', 2)::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_storage_class(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT NULLIF(split_part(_name, '/', 3), '') $$;

-- Classes a management respondent may contribute to. Working papers and
-- audit evidence are auditor-only artefacts and must never be writable
-- (or readable) by an auditee.
CREATE OR REPLACE FUNCTION public.ia_respondent_writable_class(_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT _class IN ('responses', 'actions', 'documents', 'queries') $$;

CREATE OR REPLACE FUNCTION public.ia_can_access_audit_object(_name text, _write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng uuid := public.ia_storage_engagement(_name);
  v_class text := public.ia_storage_class(_name);
  v_is_ia boolean := public.ia_is_ia_user();
  v_respondent boolean := false;
BEGIN
  -- Legacy (pre-Wave-2) objects have no engagement segment: read-only for
  -- Internal Audit staff, never writable, never visible to auditees.
  IF v_eng IS NULL THEN
    RETURN v_is_ia AND NOT _write;
  END IF;

  IF v_is_ia AND public.ia_can_access_engagement(v_eng) THEN
    RETURN true;
  END IF;

  SELECT public.ia_is_department_respondent(e.department_id)
    INTO v_respondent
    FROM public.ia_audit_engagements e
   WHERE e.id = v_eng;

  RETURN COALESCE(v_respondent, false)
     AND public.ia_respondent_writable_class(v_class);
END;
$$;

REVOKE ALL ON FUNCTION public.ia_storage_engagement(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_storage_class(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_respondent_writable_class(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_can_access_audit_object(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_storage_engagement(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_storage_class(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_respondent_writable_class(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_can_access_audit_object(text, boolean) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can read audit attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload audit attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update audit attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete audit attachments" ON storage.objects;
DROP POLICY IF EXISTS "ia_attachments_select" ON storage.objects;
DROP POLICY IF EXISTS "ia_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "ia_attachments_update" ON storage.objects;
DROP POLICY IF EXISTS "ia_attachments_delete" ON storage.objects;

CREATE POLICY "ia_attachments_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id IN ('audit-attachments','ia-evidence')
  AND public.ia_can_access_audit_object(name, false)
);

CREATE POLICY "ia_attachments_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('audit-attachments','ia-evidence')
  AND public.ia_storage_engagement(name) IS NOT NULL
  AND public.ia_can_access_audit_object(name, true)
);

CREATE POLICY "ia_attachments_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id IN ('audit-attachments','ia-evidence')
  AND public.ia_can_access_audit_object(name, true)
)
WITH CHECK (
  bucket_id IN ('audit-attachments','ia-evidence')
  AND public.ia_can_access_audit_object(name, true)
);

CREATE POLICY "ia_attachments_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id IN ('audit-attachments','ia-evidence')
  AND public.ia_is_ia_user()
  AND public.ia_can_access_audit_object(name, true)
);

-- ---------------------------------------------------------------
-- A2. ORPHAN LEAD AUDITOR REPAIR + GUARD (IA-W1-D02)
-- ---------------------------------------------------------------
UPDATE public.ia_audit_engagements e
   SET lead_auditor_id = NULL,
       updated_at = now(),
       updated_by = 'WAVE2_REPAIR'
 WHERE e.lead_auditor_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.ia_auditors a WHERE a.id = e.lead_auditor_id);

UPDATE public.ia_audit_engagements e
   SET reviewer_id = NULL,
       updated_at = now(),
       updated_by = 'WAVE2_REPAIR'
 WHERE e.reviewer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.ia_auditors a WHERE a.id = e.reviewer_id);

CREATE OR REPLACE FUNCTION public.ia_guard_engagement_auditor_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_auditor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ia_auditors a WHERE a.id = NEW.lead_auditor_id) THEN
    RAISE EXCEPTION 'IA_INVALID_LEAD_AUDITOR: lead_auditor_id % is not a registered auditor', NEW.lead_auditor_id;
  END IF;
  IF NEW.reviewer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ia_auditors a WHERE a.id = NEW.reviewer_id) THEN
    RAISE EXCEPTION 'IA_INVALID_REVIEWER: reviewer_id % is not a registered auditor', NEW.reviewer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ia_guard_engagement_auditor_refs ON public.ia_audit_engagements;
CREATE TRIGGER trg_ia_guard_engagement_auditor_refs
BEFORE INSERT OR UPDATE OF lead_auditor_id, reviewer_id ON public.ia_audit_engagements
FOR EACH ROW EXECUTE FUNCTION public.ia_guard_engagement_auditor_refs();

-- ---------------------------------------------------------------
-- B. LIFECYCLE COLUMN EXTENSIONS
-- ---------------------------------------------------------------
ALTER TABLE public.ia_audit_engagements
  ADD COLUMN IF NOT EXISTS preparation_status text NOT NULL DEFAULT 'Not Started',
  ADD COLUMN IF NOT EXISTS preparation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparation_completed_by text,
  ADD COLUMN IF NOT EXISTS preparation_notes text;

ALTER TABLE public.ia_activities
  ADD COLUMN IF NOT EXISTS owner_auditor_id uuid,
  ADD COLUMN IF NOT EXISTS reviewer_auditor_id uuid,
  ADD COLUMN IF NOT EXISTS planned_hours numeric,
  ADD COLUMN IF NOT EXISTS actual_hours numeric,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'Not Reviewed',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by text,
  ADD COLUMN IF NOT EXISTS completion_notes text;

ALTER TABLE public.ia_control_tests
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Planned',
  ADD COLUMN IF NOT EXISTS conclusion text,
  ADD COLUMN IF NOT EXISTS no_finding_rationale text,
  ADD COLUMN IF NOT EXISTS concluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS concluded_by text;

ALTER TABLE public.ia_findings
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS control_test_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by text,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_by text,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_reason text;

UPDATE public.ia_findings SET severity = risk_rating WHERE severity IS NULL;

ALTER TABLE public.ia_management_responses
  ADD COLUMN IF NOT EXISTS management_position text,
  ADD COLUMN IF NOT EXISTS rejection_rationale text,
  ADD COLUMN IF NOT EXISTS review_outcome text,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

ALTER TABLE public.ia_quality_reviews
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS rework_notes text,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleared_by text;

ALTER TABLE public.ia_audit_reports
  ADD COLUMN IF NOT EXISTS current_version_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qa_review_id uuid;

ALTER TABLE public.ia_action_tracking
  ADD COLUMN IF NOT EXISTS original_target_date date,
  ADD COLUMN IF NOT EXISTS current_target_date date,
  ADD COLUMN IF NOT EXISTS extension_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closure_verified_by text,
  ADD COLUMN IF NOT EXISTS closure_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_notes text;

UPDATE public.ia_action_tracking
   SET original_target_date = COALESCE(original_target_date, target_date),
       current_target_date  = COALESCE(current_target_date, target_date)
 WHERE target_date IS NOT NULL;

-- ---------------------------------------------------------------
-- C. NEW LIFECYCLE TABLES
-- ---------------------------------------------------------------

-- C1. Finding severity history
CREATE TABLE IF NOT EXISTS public.ia_finding_severity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES public.ia_findings(id) ON DELETE CASCADE,
  engagement_id uuid,
  old_severity text,
  new_severity text NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ia_finding_severity_history TO authenticated;
GRANT ALL ON public.ia_finding_severity_history TO service_role;
ALTER TABLE public.ia_finding_severity_history ENABLE ROW LEVEL SECURITY;

-- C2. Report versions
CREATE TABLE IF NOT EXISTS public.ia_report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.ia_audit_reports(id) ON DELETE CASCADE,
  engagement_id uuid,
  version_number integer NOT NULL,
  version_label text,
  status text NOT NULL DEFAULT 'Draft',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  change_summary text,
  is_issued boolean NOT NULL DEFAULT false,
  issued_at timestamptz,
  issued_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (report_id, version_number)
);
GRANT SELECT, INSERT, UPDATE ON public.ia_report_versions TO authenticated;
GRANT ALL ON public.ia_report_versions TO service_role;
ALTER TABLE public.ia_report_versions ENABLE ROW LEVEL SECURITY;

-- Issued versions are immutable.
CREATE OR REPLACE FUNCTION public.ia_report_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_issued THEN
      RAISE EXCEPTION 'IA_REPORT_VERSION_IMMUTABLE: issued report versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_issued THEN
    RAISE EXCEPTION 'IA_REPORT_VERSION_IMMUTABLE: issued report version % cannot be modified', OLD.version_number;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ia_report_version_immutable ON public.ia_report_versions;
CREATE TRIGGER trg_ia_report_version_immutable
BEFORE UPDATE OR DELETE ON public.ia_report_versions
FOR EACH ROW EXECUTE FUNCTION public.ia_report_version_immutable();

-- C3. Action extension history
CREATE TABLE IF NOT EXISTS public.ia_action_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.ia_action_tracking(id) ON DELETE CASCADE,
  engagement_id uuid,
  previous_target_date date,
  new_target_date date NOT NULL,
  reason text NOT NULL,
  requested_by text,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ia_action_extensions TO authenticated;
GRANT ALL ON public.ia_action_extensions TO service_role;
ALTER TABLE public.ia_action_extensions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- D. RLS POLICIES FOR THE NEW TABLES (Wave 1 operational class)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS ia_finding_severity_history_select ON public.ia_finding_severity_history;
CREATE POLICY ia_finding_severity_history_select ON public.ia_finding_severity_history
FOR SELECT TO authenticated
USING (public.ia_is_ia_user() AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)));

DROP POLICY IF EXISTS ia_finding_severity_history_insert ON public.ia_finding_severity_history;
CREATE POLICY ia_finding_severity_history_insert ON public.ia_finding_severity_history
FOR INSERT TO authenticated
WITH CHECK (public.ia_is_ia_user() AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)));

DROP POLICY IF EXISTS ia_report_versions_select ON public.ia_report_versions;
CREATE POLICY ia_report_versions_select ON public.ia_report_versions
FOR SELECT TO authenticated
USING (public.ia_is_ia_user() AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)));

DROP POLICY IF EXISTS ia_report_versions_insert ON public.ia_report_versions;
CREATE POLICY ia_report_versions_insert ON public.ia_report_versions
FOR INSERT TO authenticated
WITH CHECK (public.ia_is_ia_user() AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)));

DROP POLICY IF EXISTS ia_report_versions_update ON public.ia_report_versions;
CREATE POLICY ia_report_versions_update ON public.ia_report_versions
FOR UPDATE TO authenticated
USING (public.ia_is_ia_user() AND NOT is_issued AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)))
WITH CHECK (public.ia_is_ia_user() AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)));

DROP POLICY IF EXISTS ia_action_extensions_select ON public.ia_action_extensions;
CREATE POLICY ia_action_extensions_select ON public.ia_action_extensions
FOR SELECT TO authenticated
USING (public.ia_is_ia_user() AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)));

DROP POLICY IF EXISTS ia_action_extensions_insert ON public.ia_action_extensions;
CREATE POLICY ia_action_extensions_insert ON public.ia_action_extensions
FOR INSERT TO authenticated
WITH CHECK (public.ia_is_ia_user() AND (engagement_id IS NULL OR public.ia_can_access_engagement(engagement_id)));

-- updated_at maintenance
DROP TRIGGER IF EXISTS trg_ia_action_extensions_touch ON public.ia_action_extensions;
CREATE TRIGGER trg_ia_action_extensions_touch
BEFORE UPDATE ON public.ia_action_extensions
FOR EACH ROW EXECUTE FUNCTION public.ia_update_updated_at();

DROP TRIGGER IF EXISTS trg_ia_finding_severity_history_touch ON public.ia_finding_severity_history;
CREATE TRIGGER trg_ia_finding_severity_history_touch
BEFORE UPDATE ON public.ia_finding_severity_history
FOR EACH ROW EXECUTE FUNCTION public.ia_update_updated_at();

CREATE INDEX IF NOT EXISTS idx_ia_finding_sev_hist_finding ON public.ia_finding_severity_history(finding_id);
CREATE INDEX IF NOT EXISTS idx_ia_report_versions_report ON public.ia_report_versions(report_id);
CREATE INDEX IF NOT EXISTS idx_ia_action_extensions_action ON public.ia_action_extensions(action_id);
