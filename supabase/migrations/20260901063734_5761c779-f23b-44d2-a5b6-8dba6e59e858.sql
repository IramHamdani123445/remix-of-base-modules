REVOKE SELECT ON public.ce_v_legal_recommendation_register FROM authenticated;
ALTER VIEW public.ce_v_legal_recommendation_register SET (security_invoker = off);