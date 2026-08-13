-- 1. Effective channels: strict organisation/department scope semantics.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_effective_channels(
  p_organization_id uuid, p_department_id uuid, p_event_code text, p_product_id uuid DEFAULT NULL::uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT id FROM public.omni_comms_event_definition
    WHERE code = btrim(coalesce(p_event_code, ''))
  ),
  routes AS (
    SELECT DISTINCT lower(btrim(r.channel)) AS channel
    FROM public.omni_comms_event_route r
    JOIN ev ON ev.id = r.event_definition_id
    WHERE r.organization_id = p_organization_id
      AND r.is_enabled IS TRUE
      AND coalesce(r.lifecycle_state, 'active') = 'active'
      AND CASE
            WHEN p_department_id IS NULL THEN r.department_id IS NULL
            ELSE (r.department_id IS NULL OR r.department_id = p_department_id)
          END
  ),
  product_off AS (
    SELECT DISTINCT lower(btrim(c.channel)) AS channel
    FROM public.omni_comms_product_communication_config c
    WHERE p_product_id IS NOT NULL
      AND c.organization_id = p_organization_id
      AND c.product_id = p_product_id
      AND upper(btrim(coalesce(c.event_code, ''))) = upper(btrim(coalesce(p_event_code, '')))
      AND c.is_enabled IS NOT TRUE
  ),
  channel_on AS (
    SELECT DISTINCT lower(btrim(s.channel)) AS channel
    FROM public.omni_comms_channel_setting s
    WHERE s.organization_id = p_organization_id
      AND s.enabled IS TRUE
      AND CASE
            WHEN p_department_id IS NULL THEN s.department_id IS NULL
            ELSE (s.department_id IS NULL OR s.department_id = p_department_id)
          END
  ),
  implemented AS (
    -- Adapter capability truth, not a hard-coded channel list. Today this
    -- resolves to Email; a genuinely implemented future adapter becomes
    -- eligible through configuration with no business-module change.
    SELECT DISTINCT lower(btrim(p.channel)) AS channel
    FROM public.omni_comms_provider p
    WHERE p.status = 'active'
      AND coalesce(btrim(p.adapter_key), '') <> ''
  )
  SELECT coalesce(array_agg(c.channel ORDER BY c.channel), ARRAY[]::text[])
  FROM routes c
  WHERE c.channel IN (SELECT channel FROM channel_on)
    AND c.channel NOT IN (SELECT channel FROM product_off)
    AND c.channel IN (SELECT channel FROM implemented);
$function$;

