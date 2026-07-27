
-- =========================================================================
-- Slice 2 (B + C + D) — Canonical current / historical ORE evidence snapshots
-- + idempotent legacy fingerprint backfill.
--
-- SOURCE MAP (authoritative resolution of each evidence component)
-- -------------------------------------------------------------------------
-- component                      | source (canonical)                                                | required?
-- module_code / event_code /     | RPC input                                                          | required
--   channel                      |                                                                    |
-- template_map_id                | communication_hub_event_template_map WHERE active=true AND         | required (current)
--                                |   (module_code,event_code,channel) match                           |
-- template_version_id (current)  | core_template_version WHERE template_id=<map.template_id> AND      | required
--                                |   status='PUBLISHED' ORDER BY version_no DESC LIMIT 1              |
-- template_version_id (hist.)    | communication_message.template_version_id of ORE message           | required
-- template_manifest_hash         | sha256(coalesce(subject,'')||body_html||body_text||layout_id::text)| required
--                                |   from core_template_version                                       |
-- sender_profile_id (current)    | communication_hub_event_template_map.sender_profile_id             | required
-- sender_profile_id (historical) | communication_message.sender_profile_id                            | required
-- recipient_policy_version (cur) | communication_hub_recipient_policy ORDER BY policy_version DESC    | required
--                                |   LIMIT 1 (global singleton policy) .policy_version                |
-- recipient_policy_version (his) | communication_controlled_live_certification.recipient_policy_version| required
-- recipient_set_hash (current)   | md5 of jsonb_build with policy.active_mode+approved addresses      | required (deterministic set hash)
-- recipient_set_hash (historical)| communication_message.recipient_set_hash of ORE message            | required
-- provider_id (current)          | notification_providers WHERE channel='email' AND is_default        | required
--                                |   AND is_active LIMIT 1                                            |
-- provider_id (historical)       | communication_delivery_attempt.provider_id of ORE attempt          | required
-- provider_key                   | notification_providers.email_provider_type (stable, non-secret)    | required
-- payload_schema_version + hash  | communication_hub_event_payload_schema.schema_version +            | required
--                                |   sha256(json_schema::text)                                        |
-- review_policy hash             | sha256 of stable content columns of communication_hub_event_review_policy | required
-- send_policy hash               | sha256 of stable content columns of communication_hub_event_send_policy  | required
--
-- Notes:
--  * No fingerprint input includes timestamps, runtime_mode_version, configuration_version,
--    automation_generation, provider credentials, API keys, raw secrets, or raw recipient lists.
--  * The current recipient set hash is a deterministic hash of the recipient POLICY content
--    (not a raw list); this matches the singleton-policy model used elsewhere in the Hub.
--  * If any required source is unresolved, the RPC returns ok=false with structured blockers.
--  * Historical (execution-bound) versions for send/review/payload policies are not persisted
--    in the current schema; the ORE snapshot marks those components as UNAVAILABLE and the
--    backfill records fingerprint_backfill_status='INCOMPLETE' with the missing components.
-- =========================================================================

-- --------------------------------------------------------------
-- 1. Additive columns on both certification tables
-- --------------------------------------------------------------
ALTER TABLE public.communication_controlled_live_certification
  ADD COLUMN IF NOT EXISTS production_lineage_id uuid,
  ADD COLUMN IF NOT EXISTS evidence_snapshot_v2 jsonb,
  ADD COLUMN IF NOT EXISTS evidence_fingerprint_v2 text,
  ADD COLUMN IF NOT EXISTS evidence_fingerprint_algorithm text,
  ADD COLUMN IF NOT EXISTS fingerprint_backfill_status text,
  ADD COLUMN IF NOT EXISTS fingerprint_backfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fingerprint_backfill_detail jsonb;

ALTER TABLE public.communication_hub_event_certification
  ADD COLUMN IF NOT EXISTS production_lineage_id uuid,
  ADD COLUMN IF NOT EXISTS evidence_snapshot_v2 jsonb,
  ADD COLUMN IF NOT EXISTS evidence_fingerprint_v2 text,
  ADD COLUMN IF NOT EXISTS evidence_fingerprint_algorithm text,
  ADD COLUMN IF NOT EXISTS fingerprint_backfill_status text,
  ADD COLUMN IF NOT EXISTS fingerprint_backfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fingerprint_backfill_detail jsonb;

