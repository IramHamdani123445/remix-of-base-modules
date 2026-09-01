REVOKE EXECUTE ON FUNCTION public.ia_comms_plan_recipient_fact(public.ia_annual_plans) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ia_annual_plans_comms_trg() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ia_action_extensions_comms_trg() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ia_action_progress_comms_trg() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ia_findings_severity_comms_trg() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ia_document_requests_fulfilled_comms_trg() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ia_plan_carry_forward_comms_trg() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ia_engagement_fieldwork_comms_trg() FROM PUBLIC, anon, authenticated;