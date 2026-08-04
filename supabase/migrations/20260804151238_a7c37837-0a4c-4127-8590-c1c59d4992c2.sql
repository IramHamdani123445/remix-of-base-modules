-- =====================================================================
-- Compliance Case Detail — server-side command & query boundary
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Idempotency store
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ce_case_command_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  command_name text NOT NULL,
  actor_user_id uuid NOT NULL,
  correlation_id text,
  result_json jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.ce_case_command_idempotency TO service_role;
REVOKE ALL ON public.ce_case_command_idempotency FROM anon, authenticated;

-- ---------------------------------------------------------------
-- 2. Actor helpers
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_compliance_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id
                 AND replace(lower(ur.role::text), ' ', '') LIKE '%compliancehead%') THEN 'head'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id
                 AND replace(lower(ur.role::text), ' ', '') LIKE '%seniorinspector%') THEN 'senior'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id
                 AND (replace(lower(ur.role::text), ' ', '') LIKE '%complianceinspector%'
                      OR lower(ur.role::text) = 'inspector')) THEN 'inspector'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION public.ce_actor_can(_user_id uuid, _capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_caps text[];
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_admin(_user_id) THEN RETURN true; END IF;

  v_role := public.ce_compliance_role(_user_id);

  v_caps := CASE v_role
    WHEN 'head' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.cases.approve_requests',
      'compliance.cases.view_confidential_documents','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.workbench.enterprise',
      'compliance.reports.operational','compliance.reports.analytics']
    WHEN 'senior' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.reports.operational']
    WHEN 'inspector' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.report',
      'compliance.violations.manage','compliance.cases.manage',
      'compliance.enforcement.notices','compliance.reports.operational']
    ELSE ARRAY[]::text[]
  END;

  IF _capability = ANY (v_caps) THEN RETURN true; END IF;

  -- Legacy module/action fallback (never weaker: only widens for explicit grants)
  RETURN public.has_permission(_user_id, 'manage_compliance',
           CASE WHEN _capability LIKE '%.approve%' THEN 'approve' ELSE 'edit' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_actor_user_code(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p.user_code, p.employee_code, p.email, _user_id::text)
  FROM public.profiles p WHERE p.id = _user_id
$$;

-- Feature flag enforcement (server side, fail-open only when flag absent)
CREATE OR REPLACE FUNCTION public.ce_feature_flag_enabled(_flag_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT f.is_enabled FROM public.feature_flags f WHERE f.flag_key = _flag_key), true)
$$;

