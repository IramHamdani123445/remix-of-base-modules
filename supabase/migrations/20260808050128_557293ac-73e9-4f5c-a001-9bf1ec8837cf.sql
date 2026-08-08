
CREATE TABLE public.bn_risk_scoring_rule_set (
  rule_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_code text NOT NULL,
  version_no integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'DRAFT',
  score_scale_min numeric(12,2) NOT NULL DEFAULT 0,
  score_scale_max numeric(12,2) NOT NULL DEFAULT 100,
  score_scale_label text,
  effective_from timestamptz,
  effective_to timestamptz,
  supersedes_rule_set_id uuid REFERENCES public.bn_risk_scoring_rule_set(rule_set_id),
  validated_at timestamptz,
  validated_by_user_id uuid,
  activated_at timestamptz,
  activated_by_user_id uuid,
  retired_at timestamptz,
  retired_by_user_id uuid,
  created_by_user_id uuid,
  correlation_id uuid,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_scoring_rule_set_status_chk
    CHECK (status IN ('DRAFT','VALIDATED','ACTIVE','SUPERSEDED','RETIRED')),
  CONSTRAINT bn_risk_scoring_rule_set_scale_chk CHECK (score_scale_max > score_scale_min),
  CONSTRAINT bn_risk_scoring_rule_set_version_uq UNIQUE (rule_set_code, version_no)
);

CREATE TABLE public.bn_risk_scoring_rule (
  rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id uuid NOT NULL REFERENCES public.bn_risk_scoring_rule_set(rule_set_id) ON DELETE CASCADE,
  rule_code text NOT NULL,
  name text NOT NULL,
  description text,
  factor_type_code text,
  direction_code text,
  operator text NOT NULL,
  comparison_numeric numeric(18,4),
  comparison_code text,
  requires_usable_evidence boolean NOT NULL DEFAULT false,
  contribution numeric(12,2) NOT NULL,
  max_contribution numeric(12,2),
  explanation_template text,
  sort_order integer NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_scoring_rule_code_uq UNIQUE (rule_set_id, rule_code),
  CONSTRAINT bn_risk_scoring_rule_operator_chk CHECK (operator IN (
    'FACTOR_PRESENT','FACTOR_COUNT_AT_LEAST','VALUE_EQUALS_CODE',
    'VALUE_AT_LEAST','VALUE_LESS_THAN','MATERIALITY_AT_LEAST',
    'EVIDENCE_USABLE','EVIDENCE_NOT_USABLE')),
  CONSTRAINT bn_risk_scoring_rule_direction_chk CHECK (
    direction_code IS NULL OR direction_code IN ('INCREASES_CONCERN','REDUCES_CONCERN','NEUTRAL_CONTEXT')),
  CONSTRAINT bn_risk_scoring_rule_cap_chk CHECK (max_contribution IS NULL OR max_contribution >= 0)
);

CREATE TABLE public.bn_risk_scoring_band (
  band_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id uuid NOT NULL REFERENCES public.bn_risk_scoring_rule_set(rule_set_id) ON DELETE CASCADE,
  band_code text NOT NULL,
  label text NOT NULL,
  description text,
  min_score numeric(12,2) NOT NULL,
  max_score numeric(12,2) NOT NULL,
  review_priority text,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_scoring_band_code_uq UNIQUE (rule_set_id, band_code),
  CONSTRAINT bn_risk_scoring_band_range_chk CHECK (max_score >= min_score)
);

CREATE TABLE public.bn_risk_score (
  score_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.bn_risk_assessment(assessment_id),
  assessment_row_version bigint NOT NULL,
  version_no integer NOT NULL DEFAULT 1,
  rule_set_id uuid NOT NULL REFERENCES public.bn_risk_scoring_rule_set(rule_set_id),
  rule_set_code text NOT NULL,
  rule_set_version_no integer NOT NULL,
  rule_set_name text NOT NULL,
  input_fingerprint text NOT NULL,
  score numeric(12,2) NOT NULL,
  score_scale_min numeric(12,2) NOT NULL,
  score_scale_max numeric(12,2) NOT NULL,
  band_code text,
  band_label text,
  contribution_count integer NOT NULL DEFAULT 0,
  matched_rule_count integer NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculated_by_user_id uuid,
  calculated_by_name text,
  supersedes_score_id uuid REFERENCES public.bn_risk_score(score_id),
  status text NOT NULL DEFAULT 'CURRENT',
  recalculation_reason text,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_score_status_chk CHECK (status IN ('CURRENT','SUPERSEDED'))
);
CREATE UNIQUE INDEX bn_risk_score_current_uq
  ON public.bn_risk_score(assessment_id) WHERE status = 'CURRENT';
