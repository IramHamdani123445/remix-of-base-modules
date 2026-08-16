INSERT INTO public.omni_comms_channel_setting
  (organization_id, department_id, channel, enabled, operational_state, data_origin,
   max_recipients_per_request, per_day_limit)
SELECT '69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, 'print', true, 'test_only', 'system_seed', 10, 100
WHERE NOT EXISTS (
  SELECT 1 FROM public.omni_comms_channel_setting
   WHERE organization_id='69afc88b-da5c-4f41-a1e7-199e1ee1d416'
     AND department_id IS NULL AND channel='print');

DO $$
DECLARE v_ed uuid; v_si uuid; v_route uuid;
BEGIN
  SELECT id INTO v_ed FROM public.omni_comms_event_definition
   WHERE code='BENEFITS.CLAIM.SUBMITTED' AND status='active';
  SELECT id INTO v_si FROM public.omni_comms_sender_identity
   WHERE organization_id='69afc88b-da5c-4f41-a1e7-199e1ee1d416'
     AND channel='print' AND status='active' ORDER BY created_at LIMIT 1;

  IF v_ed IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.omni_comms_event_route
     WHERE organization_id='69afc88b-da5c-4f41-a1e7-199e1ee1d416'
       AND channel='print' AND event_definition_id=v_ed) THEN
    INSERT INTO public.omni_comms_event_route
      (organization_id, department_id, channel, event_definition_id, template_family_id,
       sender_identity_id, sender_resolution_policy, is_enabled, lifecycle_state, priority)
    VALUES ('69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, 'print', v_ed,
            '41e68a2c-bcd9-4f35-a3c5-d2b8f7433260', v_si,
            CASE WHEN v_si IS NULL THEN 'resolved_default' ELSE 'explicit' END,
            true, 'draft', 100)
    RETURNING id INTO v_route;

    UPDATE public.omni_comms_event_route
       SET lifecycle_state='active', activated_at=now()
     WHERE id=v_route;
  END IF;
END $$;

UPDATE public.omni_comms_channel_release_control
   SET permitted_event_codes = ARRAY['BENEFITS.CLAIM.SUBMITTED'],
       permitted_caller_modules = ARRAY['BENEFITS'],
       updated_at = now()
 WHERE channel='print' AND organization_id='69afc88b-da5c-4f41-a1e7-199e1ee1d416';