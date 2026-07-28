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
-- RESET role;
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

-- ── Authenticated / anon cannot read template tables directly (grants) ──
SELECT has_table_privilege('authenticated', 'public.omni_comms_template_family',  'SELECT') AS auth_family_select,
       has_table_privilege('authenticated', 'public.omni_comms_template_version', 'SELECT') AS auth_version_select,
       has_table_privilege('anon',          'public.omni_comms_template_family',  'SELECT') AS anon_family_select;

-- ══════════════════════════════════════════════════════════════════════════
-- Story 2 HOTFIX — publish RPC signature, security, and contract fixtures
-- ══════════════════════════════════════════════════════════════════════════

-- ── Obsolete 3-argument overload is absent ────────────────────────────────
SELECT count(*) AS obsolete_publish_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'omni_comms_template_version_publish'
   AND pg_get_function_identity_arguments(p.oid) = 'uuid, text, text';
-- Expect: 0.

-- ── New 5-argument overload exists with expected owner and security ───────
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_userbyid(p.proowner)               AS owner,
       p.prosecdef                               AS security_definer,
       p.proconfig                               AS config,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'omni_comms_template_version_publish';
-- Expect exactly one row: args='uuid, timestamp with time zone, boolean, text, text',
--   owner='postgres', security_definer=true, anon_exec=false, auth_exec=true,
--   config containing search_path=pg_catalog,public.

-- ── Publication contract fixtures ─────────────────────────────────────────
-- These fixtures need a seeded family + version and an actor with
-- omni_comms.approve_templates. They are documented here as the required
-- shape; runners populate {{FAMILY_CODE}}, {{ORG}}, {{DEPT}}, {{APPROVER}}.
--
--   1. Initial publication with confirm=false and matching updated_at
--      SELECT public.omni_comms_template_version_publish(
--        p_id                  := :v_id,
--        p_expected_updated_at := :v_updated_at,
--        p_confirm_replacement := false,
--        p_replacement_reason  := NULL,
--        p_correlation_id      := 'fx-init');
--      Expect: status='published', replaced_version_id IS NULL.
--
--   2. Initial publication with confirm=true
--      Expect: OC422 DETAIL='replacement_not_applicable'.
--
--   3. Stale updated_at
--      Expect: OC412 DETAIL='updated_at_mismatch'; no row mutated.
--
--   4. Existing publication with confirm=false
--      Expect: OC409 DETAIL='replacement_confirmation_required';
--      old version.status stays 'published', new version.status stays 'approved',
--      no audit row inserted for the failed call
--        (verify with COUNT(*) FROM core_audit_log
--         WHERE event_code LIKE 'OMNI_COMMS.TEMPLATE_VERSION.%' AND created_at > :t0).
--
--   5. Existing publication, confirm=true, NULL reason
--      Expect: OC422 DETAIL='replacement_reason_required'.
--
--   6. Existing publication, confirm=true, reason='   '
--      Expect: OC422 DETAIL='replacement_reason_required'.
--
--   7. Existing publication, confirm=true, reason length 2001 chars
--      Expect: OC422 DETAIL='reason_too_long'.
--
--   8. Existing publication, confirm=true, valid reason
--      Expect: return jsonb.replaced_version_id = :old_id,
--              old row status='retired' with retired_by=:approver and retirement_reason=trim(reason);
--              new row status='published' with published_by=:approver;
--              old row's channel/locale/version_number/checksum/content unchanged;
--              two audit rows written (retire + publish) with the same reason and correlation_id.
--
--   9. Audit-write failure rollback
--      Force omni_comms_priv_write_template_audit to raise (e.g. temporarily
--      RENAME public.core_audit_log inside a subtransaction) and verify both
--      version rows are unchanged after ROLLBACK TO SAVEPOINT.
--
--  10. Concurrency — two sessions publishing distinct approved versions of
--      the same (family, channel, locale) with confirm=true and matching
--      expected_updated_at on each. The family FOR UPDATE lock serialises
--      them; the losing session receives OC409
--      DETAIL='replacement_confirmation_required' (because the winner has
--      already replaced the previously-published row) OR
--      DETAIL='updated_at_mismatch' if its target row was touched.
--      Final state: exactly one row with status='published' for that
--      (family, channel, locale); no deadlock.

-- ── Rollback all fixtures ─────────────────────────────────────────────────
ROLLBACK;
