
DO $$
DECLARE v_def uuid;
BEGIN
  SELECT id INTO v_def FROM public.core_workflow_definition
   WHERE workflow_code = 'OMNI_COMMS_GATE_APPROVAL' ORDER BY version DESC LIMIT 1;
  IF v_def IS NULL THEN RAISE NOTICE 'definition missing'; RETURN; END IF;

  UPDATE public.core_workflow_definition
     SET version = 2,
         start_step_code = 'APPROVAL',
         allow_withdrawal = true,
         updated_at = now()
   WHERE id = v_def;

  UPDATE public.core_workflow_step
     SET is_start_step = false, is_active = false, updated_at = now()
   WHERE workflow_definition_id = v_def AND step_code = 'REQUESTED';

  UPDATE public.core_workflow_step
     SET is_start_step = true,
         is_active = true,
         display_order = 1,
         assigned_permission_key = 'omni_comms.operate',
         updated_at = now()
   WHERE workflow_definition_id = v_def AND step_code = 'APPROVAL';

  UPDATE public.core_workflow_transition
     SET is_active = false, updated_at = now()
   WHERE workflow_definition_id = v_def AND transition_code = 'SUBMIT';

  UPDATE public.core_workflow_transition
     SET from_step_code = 'APPROVAL', updated_at = now()
   WHERE workflow_definition_id = v_def AND transition_code = 'WITHDRAW';
END $$;
