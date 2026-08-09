DO $mig$
DECLARE d text; needle text; repl text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bn_means_execute_command_v1';
  IF d IS NULL THEN RAISE EXCEPTION 'dispatcher missing'; END IF;

  IF position('_bn_means_mt7_execute' in d) > 0 THEN
    RAISE NOTICE 'already wired'; RETURN;
  END IF;

  needle := E'  ELSE\n    RAISE EXCEPTION ''E_COMMAND_NOT_IMPLEMENTED:%'', p_command_name;\n  END IF;';
  IF position(needle in d) = 0 THEN
    RAISE EXCEPTION 'dispatcher fallback branch not found';
  END IF;

  repl := E'  ELSIF p_command_name IN (''BN_MEANS_REQUEST_ADJUSTMENT'',''BN_MEANS_APPROVE_ADJUSTMENT'',''BN_MEANS_APPROVE'',''BN_MEANS_REJECT'') THEN\n'
       || E'    v_result := public._bn_means_mt7_execute(p_command_name, v_id, p_actor_user_id, p_actor_user_code,\n'
       || E'                  p_correlation_id, p_reason_code, p_justification, p_payload);\n'
       || E'    SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = v_id;\n'
       || E'    v_result := v_result || jsonb_build_object(''entity_version'', v_a.row_version, ''to_status'', v_a.status);\n\n'
       || needle;

  d := replace(d, needle, repl);
  EXECUTE d;
END $mig$;