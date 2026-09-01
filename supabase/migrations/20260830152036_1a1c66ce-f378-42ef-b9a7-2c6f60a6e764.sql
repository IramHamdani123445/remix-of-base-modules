-- Omni-Comms Internal Convergence Wave 4
-- Registers event definitions for business communications ALREADY PRESENT in
-- the application (evidence-based, not invented), and binds their producers in
-- shadow (evaluate-only) mode so nothing can be delivered before certification.

INSERT INTO public.omni_comms_event_definition
  (code, module_code, entity_type, name, description, communication_class, default_priority, status, business_object_code)
VALUES
  ('FINANCE.INVOICE.ISSUED', 'FINANCE', 'invoice',
   'Invoice issued',
   'Existing behaviour: the cashier Create Invoice screen emails the payer the invoice document (template INVOICE_EMAIL) when an invoice is generated.',
   'transactional', 'normal', 'draft', 'finance_invoice'),
  ('PLATFORM.APPROVAL.GATE_REQUESTED', 'PLATFORM', 'approval',
   'Approval requested — administrator alert',
   'Existing behaviour: gate approval notifications alert administrators that a delivery-gate change awaits approval. Omni owns only the alert; the authoritative task stays in the workflow engine.',
   'transactional', 'normal', 'draft', 'workflow_instance'),
  ('PLATFORM.APPROVAL.GATE_APPROVED', 'PLATFORM', 'approval',
   'Approval granted — administrator alert',
   'Existing behaviour: administrators are alerted when a delivery-gate change is approved.',
   'transactional', 'normal', 'draft', 'workflow_instance'),
  ('PLATFORM.APPROVAL.GATE_REJECTED', 'PLATFORM', 'approval',
   'Approval rejected — administrator alert',
   'Existing behaviour: administrators are alerted when a delivery-gate change is rejected.',
   'transactional', 'normal', 'draft', 'workflow_instance'),
  ('PLATFORM.WORKFLOW.DECISION_NOTIFIED', 'PLATFORM', 'workflow',
   'Workflow decision notification',
   'Existing behaviour: a configured workflow step action sends the applicant the configured notification template on approve / reject / return.',
   'transactional', 'normal', 'draft', 'workflow_instance')
ON CONFLICT (code) DO NOTHING;

UPDATE public.omni_comms_event_definition
SET status = 'active', updated_at = now()
WHERE status = 'draft'
  AND code IN (
    'FINANCE.INVOICE.ISSUED',
    'PLATFORM.APPROVAL.GATE_REQUESTED',
    'PLATFORM.APPROVAL.GATE_APPROVED',
    'PLATFORM.APPROVAL.GATE_REJECTED',
    'PLATFORM.WORKFLOW.DECISION_NOTIFIED'
  );

-- Producer bindings: shadow only. The runtime evaluates and records the
-- emission but persists no dispatch job, so no delivery authority is widened.
INSERT INTO public.omni_comms_producer_event_binding
  (organization_id, department_id, caller_module_code, event_definition_id,
   allowed_modes, status, integration_reference, lifecycle_reason)
SELECT b.organization_id, NULL, v.caller, d.id,
       ARRAY['shadow']::text[], 'active', v.ref,
       'Wave 4 internal convergence: existing communication migrated onto the Omni facade; evaluate-only until module certification.'
FROM (VALUES
  ('FINANCE.INVOICE.ISSUED',              'FINANCE',  'financeDocumentProducer.emitFinanceInvoiceIssued'),
  ('FINANCE.PAYMENT.RECEIPT_ISSUED',      'FINANCE',  'financeDocumentProducer.emitFinanceReceiptIssued'),
  ('PLATFORM.APPROVAL.GATE_REQUESTED',    'PLATFORM', 'platformApprovalAlertProducer.emitGateApprovalAlert'),
  ('PLATFORM.APPROVAL.GATE_APPROVED',     'PLATFORM', 'platformApprovalAlertProducer.emitGateApprovalAlert'),
  ('PLATFORM.APPROVAL.GATE_REJECTED',     'PLATFORM', 'platformApprovalAlertProducer.emitGateApprovalAlert'),
  ('PLATFORM.WORKFLOW.DECISION_NOTIFIED', 'PLATFORM', 'platformApprovalAlertProducer.emitWorkflowDecisionNotification')
) AS v(code, caller, ref)
JOIN public.omni_comms_event_definition d ON d.code = v.code
CROSS JOIN LATERAL (
  SELECT organization_id FROM public.omni_comms_producer_event_binding
  WHERE status = 'active' AND organization_id IS NOT NULL
  ORDER BY created_at LIMIT 1
) b
WHERE NOT EXISTS (
  SELECT 1 FROM public.omni_comms_producer_event_binding x
  WHERE x.event_definition_id = d.id AND x.caller_module_code = v.caller
);