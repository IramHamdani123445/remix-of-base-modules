
-- Actor display name helper -------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_actor_display_name(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT nullif(trim(p.full_name),'') FROM public.profiles p WHERE p.id = _user_id),
    (SELECT p.email FROM public.profiles p WHERE p.id = _user_id),
    public.ce_actor_code(_user_id));
$$;
REVOKE ALL ON FUNCTION public.ce_actor_display_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_actor_display_name(uuid) TO authenticated, service_role;

-- Readiness rollup ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_rollup_v1(p_referral_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH i AS (SELECT * FROM public.ce_legal_pack_items WHERE referral_id = p_referral_id)
  SELECT jsonb_build_object(
    'total_items', (SELECT count(*) FROM i),
    'required_items', (SELECT count(*) FROM i WHERE is_required),
    'required_complete', (SELECT count(*) FROM i WHERE is_required AND is_satisfied),
    'optional_complete', (SELECT count(*) FROM i WHERE NOT is_required AND is_satisfied),
    'missing_required', (SELECT count(*) FROM i WHERE is_required AND NOT is_satisfied),
    'missing_keys', (SELECT coalesce(jsonb_agg(item_key ORDER BY display_order), '[]'::jsonb)
                       FROM i WHERE is_required AND NOT is_satisfied),
    'completion_pct', CASE WHEN (SELECT count(*) FROM i WHERE is_required) = 0 THEN 0
      ELSE round(100.0 * (SELECT count(*) FROM i WHERE is_required AND is_satisfied)
                       / (SELECT count(*) FROM i WHERE is_required)) END);
$$;
REVOKE ALL ON FUNCTION public.ce_legal_pack_rollup_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_rollup_v1(uuid) TO authenticated, service_role;

-- Register ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_register_v1(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_search    text := nullif(trim(coalesce(p_params->>'search','')),'');
  v_states    text[] := CASE WHEN p_params ? 'states'
                        THEN ARRAY(SELECT jsonb_array_elements_text(p_params->'states')) END;
  v_readiness text := nullif(p_params->>'readiness','');
  v_reason    text := nullif(p_params->>'reason_code','');
  v_zone      text := nullif(p_params->>'zone','');
  v_missing   text := nullif(p_params->>'missing_item','');
  v_min_amt   numeric := nullif(p_params->>'min_amount','')::numeric;
  v_max_amt   numeric := nullif(p_params->>'max_amount','')::numeric;
  v_age_min   integer := nullif(p_params->>'age_min_days','')::integer;
  v_sort      text := coalesce(nullif(p_params->>'sort',''),'age_days');
  v_dir       text := CASE WHEN upper(coalesce(p_params->>'dir','desc')) = 'ASC' THEN 'ASC' ELSE 'DESC' END;
  v_page      integer := greatest(1, coalesce(nullif(p_params->>'page','')::int, 1));
  v_size      integer := least(200, greatest(5, coalesce(nullif(p_params->>'page_size','')::int, 25)));
  v_sla       integer := coalesce((SELECT numeric_value::int FROM public.ce_legal_pack_ref
                                    WHERE domain='THRESHOLD' AND code='PREPARATION_SLA_DAYS'), 5);
  v_high      numeric := coalesce((SELECT numeric_value FROM public.ce_legal_pack_ref
                                    WHERE domain='THRESHOLD' AND code='HIGH_VALUE_AMOUNT'), 50000);
  r           record;
  v_rows      jsonb := '[]'::jsonb;
  v_total     integer := 0;
  v_kpis      jsonb;
  v_attention jsonb;
  v_facets    jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.enforcement.legal')
       OR public.ce_actor_can(v_uid,'compliance.workbench.team')
       OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_LEGAL_PACK';
  END IF;

  IF v_states IS NULL OR cardinality(v_states) = 0 THEN
    v_states := ARRAY['DRAFT','RETURNED','PENDING_APPROVAL'];
  END IF;

  -- keep readiness in step with live source records
  FOR r IN SELECT id FROM public.ce_legal_referrals WHERE status = ANY (v_states) LOOP
    PERFORM public.ce_legal_pack_sync_v1(r.id);
  END LOOP;

  CREATE TEMPORARY TABLE IF NOT EXISTS _pack_scope (
    id uuid, referral_number text, employer_id text, employer_name text, employer_zone text,
    status text, reason_code text, amount numeric, created_at timestamptz,
    returned_at timestamptz, return_reason text, case_number text, case_id uuid,
    documents integer, age_days integer, rollup jsonb, readiness text,
    missing_keys jsonb, completion_pct integer, sla_breached boolean, high_value boolean
  ) ON COMMIT DROP;
  DELETE FROM _pack_scope;

  INSERT INTO _pack_scope
  SELECT lr.id, lr.referral_number, lr.employer_id, lr.employer_name, lr.employer_zone,
         lr.status, lr.referral_reason_code,
         coalesce(lr.grand_total, lr.total_referred_amount, 0),
         lr.created_at, lr.returned_at, lr.return_reason,
         c.case_number, c.id,
         (SELECT count(*)::int FROM public.core_legal_referral_document d WHERE d.referral_id = lr.id),
         greatest(0, (date_part('day', now() - coalesce(lr.returned_at, lr.created_at)))::int),
         ro,
         CASE WHEN (ro->>'required_complete')::int = 0 THEN 'NOT_STARTED'
              WHEN (ro->>'missing_required')::int = 0 THEN 'READY'
              WHEN (ro->>'completion_pct')::int >= 60 THEN 'MISSING_MANDATORY'
              ELSE 'IN_PROGRESS' END,
         ro->'missing_keys', (ro->>'completion_pct')::int,
         greatest(0, (date_part('day', now() - coalesce(lr.returned_at, lr.created_at)))::int) > v_sla,
         coalesce(lr.grand_total, lr.total_referred_amount, 0) >= v_high
    FROM public.ce_legal_referrals lr
    LEFT JOIN public.ce_cases c ON c.id = lr.source_case_id
    CROSS JOIN LATERAL (SELECT public.ce_legal_pack_rollup_v1(lr.id) AS ro) x
   WHERE lr.status = ANY (v_states);

  CREATE TEMPORARY TABLE IF NOT EXISTS _pack_filtered (LIKE _pack_scope) ON COMMIT DROP;
  DELETE FROM _pack_filtered;
  INSERT INTO _pack_filtered
  SELECT * FROM _pack_scope s
   WHERE (v_search IS NULL
          OR s.referral_number ILIKE '%'||v_search||'%'
          OR coalesce(s.employer_name,'') ILIKE '%'||v_search||'%'
          OR coalesce(s.employer_id,'') ILIKE '%'||v_search||'%'
          OR coalesce(s.case_number,'') ILIKE '%'||v_search||'%')
     AND (v_readiness IS NULL OR s.readiness = v_readiness)
     AND (v_reason IS NULL OR coalesce(s.reason_code,'') = v_reason)
     AND (v_zone IS NULL OR coalesce(s.employer_zone,'') = v_zone)
     AND (v_min_amt IS NULL OR s.amount >= v_min_amt)
     AND (v_max_amt IS NULL OR s.amount <= v_max_amt)
     AND (v_age_min IS NULL OR s.age_days >= v_age_min)
     AND (v_missing IS NULL OR s.missing_keys ? v_missing);

  SELECT count(*)::int INTO v_total FROM _pack_filtered;

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.rn), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT f.*, row_number() OVER (
        ORDER BY
          CASE WHEN v_sort='age_days'     AND v_dir='DESC' THEN f.age_days END DESC,
          CASE WHEN v_sort='age_days'     AND v_dir='ASC'  THEN f.age_days END ASC,
          CASE WHEN v_sort='amount'       AND v_dir='DESC' THEN f.amount END DESC,
          CASE WHEN v_sort='amount'       AND v_dir='ASC'  THEN f.amount END ASC,
          CASE WHEN v_sort='completion'   AND v_dir='DESC' THEN f.completion_pct END DESC,
          CASE WHEN v_sort='completion'   AND v_dir='ASC'  THEN f.completion_pct END ASC,
          CASE WHEN v_sort='employer'     AND v_dir='DESC' THEN f.employer_name END DESC,
          CASE WHEN v_sort='employer'     AND v_dir='ASC'  THEN f.employer_name END ASC,
          CASE WHEN v_sort='referral_no'  AND v_dir='DESC' THEN f.referral_number END DESC,
          CASE WHEN v_sort='referral_no'  AND v_dir='ASC'  THEN f.referral_number END ASC,
          f.created_at DESC
      ) rn
      FROM _pack_filtered f
    ) t
   WHERE t.rn > (v_page-1)*v_size AND t.rn <= v_page*v_size;

  SELECT jsonb_build_object(
    'in_preparation', count(*) FILTER (WHERE status IN ('DRAFT','RETURNED')),
    'ready', count(*) FILTER (WHERE readiness = 'READY' AND status IN ('DRAFT','RETURNED')),
    'incomplete', count(*) FILTER (WHERE readiness <> 'READY' AND status IN ('DRAFT','RETURNED')),
    'pending_approval', count(*) FILTER (WHERE status = 'PENDING_APPROVAL'),
    'returned', count(*) FILTER (WHERE status = 'RETURNED'),
    'sla_breached', count(*) FILTER (WHERE sla_breached AND status IN ('DRAFT','RETURNED')),
    'high_value', count(*) FILTER (WHERE high_value),
    'total_exposure', coalesce(sum(amount),0),
    'avg_completion', coalesce(round(avg(completion_pct)),0))
    INTO v_kpis FROM _pack_scope;

  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.priority DESC, a.age_days DESC), '[]'::jsonb)
    INTO v_attention
    FROM (
      SELECT s.id, s.referral_number, s.employer_name, s.amount, s.age_days, s.readiness,
             s.status, s.completion_pct, s.missing_keys,
             CASE WHEN s.status='RETURNED' THEN 'RETURNED_BY_LEGAL'
                  WHEN s.sla_breached THEN 'SLA_BREACHED'
                  WHEN s.high_value AND s.readiness <> 'READY' THEN 'HIGH_VALUE_INCOMPLETE'
                  ELSE 'READY_NOT_SUBMITTED' END AS reason,
             CASE WHEN s.status='RETURNED' THEN 4
                  WHEN s.sla_breached THEN 3
                  WHEN s.high_value AND s.readiness <> 'READY' THEN 2 ELSE 1 END AS priority
        FROM _pack_scope s
       WHERE s.status IN ('DRAFT','RETURNED')
         AND (s.status='RETURNED' OR s.sla_breached OR s.high_value OR s.readiness='READY')
       LIMIT 12
    ) a;

  SELECT jsonb_build_object(
    'reason_codes', (SELECT coalesce(jsonb_agg(DISTINCT reason_code) FILTER (WHERE reason_code IS NOT NULL),'[]'::jsonb) FROM _pack_scope),
    'zones', (SELECT coalesce(jsonb_agg(DISTINCT employer_zone) FILTER (WHERE employer_zone IS NOT NULL),'[]'::jsonb) FROM _pack_scope),
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY display_order),'[]'::jsonb)
                FROM public.ce_legal_pack_item_def WHERE is_active),
    'readiness', (SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY display_order),'[]'::jsonb)
                    FROM public.ce_legal_pack_ref WHERE domain='READINESS'))
    INTO v_facets;

  RETURN jsonb_build_object(
    'items', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
    'kpis', v_kpis, 'attention', v_attention, 'facets', v_facets,
    'thresholds', jsonb_build_object('sla_days', v_sla, 'high_value', v_high),
    'can_edit', public.ce_actor_can(v_uid,'compliance.enforcement.legal'));
