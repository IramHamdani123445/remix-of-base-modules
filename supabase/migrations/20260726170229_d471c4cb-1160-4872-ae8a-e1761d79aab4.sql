-- Lock down legacy set_communication_operating_mode overloads.
-- Frontend/browser callers must use apply_communication_release_mode.
-- Both legacy overloads remain executable by service_role for internal callers
-- (e.g. emergency_stop reversion path in existing RPCs).

DO $$
BEGIN
  IF to_regprocedure('public.set_communication_operating_mode(text, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_communication_operating_mode(text, text) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_communication_operating_mode(text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_communication_operating_mode(text, text) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_communication_operating_mode(text, text) TO service_role';
  END IF;

  IF to_regprocedure('public.set_communication_operating_mode(public.communication_operating_mode, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_communication_operating_mode(public.communication_operating_mode, text) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_communication_operating_mode(public.communication_operating_mode, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_communication_operating_mode(public.communication_operating_mode, text) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_communication_operating_mode(public.communication_operating_mode, text) TO service_role';
  END IF;

  -- Reassert canonical grants for the unique canonical release-mode entry point.
  IF to_regprocedure('public.apply_communication_release_mode(text, text, integer, text, text, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_communication_release_mode(text, text, integer, text, text, text) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_communication_release_mode(text, text, integer, text, text, text) TO authenticated, service_role';
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';