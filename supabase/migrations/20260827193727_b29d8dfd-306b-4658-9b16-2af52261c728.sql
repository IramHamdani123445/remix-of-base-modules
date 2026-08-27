REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_attach_request_attachments(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_resolve_message_attachments(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_resolve_request_attachments(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_attachment_manifest(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.omni_comms_register_attachment(uuid,text,text,text,text,text,text,text,bigint,text,text,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.omni_comms_attachment_evidence(uuid) FROM PUBLIC, anon;