END $$;
REVOKE ALL ON FUNCTION public.ce_legal_pack_register_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_register_v1(jsonb) TO authenticated, service_role;

-- Detail --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_detail_v1(p_referral_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  r     public.ce_legal_referrals%ROWTYPE;
  c     public.ce_cases%ROWTYPE;
  v_ro  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.enforcement.legal')
       OR public.ce_actor_can(v_uid,'compliance.workbench.team')
       OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_LEGAL_PACK';
  END IF;

  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = p_referral_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_NOT_FOUND'; END IF;
  PERFORM public.ce_legal_pack_sync_v1(p_referral_id);
  SELECT * INTO c FROM public.ce_cases WHERE id = r.source_case_id;
  v_ro := public.ce_legal_pack_rollup_v1(p_referral_id);

  RETURN jsonb_build_object(
    'referral', jsonb_build_object(
      'id', r.id, 'referral_number', r.referral_number, 'status', r.status,
      'employer_id', r.employer_id, 'employer_name', r.employer_name, 'employer_zone', r.employer_zone,
      'reason_code', r.referral_reason_code, 'reason_text', r.referral_reason_text,
      'total_principal', r.total_principal, 'total_penalties', r.total_penalties,
      'total_interest', r.total_interest,
      'amount', coalesce(r.grand_total, r.total_referred_amount, 0),
      'period_from', r.period_from, 'period_to', r.period_to, 'periods_count', r.periods_count,
      'created_at', r.created_at, 'created_by_name', r.created_by_name,
      'returned_at', r.returned_at, 'return_reason', r.return_reason,
      'approval_requested_at', r.approval_requested_at,
      'pack_completed_at', r.pack_completed_at,
      'case_id', c.id, 'case_number', c.case_number, 'case_status', c.status,
      'source_module', r.source_module, 'lg_case_no', r.lg_case_no),
    'rollup', v_ro,
    'readiness', CASE WHEN (v_ro->>'required_complete')::int = 0 THEN 'NOT_STARTED'
                      WHEN (v_ro->>'missing_required')::int = 0 THEN 'READY'
                      WHEN (v_ro->>'completion_pct')::int >= 60 THEN 'MISSING_MANDATORY'
                      ELSE 'IN_PROGRESS' END,
    'checklist', (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.display_order),'[]'::jsonb)
                    FROM public.ce_legal_pack_items i WHERE i.referral_id = p_referral_id),
    'groups', (SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY display_order),'[]'::jsonb)
                 FROM public.ce_legal_pack_ref WHERE domain='GROUP'),
    'documents', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'id', d.id, 'file_name', d.file_name, 'display_title', d.display_title,
                     'document_type_code', d.document_type_code, 'source_module', d.source_module,
                     'source_entity_type', d.source_entity_type, 'source_entity_id', d.source_entity_id,
                     'storage_bucket', d.storage_bucket, 'storage_path', d.storage_path,
                     'dms_document_id', d.dms_document_id, 'mime_type', d.mime_type,
                     'file_size', d.file_size, 'is_required', d.is_required,
                     'selected_at', d.selected_at, 'selected_by', d.selected_by,
                     'accessible', (d.storage_path IS NOT NULL OR d.dms_document_id IS NOT NULL))
                     ORDER BY d.created_at DESC),'[]'::jsonb)
                   FROM public.core_legal_referral_document d WHERE d.referral_id = p_referral_id),
    'violations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', v.id, 'violation_number', v.violation_number, 'type', v.violation_type,
                      'severity', v.severity, 'status', v.status, 'amount', v.amount_involved)
                      ORDER BY v.created_at DESC),'[]'::jsonb)
                    FROM public.ce_violations v
                   WHERE v.case_id = r.source_case_id AND coalesce(v.is_deleted,false) = false),
    'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'version_no', pv.version_no, 'status', pv.status,
                    'submitted_at', pv.submitted_at, 'submitted_by_name', pv.submitted_by_name,
                    'returned_at', pv.returned_at, 'return_reason', pv.return_reason,
                    'totals', pv.totals_snapshot, 'workflow', pv.workflow_snapshot)
                    ORDER BY pv.version_no DESC),'[]'::jsonb)
                  FROM public.ce_legal_pack_version pv WHERE pv.referral_id = p_referral_id),
    'timeline', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'id', e.id, 'event_code', e.event_code, 'description', e.description,
                    'actor_name', e.actor_name, 'created_at', e.created_at,
                    'version_no', e.version_no, 'payload', e.payload)
                    ORDER BY e.created_at DESC),'[]'::jsonb)
                  FROM public.ce_legal_pack_event e WHERE e.referral_id = p_referral_id),
    'workflow', public.ce_legal_pack_workflow_v1(p_referral_id),
    'can_edit', public.ce_actor_can(v_uid,'compliance.enforcement.legal')
                AND r.status IN ('DRAFT','RETURNED'));
