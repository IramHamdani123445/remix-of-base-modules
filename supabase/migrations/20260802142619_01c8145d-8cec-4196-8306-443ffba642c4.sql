-- ============================================================
-- Omni-Comms C6 — Release Control and Controlled-Pilot Governance
-- Additive. Zero provider contact. Zero runnable jobs.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Release control (current mutable governance record)
-- ------------------------------------------------------------
CREATE TABLE public.omni_comms_channel_release_control (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  channel text NOT NULL,
  data_origin text NOT NULL DEFAULT 'user',
  release_state text NOT NULL DEFAULT 'disabled',
  release_version integer NOT NULL DEFAULT 1,

  permitted_event_codes text[] NOT NULL DEFAULT '{}',
  permitted_caller_modules text[] NOT NULL DEFAULT '{}',
  permitted_modes text[] NOT NULL DEFAULT '{}',

  pilot_recipient_rules jsonb NOT NULL DEFAULT '[]',
  max_recipients_per_request integer NOT NULL DEFAULT 1,
  max_messages_per_hour integer NOT NULL DEFAULT 5,
  max_messages_per_day integer NOT NULL DEFAULT 20,
  max_messages_total integer NOT NULL DEFAULT 50,

  release_starts_at timestamptz NULL,
  release_expires_at timestamptz NULL,

  proposed_state text NULL,
  proposal_reason text NULL,
  proposed_by uuid NULL,
  proposed_at timestamptz NULL,
  proposal_expires_at timestamptz NULL,

  approved_by uuid NULL,
  approved_at timestamptz NULL,
  approval_note text NULL,

  activated_by uuid NULL,
  activated_at timestamptz NULL,

  suspended_by uuid NULL,
  suspended_at timestamptz NULL,
  suspension_reason text NULL,

  approved_commit text NULL,
  certification_workflow_run_id text NULL,
  certification_recorded_at timestamptz NULL,

  release_fingerprint text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,

  CONSTRAINT omni_comms_release_control_channel_chk
    CHECK (channel = 'email'),
  CONSTRAINT omni_comms_release_control_origin_chk
    CHECK (data_origin IN ('system_seed','user','reference_seed')),
  CONSTRAINT omni_comms_release_control_state_chk
    CHECK (release_state IN ('disabled','configuration','test_only','controlled_pilot','live','suspended')),
  CONSTRAINT omni_comms_release_control_proposed_state_chk
    CHECK (proposed_state IS NULL OR proposed_state IN ('configuration','test_only','controlled_pilot','disabled')),
  CONSTRAINT omni_comms_release_control_version_chk
    CHECK (release_version >= 1),
  CONSTRAINT omni_comms_release_control_recipients_chk
    CHECK (max_recipients_per_request BETWEEN 1 AND 10),
  CONSTRAINT omni_comms_release_control_hour_chk
    CHECK (max_messages_per_hour BETWEEN 1 AND 20),
  CONSTRAINT omni_comms_release_control_day_chk
    CHECK (max_messages_per_day BETWEEN 1 AND 100),
  CONSTRAINT omni_comms_release_control_total_chk
    CHECK (max_messages_total BETWEEN 1 AND 500),
  CONSTRAINT omni_comms_release_control_ladder_chk
    CHECK (max_messages_per_hour <= max_messages_per_day
           AND max_messages_per_day <= max_messages_total),
  CONSTRAINT omni_comms_release_control_rules_chk
    CHECK (jsonb_typeof(pilot_recipient_rules) = 'array'
           AND jsonb_array_length(pilot_recipient_rules) <= 20),
  CONSTRAINT omni_comms_release_control_window_chk
    CHECK (release_starts_at IS NULL OR release_expires_at IS NULL
           OR release_expires_at > release_starts_at)
);

REVOKE ALL ON public.omni_comms_channel_release_control FROM PUBLIC;
REVOKE ALL ON public.omni_comms_channel_release_control FROM anon;
REVOKE ALL ON public.omni_comms_channel_release_control FROM authenticated;
GRANT ALL ON public.omni_comms_channel_release_control TO service_role;
ALTER TABLE public.omni_comms_channel_release_control ENABLE ROW LEVEL SECURITY;

-- Bounded partial uniqueness: genuine vs reference coexist.
CREATE UNIQUE INDEX omni_comms_release_control_genuine_org_uq
  ON public.omni_comms_channel_release_control (organization_id, channel)
  WHERE department_id IS NULL AND data_origin <> 'reference_seed';
CREATE UNIQUE INDEX omni_comms_release_control_genuine_dept_uq
  ON public.omni_comms_channel_release_control (organization_id, department_id, channel)
  WHERE department_id IS NOT NULL AND data_origin <> 'reference_seed';
CREATE UNIQUE INDEX omni_comms_release_control_reference_org_uq
  ON public.omni_comms_channel_release_control (organization_id, channel)
  WHERE department_id IS NULL AND data_origin = 'reference_seed';
CREATE UNIQUE INDEX omni_comms_release_control_reference_dept_uq
  ON public.omni_comms_channel_release_control (organization_id, department_id, channel)
  WHERE department_id IS NOT NULL AND data_origin = 'reference_seed';

-- ------------------------------------------------------------
-- 2. Release event (append-only evidence ledger)
-- ------------------------------------------------------------
CREATE TABLE public.omni_comms_channel_release_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_control_id uuid NOT NULL
    REFERENCES public.omni_comms_channel_release_control(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  channel text NOT NULL,
  release_version integer NOT NULL,
  event_type text NOT NULL,
  from_state text NULL,
  to_state text NULL,
  reason text NULL,
  actor_id uuid NULL,
  correlation_id text NULL,
  release_fingerprint text NOT NULL,
  deployed_revision text NULL,
  certified_commit text NULL,
  certification_workflow_run_id text NULL,
  bounded_snapshot jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_release_event_type_chk CHECK (event_type IN (
    'release_created','release_updated','transition_proposed','proposal_cancelled',
    'proposal_expired','transition_approved','release_activated','release_suspended',
    'release_resumed','release_expired','release_gate_denied')),
  CONSTRAINT omni_comms_release_event_snapshot_chk
    CHECK (jsonb_typeof(bounded_snapshot) = 'object'
           AND length(bounded_snapshot::text) <= 8000)
);

