REVOKE EXECUTE ON FUNCTION public.ce_employer_statement_register_v1(date, jsonb, text, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ce_employer_statement_register_v1(date, jsonb, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ce_employer_statement_register_v1(date, jsonb, text, text, integer, integer) TO authenticated;