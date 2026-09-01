-- ============================================================
-- Compliance — Enterprise Inspection Evidence Register
-- ============================================================

ALTER TABLE public.ce_inspection_evidence
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_ext text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS file_state text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid,
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS replacement_reason text,
  ADD COLUMN IF NOT EXISTS withdrawn_reason text,
  ADD COLUMN IF NOT EXISTS withdrawn_by uuid,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS captured_by_user_id uuid;

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.ce_inspection_evidence
      ADD CONSTRAINT ce_inspection_evidence_status_chk
      CHECK (status IN ('ACTIVE','SUPERSEDED','WITHDRAWN'));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.ce_inspection_evidence
      ADD CONSTRAINT ce_inspection_evidence_filestate_chk
      CHECK (file_state IN ('AVAILABLE','MISSING','UNKNOWN','NO_FILE'));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.ce_inspection_evidence
      ADD CONSTRAINT ce_inspection_evidence_supersedes_fk
      FOREIGN KEY (supersedes_id) REFERENCES public.ce_inspection_evidence(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_ce_evidence_captured_at ON public.ce_inspection_evidence (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_evidence_inspection ON public.ce_inspection_evidence (inspection_id);
CREATE INDEX IF NOT EXISTS idx_ce_evidence_finding ON public.ce_inspection_evidence (finding_id);
CREATE INDEX IF NOT EXISTS idx_ce_evidence_status ON public.ce_inspection_evidence (status, file_state);

-- ── Backfill storage location + file state from legacy file_url ──
UPDATE public.ce_inspection_evidence e
SET storage_bucket = CASE
      WHEN e.file_url ~ '^blob:' THEN NULL
      WHEN e.file_url LIKE '%/storage/v1/object/%/ce-field-evidence/%' THEN 'ce-field-evidence'
      WHEN e.file_url LIKE '%/storage/v1/object/%/documents/%' THEN NULL
      WHEN e.file_url !~ '://' AND e.file_url <> '' THEN 'ce-field-evidence'
      ELSE NULL END,
    storage_path = CASE
      WHEN e.file_url ~ '^blob:' THEN NULL
      WHEN e.file_url LIKE '%/ce-field-evidence/%'
        THEN split_part(substring(e.file_url from position('/ce-field-evidence/' in e.file_url) + 19), '?', 1)
      WHEN e.file_url !~ '://' AND e.file_url <> '' THEN e.file_url
      ELSE NULL END,
    file_ext = lower(NULLIF(regexp_replace(e.file_name, '^.*\.', ''), e.file_name))
WHERE e.storage_path IS NULL;

UPDATE public.ce_inspection_evidence e
SET file_state = CASE
  WHEN e.evidence_type = 'NOTE' AND COALESCE(e.storage_path,'') = '' THEN 'NO_FILE'
  WHEN e.storage_path IS NULL THEN 'MISSING'
  WHEN EXISTS (SELECT 1 FROM storage.objects o
               WHERE o.bucket_id = e.storage_bucket AND o.name = e.storage_path) THEN 'AVAILABLE'
  ELSE 'MISSING' END
WHERE e.file_state = 'UNKNOWN';

-- ── Audit trail ──
CREATE TABLE IF NOT EXISTS public.ce_inspection_evidence_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL,
  action text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  actor_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_evidence_audit_evidence ON public.ce_inspection_evidence_audit (evidence_id, created_at DESC);

GRANT SELECT ON public.ce_inspection_evidence_audit TO authenticated;
GRANT ALL ON public.ce_inspection_evidence_audit TO service_role;
ALTER TABLE public.ce_inspection_evidence_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Compliance staff read evidence audit" ON public.ce_inspection_evidence_audit;
CREATE POLICY "Compliance staff read evidence audit"
  ON public.ce_inspection_evidence_audit FOR SELECT TO authenticated
  USING (public.ce_field_ops_scope(auth.uid()) <> 'NONE');

-- ── Helpers ──
CREATE OR REPLACE FUNCTION public.ce_evidence_capability(p_uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'can_view',     public.ce_field_ops_scope(p_uid) <> 'NONE'
                    OR public.ce_actor_can(p_uid,'compliance.workbench.enterprise')
                    OR public.ce_actor_can(p_uid,'compliance.workbench.team'),
    'can_attach',   public.ce_actor_can(p_uid,'compliance.field.execute'),
    'can_edit',     public.ce_actor_can(p_uid,'compliance.field.execute'),
    'can_replace',  public.ce_actor_can(p_uid,'compliance.field.execute'),
    'can_withdraw', public.ce_actor_can(p_uid,'compliance.workbench.team')
                    OR public.ce_actor_can(p_uid,'compliance.workbench.enterprise'),
    'is_oversight', public.ce_actor_can(p_uid,'compliance.workbench.enterprise'),
    'scope',        public.ce_field_ops_scope(p_uid)
  );
$$;

CREATE OR REPLACE FUNCTION public.ce_evidence_audit(
  p_evidence_id uuid, p_action text, p_reason text DEFAULT NULL, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ce_inspection_evidence_audit (evidence_id, action, reason, details, actor_id, actor_code)
  VALUES (p_evidence_id, p_action, p_reason, COALESCE(p_details,'{}'::jsonb), auth.uid(), public.ce_actor_code(auth.uid()));
END $$;

-- ── Register ──
CREATE OR REPLACE FUNCTION public.ce_evidence_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'captured_at',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caps jsonb;
  v_code text;
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := CASE WHEN p_export THEN 20000 ELSE LEAST(GREATEST(COALESCE(p_page_size,25),5),200) END;
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'captured_at');
  v_result jsonb;
  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_quick text := upper(COALESCE(NULLIF(p_filters->>'quick',''),'ALL'));
  f_types text[] := CASE WHEN COALESCE(p_filters->>'types','')='' THEN NULL
    ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'types') x) END;
  f_statuses text[] := CASE WHEN COALESCE(p_filters->>'statuses','')='' THEN NULL
    ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'statuses') x) END;
  f_file_states text[] := CASE WHEN COALESCE(p_filters->>'file_states','')='' THEN NULL
    ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'file_states') x) END;
  f_employer text := NULLIF(p_filters->>'employer','');
  f_inspection uuid := NULLIF(p_filters->>'inspection_id','')::uuid;
  f_captured_by text := NULLIF(p_filters->>'captured_by','');
  f_finding text := NULLIF(upper(p_filters->>'finding'),'');
  f_finding_id uuid := NULLIF(p_filters->>'finding_id','')::uuid;
  f_from date := NULLIF(p_filters->>'date_from','')::date;
  f_to date := NULLIF(p_filters->>'date_to','')::date;
  f_mine boolean := COALESCE((p_filters->>'mine_only')::boolean,false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-EVID-401: authentication required' USING ERRCODE='42501';
  END IF;
  v_caps := public.ce_evidence_capability(v_uid);
  IF NOT (v_caps->>'can_view')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-403: not authorised to read the inspection evidence register' USING ERRCODE='42501';
  END IF;
  v_code := public.ce_actor_code(v_uid);

  WITH base AS (
    SELECT e.*,
           i.inspection_number, i.employer_id, i.employer_name, i.inspector_id, i.inspector_name, i.status AS inspection_status,
           f.title AS finding_title, f.severity AS finding_severity, f.finding_type,
           f.violation_id, f.violation_created,
           v.violation_number, v.status AS violation_status,
           em.name AS employer_master_name
    FROM public.ce_inspection_evidence e
    LEFT JOIN public.ce_inspections i ON i.id = e.inspection_id
    LEFT JOIN public.ce_inspection_findings f ON f.id = e.finding_id
    LEFT JOIN public.ce_violations v ON v.id = f.violation_id
    LEFT JOIN public.er_master em ON em.regno = i.employer_id
    WHERE
      (v_caps->>'scope' = 'ALL'
       OR (v_caps->>'is_oversight')::boolean
       OR public.ce_actor_can(v_uid,'compliance.workbench.team')
       OR i.inspector_id = v_code
       OR e.captured_by = v_code
       OR e.captured_by_user_id = v_uid)
  ), filtered AS (
    SELECT * FROM base b
    WHERE (f_search IS NULL OR (
            b.file_name ILIKE '%'||f_search||'%' OR b.description ILIKE '%'||f_search||'%'
            OR b.employer_name ILIKE '%'||f_search||'%' OR b.employer_master_name ILIKE '%'||f_search||'%'
            OR b.employer_id ILIKE '%'||f_search||'%' OR b.inspection_number ILIKE '%'||f_search||'%'
            OR b.finding_title ILIKE '%'||f_search||'%' OR b.captured_by ILIKE '%'||f_search||'%'
            OR b.violation_number ILIKE '%'||f_search||'%'))
      AND (f_types IS NULL OR upper(b.evidence_type) = ANY(f_types))
      AND (f_statuses IS NULL OR upper(b.status) = ANY(f_statuses))
      AND (f_file_states IS NULL OR upper(b.file_state) = ANY(f_file_states))
      AND (f_employer IS NULL OR b.employer_id = f_employer)
      AND (f_inspection IS NULL OR b.inspection_id = f_inspection)
      AND (f_finding_id IS NULL OR b.finding_id = f_finding_id)
      AND (f_captured_by IS NULL OR b.captured_by ILIKE '%'||f_captured_by||'%')
      AND (f_finding IS NULL OR (f_finding='HAS' AND b.finding_id IS NOT NULL) OR (f_finding='NONE' AND b.finding_id IS NULL))
      AND (f_from IS NULL OR b.captured_at >= f_from)
      AND (f_to IS NULL OR b.captured_at < (f_to + 1))
      AND (NOT f_mine OR b.captured_by_user_id = v_uid OR b.captured_by = v_code)
      AND (f_quick = 'ALL'
        OR (f_quick='PHOTOS' AND upper(b.evidence_type)='PHOTO')
        OR (f_quick='DOCUMENTS' AND upper(b.evidence_type) IN ('DOCUMENT','SIGNED_SHEET'))
        OR (f_quick='PAYROLL' AND upper(b.evidence_type)='PAYROLL')
        OR (f_quick='NO_FINDING' AND b.finding_id IS NULL)
        OR (f_quick='MISSING' AND b.file_state='MISSING')
        OR (f_quick='MINE' AND (b.captured_by_user_id = v_uid OR b.captured_by = v_code)))
  ), counted AS (SELECT count(*) AS total FROM filtered),
  kpis AS (
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM base),
      'this_month', (SELECT count(*) FROM base WHERE captured_at >= date_trunc('month', now())),
      'linked_findings', (SELECT count(*) FROM base WHERE finding_id IS NOT NULL),
      'missing_files', (SELECT count(*) FROM base WHERE file_state='MISSING'),
      'superseded', (SELECT count(*) FROM base WHERE status<>'ACTIVE')
    ) AS k
  ), page AS (
    SELECT * FROM filtered
    ORDER BY
      CASE WHEN v_sort='captured_at' AND v_dir='desc' THEN captured_at END DESC NULLS LAST,
      CASE WHEN v_sort='captured_at' AND v_dir='asc' THEN captured_at END ASC NULLS LAST,
      CASE WHEN v_sort='employer' AND v_dir='desc' THEN employer_name END DESC NULLS LAST,
      CASE WHEN v_sort='employer' AND v_dir='asc' THEN employer_name END ASC NULLS LAST,
      CASE WHEN v_sort='inspection' AND v_dir='desc' THEN inspection_number END DESC NULLS LAST,
      CASE WHEN v_sort='inspection' AND v_dir='asc' THEN inspection_number END ASC NULLS LAST,
      CASE WHEN v_sort='type' AND v_dir='desc' THEN evidence_type END DESC NULLS LAST,
      CASE WHEN v_sort='type' AND v_dir='asc' THEN evidence_type END ASC NULLS LAST,
      CASE WHEN v_sort='file_name' AND v_dir='desc' THEN file_name END DESC NULLS LAST,
      CASE WHEN v_sort='file_name' AND v_dir='asc' THEN file_name END ASC NULLS LAST,
      CASE WHEN v_sort='captured_by' AND v_dir='desc' THEN captured_by END DESC NULLS LAST,
      CASE WHEN v_sort='captured_by' AND v_dir='asc' THEN captured_by END ASC NULLS LAST,
      CASE WHEN v_sort='file_size' AND v_dir='desc' THEN file_size END DESC NULLS LAST,
      CASE WHEN v_sort='file_size' AND v_dir='asc' THEN file_size END ASC NULLS LAST,
      captured_at DESC
    LIMIT v_size OFFSET (v_page-1)*v_size
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'evidence_type', p.evidence_type,
        'file_name', p.file_name,
        'file_size', p.file_size,
        'mime_type', p.mime_type,
        'file_ext', p.file_ext,
        'description', p.description,
        'captured_at', p.captured_at,
        'captured_by', p.captured_by,
        'status', p.status,
        'file_state', p.file_state,
        'version_no', p.version_no,
        'storage_bucket', p.storage_bucket,
        'storage_path', p.storage_path,
        'supersedes_id', p.supersedes_id,
        'superseded_by_id', p.superseded_by_id,
        'inspection_id', p.inspection_id,
        'inspection_number', p.inspection_number,
        'inspection_status', p.inspection_status,
        'employer_id', p.employer_id,
        'employer_name', COALESCE(p.employer_name, p.employer_master_name),
        'inspector_name', p.inspector_name,
        'finding_id', p.finding_id,
        'finding_title', p.finding_title,
        'finding_severity', p.finding_severity,
        'finding_type', p.finding_type,
        'violation_id', p.violation_id,
        'violation_number', p.violation_number,
        'violation_status', p.violation_status,
        'downstream_locked', COALESCE(p.violation_created,false)
      ) ORDER BY p.captured_at DESC) FROM page p), '[]'::jsonb),
    'total', (SELECT total FROM counted),
    'page', v_page,
    'page_size', v_size,
    'kpis', (SELECT k FROM kpis),
    'capabilities', v_caps
  ) INTO v_result;

  RETURN v_result;
