UPDATE public.omni_comms_sender_identity
   SET identity_config = coalesce(nullif(identity_config, '{}'::jsonb), print_config),
       updated_at = now()
 WHERE channel = 'print'
   AND coalesce(identity_config, '{}'::jsonb) = '{}'::jsonb
   AND print_config IS NOT NULL
   AND print_config <> '{}'::jsonb;