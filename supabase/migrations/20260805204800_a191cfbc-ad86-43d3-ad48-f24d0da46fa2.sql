CREATE TABLE IF NOT EXISTS public.platform_environment_marker (
  id boolean PRIMARY KEY DEFAULT true,
  environment_kind text NOT NULL,
  environment_label text NOT NULL,
  project_ref text,
  allows_controlled_test_activation boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_environment_marker_singleton CHECK (id = true),
  CONSTRAINT platform_environment_marker_kind_chk
    CHECK (environment_kind IN ('PRODUCTION','TEST','LOCAL','CI')),
  CONSTRAINT platform_environment_marker_activation_chk
    CHECK (allows_controlled_test_activation = false OR environment_kind <> 'PRODUCTION')
);

GRANT SELECT ON public.platform_environment_marker TO authenticated;
GRANT ALL ON public.platform_environment_marker TO service_role;

ALTER TABLE public.platform_environment_marker ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_environment_marker_read ON public.platform_environment_marker;
CREATE POLICY platform_environment_marker_read
  ON public.platform_environment_marker
  FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.platform_environment_marker_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_environment_marker_touch ON public.platform_environment_marker;
CREATE TRIGGER platform_environment_marker_touch
  BEFORE UPDATE ON public.platform_environment_marker
  FOR EACH ROW EXECUTE FUNCTION public.platform_environment_marker_touch();

COMMENT ON TABLE public.platform_environment_marker IS
  'Single-row governed environment identity. Activation scripts must fail closed when this row is absent or when allows_controlled_test_activation is false.';