
-- ===== Risk Assessment schema (Epic 1) =====

CREATE TABLE public.bn_risk_assessment (
  assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_reference text NOT NULL UNIQUE,
  person_id bigint,
  person_ssn text,
  primary_signal_id uuid REFERENCES public.bn_risk_signal(signal_id),
  primary_category_code text NOT NULL,
  claim_id uuid,
  award_id uuid,
  payment_id uuid,
  means_assessment_id uuid,
  claim_reference text,
  award_reference text,
  means_assessment_reference text,
  summary text NOT NULL,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by_user_id uuid,
  assigned_owner_user_id uuid,
  assigned_team_code text,
  information_gathering_complete boolean NOT NULL DEFAULT false,
  information_complete_at timestamptz,
  review_entered_at timestamptz,
  correlation_id uuid,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bn_risk_assessment_person_idx ON public.bn_risk_assessment(person_id);
CREATE INDEX bn_risk_assessment_status_idx ON public.bn_risk_assessment(status);

CREATE TABLE public.bn_risk_assessment_signal (
  assessment_signal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES public.bn_risk_signal(signal_id),
  role_code text NOT NULL DEFAULT 'RELATED',
  added_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, signal_id)
);
CREATE INDEX bn_risk_assessment_signal_signal_idx ON public.bn_risk_assessment_signal(signal_id);

