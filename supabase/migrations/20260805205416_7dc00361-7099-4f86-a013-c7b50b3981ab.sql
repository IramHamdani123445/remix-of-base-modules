INSERT INTO public.bn_policy_area (code, display_name, description, sort_order, is_active)
SELECT 'award_suspension', 'Award Suspension Approvals',
       'Approval routing for award suspension and reinstatement cases', 110, true
WHERE NOT EXISTS (SELECT 1 FROM public.bn_policy_area WHERE code = 'award_suspension');

ALTER FUNCTION public.bn_award_reinstatement_approve_v1(uuid,uuid,text,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_reinstatement_execute_v1(uuid,integer,text,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_reinstatement_propose_v1(uuid,text,date,text,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_reinstatement_reject_v1(uuid,uuid,text,text,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_reinstatement_withdraw_v1(uuid,text,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_suspension_approve_v1(uuid,uuid,text,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_suspension_execute_scheduled_v1(uuid,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_suspension_execute_v1(uuid,integer,text,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_suspension_propose_v1(uuid,text,date,text,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_award_suspension_withdraw_v1(uuid,text,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_defer_v1(uuid,text,text,date,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_escalate_to_suspension_v1(uuid,text,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_generate_obligations_v1(text,date,integer,boolean,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_mark_milestone_v1(uuid,text,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_propose_reinstatement_v1(uuid,text,date,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_receive_v1(uuid,date,uuid,text,text,date,text,text,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_reject_v1(uuid,text,text,date,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_request_resubmission_v1(uuid,text,date,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_verify_v1(uuid,text,jsonb,integer,text,text) SET search_path = public, extensions;
ALTER FUNCTION public.bn_life_certificate_waive_v1(uuid,text,text,date,date,integer,text,text) SET search_path = public, extensions;