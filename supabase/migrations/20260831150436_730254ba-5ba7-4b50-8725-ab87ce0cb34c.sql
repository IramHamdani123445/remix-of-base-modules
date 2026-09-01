-- Violation History: enterprise server-side filtering, sorting, paging
CREATE INDEX IF NOT EXISTS idx_ce_violation_history_performed_at
  ON public.ce_violation_history (performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_violation_history_violation_performed
  ON public.ce_violation_history (violation_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_violation_history_action
  ON public.ce_violation_history (action);
CREATE INDEX IF NOT EXISTS idx_ce_violation_history_performed_by
  ON public.ce_violation_history (performed_by);

CREATE OR REPLACE FUNCTION public.ce_violation_history_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'performed_at',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_export boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_own boolean;
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := CASE WHEN p_export THEN 20000 ELSE LEAST(GREATEST(COALESCE(p_page_size,25),5),200) END;
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_sort text := COALESCE(NULLIF(p_sort,''),'performed_at');
  v_total bigint := 0;
  v_grand bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_options jsonb := '{}'::jsonb;
  v_summary jsonb := NULL;

  f_search text := NULLIF(trim(p_filters->>'search'),'');
  f_employer text := NULLIF(p_filters->>'employer','');
  f_violation uuid := NULLIF(p_filters->>'violation_id','')::uuid;
  f_vtype uuid := NULLIF(p_filters->>'violation_type','')::uuid;
  f_action text := NULLIF(p_filters->>'action','');
  f_performer text := NULLIF(p_filters->>'performed_by','');
  f_from text := NULLIF(p_filters->>'from_value','');
  f_to text := NULLIF(p_filters->>'to_value','');
  f_date_from date := NULLIF(p_filters->>'date_from','')::date;
  f_date_to date := NULLIF(p_filters->>'date_to','')::date;
BEGIN
  IF public.ce_actor_can(v_uid, 'compliance.workbench.enterprise') THEN
    v_scope := 'enterprise';
  ELSIF public.ce_actor_can(v_uid, 'compliance.workbench.team') THEN
    v_scope := 'team';
  ELSIF public.ce_actor_can(v_uid, 'compliance.reports.operational') THEN
    v_scope := 'own';
  ELSE
    RAISE EXCEPTION 'Not authorised for violation history';
  END IF;
  v_own := (v_scope = 'own');

  CREATE TEMP TABLE _vh_scope ON COMMIT DROP AS
  SELECT h.id, h.violation_id, h.action, h.from_value, h.to_value, h.notes,
         h.performed_by, h.performed_at,
         v.violation_number, v.employer_id, v.employer_name, v.status AS violation_status,
         v.violation_type_id, COALESCE(vt.name,'—') AS violation_type
  FROM public.ce_violation_history h
  JOIN public.ce_violations v ON v.id = h.violation_id
  LEFT JOIN public.ce_violation_types vt ON vt.id = v.violation_type_id
  WHERE COALESCE(v.is_deleted,false) = false
    AND (NOT v_own OR v.assigned_to_user_id = v_uid::text);

  SELECT count(*) INTO v_grand FROM _vh_scope;

  CREATE TEMP TABLE _vh ON COMMIT DROP AS
  SELECT * FROM _vh_scope s
  WHERE (f_violation IS NULL OR s.violation_id = f_violation)
    AND (f_employer IS NULL OR s.employer_id = f_employer)
    AND (f_vtype IS NULL OR s.violation_type_id = f_vtype)
    AND (f_action IS NULL OR s.action = f_action)
    AND (f_performer IS NULL OR s.performed_by = f_performer)
    AND (f_from IS NULL OR upper(COALESCE(s.from_value,'')) = upper(f_from))
    AND (f_to IS NULL OR upper(COALESCE(s.to_value,'')) = upper(f_to))
    AND (f_date_from IS NULL OR s.performed_at >= f_date_from::timestamptz)
    AND (f_date_to IS NULL OR s.performed_at < (f_date_to + 1)::timestamptz)
    AND (f_search IS NULL OR (
        s.violation_number ILIKE '%'||f_search||'%'
     OR COALESCE(s.employer_name,'') ILIKE '%'||f_search||'%'
     OR COALESCE(s.employer_id,'') ILIKE '%'||f_search||'%'
     OR COALESCE(s.notes,'') ILIKE '%'||f_search||'%'
     OR COALESCE(s.performed_by,'') ILIKE '%'||f_search||'%'
     OR s.action ILIKE '%'||f_search||'%'));

  SELECT count(*) INTO v_total FROM _vh;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.rn), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT row_number() OVER (
      ORDER BY
        CASE WHEN v_sort='employer' AND v_dir='asc' THEN lower(COALESCE(employer_name, employer_id,'')) END ASC,
        CASE WHEN v_sort='employer' AND v_dir='desc' THEN lower(COALESCE(employer_name, employer_id,'')) END DESC,
        CASE WHEN v_sort='violation' AND v_dir='asc' THEN violation_number END ASC,
        CASE WHEN v_sort='violation' AND v_dir='desc' THEN violation_number END DESC,
        CASE WHEN v_sort='action' AND v_dir='asc' THEN lower(action) END ASC,
        CASE WHEN v_sort='action' AND v_dir='desc' THEN lower(action) END DESC,
        CASE WHEN v_sort='performed_by' AND v_dir='asc' THEN lower(COALESCE(performed_by,'')) END ASC,
        CASE WHEN v_sort='performed_by' AND v_dir='desc' THEN lower(COALESCE(performed_by,'')) END DESC,
        CASE WHEN v_sort='from_value' AND v_dir='asc' THEN lower(COALESCE(from_value,'')) END ASC,
        CASE WHEN v_sort='from_value' AND v_dir='desc' THEN lower(COALESCE(from_value,'')) END DESC,
        CASE WHEN v_sort='to_value' AND v_dir='asc' THEN lower(COALESCE(to_value,'')) END ASC,
        CASE WHEN v_sort='to_value' AND v_dir='desc' THEN lower(COALESCE(to_value,'')) END DESC,
        CASE WHEN v_sort NOT IN ('employer','violation','action','performed_by','from_value','to_value')
              AND v_dir='asc' THEN performed_at END ASC,
        CASE WHEN v_sort NOT IN ('employer','violation','action','performed_by','from_value','to_value')
              AND v_dir='desc' THEN performed_at END DESC,
        performed_at DESC
    ) AS rn,
    id, violation_id, action, from_value, to_value, notes, performed_by, performed_at,
    violation_number, employer_id, employer_name, violation_status, violation_type
    FROM _vh
  ) t
  WHERE t.rn > CASE WHEN p_export THEN 0 ELSE (v_page-1)*v_size END
    AND t.rn <= CASE WHEN p_export THEN v_size ELSE v_page*v_size END;

  IF NOT p_export THEN
    SELECT jsonb_build_object(
      'actions', (SELECT COALESCE(jsonb_agg(DISTINCT action ORDER BY action),'[]') FROM _vh_scope WHERE action IS NOT NULL),
      'performers', (SELECT COALESCE(jsonb_agg(DISTINCT performed_by ORDER BY performed_by),'[]') FROM _vh_scope WHERE performed_by IS NOT NULL),
      'from_values', (SELECT COALESCE(jsonb_agg(DISTINCT from_value ORDER BY from_value),'[]') FROM _vh_scope WHERE from_value IS NOT NULL),
      'to_values', (SELECT COALESCE(jsonb_agg(DISTINCT to_value ORDER BY to_value),'[]') FROM _vh_scope WHERE to_value IS NOT NULL),
      'employers', (SELECT COALESCE(jsonb_agg(e ORDER BY e->>'name'),'[]') FROM (
            SELECT DISTINCT jsonb_build_object('id', employer_id, 'name', COALESCE(employer_name, employer_id)) AS e
            FROM _vh_scope WHERE employer_id IS NOT NULL) x),
      'violation_types', (SELECT COALESCE(jsonb_agg(t2 ORDER BY t2->>'name'),'[]') FROM (
            SELECT DISTINCT jsonb_build_object('id', violation_type_id, 'name', violation_type) AS t2
            FROM _vh_scope WHERE violation_type_id IS NOT NULL) y),
      'violations', (SELECT COALESCE(jsonb_agg(v2 ORDER BY v2->>'number' DESC),'[]') FROM (
            SELECT DISTINCT jsonb_build_object(
              'id', violation_id, 'number', violation_number,
              'employer_id', employer_id, 'employer_name', employer_name) AS v2
            FROM _vh_scope
            WHERE f_employer IS NULL OR employer_id = f_employer) z)
    ) INTO v_options;

    IF f_violation IS NOT NULL THEN
      SELECT jsonb_build_object(
        'violation_id', v.id, 'violation_number', v.violation_number,
        'employer_id', v.employer_id, 'employer_name', v.employer_name,
        'violation_type', COALESCE(vt.name,'—'), 'status', v.status,
        'created_at', v.created_at, 'assignee', v.assigned_to_name,
        'event_count', (SELECT count(*) FROM _vh_scope s WHERE s.violation_id = v.id))
      INTO v_summary
      FROM public.ce_violations v
      LEFT JOIN public.ce_violation_types vt ON vt.id = v.violation_type_id
      WHERE v.id = f_violation AND COALESCE(v.is_deleted,false) = false
        AND (NOT v_own OR v.assigned_to_user_id = v_uid::text);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(), 'scope', v_scope,
    'page', v_page, 'page_size', v_size,
    'total', v_total, 'grand_total', v_grand,
    'sort', v_sort, 'dir', v_dir,
    'rows', v_rows, 'options', v_options, 'summary', v_summary);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ce_violation_history_v1(jsonb, text, text, integer, integer, boolean) TO authenticated;