CREATE TABLE public.bn_risk_factor_type (
  factor_type_code text PRIMARY KEY,
  label text NOT NULL,
  description text,
  value_kind text NOT NULL DEFAULT 'TEXT',
  value_domain text,
  default_direction_code text NOT NULL DEFAULT 'INCREASES_CONCERN',
  evidence_requirement_code text NOT NULL DEFAULT 'OPTIONAL',
  requires_reason boolean NOT NULL DEFAULT true,
  applicable_category_codes text[] NOT NULL DEFAULT '{}'::text[],
  applicable_source_modules text[] NOT NULL DEFAULT '{}'::text[],
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bn_risk_factor (
  factor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_reference text NOT NULL UNIQUE,
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.bn_risk_signal(signal_id),
  factor_type_code text NOT NULL REFERENCES public.bn_risk_factor_type(factor_type_code),
  category_code text,
  direction_code text NOT NULL,
  provenance_code text NOT NULL,
  provenance_reference text,
  subject_kind text,
  subject_reference text,
  materiality_code text,
  observed_on date,
  value_kind text NOT NULL,
  value_text text,
  value_numeric numeric(18,4),
  value_date date,
  value_boolean boolean,
  value_code text,
  value_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_requirement_code text NOT NULL DEFAULT 'OPTIONAL',
  reason text,
  notes text,
  status text NOT NULL DEFAULT 'ACTIVE',
  supersedes_factor_id uuid REFERENCES public.bn_risk_factor(factor_id),
  superseded_by_factor_id uuid REFERENCES public.bn_risk_factor(factor_id),
  correction_reason text,
  void_reason_code text,
  void_justification text,
  voided_at timestamptz,
  voided_by_user_id uuid,
  factor_version integer NOT NULL DEFAULT 1,
  dedupe_key text,
  correlation_id uuid,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bn_risk_factor_assessment_idx ON public.bn_risk_factor(assessment_id);
CREATE UNIQUE INDEX bn_risk_factor_active_dedupe_idx
  ON public.bn_risk_factor(assessment_id, dedupe_key)
  WHERE status = 'ACTIVE' AND dedupe_key IS NOT NULL;

CREATE TABLE public.bn_risk_evidence_link (
  evidence_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  factor_id uuid REFERENCES public.bn_risk_factor(factor_id),
  signal_id uuid REFERENCES public.bn_risk_signal(signal_id),
  document_id text NOT NULL,
  document_reference text,
  document_title text,
  document_type_code text,
  document_source text,
  received_on date,
  scope_code text NOT NULL DEFAULT 'ASSESSMENT',
  usability_code text NOT NULL DEFAULT 'RECEIVED',
  usability_reason text,
  usability_recorded_at timestamptz,
  usability_recorded_by_user_id uuid,
  status text NOT NULL DEFAULT 'LINKED',
  unlinked_at timestamptz,
  unlink_reason text,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bn_risk_evidence_link_unique_idx
  ON public.bn_risk_evidence_link(assessment_id, document_id, COALESCE(factor_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'LINKED';

CREATE TABLE public.bn_risk_information_request (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_reference text NOT NULL UNIQUE,
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  factor_id uuid REFERENCES public.bn_risk_factor(factor_id),
  signal_id uuid REFERENCES public.bn_risk_signal(signal_id),
  request_type_code text NOT NULL,
  recipient_kind text NOT NULL DEFAULT 'PERSON',
  recipient_person_id bigint,
  recipient_name text,
  recipient_reference text,
  required_information text NOT NULL,
  reason text,
  due_on date,
  is_blocking boolean NOT NULL DEFAULT true,
  channel_code text,
  status text NOT NULL DEFAULT 'REQUESTED',
  communication_request_id uuid,
  communication_status text NOT NULL DEFAULT 'NOT_DISPATCHED',
  communication_detail text,
  response_received_at timestamptz,
  response_summary text,
  response_outcome_code text,
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  closure_reason text,
  correlation_id uuid,
  created_by_user_id uuid,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bn_risk_information_request_assessment_idx
  ON public.bn_risk_information_request(assessment_id);

CREATE TABLE public.bn_risk_assessment_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  event_code text NOT NULL,
  command_name text,
  from_status text,
  to_status text,
  reason_code text,
  justification text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  actor_user_code text,
  actor_source text NOT NULL DEFAULT 'OFFICER',
  correlation_id uuid,
  entity_version bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bn_risk_assessment_event_assessment_idx
  ON public.bn_risk_assessment_event(assessment_id, created_at DESC);

CREATE TABLE public.bn_risk_assessment_note (
  note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id) ON DELETE CASCADE,
  note_kind text NOT NULL DEFAULT 'GENERAL',
  body text NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bn_risk_assessment TO authenticated;
GRANT SELECT ON public.bn_risk_assessment_signal TO authenticated;
GRANT SELECT ON public.bn_risk_factor_type TO authenticated;
GRANT SELECT ON public.bn_risk_factor TO authenticated;
GRANT SELECT ON public.bn_risk_evidence_link TO authenticated;
GRANT SELECT ON public.bn_risk_information_request TO authenticated;
GRANT SELECT ON public.bn_risk_assessment_event TO authenticated;
GRANT ALL ON public.bn_risk_assessment TO service_role;
GRANT ALL ON public.bn_risk_assessment_signal TO service_role;
GRANT ALL ON public.bn_risk_factor_type TO service_role;
GRANT ALL ON public.bn_risk_factor TO service_role;
GRANT ALL ON public.bn_risk_evidence_link TO service_role;
GRANT ALL ON public.bn_risk_information_request TO service_role;
GRANT ALL ON public.bn_risk_assessment_event TO service_role;
GRANT ALL ON public.bn_risk_assessment_note TO service_role;

ALTER TABLE public.bn_risk_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_risk_assessment_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_risk_factor_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_risk_factor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_risk_evidence_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_risk_information_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_risk_assessment_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bn_risk_assessment_note ENABLE ROW LEVEL SECURITY;

CREATE POLICY "risk assessments readable by staff" ON public.bn_risk_assessment
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "risk assessment signals readable by staff" ON public.bn_risk_assessment_signal
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "risk factor types readable by staff" ON public.bn_risk_factor_type
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "risk factors readable by staff" ON public.bn_risk_factor
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "risk evidence links readable by staff" ON public.bn_risk_evidence_link
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "risk information requests readable by staff" ON public.bn_risk_information_request
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "risk assessment history readable by staff" ON public.bn_risk_assessment_event
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER bn_risk_assessment_touch BEFORE UPDATE ON public.bn_risk_assessment
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();
CREATE TRIGGER bn_risk_factor_touch BEFORE UPDATE ON public.bn_risk_factor
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();
CREATE TRIGGER bn_risk_evidence_link_touch BEFORE UPDATE ON public.bn_risk_evidence_link
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();
CREATE TRIGGER bn_risk_information_request_touch BEFORE UPDATE ON public.bn_risk_information_request
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();