END $$;

-- ── Facets ──
CREATE OR REPLACE FUNCTION public.ce_evidence_register_facets_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT (public.ce_evidence_capability(v_uid)->>'can_view')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-403: not authorised' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'types', COALESCE((SELECT jsonb_agg(DISTINCT upper(evidence_type)) FROM public.ce_inspection_evidence WHERE evidence_type IS NOT NULL),'[]'::jsonb),
    'employers', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT DISTINCT jsonb_build_object('id', i.employer_id, 'name', COALESCE(i.employer_name, i.employer_id)) x
        FROM public.ce_inspection_evidence e JOIN public.ce_inspections i ON i.id=e.inspection_id
        WHERE i.employer_id IS NOT NULL) s),'[]'::jsonb),
    'inspections', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT DISTINCT jsonb_build_object('id', i.id, 'number', i.inspection_number, 'employer', COALESCE(i.employer_name,i.employer_id)) x
        FROM public.ce_inspection_evidence e JOIN public.ce_inspections i ON i.id=e.inspection_id) s),'[]'::jsonb),
    'captured_by', COALESCE((SELECT jsonb_agg(DISTINCT captured_by) FROM public.ce_inspection_evidence WHERE captured_by IS NOT NULL),'[]'::jsonb)
  );
END $$;

