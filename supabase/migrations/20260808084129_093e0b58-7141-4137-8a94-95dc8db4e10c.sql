
UPDATE public.app_modules SET actions_enabled = true WHERE name = 'bn_uprating';

CREATE TABLE IF NOT EXISTS public.bn_uprating_reference_value (
  domain      text NOT NULL,
  code        text NOT NULL,
  label       text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, code)
);
GRANT ALL ON public.bn_uprating_reference_value TO service_role;
REVOKE ALL ON public.bn_uprating_reference_value FROM anon, authenticated;
ALTER TABLE public.bn_uprating_reference_value ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bn_uprating_reference_value(domain, code, label, description, sort_order) VALUES
 ('POLICY_TYPE','PERCENTAGE','Percentage','Uplift expressed as a percentage of the current amount.',10),
 ('POLICY_TYPE','FIXED_AMOUNT','Fixed amount','Uplift expressed as a fixed monetary amount.',20),
 ('POLICY_TYPE','INDEX_FACTOR','Index factor','Uplift derived from a governed index or reference series.',30),
 ('POLICY_TYPE','PERCENTAGE_PLUS_FIXED','Percentage plus fixed','Percentage uplift combined with a fixed amount.',40),
 ('POLICY_TYPE','TIERED','Tiered','Different treatment by ordered amount bands.',50),
 ('POLICY_TYPE','FORMULA_DRIVEN','Formula driven','Uplift resolved by a governed Benefits formula version.',60),
 ('POLICY_TYPE','MANUAL_IMPORT','Manual import','Uplift supplied by a governed external source for later run processing.',70),
 ('ROUNDING_MODE','NONE','No rounding',NULL,10),
 ('ROUNDING_MODE','NEAREST_1','Nearest 1',NULL,20),
 ('ROUNDING_MODE','NEAREST_10','Nearest 10',NULL,30),
 ('ROUNDING_MODE','NEAREST_100','Nearest 100',NULL,40),
 ('ROUNDING_MODE','DOWN','Round down',NULL,50),
 ('ROUNDING_MODE','UP','Round up',NULL,60),
 ('ROUNDING_MODE','HALF_EVEN','Half to even',NULL,70),
 ('APPROVAL_REASON','POLICY_AUTHORITY_CONFIRMED','Policy authority confirmed','The statutory or board authority for the change has been confirmed.',10),
 ('APPROVAL_REASON','CONFIGURATION_REVIEWED','Configuration reviewed','The calculation configuration was independently reviewed.',20),
 ('APPROVAL_REASON','SCOPE_CONFIRMED','Scope confirmed','The applicability and effective period were independently confirmed.',30),
 ('RETURN_REASON','CONFIGURATION_INCORRECT','Configuration incorrect','The calculation configuration needs correction.',10),
 ('RETURN_REASON','SCOPE_INCORRECT','Scope incorrect','The applicability or effective period needs correction.',20),
 ('RETURN_REASON','AUTHORITY_MISSING','Authority missing','The legal or board authority reference is missing or wrong.',30),
 ('RETURN_REASON','FURTHER_INFORMATION_REQUIRED','Further information required','More information is required before a decision.',40),
 ('RETIREMENT_REASON','SUPERSEDED_BY_POLICY_DECISION','Superseded by policy decision',NULL,10),
 ('RETIREMENT_REASON','CREATED_IN_ERROR','Created in error',NULL,20),
 ('RETIREMENT_REASON','NO_LONGER_APPLICABLE','No longer applicable',NULL,30),
 ('AWARD_COMPONENT','BASE','Base award amount',NULL,10),
 ('AWARD_COMPONENT','SUPPLEMENT','Supplement',NULL,20),
 ('AWARD_COMPONENT','MINIMUM_GUARANTEE','Minimum guarantee',NULL,30),
 ('PAYMENT_FREQUENCY','WEEKLY','Weekly',NULL,10),
 ('PAYMENT_FREQUENCY','FORTNIGHTLY','Fortnightly',NULL,20),
 ('PAYMENT_FREQUENCY','MONTHLY','Monthly',NULL,30),
 ('PAYMENT_FREQUENCY','QUARTERLY','Quarterly',NULL,40),
 ('PAYMENT_FREQUENCY','ANNUAL','Annual',NULL,50)
