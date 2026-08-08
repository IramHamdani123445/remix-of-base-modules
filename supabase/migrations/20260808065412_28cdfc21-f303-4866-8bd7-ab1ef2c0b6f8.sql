DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bn_risk_recommendation_readiness_v1';
  v_src := replace(v_src, 'e.evidence_label', 'e.document_title');
  EXECUTE v_src;
END $do$;