END $$;
REVOKE ALL ON FUNCTION public.ce_legal_pack_detail_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_detail_v1(uuid) TO authenticated, service_role;

-- Confirm a manual checklist item -------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_confirm_item_v1(
  p_referral_id uuid, p_item_key text, p_satisfied boolean, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text; v_name text;
  it     public.ce_legal_pack_items%ROWTYPE;
  st     text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.enforcement.legal') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_LEGAL_PACK_EDIT';
  END IF;
  v_code := public.ce_actor_code(v_uid);
  v_name := public.ce_actor_display_name(v_uid);
  IF v_code IS NULL OR upper(v_code) = 'SYSTEM' THEN RAISE EXCEPTION 'ACTOR_NOT_RESOLVABLE'; END IF;

  SELECT * INTO st FROM (SELECT status FROM public.ce_legal_referrals WHERE id = p_referral_id) q;
  IF st IS NULL THEN RAISE EXCEPTION 'REFERRAL_NOT_FOUND'; END IF;
  IF st NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'PACK_LOCKED_%', st; END IF;

  SELECT * INTO it FROM public.ce_legal_pack_items
   WHERE referral_id = p_referral_id AND item_key = p_item_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
  IF it.completion_mode <> 'MANUAL' THEN RAISE EXCEPTION 'ITEM_AUTO_VALIDATED'; END IF;

  UPDATE public.ce_legal_pack_items
     SET is_satisfied = p_satisfied,
         item_status = CASE WHEN p_satisfied THEN 'COMPLETE'
                            WHEN is_required THEN 'MISSING' ELSE 'NOT_APPLICABLE' END,
         satisfied_by = CASE WHEN p_satisfied THEN v_code END,
         satisfied_by_name = CASE WHEN p_satisfied THEN v_name END,
         satisfied_at = CASE WHEN p_satisfied THEN now() END,
         notes = coalesce(p_notes, notes),
         updated_at = now()
   WHERE id = it.id;

  INSERT INTO public.ce_legal_pack_event (referral_id, event_code, description, actor_code, actor_name, payload)
  VALUES (p_referral_id, CASE WHEN p_satisfied THEN 'ITEM_CONFIRMED' ELSE 'ITEM_UNCONFIRMED' END,
          it.item_label, v_code, v_name,
          jsonb_build_object('item_key', p_item_key, 'notes', p_notes));

  RETURN public.ce_legal_pack_rollup_v1(p_referral_id);
END $$;
REVOKE ALL ON FUNCTION public.ce_legal_pack_confirm_item_v1(uuid,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_confirm_item_v1(uuid,text,boolean,text) TO authenticated, service_role;

-- Detach a document ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_detach_document_v1(
  p_referral_id uuid, p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_name text; v_file text; st text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.enforcement.legal') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_LEGAL_PACK_EDIT';
  END IF;
  SELECT status INTO st FROM public.ce_legal_referrals WHERE id = p_referral_id;
  IF st IS NULL THEN RAISE EXCEPTION 'REFERRAL_NOT_FOUND'; END IF;
  IF st NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'PACK_LOCKED_%', st; END IF;

  v_code := public.ce_actor_code(v_uid);
  v_name := public.ce_actor_display_name(v_uid);

  DELETE FROM public.core_legal_referral_document
   WHERE id = p_document_id AND referral_id = p_referral_id
   RETURNING coalesce(display_title, file_name) INTO v_file;
  IF v_file IS NULL THEN RAISE EXCEPTION 'DOCUMENT_NOT_FOUND'; END IF;

  UPDATE public.ce_legal_referrals
     SET documents_count = (SELECT count(*) FROM public.core_legal_referral_document
                             WHERE referral_id = p_referral_id),
         updated_at = now(), updated_by = v_code
   WHERE id = p_referral_id;

  INSERT INTO public.ce_legal_pack_event (referral_id, event_code, description, actor_code, actor_name, payload)
  VALUES (p_referral_id, 'DOCUMENT_DETACHED', v_file, v_code, v_name,
          jsonb_build_object('document_id', p_document_id));

  PERFORM public.ce_legal_pack_sync_v1(p_referral_id);
  RETURN public.ce_legal_pack_rollup_v1(p_referral_id);
END $$;
REVOKE ALL ON FUNCTION public.ce_legal_pack_detach_document_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_detach_document_v1(uuid,uuid) TO authenticated, service_role;

-- Send for approval -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_submit_v1(
  p_referral_id uuid, p_idempotency_key text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text; v_name text;
  r      public.ce_legal_referrals%ROWTYPE;
  v_ro   jsonb; v_wf jsonb; v_ver integer; v_existing public.ce_legal_pack_version%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.enforcement.legal') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_LEGAL_PACK_SUBMIT';
  END IF;
  v_code := public.ce_actor_code(v_uid);
  v_name := public.ce_actor_display_name(v_uid);
  IF v_code IS NULL OR upper(v_code) = 'SYSTEM' THEN RAISE EXCEPTION 'ACTOR_NOT_RESOLVABLE'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.ce_legal_pack_version
     WHERE referral_id = p_referral_id AND submission_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('status','ALREADY_SUBMITTED','version_no',v_existing.version_no,
                                'workflow', v_existing.workflow_snapshot);
    END IF;
  END IF;

  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_NOT_FOUND'; END IF;
  IF r.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'PACK_NOT_SUBMITTABLE_%', r.status; END IF;

  PERFORM public.ce_legal_pack_sync_v1(p_referral_id);
  v_ro := public.ce_legal_pack_rollup_v1(p_referral_id);
  IF (v_ro->>'missing_required')::int > 0 THEN
    RAISE EXCEPTION 'PACK_INCOMPLETE: % mandatory item(s) outstanding', (v_ro->>'missing_required');
  END IF;

  v_wf := public.ce_legal_pack_workflow_v1(p_referral_id);
  SELECT coalesce(max(version_no),0) + 1 INTO v_ver
    FROM public.ce_legal_pack_version WHERE referral_id = p_referral_id;

  UPDATE public.ce_legal_pack_version SET status = 'SUPERSEDED', updated_at = now()
   WHERE referral_id = p_referral_id AND status IN ('DRAFT','SUBMITTED');

  INSERT INTO public.ce_legal_pack_version
    (referral_id, version_no, status, checklist_snapshot, documents_snapshot,
     totals_snapshot, workflow_snapshot, submission_key, submitted_at, submitted_by, submitted_by_name)
  VALUES (p_referral_id, v_ver, 'SUBMITTED',
     (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.display_order),'[]'::jsonb)
        FROM public.ce_legal_pack_items i WHERE i.referral_id = p_referral_id),
     (SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb)
        FROM public.core_legal_referral_document d WHERE d.referral_id = p_referral_id),
     v_ro || jsonb_build_object('amount', coalesce(r.grand_total, r.total_referred_amount, 0),
                                'notes', p_notes),
     v_wf, p_idempotency_key, now(), v_code, v_name);

  UPDATE public.ce_legal_pack_items SET pack_version_no = v_ver WHERE referral_id = p_referral_id;

  UPDATE public.ce_legal_referrals
     SET status = 'PENDING_APPROVAL',
         approval_requested_at = now(),
         approval_requested_by = v_code,
         approval_workflow_definition_id = nullif(v_wf->>'workflow_definition_id','')::uuid,
         approval_notes = coalesce(p_notes, approval_notes),
         pack_completed_at = now(),
         documents_count = (SELECT count(*) FROM public.core_legal_referral_document
                             WHERE referral_id = p_referral_id),
         updated_at = now(), updated_by = v_code
   WHERE id = p_referral_id;

  INSERT INTO public.ce_legal_pack_event (referral_id, version_no, event_code, description, actor_code, actor_name, payload)
  VALUES (p_referral_id, v_ver, 'PACK_SUBMITTED',
          'Pack version ' || v_ver || ' sent for approval', v_code, v_name,
          jsonb_build_object('workflow', v_wf, 'notes', p_notes, 'rollup', v_ro));

  RETURN jsonb_build_object('status','SUBMITTED','version_no',v_ver,'workflow',v_wf,'rollup',v_ro);
END $$;
REVOKE ALL ON FUNCTION public.ce_legal_pack_submit_v1(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_submit_v1(uuid,text,text) TO authenticated, service_role;

-- Lock down phase-1 helpers to signed-in users only
REVOKE ALL ON FUNCTION public.ce_legal_pack_auto_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_legal_pack_sync_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_legal_pack_workflow_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_auto_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_sync_v1(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_workflow_v1(uuid) TO authenticated, service_role;
