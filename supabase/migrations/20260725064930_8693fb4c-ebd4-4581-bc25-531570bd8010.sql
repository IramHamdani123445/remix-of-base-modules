
CREATE OR REPLACE FUNCTION public.get_comm_hub_go_live_gate_snapshot(
  p_module_code text,
  p_event_code text,
  p_channel text,
  p_preview_snapshot_id uuid DEFAULT NULL,
  p_preview_approval_id uuid DEFAULT NULL,
  p_dry_run_execution_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_evaluator_version constant text := 'comm-hub-go-live-gates/v1';
  v_actor uuid;
  v_role text;
  v_snap communication_preview_snapshot%ROWTYPE;
  v_appr communication_preview_approval%ROWTYPE;
  v_exec communication_dry_run_execution%ROWTYPE;
  v_gates jsonb := '[]'::jsonb;
  v_passed int := 0;
  v_total int := 0;
  v_first_blocker jsonb := NULL;
  v_overall text := 'CHECKING';
  v_correlation uuid;
  v_seq int := 0;
  v_delivery_attempts int := 0;
  v_cert_exists boolean := false;
BEGIN
  BEGIN
    v_actor := auth.uid();
    v_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL; v_role := NULL;
  END;

  IF p_preview_snapshot_id IS NOT NULL THEN
    SELECT * INTO v_snap FROM communication_preview_snapshot WHERE id = p_preview_snapshot_id;
  END IF;
  IF p_preview_approval_id IS NOT NULL THEN
    SELECT * INTO v_appr FROM communication_preview_approval WHERE id = p_preview_approval_id;
  END IF;
  IF p_dry_run_execution_id IS NOT NULL THEN
    SELECT * INTO v_exec FROM communication_dry_run_execution WHERE id = p_dry_run_execution_id;
    v_cert_exists := v_exec.certification_id IS NOT NULL;
    IF v_exec.request_id IS NOT NULL THEN
      SELECT count(*) INTO v_delivery_attempts FROM communication_delivery_attempt WHERE request_id = v_exec.request_id;
    END IF;
  END IF;
  IF v_snap.id IS NOT NULL THEN v_correlation := v_snap.correlation_id; END IF;

  -- 1. ACCESS: browser session
  v_seq := v_seq + 1; v_total := v_total + 1;
  v_gates := v_gates || jsonb_build_array(jsonb_build_object(
    'id','access.browser_session','group','ACCESS','name','Browser session available','sequence',v_seq,
    'status', CASE WHEN v_actor IS NOT NULL THEN 'PASSED' ELSE 'NOT_STARTED' END,
    'summary', CASE WHEN v_actor IS NOT NULL THEN 'A browser session is available.' ELSE 'Sign in to begin.' END,
    'action', jsonb_build_object('kind', CASE WHEN v_actor IS NOT NULL THEN 'NO_ACTION_REQUIRED' ELSE 'SIGN_IN_AGAIN' END,'label', CASE WHEN v_actor IS NOT NULL THEN 'No action required' ELSE 'Sign in again' END,'route',NULL),
    'source', jsonb_build_object('layer','BROWSER','function','getActionReadySession','evaluator_version',v_evaluator_version,'checked_at',v_now)
  ));
  IF v_actor IS NOT NULL THEN v_passed := v_passed + 1; END IF;

  -- 1b. ACCESS: postgrest operator identity
  v_seq := v_seq + 1; v_total := v_total + 1;
  v_gates := v_gates || jsonb_build_array(jsonb_build_object(
    'id','access.postgrest_operator','group','ACCESS','name','PostgREST operator identity','sequence',v_seq,
    'status', CASE WHEN v_actor IS NOT NULL AND v_role = 'authenticated' THEN 'PASSED' ELSE 'BLOCKED' END,
    'summary', CASE WHEN v_actor IS NOT NULL AND v_role = 'authenticated' THEN 'The database identified the signed-in operator.' ELSE 'The database could not identify the signed-in operator.' END,
    'why_it_blocks','Dry Run runtime transitions require a server-derived operator.',
    'current_value', COALESCE(v_actor::text,'No actor derived'),
    'required_value','Authenticated operator identity',
    'blocker_codes', CASE WHEN v_actor IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN jsonb_build_array('OPERATOR_JWT_NOT_PROPAGATED_TO_POSTGREST') ELSE '[]'::jsonb END,
    'action', CASE WHEN v_actor IS NULL OR v_role IS DISTINCT FROM 'authenticated'
      THEN jsonb_build_object('kind','PLATFORM_FIX','label','Platform JWT propagation fix required','route',NULL)
      ELSE jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL) END,
    'retry_safe', true, 'mutation_started', false,
    'source', jsonb_build_object('layer','EDGE_OPERATOR_PROBE','function','probe_comm_hub_operator_identity','evaluator_version',v_evaluator_version,'checked_at',v_now)
  ));
  IF v_actor IS NOT NULL AND v_role = 'authenticated' THEN v_passed := v_passed + 1; END IF;

  -- 2. EVENT SETUP
  v_seq := v_seq + 1; v_total := v_total + 1;
  DECLARE v_event_registered boolean;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM communication_hub_module_event_registry WHERE module_code = p_module_code AND event_code = p_event_code) INTO v_event_registered;
    v_gates := v_gates || jsonb_build_array(jsonb_build_object(
      'id','setup.module_event_registered','group','EVENT_SETUP','name','Module/event registered','sequence',v_seq,
      'status', CASE WHEN p_module_code IS NULL OR p_event_code IS NULL THEN 'NOT_STARTED' WHEN v_event_registered THEN 'PASSED' ELSE 'BLOCKED' END,
      'summary', CASE WHEN v_event_registered THEN 'Event is registered.' ELSE 'Event is not registered.' END,
      'action', CASE WHEN v_event_registered THEN jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL) ELSE jsonb_build_object('kind','OPEN_TEMPLATE_CONTRACT','label','Register module/event','route','/admin/communication-hub/design') END,
      'blocker_codes', CASE WHEN v_event_registered THEN '[]'::jsonb ELSE jsonb_build_array('MODULE_EVENT_NOT_REGISTERED') END,
      'source', jsonb_build_object('layer','DB','function','communication_hub_module_event_registry','evaluator_version',v_evaluator_version,'checked_at',v_now)
    ));
    IF v_event_registered THEN v_passed := v_passed + 1; END IF;
  END;

  -- 3. PREVIEW
  v_seq := v_seq + 1; v_total := v_total + 1;
  DECLARE v_status text; v_summary text; v_blockers jsonb := '[]'::jsonb;
  BEGIN
    IF v_snap.id IS NULL THEN
      v_status := 'NOT_STARTED'; v_summary := 'No Preview snapshot prepared for this attempt.';
    ELSIF v_snap.status IN ('EXPIRED','SUPERSEDED','REVOKED') THEN
      v_status := v_snap.status; v_summary := 'Preview snapshot is ' || lower(v_snap.status) || '.';
      v_blockers := jsonb_build_array('PREVIEW_SNAPSHOT_' || v_snap.status);
    ELSIF v_snap.status = 'ACTIVE' AND COALESCE(jsonb_array_length(v_snap.unresolved_variables),0) = 0
      AND COALESCE(v_snap.raw_placeholder_count,0) = 0 AND v_snap.content_hash IS NOT NULL AND v_snap.recipient_set_hash IS NOT NULL THEN
      v_status := 'PASSED'; v_summary := 'Preview snapshot is active with zero unresolved variables.';
    ELSE
      v_status := 'BLOCKED'; v_summary := 'Preview snapshot has unresolved variables or missing hashes.';
      IF COALESCE(jsonb_array_length(v_snap.unresolved_variables),0) > 0 THEN v_blockers := v_blockers || jsonb_build_array('RESOLVER_REQUIRED_UNRESOLVED'); END IF;
      IF COALESCE(v_snap.raw_placeholder_count,0) > 0 THEN v_blockers := v_blockers || jsonb_build_array('RAW_PLACEHOLDERS_PRESENT'); END IF;
    END IF;
    v_gates := v_gates || jsonb_build_array(jsonb_build_object(
      'id','preview.snapshot','group','PREVIEW','name','Preview snapshot ready','sequence',v_seq,
      'status',v_status,'summary',v_summary,'blocker_codes',v_blockers,
      'action', CASE WHEN v_status = 'PASSED' THEN jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL)
        ELSE jsonb_build_object('kind','CREATE_FRESH_PREVIEW','label','Create a fresh Preview','route',NULL) END,
      'current_value', COALESCE(v_snap.status,'—'), 'required_value','ACTIVE with zero unresolved variables',
      'source', jsonb_build_object('layer','DB','function','prepare_comm_hub_preview','evaluator_version',v_evaluator_version,'checked_at',v_now,'source_record_id',v_snap.id)
    ));
    IF v_status = 'PASSED' THEN v_passed := v_passed + 1; END IF;
  END;

  -- 4. APPROVAL
  v_seq := v_seq + 1; v_total := v_total + 1;
  DECLARE v_status text; v_summary text; v_blockers jsonb := '[]'::jsonb;
  BEGIN
    IF v_appr.id IS NULL THEN
      v_status := 'NOT_STARTED'; v_summary := 'No approval recorded for this Preview.';
    ELSIF v_snap.id IS NOT NULL AND v_appr.snapshot_id <> v_snap.id THEN
      v_status := 'SUPERSEDED'; v_summary := 'Approval does not belong to the current Preview.';
      v_blockers := jsonb_build_array('APPROVAL_SNAPSHOT_MISMATCH');
    ELSIF v_appr.expires_at IS NOT NULL AND v_appr.expires_at < v_now THEN
      v_status := 'EXPIRED'; v_summary := 'Approval has expired.'; v_blockers := jsonb_build_array('APPROVAL_EXPIRED');
    ELSIF v_appr.status = 'ACTIVE' THEN
      v_status := 'PASSED'; v_summary := 'Approval is active and bound to the current Preview.';
    ELSE
      v_status := 'BLOCKED'; v_summary := 'Approval is not active (status ' || COALESCE(v_appr.status,'unknown') || ').';
      v_blockers := jsonb_build_array('APPROVAL_NOT_ACTIVE');
    END IF;
    v_gates := v_gates || jsonb_build_array(jsonb_build_object(
      'id','approval.active','group','APPROVAL','name','Approval active and bound to Preview','sequence',v_seq,
      'status',v_status,'summary',v_summary,'blocker_codes',v_blockers,
      'action', CASE WHEN v_status = 'PASSED' THEN jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL)
        WHEN v_status IN ('EXPIRED','SUPERSEDED') THEN jsonb_build_object('kind','CREATE_FRESH_PREVIEW','label','Create a fresh Preview','route',NULL)
        WHEN v_status = 'NOT_STARTED' THEN jsonb_build_object('kind','APPROVE_PREVIEW','label','Approve the current Preview','route',NULL)
        ELSE jsonb_build_object('kind','APPROVE_PREVIEW','label','Approve the Preview','route',NULL) END,
      'current_value', COALESCE(v_appr.status,'—'), 'required_value','ACTIVE, unexpired, bound to selected Preview',
      'source', jsonb_build_object('layer','DB','function','approve_comm_hub_preview','evaluator_version',v_evaluator_version,'checked_at',v_now,'source_record_id',v_appr.id)
    ));
    IF v_status = 'PASSED' THEN v_passed := v_passed + 1; END IF;
  END;

  -- 5. DRY-RUN READINESS
  v_seq := v_seq + 1; v_total := v_total + 1;
  DECLARE v_status text; v_summary text;
  BEGIN
    IF v_appr.id IS NULL OR v_appr.status <> 'ACTIVE' THEN
      v_status := 'NOT_STARTED'; v_summary := 'Approve a Preview to enable readiness evaluation.';
    ELSIF v_snap.id IS NOT NULL AND v_snap.recipient_set_hash IS NOT NULL AND v_correlation IS NOT NULL THEN
      v_status := 'PASSED'; v_summary := 'Recipient hash and correlation available; preflight can run.';
    ELSE
      v_status := 'BLOCKED'; v_summary := 'Missing recipient hash or correlation for preflight.';
    END IF;
    v_gates := v_gates || jsonb_build_array(jsonb_build_object(
      'id','readiness.preflight','group','DRY_RUN_READINESS','name','Dry-run preflight ready','sequence',v_seq,
      'status',v_status,'summary',v_summary,
      'action', CASE WHEN v_status = 'PASSED' THEN jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL)
        ELSE jsonb_build_object('kind','RECHECK_READINESS','label','Re-check readiness','route',NULL) END,
      'source', jsonb_build_object('layer','DB','function','inspect_comm_hub_dry_run_preflight','evaluator_version',v_evaluator_version,'checked_at',v_now)
    ));
    IF v_status = 'PASSED' THEN v_passed := v_passed + 1; END IF;
  END;

  -- 6. PLATFORM SERVICE
  v_seq := v_seq + 1; v_total := v_total + 1;
  v_gates := v_gates || jsonb_build_array(jsonb_build_object(
    'id','service.role_probe','group','PLATFORM_SERVICE','name','Service-role positive probe','sequence',v_seq,
    'status', CASE WHEN v_exec.id IS NOT NULL THEN 'PASSED' ELSE 'NOT_STARTED' END,
    'summary', CASE WHEN v_exec.id IS NOT NULL THEN 'Service-role probe passed (execution reached ' || v_exec.state || ').' ELSE 'Not yet exercised — begin a Dry Run to probe.' END,
    'action', jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL),
    'source', jsonb_build_object('layer','EDGE','function','probe_comm_hub_dry_run_service_identity','evaluator_version',v_evaluator_version,'checked_at',v_now)
  ));
  IF v_exec.id IS NOT NULL THEN v_passed := v_passed + 1; END IF;

  -- 7. DRY-RUN PROCESSING
  v_seq := v_seq + 1; v_total := v_total + 1;
  DECLARE v_status text; v_summary text;
  BEGIN
    IF v_exec.id IS NULL THEN v_status := 'NOT_STARTED'; v_summary := 'No Dry Run execution created yet.';
    ELSIF v_exec.state IN ('PROCESSED','CERTIFIED') THEN v_status := 'PASSED'; v_summary := 'Execution reached ' || v_exec.state || '.';
    ELSIF v_exec.state IN ('FAILED','BLOCKED') THEN v_status := 'BLOCKED'; v_summary := 'Execution failed at stage ' || COALESCE(v_exec.failure_stage,'unknown') || '.';
    ELSE v_status := 'CHECKING'; v_summary := 'Execution in progress (state ' || v_exec.state || ').';
    END IF;
    v_gates := v_gates || jsonb_build_array(jsonb_build_object(
      'id','processing.execution','group','DRY_RUN_PROCESSING','name','Execution reached PROCESSED','sequence',v_seq,
      'status',v_status,'summary',v_summary,
      'current_value', COALESCE(v_exec.state,'—'), 'required_value','PROCESSED or CERTIFIED',
      'blocker_codes', COALESCE(v_exec.blockers,'[]'::jsonb),
      'action', CASE WHEN v_status = 'BLOCKED' THEN jsonb_build_object('kind','RESUME_EXISTING_EXECUTION','label','Investigate failed execution','route',NULL)
        ELSE jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL) END,
      'source', jsonb_build_object('layer','DB','function','process_comm_hub_dry_run_execution','evaluator_version',v_evaluator_version,'checked_at',v_now,'source_record_id',v_exec.id)
    ));
    IF v_status = 'PASSED' THEN v_passed := v_passed + 1; END IF;
  END;

  -- 8. CERTIFICATION
  v_seq := v_seq + 1; v_total := v_total + 1;
  DECLARE v_status text; v_summary text;
  BEGIN
    IF v_exec.id IS NULL OR v_exec.state NOT IN ('PROCESSED','CERTIFIED') THEN
      v_status := 'NOT_STARTED'; v_summary := 'Certification runs after execution is PROCESSED.';
    ELSIF v_cert_exists AND v_delivery_attempts = 0 THEN
      v_status := 'PASSED'; v_summary := 'Certification linked; zero delivery attempts, provider or simulator calls.';
    ELSIF v_delivery_attempts > 0 THEN
      v_status := 'BLOCKED'; v_summary := 'Delivery attempts detected (' || v_delivery_attempts || ') — Dry Run must remain non-sending.';
    ELSE
      v_status := 'CHECKING'; v_summary := 'Certification pending.';
    END IF;
    v_gates := v_gates || jsonb_build_array(jsonb_build_object(
      'id','certification.completed','group','CERTIFICATION','name','Certification completed','sequence',v_seq,
      'status',v_status,'summary',v_summary,
      'action', CASE WHEN v_status = 'BLOCKED' THEN jsonb_build_object('kind','CONTACT_PLATFORM_ADMIN','label','Contact platform admin','route',NULL)
        ELSE jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL) END,
      'source', jsonb_build_object('layer','DB','function','certify_comm_hub_dry_run','evaluator_version',v_evaluator_version,'checked_at',v_now,'source_record_id',v_exec.certification_id)
    ));
    IF v_status = 'PASSED' THEN v_passed := v_passed + 1; END IF;
  END;

  SELECT to_jsonb(g) INTO v_first_blocker
  FROM jsonb_array_elements(v_gates) WITH ORDINALITY AS t(g, ord)
  WHERE (g->>'status') IN ('BLOCKED','EXPIRED','SUPERSEDED')
  ORDER BY (g->>'sequence')::int LIMIT 1;

  IF v_first_blocker IS NOT NULL THEN v_overall := 'BLOCKED';
  ELSIF v_passed = v_total THEN v_overall := 'PASSED';
  ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(v_gates) e WHERE e->>'status' = 'CHECKING') THEN v_overall := 'CHECKING';
  ELSE v_overall := 'NOT_STARTED';
  END IF;

  RETURN jsonb_build_object(
    'snapshot_version', v_evaluator_version, 'evaluated_at', v_now,
    'module_code', p_module_code, 'event_code', p_event_code, 'channel', p_channel,
    'correlation_id', v_correlation, 'current_attempt_id', p_dry_run_execution_id,
    'preview_snapshot_id', p_preview_snapshot_id, 'preview_approval_id', p_preview_approval_id,
    'dry_run_execution_id', p_dry_run_execution_id,
    'overall_status', v_overall, 'passed_gate_count', v_passed, 'total_gate_count', v_total,
    'first_blocking_gate_id', v_first_blocker->>'id',
    'recommended_action', COALESCE(v_first_blocker->'action', jsonb_build_object('kind','NO_ACTION_REQUIRED','label','No action required','route',NULL)),
    'gates', v_gates
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_comm_hub_go_live_gate_snapshot(text,text,text,uuid,uuid,uuid) TO authenticated, service_role;
