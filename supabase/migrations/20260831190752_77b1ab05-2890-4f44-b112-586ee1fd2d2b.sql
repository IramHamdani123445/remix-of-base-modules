REVOKE EXECUTE ON FUNCTION public.ce_field_ops_scope(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_field_operations_register_v1(jsonb, text, text, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_field_operations_facets_v1() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_field_visit_detail_v1(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_field_visit_check_in_v1(uuid, text, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_field_visit_check_out_v1(uuid, text, text, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ce_field_visit_add_evidence_v1(uuid, text, text, text, bigint, text, numeric, numeric) FROM PUBLIC, anon;