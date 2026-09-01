CREATE OR REPLACE FUNCTION public.ia_cmd_guard_elevated(_module text, _action text, _engagement uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.ia_is_ia_user()
     AND (_engagement IS NULL OR public.ia_can_access_engagement(_engagement))
     AND (
          public.ia_can_read_all()
       OR public.ia_actor_can(_module, _action)
       OR public.ia_actor_can('internal_audit', _action)
       OR EXISTS (SELECT 1 FROM public.ia_audit_engagements e
                   WHERE e.id = _engagement
                     AND (e.lead_auditor_id::text = public.ia_current_auditor_id()::text
                       OR e.reviewer_id::text = public.ia_current_auditor_id()::text))
       -- Quality reviewers may only exercise quality-review authority (DEF-S1B-35)
       OR (_module = 'quality_review'
           AND EXISTS (SELECT 1 FROM public.ia_quality_reviews q
                        WHERE q.engagement_id = _engagement
                          AND q.reviewer_id::text = public.ia_current_auditor_id()::text))
     );
$function$;