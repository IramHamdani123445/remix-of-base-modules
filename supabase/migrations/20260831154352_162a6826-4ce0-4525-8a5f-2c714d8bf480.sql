CREATE INDEX IF NOT EXISTS idx_ce_cases_assigned_officer ON public.ce_cases (assigned_officer_id) WHERE COALESCE(is_deleted,false) = false;
CREATE INDEX IF NOT EXISTS idx_ce_case_assignments_case_active ON public.ce_case_assignments (case_id, is_active);

-- Canonical resolution of every identifier ce_cases.assigned_officer_id may
-- hold for one auth user: ce_inspectors.id, inspector_code,
-- legacy_inspector_code and the auth uid / profile id themselves.
CREATE OR REPLACE FUNCTION public.ce_officer_identities(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT x FROM (
      SELECT _user_id::text AS x WHERE _user_id IS NOT NULL
      UNION ALL SELECT i.id::text FROM public.ce_inspectors i WHERE i.profile_id = _user_id
      UNION ALL SELECT i.inspector_code FROM public.ce_inspectors i WHERE i.profile_id = _user_id
      UNION ALL SELECT i.legacy_inspector_code FROM public.ce_inspectors i WHERE i.profile_id = _user_id
    ) s WHERE NULLIF(trim(COALESCE(x,'')),'') IS NOT NULL
  ), ARRAY[]::text[]);
$function$;

REVOKE ALL ON FUNCTION public.ce_officer_identities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_officer_identities(uuid) TO authenticated;

-- Identifiers of the officers a user supervises (plus their own), used for the
-- "My Team" ownership scope.
CREATE OR REPLACE FUNCTION public.ce_team_officer_identities(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT x FROM (
      SELECT unnest(public.ce_officer_identities(_user_id)) AS x
      UNION ALL
      SELECT t.id::text FROM public.ce_inspectors t
        WHERE t.supervisor_id IN (SELECT i.id FROM public.ce_inspectors i WHERE i.profile_id = _user_id)
      UNION ALL
      SELECT t.inspector_code FROM public.ce_inspectors t
        WHERE t.supervisor_id IN (SELECT i.id FROM public.ce_inspectors i WHERE i.profile_id = _user_id)
      UNION ALL
      SELECT t.legacy_inspector_code FROM public.ce_inspectors t
        WHERE t.supervisor_id IN (SELECT i.id FROM public.ce_inspectors i WHERE i.profile_id = _user_id)
    ) s WHERE NULLIF(trim(COALESCE(x,'')),'') IS NOT NULL
  ), ARRAY[]::text[]);
$function$;

