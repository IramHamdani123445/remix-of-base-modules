INSERT INTO public.omni_comms_delivery_policy (organization_id, department_id, action_id, mode, print_when, status)
SELECT a.organization_id, NULL, a.id, 'paper_first',
       jsonb_build_object('legally_required', false, 'recipient_requested', true, 'digital_unavailable', true, 'policy_exception', true),
       'active'
FROM public.omni_comms_communication_action a
WHERE a.code = 'CLAIM_RECEIPT_NOTICE'
  AND NOT EXISTS (
    SELECT 1 FROM public.omni_comms_delivery_policy p
    WHERE p.action_id = a.id AND p.department_id IS NULL
  );