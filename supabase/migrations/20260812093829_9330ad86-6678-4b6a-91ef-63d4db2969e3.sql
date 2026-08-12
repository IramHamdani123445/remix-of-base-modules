UPDATE public.omni_comms_event_route
SET sender_identity_id = 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b',
    updated_at = now()
WHERE id = '2c519838-70c8-4f2f-bf4d-3d874b9fba1f'
  AND channel = 'email';