-- Wave 4 DEF-7 — register the genuine internal in-app delivery provider.
--
-- The shipped adapter registry declares channel `in_app` with adapter key
-- `internal_in_app` and deliveryImplemented = true, but `omni_comms_provider`
-- only ever held the `simulation_in_app` reference seed. Because reference
-- providers are not selectable, no genuine in-app provider account could be
-- created and the in-app channel could never satisfy release prerequisite 8.
--
-- Inserted in `draft` and then transitioned to `active` so the lifecycle guard
-- observes the normal draft -> active path. No credential is modelled: the
-- recipient inbox is the provider and the adapter accepts no secret reference.

INSERT INTO public.omni_comms_provider (
  channel, code, display_name, adapter_key, data_origin, status,
  created_by, updated_by)
SELECT
  'in_app', 'internal_in_app', 'Internal In-App Delivery', 'internal_in_app',
  'system_seed', 'draft',
  '08655ffc-6bb2-4eea-bc5b-502c52cdcf85', '08655ffc-6bb2-4eea-bc5b-502c52cdcf85'
WHERE NOT EXISTS (
  SELECT 1 FROM public.omni_comms_provider
   WHERE channel = 'in_app' AND adapter_key = 'internal_in_app');

UPDATE public.omni_comms_provider
   SET status = 'active',
       activated_at = now(),
       activated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       updated_by = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85',
       updated_at = now()
 WHERE channel = 'in_app' AND adapter_key = 'internal_in_app' AND status = 'draft';