DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname = '_bn_means_policy_validate' AND pronamespace = 'public'::regnamespace;
  v_new := regexp_replace(v_def, 'codes := codes \|\| ''([A-Z_]+)'';',
                          'codes := array_append(codes, ''\1''::text);', 'g');
  v_new := replace(v_new, '  PROCEDURE_placeholder int;', '');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'validation-gate patch target not found';
  END IF;
  EXECUTE v_new;
END $mig$;