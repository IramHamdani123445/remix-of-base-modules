REVOKE ALL ON TABLE public.bn_award_suspension_event FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.bn_award_suspension_payment_impact FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLE public.bn_award_suspension_event FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLE public.bn_award_suspension_payment_impact FROM authenticated;
GRANT SELECT ON TABLE public.bn_award_suspension_event TO authenticated;
GRANT SELECT ON TABLE public.bn_award_suspension_payment_impact TO authenticated;
GRANT ALL ON TABLE public.bn_award_suspension_event TO service_role;
GRANT ALL ON TABLE public.bn_award_suspension_payment_impact TO service_role;

ALTER FUNCTION public._bn_susp_safe_code(text,text) SET search_path = public;