
-- Epic 3 Story 4 corrective hardening
-- Remove default PUBLIC EXECUTE from six private template helpers so anon/authenticated
-- browser sessions cannot bypass the 14 public RPC surface.

REVOKE ALL ON FUNCTION public.omni_comms_priv_compute_template_checksum(text, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_compute_template_checksum(text, integer, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_compute_template_checksum(text, integer, text, text, jsonb) FROM authenticated;

REVOKE ALL ON FUNCTION public.omni_comms_priv_extract_tokens(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_extract_tokens(text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_extract_tokens(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_locale(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_locale(text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_normalize_locale(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_channel_content(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_channel_content(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_validate_channel_content(text, jsonb) FROM authenticated;

REVOKE ALL ON FUNCTION public.omni_comms_priv_verify_department_ownership(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_verify_department_ownership(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_verify_department_ownership(uuid, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.omni_comms_priv_write_template_audit(uuid, text, text, uuid, text, jsonb, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_write_template_audit(uuid, text, text, uuid, text, jsonb, jsonb, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_write_template_audit(uuid, text, text, uuid, text, jsonb, jsonb, text, text, text) FROM authenticated;
