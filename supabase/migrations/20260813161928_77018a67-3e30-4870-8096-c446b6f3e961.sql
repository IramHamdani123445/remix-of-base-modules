
DO $$
DECLARE v_def uuid;
BEGIN
  INSERT INTO public.core_workflow_definition (
    workflow_code, workflow_name, description, module_code, domain_code,
    entity_type, version, workflow_status, start_step_code,
    requires_reason_on_reject, allow_withdrawal, allow_delegation,
    allow_reassignment, is_active
  ) VALUES (
    'OMNI_COMMS_GATE_APPROVAL',
    'Omnichannel Communications — Delivery Gate Approval',
    'Second-person approval for enabling or disabling an Omnichannel Communications delivery gate (automatic channel delivery and business-event delivery).',
    'OMNI_COMMS', 'COMMUNICATION',
    'omni_comms_gate_request', 1, 'ACTIVE', 'REQUESTED',
    true, true, false, true, true
  )
  ON CONFLICT (workflow_code, version) DO UPDATE
    SET workflow_name = EXCLUDED.workflow_name,
        description = EXCLUDED.description,
        module_code = EXCLUDED.module_code,
        domain_code = EXCLUDED.domain_code,
        entity_type = EXCLUDED.entity_type,
        workflow_status = 'ACTIVE',
        start_step_code = 'REQUESTED',
        is_active = true,
        updated_at = now()
  RETURNING id INTO v_def;

  IF v_def IS NULL THEN
    SELECT id INTO v_def FROM public.core_workflow_definition
     WHERE workflow_code = 'OMNI_COMMS_GATE_APPROVAL' AND version = 1;
  END IF;

  DELETE FROM public.core_workflow_transition WHERE workflow_definition_id = v_def;
  DELETE FROM public.core_workflow_step WHERE workflow_definition_id = v_def;

  INSERT INTO public.core_workflow_step (
    workflow_definition_id, step_code, step_name, description, step_type,
    assigned_permission_key, is_start_step, is_end_step, allow_comments,
    allow_attachments, requires_reason, display_order, is_active
  ) VALUES
    (v_def, 'REQUESTED', 'Requested', 'An operator requested a delivery gate change.', 'START', 'omni_comms.operate', true, false, true, false, false, 1, true),
    (v_def, 'APPROVAL', 'Second-person approval', 'A different administrator must confirm the gate change.', 'APPROVAL', 'omni_comms.operate', false, false, true, false, false, 2, true),
    (v_def, 'CLOSED', 'Closed', 'The gate request is closed.', 'END', NULL, false, true, true, false, false, 3, true);

  INSERT INTO public.core_workflow_transition (
    workflow_definition_id, from_step_code, to_step_code, transition_code,
    transition_name, action_type, required_permission_key, requires_reason,
    requires_comment, is_terminal, display_order, is_active
  ) VALUES
    (v_def, 'REQUESTED', 'APPROVAL', 'SUBMIT', 'Submit for approval', 'SUBMIT', 'omni_comms.operate', false, false, false, 1, true),
    (v_def, 'APPROVAL', 'CLOSED', 'APPROVE', 'Approve gate change', 'APPROVE', 'omni_comms.operate', false, false, true, 2, true),
    (v_def, 'APPROVAL', 'CLOSED', 'REJECT', 'Reject gate change', 'REJECT', 'omni_comms.operate', true, false, true, 3, true),
    (v_def, 'REQUESTED', 'CLOSED', 'WITHDRAW', 'Withdraw request', 'WITHDRAW', 'omni_comms.operate', false, false, true, 4, true);
END $$;