ON CONFLICT (domain, code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bn_uprating_index_series (
  index_series_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_code     text NOT NULL UNIQUE,
  series_name     text NOT NULL,
  description     text,
  country_code    text,
  publisher       text,
  unit            text NOT NULL DEFAULT 'INDEX_POINT',
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bn_uprating_index_series TO service_role;
REVOKE ALL ON public.bn_uprating_index_series FROM anon, authenticated;
ALTER TABLE public.bn_uprating_index_series ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_index_observation (
  observation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  index_series_id uuid NOT NULL REFERENCES public.bn_uprating_index_series(index_series_id) ON DELETE CASCADE,
  reference_period text NOT NULL,
  observed_value  numeric(18,6) NOT NULL,
  published_at    date,
  status          text NOT NULL DEFAULT 'PUBLISHED',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (index_series_id, reference_period)
);
GRANT ALL ON public.bn_uprating_index_observation TO service_role;
REVOKE ALL ON public.bn_uprating_index_observation FROM anon, authenticated;
ALTER TABLE public.bn_uprating_index_observation ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_policy (
  policy_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code     text NOT NULL UNIQUE,
  policy_name     text NOT NULL,
  description     text,
  country_code    text,
  product_id      uuid REFERENCES public.bn_product(id),
  award_component_code text,
  policy_type     text NOT NULL,
  owner_user_id   uuid,
  owner_name      text,
  status          text NOT NULL DEFAULT 'ACTIVE',
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_uprating_policy_type_ck CHECK (policy_type IN
    ('PERCENTAGE','FIXED_AMOUNT','INDEX_FACTOR','PERCENTAGE_PLUS_FIXED','TIERED','FORMULA_DRIVEN','MANUAL_IMPORT')),
  CONSTRAINT bn_uprating_policy_status_ck CHECK (status IN ('ACTIVE','CLOSED'))
);
GRANT ALL ON public.bn_uprating_policy TO service_role;
REVOKE ALL ON public.bn_uprating_policy FROM anon, authenticated;
ALTER TABLE public.bn_uprating_policy ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_policy_version (
  policy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       uuid NOT NULL REFERENCES public.bn_uprating_policy(policy_id) ON DELETE CASCADE,
  version_no      integer NOT NULL,
  version_reference text NOT NULL,
  status          text NOT NULL DEFAULT 'DRAFT',
  effective_from  date,
  effective_to    date,
  policy_type     text NOT NULL,
  rounding_mode   text NOT NULL DEFAULT 'NONE',
  percentage_bp   integer,
  fixed_amount_minor bigint,
  currency_code   text,
  index_series_id uuid REFERENCES public.bn_uprating_index_series(index_series_id),
  index_reference_period text,
  index_base_period text,
  formula_template_id uuid REFERENCES public.bn_formula_template(id),
  formula_version_id  uuid REFERENCES public.bn_formula_version(id),
  manual_source_code text,
  manual_source_description text,
  country_code    text,
  product_id      uuid REFERENCES public.bn_product(id),
  product_version_id uuid REFERENCES public.bn_product_version(id),
  award_type_code text,
  award_component_code text,
  payment_frequency text,
  legal_reference_id uuid REFERENCES public.core_legal_reference(id),
  source_reference text,
  validation_status text NOT NULL DEFAULT 'NOT_VALIDATED',
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  validated_at    timestamptz,
  validated_by    uuid,
  validated_by_name text,
  submitted_by    uuid,
  submitted_by_name text,
  submitted_at    timestamptz,
  approval_decision text,
  approved_by     uuid,
  approved_by_name text,
  approved_at     timestamptz,
  decision_reason_code text,
  decision_justification text,
  activated_by    uuid,
  activated_at    timestamptz,
  superseded_by_version_id uuid REFERENCES public.bn_uprating_policy_version(policy_version_id),
  superseded_at   timestamptz,
  retired_at      timestamptz,
  retirement_reason_code text,
  row_version     integer NOT NULL DEFAULT 1,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version_no),
  CONSTRAINT bn_uprating_pv_status_ck CHECK (status IN
    ('DRAFT','REVIEW','APPROVED','ACTIVE','SUPERSEDED','RETIRED')),
  CONSTRAINT bn_uprating_pv_validation_ck CHECK (validation_status IN
    ('NOT_VALIDATED','VALID','INVALID')),
  CONSTRAINT bn_uprating_pv_type_ck CHECK (policy_type IN
    ('PERCENTAGE','FIXED_AMOUNT','INDEX_FACTOR','PERCENTAGE_PLUS_FIXED','TIERED','FORMULA_DRIVEN','MANUAL_IMPORT')),
  CONSTRAINT bn_uprating_pv_rounding_ck CHECK (rounding_mode IN
    ('NONE','NEAREST_1','NEAREST_10','NEAREST_100','DOWN','UP','HALF_EVEN')),
  CONSTRAINT bn_uprating_pv_decision_ck CHECK (approval_decision IS NULL OR approval_decision IN
    ('APPROVE','RETURN_TO_DRAFT','REJECT'))
);
CREATE INDEX IF NOT EXISTS bn_uprating_pv_policy_idx ON public.bn_uprating_policy_version(policy_id, version_no DESC);
CREATE INDEX IF NOT EXISTS bn_uprating_pv_status_idx ON public.bn_uprating_policy_version(status);
GRANT ALL ON public.bn_uprating_policy_version TO service_role;
REVOKE ALL ON public.bn_uprating_policy_version FROM anon, authenticated;
ALTER TABLE public.bn_uprating_policy_version ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_policy_tier (
  tier_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES public.bn_uprating_policy_version(policy_version_id) ON DELETE CASCADE,
  sequence_no     integer NOT NULL,
  lower_bound_minor bigint NOT NULL,
  upper_bound_minor bigint,
  percentage_bp   integer,
  fixed_amount_minor bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_version_id, sequence_no)
);
GRANT ALL ON public.bn_uprating_policy_tier TO service_role;
REVOKE ALL ON public.bn_uprating_policy_tier FROM anon, authenticated;
ALTER TABLE public.bn_uprating_policy_tier ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_policy_validation (
  validation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES public.bn_uprating_policy_version(policy_version_id) ON DELETE CASCADE,
  attempt_no      integer NOT NULL,
  validation_status text NOT NULL,
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  validated_by    uuid,
  validated_by_name text,
  validated_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id  uuid,
  UNIQUE (policy_version_id, attempt_no)
);
GRANT ALL ON public.bn_uprating_policy_validation TO service_role;
REVOKE ALL ON public.bn_uprating_policy_validation FROM anon, authenticated;
ALTER TABLE public.bn_uprating_policy_validation ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_policy_approval (
  approval_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES public.bn_uprating_policy_version(policy_version_id) ON DELETE CASCADE,
  sequence_no     integer NOT NULL,
  decision        text NOT NULL,
  reason_code     text,
  reason_label    text,
  justification   text NOT NULL,
  decided_by      uuid NOT NULL,
  decided_by_name text,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  submitted_by    uuid,
  submitted_at    timestamptz,
  correlation_id  uuid,
  UNIQUE (policy_version_id, sequence_no),
  CONSTRAINT bn_uprating_approval_decision_ck CHECK (decision IN ('APPROVE','RETURN_TO_DRAFT','REJECT'))
);
GRANT ALL ON public.bn_uprating_policy_approval TO service_role;
REVOKE ALL ON public.bn_uprating_policy_approval FROM anon, authenticated;
ALTER TABLE public.bn_uprating_policy_approval ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_policy_event (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       uuid NOT NULL REFERENCES public.bn_uprating_policy(policy_id) ON DELETE CASCADE,
  policy_version_id uuid REFERENCES public.bn_uprating_policy_version(policy_version_id) ON DELETE CASCADE,
  event_code      text NOT NULL,
  event_label     text NOT NULL,
  detail          text,
  previous_status text,
  new_status      text,
  actor_user_id   uuid,
  actor_name      text,
  correlation_id  uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bn_uprating_event_policy_idx ON public.bn_uprating_policy_event(policy_id, occurred_at DESC);
GRANT ALL ON public.bn_uprating_policy_event TO service_role;
REVOKE ALL ON public.bn_uprating_policy_event FROM anon, authenticated;
ALTER TABLE public.bn_uprating_policy_event ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_command_idempotency (
  idempotency_key uuid PRIMARY KEY,
  command_name    text NOT NULL,
  payload_hash    text NOT NULL DEFAULT '',
  result_json     jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'EXECUTED',
  actor_user_id   uuid,
  correlation_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bn_uprating_command_idempotency TO service_role;
REVOKE ALL ON public.bn_uprating_command_idempotency FROM anon, authenticated;
ALTER TABLE public.bn_uprating_command_idempotency ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bn_uprating_command_audit (
  audit_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_name    text NOT NULL,
  command_class   text NOT NULL DEFAULT 'CANONICAL',
  policy_id       uuid,
  policy_version_id uuid,
  previous_status text,
  new_status      text,
  actor_user_id   uuid,
  actor_name      text,
  reason_code     text,
  justification   text,
  payload         jsonb,
  result_status   text,
  correlation_id  uuid,
  idempotency_key uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bn_uprating_audit_policy_idx ON public.bn_uprating_command_audit(policy_id, occurred_at DESC);
GRANT ALL ON public.bn_uprating_command_audit TO service_role;
REVOKE ALL ON public.bn_uprating_command_audit FROM anon, authenticated;
ALTER TABLE public.bn_uprating_command_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.bn_uprating_check_actor_permission(
  p_actor_user_id uuid, p_action_name text, p_is_mutation boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_module public.app_modules%ROWTYPE;
  v_action_id uuid; v_action_enabled boolean; v_has_grant boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  END IF;
  SELECT * INTO v_module FROM public.app_modules WHERE name = 'bn_uprating';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'MODULE_NOT_REGISTERED'); END IF;
  IF NOT v_module.is_enabled THEN RETURN jsonb_build_object('ok', false, 'code', 'MODULE_DISABLED'); END IF;
  IF NOT COALESCE(v_module.routes_enabled,false) THEN RETURN jsonb_build_object('ok', false, 'code','ROUTES_DISABLED'); END IF;
  IF p_is_mutation AND NOT COALESCE(v_module.actions_enabled,false) THEN
    RETURN jsonb_build_object('ok', false, 'code','ACTIONS_DISABLED');
  END IF;
  SELECT id, is_enabled INTO v_action_id, v_action_enabled
    FROM public.module_actions WHERE module_id = v_module.id AND action_name = p_action_name;
  IF v_action_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code','ACTION_UNREGISTERED'); END IF;
  IF NOT COALESCE(v_action_enabled,false) THEN RETURN jsonb_build_object('ok', false,'code','ACTION_DISABLED'); END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.role_permissions rp
      JOIN public.roles r ON r.id = rp.role_id
      JOIN public.user_roles ur ON ur.role = r.role_name
     WHERE ur.user_id = p_actor_user_id AND rp.action_id = v_action_id
       AND COALESCE(rp.is_granted,true) = true AND COALESCE(r.is_active,true) = true
  ) INTO v_has_grant;
  IF NOT v_has_grant THEN RETURN jsonb_build_object('ok', false,'code','PERMISSION_DENIED'); END IF;
  RETURN jsonb_build_object('ok', true, 'code','PERMITTED','module_id',v_module.id,'action_id',v_action_id);
END; $fn$;

CREATE OR REPLACE FUNCTION public._bn_uprating_require(p_actor uuid, p_action text, p_mutation boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_uprating_check_actor_permission(p_actor, p_action, p_mutation);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'E_%: %', v_perm->>'code', p_action;
  END IF;
END; $fn$;

CREATE OR REPLACE FUNCTION public._bn_uprating_actor_name(p_actor uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')),'')
       FROM public.profiles p WHERE p.id = p_actor), 'System user');
$fn$;

CREATE OR REPLACE FUNCTION public._bn_uprating_event(
  p_policy_id uuid, p_version_id uuid, p_code text, p_label text, p_detail text,
  p_prev text, p_new text, p_actor uuid, p_correlation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  INSERT INTO public.bn_uprating_policy_event(policy_id, policy_version_id, event_code, event_label,
    detail, previous_status, new_status, actor_user_id, actor_name, correlation_id)
  VALUES (p_policy_id, p_version_id, p_code, p_label, p_detail, p_prev, p_new,
          p_actor, public._bn_uprating_actor_name(p_actor), p_correlation);
END; $fn$;

CREATE OR REPLACE FUNCTION public._bn_uprating_ref_label(p_domain text, p_code text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT label FROM public.bn_uprating_reference_value
   WHERE domain = p_domain AND code = p_code AND is_active LIMIT 1;
$fn$;
