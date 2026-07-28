-- =============================================================================
-- Rollback: Epic 3 — Story 2 Publish RPC hardening hotfix
--
-- Restores the pre-hotfix publish RPC signature and body verbatim from
-- migration 20260728134956_15a7f095-7b69-46a6-bb47-42153a0d37c4.sql
-- (lines 751–823). Use only under change control if the 5-arg signature
-- must be reverted. The adapter (templateCatalogueService.ts) and error
-- slugs (templateCatalogueErrors.ts) must be reverted in the same
-- deploy — see the "Adapter/error-slug reverts" note at the bottom of
-- this file.
--
-- IMPORTANT: Story 3 UI relies on the 5-arg signature. Executing this
-- rollback will break the Templates page publish/replace flow until the
-- adapter and UI are rolled back to the pre-hotfix contract as well.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.omni_comms_template_version_publish(
  uuid, timestamptz, boolean, text, text
);

CREATE OR REPLACE FUNCTION public.omni_comms_template_version_publish(
  p_id uuid, p_reason text, p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid; v_reason text;
  v_before public.omni_comms_template_version;
  v_after  public.omni_comms_template_version;
  v_family public.omni_comms_template_family;
  v_prev   public.omni_comms_template_version;
  v_replaced_id uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('approve_templates');
  v_reason := public.omni_comms_priv_normalize_reason(p_reason, false);
  -- Read the version briefly to identify family, then lock family row first
  SELECT * INTO v_before FROM public.omni_comms_template_version WHERE id = p_id;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found';
  END IF;
  PERFORM 1 FROM public.omni_comms_template_family WHERE id = v_before.template_family_id FOR UPDATE;
  SELECT * INTO v_family FROM public.omni_comms_template_family WHERE id = v_before.template_family_id;
  -- Re-read version under family lock, then take its row lock
  SELECT * INTO v_before FROM public.omni_comms_template_version WHERE id = p_id FOR UPDATE;
  IF v_before.status <> 'approved' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='version_not_approved';
  END IF;
  -- Lock existing published (if any) for exact (family, channel, locale)
  SELECT * INTO v_prev
    FROM public.omni_comms_template_version
   WHERE template_family_id = v_before.template_family_id
     AND channel = v_before.channel
     AND locale  = v_before.locale
     AND status  = 'published'
   FOR UPDATE;
  IF v_prev.id IS NOT NULL AND v_prev.id = v_before.id THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='already_published';
  END IF;
  IF v_prev.id IS NOT NULL THEN
    UPDATE public.omni_comms_template_version
       SET status='retired', retired_at=now(), retired_by=v_uid,
           retirement_reason=COALESCE(v_reason, 'replaced_by_new_publication'),
           updated_at=now(), updated_by=v_uid
     WHERE id = v_prev.id;
    v_replaced_id := v_prev.id;
    PERFORM public.omni_comms_priv_write_template_audit(
      v_uid, 'retire', 'template_version', v_prev.id,
      v_family.code || ':' || v_prev.channel || ':' || v_prev.locale || ':v' || v_prev.version_number,
      jsonb_build_object('status', v_prev.status),
      jsonb_build_object('status', 'retired', 'replaced_by', v_before.id),
      COALESCE(v_reason, 'replaced_by_new_publication'), NULL, p_correlation_id);
  END IF;
  UPDATE public.omni_comms_template_version
     SET status='published', published_at=now(), published_by=v_uid,
         updated_at=now(), updated_by=v_uid
   WHERE id = p_id RETURNING * INTO v_after;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'publish', 'template_version', p_id,
    v_family.code || ':' || v_after.channel || ':' || v_after.locale || ':v' || v_after.version_number,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'replaced', v_replaced_id),
    v_reason, NULL, p_correlation_id);
  RETURN jsonb_build_object('id', v_after.id, 'status', v_after.status,
    'published_at', v_after.published_at, 'replaced_version_id', v_replaced_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'OC409 duplicate_publication' USING ERRCODE='P0001', DETAIL='publication_conflict';
END; $$;

ALTER FUNCTION public.omni_comms_template_version_publish(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.omni_comms_template_version_publish(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_publish(uuid, text, text) TO authenticated;

COMMIT;

-- =============================================================================
-- Adapter / error-slug reverts (application repo):
--   1. src/platform/omni-comms/application/templateCatalogueService.ts —
--      restore publishTemplateVersion({ id, reason?, correlationId? }) mapping
--      to p_reason (drop expectedUpdatedAt / confirmReplacement /
--      replacementReason).
--   2. src/platform/omni-comms/application/templateCatalogueErrors.ts —
--      remove the four hotfix slugs:
--        expected_updated_at_required
--        replacement_confirmation_required
--        replacement_reason_required
--        replacement_not_applicable
--   3. src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx —
--      restore the legacy publish dialog (no concurrency, no confirmation).
-- =============================================================================