-- ---------------------------------------------------------------
-- 3. Audit helper
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_case_command_audit(
  _actor uuid, _event_code text, _action text, _entity_id text,
  _outcome text, _after jsonb, _reason text, _correlation_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.core_audit_log (
    event_code, event_name, event_category, severity, risk_level,
    actor_user_id, actor_name, module_code, domain_code, entity_type, entity_id,
    action, outcome, after_value, reason, correlation_id, source, is_system_generated
  ) VALUES (
    _event_code, _event_code, 'COMPLIANCE_CASE_REQUEST', 'INFO', 'MEDIUM',
    _actor, public.ce_actor_user_code(_actor), 'manage_compliance', 'COMPLIANCE',
    'ce_case_request', _entity_id, _action, _outcome, _after, _reason, _correlation_id,
    'ce_case_command', false
  );
$$;

-- ---------------------------------------------------------------
-- 4. Command: create a case request
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_request_case_action(
  p_case_id uuid,
  p_request_type text,
  p_reason text,
  p_target_case_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_code text;
  v_case record;
  v_target record;
  v_closed boolean;
  v_flag text;
  v_id uuid;
  v_result jsonb;
  v_existing jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  p_request_type := upper(coalesce(p_request_type, ''));
  IF p_request_type NOT IN ('CLOSURE', 'REOPEN', 'MERGE') THEN
    RAISE EXCEPTION 'INVALID_REQUEST_TYPE' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Idempotent replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_existing FROM public.ce_case_command_idempotency
      WHERE idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  IF NOT public.ce_actor_can(v_actor, 'compliance.cases.manage') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_flag := CASE p_request_type
    WHEN 'CLOSURE' THEN 'compliance.core.case_closure_approval'
    WHEN 'REOPEN' THEN 'compliance.core.case_reopen'
    ELSE 'compliance.core.case_merge' END;
  IF NOT public.ce_feature_flag_enabled(v_flag) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_case FROM public.ce_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF coalesce(v_case.is_deleted, false) THEN
    RAISE EXCEPTION 'CASE_DELETED' USING ERRCODE = '22023';
  END IF;

  v_closed := upper(coalesce(v_case.status, '')) IN ('RESOLVED', 'CLOSED', 'COMPLETED');

  IF p_request_type = 'REOPEN' AND NOT v_closed THEN
    RAISE EXCEPTION 'CASE_NOT_CLOSED' USING ERRCODE = '22023';
  END IF;
  IF p_request_type IN ('CLOSURE', 'MERGE') AND v_closed THEN
    RAISE EXCEPTION 'CASE_ALREADY_CLOSED' USING ERRCODE = '22023';
  END IF;
  IF p_request_type IN ('CLOSURE', 'MERGE') AND coalesce(v_case.is_merged, false) THEN
    RAISE EXCEPTION 'CASE_ALREADY_MERGED' USING ERRCODE = '22023';
  END IF;

  IF p_request_type = 'MERGE' THEN
    IF p_target_case_id IS NULL THEN
      RAISE EXCEPTION 'TARGET_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF p_target_case_id = p_case_id THEN
      RAISE EXCEPTION 'TARGET_SAME_AS_SOURCE' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target FROM public.ce_cases WHERE id = p_target_case_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF coalesce(v_target.is_deleted, false)
       OR coalesce(v_target.is_merged, false)
       OR upper(coalesce(v_target.status, '')) IN ('RESOLVED','CLOSED','COMPLETED','CANCELLED') THEN
      RAISE EXCEPTION 'TARGET_NOT_ELIGIBLE' USING ERRCODE = '22023';
    END IF;
    IF v_target.merged_into_case_id = p_case_id THEN
      RAISE EXCEPTION 'CIRCULAR_MERGE' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.ce_case_requests
             WHERE case_id = p_case_id AND request_type = p_request_type AND status = 'PENDING') THEN
    RAISE EXCEPTION 'DUPLICATE_PENDING_REQUEST' USING ERRCODE = '40001';
  END IF;

  v_code := public.ce_actor_user_code(v_actor);

  INSERT INTO public.ce_case_requests (
    case_id, request_type, target_case_id, reason, status,
    requested_by, requested_at, metadata
  ) VALUES (
    p_case_id, p_request_type, CASE WHEN p_request_type = 'MERGE' THEN p_target_case_id END,
    btrim(p_reason), 'PENDING', v_code, now(),
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('requested_by_user_id', v_actor, 'correlation_id', p_correlation_id)
  ) RETURNING id INTO v_id;

  PERFORM public.ce_case_command_audit(
    v_actor, 'CE_CASE_REQUEST_CREATED', p_request_type, v_id::text, 'SUCCESS',
    jsonb_build_object('case_id', p_case_id, 'target_case_id', p_target_case_id,
                       'request_type', p_request_type),
    btrim(p_reason), p_correlation_id);

  v_result := jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'PENDING',
                                 'request_type', p_request_type, 'replayed', false);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.ce_case_command_idempotency
      (idempotency_key, command_name, actor_user_id, correlation_id, result_json)
    VALUES (p_idempotency_key, 'ce_request_case_action', v_actor, p_correlation_id, v_result)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------
