UPDATE public.omni_comms_channel_setting
   SET controlled_test_delivery_enabled = true, updated_at = now()
 WHERE channel = 'voice' AND department_id IS NULL;