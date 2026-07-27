-- ============================================================
-- SLICE 2A — Lineage diagnostic, evidence_core_v2, legacy attestation
-- Adds admin-only diagnostic + repair + attestation RPCs.
-- Does NOT send, does NOT change operating mode, automation state,
-- or any existing certification/observation status.
-- ============================================================

-- ---------- Helpers ------------------------------------------------

-- Canonical, order/case-independent recipient-set hash (SHA-256).
CREATE OR REPLACE FUNCTION public._comm_hub_recipient_set_hash_v2(p_policy jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_mode text;
  v_single text;
  v_named jsonb;
  v_domains jsonb;
  v_named_norm jsonb := '[]'::jsonb;
  v_domains_norm jsonb := '[]'::jsonb;
  v_canonical jsonb;
  v_addr text;
  v_active boolean;
BEGIN
  IF p_policy IS NULL THEN RETURN NULL; END IF;

  v_mode    := p_policy->>'active_mode';
  v_single  := lower(trim(coalesce(p_policy->>'single_configured_address','')));
  v_named   := coalesce(p_policy->'approved_named_addresses', '[]'::jsonb);
  v_domains := coalesce(p_policy->'approved_domains', '[]'::jsonb);

  -- Normalize named addresses: {address, active}
  WITH src AS (
    SELECT
      lower(trim(coalesce(elem->>'address',''))) AS address,
      coalesce((elem->>'active')::boolean, false) AS active
    FROM jsonb_array_elements(v_named) AS elem
  ),
  dedup AS (
    SELECT address, bool_or(active) AS active
    FROM src
    WHERE address <> ''
    GROUP BY address
  )
  SELECT coalesce(jsonb_agg(
           jsonb_build_object('address', address, 'active', active)
           ORDER BY address
         ), '[]'::jsonb)
    INTO v_named_norm
  FROM dedup;

  -- Normalize domain entries: text[]
  WITH src AS (
    SELECT lower(trim(elem::text, '"')) AS d
    FROM jsonb_array_elements_text(v_domains) AS elem
  )
  SELECT coalesce(jsonb_agg(DISTINCT d ORDER BY d), '[]'::jsonb)
    INTO v_domains_norm
  FROM src
  WHERE d <> '';

  v_canonical := jsonb_build_object(
    'mode', v_mode,
    'single_configured_address', nullif(v_single,''),
    'approved_named_addresses', v_named_norm,
    'approved_domains', v_domains_norm
  );

  RETURN encode(extensions.digest(v_canonical::text, 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public._comm_hub_recipient_set_hash_v2(jsonb) FROM PUBLIC;

-- Canonical template manifest hash (SHA-256 over canonical JSON).
CREATE OR REPLACE FUNCTION public._comm_hub_template_manifest_hash_v2(
  p_subject text,
  p_body_html text,
  p_body_text text,
  p_layout_id uuid
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(
    jsonb_build_object(
      'subject',    coalesce(p_subject,''),
      'body_html',  coalesce(p_body_html,''),
      'body_text',  coalesce(p_body_text,''),
      'layout_id',  coalesce(p_layout_id::text,'')
    )::text, 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public._comm_hub_template_manifest_hash_v2(text,text,text,uuid) FROM PUBLIC;

-- Canonical evidence-core projection. Consumers must fingerprint ONLY this.
CREATE OR REPLACE FUNCTION public._comm_hub_evidence_core_v2(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'module_code',              p_snapshot->>'module_code',
    'event_code',               p_snapshot->>'event_code',
    'channel',                  p_snapshot->>'channel',
    'template_version_id',      p_snapshot->>'template_version_id',
    'template_manifest_hash',   p_snapshot->>'template_manifest_hash',
    'sender_profile_id',        p_snapshot->>'sender_profile_id',
    'recipient_policy_version', (p_snapshot->>'recipient_policy_version')::bigint,
    'recipient_set_hash',       p_snapshot->>'recipient_set_hash',
    'provider_id',              p_snapshot->>'provider_id',
    'provider_key',             p_snapshot->>'provider_key',
    'payload_schema_version',   p_snapshot->>'payload_schema_version',
    'payload_schema_hash',      p_snapshot->>'payload_schema_hash',
    'review_policy_version',    (p_snapshot->>'review_policy_version')::bigint,
    'review_policy_hash',       p_snapshot->>'review_policy_hash',
    'send_policy_version',      (p_snapshot->>'send_policy_version')::bigint,
    'send_policy_hash',         p_snapshot->>'send_policy_hash'
  );
$$;

REVOKE ALL ON FUNCTION public._comm_hub_evidence_core_v2(jsonb) FROM PUBLIC;

-- ---------- Evidence authority column ------------------------------

ALTER TABLE public.communication_hub_event_certification
  ADD COLUMN IF NOT EXISTS evidence_authority text;

ALTER TABLE public.communication_hub_event_certification
  DROP CONSTRAINT IF EXISTS chec_evidence_authority_chk;

ALTER TABLE public.communication_hub_event_certification
  ADD CONSTRAINT chec_evidence_authority_chk
    CHECK (evidence_authority IS NULL OR evidence_authority IN
      ('HISTORICAL_COMPLETE','LEGACY_ATTESTED_BASELINE','NONE'));

-- ---------- Legacy attestation table -------------------------------

CREATE TABLE IF NOT EXISTS public.communication_hub_legacy_evidence_attestation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_lineage_id uuid NOT NULL,
  event_certification_id uuid NOT NULL REFERENCES public.communication_hub_event_certification(id),
  one_real_email_certification_id uuid NOT NULL REFERENCES public.communication_controlled_live_certification(id),
  current_evidence_snapshot_v2 jsonb NOT NULL,
  current_evidence_fingerprint_v2 text NOT NULL,
  historically_proven_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  historically_unavailable_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  attestation_reason text NOT NULL,
  typed_confirmation text NOT NULL,
  attested_by uuid NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ACTIVE',
  superseded_at timestamptz,
  CONSTRAINT clea_status_chk CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED'))
);

GRANT SELECT ON public.communication_hub_legacy_evidence_attestation TO authenticated;
GRANT ALL ON public.communication_hub_legacy_evidence_attestation TO service_role;

ALTER TABLE public.communication_hub_legacy_evidence_attestation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clea_read_admin ON public.communication_hub_legacy_evidence_attestation;
CREATE POLICY clea_read_admin ON public.communication_hub_legacy_evidence_attestation
  FOR SELECT TO authenticated
  USING (public.is_comm_hub_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_clea_lineage ON public.communication_hub_legacy_evidence_attestation(production_lineage_id);
CREATE INDEX IF NOT EXISTS idx_clea_event_cert ON public.communication_hub_legacy_evidence_attestation(event_certification_id);

-- ---------- (I) Backfill status semantics fix ----------------------
-- ORE cert with manual_verification_status = 'NOT_RECEIVED' is NOT_ELIGIBLE
-- (not FAILED lineage), unless its structural chain is broken.

UPDATE public.communication_controlled_live_certification
SET fingerprint_backfill_status = 'NOT_ELIGIBLE',
    fingerprint_backfill_detail = coalesce(fingerprint_backfill_detail,'{}'::jsonb)
      || jsonb_build_object('reclassified_from', fingerprint_backfill_status,
                            'reason','manual_verification_status=NOT_RECEIVED',
                            'reclassified_at', now())
WHERE certification_kind = 'ONE_REAL_EMAIL'
  AND manual_verification_status = 'NOT_RECEIVED'
  AND fingerprint_backfill_status = 'FAILED'
  AND execution_id IS NOT NULL
  AND message_id IS NOT NULL
  AND delivery_attempt_id IS NOT NULL;

-- ---------- (A) Production lineage diagnostic RPC ------------------

CREATE OR REPLACE FUNCTION public.get_comm_hub_production_lineage_diagnostic(
  p_module_code text, p_event_code text, p_channel text DEFAULT 'email'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ec  public.communication_hub_event_certification%ROWTYPE;
  v_ore_by_evt public.communication_controlled_live_certification%ROWTYPE;
  v_stage6 public.communication_controlled_live_certification%ROWTYPE;
  v_latest public.communication_controlled_live_certification%ROWTYPE;
  v_obs public.communication_manual_production_observation%ROWTYPE;
  v_exec public.communication_controlled_live_execution%ROWTYPE;
  v_msg public.communication_message%ROWTYPE;
  v_att public.communication_delivery_attempt%ROWTYPE;
  v_provider public.notification_providers%ROWTYPE;
  v_cand public.communication_controlled_live_certification%ROWTYPE;
  v_s6_ok boolean;
  v_stage6_id uuid;
  v_ore_lineage uuid;
  v_evt_lineage uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code = p_module_code AND event_code = p_event_code AND channel = coalesce(p_channel,'email');

  IF v_ec.id IS NOT NULL THEN
    SELECT * INTO v_ore_by_evt FROM public.communication_controlled_live_certification
     WHERE id = v_ec.one_real_email_certification_id;
  END IF;

  -- Reproduce Stage 6 eligibility ordering (from get_comm_hub_event_go_live_status)
  FOR v_cand IN
    SELECT c.* FROM public.communication_controlled_live_certification c
     WHERE c.certification_kind = 'ONE_REAL_EMAIL'
       AND c.module_code = p_module_code
       AND c.event_code  = p_event_code
       AND c.channel     = coalesce(p_channel,'email')
       AND c.invalidated_at IS NULL
       AND c.status IN ('DELIVERY_CONFIRMED','DELIVERY_CONFIRMED_MANUALLY')
       AND c.manual_verification_status = 'CONFIRMED'
       AND c.manual_verified_at IS NOT NULL
       AND c.trace_id IS NOT NULL
       AND coalesce(c.provider_message_id,'') <> ''
       AND c.execution_id IS NOT NULL
       AND c.message_id IS NOT NULL
       AND c.delivery_attempt_id IS NOT NULL
     ORDER BY coalesce(c.manual_verified_at, c.certified_at) DESC NULLS LAST
  LOOP
    SELECT * INTO v_exec FROM public.communication_controlled_live_execution WHERE id = v_cand.execution_id;
    IF NOT FOUND OR coalesce(v_exec.provider_call_attempted, false) = false THEN CONTINUE; END IF;
    SELECT * INTO v_msg FROM public.communication_message WHERE id = v_cand.message_id;
    IF NOT FOUND OR lower(v_msg.status) NOT IN ('sent','delivered') THEN CONTINUE; END IF;
    SELECT * INTO v_att FROM public.communication_delivery_attempt WHERE id = v_cand.delivery_attempt_id;
    IF NOT FOUND OR lower(v_att.status) NOT IN ('success','delivered')
       OR coalesce(v_att.provider_call_attempted, false) = false THEN CONTINUE; END IF;
    v_stage6 := v_cand;
    EXIT;
  END LOOP;

  SELECT * INTO v_latest FROM public.communication_controlled_live_certification
   WHERE certification_kind='ONE_REAL_EMAIL' AND module_code=p_module_code
     AND event_code=p_event_code AND channel=coalesce(p_channel,'email')
   ORDER BY certified_at DESC NULLS LAST LIMIT 1;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
   WHERE module_code=p_module_code AND event_code=p_event_code
   ORDER BY created_at DESC LIMIT 1;

  IF v_ore_by_evt.id IS NOT NULL AND v_ore_by_evt.execution_id IS NOT NULL THEN
    SELECT * INTO v_exec FROM public.communication_controlled_live_execution WHERE id = v_ore_by_evt.execution_id;
    SELECT * INTO v_msg  FROM public.communication_message WHERE id = v_ore_by_evt.message_id;
    SELECT * INTO v_att  FROM public.communication_delivery_attempt WHERE id = v_ore_by_evt.delivery_attempt_id;
  END IF;

  -- Resolve provider by name for the event-anchored ORE
  IF v_ore_by_evt.id IS NOT NULL THEN
    SELECT * INTO v_provider FROM public.notification_providers
     WHERE channel = coalesce(p_channel,'email') AND upper(provider_name) = upper(coalesce(v_ore_by_evt.provider_name,''))
     LIMIT 1;
  END IF;

  v_stage6_id   := v_stage6.id;
  v_ore_lineage := v_ore_by_evt.production_lineage_id;
  v_evt_lineage := v_ec.production_lineage_id;
  v_s6_ok := v_stage6_id IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', v_ec.id IS NOT NULL AND v_stage6_id IS NOT NULL
          AND v_stage6_id = v_ec.one_real_email_certification_id,
    'module_code', p_module_code,
    'event_code',  p_event_code,
    'channel',     coalesce(p_channel,'email'),
    'result',
      CASE
        WHEN v_ec.id IS NULL                                THEN 'EVENT_CERTIFICATION_MISSING'
        WHEN v_stage6_id IS NULL                            THEN 'STAGE6_ELIGIBLE_ORE_MISSING'
        WHEN v_stage6_id <> v_ec.one_real_email_certification_id THEN 'LINEAGE_ANCHOR_MISMATCH'
        ELSE 'LINEAGE_OK'
      END,
    'ids', jsonb_build_object(
      'stage6_eligible_ore_certification_id', v_stage6_id,
      'stage6_latest_ore_certification_id',   v_latest.id,
      'event_certification_id',               v_ec.id,
      'event_certification_ore_id',           v_ec.one_real_email_certification_id,
      'event_certification_production_lineage_id', v_evt_lineage,
      'ore_production_lineage_id',            v_ore_lineage,
      'manual_observation_id',                v_obs.id,
      'manual_observation_event_certification_id', v_obs.event_certification_id,
      'manual_observation_status',            v_obs.status,
      'controlled_live_execution_id',         v_ore_by_evt.execution_id,
      'message_id',                           v_ore_by_evt.message_id,
      'delivery_attempt_id',                  v_ore_by_evt.delivery_attempt_id,
      'provider_id',                          v_provider.id,
      'provider_name',                        v_ore_by_evt.provider_name,
      'provider_message_id',                  v_ore_by_evt.provider_message_id,
      'trace_id',                             v_ore_by_evt.trace_id
    ),
    'comparisons', jsonb_build_object(
      'stage6_ore_matches_event_certification',
        (v_stage6_id IS NOT NULL AND v_ec.id IS NOT NULL
          AND v_stage6_id = v_ec.one_real_email_certification_id),
      'event_certification_matches_manual_observation',
        (v_ec.id IS NOT NULL AND v_obs.event_certification_id IS NOT NULL
          AND v_obs.event_certification_id = v_ec.id),
      'ore_lineage_matches_event_lineage',
        (v_ore_lineage IS NOT NULL AND v_evt_lineage IS NOT NULL
          AND v_ore_lineage = v_evt_lineage),
      'execution_message_attempt_chain_valid',
        (v_ore_by_evt.execution_id IS NOT NULL
          AND v_ore_by_evt.message_id IS NOT NULL
          AND v_ore_by_evt.delivery_attempt_id IS NOT NULL
          AND v_ore_by_evt.trace_id IS NOT NULL
          AND coalesce(v_ore_by_evt.provider_message_id,'') <> '')
    ),
    'event_certification_status', v_ec.status,
    'evidence_authority',         v_ec.evidence_authority,
    'ore_fingerprint_backfill_status', v_ore_by_evt.fingerprint_backfill_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_comm_hub_production_lineage_diagnostic(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_production_lineage_diagnostic(text,text,text) TO authenticated;

-- ---------- (B) Lineage repair RPC ---------------------------------

CREATE OR REPLACE FUNCTION public.repair_comm_hub_production_lineage_anchor(
  p_module_code text,
  p_event_code text,
  p_channel text,
  p_expected_event_certification_id uuid,
  p_expected_ore_certification_id uuid,
  p_reason text,
  p_typed_confirmation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_ore public.communication_controlled_live_certification%ROWTYPE;
  v_obs public.communication_manual_production_observation%ROWTYPE;
  v_diag jsonb;
  v_new_lineage uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  IF coalesce(p_typed_confirmation,'') <> 'REPAIR PRODUCTION LINEAGE' THEN
    RETURN jsonb_build_object('ok', false, 'phase', 'TYPED_CONFIRMATION_MISMATCH');
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'phase', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE id = p_expected_event_certification_id
     AND module_code = p_module_code AND event_code = p_event_code
     AND channel = coalesce(p_channel,'email')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'phase','EVENT_CERTIFICATION_NOT_FOUND');
  END IF;
  IF v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    RETURN jsonb_build_object('ok', false, 'phase','EVENT_NOT_LIVE');
  END IF;
  IF v_ec.one_real_email_certification_id <> p_expected_ore_certification_id THEN
    RETURN jsonb_build_object('ok', false, 'phase','ORE_NOT_ANCHORED_TO_EVENT');
  END IF;

  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE id = p_expected_ore_certification_id FOR UPDATE;
  IF v_ore.certification_kind <> 'ONE_REAL_EMAIL' THEN
    RETURN jsonb_build_object('ok', false, 'phase','NOT_ONE_REAL_EMAIL');
  END IF;
  IF v_ore.manual_verification_status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('ok', false, 'phase','ORE_NOT_CONFIRMED');
  END IF;
  IF v_ore.invalidated_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'phase','ORE_INVALIDATED');
  END IF;
  IF v_ore.execution_id IS NULL OR v_ore.message_id IS NULL OR v_ore.delivery_attempt_id IS NULL
     OR v_ore.trace_id IS NULL OR coalesce(v_ore.provider_message_id,'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'phase','AMBIGUOUS_CHAIN');
  END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
   WHERE event_certification_id = v_ec.id AND status NOT IN ('CONFIRMED','VOIDED','FAILED')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'phase','UNRESOLVED_OBSERVATION');
  END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
   WHERE event_certification_id = v_ec.id AND status='CONFIRMED'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'phase','NO_CONFIRMED_OBSERVATION');
  END IF;

  -- Assign a fresh lineage id, syncing ORE and event cert.
  v_new_lineage := gen_random_uuid();

  UPDATE public.communication_controlled_live_certification
     SET production_lineage_id = v_new_lineage,
         updated_at = now()
   WHERE id = v_ore.id;

  UPDATE public.communication_hub_event_certification
     SET production_lineage_id = v_new_lineage,
         updated_at = now()
   WHERE id = v_ec.id;

  INSERT INTO public.audit_logs(user_id, action, resource_type, resource_id, metadata, created_at)
  VALUES (v_uid, 'comm_hub.production_lineage.repair',
          'communication_hub_event_certification', v_ec.id::text,
          jsonb_build_object(
            'module_code', p_module_code,
            'event_code',  p_event_code,
            'channel',     coalesce(p_channel,'email'),
            'ore_certification_id', v_ore.id,
            'previous_ore_lineage_id', v_ore.production_lineage_id,
            'previous_event_lineage_id', v_ec.production_lineage_id,
            'new_lineage_id', v_new_lineage,
            'reason', p_reason),
          now());

  RETURN jsonb_build_object('ok', true, 'phase','REPAIRED', 'new_lineage_id', v_new_lineage);
END;
$$;

REVOKE ALL ON FUNCTION public.repair_comm_hub_production_lineage_anchor(text,text,text,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_comm_hub_production_lineage_anchor(text,text,text,uuid,uuid,text,text) TO authenticated;

-- ---------- (G) Legacy baseline attestation RPC --------------------

CREATE OR REPLACE FUNCTION public.attest_comm_hub_legacy_production_baseline(
  p_module_code text,
  p_event_code text,
  p_channel text,
  p_attestation_reason text,
  p_typed_confirmation text,
  p_historically_proven_components jsonb DEFAULT '[]'::jsonb,
  p_historically_unavailable_components jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ec public.communication_hub_event_certification%ROWTYPE;
  v_ore public.communication_controlled_live_certification%ROWTYPE;
  v_obs public.communication_manual_production_observation%ROWTYPE;
  v_snap jsonb;
  v_core jsonb;
  v_fp text;
  v_attest_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF NOT public.is_comm_hub_admin(v_uid) THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501'; END IF;

  IF coalesce(p_typed_confirmation,'') <> 'ATTEST LEGACY PRODUCTION BASELINE' THEN
    RETURN jsonb_build_object('ok', false, 'phase','TYPED_CONFIRMATION_MISMATCH');
  END IF;
  IF coalesce(trim(p_attestation_reason),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'phase','REASON_REQUIRED');
  END IF;

  SELECT * INTO v_ec FROM public.communication_hub_event_certification
   WHERE module_code=p_module_code AND event_code=p_event_code AND channel=coalesce(p_channel,'email')
   FOR UPDATE;
  IF NOT FOUND OR v_ec.status NOT IN ('live_manual_only','live_cron_allowed') THEN
    RETURN jsonb_build_object('ok', false, 'phase','EVENT_NOT_LIVE');
  END IF;

  SELECT * INTO v_ore FROM public.communication_controlled_live_certification
   WHERE id = v_ec.one_real_email_certification_id;
  IF NOT FOUND OR v_ore.manual_verification_status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('ok', false, 'phase','ORE_NOT_CONFIRMED');
  END IF;

  SELECT * INTO v_obs FROM public.communication_manual_production_observation
   WHERE event_certification_id = v_ec.id AND status='CONFIRMED'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'phase','NO_CONFIRMED_OBSERVATION');
  END IF;

  IF EXISTS (SELECT 1 FROM public.communication_manual_production_observation
              WHERE event_certification_id = v_ec.id
                AND status NOT IN ('CONFIRMED','VOIDED','FAILED')) THEN
    RETURN jsonb_build_object('ok', false, 'phase','UNRESOLVED_OBSERVATION');
  END IF;

  IF v_ec.drift_detected_at IS NOT NULL OR v_ec.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'phase','CURRENT_DRIFT_OR_SUSPENSION');
  END IF;

  -- Fetch and validate current snapshot
  v_snap := public.get_comm_hub_current_evidence_snapshot(p_module_code, p_event_code, coalesce(p_channel,'email'));
  IF v_snap IS NULL OR coalesce((v_snap->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'phase','CURRENT_SNAPSHOT_INCOMPLETE',
                              'snapshot', v_snap);
  END IF;

  v_core := public._comm_hub_evidence_core_v2(v_snap);
  v_fp   := public._comm_hub_fingerprint_evidence_snapshot_v2(v_core);

  -- Supersede prior active attestation for this lineage
  UPDATE public.communication_hub_legacy_evidence_attestation
     SET status='SUPERSEDED', superseded_at = now()
   WHERE production_lineage_id = v_ec.production_lineage_id AND status='ACTIVE';

  INSERT INTO public.communication_hub_legacy_evidence_attestation(
    production_lineage_id, event_certification_id, one_real_email_certification_id,
    current_evidence_snapshot_v2, current_evidence_fingerprint_v2,
    historically_proven_components, historically_unavailable_components,
    attestation_reason, typed_confirmation, attested_by
  ) VALUES (
    v_ec.production_lineage_id, v_ec.id, v_ore.id,
    v_snap, v_fp,
    coalesce(p_historically_proven_components, '[]'::jsonb),
    coalesce(p_historically_unavailable_components, '[]'::jsonb),
    p_attestation_reason, p_typed_confirmation, v_uid
  ) RETURNING id INTO v_attest_id;

  -- Mark event authority; keep ORE INCOMPLETE per instructions
  UPDATE public.communication_hub_event_certification
     SET evidence_authority = 'LEGACY_ATTESTED_BASELINE',
         updated_at = now()
   WHERE id = v_ec.id;

  INSERT INTO public.audit_logs(user_id, action, resource_type, resource_id, metadata, created_at)
  VALUES (v_uid, 'comm_hub.legacy_baseline.attest',
          'communication_hub_event_certification', v_ec.id::text,
          jsonb_build_object(
            'attestation_id', v_attest_id,
            'production_lineage_id', v_ec.production_lineage_id,
            'fingerprint', v_fp,
            'reason', p_attestation_reason),
          now());

  RETURN jsonb_build_object(
    'ok', true, 'phase','ATTESTED',
    'attestation_id', v_attest_id,
    'evidence_authority', 'LEGACY_ATTESTED_BASELINE',
    'evidence_fingerprint_v2', v_fp,
    'evidence_core_v2', v_core
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attest_comm_hub_legacy_production_baseline(text,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attest_comm_hub_legacy_production_baseline(text,text,text,text,text,jsonb,jsonb) TO authenticated;
