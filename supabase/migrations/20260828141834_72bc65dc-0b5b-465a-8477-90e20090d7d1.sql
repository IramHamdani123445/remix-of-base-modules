INSERT INTO public.omni_comms_channel_adapter_capability
  (adapter_code, display_name, channel, enabled, certification_safe, notes)
SELECT 'resend', 'Resend (email)', 'email', true, true,
       'Adapter-key alias of resend_email (provider adapter_key used by the dispatch runtime).'
 WHERE NOT EXISTS (
   SELECT 1 FROM public.omni_comms_channel_adapter_capability WHERE adapter_code = 'resend');

UPDATE public.omni_comms_channel_adapter_capability
   SET enabled = true, certification_safe = true, updated_at = now()
 WHERE adapter_code = 'resend';