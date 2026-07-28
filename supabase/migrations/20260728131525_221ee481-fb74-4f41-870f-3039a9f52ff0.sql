-- Epic 2 — Story 4 hardening.
-- Verified defect (Story 4 introspection): anon holds EXECUTE on every
-- omni_comms_* function and authenticated holds EXECUTE on the private
-- omni_comms_priv_* helpers. Capability enforcement inside RPCs still
-- denies anon, but per Epic 2 acceptance criteria neither role should
-- hold direct EXECUTE. This migration corrects grants only.

-- 1. Revoke EXECUTE from anon on every omni_comms_* function.
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_definition_create(text, text, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_definition_update_draft(uuid, timestamptz, text, text, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_definition_activate(uuid, timestamptz, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_definition_suspend(uuid, timestamptz, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_definition_retire(uuid, timestamptz, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_definition_list(integer, integer, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_definition_get(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_contract_create(uuid, integer, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_contract_update_draft(uuid, timestamptz, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_contract_publish(uuid, timestamptz, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_contract_retire(uuid, timestamptz, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_contract_list(uuid, integer, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_event_contract_get(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_compute_checksum(text, integer, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_escape_ilike(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_normalize_reason(text, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_reject_nonlocal_refs(jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_require_capability(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_validate_schema(jsonb, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_write_audit(uuid, text, text, uuid, text, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_write_lifecycle_audit(uuid, text, text, uuid, text, jsonb, jsonb, text, text) FROM anon, authenticated;

-- 2. Re-assert the intended positive grant on the 13 public RPCs.
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_create(text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_update_draft(uuid, timestamptz, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_activate(uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_suspend(uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_retire(uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_list(integer, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_definition_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_create(uuid, integer, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_update_draft(uuid, timestamptz, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_publish(uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_retire(uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_list(uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_event_contract_get(uuid) TO authenticated;