-- ── Record a newly uploaded evidence file ──
CREATE OR REPLACE FUNCTION public.ce_evidence_attach_v1(
  p_inspection_id uuid, p_evidence_type text, p_file_name text,
  p_storage_bucket text DEFAULT NULL, p_storage_path text DEFAULT NULL,
  p_file_size bigint DEFAULT NULL, p_mime_type text DEFAULT NULL,
  p_description text DEFAULT NULL, p_finding_id uuid DEFAULT NULL,
  p_gps_lat numeric DEFAULT NULL, p_gps_lng numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_code text;
BEGIN
  IF v_uid IS NULL OR NOT (public.ce_evidence_capability(v_uid)->>'can_attach')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-403: you do not have permission to attach evidence' USING ERRCODE='42501';
  END IF;
  IF p_inspection_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.ce_inspections WHERE id=p_inspection_id) THEN
    RAISE EXCEPTION 'CE-EVID-422: a valid inspection is required';
  END IF;
  IF p_finding_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ce_inspection_findings WHERE id=p_finding_id AND inspection_id=p_inspection_id) THEN
    RAISE EXCEPTION 'CE-EVID-422: the finding does not belong to the selected inspection';
  END IF;
  IF upper(p_evidence_type) <> 'NOTE' AND COALESCE(p_storage_path,'') = '' THEN
    RAISE EXCEPTION 'CE-EVID-422: an uploaded file is required for this evidence type';
  END IF;

  v_code := public.ce_actor_code(v_uid);
  INSERT INTO public.ce_inspection_evidence (
    inspection_id, finding_id, evidence_type, file_name, file_url, file_size, mime_type,
    file_ext, description, storage_bucket, storage_path, file_state, status,
    gps_lat, gps_lng, captured_at, captured_by, captured_by_user_id, created_by)
  VALUES (
    p_inspection_id, p_finding_id, upper(p_evidence_type), p_file_name, COALESCE(p_storage_path,''),
    p_file_size, p_mime_type, lower(NULLIF(regexp_replace(p_file_name,'^.*\.',''), p_file_name)),
    NULLIF(trim(COALESCE(p_description,'')),''), p_storage_bucket, p_storage_path,
    CASE WHEN COALESCE(p_storage_path,'')='' THEN 'NO_FILE' ELSE 'AVAILABLE' END, 'ACTIVE',
    p_gps_lat, p_gps_lng, now(), COALESCE(v_code,'UNKNOWN'), v_uid, COALESCE(v_code,'UNKNOWN'))
  RETURNING id INTO v_id;

  PERFORM public.ce_evidence_audit(v_id,'UPLOADED',NULL,
    jsonb_build_object('inspection_id',p_inspection_id,'finding_id',p_finding_id,'file_name',p_file_name));
  RETURN v_id;
