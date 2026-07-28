-- ============================================================================
-- Epic 3 Story 1 — Template Foundation local/test verification
-- Run inside a transaction and ROLLBACK. Do not run against production.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/omni-comms/verify-epic3-story1-db.sql
-- ============================================================================
BEGIN;

SET LOCAL client_min_messages = warning;
SET LOCAL role = postgres;

DO $$
DECLARE
  v_org       uuid;
  v_org2      uuid;
  v_dept      uuid;      -- belongs to v_org
  v_dept_x    uuid;      -- belongs to v_org2
  v_event     uuid;
  v_author    uuid := gen_random_uuid();
  v_approver  uuid := gen_random_uuid();
  v_family    uuid;
  v_family2   uuid;
  v_family3   uuid;
  v_version   uuid;
  v_checksum  text := repeat('a', 64);
  v_err       text;
BEGIN
  -- ─── Setup fixtures ────────────────────────────────────────────────
  SELECT id INTO v_org  FROM public.core_organization LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'No core_organization row for fixtures'; END IF;

  INSERT INTO public.core_organization (id, org_code, legal_name)
    VALUES (gen_random_uuid(), 'OMNIT-EPIC3-Y', 'Epic3 Test Org Y')
    RETURNING id INTO v_org2;

  INSERT INTO public.core_department (id, organization_id, code, name)
    VALUES (gen_random_uuid(), v_org,  'e3s1_dept',  'E3S1 Dept')
    RETURNING id INTO v_dept;

  INSERT INTO public.core_department (id, organization_id, code, name)
    VALUES (gen_random_uuid(), v_org2, 'e3s1_deptx', 'E3S1 Dept X')
    RETURNING id INTO v_dept_x;

  INSERT INTO public.omni_comms_event_definition
    (id, code, module_code, entity_type, name, communication_class)
    VALUES (gen_random_uuid(), 'E3S1.CLAIM.APPROVED', 'E3S1', 'CLAIM', 'Claim Approved', 'transactional')
    RETURNING id INTO v_event;

  -- ═══ Family: valid inserts ════════════════════════════════════════
  INSERT INTO public.omni_comms_template_family
    (code, name, scope_type, organization_id, created_by)
    VALUES ('claim_approved', 'Org Claim Approved', 'organization', v_org, v_author)
    RETURNING id INTO v_family;

  INSERT INTO public.omni_comms_template_family
    (code, name, scope_type, organization_id, department_id, created_by)
    VALUES ('claim_approved', 'Dept Claim Approved', 'department', v_org, v_dept, v_author)
    RETURNING id INTO v_family2;

  INSERT INTO public.omni_comms_template_family
    (code, name, scope_type, organization_id, event_definition_id, created_by)
    VALUES ('claim_approved', 'Event Claim Approved', 'event', v_org, v_event, v_author)
    RETURNING id INTO v_family3;

  RAISE NOTICE 'PASS: 3 same-code families across scopes coexist';

  -- ═══ Family: invalid scope shapes must fail ═══════════════════════
  BEGIN
    INSERT INTO public.omni_comms_template_family
      (code, name, scope_type, organization_id, department_id, event_definition_id, created_by)
      VALUES ('bad', 'Bad', 'department', v_org, v_dept, v_event, v_author);
    RAISE EXCEPTION 'FAIL: department scope with event_definition_id must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: scope-shape check rejects dept+event combo';
  END;

  -- Cross-org dept must fail
  BEGIN
    INSERT INTO public.omni_comms_template_family
      (code, name, scope_type, organization_id, department_id, created_by)
      VALUES ('crossorg', 'X', 'department', v_org, v_dept_x, v_author);
    RAISE EXCEPTION 'FAIL: cross-org department must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: department ownership enforced';
  END;

  -- Duplicate org-scope/code must fail
  BEGIN
    INSERT INTO public.omni_comms_template_family
      (code, name, scope_type, organization_id, created_by)
      VALUES ('claim_approved', 'Dup', 'organization', v_org, v_author);
    RAISE EXCEPTION 'FAIL: duplicate org-scope code must be rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: org-scope duplicate rejected';
  END;

  -- Invalid code format must fail
  BEGIN
    INSERT INTO public.omni_comms_template_family
      (code, name, scope_type, organization_id, created_by)
      VALUES ('Bad-Code', 'Bad', 'organization', v_org, v_author);
    RAISE EXCEPTION 'FAIL: bad code format must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: code format check';
  END;

  -- ═══ Family: lifecycle ════════════════════════════════════════════
  UPDATE public.omni_comms_template_family
    SET status='active', activated_at=now(), activated_by=v_author
    WHERE id=v_family;
  RAISE NOTICE 'PASS: draft -> active';

  -- Identity immutable after leaving draft
  BEGIN
    UPDATE public.omni_comms_template_family SET code='changed' WHERE id=v_family;
    RAISE EXCEPTION 'FAIL: code must be immutable after activation';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: identity immutable after activation';
  END;

  -- Retired terminal
  UPDATE public.omni_comms_template_family
    SET status='retired', retired_at=now(), retired_by=v_author, retirement_reason='sunset'
    WHERE id=v_family;
  BEGIN
    UPDATE public.omni_comms_template_family SET status='active' WHERE id=v_family;
    RAISE EXCEPTION 'FAIL: retired -> active must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: retired is terminal';
  END;

  -- Active cannot be deleted
  BEGIN
    UPDATE public.omni_comms_template_family
      SET status='active', activated_at=now(), activated_by=v_author
      WHERE id=v_family2;
    DELETE FROM public.omni_comms_template_family WHERE id=v_family2;
    RAISE EXCEPTION 'FAIL: active family delete must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: active deletion blocked';
  END;

  -- ═══ Version: valid draft insert on active v_family2 ══════════════
  INSERT INTO public.omni_comms_template_version
    (template_family_id, version_number, channel, locale, content, created_by)
    VALUES (v_family2, 1, 'email', 'en-US',
            '{"subject":"Hi","html":"<p>x</p>"}'::jsonb, v_author)
    RETURNING id INTO v_version;
  RAISE NOTICE 'PASS: draft version insert';

  -- Non-draft insert rejected
  BEGIN
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, status, created_by)
      VALUES (v_family2, 2, 'email', 'en-US', '{}'::jsonb, 'approved', v_author);
    RAISE EXCEPTION 'FAIL: non-draft insert must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: draft-only insertion enforced';
  END;

  -- Bad channel
  BEGIN
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, created_by)
      VALUES (v_family2, 3, 'fax', 'en', '{}'::jsonb, v_author);
    RAISE EXCEPTION 'FAIL: bad channel must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: channel check';
  END;

  -- Bad locale
  BEGIN
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, created_by)
      VALUES (v_family2, 3, 'email', 'EN_US', '{}'::jsonb, v_author);
    RAISE EXCEPTION 'FAIL: bad locale must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: locale check';
  END;

  -- Non-object content
  BEGIN
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, created_by)
      VALUES (v_family2, 3, 'email', 'en', '[]'::jsonb, v_author);
    RAISE EXCEPTION 'FAIL: array content must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: content object check';
  END;

  -- Duplicate (family, channel, locale, version)
  BEGIN
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, created_by)
      VALUES (v_family2, 1, 'email', 'en-US', '{}'::jsonb, v_author);
    RAISE EXCEPTION 'FAIL: duplicate version must be rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: unique family/channel/locale/version';
  END;

  -- Approval: self-approve rejected
  BEGIN
    UPDATE public.omni_comms_template_version
      SET status='approved', checksum=v_checksum,
          approved_at=now(), approved_by=v_author
      WHERE id=v_version;
    RAISE EXCEPTION 'FAIL: self-approval must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: independent-approver enforced';
  END;

  -- Approval without checksum rejected
  BEGIN
    UPDATE public.omni_comms_template_version
      SET status='approved', approved_at=now(), approved_by=v_approver
      WHERE id=v_version;
    RAISE EXCEPTION 'FAIL: approve without checksum must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: checksum required for approval';
  END;

  -- Successful approval
  UPDATE public.omni_comms_template_version
    SET status='approved', checksum=v_checksum,
        approved_at=now(), approved_by=v_approver
    WHERE id=v_version;
  RAISE NOTICE 'PASS: draft -> approved';

  -- Approved content mutation rejected
  BEGIN
    UPDATE public.omni_comms_template_version
      SET content='{"subject":"changed"}'::jsonb WHERE id=v_version;
    RAISE EXCEPTION 'FAIL: approved content mutation must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: approved immutability';
  END;

  -- Publish (family is active)
  UPDATE public.omni_comms_template_version
    SET status='published', published_at=now(), published_by=v_approver
    WHERE id=v_version;
  RAISE NOTICE 'PASS: approved -> published';

  -- Second published version for same slot rejected
  DECLARE
    v_v2 uuid;
  BEGIN
    INSERT INTO public.omni_comms_template_version
      (template_family_id, version_number, channel, locale, content, created_by)
      VALUES (v_family2, 2, 'email', 'en-US', '{"subject":"v2"}'::jsonb, v_author)
      RETURNING id INTO v_v2;
    UPDATE public.omni_comms_template_version
      SET status='approved', checksum=repeat('b', 64),
          approved_at=now(), approved_by=v_approver
      WHERE id=v_v2;
    BEGIN
      UPDATE public.omni_comms_template_version
        SET status='published', published_at=now(), published_by=v_approver
        WHERE id=v_v2;
      RAISE EXCEPTION 'FAIL: second published version for same slot must be rejected';
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'PASS: single-published-per-slot enforced';
    END;
  END;

  -- Retirement preserves publication fields
  UPDATE public.omni_comms_template_version
    SET status='retired', retired_at=now(), retired_by=v_approver, retirement_reason='obsolete'
    WHERE id=v_version;
  IF (SELECT published_by FROM public.omni_comms_template_version WHERE id=v_version) IS NULL THEN
    RAISE EXCEPTION 'FAIL: retirement dropped publication metadata';
  END IF;
  RAISE NOTICE 'PASS: retirement preserves publication metadata';

  -- Retired deletion blocked
  BEGIN
    DELETE FROM public.omni_comms_template_version WHERE id=v_version;
    RAISE EXCEPTION 'FAIL: retired deletion must be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: retired deletion blocked';
  END;

  RAISE NOTICE '=== Epic 3 Story 1 verification: ALL CHECKS PASSED ===';
END $$;

ROLLBACK;
