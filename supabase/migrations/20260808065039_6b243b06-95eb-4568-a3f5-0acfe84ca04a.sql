DO $do$
DECLARE
  v_oid oid;
  v_src text;
BEGIN
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('bn_risk_outcome_readiness_v1','bn_risk_closure_readiness_v1')
  LOOP
    v_src := pg_get_functiondef(v_oid);
    v_src := regexp_replace(v_src, 'v_b := v_b \|\| ', 'v_b := array_append(v_b, ', 'g');
    v_src := regexp_replace(v_src, 'v_w := v_w \|\| ', 'v_w := array_append(v_w, ', 'g');
    -- close the added parenthesis on those statements only
    v_src := regexp_replace(v_src, '(array_append\(v_[bw], (?:''(?:[^'']|'''')*''))\;', '\1);', 'g');
    EXECUTE v_src;
  END LOOP;
END $do$;