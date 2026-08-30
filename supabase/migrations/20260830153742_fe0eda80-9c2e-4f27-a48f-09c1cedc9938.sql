INSERT INTO public.omni_comms_event_definition
  (code, module_code, entity_type, name, description, communication_class, default_priority, status)
VALUES
  ('LEGAL.REFERRAL.INFO_REQUESTED', 'LEGAL', 'referral',
   'Legal information requested',
   'Existing behaviour: Legal asks the source department (Benefits or Compliance) to supply further information on a referral.',
   'transactional', 'high', 'draft'),
  ('LEGAL.REFERRAL.INFO_RESPONDED', 'LEGAL', 'referral',
   'Legal information response received',
   'Existing behaviour: the source department has supplied the information Legal requested on a referral.',
   'transactional', 'normal', 'draft'),
  ('LEGAL.JUDICIAL.EVENT_NOTIFIED', 'LEGAL', 'judicial',
   'Judicial event notice',
   'Existing behaviour: a configured judicial event (order, appeal, enforcement, recovery, closure) notifies the assigned officers.',
   'transactional', 'normal', 'draft'),
  ('COMPLIANCE.AUDIT.COMMUNICATION_ISSUED', 'COMPLIANCE', 'audit',
   'Employer audit communication issued',
   'Existing behaviour: an approved employer audit or visit communication is issued to its recipients.',
   'transactional', 'normal', 'draft')
ON CONFLICT (code) DO NOTHING;

UPDATE public.omni_comms_event_definition
SET status = 'active', updated_at = now()
WHERE status = 'draft'
  AND code IN (
    'LEGAL.REFERRAL.INFO_REQUESTED',
    'LEGAL.REFERRAL.INFO_RESPONDED',
    'LEGAL.JUDICIAL.EVENT_NOTIFIED',
    'COMPLIANCE.AUDIT.COMMUNICATION_ISSUED'
  );

INSERT INTO public.omni_comms_producer_event_binding
  (organization_id, caller_module_code, event_definition_id, allowed_modes, status, integration_reference, lifecycle_reason, activated_at)
SELECT
  '69afc88b-da5c-4f41-a1e7-199e1ee1d416'::uuid,
  d.module_code,
  d.id,
  ARRAY['shadow']::text[],
  'active',
  ref.integration_reference,
  'Wave 5 internal convergence: evaluate-only until the module is certified for live delivery.',
  now()
FROM public.omni_comms_event_definition d
JOIN (VALUES
  ('LEGAL.REFERRAL.INFO_REQUESTED', 'legalCommunicationProducer.emitLegalInfoRequested'),
  ('LEGAL.REFERRAL.INFO_RESPONDED', 'legalCommunicationProducer.emitLegalInfoResponded'),
  ('LEGAL.JUDICIAL.EVENT_NOTIFIED', 'legalCommunicationProducer.emitJudicialEventNotice'),
  ('COMPLIANCE.AUDIT.COMMUNICATION_ISSUED', 'complianceAuditCommunicationProducer.emitAuditCommunicationIssued')
) AS ref(code, integration_reference) ON ref.code = d.code
WHERE NOT EXISTS (
  SELECT 1 FROM public.omni_comms_producer_event_binding b
  WHERE b.event_definition_id = d.id
    AND b.caller_module_code = d.module_code
);