REVOKE ALL ON FUNCTION public.ce_team_officer_identities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_team_officer_identities(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ce_assigned_cases_v1(
  p_scope text DEFAULT 'mine',
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'recommended',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),5),200);
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'recommended');
  v_req text := lower(COALESCE(NULLIF(p_scope,''),'mine'));
  v_scope text;
  v_can_team boolean;
  v_can_all boolean;
  v_can_assign boolean;
  v_ids text[];
  v_team_ids text[];
  v_filter_ids text[];
  v_identity_resolved boolean;
  v_result jsonb;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_employer text := NULLIF(p_filters->>'employer','');
  f_officer text := NULLIF(p_filters->>'officer','');
  f_families text[] := CASE WHEN COALESCE(p_filters->>'families','')='' THEN NULL
                            ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'families') x) END;
  f_statuses text[] := CASE WHEN COALESCE(p_filters->>'statuses','')='' THEN NULL
                            ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'statuses') x) END;
  f_priorities text[] := CASE WHEN COALESCE(p_filters->>'priorities','')='' THEN NULL
                              ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'priorities') x) END;
  f_risks text[] := CASE WHEN COALESCE(p_filters->>'risk_bands','')='' THEN NULL
                         ELSE ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(p_filters->'risk_bands') x) END;
  f_territory text := NULLIF(p_filters->>'territory','');
  f_due text := NULLIF(upper(p_filters->>'due'),'');
  f_age text := NULLIF(upper(p_filters->>'age'),'');
  f_opened text := NULLIF(upper(p_filters->>'opened'),'');
  f_recent text := NULLIF(upper(p_filters->>'assigned'),'');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
  f_include_closed boolean := COALESCE((p_filters->>'include_closed')::boolean,false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-ASSIGNED-401: authentication required';
  END IF;

  v_can_all := public.ce_actor_can(v_uid,'compliance.workbench.enterprise');
  v_can_team := v_can_all OR public.ce_actor_can(v_uid,'compliance.workbench.team');
  v_can_assign := public.ce_actor_can(v_uid,'compliance.cases.manage');

  IF NOT (v_can_team OR v_can_assign OR public.ce_actor_can(v_uid,'compliance.reports.operational')) THEN
    RAISE EXCEPTION 'CE-ASSIGNED-403: not authorised to read compliance assigned cases';
  END IF;

  v_ids := public.ce_officer_identities(v_uid);
  v_team_ids := public.ce_team_officer_identities(v_uid);
  v_identity_resolved := EXISTS (SELECT 1 FROM public.ce_inspectors i WHERE i.profile_id = v_uid);

  v_scope := CASE
    WHEN v_req = 'all' AND v_can_all THEN 'all'
    WHEN v_req = 'team' AND v_can_team THEN 'team'
    ELSE 'mine' END;

  v_filter_ids := CASE v_scope WHEN 'mine' THEN v_ids WHEN 'team' THEN v_team_ids ELSE NULL END;

  WITH scoped AS (
    SELECT
      c.id,
      c.case_number,
      c.employer_id,
      c.employer_name,
      COALESCE(NULLIF(trim(c.territory),''),'Unassigned') AS territory,
      upper(COALESCE(c.status,'UNKNOWN')) AS status,
      CASE upper(COALESCE(c.priority,''))
        WHEN 'URGENT' THEN 'CRITICAL' WHEN 'CRITICAL' THEN 'CRITICAL'
        WHEN 'HIGH' THEN 'HIGH' WHEN 'MEDIUM' THEN 'MEDIUM' WHEN 'LOW' THEN 'LOW'
        ELSE 'UNSET' END AS priority,
      COALESCE(NULLIF(upper(c.risk_band),''),'UNRATED') AS risk_band,
      c.risk_score,
      COALESCE(c.total_amount,0)::numeric AS total_amount,
      c.opened_date,
      c.target_resolution_date,
      COALESCE(NULLIF(upper(c.case_family),''),'UNCLASSIFIED') AS case_family,
      trim(c.assigned_officer_id) AS assigned_officer_id,
      COALESCE(NULLIF(trim(c.assigned_officer_name),''), trim(c.assigned_officer_id)) AS assigned_officer_name,
      (trim(c.assigned_officer_id) = ANY(v_ids)) AS is_mine,
      GREATEST(0,(CURRENT_DATE - COALESCE(c.opened_date, c.created_at::date, CURRENT_DATE))) AS days_open,
      a.assigned_at,
      a.reassigned
    FROM public.ce_cases c
    LEFT JOIN LATERAL (
      SELECT max(x.assigned_at) FILTER (WHERE x.is_active) AS assigned_at,
             (count(*) > 1) AS reassigned
      FROM public.ce_case_assignments x WHERE x.case_id = c.id
    ) a ON true
    WHERE COALESCE(c.is_deleted,false) = false
      AND COALESCE(c.is_merged,false) = false
      AND NULLIF(trim(COALESCE(c.assigned_officer_id,'')),'') IS NOT NULL
      AND (f_include_closed OR (c.closed_date IS NULL
           AND upper(COALESCE(c.status,'')) NOT IN ('CLOSED','RESOLVED','COMPLETED','CANCELLED','WITHDRAWN')))
      AND (v_filter_ids IS NULL OR trim(c.assigned_officer_id) = ANY(v_filter_ids))
  ), enriched AS (
    SELECT s.*,
      CASE WHEN s.assigned_at IS NULL THEN NULL
           ELSE GREATEST(0,(CURRENT_DATE - s.assigned_at::date)) END AS days_assigned,
      CASE
        WHEN s.target_resolution_date IS NULL THEN 'NONE'
        WHEN s.target_resolution_date < CURRENT_DATE THEN 'OVERDUE'
        WHEN s.target_resolution_date = CURRENT_DATE THEN 'TODAY'
        WHEN s.target_resolution_date <= CURRENT_DATE + 3 THEN '1_3'
        WHEN s.target_resolution_date <= CURRENT_DATE + 7 THEN 'WEEK'
        ELSE 'LATER' END AS due_bucket,
      CASE
        WHEN s.days_open <= 7 THEN '0_7'
        WHEN s.days_open <= 30 THEN '8_30'
        WHEN s.days_open <= 60 THEN '31_60'
        WHEN s.days_open <= 90 THEN '61_90'
        WHEN s.days_open <= 180 THEN '91_180'
        ELSE '180_PLUS' END AS age_bucket
    FROM scoped s
  ), filtered AS (
    SELECT e.* FROM enriched e
    WHERE (f_search IS NULL
        OR e.case_number ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_name,'') ILIKE '%'||f_search||'%'
        OR COALESCE(e.employer_id,'') ILIKE '%'||f_search||'%'
        OR (v_scope <> 'mine' AND COALESCE(e.assigned_officer_name,'') ILIKE '%'||f_search||'%'))
      AND (f_employer IS NULL OR e.employer_id = f_employer)
      AND (f_officer IS NULL OR v_scope = 'mine' OR e.assigned_officer_id = f_officer)
      AND (f_families IS NULL OR e.case_family = ANY(f_families))
      AND (f_statuses IS NULL OR e.status = ANY(f_statuses))
      AND (f_priorities IS NULL OR e.priority = ANY(f_priorities))
      AND (f_risks IS NULL OR e.risk_band = ANY(f_risks))
      AND (f_territory IS NULL OR e.territory = f_territory)
      AND (f_due IS NULL OR
           (f_due='DUE_WEEK' AND e.due_bucket IN ('OVERDUE','TODAY','1_3','WEEK')) OR
           (f_due NOT IN ('DUE_WEEK') AND e.due_bucket = f_due))
      AND (f_age IS NULL OR e.age_bucket = f_age)
      AND (f_recent IS NULL OR
           (f_recent='7' AND e.assigned_at >= now() - interval '7 days') OR
           (f_recent='30' AND e.assigned_at >= now() - interval '30 days'))
      AND (f_opened IS NULL OR
           (f_opened='TODAY' AND e.opened_date = CURRENT_DATE) OR
           (f_opened='7' AND e.opened_date >= CURRENT_DATE - 7) OR
           (f_opened='30' AND e.opened_date >= CURRENT_DATE - 30) OR
           (f_opened='90' AND e.opened_date >= CURRENT_DATE - 90))
      AND (f_date_from IS NULL OR e.opened_date >= f_date_from)
      AND (f_date_to IS NULL OR e.opened_date <= f_date_to)
  ), ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='recommended' THEN (CASE WHEN f.due_bucket='OVERDUE' THEN 0 ELSE 1 END) END ASC,
        CASE WHEN v_sort='recommended' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='recommended' THEN f.target_resolution_date END ASC NULLS LAST,
        CASE WHEN v_sort='recommended' THEN f.days_open END DESC,
        CASE WHEN v_sort='due' AND v_dir='asc' THEN f.target_resolution_date END ASC NULLS LAST,
        CASE WHEN v_sort='due' AND v_dir='desc' THEN f.target_resolution_date END DESC NULLS LAST,
        CASE WHEN v_sort='priority' AND v_dir='desc' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='priority' AND v_dir='asc' THEN (CASE f.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort='risk' AND v_dir='desc' THEN (CASE f.risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END ASC,
        CASE WHEN v_sort='risk' AND v_dir='asc' THEN (CASE f.risk_band WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END) END DESC,
        CASE WHEN v_sort='age' AND v_dir='desc' THEN f.days_open END DESC,
        CASE WHEN v_sort='age' AND v_dir='asc' THEN f.days_open END ASC,
        CASE WHEN v_sort='assigned' AND v_dir='desc' THEN f.assigned_at END DESC NULLS LAST,
        CASE WHEN v_sort='assigned' AND v_dir='asc' THEN f.assigned_at END ASC NULLS LAST,
        CASE WHEN v_sort='opened_date' AND v_dir='desc' THEN f.opened_date END DESC NULLS LAST,
        CASE WHEN v_sort='opened_date' AND v_dir='asc' THEN f.opened_date END ASC NULLS LAST,
        CASE WHEN v_sort='amount' AND v_dir='desc' THEN f.total_amount END DESC,
        CASE WHEN v_sort='amount' AND v_dir='asc' THEN f.total_amount END ASC,
        CASE WHEN v_sort='employer' AND v_dir='asc' THEN lower(COALESCE(f.employer_name,f.employer_id,'')) END ASC,
        CASE WHEN v_sort='employer' AND v_dir='desc' THEN lower(COALESCE(f.employer_name,f.employer_id,'')) END DESC,
        CASE WHEN v_sort='officer' AND v_dir='asc' THEN lower(COALESCE(f.assigned_officer_name,'')) END ASC,
        CASE WHEN v_sort='officer' AND v_dir='desc' THEN lower(COALESCE(f.assigned_officer_name,'')) END DESC,
        CASE WHEN v_sort='case_number' AND v_dir='asc' THEN lower(f.case_number) END ASC,
        CASE WHEN v_sort='case_number' AND v_dir='desc' THEN lower(f.case_number) END DESC,
        f.target_resolution_date ASC NULLS LAST,
        f.case_number ASC
    ) AS rn
    FROM filtered f
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'requested_scope', v_req,
    'can_team', v_can_team,
    'can_all', v_can_all,
    'can_assign', v_can_assign,
    'identity_resolved', v_identity_resolved,
    'officer_identities', to_jsonb(v_ids),
    'page', v_page,
    'page_size', v_size,
    'sort', v_sort,
    'dir', v_dir,
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.rn)
      FROM ranked r WHERE r.rn > (v_page-1)*v_size AND r.rn <= v_page*v_size
    ),'[]'::jsonb),
    'kpis_all', (
      SELECT jsonb_build_object(
        'total', count(*),
        'overdue', count(*) FILTER (WHERE due_bucket='OVERDUE'),
        'due_today', count(*) FILTER (WHERE due_bucket='TODAY'),
        'due_week', count(*) FILTER (WHERE due_bucket IN ('OVERDUE','TODAY','1_3','WEEK')),
        'critical_high', count(*) FILTER (WHERE priority IN ('CRITICAL','HIGH')),
        'high_risk', count(*) FILTER (WHERE risk_band IN ('CRITICAL','HIGH')),
        'exposure', COALESCE(sum(total_amount),0),
        'oldest', COALESCE(max(days_open),0)
      ) FROM enriched
    ),
    'kpis_filtered', (
      SELECT jsonb_build_object(
        'total', count(*),
        'overdue', count(*) FILTER (WHERE due_bucket='OVERDUE'),
        'due_today', count(*) FILTER (WHERE due_bucket='TODAY'),
        'due_week', count(*) FILTER (WHERE due_bucket IN ('OVERDUE','TODAY','1_3','WEEK')),
        'critical_high', count(*) FILTER (WHERE priority IN ('CRITICAL','HIGH')),
        'high_risk', count(*) FILTER (WHERE risk_band IN ('CRITICAL','HIGH')),
        'exposure', COALESCE(sum(total_amount),0),
        'oldest', COALESCE(max(days_open),0)
      ) FROM filtered
    ),
    'options', jsonb_build_object(
      'statuses', COALESCE((SELECT jsonb_agg(DISTINCT status ORDER BY status) FROM enriched),'[]'::jsonb),
      'priorities', COALESCE((SELECT jsonb_agg(DISTINCT priority ORDER BY priority) FROM enriched),'[]'::jsonb),
      'risk_bands', COALESCE((SELECT jsonb_agg(DISTINCT risk_band ORDER BY risk_band) FROM enriched),'[]'::jsonb),
      'families', COALESCE((SELECT jsonb_agg(DISTINCT case_family ORDER BY case_family) FROM enriched),'[]'::jsonb),
      'territories', COALESCE((SELECT jsonb_agg(DISTINCT territory ORDER BY territory) FROM enriched),'[]'::jsonb),
      'employers', COALESCE((
        SELECT jsonb_agg(e ORDER BY e->>'name') FROM (
          SELECT DISTINCT jsonb_build_object('id', employer_id, 'name', COALESCE(employer_name, employer_id)) AS e
          FROM enriched WHERE employer_id IS NOT NULL) y
      ),'[]'::jsonb),
      'officers', CASE WHEN v_scope='mine' THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(o ORDER BY o->>'name') FROM (
          SELECT DISTINCT jsonb_build_object('id', assigned_officer_id, 'name', COALESCE(assigned_officer_name, assigned_officer_id)) AS o
          FROM enriched WHERE assigned_officer_id IS NOT NULL) z
      ),'[]'::jsonb) END
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_assigned_cases_v1(text, jsonb, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ce_assigned_cases_v1(text, jsonb, text, text, integer, integer) TO authenticated;