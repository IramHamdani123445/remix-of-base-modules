-- ============================================================================
-- Epic 3 — Story 4 database verifier
-- Read-only structural + security + behaviour assertions for the Template
-- Catalogue foundation (Stories 1, 2, 2-hotfix, 3).
--
-- Prints "EPIC 3 STORY 4 VERIFY OK" only when every assertion succeeds.
-- ============================================================================
DO $verify$
DECLARE
  v_count int;
  v_txt   text;
BEGIN
  ------------------------------------------------------------------
  -- 1. TABLES
  ------------------------------------------------------------------
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='omni_comms_template_family' AND c.relkind='r';
  IF NOT FOUND THEN RAISE EXCEPTION 'missing table omni_comms_template_family'; END IF;

  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='omni_comms_template_version' AND c.relkind='r';
  IF NOT FOUND THEN RAISE EXCEPTION 'missing table omni_comms_template_version'; END IF;

  -- RLS on both tables
  SELECT count(*) INTO v_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public'
     AND c.relname IN ('omni_comms_template_family','omni_comms_template_version')
     AND c.relrowsecurity;
  IF v_count <> 2 THEN RAISE EXCEPTION 'RLS not enabled on both template tables'; END IF;

  -- Partial unique index for one published version per family/channel/locale
  PERFORM 1 FROM pg_indexes
   WHERE schemaname='public'
     AND indexname='omni_comms_template_version_published_uk'
     AND indexdef ILIKE '%WHERE (status = ''published''%';
  IF NOT FOUND THEN RAISE EXCEPTION 'published-version partial unique index missing'; END IF;

  -- Trigger presence
  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgrelid::regclass::text IN ('omni_comms_template_family','omni_comms_template_version');
  IF v_count < 2 THEN RAISE EXCEPTION 'template lifecycle triggers missing'; END IF;

  -- No direct table grant to anon/authenticated (RPC-only access)
  SELECT count(*) INTO v_count FROM information_schema.table_privileges
   WHERE table_schema='public'
     AND table_name IN ('omni_comms_template_family','omni_comms_template_version')
     AND grantee IN ('anon','authenticated');
  IF v_count <> 0 THEN RAISE EXCEPTION 'template tables must not expose direct privileges to anon/authenticated (got %)', v_count; END IF;

  ------------------------------------------------------------------
  -- 2. PUBLIC RPC INVENTORY (exactly 14)
  ------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'omni_comms_template%';
  IF v_count <> 14 THEN
    RAISE EXCEPTION 'expected 14 public template RPCs, found %', v_count;
  END IF;

  -- Each must be SECURITY DEFINER, owner postgres, restricted search_path
  FOR v_txt IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_roles r ON r.oid=p.proowner
     WHERE n.nspname='public' AND p.proname LIKE 'omni_comms_template%'
       AND (
         NOT p.prosecdef
         OR r.rolname <> 'postgres'
         OR p.proconfig IS NULL
         OR NOT (p.proconfig::text ILIKE '%search_path=%')
         OR (p.proconfig::text ILIKE '%pg_temp%')
       )
  LOOP
    RAISE EXCEPTION 'public RPC % fails DEFINER/owner/search_path invariant', v_txt;
  END LOOP;

  -- Each public RPC must be executable by authenticated and NOT by anon
  FOR v_txt IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'omni_comms_template%'
       AND (
         has_function_privilege('anon', p.oid, 'EXECUTE')
         OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
       )
  LOOP
    RAISE EXCEPTION 'public RPC % has wrong role grants (anon must be false, authenticated must be true)', v_txt;
  END LOOP;

  -- Obsolete 3-arg publish overload must be absent
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_template_version_publish'
     AND pg_get_function_identity_arguments(p.oid)='p_id uuid, p_expected_updated_at timestamp with time zone, p_correlation_id text';
  IF FOUND THEN RAISE EXCEPTION 'obsolete 3-arg publish overload still present'; END IF;

  -- Hardened 5-arg publish must be present
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_template_version_publish'
     AND pg_get_function_identity_arguments(p.oid)='p_id uuid, p_expected_updated_at timestamp with time zone, p_confirm_replacement boolean, p_replacement_reason text, p_correlation_id text';
  IF NOT FOUND THEN RAISE EXCEPTION 'hardened 5-arg publish missing'; END IF;

  ------------------------------------------------------------------
  -- 3. PRIVATE HELPERS — no browser-role EXECUTE
  ------------------------------------------------------------------
  FOR v_txt IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'omni_comms_priv%'
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    RAISE EXCEPTION 'private helper % is executable by browser roles', v_txt;
  END LOOP;

  -- Deployed checksum helper name is stable
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_priv_compute_template_checksum';
  IF NOT FOUND THEN RAISE EXCEPTION 'template checksum helper missing under expected name'; END IF;

  -- No banned name variants
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('omni_comms_priv_hash_channel_content','omni_comms_tpl_hash');
  IF FOUND THEN RAISE EXCEPTION 'banned/stale helper name detected'; END IF;

  ------------------------------------------------------------------
  -- 4. AUDIT TABLE (shared)
  ------------------------------------------------------------------
  PERFORM 1 FROM information_schema.tables
   WHERE table_schema='public' AND table_name='core_audit_log';
  IF NOT FOUND THEN RAISE EXCEPTION 'shared audit table public.core_audit_log missing'; END IF;

  -- Template audit helper writes into core_audit_log
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='omni_comms_priv_write_template_audit'
     AND pg_get_functiondef(p.oid) ILIKE '%core_audit_log%';
  IF NOT FOUND THEN RAISE EXCEPTION 'template audit helper does not target public.core_audit_log'; END IF;

  ------------------------------------------------------------------
  -- 5. CAPABILITY REGISTRATION
  ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.module_actions ma
    JOIN public.app_modules m ON m.id = ma.module_id
   WHERE m.name = 'omni_comms'
     AND ma.action_name IN ('view','configure','author_templates','approve_templates');
  IF v_count < 4 THEN
    RAISE EXCEPTION 'expected 4 omni_comms template capabilities (view/configure/author_templates/approve_templates), found %', v_count;
  END IF;

  ------------------------------------------------------------------
  -- 6. CHECKSUM DETERMINISM (behaviour, no writes)
  ------------------------------------------------------------------
  IF public.omni_comms_priv_compute_template_checksum('fam-a', 1, 'email', 'en-us',
        '{"subject":"s","html":"<p>x</p>","text":"x"}'::jsonb)
     <> public.omni_comms_priv_compute_template_checksum('fam-a', 1, 'email', 'en-us',
        '{"text":"x","html":"<p>x</p>","subject":"s"}'::jsonb)
  THEN RAISE EXCEPTION 'checksum not stable under top-level key reorder'; END IF;

  IF public.omni_comms_priv_compute_template_checksum('fam-a', 1, 'email', 'en-us',
        '{"subject":"s","html":"<p>x</p>","text":"x"}'::jsonb)
     = public.omni_comms_priv_compute_template_checksum('fam-b', 1, 'email', 'en-us',
        '{"subject":"s","html":"<p>x</p>","text":"x"}'::jsonb)
  THEN RAISE EXCEPTION 'checksum ignored family code'; END IF;

  IF public.omni_comms_priv_compute_template_checksum('fam-a', 1, 'email', 'en-us',
        '{"subject":"s","html":"<p>x</p>","text":"x"}'::jsonb)
     = public.omni_comms_priv_compute_template_checksum('fam-a', 2, 'email', 'en-us',
        '{"subject":"s","html":"<p>x</p>","text":"x"}'::jsonb)
  THEN RAISE EXCEPTION 'checksum ignored version number'; END IF;

  RAISE NOTICE 'EPIC 3 STORY 4 VERIFY OK';
END
$verify$;