CREATE INDEX IF NOT EXISTS idx_ccl_cert_production_lineage
  ON public.communication_controlled_live_certification(production_lineage_id);
CREATE INDEX IF NOT EXISTS idx_chec_production_lineage
  ON public.communication_hub_event_certification(production_lineage_id);

-- --------------------------------------------------------------
-- 2. Canonical deterministic SHA-256 v2 fingerprint helper
--    - Accepts the canonical snapshot jsonb.
--    - Strips known non-evidence metadata before hashing.
--    - Uses pgcrypto (fails closed if not available).
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._comm_hub_fingerprint_evidence_snapshot_v2(p_snapshot jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_pgcrypto boolean;
  v_clean    jsonb;
  v_bytes    bytea;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') INTO v_pgcrypto;
  IF NOT v_pgcrypto THEN
    RAISE EXCEPTION 'FINGERPRINT_ALGO_UNAVAILABLE: pgcrypto required for sha256-v2';
  END IF;

  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'FINGERPRINT_SNAPSHOT_NULL';
  END IF;

  -- Strip non-evidence metadata that must not participate in the fingerprint.
  v_clean := p_snapshot
    - 'production_lineage_id'
    - 'event_certification_id'
    - 'one_real_email_certification_id'
    - 'controlled_live_execution_id'
    - 'message_id'
    - 'delivery_attempt_id'
    - 'trace_id'
    - 'provider_message_id'
    - 'operating_mode'
    - 'runtime_mode_version'
    - 'configuration_version'
    - 'automation_generation'
    - 'resolved_at'
    - 'certification_id'
    - 'blockers'
    - 'completeness_status';

  -- jsonb text form is deterministic (sorted keys, canonical types).
  v_bytes := extensions.digest(v_clean::text, 'sha256');
  RETURN 'sha256-v2:' || encode(v_bytes, 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public._comm_hub_fingerprint_evidence_snapshot_v2(jsonb) FROM PUBLIC;

-- --------------------------------------------------------------
-- Helper: normalize casing / null handling for consistent snapshots.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._comm_hub_norm_code(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(upper(btrim(t)), '')
$$;

CREATE OR REPLACE FUNCTION public._comm_hub_norm_channel(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(btrim(t)), '')
$$;

-- --------------------------------------------------------------
-- Helper: deterministic hash of arbitrary jsonb (sha256 hex, no prefix).
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._comm_hub_sha256_jsonb(p jsonb)
RETURNS text LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT encode(extensions.digest(COALESCE(p, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

-- --------------------------------------------------------------
-- 3. CURRENT evidence snapshot RPC (admin-only, read-only)
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_comm_hub_current_evidence_snapshot(
  p_module_code text,
  p_event_code  text,
  p_channel     text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_module text := _comm_hub_norm_code(p_module_code);
  v_event  text := _comm_hub_norm_code(p_event_code);
  v_channel text := _comm_hub_norm_channel(p_channel);
  v_blockers jsonb := '[]'::jsonb;
  v_map RECORD;
  v_ctv RECORD;
  v_rp  RECORD;
  v_sp  RECORD;
  v_rev RECORD;
  v_ps  RECORD;
  v_provider RECORD;
  v_evt_cert RECORD;
  v_ore_cert RECORD;
  v_production_lineage_id uuid;
  v_template_manifest_hash text;
  v_recip_set_hash text;
  v_payload_hash text;
  v_review_hash text;
  v_send_hash text;
  v_snapshot jsonb;
  v_fingerprint text;
  v_ctrl RECORD;
BEGIN
  -- Admin authority
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','UNAUTHENTICATED','component','actor')));
  END IF;

  SELECT has_role(v_actor, 'admin'::app_role) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','NOT_ADMIN','component','actor')));
  END IF;

  IF v_module IS NULL OR v_event IS NULL OR v_channel IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','INPUT_INVALID','component','module_event_channel')));
  END IF;

  -- Control settings (metadata only; not fingerprint input)
  SELECT operating_mode, runtime_mode_version, configuration_version, automation_generation
    INTO v_ctrl
  FROM communication_hub_control_settings LIMIT 1;

  -- Active template mapping
  SELECT * INTO v_map
  FROM communication_hub_event_template_map
  WHERE upper(module_code) = v_module
    AND upper(event_code)  = v_event
    AND lower(channel)     = v_channel
    AND active = true
  LIMIT 1;
  IF v_map.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','TEMPLATE_MAP_UNRESOLVED','component','template_map',
      'expected_source','communication_hub_event_template_map (active=true)',
      'detail','No active template mapping for module/event/channel',
      'fix_action','Publish an active template mapping');
  END IF;

  -- Current published template_version
  IF v_map.template_id IS NOT NULL THEN
    SELECT * INTO v_ctv
    FROM core_template_version
    WHERE template_id = v_map.template_id AND status = 'PUBLISHED'
    ORDER BY version_no DESC LIMIT 1;
  END IF;
  IF v_ctv.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','TEMPLATE_VERSION_UNRESOLVED','component','template_version',
      'expected_source','core_template_version (status=PUBLISHED, latest)',
      'detail','No published template version found for mapped template');
  ELSE
    v_template_manifest_hash := encode(extensions.digest(
      coalesce(v_ctv.subject,'') || '|' ||
      coalesce(v_ctv.body_html,'') || '|' ||
      coalesce(v_ctv.body_text,'') || '|' ||
      coalesce(v_ctv.layout_id::text,''), 'sha256'), 'hex');
  END IF;

  -- Sender profile (from mapping — canonical current sender)
  IF v_map.sender_profile_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','SENDER_PROFILE_UNRESOLVED','component','sender_profile',
      'expected_source','communication_hub_event_template_map.sender_profile_id',
      'detail','Active mapping has no sender_profile_id');
  END IF;

  -- Recipient policy (global singleton)
  SELECT * INTO v_rp
  FROM communication_hub_recipient_policy
  ORDER BY policy_version DESC LIMIT 1;
  IF v_rp.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','RECIPIENT_POLICY_UNRESOLVED','component','recipient_policy',
      'expected_source','communication_hub_recipient_policy (latest)',
      'detail','No recipient policy configured');
  ELSE
    -- Deterministic set hash from policy content only (no raw list stored in snapshot)
    v_recip_set_hash := _comm_hub_sha256_jsonb(jsonb_build_object(
      'active_mode', v_rp.active_mode,
      'single_configured_address', v_rp.single_configured_address,
      'approved_named_addresses', COALESCE(v_rp.approved_named_addresses, '[]'::jsonb),
      'approved_domains', to_jsonb(COALESCE(v_rp.approved_domains, ARRAY[]::text[]))
    ));
  END IF;

  -- Send policy (event-scoped)
  SELECT * INTO v_sp FROM communication_hub_event_send_policy
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel
  LIMIT 1;
  IF v_sp.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','SEND_POLICY_UNRESOLVED','component','send_policy',
      'expected_source','communication_hub_event_send_policy',
      'detail','No send policy configured for module/event/channel',
      'fix_action','Author an event send policy');
  ELSE
    v_send_hash := _comm_hub_sha256_jsonb(jsonb_build_object(
      'send_policy', v_sp.send_policy,
      'recipient_policy', v_sp.recipient_policy,
      'requires_template_approval', v_sp.requires_template_approval,
      'requires_sender_verified', v_sp.requires_sender_verified,
      'requires_recipient_validation', v_sp.requires_recipient_validation,
      'allow_internal_recipients', v_sp.allow_internal_recipients,
      'allow_external_recipients', v_sp.allow_external_recipients,
      'allowed_internal_domains', to_jsonb(COALESCE(v_sp.allowed_internal_domains, ARRAY[]::text[])),
      'allowed_external_domains', to_jsonb(COALESCE(v_sp.allowed_external_domains, ARRAY[]::text[])),
      'max_recipients_per_send', v_sp.max_recipients_per_send,
      'max_sends_per_entity_per_event', v_sp.max_sends_per_entity_per_event,
      'duplicate_window_minutes', v_sp.duplicate_window_minutes,
      'require_preview_before_manual_send', v_sp.require_preview_before_manual_send,
      'require_typed_confirmation_for_send', v_sp.require_typed_confirmation_for_send,
      'is_enabled', v_sp.is_enabled,
      'duplicate_scope', v_sp.duplicate_scope,
      'duplicate_key_template', v_sp.duplicate_key_template
    ));
  END IF;

  -- Review policy
  SELECT * INTO v_rev FROM communication_hub_event_review_policy
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel
  LIMIT 1;
  IF v_rev.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','REVIEW_POLICY_UNRESOLVED','component','review_policy',
      'expected_source','communication_hub_event_review_policy',
      'detail','No review policy configured for module/event/channel');
  ELSE
    v_review_hash := _comm_hub_sha256_jsonb(jsonb_build_object(
      'review_mode', v_rev.review_mode,
      'preview_required', v_rev.preview_required,
      'allow_operator_edit_tokens', v_rev.allow_operator_edit_tokens,
      'allow_operator_edit_body', v_rev.allow_operator_edit_body,
      'allow_operator_change_recipient', v_rev.allow_operator_change_recipient,
      'require_template_approval', v_rev.require_template_approval,
      'require_legal_approval', v_rev.require_legal_approval,
      'require_business_approval', v_rev.require_business_approval,
      'approval_status', v_rev.approval_status,
      'approved_template_version_id', v_rev.approved_template_version_id
    ));
  END IF;

  -- Payload schema
  SELECT * INTO v_ps FROM communication_hub_event_payload_schema
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event
  ORDER BY schema_version DESC LIMIT 1;
  IF v_ps.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','PAYLOAD_SCHEMA_UNRESOLVED','component','payload_schema',
      'expected_source','communication_hub_event_payload_schema',
      'detail','No payload schema for module/event');
  ELSE
    v_payload_hash := _comm_hub_sha256_jsonb(jsonb_build_object(
      'schema_version', v_ps.schema_version,
      'status', v_ps.status,
      'json_schema_hash', _comm_hub_sha256_jsonb(COALESCE(v_ps.json_schema, '{}'::jsonb))
    ));
  END IF;

  -- Current active provider (default active for channel)
  SELECT * INTO v_provider FROM notification_providers
  WHERE lower(channel) = v_channel AND is_active = true AND is_default = true
  ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_provider.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','PROVIDER_UNRESOLVED','component','provider',
      'expected_source','notification_providers (is_default=true, is_active=true, channel matches)',
      'detail','No active default provider for channel');
  END IF;

  -- Event certification (metadata only) and its ORE
  SELECT * INTO v_evt_cert FROM communication_hub_event_certification
  WHERE upper(module_code)=v_module AND upper(event_code)=v_event AND lower(channel)=v_channel
  LIMIT 1;
  IF v_evt_cert.one_real_email_certification_id IS NOT NULL THEN
    SELECT * INTO v_ore_cert FROM communication_controlled_live_certification
    WHERE id = v_evt_cert.one_real_email_certification_id;
    v_production_lineage_id := v_ore_cert.production_lineage_id;
  END IF;

  -- If any blocker, return ok=false without producing a fingerprint.
  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'snapshot_version', 2,
      'production_lineage_id', v_production_lineage_id,
      'event_certification_id', v_evt_cert.id,
      'operating_mode', v_ctrl.operating_mode,
      'runtime_mode_version', v_ctrl.runtime_mode_version,
      'configuration_version', v_ctrl.configuration_version,
      'automation_generation', v_ctrl.automation_generation,
      'blockers', v_blockers
    );
  END IF;

  -- Assemble evidence snapshot (fingerprint inputs only in `evidence`)
  v_snapshot := jsonb_build_object(
    'module_code', v_module,
    'event_code',  v_event,
    'channel',     v_channel,
    'template_map_id', v_map.id,
    'template_id', v_map.template_id,
    'template_code', v_map.template_code,
    'template_version_id', v_ctv.id,
    'template_version_no', v_ctv.version_no,
    'template_manifest_hash', v_template_manifest_hash,
    'sender_profile_id', v_map.sender_profile_id,
    'recipient_policy_version', v_rp.policy_version,
    'recipient_set_hash', v_recip_set_hash,
    'provider_id', v_provider.id,
    'provider_key', v_provider.email_provider_type,
    'payload_schema_version', v_ps.schema_version,
    'payload_schema_hash', v_payload_hash,
    'review_policy_hash', v_review_hash,
    'send_policy_hash', v_send_hash
  );

  v_fingerprint := _comm_hub_fingerprint_evidence_snapshot_v2(v_snapshot);

  RETURN jsonb_build_object(
    'ok', true,
    'snapshot_version', 2,
    'production_lineage_id', v_production_lineage_id,
    'event_certification_id', v_evt_cert.id,
    'operating_mode', v_ctrl.operating_mode,
    'runtime_mode_version', v_ctrl.runtime_mode_version,
    'configuration_version', v_ctrl.configuration_version,
    'automation_generation', v_ctrl.automation_generation,
    'resolved_at', now(),
    'snapshot', v_snapshot,
    'evidence_fingerprint_v2', v_fingerprint,
    'evidence_fingerprint_algorithm', 'sha256-v2',
    'blockers', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_comm_hub_current_evidence_snapshot(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_current_evidence_snapshot(text,text,text) TO authenticated;

-- --------------------------------------------------------------
-- 4. HISTORICAL One Real Email evidence snapshot RPC
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_comm_hub_ore_evidence_snapshot(
  p_one_real_email_certification_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_ore   RECORD;
  v_exec  RECORD;
  v_msg   RECORD;
  v_att   RECORD;
  v_prov  RECORD;
  v_ctv   RECORD;
  v_evt_cert RECORD;
  v_blockers jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
  v_template_manifest_hash text;
  v_snapshot jsonb;
  v_fingerprint text;
  v_complete text := 'COMPLETE';
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','UNAUTHENTICATED','component','actor')));
  END IF;
  SELECT has_role(v_actor, 'admin'::app_role) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','NOT_ADMIN','component','actor')));
  END IF;

  SELECT * INTO v_ore FROM communication_controlled_live_certification
  WHERE id = p_one_real_email_certification_id;
  IF v_ore.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','ORE_CERT_NOT_FOUND','component','ore_certification')));
  END IF;
  IF v_ore.certification_kind IS DISTINCT FROM 'ONE_REAL_EMAIL' THEN
    RETURN jsonb_build_object('ok', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','NOT_ONE_REAL_EMAIL','component','ore_certification',
        'detail', v_ore.certification_kind)));
  END IF;

  -- Lineage validation
  SELECT * INTO v_exec FROM communication_controlled_live_execution WHERE id = v_ore.execution_id;
  IF v_exec.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','EXECUTION_MISSING','component','controlled_live_execution');
  END IF;

  SELECT * INTO v_msg FROM communication_message WHERE id = v_ore.message_id;
  IF v_msg.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','MESSAGE_MISSING','component','communication_message');
  END IF;

  SELECT * INTO v_att FROM communication_delivery_attempt WHERE id = v_ore.delivery_attempt_id;
  IF v_att.id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','DELIVERY_ATTEMPT_MISSING','component','communication_delivery_attempt');
  ELSIF COALESCE(v_att.provider_call_attempted, false) = false THEN
    v_blockers := v_blockers || jsonb_build_object('code','PROVIDER_CALL_NOT_ATTEMPTED','component','communication_delivery_attempt');
  END IF;

  IF v_ore.provider_message_id IS NULL AND v_att.provider_message_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','PROVIDER_MESSAGE_ID_MISSING','component','delivery_attempt.provider_message_id');
  END IF;

  IF v_ore.manual_verification_status IS DISTINCT FROM 'CONFIRMED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','INBOX_NOT_CONFIRMED','component','manual_verification_status',
      'detail', v_ore.manual_verification_status);
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'snapshot_version', 2,
      'completeness_status', 'FAILED_LINEAGE',
      'production_lineage_id', v_ore.production_lineage_id,
      'blockers', v_blockers
    );
  END IF;

  -- Template manifest from the exact template version used by the message
  IF v_msg.template_version_id IS NOT NULL THEN
    SELECT * INTO v_ctv FROM core_template_version WHERE id = v_msg.template_version_id;
    IF v_ctv.id IS NOT NULL THEN
      v_template_manifest_hash := encode(extensions.digest(
        coalesce(v_ctv.subject,'') || '|' ||
        coalesce(v_ctv.body_html,'') || '|' ||
        coalesce(v_ctv.body_text,'') || '|' ||
        coalesce(v_ctv.layout_id::text,''), 'sha256'), 'hex');
    ELSE
      v_missing := v_missing || to_jsonb('template_version_manifest'::text);
      v_complete := 'INCOMPLETE';
    END IF;
  ELSE
    v_missing := v_missing || to_jsonb('template_version_id'::text);
    v_complete := 'INCOMPLETE';
  END IF;

  -- Provider used by the actual attempt (do NOT use current active provider)
  IF v_att.provider_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM notification_providers WHERE id = v_att.provider_id;
  END IF;
  IF v_prov.id IS NULL THEN
    v_missing := v_missing || to_jsonb('provider_id_historical'::text);
    v_complete := 'INCOMPLETE';
  END IF;

  -- Historical send/review/payload policy version bindings are not persisted
  -- per execution in the current schema — record them as UNAVAILABLE so the
  -- backfill correctly marks INCOMPLETE without inventing a fingerprint value.
  v_missing := v_missing
    || to_jsonb('send_policy_version_binding'::text)
    || to_jsonb('review_policy_version_binding'::text)
    || to_jsonb('payload_schema_version_binding'::text);
  IF v_complete = 'COMPLETE' THEN v_complete := 'INCOMPLETE'; END IF;

  -- Event certification for lineage cross-link
  SELECT * INTO v_evt_cert FROM communication_hub_event_certification
  WHERE one_real_email_certification_id = v_ore.id;

  v_snapshot := jsonb_build_object(
    'module_code', _comm_hub_norm_code(v_ore.module_code),
    'event_code',  _comm_hub_norm_code(v_ore.event_code),
    'channel',     _comm_hub_norm_channel(v_ore.channel),
    'template_version_id', v_msg.template_version_id,
    'template_version_no', v_ctv.version_no,
    'template_manifest_hash', v_template_manifest_hash,
    'sender_profile_id', v_msg.sender_profile_id,
    'recipient_policy_version', v_ore.recipient_policy_version,
    'recipient_set_hash', v_msg.recipient_set_hash,
    'provider_id', v_att.provider_id,
    'provider_key', v_prov.email_provider_type,
    -- Historical policy hashes intentionally omitted (not bound per execution).
    'payload_schema_hash', NULL,
    'review_policy_hash', NULL,
    'send_policy_hash', NULL
  );

  -- Only compute a v2 fingerprint when snapshot is COMPLETE.
  IF v_complete = 'COMPLETE' THEN
    v_fingerprint := _comm_hub_fingerprint_evidence_snapshot_v2(v_snapshot);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'snapshot_version', 2,
    'completeness_status', v_complete,
    'production_lineage_id', v_ore.production_lineage_id,
    'event_certification_id', v_evt_cert.id,
    'controlled_live_execution_id', v_ore.execution_id,
    'message_id', v_ore.message_id,
    'delivery_attempt_id', v_ore.delivery_attempt_id,
    'trace_id', v_ore.trace_id,
    'provider_message_id', COALESCE(v_ore.provider_message_id, v_att.provider_message_id),
    'resolved_at', now(),
    'snapshot', v_snapshot,
    'evidence_fingerprint_v2', v_fingerprint,
    'evidence_fingerprint_algorithm', CASE WHEN v_fingerprint IS NULL THEN NULL ELSE 'sha256-v2' END,
    'missing_components', v_missing,
    'blockers', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_comm_hub_ore_evidence_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_ore_evidence_snapshot(uuid) TO authenticated;

