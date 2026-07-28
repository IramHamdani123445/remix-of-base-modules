-- ============================================================================
-- Omni-Comms — Story 2 corrective hotfix
-- Replace public.omni_comms_template_version_publish(uuid, text, text)
-- with a 5-argument variant that enforces optimistic concurrency and
-- explicit replacement confirmation. Drop the obsolete overload.
-- ============================================================================

-- 1. Drop the obsolete 3-argument overload so it cannot bypass new controls.
DROP FUNCTION IF EXISTS public.omni_comms_template_version_publish(uuid, text, text);

-- 2. Create the hardened 5-argument publication RPC.
CREATE OR REPLACE FUNCTION public.omni_comms_template_version_publish(
  p_id                   uuid,
  p_expected_updated_at  timestamptz,
  p_confirm_replacement  boolean,
  p_replacement_reason   text,
  p_correlation_id       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid          uuid;
  v_reason       text;
  v_before       public.omni_comms_template_version;
  v_after        public.omni_comms_template_version;
  v_family       public.omni_comms_template_family;
  v_prev         public.omni_comms_template_version;
  v_replaced_id  uuid;
  v_confirm      boolean := COALESCE(p_confirm_replacement, false);
BEGIN
  -- Capability + actor.
  v_uid := public.omni_comms_priv_require_capability('approve_templates');

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'expected_updated_at_required';
  END IF;

  -- Step 1 — resolve family from target row (unlocked read to identify),
  -- then lock family first to establish deterministic lock order.
  SELECT * INTO v_before
    FROM public.omni_comms_template_version
   WHERE id = p_id;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found'
      USING ERRCODE = 'P0001', DETAIL = 'template_version_not_found';
  END IF;

  PERFORM 1 FROM public.omni_comms_template_family
    WHERE id = v_before.template_family_id FOR UPDATE;
  SELECT * INTO v_family
    FROM public.omni_comms_template_family
   WHERE id = v_before.template_family_id;

  -- Step 2 — lock the target approved version.
  SELECT * INTO v_before
    FROM public.omni_comms_template_version
   WHERE id = p_id FOR UPDATE;

  -- Step 3 — optimistic-concurrency guard on the target version.
  IF p_expected_updated_at IS DISTINCT FROM v_before.updated_at THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'updated_at_mismatch';
  END IF;

  IF v_before.status <> 'approved' THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'version_not_approved';
  END IF;

  -- Step 4 — lock any currently published sibling for exact (family, channel, locale).
  SELECT * INTO v_prev
    FROM public.omni_comms_template_version
   WHERE template_family_id = v_before.template_family_id
     AND channel = v_before.channel
     AND locale  = v_before.locale
     AND status  = 'published'
   FOR UPDATE;

  IF v_prev.id IS NOT NULL AND v_prev.id = v_before.id THEN
    -- The target itself is already the published row.
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'already_published';
  END IF;

  -- Step 5 — apply initial-publication, conflict, or replacement policy.
  IF v_prev.id IS NULL THEN
    -- No existing published version.
    IF v_confirm THEN
      RAISE EXCEPTION 'OC422 validation_error'
        USING ERRCODE = 'P0001', DETAIL = 'replacement_not_applicable';
    END IF;
    v_reason := NULL;  -- reason not accepted on initial publication
    v_replaced_id := NULL;
  ELSE
    -- Existing published version present.
    IF NOT v_confirm THEN
      RAISE EXCEPTION 'OC409 conflict'
        USING ERRCODE = 'P0001', DETAIL = 'replacement_confirmation_required';
    END IF;
    -- Confirmed replacement — require a non-blank reason, then apply length rule.
    IF btrim(COALESCE(p_replacement_reason, '')) = '' THEN
      RAISE EXCEPTION 'OC422 validation_error'
        USING ERRCODE = 'P0001', DETAIL = 'replacement_reason_required';
    END IF;
    -- Length + trim via the shared normalizer (raises reason_too_long / reason_required).
    v_reason := public.omni_comms_priv_normalize_reason(p_replacement_reason, true);

    -- Retire the existing published version.
    UPDATE public.omni_comms_template_version
       SET status            = 'retired',
           retired_at        = now(),
           retired_by        = v_uid,
           retirement_reason = v_reason,
           updated_at        = now(),
           updated_by        = v_uid
     WHERE id = v_prev.id;
    v_replaced_id := v_prev.id;

    PERFORM public.omni_comms_priv_write_template_audit(
      v_uid, 'retire', 'template_version', v_prev.id,
      v_family.code || ':' || v_prev.channel || ':' || v_prev.locale || ':v' || v_prev.version_number,
      jsonb_build_object('status', v_prev.status),
      jsonb_build_object('status', 'retired', 'replaced_by', v_before.id),
      v_reason, NULL, p_correlation_id
    );
  END IF;

  -- Step 6 — publish the target and write its audit row.
  UPDATE public.omni_comms_template_version
     SET status        = 'published',
         published_at  = now(),
         published_by  = v_uid,
         updated_at    = now(),
         updated_by    = v_uid
   WHERE id = p_id
   RETURNING * INTO v_after;

  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'publish', 'template_version', p_id,
    v_family.code || ':' || v_after.channel || ':' || v_after.locale || ':v' || v_after.version_number,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'replaced', v_replaced_id),
    v_reason, NULL, p_correlation_id
  );

  RETURN jsonb_build_object(
    'id', v_after.id,
    'status', v_after.status,
    'published_at', v_after.published_at,
    'replaced_version_id', v_replaced_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 conflict'
      USING ERRCODE = 'P0001', DETAIL = 'publication_conflict';
END;
$$;

ALTER FUNCTION public.omni_comms_template_version_publish(uuid, timestamptz, boolean, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_publish(uuid, timestamptz, boolean, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_publish(uuid, timestamptz, boolean, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.omni_comms_template_version_publish(uuid, timestamptz, boolean, text, text) IS
  'Omni-Comms Story 2 hotfix — publishes an approved template version. Enforces optimistic concurrency via p_expected_updated_at and explicit replacement via p_confirm_replacement + p_replacement_reason. Replaces the obsolete 3-argument overload.';