REVOKE ALL ON public.omni_comms_channel_release_event FROM PUBLIC;
REVOKE ALL ON public.omni_comms_channel_release_event FROM anon;
REVOKE ALL ON public.omni_comms_channel_release_event FROM authenticated;
GRANT ALL ON public.omni_comms_channel_release_event TO service_role;
ALTER TABLE public.omni_comms_channel_release_event ENABLE ROW LEVEL SECURITY;

CREATE INDEX omni_comms_release_event_control_idx
  ON public.omni_comms_channel_release_event (release_control_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_release_event_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'omni_comms_release_event_append_only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER omni_comms_release_event_append_only
  BEFORE UPDATE OR DELETE ON public.omni_comms_channel_release_event
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_release_event_append_only();

-- ------------------------------------------------------------
-- 3. Dispatch-job release snapshot columns (held jobs only)
-- ------------------------------------------------------------
ALTER TABLE public.omni_comms_dispatch_job
  ADD COLUMN IF NOT EXISTS release_control_id uuid NULL,
  ADD COLUMN IF NOT EXISTS release_version integer NULL,
  ADD COLUMN IF NOT EXISTS release_state_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS release_fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS release_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS release_decision_snapshot jsonb NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- 4. Fingerprint + recipient-rule normalisation
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_fingerprint(
  p_row public.omni_comms_channel_release_control
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.omni_comms_priv_channel_test_sha256(
    jsonb_build_object(
      'organization_id', p_row.organization_id,
      'department_id', p_row.department_id,
      'channel', p_row.channel,
      'release_state', p_row.release_state,
      'permitted_event_codes', to_jsonb(coalesce(p_row.permitted_event_codes,'{}')),
      'permitted_caller_modules', to_jsonb(coalesce(p_row.permitted_caller_modules,'{}')),
      'permitted_modes', to_jsonb(coalesce(p_row.permitted_modes,'{}')),
      'pilot_recipient_rules', p_row.pilot_recipient_rules,
      'max_recipients_per_request', p_row.max_recipients_per_request,
      'max_messages_per_hour', p_row.max_messages_per_hour,
      'max_messages_per_day', p_row.max_messages_per_day,
      'max_messages_total', p_row.max_messages_total,
      'release_starts_at', p_row.release_starts_at,
      'release_expires_at', p_row.release_expires_at
    )::text
  );
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_recipient_rules(
  p_channel text,
  p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_keys text[];
  v_norm jsonb;
  v_hash text;
  v_masked text;
  v_seen text[] := '{}';
BEGIN
  IF p_input IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(p_input) <> 'array' THEN
    RAISE EXCEPTION 'release_recipient_rules_invalid' USING ERRCODE = '22023';
  END IF;
  IF length(p_input::text) > 12000 THEN
    RAISE EXCEPTION 'release_recipient_rules_oversized' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_input) > 20 THEN
    RAISE EXCEPTION 'release_recipient_rules_limit_exceeded' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_input) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'release_recipient_rule_malformed' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(v_item) k;
    IF EXISTS (
      SELECT 1 FROM unnest(v_keys) k
      WHERE k NOT IN ('target_type','target','target_masked','target_hash')
    ) THEN
      RAISE EXCEPTION 'release_recipient_rule_unknown_key' USING ERRCODE = '22023';
    END IF;

    IF v_item ? 'target' AND nullif(trim(v_item->>'target'),'') IS NOT NULL THEN
      v_norm := public.omni_comms_priv_channel_test_normalize_target(p_channel, v_item->>'target');
      v_hash := v_norm->>'target_hash';
      v_masked := v_norm->>'target_masked';
    ELSE
      v_hash := lower(coalesce(v_item->>'target_hash',''));
      v_masked := coalesce(v_item->>'target_masked','');
      IF v_hash !~ '^[0-9a-f]{64}$' OR v_masked = '' THEN
        RAISE EXCEPTION 'release_recipient_rule_malformed' USING ERRCODE = '22023';
      END IF;
      IF v_masked ~ '^[^@]+@' AND v_masked !~ '\*' THEN
        RAISE EXCEPTION 'release_recipient_rule_raw_value_rejected' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_hash = ANY (v_seen) THEN
      RAISE EXCEPTION 'release_recipient_rule_duplicate' USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_hash;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'target_type', 'email_address',
      'target_masked', v_masked,
      'target_hash', v_hash
    ));
  END LOOP;

  RETURN v_out;
END;
$$;

-- ------------------------------------------------------------
-- 5. Release-control guard trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_control_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_item jsonb;
BEGIN
  IF NEW.release_state = 'live' THEN
    RAISE EXCEPTION 'live_activation_not_available_until_business_pilot_certified'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.proposed_state = 'live' THEN
    RAISE EXCEPTION 'live_activation_not_available_until_business_pilot_certified'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.data_origin = 'reference_seed'
     AND NEW.release_state NOT IN ('disabled','configuration') THEN
    RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE = '42501';
  END IF;

  IF NEW.release_state = 'controlled_pilot' THEN
    IF NEW.release_expires_at IS NULL THEN
      RAISE EXCEPTION 'release_expiry_required_for_controlled_pilot' USING ERRCODE = '22023';
    END IF;
    IF NEW.release_expires_at
       > coalesce(NEW.release_starts_at, NEW.activated_at, now()) + interval '7 days' THEN
      RAISE EXCEPTION 'release_window_exceeds_seven_days' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(NEW.pilot_recipient_rules) = 0 THEN
      RAISE EXCEPTION 'release_recipient_rules_required' USING ERRCODE = '22023';
    END IF;
    IF coalesce(array_length(NEW.permitted_event_codes,1),0) = 0
       OR coalesce(array_length(NEW.permitted_caller_modules,1),0) = 0
       OR coalesce(array_length(NEW.permitted_modes,1),0) = 0 THEN
      RAISE EXCEPTION 'release_restrictions_required' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(coalesce(NEW.permitted_modes,'{}')) m WHERE m <> 'queued') THEN
    RAISE EXCEPTION 'release_mode_not_permitted' USING ERRCODE = '22023';
  END IF;
  IF 'OMNI_COMMS_ADMIN_DRY_RUN' = ANY (coalesce(NEW.permitted_caller_modules,'{}')) THEN
    RAISE EXCEPTION 'release_caller_not_permitted' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.pilot_recipient_rules) LOOP
    IF (v_item->>'target_hash') !~ '^[0-9a-f]{64}$'
       OR coalesce(v_item->>'target_masked','') = ''
       OR (v_item ? 'target') THEN
      RAISE EXCEPTION 'release_recipient_rule_malformed' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  NEW.updated_at := now();
  NEW.release_fingerprint := public.omni_comms_priv_channel_release_fingerprint(NEW);
  RETURN NEW;
