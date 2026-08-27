GRANT SELECT, INSERT, UPDATE, DELETE ON public.ce_case_requests TO authenticated;
GRANT SELECT ON public.ce_case_requests TO anon;
GRANT ALL ON public.ce_case_requests TO service_role;