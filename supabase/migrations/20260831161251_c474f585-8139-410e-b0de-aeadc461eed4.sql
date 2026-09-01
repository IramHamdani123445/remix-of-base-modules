-- Pre-decision revalidation ------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_case_request_precheck_v1(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  c record;
  t record;
  v_blockers text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_codes text[];
  v_self boolean := false;
  v_open_violations int := 0;
  v_arrangement text;
  v_eligible boolean := true;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-CASE-REQ-401: authentication required'; END IF;

  SELECT * INTO r FROM public.ce_case_requests WHERE id = p_id;
  IF r IS NULL THEN
    RETURN jsonb_build_object('found', false, 'eligible', false,
                              'blockers', to_jsonb(ARRAY['Request no longer exists.']));
  END IF;

  IF r.status <> 'PENDING' THEN
    v_eligible := false;
    v_blockers := v_blockers || format('This request has already been %s.', lower(r.status));
  END IF;

  SELECT * INTO c FROM public.ce_cases WHERE id = r.case_id;
  IF c IS NULL OR COALESCE(c.is_deleted,false) THEN
    v_eligible := false;
    v_blockers := v_blockers || 'The originating case no longer exists.';
  ELSE
    SELECT count(*) INTO v_open_violations FROM public.ce_violations v
     WHERE v.case_id = c.id
       AND upper(COALESCE(v.status,'')) NOT IN ('RESOLVED','CLOSED','CANCELLED','WAIVED','WITHDRAWN');
    SELECT upper(a.status) INTO v_arrangement FROM public.ce_payment_arrangements a
     WHERE a.case_id = c.id ORDER BY a.created_at DESC NULLS LAST LIMIT 1;

    IF r.request_type IN ('CLOSURE','MERGE') THEN
      IF upper(COALESCE(c.status,'')) IN ('CLOSED','RESOLVED','COMPLETED','CANCELLED','WITHDRAWN')
         OR c.closed_date IS NOT NULL THEN
        v_eligible := false;
        v_blockers := v_blockers || format('The case is already %s — it can no longer be closed.', lower(COALESCE(c.status,'closed')));
      END IF;
      IF v_open_violations > 0 THEN
        v_warnings := v_warnings || format('%s open violation(s) remain on this case.', v_open_violations);
      END IF;
      IF COALESCE(c.total_amount,0) > 0 THEN
        v_warnings := v_warnings || format('Outstanding case exposure of %s remains.', to_char(c.total_amount,'FM999G999G990D00'));
      END IF;
      IF v_arrangement = 'ACTIVE' THEN
        v_warnings := v_warnings || 'An active payment arrangement exists on this case.';
      END IF;
      IF c.legal_case_id IS NOT NULL THEN
        v_warnings := v_warnings || 'This case is linked to active legal activity.';
      END IF;
    ELSIF r.request_type = 'REOPEN' THEN
      IF upper(COALESCE(c.status,'')) NOT IN ('CLOSED','RESOLVED','COMPLETED') THEN
        v_eligible := false;
        v_blockers := v_blockers || format('The case is currently %s — only closed or resolved cases can be reopened.', lower(COALESCE(c.status,'unknown')));
      END IF;
    END IF;
  END IF;

  IF r.request_type = 'MERGE' THEN
    IF r.target_case_id IS NULL THEN
      v_eligible := false;
      v_blockers := v_blockers || 'No surviving (target) case is recorded on this merge request.';
    ELSE
      SELECT * INTO t FROM public.ce_cases WHERE id = r.target_case_id;
      IF t IS NULL OR COALESCE(t.is_deleted,false) THEN
        v_eligible := false;
        v_blockers := v_blockers || 'The surviving (target) case no longer exists.';
      ELSIF t.id = r.case_id THEN
        v_eligible := false;
        v_blockers := v_blockers || 'Source and target case are the same.';
      ELSIF upper(COALESCE(t.status,'')) IN ('CLOSED','RESOLVED','COMPLETED','CANCELLED','WITHDRAWN') THEN
        v_eligible := false;
        v_blockers := v_blockers || 'The surviving (target) case is closed and cannot absorb another case.';
      END IF;
      IF t IS NOT NULL AND COALESCE(t.employer_id,'~a') <> COALESCE(c.employer_id,'~b') THEN
        v_warnings := v_warnings || 'Source and target case belong to different employers.';
      END IF;
    END IF;
  END IF;

  SELECT ARRAY(SELECT DISTINCT x FROM unnest(
           COALESCE(public.ce_officer_identities(v_uid), ARRAY[]::text[]) || ARRAY[v_uid::text]
         ) x WHERE x IS NOT NULL AND x <> '') INTO v_codes;
  v_self := r.requested_by = ANY(v_codes);

  RETURN jsonb_build_object(
    'found', true,
    'eligible', v_eligible,
    'status', r.status,
    'request_type', r.request_type,
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'is_self_request', v_self,
    'can_approve', public.ce_actor_can(v_uid,'compliance.cases.approve_requests'),
    'can_approve_own', public.ce_actor_can(v_uid,'compliance.workflow.override'),
    'case', CASE WHEN c IS NULL THEN NULL ELSE jsonb_build_object(
        'id', c.id, 'case_number', c.case_number, 'status', upper(COALESCE(c.status,'UNKNOWN')),
        'employer_name', c.employer_name, 'employer_id', c.employer_id,
        'total_amount', COALESCE(c.total_amount,0), 'open_violations', v_open_violations,
        'arrangement_state', COALESCE(v_arrangement,'NONE'),
        'legal_case_id', c.legal_case_id, 'closed_date', c.closed_date,
        'closure_reason', c.closure_reason, 'reopened_count', COALESCE(c.reopened_count,0)) END,
    'target', CASE WHEN t IS NULL THEN NULL ELSE jsonb_build_object(
        'id', t.id, 'case_number', t.case_number, 'status', upper(COALESCE(t.status,'UNKNOWN')),
        'employer_name', t.employer_name, 'employer_id', t.employer_id,
        'total_amount', COALESCE(t.total_amount,0)) END
  );
END;
$function$;

-- Atomic decision claim ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_case_request_claim_v1(
  p_id uuid, p_approve boolean, p_actor text, p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_codes text[];
  r record;
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-CASE-REQ-401: authentication required'; END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.cases.approve_requests') THEN
    RAISE EXCEPTION 'CE-CASE-REQ-403: you are not authorised to decide case governance requests';
  END IF;
  IF COALESCE(trim(p_notes),'') = '' THEN
    RAISE EXCEPTION 'CE-CASE-REQ-422: review notes are required';
  END IF;

  SELECT * INTO r FROM public.ce_case_requests WHERE id = p_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'CE-CASE-REQ-404: request not found'; END IF;

  SELECT ARRAY(SELECT DISTINCT x FROM unnest(
           COALESCE(public.ce_officer_identities(v_uid), ARRAY[]::text[]) || ARRAY[v_uid::text]
         ) x WHERE x IS NOT NULL AND x <> '') INTO v_codes;

  IF r.requested_by = ANY(v_codes)
     AND NOT public.ce_actor_can(v_uid,'compliance.workflow.override') THEN
    RAISE EXCEPTION 'CE-CASE-REQ-409: segregation of duties — you cannot decide a request you submitted';
  END IF;

  UPDATE public.ce_case_requests
     SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         reviewed_by = COALESCE(NULLIF(p_actor,''), v_uid::text),
         reviewed_at = now(),
         review_notes = p_notes,
         updated_at = now()
   WHERE id = p_id AND status = 'PENDING';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('claimed', false,
      'message', 'This request was already decided by another reviewer.');
  END IF;

  RETURN jsonb_build_object('claimed', true, 'request_type', r.request_type,
                            'case_id', r.case_id, 'target_case_id', r.target_case_id,
                            'reason', r.reason);
END;
$function$;

-- Recovery when the downstream case action fails ------------------------------
CREATE OR REPLACE FUNCTION public.ce_case_request_revert_v1(
  p_id uuid, p_actor text, p_error text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-CASE-REQ-401: authentication required'; END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.cases.approve_requests') THEN
    RAISE EXCEPTION 'CE-CASE-REQ-403: not authorised';
  END IF;

  UPDATE public.ce_case_requests
     SET status = 'PENDING',
         reviewed_by = NULL,
         reviewed_at = NULL,
         review_notes = NULL,
         metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
           'last_failed_approval', jsonb_build_object(
             'at', now(), 'by', COALESCE(NULLIF(p_actor,''), v_uid::text),
             'error', left(COALESCE(p_error,'unknown error'), 500))),
         updated_at = now()
   WHERE id = p_id AND status = 'APPROVED';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ce_case_request_precheck_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_case_request_claim_v1(uuid,boolean,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_case_request_revert_v1(uuid,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ce_case_request_precheck_v1(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ce_case_request_claim_v1(uuid,boolean,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ce_case_request_revert_v1(uuid,text,text) FROM anon;