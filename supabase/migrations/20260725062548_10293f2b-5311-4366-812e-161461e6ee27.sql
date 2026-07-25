CREATE OR REPLACE FUNCTION public._comm_hub_get_request_actor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := '{}'::jsonb;
  v_claims jsonb := '{}'::jsonb;
  v_raw text;
  v_actor uuid;
  v_actor_source text := 'none';
  v_role text;
  v_role_source text := 'none';
  v_claims_present boolean := false;
  v_exp bigint;
BEGIN
  BEGIN
    v_jwt := COALESCE(auth.jwt(), '{}'::jsonb);
    IF v_jwt <> '{}'::jsonb THEN v_claims_present := true; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_jwt := '{}'::jsonb;
  END;

  BEGIN
    v_raw := current_setting('request.jwt.claims', true);
    IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
      v_claims := v_raw::jsonb;
      v_claims_present := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_claims := '{}'::jsonb;
  END;

  IF v_uid IS NOT NULL THEN
    v_actor := v_uid;
    v_actor_source := 'auth.uid';
  ELSIF NULLIF(v_jwt->>'sub','') IS NOT NULL THEN
    BEGIN v_actor := (v_jwt->>'sub')::uuid; v_actor_source := 'auth.jwt'; EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  ELSIF NULLIF(v_claims->>'sub','') IS NOT NULL THEN
    BEGIN v_actor := (v_claims->>'sub')::uuid; v_actor_source := 'request.jwt.claims'; EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  ELSE
    BEGIN
      v_actor := NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid;
      IF v_actor IS NOT NULL THEN v_actor_source := 'legacy'; END IF;
    EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  END IF;

  IF NULLIF(v_jwt->>'role','') IS NOT NULL THEN
    v_role := v_jwt->>'role'; v_role_source := 'auth.jwt';
  ELSIF NULLIF(v_claims->>'role','') IS NOT NULL THEN
    v_role := v_claims->>'role'; v_role_source := 'request.jwt.claims';
  ELSE
    BEGIN
      v_role := NULLIF(current_setting('request.jwt.claim.role', true),'');
      IF v_role IS NOT NULL THEN v_role_source := 'legacy'; END IF;
    EXCEPTION WHEN OTHERS THEN v_role := NULL; END;
  END IF;

  BEGIN
    v_exp := COALESCE(NULLIF(v_jwt->>'exp','')::bigint, NULLIF(v_claims->>'exp','')::bigint);
  EXCEPTION WHEN OTHERS THEN v_exp := NULL; END;

  RETURN jsonb_build_object(
    'actor_id', v_actor,
    'actor_source', v_actor_source,
    'resolved_role', COALESCE(v_role,''),
    'role_source', v_role_source,
    'claims_present', v_claims_present,
    'token_expires_at', CASE WHEN v_exp IS NULL THEN NULL ELSE to_timestamp(v_exp) END,
    'token_remaining_seconds', CASE WHEN v_exp IS NULL THEN NULL ELSE GREATEST(v_exp - extract(epoch FROM clock_timestamp())::bigint, 0) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public._comm_hub_get_request_actor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._comm_hub_get_request_actor() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.probe_comm_hub_operator_identity()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor jsonb := public._comm_hub_get_request_actor();
  v_actor_id uuid := NULLIF(v_actor->>'actor_id','')::uuid;
  v_role text := v_actor->>'resolved_role';
BEGIN
  RETURN jsonb_build_object(
    'allowed', v_actor_id IS NOT NULL AND v_role = 'authenticated',
    'actor_id', v_actor_id,
    'actor_source', v_actor->>'actor_source',
    'resolved_role', v_role,
    'role_source', v_actor->>'role_source',
    'claims_present', COALESCE((v_actor->>'claims_present')::boolean,false),
    'token_expires_at', v_actor->'token_expires_at',
    'token_remaining_seconds', v_actor->'token_remaining_seconds'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.probe_comm_hub_operator_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.probe_comm_hub_operator_identity() TO authenticated, service_role;

DO $$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='assert_comm_hub_runtime_transition'
    AND pg_get_function_identity_arguments(p.oid)='p_action text, p_context jsonb';
  v_old := '  v_uid uuid := auth.uid();' || chr(10) || '  v_role text := COALESCE(current_setting(''request.jwt.claim.role'', true), '''');';
  v_new := '  v_actor_evidence jsonb := public._comm_hub_get_request_actor();' || chr(10) ||
           '  v_uid uuid := NULLIF(v_actor_evidence->>''actor_id'','''')::uuid;' || chr(10) ||
           '  v_role text := COALESCE(v_actor_evidence->>''resolved_role'','''');';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'assert transition actor declaration contract changed'; END IF;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def,
    '''actor_id'', v_actor, ''actor_type'', v_actor_type,',
    '''actor_id'', v_actor, ''actor_type'', v_actor_type, ''actor_source'', v_actor_evidence->>''actor_source'', ''claims_present'', COALESCE((v_actor_evidence->>''claims_present'')::boolean,false),');
  EXECUTE v_def;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='begin_comm_hub_dry_run'
    AND pg_get_function_identity_arguments(p.oid)='p_payload jsonb';
  v_old := '  v_uid uuid := auth.uid();';
  v_new := '  v_actor_evidence jsonb := public._comm_hub_get_request_actor();' || chr(10) ||
           '  v_uid uuid := NULLIF(v_actor_evidence->>''actor_id'','''')::uuid;';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'legacy begin actor declaration contract changed'; END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='begin_comm_hub_dry_run_v1'
    AND pg_get_function_identity_arguments(p.oid)='p_payload jsonb';
  v_old := '  v_uid uuid := auth.uid();';
  v_new := '  v_actor_evidence jsonb := public._comm_hub_get_request_actor();' || chr(10) ||
           '  v_uid uuid := NULLIF(v_actor_evidence->>''actor_id'','''')::uuid;' || chr(10) ||
           '  v_nested_actor uuid;';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'v1 begin actor declaration contract changed'; END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := '  v_delegate := public.begin_comm_hub_dry_run(v_delegate_payload);' || chr(10) || chr(10) || '  v_status := v_delegate->>''status'';';
  v_new := '  v_delegate := public.begin_comm_hub_dry_run(v_delegate_payload);' || chr(10) || chr(10) ||
    '  IF NULLIF(v_delegate->>''transition_log_id'','''') IS NOT NULL THEN' || chr(10) ||
    '    SELECT actor_id INTO v_nested_actor FROM public.comm_hub_runtime_transition_log WHERE id=(v_delegate->>''transition_log_id'')::uuid;' || chr(10) ||
    '    IF v_nested_actor IS DISTINCT FROM v_uid THEN' || chr(10) ||
    '      RETURN jsonb_build_object(''contract_version'',''comm-hub-dry-run-contract/v1'',''status'',''BLOCKED'',''state'',''BLOCKED'',''passed'',false,''stage_succeeded'',false,''terminal'',true,''failure_stage'',''AUTH'',''message'',''Operator identity changed inside the Dry Run begin boundary.'',''blockers'',jsonb_build_array(jsonb_build_object(''code'',''OPERATOR_IDENTITY_MISMATCH'',''stage'',''AUTH'')),''mutation_started'',false,''execution_created'',false,''request_created'',false,''message_created'',false,''cleanup_proven'',true,''provider_call_attempted'',false,''simulator_call_attempted'',false,''ambiguous_outcome'',false,''retry_safe'',true,''retry_reason'',''PRE_MUTATION_AUTH_FAILURE'');' || chr(10) ||
    '    END IF;' || chr(10) ||
    '  END IF;' || chr(10) || chr(10) ||
    '  v_status := v_delegate->>''status'';';
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'v1 begin delegate contract changed'; END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$$;

REVOKE ALL ON FUNCTION public.probe_comm_hub_operator_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.probe_comm_hub_operator_identity() TO authenticated, service_role;

COMMENT ON FUNCTION public._comm_hub_get_request_actor() IS 'Authoritative request actor extractor: auth.uid, auth.jwt sub, request.jwt.claims sub, then legacy claims.';
COMMENT ON FUNCTION public.probe_comm_hub_operator_identity() IS 'Read-only, zero-row operator JWT/PostgREST identity proof for Communication Hub action boundaries.';