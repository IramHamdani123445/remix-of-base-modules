DO $do$
DECLARE r record; v_src text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'bn_risk%' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~ ':= v_[bw] \|\| '''
  LOOP
    v_src := pg_get_functiondef(r.oid);
    v_src := regexp_replace(v_src, ':= v_b \|\| ''', ':= v_b || text ''', 'g');
    v_src := regexp_replace(v_src, ':= v_w \|\| ''', ':= v_w || text ''', 'g');
    EXECUTE v_src;
  END LOOP;
END $do$;