-- --------------------------------------------------------------
-- 5. Idempotent legacy backfill
--    - Assigns a stable production_lineage_id to each ORE cert (once).
--    - Persists evidence_snapshot_v2 + fingerprint (when COMPLETE) on ORE
--      and mirrors lineage onto its uniquely linked event certification.
--    - Marks INCOMPLETE when historical components are missing.
--    - Marks AMBIGUOUS_LINEAGE where >1 event_certification points at the same ORE.
--    - Never replaces an existing COMPLETE snapshot.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_comm_hub_ore_evidence_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_row RECORD;
  v_examined int := 0;
  v_complete int := 0;
  v_incomplete int := 0;
  v_ambiguous int := 0;
  v_skipped int := 0;
  v_missing jsonb;
  v_snapshot_result jsonb;
  v_lineage_id uuid;
  v_evt_cert_count int;
  v_evt_cert_id uuid;
  v_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  SELECT has_role(v_actor, 'admin'::app_role) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  FOR v_row IN
    SELECT id FROM communication_controlled_live_certification
    WHERE certification_kind = 'ONE_REAL_EMAIL'
    ORDER BY certified_at NULLS LAST
  LOOP
    v_examined := v_examined + 1;

    -- Skip if already complete and non-null
    PERFORM 1 FROM communication_controlled_live_certification
      WHERE id = v_row.id
        AND evidence_snapshot_v2 IS NOT NULL
        AND fingerprint_backfill_status = 'COMPLETE';
    IF FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Assign stable lineage id (once)
    SELECT production_lineage_id INTO v_lineage_id
    FROM communication_controlled_live_certification WHERE id = v_row.id;
    IF v_lineage_id IS NULL THEN
      v_lineage_id := gen_random_uuid();
      UPDATE communication_controlled_live_certification
        SET production_lineage_id = v_lineage_id
      WHERE id = v_row.id AND production_lineage_id IS NULL;
    END IF;

    -- Resolve snapshot
    v_snapshot_result := get_comm_hub_ore_evidence_snapshot(v_row.id);

    IF (v_snapshot_result->>'ok')::boolean IS DISTINCT FROM true THEN
      v_status := 'FAILED';
      v_incomplete := v_incomplete + 1;
      UPDATE communication_controlled_live_certification
      SET fingerprint_backfill_status = v_status,
          fingerprint_backfilled_at = now(),
          fingerprint_backfill_detail = jsonb_build_object(
            'reason','ore_snapshot_failed',
            'blockers', v_snapshot_result->'blockers'),
          evidence_fingerprint_algorithm = 'sha256-v2'
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    v_status := v_snapshot_result->>'completeness_status';
    v_missing := COALESCE(v_snapshot_result->'missing_components', '[]'::jsonb);

    UPDATE communication_controlled_live_certification
    SET evidence_snapshot_v2 = v_snapshot_result->'snapshot',
        evidence_fingerprint_v2 = CASE WHEN v_status='COMPLETE'
                                       THEN v_snapshot_result->>'evidence_fingerprint_v2'
                                       ELSE NULL END,
        evidence_fingerprint_algorithm = 'sha256-v2',
        fingerprint_backfill_status = v_status,
        fingerprint_backfilled_at = now(),
        fingerprint_backfill_detail = jsonb_build_object(
          'missing_components', v_missing,
          'production_lineage_id', v_lineage_id)
    WHERE id = v_row.id;

    IF v_status = 'COMPLETE' THEN
      v_complete := v_complete + 1;
    ELSE
      v_incomplete := v_incomplete + 1;
    END IF;

    -- Mirror to event certification if unambiguous
    SELECT count(*), MAX(id) INTO v_evt_cert_count, v_evt_cert_id
    FROM communication_hub_event_certification
    WHERE one_real_email_certification_id = v_row.id;

    IF v_evt_cert_count = 1 THEN
      UPDATE communication_hub_event_certification
      SET production_lineage_id = v_lineage_id,
          evidence_snapshot_v2 = COALESCE(evidence_snapshot_v2, v_snapshot_result->'snapshot'),
          evidence_fingerprint_v2 = CASE
            WHEN v_status='COMPLETE' AND (evidence_fingerprint_v2 IS NULL)
              THEN v_snapshot_result->>'evidence_fingerprint_v2'
            ELSE evidence_fingerprint_v2 END,
          evidence_fingerprint_algorithm = COALESCE(evidence_fingerprint_algorithm,'sha256-v2'),
          fingerprint_backfill_status = COALESCE(fingerprint_backfill_status, v_status),
          fingerprint_backfilled_at = COALESCE(fingerprint_backfilled_at, now()),
          fingerprint_backfill_detail = COALESCE(fingerprint_backfill_detail,
            jsonb_build_object('missing_components', v_missing,
                               'production_lineage_id', v_lineage_id))
      WHERE id = v_evt_cert_id
        AND (production_lineage_id IS NULL OR production_lineage_id = v_lineage_id);
    ELSIF v_evt_cert_count > 1 THEN
      v_ambiguous := v_ambiguous + 1;
      UPDATE communication_controlled_live_certification
      SET fingerprint_backfill_detail = COALESCE(fingerprint_backfill_detail, '{}'::jsonb)
                                        || jsonb_build_object('event_cert_lineage','AMBIGUOUS_LINEAGE',
                                                              'event_cert_count', v_evt_cert_count)
      WHERE id = v_row.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'examined', v_examined,
    'complete', v_complete,
    'incomplete', v_incomplete,
    'ambiguous_lineage', v_ambiguous,
    'skipped_already_complete', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_comm_hub_ore_evidence_snapshots() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_comm_hub_ore_evidence_snapshots() TO authenticated;