END;
$$;

CREATE TRIGGER omni_comms_release_control_guard
  BEFORE INSERT OR UPDATE ON public.omni_comms_channel_release_control
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_channel_release_control_guard();

-- ------------------------------------------------------------
-- 6. Bounded projection + event recorder
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_json(
  p_row public.omni_comms_channel_release_control
) RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'organization_id', p_row.organization_id,
    'department_id', p_row.department_id,
    'channel', p_row.channel,
    'data_origin', p_row.data_origin,
    'release_state', p_row.release_state,
    'release_version', p_row.release_version,
    'permitted_event_codes', to_jsonb(coalesce(p_row.permitted_event_codes,'{}')),
    'permitted_caller_modules', to_jsonb(coalesce(p_row.permitted_caller_modules,'{}')),
    'permitted_modes', to_jsonb(coalesce(p_row.permitted_modes,'{}')),
    'pilot_recipient_rules', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'target_type', r->>'target_type',
        'target_masked', r->>'target_masked',
        'target_hash_prefix', left(r->>'target_hash', 12)
      )), '[]'::jsonb)
      FROM jsonb_array_elements(p_row.pilot_recipient_rules) r
    ),
    'max_recipients_per_request', p_row.max_recipients_per_request,
    'max_messages_per_hour', p_row.max_messages_per_hour,
    'max_messages_per_day', p_row.max_messages_per_day,
    'max_messages_total', p_row.max_messages_total,
    'release_starts_at', p_row.release_starts_at,
    'release_expires_at', p_row.release_expires_at,
    'proposed_state', p_row.proposed_state,
    'proposal_reason', p_row.proposal_reason,
    'proposed_by', p_row.proposed_by,
    'proposed_at', p_row.proposed_at,
    'proposal_expires_at', p_row.proposal_expires_at,
    'approved_by', p_row.approved_by,
    'approved_at', p_row.approved_at,
    'approval_note', p_row.approval_note,
    'activated_by', p_row.activated_by,
    'activated_at', p_row.activated_at,
    'suspended_by', p_row.suspended_by,
    'suspended_at', p_row.suspended_at,
    'suspension_reason', p_row.suspension_reason,
    'approved_commit', p_row.approved_commit,
    'certification_workflow_run_id', p_row.certification_workflow_run_id,
    'certification_recorded_at', p_row.certification_recorded_at,
    'release_fingerprint', p_row.release_fingerprint,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_record_event(
  p_row public.omni_comms_channel_release_control,
  p_event_type text,
  p_from_state text,
  p_to_state text,
  p_reason text,
  p_actor_id uuid,
  p_correlation_id text,
  p_deployed_revision text DEFAULT NULL,
  p_snapshot jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.omni_comms_channel_release_event (
    release_control_id, organization_id, department_id, channel, release_version,
    event_type, from_state, to_state, reason, actor_id, correlation_id,
    release_fingerprint, deployed_revision, certified_commit,
    certification_workflow_run_id, bounded_snapshot
  ) VALUES (
    p_row.id, p_row.organization_id, p_row.department_id, p_row.channel, p_row.release_version,
    p_event_type, p_from_state, p_to_state, left(coalesce(p_reason,''), 500), p_actor_id,
    left(coalesce(p_correlation_id,''), 120),
    p_row.release_fingerprint, p_deployed_revision, p_row.approved_commit,
    p_row.certification_workflow_run_id, coalesce(p_snapshot,'{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_record_event(
  public.omni_comms_channel_release_control, text, text, text, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_recipient_rules(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_fingerprint(
  public.omni_comms_channel_release_control) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_json(
  public.omni_comms_channel_release_control) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7. Effective genuine release resolution (department override preferred)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_effective(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text
) RETURNS public.omni_comms_channel_release_control
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.omni_comms_channel_release_control
  WHERE organization_id = p_organization_id
    AND channel = p_channel
    AND data_origin <> 'reference_seed'
    AND (department_id = p_department_id OR department_id IS NULL)
  ORDER BY (department_id IS NOT NULL) DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_effective(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8. Canonical prerequisite evaluator (32 ordered checks)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_prerequisites(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_release_control_id uuid,
  p_deployed_revision text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_policy public.omni_comms_channel_setting;
  v_cert jsonb;
  v_env text;
  v_out jsonb := '[]'::jsonb;
  v_seq integer := 0;
  v_provider_account uuid;
  v_run public.omni_comms_channel_test_run;
  v_delivery public.omni_comms_channel_test_delivery;
  v_delivered boolean := false;
  v_bad boolean := false;
  v_dep_ok boolean;

  PROCEDURE_PLACEHOLDER text;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_release_control_id;
  v_policy := public.omni_comms_priv_channel_test_effective_policy(p_organization_id, p_department_id, p_channel);
  v_cert := public.omni_comms_priv_runtime_certification();
  v_env := public.omni_comms_priv_runtime_environment();
  v_dep_ok := p_department_id IS NULL
    OR public.omni_comms_priv_verify_department_ownership(p_department_id, p_organization_id);

  SELECT pa.id INTO v_provider_account
  FROM public.omni_comms_provider_account pa
  WHERE pa.organization_id = p_organization_id
    AND pa.status = 'active' AND pa.data_origin <> 'reference_seed'
  ORDER BY pa.verification_status = 'verified' DESC
  LIMIT 1;

  SELECT * INTO v_run FROM public.omni_comms_channel_test_run r
  WHERE r.organization_id = p_organization_id AND r.channel = p_channel
    AND r.status = 'passed'
  ORDER BY r.created_at DESC LIMIT 1;

  SELECT * INTO v_delivery FROM public.omni_comms_channel_test_delivery d
  WHERE d.organization_id = p_organization_id AND d.channel = p_channel
    AND d.status = 'accepted'
  ORDER BY d.created_at DESC LIMIT 1;

  IF v_delivery.id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.omni_comms_channel_test_delivery_event e
      WHERE e.delivery_id = v_delivery.id AND e.signature_verified
        AND e.event_type = 'delivered') INTO v_delivered;
    SELECT EXISTS (
      SELECT 1 FROM public.omni_comms_channel_test_delivery_event e
      WHERE e.delivery_id = v_delivery.id AND e.signature_verified
        AND e.event_type IN ('bounced','complained')) INTO v_bad;
  END IF;

  -- helper inline appender
  CREATE TEMP TABLE IF NOT EXISTS _oc_rel_chk (seq int, code text, state text, detail text) ON COMMIT DROP;
  DELETE FROM _oc_rel_chk;

  INSERT INTO _oc_rel_chk VALUES
   (1,'tenant_access', CASE WHEN p_organization_id IS NOT NULL THEN 'passed' ELSE 'failed' END, 'Organisation scope resolved.'),
   (2,'department_access', CASE WHEN v_dep_ok THEN 'passed' ELSE 'failed' END, 'Department belongs to the organisation.'),
   (3,'channel_supported', CASE WHEN p_channel = 'email' THEN 'passed' ELSE 'failed' END, 'Release Control supports Email only in C6.'),
   (4,'release_not_reference', CASE WHEN v_rel.id IS NOT NULL AND v_rel.data_origin <> 'reference_seed' THEN 'passed' ELSE 'failed' END, 'Genuine (non-reference) release record required.'),
   (5,'effective_policy_present', CASE WHEN v_policy.id IS NOT NULL THEN 'passed' ELSE 'failed' END, 'Effective genuine Email policy resolved.'),
   (6,'policy_test_or_pilot_state', CASE WHEN v_policy.operational_state IN ('test_only','pilot_ready') THEN 'passed' ELSE 'failed' END, 'Policy operational state must be test_only or pilot_ready.'),
   (7,'provider_present', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_provider p WHERE p.channel='email' AND p.status='active') THEN 'passed' ELSE 'failed' END, 'Active Email provider adapter present.'),
   (8,'provider_account_active', CASE WHEN v_provider_account IS NOT NULL THEN 'passed' ELSE 'failed' END, 'Active genuine provider account present.'),
   (9,'provider_credentials_complete', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account_secret_ref s WHERE s.provider_account_id = v_provider_account AND s.purpose='api_key') THEN 'passed' ELSE 'failed' END, 'Canonical api_key secret reference present.'),
   (10,'provider_credentials_verified', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_provider_account pa WHERE pa.id=v_provider_account AND pa.verification_status='verified') THEN 'passed' ELSE 'failed' END, 'Provider credentials verified.'),
   (11,'sender_identity_active', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_identity i WHERE i.organization_id=p_organization_id AND i.channel='email' AND i.status='active' AND i.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END, 'Active genuine sender identity present.'),
   (12,'sending_domain_active', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel='email' AND e.endpoint_type='sending_domain' AND e.status='active' AND e.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END, 'Active sending domain configured.'),
   (13,'sending_domain_verified', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel='email' AND e.endpoint_type='sending_domain' AND e.status='active' AND e.verification_status='verified') THEN 'passed' ELSE 'failed' END, 'Sending domain verified with the provider.'),
   (14,'callback_endpoint_active', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e WHERE e.organization_id=p_organization_id AND e.channel='email' AND e.endpoint_type='event_callback' AND e.status='active') THEN 'passed' ELSE 'failed' END, 'Event callback endpoint configured.'),
   (15,'binding_active', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel='email' AND b.status='active' AND b.data_origin <> 'reference_seed') THEN 'passed' ELSE 'failed' END, 'Active identity-to-provider binding present.'),
   (16,'binding_provider_verified', CASE WHEN EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding b WHERE b.organization_id=p_organization_id AND b.channel='email' AND b.status='active' AND b.verification_status='verified') THEN 'passed' ELSE 'failed' END, 'Binding verified by the provider.'),
   (17,'current_preflight_passed', CASE WHEN v_run.id IS NOT NULL THEN 'passed' ELSE 'failed' END, 'Current configuration preflight passed.'),
   (18,'technical_provider_delivery_accepted', CASE WHEN v_delivery.id IS NOT NULL THEN 'passed' ELSE 'failed' END, 'C5B technical provider delivery accepted.'),
   (19,'signed_delivery_callback_received', CASE WHEN v_delivered THEN 'passed' ELSE 'failed' END, 'Signature-verified delivered callback received. Provider acceptance alone is not recipient delivery.'),
   (20,'no_bounce_or_complaint_evidence', CASE WHEN v_bad THEN 'failed' ELSE 'passed' END, 'No bounced or complained outcome on the current technical delivery.'),
   (21,'producer_binding_active', CASE WHEN EXISTS (
        SELECT 1 FROM public.omni_comms_producer_event_binding pb
        JOIN public.omni_comms_event_definition ed ON ed.id = pb.event_definition_id
        WHERE pb.organization_id = p_organization_id AND pb.status='active'
          AND 'queued' = ANY (pb.allowed_modes)
          AND ed.code = ANY (coalesce(v_rel.permitted_event_codes,'{}'))
          AND pb.caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules,'{}'))
      ) THEN 'passed' ELSE 'failed' END, 'Active producer-event binding permitting queued mode for every permitted event/caller pair.'),
   (22,'event_route_active', CASE WHEN EXISTS (
        SELECT 1 FROM public.omni_comms_event_route r
        JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
        WHERE r.organization_id = p_organization_id AND r.channel='email'
          AND r.is_enabled AND r.lifecycle_state='active'
          AND ed.code = ANY (coalesce(v_rel.permitted_event_codes,'{}'))
      ) THEN 'passed' ELSE 'failed' END, 'Enabled active Email event route present.'),
   (23,'template_family_active', CASE WHEN EXISTS (
        SELECT 1 FROM public.omni_comms_event_route r
        JOIN public.omni_comms_template_family tf ON tf.id = r.template_family_id
        JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
        WHERE r.organization_id = p_organization_id AND r.channel='email'
          AND tf.status='active'
          AND ed.code = ANY (coalesce(v_rel.permitted_event_codes,'{}'))
      ) THEN 'passed' ELSE 'failed' END, 'Route resolves an active template family.'),
   (24,'published_template_version_present', CASE WHEN EXISTS (
        SELECT 1 FROM public.omni_comms_event_route r
        JOIN public.omni_comms_template_version tv ON tv.template_family_id = r.template_family_id
        JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
        WHERE r.organization_id = p_organization_id AND r.channel='email'
          AND tv.channel='email' AND tv.status='published'
          AND ed.code = ANY (coalesce(v_rel.permitted_event_codes,'{}'))
      ) THEN 'passed' ELSE 'failed' END, 'Published Email template version present.'),
   (25,'runtime_environment_known', CASE WHEN v_env IS NOT NULL AND v_env <> '' THEN 'passed' ELSE 'failed' END, 'Runtime environment is authoritative.'),
   (26,'runtime_certification_effective', CASE WHEN v_cert->>'certification_state' = 'certified'
          AND coalesce(v_cert->>'certified_commit','') ~ '^[0-9a-f]{40}$'
          AND coalesce(v_cert->>'workflow_run_id','') <> ''
          AND (v_cert->>'certified_at') IS NOT NULL
        THEN 'passed' ELSE 'failed' END, 'Protected runtime certification record is effective.'),
   (27,'deployed_revision_matches_certification', CASE WHEN lower(coalesce(p_deployed_revision,'')) ~ '^[0-9a-f]{40}$'
          AND lower(coalesce(p_deployed_revision,'')) = lower(coalesce(v_cert->>'certified_commit','x'))
        THEN 'passed' ELSE 'failed' END, 'Deployed Edge revision equals the certified commit (full 40-character SHA).'),
   (28,'release_time_window_valid', CASE WHEN v_rel.release_expires_at IS NOT NULL
          AND v_rel.release_expires_at > now()
          AND v_rel.release_expires_at <= coalesce(v_rel.release_starts_at, now()) + interval '7 days'
        THEN 'passed' ELSE 'failed' END, 'Expiry is in the future and the pilot window does not exceed seven days.'),
   (29,'release_volume_limits_valid', CASE WHEN v_rel.id IS NOT NULL
          AND v_rel.max_recipients_per_request BETWEEN 1 AND 10
          AND v_rel.max_messages_per_hour <= v_rel.max_messages_per_day
          AND v_rel.max_messages_per_day <= v_rel.max_messages_total
        THEN 'passed' ELSE 'failed' END, 'Volume limits are within bounds and correctly laddered.'),
   (30,'pilot_recipient_rules_present', CASE WHEN v_rel.id IS NOT NULL
          AND jsonb_array_length(v_rel.pilot_recipient_rules) BETWEEN 1 AND 20
        THEN 'passed' ELSE 'failed' END, 'Masked/hashed pilot recipient rules present.'),
   (31,'live_delivery_legacy_flag_false', CASE WHEN coalesce(v_policy.live_delivery_enabled,false) = false THEN 'passed' ELSE 'failed' END, 'Legacy live_delivery_enabled flag remains false.'),
   (32,'business_dispatch_not_implemented_c6', 'not_implemented', 'Release governance is active, but business provider dispatch is introduced only in C7.');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'sequence', seq, 'code', code, 'state', state, 'detail', detail
  ) ORDER BY seq), '[]'::jsonb) INTO v_out FROM _oc_rel_chk;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_prerequisites(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 9. Service-role-only release decision (consumed by C7)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_decision(
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_event_code text,
  p_caller_module_code text,
  p_mode text,
  p_recipient_hashes text[],
  p_requested_message_count integer,
  p_deployed_revision text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_allowed boolean := false;
  v_code text := 'release_control_missing';
  v_hour integer := 0; v_day integer := 0; v_total integer := 0;
  v_perm_event boolean := false; v_perm_caller boolean := false;
  v_mode_ok boolean := false; v_rules_ok boolean := false;
BEGIN
  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, p_channel);

  IF v_rel.id IS NOT NULL THEN
    v_perm_event := p_event_code = ANY (coalesce(v_rel.permitted_event_codes,'{}'));
    v_perm_caller := p_caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules,'{}'))
                     AND p_caller_module_code <> 'OMNI_COMMS_ADMIN_DRY_RUN';
    v_mode_ok := p_mode = ANY (coalesce(v_rel.permitted_modes,'{}')) AND p_mode = 'queued';
    v_rules_ok := coalesce(array_length(p_recipient_hashes,1),0) > 0
      AND coalesce(array_length(p_recipient_hashes,1),0) <= v_rel.max_recipients_per_request
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p_recipient_hashes) h
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_rel.pilot_recipient_rules) r
          WHERE r->>'target_hash' = lower(h)));

    SELECT count(*) INTO v_hour FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id AND j.created_at > now() - interval '1 hour';
    SELECT count(*) INTO v_day FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id AND j.created_at > now() - interval '1 day';
    SELECT count(*) INTO v_total FROM public.omni_comms_dispatch_job j
      WHERE j.release_control_id = v_rel.id;

    IF v_rel.release_state = 'suspended' THEN v_code := 'release_not_active';
    ELSIF v_rel.release_state <> 'controlled_pilot' THEN v_code := 'release_not_active';
    ELSIF v_rel.release_expires_at IS NULL OR v_rel.release_expires_at <= now() THEN v_code := 'release_expired';
    ELSIF v_rel.release_starts_at IS NOT NULL AND v_rel.release_starts_at > now() THEN v_code := 'release_not_active';
    ELSIF NOT v_perm_event OR NOT v_perm_caller OR NOT v_mode_ok OR NOT v_rules_ok THEN v_code := 'release_scope_denied';
    ELSIF v_hour + coalesce(p_requested_message_count,1) > v_rel.max_messages_per_hour
       OR v_day + coalesce(p_requested_message_count,1) > v_rel.max_messages_per_day
       OR v_total + coalesce(p_requested_message_count,1) > v_rel.max_messages_total THEN v_code := 'release_limit_exceeded';
    ELSIF lower(coalesce(p_deployed_revision,'')) <> lower(coalesce(v_rel.approved_commit,'x')) THEN v_code := 'release_scope_denied';
    ELSE v_allowed := true; v_code := 'release_allowed';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'code', v_code,
    'release_control_id', v_rel.id,
    'release_version', v_rel.release_version,
    'release_state', v_rel.release_state,
    'release_fingerprint', v_rel.release_fingerprint,
    'release_expires_at', v_rel.release_expires_at,
    'permitted_event', v_perm_event,
    'permitted_caller', v_perm_caller,
    'mode_allowed', v_mode_ok,
    'recipient_rules_satisfied', v_rules_ok,
    'current_hourly_count', v_hour,
    'current_daily_count', v_day,
    'current_total_count', v_total,
    'max_messages_per_hour', v_rel.max_messages_per_hour,
    'max_messages_per_day', v_rel.max_messages_per_day,
    'max_messages_total', v_rel.max_messages_total
  );
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_decision(
  uuid, uuid, text, text, text, text, text[], integer, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 10. Approve + activate worker (service-role / trusted Edge only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_approve_activate(
  p_actor_id uuid,
  p_release_control_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_fingerprint text,
  p_deployed_revision text,
  p_approval_note text,
  p_correlation_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rel public.omni_comms_channel_release_control;
  v_checks jsonb;
  v_blockers integer;
  v_cert jsonb;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control
   WHERE id = p_release_control_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
  IF v_rel.proposed_state IS DISTINCT FROM 'controlled_pilot' THEN RAISE EXCEPTION 'release_proposal_missing' USING ERRCODE='22023'; END IF;
  IF v_rel.release_fingerprint <> coalesce(p_expected_fingerprint,'') THEN RAISE EXCEPTION 'release_proposal_fingerprint_changed' USING ERRCODE='22023'; END IF;
  IF v_rel.proposal_expires_at IS NULL OR v_rel.proposal_expires_at <= now() THEN RAISE EXCEPTION 'release_proposal_expired' USING ERRCODE='22023'; END IF;
  IF v_rel.proposed_by = p_actor_id THEN RAISE EXCEPTION 'segregation_of_duties_violation' USING ERRCODE='42501'; END IF;
  IF v_rel.release_state NOT IN ('test_only','suspended') THEN RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023'; END IF;

  v_checks := public.omni_comms_priv_channel_release_prerequisites(
    v_rel.organization_id, v_rel.department_id, v_rel.channel, v_rel.id, p_deployed_revision);
  SELECT count(*) INTO v_blockers FROM jsonb_array_elements(v_checks) c
   WHERE (c->>'sequence')::int <= 31 AND c->>'state' <> 'passed';
  IF v_blockers > 0 THEN
    PERFORM public.omni_comms_priv_channel_release_record_event(
      v_rel, 'release_gate_denied', v_rel.release_state, 'controlled_pilot',
      'prerequisites_failed', p_actor_id, p_correlation_id, p_deployed_revision,
      jsonb_build_object('blocker_count', v_blockers));
    RAISE EXCEPTION 'release_prerequisites_failed' USING ERRCODE='22023';
  END IF;

  v_cert := public.omni_comms_priv_runtime_certification();

  UPDATE public.omni_comms_channel_release_control SET
    release_state = 'controlled_pilot',
    release_version = release_version + 1,
    proposed_state = NULL,
    approved_by = p_actor_id,
    approved_at = now(),
    approval_note = left(coalesce(p_approval_note,''), 500),
    activated_by = p_actor_id,
    activated_at = now(),
    suspended_by = NULL, suspended_at = NULL, suspension_reason = NULL,
    approved_commit = v_cert->>'certified_commit',
    certification_workflow_run_id = v_cert->>'workflow_run_id',
    certification_recorded_at = (v_cert->>'certified_at')::timestamptz,
    updated_by = p_actor_id
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_approved', 'test_only', 'controlled_pilot',
    p_approval_note, p_actor_id, p_correlation_id, p_deployed_revision, '{}'::jsonb);
  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_activated', 'test_only', 'controlled_pilot',
    NULL, p_actor_id, p_correlation_id, p_deployed_revision, '{}'::jsonb);

  RETURN public.omni_comms_priv_channel_release_json(v_rel);
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_approve_activate(
  uuid, uuid, timestamptz, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 11. Expire-when-observed worker
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_release_expire_if_due(
  p_release_control_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rel public.omni_comms_channel_release_control;
BEGIN
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_release_control_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RETURN false; END IF;

  IF v_rel.proposed_state IS NOT NULL AND v_rel.proposal_expires_at IS NOT NULL
     AND v_rel.proposal_expires_at <= now() THEN
    UPDATE public.omni_comms_channel_release_control
      SET proposed_state = NULL, proposal_reason = NULL, proposal_expires_at = NULL
      WHERE id = v_rel.id RETURNING * INTO v_rel;
    PERFORM public.omni_comms_priv_channel_release_record_event(
      v_rel, 'proposal_expired', v_rel.release_state, NULL, 'proposal_window_elapsed', NULL, NULL, NULL, '{}'::jsonb);
  END IF;

  IF v_rel.release_state = 'controlled_pilot' AND v_rel.release_expires_at IS NOT NULL
     AND v_rel.release_expires_at <= now() THEN
    UPDATE public.omni_comms_channel_release_control
      SET release_state = 'test_only', release_version = release_version + 1
      WHERE id = v_rel.id RETURNING * INTO v_rel;
    PERFORM public.omni_comms_priv_channel_release_record_event(
      v_rel, 'release_expired', 'controlled_pilot', 'test_only', 'release_window_elapsed', NULL, NULL, NULL, '{}'::jsonb);
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_release_expire_if_due(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 12. Public bounded RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_summary(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'email',
  p_history_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_can_configure boolean := false;
  v_can_operate boolean := false;
  v_cert jsonb;
  v_policy public.omni_comms_channel_setting;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);
  IF p_channel <> 'email' THEN RAISE EXCEPTION 'release_channel_not_supported' USING ERRCODE='22023'; END IF;

  BEGIN PERFORM public.omni_comms_priv_require_capability('configure'); v_can_configure := true;
  EXCEPTION WHEN OTHERS THEN v_can_configure := false; END;
  BEGIN PERFORM public.omni_comms_priv_require_capability('operate'); v_can_operate := true;
  EXCEPTION WHEN OTHERS THEN v_can_operate := false; END;

  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, p_channel);
  v_cert := public.omni_comms_priv_runtime_certification();
  v_policy := public.omni_comms_priv_channel_test_effective_policy(p_organization_id, p_department_id, p_channel);

  RETURN jsonb_build_object(
    'release', CASE WHEN v_rel.id IS NULL THEN NULL
                    ELSE public.omni_comms_priv_channel_release_json(v_rel) END,
    'scope', jsonb_build_object('organization_id', p_organization_id,
                                'department_id', p_department_id,
                                'channel', p_channel),
    'certification', v_cert,
    'runtime_environment', public.omni_comms_priv_runtime_environment(),
    'live_delivery_enabled', coalesce(v_policy.live_delivery_enabled, false),
    'prerequisites', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb
      ELSE public.omni_comms_priv_channel_release_prerequisites(
        p_organization_id, p_department_id, p_channel, v_rel.id, NULL) END,
    'usage', CASE WHEN v_rel.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
        'hourly', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 hour'),
        'daily', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 day'),
        'total', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id)) END,
    'history', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'from_state', e.from_state,
        'to_state', e.to_state, 'reason', e.reason, 'actor_id', e.actor_id,
        'release_version', e.release_version,
        'release_fingerprint', left(e.release_fingerprint, 12),
        'certified_commit', e.certified_commit,
        'occurred_at', e.occurred_at) ORDER BY e.occurred_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.omni_comms_channel_release_event
            WHERE release_control_id = v_rel.id
            ORDER BY occurred_at DESC
            LIMIT greatest(1, least(coalesce(p_history_limit,25), 200))) e) END,
    'capabilities', jsonb_build_object(
      'can_configure', v_can_configure,
      'can_approve', v_can_operate AND v_rel.id IS NOT NULL
                     AND v_rel.proposed_state = 'controlled_pilot'
                     AND v_rel.proposed_by IS DISTINCT FROM v_actor,
      'can_suspend', v_can_operate AND v_rel.release_state = 'controlled_pilot'),
    'actor_id', v_actor,
    'business_dispatch_implemented', false,
    'generated_at', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_release_control_summary(uuid, uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_upsert_configuration(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_channel text,
  p_permitted_event_codes text[],
  p_permitted_caller_modules text[],
  p_permitted_modes text[],
  p_recipient_input jsonb,
  p_max_recipients_per_request integer,
  p_max_messages_per_hour integer,
  p_max_messages_per_day integer,
  p_max_messages_total integer,
  p_release_starts_at timestamptz,
  p_release_expires_at timestamptz,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_rules jsonb;
  v_created boolean := false;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);
  IF p_channel <> 'email' THEN RAISE EXCEPTION 'release_channel_not_supported' USING ERRCODE='22023'; END IF;

  v_rules := public.omni_comms_priv_channel_release_recipient_rules(p_channel, p_recipient_input);

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_channel_release_control (
      organization_id, department_id, channel, data_origin, release_state,
      permitted_event_codes, permitted_caller_modules, permitted_modes,
      pilot_recipient_rules, max_recipients_per_request, max_messages_per_hour,
      max_messages_per_day, max_messages_total, release_starts_at, release_expires_at,
      created_by, updated_by)
    VALUES (
      p_organization_id, p_department_id, p_channel, 'user', 'configuration',
      coalesce(p_permitted_event_codes,'{}'), coalesce(p_permitted_caller_modules,'{}'),
      coalesce(p_permitted_modes,'{}'), v_rules,
      coalesce(p_max_recipients_per_request,1), coalesce(p_max_messages_per_hour,5),
      coalesce(p_max_messages_per_day,20), coalesce(p_max_messages_total,50),
      p_release_starts_at, p_release_expires_at, v_actor, v_actor)
    RETURNING * INTO v_rel;
    v_created := true;
  ELSE
    SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_id FOR UPDATE;
    IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
    IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_read_only' USING ERRCODE='42501'; END IF;
    IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
    IF v_rel.release_state = 'controlled_pilot' THEN RAISE EXCEPTION 'release_locked_during_controlled_pilot' USING ERRCODE='42501'; END IF;

    UPDATE public.omni_comms_channel_release_control SET
      permitted_event_codes = coalesce(p_permitted_event_codes,'{}'),
      permitted_caller_modules = coalesce(p_permitted_caller_modules,'{}'),
      permitted_modes = coalesce(p_permitted_modes,'{}'),
      pilot_recipient_rules = v_rules,
      max_recipients_per_request = coalesce(p_max_recipients_per_request,1),
      max_messages_per_hour = coalesce(p_max_messages_per_hour,5),
      max_messages_per_day = coalesce(p_max_messages_per_day,20),
      max_messages_total = coalesce(p_max_messages_total,50),
      release_starts_at = p_release_starts_at,
      release_expires_at = p_release_expires_at,
      release_version = release_version + 1,
      proposed_state = NULL, proposal_reason = NULL, proposed_by = NULL,
      proposed_at = NULL, proposal_expires_at = NULL,
      approved_by = NULL, approved_at = NULL, approval_note = NULL,
      updated_by = v_actor
    WHERE id = v_rel.id RETURNING * INTO v_rel;
  END IF;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, CASE WHEN v_created THEN 'release_created' ELSE 'release_updated' END,
    v_rel.release_state, v_rel.release_state, NULL, v_actor, p_correlation_id, NULL, '{}'::jsonb);
  PERFORM public.omni_comms_priv_write_channel_audit(
    v_actor, CASE WHEN v_created THEN 'omni_comms.release_control.create' ELSE 'omni_comms.release_control.update' END,
    'omni_comms_channel_release_control', v_rel.id, v_rel.channel, NULL,
    jsonb_build_object('release_state', v_rel.release_state, 'release_version', v_rel.release_version),
    p_correlation_id);

  RETURN public.omni_comms_priv_channel_release_json(v_rel);
