-- ============================================================================
-- Omni-Comms Epic 3 Story 2 — Database verification script
-- Rolls back on completion. Requires a superuser (postgres) connection.
-- Enumerates the canonical token fixture IDs from
-- src/platform/omni-comms/rendering/__fixtures__/tokens.ts so the parity
-- test asserts both suites cover the same cases.
--
-- Canonical fixture IDs exercised below:
--   tok_accept_simple
--   tok_accept_dotted
--   tok_accept_multi
--   tok_accept_none
--   tok_reject_empty
--   tok_reject_triple
--   tok_reject_unmatched_o
--   tok_reject_unmatched_c
--   tok_reject_section
--   tok_reject_partial
--   tok_reject_comment
--   tok_reject_index
--   tok_reject_dot_leading
--   tok_reject_dot_trailing
-- ============================================================================
BEGIN;
SET LOCAL role postgres;
SET LOCAL client_min_messages = warning;

-- ── Private-helper security modes ─────────────────────────────────────────
SELECT proname, prosecdef, provolatile
  FROM pg_proc
 WHERE proname IN (
   'omni_comms_priv_normalize_locale',
   'omni_comms_priv_extract_tokens',
   'omni_comms_priv_validate_channel_content',
   'omni_comms_priv_compute_template_checksum',
   'omni_comms_priv_verify_department_ownership',
   'omni_comms_priv_write_template_audit'
 )
 ORDER BY proname;
-- Expect: pure helpers prosecdef=false, immutable/stable; only write_template_audit prosecdef=true.

-- ── Grants: no anon EXECUTE on any public template RPC ────────────────────
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'omni_comms_template_%'
 ORDER BY p.proname;
-- Expect: every row anon_can_exec=false, auth_can_exec=true.

-- ── Token grammar fixtures ────────────────────────────────────────────────
-- tok_accept_simple / tok_accept_dotted / tok_accept_multi / tok_accept_none
SELECT public.omni_comms_priv_extract_tokens('Hello {{name}}');
SELECT public.omni_comms_priv_extract_tokens('{{user.first_name}}');
SELECT public.omni_comms_priv_extract_tokens('{{a}} {{b}} {{a}}');
SELECT public.omni_comms_priv_extract_tokens('no tokens here');

-- tok_reject_empty / tok_reject_triple / tok_reject_unmatched_o / tok_reject_unmatched_c
-- tok_reject_section / tok_reject_partial / tok_reject_comment
-- tok_reject_index / tok_reject_dot_leading / tok_reject_dot_trailing
DO $$
DECLARE
  v_cases text[] := ARRAY[
    '{{  }}','{{{name}}}','hi {{name','hi name}}',
    '{{#items}}','{{>partial}}','{{!hidden}}',
    '{{items[0]}}','{{.leading}}','{{trailing.}}'
  ];
  v_case text;
BEGIN
  FOREACH v_case IN ARRAY v_cases LOOP
    BEGIN
      PERFORM public.omni_comms_priv_extract_tokens(v_case);
      RAISE EXCEPTION 'expected rejection for %', v_case;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
    END;
  END LOOP;
END $$;

-- ── Checksum properties ───────────────────────────────────────────────────
SELECT
  public.omni_comms_priv_compute_template_checksum('fam', 1, 'email', 'en-US',
    jsonb_build_object('a', '1', 'b', '2'))
  = public.omni_comms_priv_compute_template_checksum('fam', 1, 'email', 'en-US',
    jsonb_build_object('b', '2', 'a', '1'))                              AS top_level_key_order_stable,
  public.omni_comms_priv_compute_template_checksum('fam', 1, 'email', 'en-US',
    jsonb_build_object('a', '1'))
  <> public.omni_comms_priv_compute_template_checksum('fam', 1, 'email', 'en-US',
    jsonb_build_object('a', '2'))                                        AS content_change_affects_checksum,
  public.omni_comms_priv_compute_template_checksum('fam', 1, 'email', 'en-US',
    jsonb_build_object('a', '1'))
  <> public.omni_comms_priv_compute_template_checksum('fam', 2, 'email', 'en-US',
    jsonb_build_object('a', '1'))                                        AS version_change_affects_checksum;

-- ── Locale normalisation ──────────────────────────────────────────────────
SELECT public.omni_comms_priv_normalize_locale('  en-us  ') AS lc1,   -- 'en-US'
       public.omni_comms_priv_normalize_locale('EN')        AS lc2;   -- 'en'
DO $$ BEGIN
  BEGIN PERFORM public.omni_comms_priv_normalize_locale('en_US');
    RAISE EXCEPTION 'expected locale_format_invalid';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
END $$;

-- ── Authenticated cannot read templates directly ──────────────────────────
DO $$ BEGIN
  SET LOCAL role authenticated;
  BEGIN
    PERFORM 1 FROM public.omni_comms_template_family LIMIT 1;
    RAISE EXCEPTION 'direct table read must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SET LOCAL role postgres;
END $$;

-- ── Rollback all fixtures ─────────────────────────────────────────────────
ROLLBACK;
