CREATE OR REPLACE FUNCTION public.ce_arrangement_register_v1(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tab text := COALESCE(p_params->>'tab','ALL');
  v_search text := NULLIF(btrim(COALESCE(p_params->>'search','')),'');
  v_employer text := NULLIF(btrim(COALESCE(p_params->>'employer_id','')),'');
  v_case text := NULLIF(btrim(COALESCE(p_params->>'case_id','')),'');
  v_statuses text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'statuses','[]'::jsonb))),'{}');
  v_health text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'health','[]'::jsonb))),'{}');
  v_freq text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_params->'frequencies','[]'::jsonb))),'{}');
  v_due text := NULLIF(COALESCE(p_params->>'due_window',''),'');
  v_created text := NULLIF(COALESCE(p_params->>'created_window',''),'');
  v_from date := NULLIF(COALESCE(p_params->>'created_from',''),'')::date;
  v_to date := NULLIF(COALESCE(p_params->>'created_to',''),'')::date;
  v_min numeric := NULLIF(COALESCE(p_params->>'min_outstanding',''),'')::numeric;
  v_sort text := COALESCE(p_params->>'sort','attention');
  v_dir text := CASE WHEN lower(COALESCE(p_params->>'dir','desc'))='asc' THEN 'asc' ELSE 'desc' END;
  v_page int := GREATEST(1, COALESCE((p_params->>'page')::int,1));
  v_size int := LEAST(200, GREATEST(10, COALESCE((p_params->>'page_size')::int,25)));
  v_appr_days numeric := COALESCE((SELECT numeric_value FROM public.ce_arrangement_ref WHERE domain='THRESHOLD' AND code='APPROVAL_AGEING_DAYS'),3);
  v_draft_days numeric := COALESCE((SELECT numeric_value FROM public.ce_arrangement_ref WHERE domain='THRESHOLD' AND code='DRAFT_STALE_DAYS'),10);
  v_soon_days numeric := COALESCE((SELECT numeric_value FROM public.ce_arrangement_ref WHERE domain='THRESHOLD' AND code='DUE_SOON_DAYS'),7);
  v_total int; v_rows jsonb; v_kpis jsonb; v_tabs jsonb; v_attention jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.enforcement.arrangements')
       OR public.ce_actor_can(v_uid,'compliance.workbench.team')
       OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  WITH base AS (
    SELECT v.*,
      (v.health_status = 'BREACHED' OR COALESCE(v.unresolved_breach_count,0) > 0) AS is_breached,
      (v.status = 'ACTIVE' AND COALESCE(v.overdue_count,0) >= GREATEST(COALESCE(v.max_missed_before_breach,2),1)) AS breach_imminent,
      (v.status = 'ACTIVE' AND COALESCE(v.overdue_count,0) > 0) AS has_overdue,
      (v.status = 'PENDING_APPROVAL' AND COALESCE(v.submitted_at, v.created_at) < now() - (v_appr_days || ' days')::interval) AS approval_stale,
      (v.status = 'DRAFT' AND v.created_at < now() - (v_draft_days || ' days')::interval) AS draft_stale,
      (COALESCE(v.unattributed_amount,0) > 0) AS has_unallocated,
      (v.status = 'ACTIVE' AND v.next_due_date IS NULL AND COALESCE(v.installments_paid,0) < COALESCE(v.installments_total,0)) AS schedule_gap,
      (v.status = 'ACTIVE' AND v.next_due_date IS NOT NULL
        AND v.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + v_soon_days::int) AS due_soon
    FROM public.ce_v_arrangement_register_ext v
  ), scored AS (
    SELECT b.*,
      (CASE WHEN b.is_breached THEN 60 ELSE 0 END
     + CASE WHEN b.breach_imminent THEN 45 ELSE 0 END
     + CASE WHEN b.has_overdue THEN 30 ELSE 0 END
     + CASE WHEN b.approval_stale THEN 35 ELSE 0 END
     + CASE WHEN b.has_unallocated THEN 25 ELSE 0 END
     + CASE WHEN b.schedule_gap THEN 20 ELSE 0 END
     + CASE WHEN b.draft_stale THEN 15 ELSE 0 END
     + CASE WHEN b.due_soon THEN 10 ELSE 0 END) AS attention_score
    FROM base b
  ), filtered AS (
    SELECT s.* FROM scored s
    WHERE (v_search IS NULL OR (
            s.arrangement_number ILIKE '%'||v_search||'%' OR
            COALESCE(s.employer_name,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.employer_id,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.regno,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.case_number,'') ILIKE '%'||v_search||'%' OR
            COALESCE(s.arrangement_default_violation_number,'') ILIKE '%'||v_search||'%'))
      AND (v_employer IS NULL OR s.employer_id = v_employer)
      AND (v_case IS NULL OR s.case_id::text = v_case)
      AND (cardinality(v_statuses)=0 OR s.status = ANY(v_statuses))
      AND (cardinality(v_health)=0 OR s.health_status = ANY(v_health))
      AND (cardinality(v_freq)=0 OR upper(COALESCE(s.frequency,'')) = ANY(v_freq))
      AND (v_min IS NULL OR COALESCE(s.outstanding,0) >= v_min)
      AND (v_due IS NULL OR CASE v_due
             WHEN 'OVERDUE' THEN COALESCE(s.overdue_count,0) > 0
             WHEN 'TODAY' THEN s.next_due_date = CURRENT_DATE
             WHEN 'D7' THEN s.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
             WHEN 'D30' THEN s.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
             WHEN 'NONE' THEN s.next_due_date IS NULL
             ELSE true END)
      AND (v_created IS NULL OR CASE v_created
             WHEN 'TODAY' THEN s.created_at::date = CURRENT_DATE
             WHEN 'D7' THEN s.created_at >= now() - interval '7 days'
             WHEN 'D30' THEN s.created_at >= now() - interval '30 days'
             WHEN 'D90' THEN s.created_at >= now() - interval '90 days'
             WHEN 'CUSTOM' THEN (v_from IS NULL OR s.created_at::date >= v_from) AND (v_to IS NULL OR s.created_at::date <= v_to)
             ELSE true END)
      AND CASE v_tab
            WHEN 'ATTENTION' THEN s.attention_score > 0
            WHEN 'ACTIVE' THEN s.status='ACTIVE'
            WHEN 'PENDING_APPROVAL' THEN s.status='PENDING_APPROVAL'
            WHEN 'DRAFT' THEN s.status='DRAFT'
            WHEN 'BREACHED' THEN s.is_breached
            WHEN 'OVERDUE' THEN COALESCE(s.overdue_count,0) > 0
            WHEN 'UNALLOCATED' THEN s.has_unallocated
            WHEN 'CLOSED' THEN s.status IN ('COMPLETED','CANCELLED','SUPERSEDED','DEFAULTED')
            ELSE true END
  ), pageset AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN v_sort='attention' THEN f.attention_score END DESC NULLS LAST,
      CASE WHEN v_sort='arrangement_number' AND v_dir='asc' THEN f.arrangement_number END ASC,
      CASE WHEN v_sort='arrangement_number' AND v_dir='desc' THEN f.arrangement_number END DESC,
      CASE WHEN v_sort='employer' AND v_dir='asc' THEN COALESCE(f.employer_name,f.employer_id) END ASC,
      CASE WHEN v_sort='employer' AND v_dir='desc' THEN COALESCE(f.employer_name,f.employer_id) END DESC,
      CASE WHEN v_sort='status' AND v_dir='asc' THEN f.status_label END ASC,
      CASE WHEN v_sort='status' AND v_dir='desc' THEN f.status_label END DESC,
      CASE WHEN v_sort='health' AND v_dir='asc' THEN f.health_label END ASC,
      CASE WHEN v_sort='health' AND v_dir='desc' THEN f.health_label END DESC,
      CASE WHEN v_sort='outstanding' AND v_dir='asc' THEN COALESCE(f.outstanding,0) END ASC,
      CASE WHEN v_sort='outstanding' AND v_dir='desc' THEN COALESCE(f.outstanding,0) END DESC,
      CASE WHEN v_sort='past_due' AND v_dir='asc' THEN COALESCE(f.past_due_amount,0) END ASC,
      CASE WHEN v_sort='past_due' AND v_dir='desc' THEN COALESCE(f.past_due_amount,0) END DESC,
      CASE WHEN v_sort='next_due_date' AND v_dir='asc' THEN f.next_due_date END ASC NULLS LAST,
      CASE WHEN v_sort='next_due_date' AND v_dir='desc' THEN f.next_due_date END DESC NULLS LAST,
      CASE WHEN v_sort='paid_percent' AND v_dir='asc' THEN COALESCE(f.paid_percent,0) END ASC,
      CASE WHEN v_sort='paid_percent' AND v_dir='desc' THEN COALESCE(f.paid_percent,0) END DESC,
      CASE WHEN v_sort='created_at' AND v_dir='asc' THEN f.created_at END ASC,
      f.created_at DESC
    LIMIT v_size OFFSET (v_page-1)*v_size
  ), att AS (
    SELECT jsonb_build_object(
        'arrangement_id', s.arrangement_id,
        'arrangement_number', s.arrangement_number,
        'employer_name', COALESCE(s.employer_name, s.employer_id),
        'status_label', s.status_label,
        'health_status', s.health_status,
        'outstanding', s.outstanding,
        'next_due_date', s.next_due_date,
        'priority', s.attention_score,
        'reason', CASE
            WHEN COALESCE(s.unresolved_breach_count,0) > 0
              THEN COALESCE(s.unresolved_breach_count,0)::text||' unresolved breach(es) awaiting action'
            WHEN s.health_status = 'BREACHED'
              THEN 'Breach recorded — arrangement in breach'
            WHEN s.breach_imminent THEN 'Breach threshold reached — '||COALESCE(s.overdue_count,0)::text||' overdue instalment(s)'
            WHEN s.approval_stale THEN 'Awaiting approval beyond '||v_appr_days::text||' days'
            WHEN s.has_overdue THEN COALESCE(s.overdue_count,0)::text||' overdue instalment(s)'
            WHEN s.has_unallocated THEN 'Unallocated receipts on arrangement'
            WHEN s.schedule_gap THEN 'Active arrangement with no scheduled next instalment'
            WHEN s.draft_stale THEN 'Draft not submitted for '||v_draft_days::text||' days'
            ELSE 'Instalment due within '||v_soon_days::text||' days' END) AS a,
      s.attention_score AS sc
    FROM scored s WHERE s.attention_score > 0
    ORDER BY s.attention_score DESC, s.next_due_date NULLS LAST
    LIMIT 8
  )
  SELECT
    (SELECT count(*)::int FROM filtered),
    COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM pageset p),'[]'::jsonb),
    jsonb_build_object(
      'total_arrangements', (SELECT count(*) FROM scored),
      'active', (SELECT count(*) FROM scored WHERE status='ACTIVE'),
      'pending_approval', (SELECT count(*) FROM scored WHERE status='PENDING_APPROVAL'),
      'breached', (SELECT count(*) FROM scored WHERE is_breached),
      'defaulted', (SELECT count(*) FROM scored WHERE status='DEFAULTED'),
      'completed', (SELECT count(*) FROM scored WHERE status='COMPLETED'),
      'outstanding_total', (SELECT COALESCE(sum(outstanding),0) FROM scored WHERE status IN ('ACTIVE','BREACHED','PENDING_APPROVAL')),
      'past_due_total', (SELECT COALESCE(sum(past_due_amount),0) FROM scored),
      'unallocated_total', (SELECT COALESCE(sum(unattributed_amount),0) FROM scored),
      'collected_total', (SELECT COALESCE(sum(total_paid),0) FROM scored),
      'attention', (SELECT count(*) FROM scored WHERE attention_score > 0)
    ),
    jsonb_build_object(
      'ALL', (SELECT count(*) FROM scored),
      'ATTENTION', (SELECT count(*) FROM scored WHERE attention_score > 0),
      'ACTIVE', (SELECT count(*) FROM scored WHERE status='ACTIVE'),
      'PENDING_APPROVAL', (SELECT count(*) FROM scored WHERE status='PENDING_APPROVAL'),
      'DRAFT', (SELECT count(*) FROM scored WHERE status='DRAFT'),
      'BREACHED', (SELECT count(*) FROM scored WHERE is_breached),
      'OVERDUE', (SELECT count(*) FROM scored WHERE COALESCE(overdue_count,0) > 0),
      'UNALLOCATED', (SELECT count(*) FROM scored WHERE has_unallocated),
      'CLOSED', (SELECT count(*) FROM scored WHERE status IN ('COMPLETED','CANCELLED','SUPERSEDED','DEFAULTED'))
    ),
    COALESCE((SELECT jsonb_agg(a ORDER BY sc DESC) FROM att),'[]'::jsonb)
  INTO v_total, v_rows, v_kpis, v_tabs, v_attention;

  RETURN jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
    'kpis', v_kpis, 'tab_counts', v_tabs, 'attention', v_attention,
    'thresholds', jsonb_build_object(
      'approval_ageing_days', v_appr_days,
      'draft_stale_days', v_draft_days,
      'due_soon_days', v_soon_days),
    'actor', jsonb_build_object(
      'can_manage', public.ce_actor_can(v_uid,'compliance.enforcement.arrangements'),
      'can_approve', public.ce_actor_can(v_uid,'compliance.arrangement.approve'),
      'can_refer_legal', public.ce_actor_can(v_uid,'compliance.enforcement.legal')
    )
  );
END;
$function$;