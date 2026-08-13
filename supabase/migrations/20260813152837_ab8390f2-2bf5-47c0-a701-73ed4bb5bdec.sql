DO $$
DECLARE r record; def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('omni_comms_email_journey_list','omni_comms_email_journey_summary','omni_comms_email_journey_detail')
  LOOP
    def := pg_get_functiondef(r.oid);
    v_new := replace(
      def,
      'omni_comms_priv_require_tenant_access(p_organization_id)',
      'omni_comms_priv_require_tenant_access(auth.uid(), p_organization_id)');
    IF v_new <> def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END $$;