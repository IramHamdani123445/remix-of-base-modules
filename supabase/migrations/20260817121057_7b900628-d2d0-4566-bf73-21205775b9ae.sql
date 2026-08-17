ALTER TABLE public.omni_comms_print_equipment
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discovery_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS queue_name text,
  ADD COLUMN IF NOT EXISTS device_uri text,
  ADD COLUMN IF NOT EXISTS discovery_source_id uuid,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS discovery_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_print_equipment
    ADD CONSTRAINT omni_comms_print_equipment_discovery_chk
    CHECK (discovery_source IN ('manual','ipp_sync'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_print_equipment_default_uq
  ON public.omni_comms_print_equipment (organization_id, coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default AND status = 'active';

CREATE TABLE IF NOT EXISTS public.omni_comms_print_discovery_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  production_account_id uuid REFERENCES public.omni_comms_provider_account(id),
  code text NOT NULL,
  display_name text NOT NULL,
  mode text NOT NULL DEFAULT 'print_agent',
  endpoint_url text NOT NULL,
  auth_secret_ref text,
  status text NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_detail text,
  last_discovered_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT omni_comms_print_discovery_source_code_uq UNIQUE (organization_id, code),
  CONSTRAINT omni_comms_print_discovery_source_mode_chk CHECK (mode IN ('print_agent','cups_http','ipps')),
  CONSTRAINT omni_comms_print_discovery_source_status_chk CHECK (status IN ('active','paused','retired'))
);

GRANT SELECT ON public.omni_comms_print_discovery_source TO authenticated;
GRANT ALL ON public.omni_comms_print_discovery_source TO service_role;

DO $$ BEGIN
  ALTER TABLE public.omni_comms_print_equipment
    ADD CONSTRAINT omni_comms_print_equipment_discovery_source_fkey
    FOREIGN KEY (discovery_source_id) REFERENCES public.omni_comms_print_discovery_source(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.omni_comms_print_equipment e
   SET is_default = true
 WHERE e.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM public.omni_comms_print_equipment d
      WHERE d.organization_id = e.organization_id
        AND coalesce(d.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(e.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
        AND d.is_default AND d.status = 'active');