-- 5. Command: review (approve / reject) a case request
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_review_case_request(
  p_request_id uuid,
  p_approve boolean,
  p_notes text,
  p_expected_status text DEFAULT 'PENDING',
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_code text;
  v_req record;
  v_case record;
  v_target record;
  v_flag text;
  v_transition jsonb;
  v_result jsonb;
  v_existing jsonb;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'REVIEW_NOTES_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_existing FROM public.ce_case_command_idempotency
      WHERE idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  IF NOT public.ce_actor_can(v_actor, 'compliance.cases.approve_requests') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.ce_case_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF v_req.status <> coalesce(p_expected_status, 'PENDING') OR v_req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING' USING ERRCODE = '40001';
  END IF;

  v_code := public.ce_actor_user_code(v_actor);

  -- Maker-checker: the requester may not review their own request
  IF v_req.requested_by = v_code
     OR (v_req.metadata ->> 'requested_by_user_id') = v_actor::text THEN
    RAISE EXCEPTION 'MAKER_CHECKER_VIOLATION' USING ERRCODE = '42501';
  END IF;

  v_flag := CASE v_req.request_type
    WHEN 'CLOSURE' THEN 'compliance.core.case_closure_approval'
    WHEN 'REOPEN' THEN 'compliance.core.case_reopen'
    ELSE 'compliance.core.case_merge' END;
  IF NOT public.ce_feature_flag_enabled(v_flag) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = '55000';
  END IF;

  UPDATE public.ce_case_requests SET
    status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
    reviewed_by = v_code,
    reviewed_at = now(),
    review_notes = btrim(p_notes),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('reviewed_by_user_id', v_actor,
                            'review_correlation_id', p_correlation_id),
    updated_at = now()
  WHERE id = p_request_id;

  IF p_approve THEN
    SELECT * INTO v_case FROM public.ce_cases WHERE id = v_req.case_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

    IF v_req.request_type = 'CLOSURE' THEN
      IF upper(coalesce(v_case.status, '')) IN ('RESOLVED','CLOSED','COMPLETED') THEN
        RAISE EXCEPTION 'CASE_ALREADY_CLOSED' USING ERRCODE = '40001';
      END IF;
      v_transition := public.ce_apply_status_transition('case', v_req.case_id, 'CLOSE', v_code, v_req.reason);
      IF NOT coalesce((v_transition ->> 'success')::boolean, false) THEN
        RAISE EXCEPTION 'TRANSITION_FAILED: %', coalesce(v_transition ->> 'error', 'unknown')
          USING ERRCODE = '22023';
      END IF;
      UPDATE public.ce_cases
        SET closed_date = v_today, closure_reason = v_req.reason, updated_at = now(), updated_by = v_code
        WHERE id = v_req.case_id;

    ELSIF v_req.request_type = 'REOPEN' THEN
      IF upper(coalesce(v_case.status, '')) NOT IN ('RESOLVED','CLOSED','COMPLETED') THEN
        RAISE EXCEPTION 'CASE_NOT_CLOSED' USING ERRCODE = '40001';
      END IF;
      v_transition := public.ce_apply_status_transition('case', v_req.case_id, 'REOPEN', v_code, v_req.reason);
      IF NOT coalesce((v_transition ->> 'success')::boolean, false) THEN
        RAISE EXCEPTION 'TRANSITION_FAILED: %', coalesce(v_transition ->> 'error', 'unknown')
          USING ERRCODE = '22023';
      END IF;
      UPDATE public.ce_cases
        SET closed_date = NULL, closure_reason = NULL,
            reopened_count = coalesce(reopened_count, 0) + 1,
            updated_at = now(), updated_by = v_code
        WHERE id = v_req.case_id;

    ELSIF v_req.request_type = 'MERGE' THEN
      IF v_req.target_case_id IS NULL THEN
        RAISE EXCEPTION 'TARGET_REQUIRED' USING ERRCODE = '22023';
      END IF;
      IF v_req.target_case_id = v_req.case_id THEN
        RAISE EXCEPTION 'TARGET_SAME_AS_SOURCE' USING ERRCODE = '22023';
      END IF;
      IF coalesce(v_case.is_merged, false)
         OR upper(coalesce(v_case.status, '')) IN ('RESOLVED','CLOSED','COMPLETED') THEN
        RAISE EXCEPTION 'SOURCE_NOT_ELIGIBLE' USING ERRCODE = '40001';
      END IF;
      SELECT * INTO v_target FROM public.ce_cases WHERE id = v_req.target_case_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      IF coalesce(v_target.is_deleted, false)
         OR coalesce(v_target.is_merged, false)
         OR upper(coalesce(v_target.status, '')) IN ('RESOLVED','CLOSED','COMPLETED','CANCELLED') THEN
        RAISE EXCEPTION 'TARGET_NOT_ELIGIBLE' USING ERRCODE = '40001';
      END IF;
      IF v_target.merged_into_case_id = v_req.case_id THEN
        RAISE EXCEPTION 'CIRCULAR_MERGE' USING ERRCODE = '22023';
      END IF;

      v_transition := public.ce_apply_status_transition('case', v_req.case_id, 'CLOSE', v_code,
                        'Merged: ' || v_req.reason);
      IF NOT coalesce((v_transition ->> 'success')::boolean, false) THEN
        RAISE EXCEPTION 'TRANSITION_FAILED: %', coalesce(v_transition ->> 'error', 'unknown')
          USING ERRCODE = '22023';
      END IF;
      UPDATE public.ce_cases
        SET is_merged = true, merged_into_case_id = v_req.target_case_id,
            closed_date = v_today, closure_reason = 'Merged: ' || v_req.reason,
            updated_at = now(), updated_by = v_code
        WHERE id = v_req.case_id;
    END IF;
  END IF;

  PERFORM public.ce_case_command_audit(
    v_actor,
    CASE WHEN p_approve THEN 'CE_CASE_REQUEST_APPROVED' ELSE 'CE_CASE_REQUEST_REJECTED' END,
    v_req.request_type, p_request_id::text, 'SUCCESS',
    jsonb_build_object('case_id', v_req.case_id, 'target_case_id', v_req.target_case_id,
                       'approved', p_approve),
    btrim(p_notes), p_correlation_id);

  v_result := jsonb_build_object('ok', true, 'request_id', p_request_id,
                'status', CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
                'request_type', v_req.request_type, 'replayed', false);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.ce_case_command_idempotency
      (idempotency_key, command_name, actor_user_id, correlation_id, result_json)
    VALUES (p_idempotency_key, 'ce_review_case_request', v_actor, p_correlation_id, v_result)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------
-- 6. Query: merge candidate search (parameterised, no raw filters)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_search_merge_candidates(
  p_case_id uuid,
  p_search text,
  p_limit integer DEFAULT 20
) RETURNS TABLE (id uuid, case_number text, employer_name text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_term text := btrim(coalesce(p_search, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.ce_actor_can(v_actor, 'compliance.cases.manage') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_term) < 2 OR char_length(v_term) > 100 THEN
    RAISE EXCEPTION 'INVALID_SEARCH_LENGTH' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT c.id, c.case_number::text, c.employer_name::text, c.status::text
  FROM public.ce_cases c
  WHERE c.id <> p_case_id
    AND coalesce(c.is_deleted, false) = false
    AND coalesce(c.is_merged, false) = false
    AND upper(coalesce(c.status, '')) NOT IN ('RESOLVED','CLOSED','COMPLETED','CANCELLED')
    AND (c.case_number ILIKE '%' || v_term || '%' ESCAPE '\'
         OR c.employer_name ILIKE '%' || v_term || '%' ESCAPE '\')
  ORDER BY c.case_number
  LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 50);
END;
$$;

-- ---------------------------------------------------------------
-- 7. Query: case documents with confidential masking
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_list_case_documents(p_case_id uuid)
RETURNS TABLE (
  id uuid, title text, document_type text, description text,
  uploaded_by_name text, created_at timestamp with time zone,
  verified boolean, is_confidential boolean, is_masked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_confidential boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.ce_actor_can(v_actor, 'compliance.cases.manage') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ce_cases c
                 WHERE c.id = p_case_id AND coalesce(c.is_deleted, false) = false) THEN
    RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_confidential := public.ce_actor_can(v_actor, 'compliance.cases.view_confidential_documents');

  RETURN QUERY
  SELECT d.id,
         CASE WHEN coalesce(d.is_confidential, false) AND NOT v_confidential
              THEN 'Confidential document' ELSE d.title::text END,
         d.document_type::text,
         CASE WHEN coalesce(d.is_confidential, false) AND NOT v_confidential
              THEN NULL ELSE d.description END,
         CASE WHEN coalesce(d.is_confidential, false) AND NOT v_confidential
              THEN NULL ELSE d.uploaded_by_name::text END,
         d.created_at,
         coalesce(d.verified, false),
         coalesce(d.is_confidential, false),
         (coalesce(d.is_confidential, false) AND NOT v_confidential)
  FROM public.ce_case_documents d
  WHERE d.case_id = p_case_id
  ORDER BY d.created_at DESC
  LIMIT 200;
END;
$$;

-- ---------------------------------------------------------------
-- 8. Query: case inspections with explicit employer scope
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_list_case_inspections(
  p_case_id uuid,
  p_include_employer boolean DEFAULT false
) RETURNS TABLE (
  id uuid, inspection_number text, inspection_type text, status text,
  scheduled_date date, visit_date date, inspector_name text,
  scope text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_employer text;
  v_employer_scope boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.ce_actor_can(v_actor, 'compliance.cases.manage') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT c.employer_id INTO v_employer FROM public.ce_cases c
    WHERE c.id = p_case_id AND coalesce(c.is_deleted, false) = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF coalesce(p_include_employer, false) THEN
    IF NOT public.ce_actor_can(v_actor, 'compliance.inspections.view_employer_history') THEN
      RAISE EXCEPTION 'FORBIDDEN_EMPLOYER_SCOPE' USING ERRCODE = '42501';
    END IF;
    v_employer_scope := true;
  END IF;

  RETURN QUERY
  SELECT i.id, i.inspection_number::text, i.inspection_type::text, i.status::text,
         i.scheduled_date, i.visit_date, i.inspector_name::text,
         CASE WHEN i.case_id = p_case_id THEN 'CASE' ELSE 'EMPLOYER' END
  FROM public.ce_inspections i
  WHERE i.case_id = p_case_id
     OR (v_employer_scope AND v_employer IS NOT NULL AND i.employer_id = v_employer)
  ORDER BY (CASE WHEN i.case_id = p_case_id THEN 0 ELSE 1 END),
           coalesce(i.visit_date, i.scheduled_date) DESC NULLS LAST
  LIMIT 100;
END;
$$;

-- ---------------------------------------------------------------
-- 9. Lock down direct browser mutation of case requests
-- ---------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ce_case_requests FROM anon, authenticated;
REVOKE ALL ON public.ce_case_requests FROM anon;
GRANT SELECT ON public.ce_case_requests TO authenticated;
GRANT ALL ON public.ce_case_requests TO service_role;

-- ---------------------------------------------------------------
-- 10. Function grants (authenticated only; never anon/public)
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ce_request_case_action(uuid, text, text, uuid, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_review_case_request(uuid, boolean, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_search_merge_candidates(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_list_case_documents(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_list_case_inspections(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ce_case_command_audit(uuid, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ce_request_case_action(uuid, text, text, uuid, jsonb, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_review_case_request(uuid, boolean, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_search_merge_candidates(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_list_case_documents(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_list_case_inspections(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_actor_can(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_compliance_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_feature_flag_enabled(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_case_command_audit(uuid, text, text, text, text, jsonb, text, text) TO service_role;