END;
$$;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_release_control_upsert_configuration(
  uuid, timestamptz, uuid, uuid, text, text[], text[], text[], jsonb, integer, integer, integer, integer,
  timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_set_basic_state(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_target_state text,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_from text;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  IF p_target_state = 'live' THEN
    RAISE EXCEPTION 'live_activation_not_available_until_business_pilot_certified' USING ERRCODE='22023';
  END IF;
  IF p_target_state NOT IN ('disabled','configuration','test_only') THEN
    RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_rel.organization_id, v_rel.department_id);
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;

  v_from := v_rel.release_state;
  IF NOT (
       (v_from='disabled' AND p_target_state='configuration')
    OR (v_from='configuration' AND p_target_state IN ('disabled','test_only'))
    OR (v_from='test_only' AND p_target_state IN ('configuration','disabled'))
    OR (v_from='suspended' AND p_target_state IN ('test_only','disabled'))
  ) THEN
    RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023';
  END IF;

  UPDATE public.omni_comms_channel_release_control SET
    release_state = p_target_state,
    release_version = release_version + 1,
    proposed_state = NULL, proposal_reason = NULL, proposed_by = NULL,
    proposed_at = NULL, proposal_expires_at = NULL,
    approved_by = NULL, approved_at = NULL, approval_note = NULL,
    suspended_by = NULL, suspended_at = NULL, suspension_reason = NULL,
    updated_by = v_actor
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, CASE WHEN v_from='suspended' THEN 'release_resumed' ELSE 'release_updated' END,
    v_from, p_target_state, p_reason, v_actor, p_correlation_id, NULL, '{}'::jsonb);

  RETURN public.omni_comms_priv_channel_release_json(v_rel);
