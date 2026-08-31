-- Resolve pre-existing duplicate pending closure requests (keep the latest).
UPDATE public.ce_case_requests r
SET status = 'CANCELLED',
    review_notes = COALESCE(review_notes,'') || 'Superseded by a later pending request for the same case (governance de-duplication).',
    updated_at = now()
WHERE r.status = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM public.ce_case_requests r2
    WHERE r2.case_id = r.case_id AND r2.request_type = r.request_type
      AND r2.status = 'PENDING' AND r2.requested_at > r.requested_at
  );

CREATE INDEX IF NOT EXISTS idx_ce_case_requests_type_status_req_at
  ON public.ce_case_requests (request_type, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_case_requests_target
  ON public.ce_case_requests (target_case_id) WHERE target_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_case_requests_requested_by
  ON public.ce_case_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_ce_case_requests_reviewed_at
  ON public.ce_case_requests (reviewed_at DESC) WHERE reviewed_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ce_case_requests_one_pending
  ON public.ce_case_requests (case_id, request_type)
  WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION public.ce_case_requests_v1(
  p_type text,
  p_status text DEFAULT 'PENDING',
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'recommended',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_type text := upper(COALESCE(NULLIF(p_type,''),'CLOSURE'));
  v_status text := upper(COALESCE(NULLIF(p_status,''),'PENDING'));
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),5),200);
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'recommended');
  v_codes text[];
  v_sla_days numeric;
  v_result jsonb;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_employer text := NULLIF(p_filters->>'employer','');
  f_case text := NULLIF(p_filters->>'case','');
  f_requested_by text := NULLIF(p_filters->>'requested_by','');
  f_reviewed_by text := NULLIF(p_filters->>'reviewed_by','');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
  f_rev_from date := NULLIF(p_filters->>'reviewed_from','')::date;
  f_rev_to date := NULLIF(p_filters->>'reviewed_to','')::date;
  f_waiting text := NULLIF(upper(p_filters->>'waiting'),'');
  f_priorities text[] := CASE WHEN COALESCE(p_filters->>'priorities','') = '' THEN NULL
      ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'priorities') x) END;
  f_risks text[] := CASE WHEN COALESCE(p_filters->>'risk_bands','') = '' THEN NULL
      ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'risk_bands') x) END;
  f_case_statuses text[] := CASE WHEN COALESCE(p_filters->>'case_statuses','') = '' THEN NULL
      ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'case_statuses') x) END;
  f_amount_min numeric := NULLIF(p_filters->>'amount_min','')::numeric;
  f_same_employer text := NULLIF(upper(p_filters->>'same_employer'),'');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-CASE-REQ-401: authentication required';
  END IF;

  IF public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN
    v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN
    v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid, 'compliance.reports.operational') THEN
    v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'CE-CASE-REQ-403: not authorised to read compliance case governance requests';
  END IF;

  SELECT ARRAY(SELECT DISTINCT x FROM unnest(
           COALESCE(public.ce_officer_identities(v_uid), ARRAY[]::text[]) || ARRAY[v_uid::text]
         ) x WHERE x IS NOT NULL AND x <> '')
    INTO v_codes;

  SELECT NULLIF(setting_value,'')::numeric INTO v_sla_days
  FROM public.ce_settings WHERE setting_key = 'compliance.case_requests.approval_sla_days';

  WITH scoped AS (
    SELECT
      r.id, r.case_id, r.request_type, r.target_case_id, r.reason, r.status,
      r.requested_by, r.requested_at, r.reviewed_by, r.reviewed_at,
      r.review_notes, r.metadata,
      c.case_number, c.employer_id, c.employer_name,
      upper(COALESCE(c.status,'UNKNOWN')) AS case_status,
      CASE upper(COALESCE(c.priority,''))
        WHEN 'URGENT' THEN 'CRITICAL' WHEN 'CRITICAL' THEN 'CRITICAL'
        WHEN 'HIGH' THEN 'HIGH' WHEN 'MEDIUM' THEN 'MEDIUM'
        WHEN 'LOW' THEN 'LOW' ELSE 'UNSET' END AS case_priority,
      COALESCE(NULLIF(upper(c.risk_band),''),'UNRATED') AS case_risk_band,
      COALESCE(c.total_amount,0)::numeric AS case_total_amount,
      c.closed_date, c.closure_reason, COALESCE(c.reopened_count,0) AS reopened_count,
      c.legal_case_id, c.assigned_officer_id, c.assigned_officer_name,
      t.case_number AS target_case_number,
      t.employer_id AS target_employer_id,
      t.employer_name AS target_employer_name,
      upper(COALESCE(t.status,'UNKNOWN')) AS target_case_status,
      rp.full_name AS requested_by_name,
      vp.full_name AS reviewed_by_name,
      (SELECT count(*) FROM public.ce_violations v
        WHERE v.case_id = c.id
          AND upper(COALESCE(v.status,'')) NOT IN ('RESOLVED','CLOSED','CANCELLED','WAIVED','WITHDRAWN')
      ) AS open_violations,
      (SELECT upper(a.status) FROM public.ce_payment_arrangements a
        WHERE a.case_id = c.id ORDER BY a.created_at DESC NULLS LAST LIMIT 1
      ) AS arrangement_state,
      GREATEST(EXTRACT(EPOCH FROM (now() - r.requested_at)) / 3600.0, 0)::numeric AS waiting_hours
    FROM public.ce_case_requests r
    JOIN public.ce_cases c ON c.id = r.case_id
    LEFT JOIN public.ce_cases t ON t.id = r.target_case_id
    LEFT JOIN public.profiles rp ON rp.user_code = r.requested_by
    LEFT JOIN public.profiles vp ON vp.user_code = r.reviewed_by
    WHERE r.request_type = v_type
      AND (
        v_scope IN ('enterprise','team')
        OR r.requested_by = ANY(v_codes)
        OR COALESCE(c.assigned_officer_id,'') = ANY(v_codes)
      )
  ), enriched AS (
    SELECT s.*,
      (s.waiting_hours / 24.0) AS waiting_days,
      CASE
        WHEN s.waiting_hours < 24 THEN 'LT_1D'
        WHEN s.waiting_hours < 24*4 THEN 'D1_3'
        WHEN s.waiting_hours < 24*8 THEN 'D4_7'
        WHEN s.waiting_hours < 24*15 THEN 'D8_14'
        ELSE 'D15_PLUS' END AS waiting_bucket,
      CASE WHEN v_sla_days IS NULL THEN false
           ELSE (s.waiting_hours / 24.0) > v_sla_days END AS sla_breached,
      CASE WHEN s.request_type = 'MERGE' AND s.target_case_id IS NOT NULL
           THEN (COALESCE(s.employer_id,'~a') = COALESCE(s.target_employer_id,'~b'))
           ELSE NULL END AS same_employer
    FROM scoped s
  ), matched AS (
    SELECT e.* FROM enriched e
    WHERE (f_search IS NULL
        OR e.case_number ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_name,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_id,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.requested_by,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.requested_by_name,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.reason,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.target_case_number,'') ILIKE '%'||f_search||'%')
      AND (f_employer IS NULL OR e.employer_id = f_employer)
      AND (f_case IS NULL OR e.case_id::text = f_case OR e.case_number = f_case)
      AND (f_requested_by IS NULL OR e.requested_by = f_requested_by)
      AND (f_reviewed_by IS NULL OR e.reviewed_by = f_reviewed_by)
      AND (f_date_from IS NULL OR e.requested_at >= f_date_from::timestamptz)
      AND (f_date_to IS NULL OR e.requested_at < (f_date_to + 1)::timestamptz)
      AND (f_rev_from IS NULL OR e.reviewed_at >= f_rev_from::timestamptz)
      AND (f_rev_to IS NULL OR e.reviewed_at < (f_rev_to + 1)::timestamptz)
      AND (f_waiting IS NULL OR e.waiting_bucket = f_waiting)
      AND (f_priorities IS NULL OR e.case_priority = ANY(f_priorities))
      AND (f_risks IS NULL OR e.case_risk_band = ANY(f_risks))
      AND (f_case_statuses IS NULL OR e.case_status = ANY(f_case_statuses))
      AND (f_amount_min IS NULL OR e.case_total_amount >= f_amount_min)
      AND (f_same_employer IS NULL
        OR (f_same_employer = 'SAME' AND e.same_employer IS TRUE)
        OR (f_same_employer = 'DIFFERENT' AND e.same_employer IS FALSE))
  ), tabbed AS (
    SELECT m.* FROM matched m WHERE m.status = v_status
  ), ordered AS (
    SELECT t.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort = 'recommended' AND t.status = 'PENDING'
             THEN (CASE WHEN t.sla_breached THEN 0 ELSE 1 END) END ASC,
        CASE WHEN v_sort = 'recommended' AND t.status = 'PENDING'
             THEN (CASE t.case_priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                     WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort = 'recommended' AND t.status = 'PENDING' THEN t.requested_at END ASC,
        CASE WHEN v_sort = 'recommended' AND t.status <> 'PENDING' THEN t.reviewed_at END DESC NULLS LAST,
        CASE WHEN v_sort IN ('waiting','requested_at') AND v_dir='asc' THEN t.requested_at END ASC,
        CASE WHEN v_sort IN ('waiting','requested_at') AND v_dir='desc' THEN t.requested_at END DESC,
        CASE WHEN v_sort = 'priority' AND v_dir='desc'
             THEN (CASE t.case_priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                     WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort = 'priority' AND v_dir='asc'
             THEN (CASE t.case_priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                     WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort = 'risk' AND v_dir='desc'
             THEN (CASE t.case_risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                     WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort = 'risk' AND v_dir='asc'
             THEN (CASE t.case_risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                     WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort = 'amount' AND v_dir='desc' THEN t.case_total_amount END DESC,
        CASE WHEN v_sort = 'amount' AND v_dir='asc' THEN t.case_total_amount END ASC,
        CASE WHEN v_sort = 'employer' AND v_dir='asc' THEN lower(COALESCE(t.employer_name,'')) END ASC,
        CASE WHEN v_sort = 'employer' AND v_dir='desc' THEN lower(COALESCE(t.employer_name,'')) END DESC,
        CASE WHEN v_sort = 'case_number' AND v_dir='asc' THEN t.case_number END ASC,
        CASE WHEN v_sort = 'case_number' AND v_dir='desc' THEN t.case_number END DESC,
        CASE WHEN v_sort = 'requested_by' AND v_dir='asc' THEN lower(COALESCE(t.requested_by_name,t.requested_by)) END ASC,
        CASE WHEN v_sort = 'requested_by' AND v_dir='desc' THEN lower(COALESCE(t.requested_by_name,t.requested_by)) END DESC,
        CASE WHEN v_sort = 'reviewed_at' AND v_dir='asc' THEN t.reviewed_at END ASC NULLS LAST,
        CASE WHEN v_sort = 'reviewed_at' AND v_dir='desc' THEN t.reviewed_at END DESC NULLS LAST,
        CASE WHEN v_sort = 'reviewed_by' AND v_dir='asc' THEN lower(COALESCE(t.reviewed_by_name,t.reviewed_by,'')) END ASC,
        CASE WHEN v_sort = 'reviewed_by' AND v_dir='desc' THEN lower(COALESCE(t.reviewed_by_name,t.reviewed_by,'')) END DESC,
        t.requested_at DESC
    ) AS rn
    FROM tabbed t
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'type', v_type,
    'status', v_status,
    'page', v_page,
    'page_size', v_size,
    'sort', v_sort,
    'dir', v_dir,
    'sla_days', v_sla_days,
    'total', (SELECT count(*) FROM tabbed),
    'status_counts', COALESCE((
      SELECT jsonb_object_agg(s, n) FROM (
        SELECT m.status AS s, count(*) AS n FROM matched m GROUP BY m.status
      ) q
    ), '{}'::jsonb),
    'kpis', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE e.status='PENDING'),
        'sla_breached', count(*) FILTER (WHERE e.status='PENDING' AND e.sla_breached),
        'waiting_gt_3d', count(*) FILTER (WHERE e.status='PENDING' AND e.waiting_hours > 72),
        'critical_high', count(*) FILTER (WHERE e.status='PENDING' AND e.case_priority IN ('CRITICAL','HIGH')),
        'exposure', COALESCE(sum(e.case_total_amount) FILTER (WHERE e.status='PENDING'),0),
        'oldest_pending_days', COALESCE(round(max(e.waiting_days) FILTER (WHERE e.status='PENDING'),1),0),
        'approved', count(*) FILTER (WHERE e.status='APPROVED'),
        'rejected', count(*) FILTER (WHERE e.status='REJECTED'),
        'cancelled', count(*) FILTER (WHERE e.status='CANCELLED')
      ) FROM enriched e
    ),
    'options', jsonb_build_object(
      'employers', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', e.employer_id, 'name', COALESCE(e.employer_name,e.employer_id))), '[]'::jsonb)
                    FROM enriched e WHERE e.employer_id IS NOT NULL),
      'cases', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', e.case_id::text, 'name', e.case_number)), '[]'::jsonb)
                FROM enriched e WHERE e.case_number IS NOT NULL),
      'requesters', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', e.requested_by, 'name', COALESCE(e.requested_by_name, e.requested_by))), '[]'::jsonb)
                     FROM enriched e WHERE e.requested_by IS NOT NULL),
      'reviewers', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', e.reviewed_by, 'name', COALESCE(e.reviewed_by_name, e.reviewed_by))), '[]'::jsonb)
                    FROM enriched e WHERE e.reviewed_by IS NOT NULL),
      'case_statuses', (SELECT COALESCE(jsonb_agg(DISTINCT e.case_status), '[]'::jsonb) FROM enriched e),
      'priorities', (SELECT COALESCE(jsonb_agg(DISTINCT e.case_priority), '[]'::jsonb) FROM enriched e),
      'risk_bands', (SELECT COALESCE(jsonb_agg(DISTINCT e.case_risk_band), '[]'::jsonb) FROM enriched e)
    ),
    'rows', (
      SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.rn), '[]'::jsonb)
      FROM ordered o
      WHERE o.rn > (v_page-1)*v_size AND o.rn <= v_page*v_size
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ce_case_requests_v1(text,text,jsonb,text,text,integer,integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ce_case_requests_v1(text,text,jsonb,text,text,integer,integer) FROM anon;