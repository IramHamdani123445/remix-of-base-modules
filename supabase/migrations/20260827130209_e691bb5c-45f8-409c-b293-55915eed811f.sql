INSERT INTO public.app_modules (name, display_name, description, icon, parent_id, route, show_in_menu, is_enabled, sort_order)
SELECT 'audit_action_centre', 'Action Centre',
       'Unified audit work queues, corrective actions, follow-up and closure readiness',
       'ListChecks', '5f9aae4c-530a-4182-a8c2-1fb603ed9661', '/audit/action-centre', true, true, 23
WHERE NOT EXISTS (SELECT 1 FROM public.app_modules WHERE route = '/audit/action-centre');

UPDATE public.app_modules
   SET route = '/audit/action-centre?tab=register', show_in_menu = false
 WHERE route = '/audit/actions';

UPDATE public.app_modules
   SET route = '/audit/action-centre?tab=followup', show_in_menu = false
 WHERE route = '/audit/follow-up-tracker';