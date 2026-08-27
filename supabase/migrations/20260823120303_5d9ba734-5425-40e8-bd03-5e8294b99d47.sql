-- 1. Complete the canonical legal_referral lifecycle configuration inside the
--    existing "CE Status — Trivial Transitions" workflow (same canonical
--    workflow already used by the violation transition guard).
DO $$
DECLARE
  v_wf uuid;
  v_next int;
  v_from text;
  v_step uuid;
  t record;
BEGIN
  SELECT id INTO v_wf FROM public.workflow_definitions
   WHERE name = 'CE Status — Trivial Transitions' LIMIT 1;
  IF v_wf IS NULL THEN
    RAISE EXCEPTION 'Canonical CE status workflow not found';
  END IF;

  FOR t IN
    SELECT * FROM (VALUES
      ('DRAFT','PENDING_APPROVAL','REQUEST_APPROVAL','Send for Approval'),
      ('DRAFT','APPROVED_FOR_SUBMISSION','AUTO_APPROVE','Auto-approve (no approval workflow mapped)'),
      ('DRAFT','REJECTED','REJECT','Reject'),
      ('DRAFT','CLOSED','CLOSE','Close'),
      ('PENDING_APPROVAL','APPROVED_FOR_SUBMISSION','APPROVE','Approve for Submission'),
      ('PENDING_APPROVAL','REJECTED','REJECT','Reject'),
      ('PENDING_APPROVAL','DRAFT','WITHDRAW','Withdraw to Draft'),
      ('APPROVED_FOR_SUBMISSION','SUBMITTED_TO_LEGAL','SUBMIT','Submit to Legal'),
      ('APPROVED_FOR_SUBMISSION','REJECTED','REJECT','Reject'),
      ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','ACCEPT','Accept (Legal)'),
      ('SUBMITTED_TO_LEGAL','RETURNED_BY_LEGAL','RETURN','Return to Compliance (Legal)'),
      ('SUBMITTED_TO_LEGAL','REJECTED','REJECT','Reject (Legal)'),
      ('SUBMITTED_TO_LEGAL','CLOSED','CLOSE','Close'),
      ('ACCEPTED_BY_LEGAL','IN_LEGAL_PROCEEDINGS','START_PROCEEDINGS','Start Proceedings'),
      ('ACCEPTED_BY_LEGAL','RETURNED_BY_LEGAL','RETURN','Return to Compliance (Legal)'),
      ('ACCEPTED_BY_LEGAL','CLOSED','CLOSE','Close'),
      ('RETURNED_BY_LEGAL','PENDING_APPROVAL','RESUBMIT','Resubmit for Approval'),
      ('RETURNED_BY_LEGAL','DRAFT','REWORK','Return to Draft'),
      ('RETURNED_BY_LEGAL','REJECTED','REJECT','Reject'),
      ('RETURNED_BY_LEGAL','CLOSED','CLOSE','Close'),
      ('IN_LEGAL_PROCEEDINGS','CLOSED','CLOSE','Close'),
      ('REJECTED','DRAFT','REOPEN','Reopen as Draft'),
      ('REJECTED','CLOSED','CLOSE','Close')
    ) AS v(from_status, to_status, action_code, action_name)
  LOOP
    v_from := t.from_status;

    SELECT id INTO v_step FROM public.workflow_steps
     WHERE workflow_id = v_wf AND step_name = 'legal_referral:' || v_from LIMIT 1;

    IF v_step IS NULL THEN
      SELECT coalesce(max(step_number), 0) + 1 INTO v_next
        FROM public.workflow_steps WHERE workflow_id = v_wf;
      INSERT INTO public.workflow_steps (workflow_id, step_number, step_name, action_type, from_status, description)
      VALUES (v_wf, v_next, 'legal_referral:' || v_from, 'Review', v_from,
              'Configured legal referral transitions available from ' || v_from)
      RETURNING id INTO v_step;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.workflow_step_actions
       WHERE step_id = v_step AND upper(coalesce(result_status,'')) = t.to_status
    ) THEN
      INSERT INTO public.workflow_step_actions (step_id, action_name, action_code, result_status)
      VALUES (v_step, t.action_name, t.action_code, t.to_status);
    END IF;
  END LOOP;

  -- Remove the configured shortcut that allowed a draft to jump straight to
  -- Legal: preparation and approval may not be bypassed.
  DELETE FROM public.workflow_step_actions wsa
   USING public.workflow_steps ws
   WHERE wsa.step_id = ws.id
     AND ws.workflow_id = v_wf
     AND ws.step_name = 'legal_referral:DRAFT'
     AND upper(coalesce(wsa.result_status,'')) = 'SUBMITTED_TO_LEGAL';
END $$;

-- 2. Replace the hardcoded transition map with a configuration lookup.
--    Business prerequisite guards (maker-checker, approver required, reasons)
--    are retained here; pack completeness stays in its own trigger.
CREATE OR REPLACE FUNCTION public.fn_ce_legal_referral_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old text := upper(coalesce(OLD.status, ''));
  v_new text := upper(coalesce(NEW.status, ''));
  v_ok boolean;
  v_configured int;
BEGIN
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;

  -- Same canonical workflow scope used by the violation guard: the baseline CE
  -- status workflow plus any enabled legal-referral workflow mapping.
  WITH scopes AS (
    SELECT DISTINCT m.workflow_definition_id AS wf
      FROM public.ce_workflow_mappings m
     WHERE m.enabled
       AND m.workflow_definition_id IS NOT NULL
       AND m.event_key LIKE 'legal_referral.status.%'
    UNION
    SELECT wd.id FROM public.workflow_definitions wd
     WHERE wd.name = 'CE Status — Trivial Transitions'
  ),
  configured AS (
    SELECT upper(ws.from_status) AS from_status, upper(wsa.result_status) AS to_status
      FROM public.workflow_steps ws
      JOIN public.workflow_step_actions wsa ON wsa.step_id = ws.id
      JOIN public.workflow_definitions wd ON wd.id = ws.workflow_id
      JOIN scopes s ON s.wf = ws.workflow_id
     WHERE wd.is_active
       AND split_part(ws.step_name, ':', 1) = 'legal_referral'
       AND wsa.result_status IS NOT NULL
  )
  SELECT count(*), bool_or(from_status = v_old AND to_status = v_new)
    INTO v_configured, v_ok
    FROM configured;

  IF coalesce(v_configured, 0) = 0 THEN
    -- Fail closed: never allow uncontrolled transitions when configuration is absent.
    RAISE EXCEPTION 'No active legal referral workflow configuration found; transition % -> % refused', v_old, v_new
      USING ERRCODE = '23514';
  END IF;

  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'Legal referral transition % -> % is not allowed by the configured workflow.', v_old, v_new
      USING ERRCODE = '23514';
  END IF;

  -- ── Business prerequisite guards (not transition definitions) ────────────
  IF v_new = 'APPROVED_FOR_SUBMISSION' AND v_old = 'PENDING_APPROVAL' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'An approver must be recorded when approving a legal referral'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.approval_requested_by IS NOT NULL
       AND upper(btrim(NEW.approved_by)) = upper(btrim(NEW.approval_requested_by)) THEN
      RAISE EXCEPTION 'Maker-checker violation: % requested this referral and cannot approve it', NEW.approved_by
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_new = 'REJECTED' AND coalesce(btrim(NEW.rejection_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '23514';
  END IF;

  IF v_new = 'RETURNED_BY_LEGAL' AND coalesce(btrim(NEW.return_reason), '') = '' THEN
    RAISE EXCEPTION 'A return reason is required' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;