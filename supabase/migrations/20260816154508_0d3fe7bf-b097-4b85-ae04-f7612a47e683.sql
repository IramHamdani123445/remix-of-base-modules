-- ── Communication Action model (additive, backward compatible) ────────────

CREATE TABLE public.omni_comms_communication_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  event_definition_id uuid NOT NULL REFERENCES public.omni_comms_event_definition(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  recipient_role text,
  obligation text NOT NULL DEFAULT 'required',
  satisfaction_rule text NOT NULL DEFAULT 'one_of',
  legal_basis text,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_communication_action_obligation_chk
    CHECK (obligation IN ('required','optional')),
  CONSTRAINT omni_comms_communication_action_rule_chk
    CHECK (satisfaction_rule IN ('one_of','all_of')),
  CONSTRAINT omni_comms_communication_action_status_chk
    CHECK (status IN ('draft','active','retired')),
  CONSTRAINT omni_comms_communication_action_code_chk
    CHECK (code ~ '^[A-Z][A-Z0-9_]{2,79}$')
);

CREATE UNIQUE INDEX omni_comms_communication_action_scope_uq
  ON public.omni_comms_communication_action
  (organization_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
   event_definition_id, code, coalesce(recipient_role, '*'));

CREATE INDEX omni_comms_communication_action_event_idx
  ON public.omni_comms_communication_action (event_definition_id, status);

CREATE TABLE public.omni_comms_action_channel_option (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.omni_comms_communication_action(id) ON DELETE CASCADE,
  channel text NOT NULL,
  rank integer NOT NULL DEFAULT 100,
  template_family_id uuid REFERENCES public.omni_comms_template_family(id) ON DELETE SET NULL,
  is_fallback boolean NOT NULL DEFAULT false,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_action_channel_option_channel_chk
    CHECK (channel IN ('email','sms','whatsapp','push','in_app','print','webhook','voice')),
  CONSTRAINT omni_comms_action_channel_option_status_chk
    CHECK (status IN ('active','retired')),
  CONSTRAINT omni_comms_action_channel_option_unique UNIQUE (action_id, channel)
);

CREATE INDEX omni_comms_action_channel_option_action_idx
  ON public.omni_comms_action_channel_option (action_id, rank);

CREATE TABLE public.omni_comms_delivery_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  action_id uuid REFERENCES public.omni_comms_communication_action(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'digital_first',
  print_when jsonb NOT NULL DEFAULT jsonb_build_object(
    'legally_required', true,
    'recipient_requested', true,
    'digital_unavailable', true,
    'policy_exception', false),
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_delivery_policy_mode_chk
    CHECK (mode IN ('digital_first','paper_first','both')),
  CONSTRAINT omni_comms_delivery_policy_status_chk
    CHECK (status IN ('draft','active','retired'))
);

CREATE UNIQUE INDEX omni_comms_delivery_policy_version_uq
  ON public.omni_comms_delivery_policy
  (organization_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(action_id, '00000000-0000-0000-0000-000000000000'::uuid), version_number);

CREATE INDEX omni_comms_delivery_policy_active_idx
  ON public.omni_comms_delivery_policy (organization_id, status, effective_from DESC);

CREATE TABLE public.omni_comms_recipient_channel_preference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  recipient_role text,
  recipient_reference text NOT NULL,
  channel text NOT NULL,
  preference text NOT NULL,
  source text NOT NULL DEFAULT 'operator',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_recipient_channel_preference_channel_chk
    CHECK (channel IN ('email','sms','whatsapp','push','in_app','print','webhook','voice')),
  CONSTRAINT omni_comms_recipient_channel_preference_pref_chk
    CHECK (preference IN ('preferred','opt_out','paper_required')),
  CONSTRAINT omni_comms_recipient_channel_preference_source_chk
    CHECK (source IN ('operator','recipient','statutory','import'))
);

CREATE UNIQUE INDEX omni_comms_recipient_channel_preference_uq
  ON public.omni_comms_recipient_channel_preference
  (organization_id, recipient_reference, channel, coalesce(recipient_role, '*'));

-- ── Backward-compatible pointers on existing tables ───────────────────────

ALTER TABLE public.omni_comms_event_route
  ADD COLUMN IF NOT EXISTS action_id uuid
    REFERENCES public.omni_comms_communication_action(id) ON DELETE SET NULL;

ALTER TABLE public.omni_comms_message
  ADD COLUMN IF NOT EXISTS action_id uuid
    REFERENCES public.omni_comms_communication_action(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_policy_id uuid
    REFERENCES public.omni_comms_delivery_policy(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_reason jsonb;

ALTER TABLE public.omni_comms_template_family
  ADD COLUMN IF NOT EXISTS produces_official_document boolean NOT NULL DEFAULT false;

-- ── Grants (governed access only; no direct policies, RLS locked) ─────────

GRANT SELECT ON public.omni_comms_communication_action TO authenticated;
GRANT SELECT ON public.omni_comms_action_channel_option TO authenticated;
GRANT SELECT ON public.omni_comms_delivery_policy TO authenticated;
GRANT SELECT ON public.omni_comms_recipient_channel_preference TO authenticated;
GRANT ALL ON public.omni_comms_communication_action TO service_role;
GRANT ALL ON public.omni_comms_action_channel_option TO service_role;
GRANT ALL ON public.omni_comms_delivery_policy TO service_role;
GRANT ALL ON public.omni_comms_recipient_channel_preference TO service_role;

ALTER TABLE public.omni_comms_communication_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_action_channel_option ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_delivery_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_recipient_channel_preference ENABLE ROW LEVEL SECURITY;