CREATE INDEX bn_risk_score_assessment_idx ON public.bn_risk_score(assessment_id, version_no DESC);

CREATE TABLE public.bn_risk_score_contribution (
  contribution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id uuid NOT NULL REFERENCES public.bn_risk_score(score_id) ON DELETE CASCADE,
  sequence_no integer NOT NULL,
  rule_id uuid,
  rule_code text NOT NULL,
  rule_name text NOT NULL,
  factor_id uuid,
  factor_reference text,
  factor_type_code text,
  factor_type_label text,
  direction_code text,
  direction_label text,
  operator text,
  evaluated_input text,
  comparison_display text,
  outcome text NOT NULL,
  contribution numeric(12,2) NOT NULL DEFAULT 0,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_risk_score_contribution_outcome_chk
    CHECK (outcome IN ('MATCHED','NOT_MATCHED','SKIPPED','CAPPED')),
  CONSTRAINT bn_risk_score_contribution_seq_uq UNIQUE (score_id, sequence_no)
);

CREATE TABLE public.bn_risk_scoring_rule_set_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id uuid NOT NULL REFERENCES public.bn_risk_scoring_rule_set(rule_set_id) ON DELETE CASCADE,
  event_code text NOT NULL,
  command_name text,
  from_status text,
  to_status text,
  reason_code text,
  justification text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  actor_user_code text,
  correlation_id uuid,
  entity_version bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bn_risk_assessment
  ADD COLUMN IF NOT EXISTS scoring_review_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS scoring_review_completed_by_user_id uuid;

CREATE TRIGGER bn_risk_scoring_rule_set_touch
  BEFORE UPDATE ON public.bn_risk_scoring_rule_set
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();
CREATE TRIGGER bn_risk_scoring_rule_touch
  BEFORE UPDATE ON public.bn_risk_scoring_rule
  FOR EACH ROW EXECUTE FUNCTION public.bn_risk_touch_updated_at();

INSERT INTO public.bn_risk_reference_value(domain, code, label, description, nature, sort_order, is_active)
VALUES
  ('SCORING_CONFIG_STATUS','DRAFT','Draft','Being prepared; cannot be used for scoring.','OPEN',10,true),
  ('SCORING_CONFIG_STATUS','VALIDATED','Validated','Passed validation; awaiting activation.','OPEN',20,true),
  ('SCORING_CONFIG_STATUS','ACTIVE','Active','In force for authoritative scoring.','ACTIVE',30,true),
  ('SCORING_CONFIG_STATUS','SUPERSEDED','Superseded','Replaced by a later version.','CLOSED',40,true),
  ('SCORING_CONFIG_STATUS','RETIRED','Retired','Withdrawn from use.','CLOSED',50,true),
  ('SCORING_OPERATOR','FACTOR_PRESENT','Factor is present',NULL,NULL,10,true),
  ('SCORING_OPERATOR','FACTOR_COUNT_AT_LEAST','Number of matching factors is at least',NULL,NULL,20,true),
  ('SCORING_OPERATOR','VALUE_EQUALS_CODE','Recorded value equals',NULL,NULL,30,true),
  ('SCORING_OPERATOR','VALUE_AT_LEAST','Recorded amount is at least',NULL,NULL,40,true),
  ('SCORING_OPERATOR','VALUE_LESS_THAN','Recorded amount is less than',NULL,NULL,50,true),
  ('SCORING_OPERATOR','MATERIALITY_AT_LEAST','Materiality is at least',NULL,NULL,60,true),
  ('SCORING_OPERATOR','EVIDENCE_USABLE','Factor has usable supporting evidence',NULL,NULL,70,true),
  ('SCORING_OPERATOR','EVIDENCE_NOT_USABLE','Factor has no usable supporting evidence',NULL,NULL,80,true),
  ('SCORE_OUTCOME','MATCHED','Contributed to the score',NULL,NULL,10,true),
  ('SCORE_OUTCOME','NOT_MATCHED','Evaluated but did not contribute',NULL,NULL,20,true),
  ('SCORE_OUTCOME','SKIPPED','Not applicable to this assessment',NULL,NULL,30,true),
  ('SCORE_OUTCOME','CAPPED','Contribution limited by the configured cap',NULL,NULL,40,true),
  ('SCORE_STATUS','CURRENT','Current score',NULL,NULL,10,true),
  ('SCORE_STATUS','SUPERSEDED','Superseded score',NULL,NULL,20,true)
ON CONFLICT DO NOTHING;
