CREATE TABLE IF NOT EXISTS public.ia_comms_reminder_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_kind text NOT NULL
    CHECK (obligation_kind IN ('management_response','action','follow_up')),
  days_relative_to_due integer NOT NULL,
  event_code text NOT NULL,
  occurrence_key text NOT NULL,
  escalation_roles text[] NOT NULL DEFAULT '{}'::text[],
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obligation_kind, days_relative_to_due, event_code, occurrence_key)
);

GRANT SELECT ON public.ia_comms_reminder_policy TO authenticated;
GRANT ALL ON public.ia_comms_reminder_policy TO service_role;
ALTER TABLE public.ia_comms_reminder_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_comms_reminder_policy_read ON public.ia_comms_reminder_policy;
CREATE POLICY ia_comms_reminder_policy_read
  ON public.ia_comms_reminder_policy FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ia_comms_reminder_policy_write ON public.ia_comms_reminder_policy;
CREATE POLICY ia_comms_reminder_policy_write
  ON public.ia_comms_reminder_policy FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'Admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.ia_comms_reminder_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  obligation_kind text NOT NULL,
  event_code text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  occurrence text NOT NULL,
  recipient_profile_id uuid,
  outcome text NOT NULL,
  reason text,
  event_outbox_id uuid
);

CREATE INDEX IF NOT EXISTS ia_comms_reminder_run_log_run_at_idx
  ON public.ia_comms_reminder_run_log (run_at DESC);

GRANT SELECT ON public.ia_comms_reminder_run_log TO authenticated;
GRANT ALL ON public.ia_comms_reminder_run_log TO service_role;
ALTER TABLE public.ia_comms_reminder_run_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_comms_reminder_run_log_read ON public.ia_comms_reminder_run_log;
CREATE POLICY ia_comms_reminder_run_log_read
  ON public.ia_comms_reminder_run_log FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.ia_comms_emit(
  p_event_code text,
  p_entity_type text,
  p_entity_id text,
  p_occurrence text,
  p_recipient_facts jsonb,
  p_payload jsonb,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF coalesce(jsonb_typeof(p_recipient_facts), 'null') <> 'object'
     OR p_recipient_facts = '{}'::jsonb THEN
    RETURN jsonb_build_object('status','blocked','reason','recipient_resolution_failed');
  END IF;

  v_result := public.omni_comms_priv_enqueue_business_event(
    NULL,
    'INTERNAL_AUDIT',
    upper(btrim(p_event_code)),
    p_entity_type,
    p_entity_id,
    coalesce(nullif(btrim(p_occurrence), ''), 'default'),
    NULL,
    NULL,
    p_recipient_facts,
    coalesce(p_payload, '{}'::jsonb),
    p_correlation_id
  );

  RETURN v_result || jsonb_build_object('status', coalesce(v_result->>'status','queued'));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','failed','reason', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.ia_comms_emit(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ia_comms_emit(text,text,text,text,jsonb,jsonb,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ia_comms_emit(text,text,text,text,jsonb,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.ia_comms_profile_fact(
  p_role text,
  p_profile_id uuid,
  p_fallback_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p.id IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      p_role,
      jsonb_build_object(
        'recipient_type','internal',
        'recipient_reference', p.id::text,
        'display_name', coalesce(nullif(btrim(p.full_name),''), p_fallback_name, 'Recipient'),
        'email', nullif(btrim(coalesce(p.email,'')),'')
      )
    )
  END
  FROM public.profiles p
  WHERE p.id = p_profile_id;
$$;

GRANT EXECUTE ON FUNCTION public.ia_comms_profile_fact(text,uuid,text) TO service_role;

INSERT INTO public.ia_comms_reminder_policy
  (obligation_kind, days_relative_to_due, event_code, occurrence_key, escalation_roles, label)
VALUES
  ('management_response',  7, 'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED', 'due_soon_7',  '{}',                                  'Response due in 7 days'),
  ('management_response',  1, 'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED', 'due_soon_1',  '{}',                                  'Response due tomorrow'),
  ('management_response',  0, 'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED', 'due_today',   '{}',                                  'Response due today'),
  ('management_response', -1, 'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED', 'overdue_1',   '{lead_auditor}',                      'Response 1 day overdue'),
  ('management_response', -7, 'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED', 'overdue_7',   '{lead_auditor,department_head}',      'Response 7 days overdue'),
  ('action', 14, 'INTERNAL_AUDIT.ACTION.DUE_SOON',  'due_soon_14', '{}',                                          'Action due in 14 days'),
  ('action',  7, 'INTERNAL_AUDIT.ACTION.DUE_SOON',  'due_soon_7',  '{}',                                          'Action due in 7 days'),
  ('action',  0, 'INTERNAL_AUDIT.ACTION.DUE_SOON',  'due_today',   '{}',                                          'Action due today'),
  ('action', -7, 'INTERNAL_AUDIT.ACTION.OVERDUE',   'overdue_7',   '{}',                                          'Action 7 days overdue'),
  ('action',-30, 'INTERNAL_AUDIT.ACTION.ESCALATED', 'overdue_30',  '{department_head,lead_auditor}',              'Action 30 days overdue - escalation 1'),
  ('action',-60, 'INTERNAL_AUDIT.ACTION.ESCALATED', 'overdue_60',  '{department_head,lead_auditor,head_of_audit}','Action 60 days overdue - escalation 2'),
  ('follow_up',  7, 'INTERNAL_AUDIT.FOLLOWUP.SCHEDULED', 'due_soon_7', '{}',              'Follow-up due in 7 days'),
  ('follow_up',  0, 'INTERNAL_AUDIT.FOLLOWUP.SCHEDULED', 'due_today',  '{}',              'Follow-up due today'),
  ('follow_up', -7, 'INTERNAL_AUDIT.FOLLOWUP.SCHEDULED', 'overdue_7',  '{lead_auditor}',  'Follow-up 7 days overdue')
ON CONFLICT (obligation_kind, days_relative_to_due, event_code, occurrence_key) DO NOTHING;