END $$;

-- ── Metadata edit ──
CREATE OR REPLACE FUNCTION public.ce_evidence_update_metadata_v1(
  p_id uuid, p_evidence_type text, p_description text, p_finding_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_caps jsonb; v_row public.ce_inspection_evidence; v_locked boolean;
BEGIN
  v_caps := public.ce_evidence_capability(v_uid);
  IF v_uid IS NULL OR NOT (v_caps->>'can_edit')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-403: you do not have permission to edit evidence metadata' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.ce_inspection_evidence WHERE id=p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'CE-EVID-404: evidence not found'; END IF;
  IF v_row.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'CE-EVID-409: superseded or withdrawn evidence cannot be edited';
  END IF;

  SELECT COALESCE(f.violation_created,false) INTO v_locked
  FROM public.ce_inspection_findings f WHERE f.id = v_row.finding_id;

  IF COALESCE(v_locked,false) AND COALESCE(p_finding_id::text,'') IS DISTINCT FROM COALESCE(v_row.finding_id::text,'')
     AND NOT (v_caps->>'is_oversight')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-409: this evidence supports a converted violation and can only be relinked by oversight';
  END IF;
  IF p_finding_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ce_inspection_findings WHERE id=p_finding_id AND inspection_id=v_row.inspection_id) THEN
    RAISE EXCEPTION 'CE-EVID-422: the finding does not belong to this inspection';
  END IF;

  UPDATE public.ce_inspection_evidence
  SET evidence_type = upper(COALESCE(p_evidence_type, evidence_type)),
      description = NULLIF(trim(COALESCE(p_description,'')),''),
      finding_id = p_finding_id,
      updated_by = public.ce_actor_code(v_uid),
      updated_at = now()
  WHERE id = p_id;

  PERFORM public.ce_evidence_audit(p_id,'METADATA_EDITED',NULL, jsonb_build_object(
    'from', jsonb_build_object('evidence_type',v_row.evidence_type,'description',v_row.description,'finding_id',v_row.finding_id),
    'to', jsonb_build_object('evidence_type',upper(COALESCE(p_evidence_type,v_row.evidence_type)),'description',p_description,'finding_id',p_finding_id)));
