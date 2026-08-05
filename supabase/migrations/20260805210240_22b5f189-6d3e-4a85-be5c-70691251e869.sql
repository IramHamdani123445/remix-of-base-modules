INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
SELECT m.id, 'withdraw', 'Withdraw Suspension Proposal',
       'Retract a suspension proposal you raised, before approval', true
  FROM public.app_modules m
 WHERE m.name = 'bn_award_suspension'
   AND NOT EXISTS (
     SELECT 1 FROM public.module_actions ma
      WHERE ma.module_id = m.id AND ma.action_name = 'withdraw');