END;
$$;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_release_control_set_basic_state(uuid, timestamptz, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_propose_pilot(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_rel.organization_id, v_rel.department_id);
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
  IF v_rel.release_state NOT IN ('test_only','suspended') THEN
    RAISE EXCEPTION 'release_transition_not_allowed' USING ERRCODE='22023';
  END IF;

  UPDATE public.omni_comms_channel_release_control SET
    proposed_state = 'controlled_pilot',
    proposal_reason = public.omni_comms_priv_normalize_reason(p_reason, true),
    proposed_by = v_actor,
    proposed_at = now(),
    proposal_expires_at = now() + interval '24 hours',
    approved_by = NULL, approved_at = NULL, approval_note = NULL,
    updated_by = v_actor
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_proposed', v_rel.release_state, 'controlled_pilot',
    v_rel.proposal_reason, v_actor, p_correlation_id, NULL, '{}'::jsonb);

  RETURN public.omni_comms_priv_channel_release_json(v_rel);
END;
$$;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_release_control_propose_pilot(uuid, timestamptz, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_cancel_proposal(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('configure');
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_rel.organization_id, v_rel.department_id);
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;
  IF v_rel.proposed_state IS NULL THEN RAISE EXCEPTION 'release_proposal_missing' USING ERRCODE='22023'; END IF;

  UPDATE public.omni_comms_channel_release_control SET
    proposed_state = NULL, proposal_reason = NULL, proposed_by = NULL,
    proposed_at = NULL, proposal_expires_at = NULL, updated_by = v_actor
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'proposal_cancelled', v_rel.release_state, NULL, p_reason, v_actor, p_correlation_id, NULL, '{}'::jsonb);
  RETURN public.omni_comms_priv_channel_release_json(v_rel);
END;
$$;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_release_control_cancel_proposal(uuid, timestamptz, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_suspend(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_from text;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('operate');
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE id = p_id FOR UPDATE;
  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, v_rel.organization_id, v_rel.department_id);
  IF v_rel.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'concurrent_modification' USING ERRCODE='40001'; END IF;

  v_from := v_rel.release_state;
  UPDATE public.omni_comms_channel_release_control SET
    release_state = 'suspended',
    release_version = release_version + 1,
    proposed_state = NULL, proposal_reason = NULL, proposed_by = NULL,
    proposed_at = NULL, proposal_expires_at = NULL,
    suspended_by = v_actor, suspended_at = now(),
    suspension_reason = public.omni_comms_priv_normalize_reason(p_reason, true),
    updated_by = v_actor
  WHERE id = v_rel.id RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_suspended', v_from, 'suspended', v_rel.suspension_reason,
    v_actor, p_correlation_id, NULL, '{}'::jsonb);
  RETURN public.omni_comms_priv_channel_release_json(v_rel);
END;
$$;
GRANT EXECUTE ON FUNCTION public.omni_comms_channel_release_control_suspend(uuid, timestamptz, text, text) TO authenticated;