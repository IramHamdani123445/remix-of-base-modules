-- Patch only the admin check inside get_comm_hub_current_evidence_snapshot.
-- The previous implementation referenced has_role(_, 'admin'::app_role),
-- but this project's app_role enum uses 'Admin' (capitalized) and the
-- canonical Comm Hub admin gate is is_comm_hub_admin().
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname = 'get_comm_hub_current_evidence_snapshot'
     AND pronamespace = 'public'::regnamespace;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_comm_hub_current_evidence_snapshot missing';
  END IF;
  v_new := replace(v_def,
    'SELECT has_role(v_actor, ''admin''::app_role) INTO v_is_admin;',
    'SELECT public.is_comm_hub_admin(v_actor) INTO v_is_admin;');
  IF v_new = v_def THEN
    RAISE NOTICE 'admin-check pattern not found; leaving function unchanged';
  ELSE
    EXECUTE v_new;
  END IF;
END $$;