END $$;

-- ── Replacement / superseding version ──
CREATE OR REPLACE FUNCTION public.ce_evidence_replace_v1(
  p_id uuid, p_file_name text, p_storage_bucket text, p_storage_path text,
  p_file_size bigint, p_mime_type text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_caps jsonb; v_row public.ce_inspection_evidence; v_new uuid; v_code text;
BEGIN
  v_caps := public.ce_evidence_capability(v_uid);
  IF v_uid IS NULL OR NOT (v_caps->>'can_replace')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-403: you do not have permission to replace evidence' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-EVID-422: a replacement reason is required';
  END IF;
  IF COALESCE(p_storage_path,'') = '' THEN
    RAISE EXCEPTION 'CE-EVID-422: a replacement file is required';
  END IF;
  SELECT * INTO v_row FROM public.ce_inspection_evidence WHERE id=p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'CE-EVID-404: evidence not found'; END IF;
  IF v_row.status <> 'ACTIVE' THEN RAISE EXCEPTION 'CE-EVID-409: only active evidence can be replaced'; END IF;

  v_code := public.ce_actor_code(v_uid);
  INSERT INTO public.ce_inspection_evidence (
    inspection_id, finding_id, plan_item_id, evidence_type, file_name, file_url, file_size, mime_type,
    file_ext, description, storage_bucket, storage_path, file_state, status, version_no, supersedes_id,
    replacement_reason, gps_lat, gps_lng, captured_at, captured_by, captured_by_user_id, created_by)
  VALUES (
    v_row.inspection_id, v_row.finding_id, v_row.plan_item_id, v_row.evidence_type, p_file_name,
    p_storage_path, p_file_size, p_mime_type,
    lower(NULLIF(regexp_replace(p_file_name,'^.*\.',''), p_file_name)), v_row.description,
    p_storage_bucket, p_storage_path, 'AVAILABLE', 'ACTIVE', v_row.version_no + 1, v_row.id,
    trim(p_reason), v_row.gps_lat, v_row.gps_lng, now(), COALESCE(v_code,'UNKNOWN'), v_uid, COALESCE(v_code,'UNKNOWN'))
  RETURNING id INTO v_new;

  UPDATE public.ce_inspection_evidence
  SET status='SUPERSEDED', superseded_by_id=v_new, superseded_at=now(),
      updated_by=v_code, updated_at=now()
  WHERE id = p_id;

  PERFORM public.ce_evidence_audit(p_id,'SUPERSEDED',trim(p_reason), jsonb_build_object('replacement_id',v_new));
  PERFORM public.ce_evidence_audit(v_new,'REPLACEMENT_UPLOADED',trim(p_reason), jsonb_build_object('supersedes_id',p_id,'file_name',p_file_name));
  RETURN v_new;
END $$;

-- ── Withdraw (void) — replaces hard delete ──
CREATE OR REPLACE FUNCTION public.ce_evidence_withdraw_v1(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_caps jsonb; v_row public.ce_inspection_evidence; v_locked boolean;
BEGIN
  v_caps := public.ce_evidence_capability(v_uid);
  IF v_uid IS NULL OR NOT (v_caps->>'can_withdraw')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-403: you do not have permission to withdraw evidence' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'CE-EVID-422: a withdrawal reason is required'; END IF;
  SELECT * INTO v_row FROM public.ce_inspection_evidence WHERE id=p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'CE-EVID-404: evidence not found'; END IF;
  IF v_row.status = 'WITHDRAWN' THEN RAISE EXCEPTION 'CE-EVID-409: evidence is already withdrawn'; END IF;

  SELECT COALESCE(f.violation_created,false) INTO v_locked
  FROM public.ce_inspection_findings f WHERE f.id = v_row.finding_id;
  IF COALESCE(v_locked,false) AND NOT (v_caps->>'is_oversight')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-409: this evidence supports a converted violation and can only be withdrawn by oversight';
  END IF;

  UPDATE public.ce_inspection_evidence
  SET status='WITHDRAWN', withdrawn_reason=trim(p_reason), withdrawn_by=v_uid, withdrawn_at=now(),
      updated_by=public.ce_actor_code(v_uid), updated_at=now()
  WHERE id=p_id;

  PERFORM public.ce_evidence_audit(p_id,'WITHDRAWN',trim(p_reason),'{}'::jsonb);
END $$;

-- ── Access logging + integrity flagging ──
CREATE OR REPLACE FUNCTION public.ce_evidence_log_access_v1(p_id uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  PERFORM public.ce_evidence_audit(p_id, CASE WHEN upper(p_action)='DOWNLOAD' THEN 'DOWNLOADED' ELSE 'VIEWED' END, NULL, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.ce_evidence_flag_file_state_v1(p_id uuid, p_state text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT (public.ce_evidence_capability(v_uid)->>'can_view')::boolean THEN RETURN; END IF;
  IF upper(p_state) NOT IN ('AVAILABLE','MISSING') THEN RETURN; END IF;
  UPDATE public.ce_inspection_evidence SET file_state = upper(p_state), updated_at = now()
  WHERE id = p_id AND file_state IS DISTINCT FROM upper(p_state);
  IF FOUND THEN PERFORM public.ce_evidence_audit(p_id,'FILE_STATE_'||upper(p_state),NULL,'{}'::jsonb); END IF;
END $$;

-- ── Evidence detail (audit trail + version chain) ──
CREATE OR REPLACE FUNCTION public.ce_evidence_detail_v1(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT (public.ce_evidence_capability(v_uid)->>'can_view')::boolean THEN
    RAISE EXCEPTION 'CE-EVID-403: not authorised' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'audit', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'action',a.action,'reason',a.reason,'details',a.details,'actor_code',a.actor_code,'created_at',a.created_at)
        ORDER BY a.created_at DESC)
      FROM public.ce_inspection_evidence_audit a WHERE a.evidence_id = p_id),'[]'::jsonb),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',e.id,'version_no',e.version_no,'file_name',e.file_name,'status',e.status,
        'captured_at',e.captured_at,'captured_by',e.captured_by,'replacement_reason',e.replacement_reason)
        ORDER BY e.version_no)
      FROM public.ce_inspection_evidence e
      WHERE e.id = p_id OR e.supersedes_id = p_id OR e.id = (SELECT supersedes_id FROM public.ce_inspection_evidence WHERE id=p_id)),'[]'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.ce_evidence_register_v1(jsonb,text,text,integer,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_register_facets_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_attach_v1(uuid,text,text,text,text,bigint,text,text,uuid,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_update_metadata_v1(uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_replace_v1(uuid,text,text,text,bigint,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_withdraw_v1(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_log_access_v1(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_flag_file_state_v1(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_detail_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_capability(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_evidence_audit(uuid,text,text,jsonb) TO authenticated;