-- 2. Runtime resolution snapshot: identical strict scope semantics.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_runtime_resolution_snapshot(
  p_actor_id uuid, p_organization_id uuid, p_department_id uuid,
  p_event_code text, p_requested_channels text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_normalized_code text := btrim(coalesce(p_event_code,''));
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 organization_required' USING ERRCODE='P0001';
  END IF;
  IF v_normalized_code = '' OR length(v_normalized_code) > 128 THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  WITH
    ev AS (
      SELECT id, code, status, module_code, entity_type, communication_class,
             default_priority
      FROM public.omni_comms_event_definition
      WHERE code = v_normalized_code
    ),
    contracts AS (
      SELECT c.id, c.event_definition_id, c.version_number, c.checksum,
             c.status, c.json_schema, c.published_at
      FROM public.omni_comms_event_contract c
      WHERE c.event_definition_id IN (SELECT id FROM ev)
        AND c.status = 'published'
    ),
    routes AS (
      SELECT r.id, r.organization_id, r.department_id, r.event_definition_id,
             r.channel, r.is_required, r.is_enabled, r.priority,
             r.template_family_id, r.sender_identity_id,
             r.sender_resolution_policy, r.preference_policy,
             r.lifecycle_state, r.created_at
      FROM public.omni_comms_event_route r
      WHERE r.event_definition_id IN (SELECT id FROM ev)
        AND r.organization_id = p_organization_id
        AND r.is_enabled = true
        AND r.lifecycle_state = 'active'
        AND CASE
              WHEN p_department_id IS NULL THEN r.department_id IS NULL
              ELSE (r.department_id IS NULL OR r.department_id = p_department_id)
            END
    ),
    routes_ranked AS (
      SELECT r.*,
        ROW_NUMBER() OVER (
          PARTITION BY channel
          ORDER BY
            CASE WHEN r.department_id IS NOT NULL AND r.department_id = p_department_id
                 THEN 0 WHEN r.department_id IS NULL THEN 1 ELSE 2 END,
            r.priority ASC,
            r.created_at DESC,
            r.id
        ) AS rk
      FROM routes r
    ),
    winning_routes AS (
      SELECT * FROM routes_ranked WHERE rk = 1
    ),
    filtered_routes AS (
      SELECT wr.*
      FROM winning_routes wr
      WHERE coalesce(array_length(p_requested_channels,1),0) = 0
         OR wr.channel = ANY(p_requested_channels)
    ),
    channel_settings AS (
      SELECT cs.id, cs.organization_id, cs.department_id, cs.channel,
             cs.enabled, cs.live_delivery_enabled
      FROM public.omni_comms_channel_setting cs
      WHERE cs.organization_id = p_organization_id
        AND CASE
              WHEN p_department_id IS NULL THEN cs.department_id IS NULL
              ELSE (cs.department_id IS NULL OR cs.department_id = p_department_id)
            END
    ),
    template_families AS (
      SELECT tf.id, tf.code, tf.scope_type, tf.organization_id,
             tf.department_id, tf.event_definition_id, tf.status
      FROM public.omni_comms_template_family tf
      WHERE tf.organization_id = p_organization_id
        AND tf.status = 'active'
        AND CASE
              WHEN p_department_id IS NULL THEN tf.department_id IS NULL
              ELSE (tf.department_id IS NULL OR tf.department_id = p_department_id)
            END
        AND (tf.event_definition_id IS NULL
             OR tf.event_definition_id IN (SELECT id FROM ev))
    ),
    template_versions AS (
      SELECT tv.id, tv.template_family_id, tv.version_number, tv.channel,
             tv.locale, tv.content, tv.checksum, tv.status,
             tv.layout_selection_mode, tv.layout_id, tv.pinned_layout_version_id
      FROM public.omni_comms_template_version tv
      WHERE tv.status = 'published'
        AND tv.template_family_id IN (SELECT id FROM template_families)
    ),
    layouts AS (
      SELECT l.id, l.code, l.name, l.is_active, l.layout_kind
      FROM public.core_template_layout l
      WHERE l.is_active = true
    ),
    layout_versions AS (
      SELECT lv.id, lv.layout_id, lv.version_number, lv.slots,
             lv.wrapper_html, lv.checksum, lv.status
      FROM public.core_template_layout_version lv
      WHERE lv.status = 'published'
    ),
    layout_assignments AS (
      SELECT ca.id, ca.organization_id, ca.department_id, ca.output_channel,
             ca.layout_id
      FROM public.core_comm_assignment ca
      WHERE ca.assignment_kind = 'layout_default'
        AND ca.organization_id = p_organization_id
        AND CASE
              WHEN p_department_id IS NULL THEN ca.department_id IS NULL
              ELSE (ca.department_id IS NULL OR ca.department_id = p_department_id)
            END
    ),
    asset_assignments AS (
      SELECT ca.id, ca.organization_id, ca.department_id, ca.output_channel,
             ca.slot_code, ca.asset_id
      FROM public.core_comm_assignment ca
      WHERE ca.assignment_kind = 'asset_slot'
        AND ca.organization_id = p_organization_id
        AND CASE
              WHEN p_department_id IS NULL THEN ca.department_id IS NULL
              ELSE (ca.department_id IS NULL OR ca.department_id = p_department_id)
            END
    ),
    assets AS (
      SELECT a.id, a.organization_id, a.department_id, a.asset_type,
             a.code, a.status, a.active_version_id
      FROM public.core_comm_asset a
      WHERE a.organization_id = p_organization_id
        AND a.status = 'active'
    ),
    asset_versions AS (
      SELECT av.id, av.asset_id, av.version_number, av.checksum, av.status,
             av.content_html, av.content_text, av.content_json,
             av.storage_bucket, av.storage_object_path
      FROM public.core_comm_asset_version av
      WHERE av.status = 'published'
        AND av.asset_id IN (SELECT id FROM assets)
    ),
    senders AS (
      SELECT s.id, s.organization_id, s.department_id, s.event_definition_id,
             s.code, s.channel, s.from_address, s.from_name,
             s.reply_to_address, s.status
      FROM public.omni_comms_sender_identity s
      WHERE s.organization_id = p_organization_id
        AND s.status = 'active'
        AND CASE
              WHEN p_department_id IS NULL THEN s.department_id IS NULL
              ELSE (s.department_id IS NULL OR s.department_id = p_department_id)
            END
        AND (s.event_definition_id IS NULL
             OR s.event_definition_id IN (SELECT id FROM ev))
    ),
    bindings AS (
      SELECT b.id, b.sender_identity_id, b.provider_account_id, b.priority,
             b.verification_status, b.status
      FROM public.omni_comms_sender_provider_binding b
      WHERE b.status = 'active'
        AND b.sender_identity_id IN (SELECT id FROM senders)
    ),
    provider_accounts AS (
      SELECT pa.id, pa.organization_id, pa.provider_id, pa.code, pa.status,
             pa.health_state, pa.sandbox_mode,
             (pa.secret_ref IS NOT NULL AND length(pa.secret_ref) > 0)
               AS secret_reference_configured
      FROM public.omni_comms_provider_account pa
      WHERE pa.organization_id = p_organization_id
        AND pa.status = 'active'
        AND pa.id IN (SELECT provider_account_id FROM bindings)
    ),
    providers AS (
      SELECT p.id, p.code, p.display_name, p.channel, p.adapter_key, p.status
      FROM public.omni_comms_provider p
      WHERE p.status = 'active'
        AND p.id IN (SELECT provider_id FROM provider_accounts)
    )
  SELECT jsonb_build_object(
    'snapshot_at',        now(),
    'organization_id',    p_organization_id,
    'department_id',      p_department_id,
    'requested_channels', coalesce(to_jsonb(p_requested_channels), '[]'::jsonb),
    'event',              (SELECT to_jsonb(ev.*) FROM ev),
    'event_contracts',
      coalesce((SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.version_number DESC)
                  FROM contracts c), '[]'::jsonb),
    'routes',
      coalesce((SELECT jsonb_agg(to_jsonb(fr.*) ORDER BY fr.channel)
                  FROM filtered_routes fr), '[]'::jsonb),
    'channel_settings',
      coalesce((SELECT jsonb_agg(to_jsonb(cs.*)) FROM channel_settings cs), '[]'::jsonb),
    'template_families',
      coalesce((SELECT jsonb_agg(to_jsonb(tf.*)) FROM template_families tf), '[]'::jsonb),
    'template_versions',
      coalesce((SELECT jsonb_agg(to_jsonb(tv.*)) FROM template_versions tv), '[]'::jsonb),
    'layouts',
      coalesce((SELECT jsonb_agg(to_jsonb(l.*)) FROM layouts l), '[]'::jsonb),
    'layout_versions',
      coalesce((SELECT jsonb_agg(to_jsonb(lv.*)) FROM layout_versions lv), '[]'::jsonb),
    'layout_assignments',
      coalesce((SELECT jsonb_agg(to_jsonb(la.*)) FROM layout_assignments la), '[]'::jsonb),
    'asset_assignments',
      coalesce((SELECT jsonb_agg(to_jsonb(aa.*)) FROM asset_assignments aa), '[]'::jsonb),
    'assets',
      coalesce((SELECT jsonb_agg(to_jsonb(a.*)) FROM assets a), '[]'::jsonb),
    'asset_versions',
      coalesce((SELECT jsonb_agg(to_jsonb(av.*)) FROM asset_versions av), '[]'::jsonb),
    'senders',
      coalesce((SELECT jsonb_agg(to_jsonb(s.*)) FROM senders s), '[]'::jsonb),
    'bindings',
      coalesce((SELECT jsonb_agg(to_jsonb(b.*)) FROM bindings b), '[]'::jsonb),
    'providers',
      coalesce((SELECT jsonb_agg(to_jsonb(p.*)) FROM providers p), '[]'::jsonb),
    'provider_accounts',
      coalesce((SELECT jsonb_agg(to_jsonb(pa.*)) FROM provider_accounts pa), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END
$function$;

-- 3. Bounded, audited reconciliation of business-event handoff metadata.
--    The outbox answers only "did the event hand off to Omni-Comms?". When a
--    durable request already exists for the row, the handoff is complete.
--    This creates NO request, NO message, NO job and sends nothing.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_reconcile_business_event_handoff(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.omni_comms_business_event_outbox;
  v_req_id uuid;
  v_req_org uuid;
  v_req_key text;
BEGIN
  SELECT * INTO v_row FROM public.omni_comms_business_event_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 business_event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status = 'processed' THEN
    RETURN jsonb_build_object('status', 'processed', 'changed', false);
  END IF;
  IF v_row.status NOT IN ('blocked', 'needs_review') THEN
    RAISE EXCEPTION 'OC422 business_event_not_reconcilable' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.request_id IS NULL THEN
    RAISE EXCEPTION 'OC422 business_event_has_no_request' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id, r.organization_id, r.idempotency_key
    INTO v_req_id, v_req_org, v_req_key
  FROM public.omni_comms_request r
  WHERE r.id = v_row.request_id;

  IF v_req_id IS NULL THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_req_org IS DISTINCT FROM v_row.organization_id
     OR coalesce(v_req_key, '') IS DISTINCT FROM coalesce(v_row.idempotency_key, '') THEN
    RAISE EXCEPTION 'OC409 business_event_request_mismatch' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.omni_comms_business_event_outbox
     SET status = 'processed',
         result_code = 'communication_requested',
         blocker_code = NULL,
         processed_at = coalesce(processed_at, now()),
         updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('status', 'processed', 'changed', true,
                            'request_id', v_req_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reconcile_business_event_handoff(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_reconcile_business_event_handoff(uuid) TO service_role;