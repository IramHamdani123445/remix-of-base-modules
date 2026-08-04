-- =====================================================================
-- BN Life Certificates — SEEDED database integration harness
--
-- Everything the scenario needs is created inside one transaction that is
-- ROLLED BACK at the end. The harness NEVER depends on pre-existing
-- business rows (awards, claims, obligations) and NEVER skips the
-- principal scenario: a missing precondition raises and fails the run.
--
--   scripts/bn/run-life-certificate-db-tests.sh
--   (or: psql "$BN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/bn/life_certificate_integration.sql)
--
-- Execution contexts
--   * Browser-accessible RPCs (worklist_v2) run under role `authenticated`
--     with request.jwt.claims set so auth.uid() returns the seeded user and
--     both permission and record-scope checks execute normally.
--   * Service-only adapter RPCs run in the privileged (postgres/service)
--     context, which is what the Edge Function uses.
-- =====================================================================
\set ON_ERROR_STOP on
\timing off
BEGIN;

SET LOCAL client_min_messages = notice;

-- Deterministic identifiers -------------------------------------------------
\set u_auth   '''aaaaaaaa-0000-4000-8000-000000000001'''
\set u_unauth '''aaaaaaaa-0000-4000-8000-000000000002'''
\set claim_id '''bbbbbbbb-0000-4000-8000-000000000001'''
\set award_id '''cccccccc-0000-4000-8000-000000000001'''
\set award_empty '''cccccccc-0000-4000-8000-000000000002'''
\set award_forbidden_empty '''cccccccc-0000-4000-8000-000000000003'''
\set lc_id    '''dddddddd-0000-4000-8000-000000000001'''
\set intent   '''eeeeeeee-0000-4000-8000-000000000001'''
\set product  '''ffffffff-0000-4000-8000-000000000001'''
\set claim_forbidden '''bbbbbbbb-0000-4000-8000-000000000002'''

-- =====================================================================
-- 0. Structural preconditions (hard failures, never skips)
-- =====================================================================
DO $pre$
BEGIN
  IF to_regprocedure('public.bn_life_certificate_worklist_v2(text,text,integer,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: bn_life_certificate_worklist_v2 missing';
  END IF;
  IF to_regprocedure('public._bn_lc_can_access_award(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: _bn_lc_can_access_award missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_communication_adapter_source
                  WHERE source_module = 'BN_LIFE_CERTIFICATE' AND is_enabled) THEN
    RAISE EXCEPTION 'FAIL: BN_LIFE_CERTIFICATE not registered as an adapter source';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name = 'bn_life_certificate') THEN
    RAISE EXCEPTION 'FAIL: bn_life_certificate module not registered';
  END IF;
END $pre$;

-- =====================================================================
-- 1. Seed identity, permissions and record scope
-- =====================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
VALUES (:u_auth::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'bn-lc-authorised@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
       (:u_unauth::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'bn-lc-unauthorised@test.local', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.profiles (id, full_name, email, user_code, is_active)
VALUES (:u_auth::uuid,  'BN LC Authorised',   'bn-lc-authorised@test.local',   'BNLCAUTH', true),
       (:u_unauth::uuid,'BN LC Unauthorised', 'bn-lc-unauthorised@test.local', 'BNLCNONE', true);

-- Role + Life Certificate `view` permission for BOTH users. The only
-- difference between them is record scope, so the forbidden cases prove
-- record-level enforcement rather than module-level permission.
INSERT INTO public.roles (id, role_name, description, is_active, is_system_role, mfa_required)
SELECT gen_random_uuid(), 'Clerk', 'test', true, false, false
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE role_name = 'Clerk');

INSERT INTO public.user_roles (user_id, role)
VALUES (:u_auth::uuid, 'Clerk'), (:u_unauth::uuid, 'Clerk')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, m.id, ma.id, true
  FROM public.roles r
  JOIN public.app_modules m ON m.name = 'bn_life_certificate'
  JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = 'view'
 WHERE r.role_name = 'Clerk'
ON CONFLICT DO NOTHING;

UPDATE public.role_permissions rp SET is_granted = true
  FROM public.roles r, public.app_modules m, public.module_actions ma
 WHERE rp.role_id = r.id AND rp.module_id = m.id AND rp.action_id = ma.id
   AND r.role_name = 'Clerk' AND m.name = 'bn_life_certificate' AND ma.action_name = 'view';

DO $chk$
BEGIN
  IF NOT public.has_permission('aaaaaaaa-0000-4000-8000-000000000001'::uuid,'bn_life_certificate','view') THEN
    RAISE EXCEPTION 'FAIL: seeded permission grant did not take effect';
  END IF;
  IF public.has_permission('aaaaaaaa-0000-4000-8000-000000000001'::uuid,'bn_life_certificate','view_sensitive_identity') THEN
    RAISE EXCEPTION 'FAIL: seeded user unexpectedly holds view_sensitive_identity';
  END IF;
END $chk$;

-- =====================================================================
-- 2. Seed business fixtures: product, claims, awards, obligation, contact
-- =====================================================================
INSERT INTO public.bn_product (id, benefit_code, benefit_name, category, branch, payment_type, country_code, status)
VALUES (:product::uuid, 'LCTEST', 'LC Harness Product', 'LONG_TERM', 'LT', 'PERIODIC', 'SKN', 'ACTIVE');

-- Accessible claim: explicitly assigned to the authorised user's code.
INSERT INTO public.bn_claim (id, claim_number, ssn, product_id, status, assigned_to, contact_email)
VALUES (:claim_id::uuid, 'LC-CLM-0001', '123456789', :product::uuid, 'APPROVED', 'BNLCAUTH', 'claimant@test.local');

-- Inaccessible claim: assigned to nobody the test users can reach.
INSERT INTO public.bn_claim (id, claim_number, ssn, product_id, status, assigned_to)
VALUES (:claim_forbidden::uuid, 'LC-CLM-0002', '987654321', :product::uuid, 'APPROVED', 'SOMEONEELSE');

INSERT INTO public.bn_award (id, award_number, bn_claim_id, ssn, benefit_code, award_type, status, start_date)
VALUES (:award_id::uuid,             'LC-AWD-0001', :claim_id::uuid,        '123456789', 'LCTEST', 'PENSION', 'ACTIVE', CURRENT_DATE - 400),
       (:award_empty::uuid,          'LC-AWD-0002', :claim_id::uuid,        '123456780', 'LCTEST', 'PENSION', 'ACTIVE', CURRENT_DATE - 300),
       (:award_forbidden_empty::uuid,'LC-AWD-0003', :claim_forbidden::uuid, '987654321', 'LCTEST', 'PENSION', 'ACTIVE', CURRENT_DATE - 200);

-- One obligation on the accessible award only. `award_empty` intentionally
-- has none; `award_forbidden_empty` intentionally has none either, so the
-- forbidden response cannot be used to infer obligation existence.
INSERT INTO public.bn_life_certificate
  (id, bn_award_id, due_date, status, obligation_status, evidence_status,
   verification_status, escalation_status, communication_status)
VALUES (:lc_id::uuid, :award_id::uuid, CURRENT_DATE - 5, 'PENDING',
        'DUE', 'NONE', 'NOT_STARTED', 'NONE', 'NONE');

-- =====================================================================
-- 3. worklist_v2 under an AUTHENTICATED session
-- =====================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

DO $wl$
DECLARE v jsonb; v_err text;
BEGIN
  RAISE NOTICE '--- worklist_v2: authenticated authorised user ---';

  -- 3a. Accessible award WITH obligations: only that award, masked identity.
  v := public.bn_life_certificate_worklist_v2('ALL', NULL, 50, 0,
        'cccccccc-0000-4000-8000-000000000001'::uuid);
  IF (v->>'total')::int <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 obligation, got %', v->>'total'; END IF;
  IF v->'rows'->0->>'bn_award_id' <> 'cccccccc-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: worklist returned a foreign award'; END IF;
  IF (v->>'identity_masked')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: identity should be masked without view_sensitive_identity'; END IF;
  IF v->'rows'->0->>'ssn' = '123456789' THEN
    RAISE EXCEPTION 'FAIL: raw SSN exposed without view_sensitive_identity'; END IF;
  IF v->'award'->>'id' <> 'cccccccc-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: award context missing'; END IF;

  -- 3b. Accessible award with NO obligations: empty result + safe context.
  v := public.bn_life_certificate_worklist_v2('ALL', NULL, 50, 0,
        'cccccccc-0000-4000-8000-000000000002'::uuid);
  IF (v->>'total')::int <> 0 THEN RAISE EXCEPTION 'FAIL: expected empty award result'; END IF;
  IF v->'award'->>'award_number' <> 'LC-AWD-0002' THEN
    RAISE EXCEPTION 'FAIL: empty accessible award must still return context'; END IF;

  -- 3c. Missing award: E_AWARD_NOT_FOUND.
  BEGIN
    v := public.bn_life_certificate_worklist_v2('ALL', NULL, 50, 0,
          '00000000-0000-4000-8000-0000000000ff'::uuid);
    RAISE EXCEPTION 'FAIL: missing award did not raise';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_AWARD_NOT_FOUND' THEN RAISE EXCEPTION 'FAIL: expected E_AWARD_NOT_FOUND, got %', v_err; END IF;
  END;

  -- 3d. Inaccessible award WITHOUT obligations: still E_RECORD_FORBIDDEN.
  BEGIN
    v := public.bn_life_certificate_worklist_v2('ALL', NULL, 50, 0,
          'cccccccc-0000-4000-8000-000000000003'::uuid);
    RAISE EXCEPTION 'FAIL: inaccessible empty award did not raise';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_RECORD_FORBIDDEN' THEN RAISE EXCEPTION 'FAIL: expected E_RECORD_FORBIDDEN, got %', v_err; END IF;
  END;

  -- 3e. Search + pagination remain bounded.
  v := public.bn_life_certificate_worklist_v2('ALL', NULL, 9999, 0, NULL);
  IF (v->>'limit')::int > 200 THEN RAISE EXCEPTION 'FAIL: page size not capped'; END IF;
  BEGIN
    v := public.bn_life_certificate_worklist_v2('ALL', 'ab', 50, 0, NULL);
    RAISE EXCEPTION 'FAIL: short search not rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_SEARCH_TOO_SHORT' THEN RAISE EXCEPTION 'FAIL: expected E_SEARCH_TOO_SHORT, got %', v_err; END IF;
  END;
END $wl$;

-- 3f. Unauthorised user (same module permission, no record scope).
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';
DO $wl2$
DECLARE v jsonb; v_err text;
BEGIN
  RAISE NOTICE '--- worklist_v2: authenticated UNAUTHORISED user ---';
  BEGIN
    v := public.bn_life_certificate_worklist_v2('ALL', NULL, 50, 0,
          'cccccccc-0000-4000-8000-000000000001'::uuid);
    RAISE EXCEPTION 'FAIL: unauthorised user was not blocked';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'E_RECORD_FORBIDDEN' THEN RAISE EXCEPTION 'FAIL: expected E_RECORD_FORBIDDEN, got %', v_err; END IF;
  END;

  -- The unscoped worklist must not leak the seeded obligation either.
  v := public.bn_life_certificate_worklist_v2('ALL', NULL, 50, 0, NULL);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') r
              WHERE r->>'id' = 'dddddddd-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: unauthorised user saw a scoped obligation';
  END IF;
END $wl2$;

-- 3g. Browser role must not reach the service-only adapter surface.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
DO $svc$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM public.bn_communication_adapter_pending_v1(1);
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL: authenticated role executed a service-only adapter RPC'; END IF;

  v_ok := false;
  BEGIN
    PERFORM 1 FROM public.bn_communication_dispatch LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL: authenticated role read the adapter dispatch table'; END IF;
END $svc$;

RESET ROLE;

-- 3h. Sensitive identity IS revealed once the permission is granted.
INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, m.id, ma.id, true
  FROM public.roles r
  JOIN public.app_modules m ON m.name = 'bn_life_certificate'
  JOIN public.module_actions ma ON ma.module_id = m.id AND ma.action_name = 'view_sensitive_identity'
 WHERE r.role_name = 'Clerk'
ON CONFLICT DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
DO $wl3$
DECLARE v jsonb;
BEGIN
  v := public.bn_life_certificate_worklist_v2('ALL', NULL, 50, 0,
        'cccccccc-0000-4000-8000-000000000001'::uuid);
  IF (v->>'identity_masked')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: identity still masked with view_sensitive_identity'; END IF;
  IF v->'rows'->0->>'ssn' <> '123456789' THEN
    RAISE EXCEPTION 'FAIL: sensitive identity not revealed with the permission'; END IF;
END $wl3$;
RESET ROLE;

-- =====================================================================
-- 4. Communication intent status constraint
-- =====================================================================
DO $cons$
DECLARE s text; v_rejected boolean := false;
BEGIN
  FOREACH s IN ARRAY ARRAY['PENDING','RETRY','REQUESTED','QUEUED','DISPATCHED','DELIVERED','FAILED','CANCELLED'] LOOP
    INSERT INTO public.bn_life_certificate_communication_intent
      (life_certificate_id, bn_award_id, event_code, idempotency_key, delivery_status)
    VALUES ('dddddddd-0000-4000-8000-000000000001'::uuid,
            'cccccccc-0000-4000-8000-000000000001'::uuid,
            'BN_LC_STATUS_PROBE', 'probe:'||s, s);
  END LOOP;
  DELETE FROM public.bn_life_certificate_communication_intent WHERE event_code = 'BN_LC_STATUS_PROBE';

  BEGIN
    INSERT INTO public.bn_life_certificate_communication_intent
      (life_certificate_id, bn_award_id, event_code, idempotency_key, delivery_status)
    VALUES ('dddddddd-0000-4000-8000-000000000001'::uuid,
            'cccccccc-0000-4000-8000-000000000001'::uuid,
            'BN_LC_STATUS_PROBE', 'probe:BOGUS', 'NOT_A_STATUS');
  EXCEPTION WHEN check_violation THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'FAIL: unknown intent status was accepted'; END IF;
END $cons$;

-- =====================================================================
-- 5. Hub status mapping
-- =====================================================================
DO $map$
BEGIN
  IF public._bn_comm_map_hub_status('sent')      <> 'DISPATCHED' THEN RAISE EXCEPTION 'FAIL: sent'; END IF;
  IF public._bn_comm_map_hub_status('queued')    <> 'QUEUED'     THEN RAISE EXCEPTION 'FAIL: queued'; END IF;
  IF public._bn_comm_map_hub_status('delivered') <> 'DELIVERED'  THEN RAISE EXCEPTION 'FAIL: delivered'; END IF;
  IF public._bn_comm_map_hub_status('bounced')   <> 'FAILED'     THEN RAISE EXCEPTION 'FAIL: bounced'; END IF;
  IF public._bn_comm_map_hub_status('failed')    <> 'FAILED'     THEN RAISE EXCEPTION 'FAIL: failed'; END IF;
  IF public._bn_comm_map_hub_status('who-knows') <> 'REQUESTED'  THEN RAISE EXCEPTION 'FAIL: unknown fallback'; END IF;
END $map$;

-- =====================================================================
-- 6. Communication adapter end to end (service context)
-- =====================================================================
INSERT INTO public.bn_life_certificate_communication_intent
  (id, life_certificate_id, bn_award_id, event_code, idempotency_key, correlation_id, delivery_status, context)
VALUES (:intent::uuid, :lc_id::uuid, :award_id::uuid, 'BN_LC_REMINDER',
        'bn-lc-harness-intent-1', 'corr-bn-lc-harness', 'PENDING', '{"harness":true}'::jsonb);

DO $adapter$
DECLARE v jsonb; v_req uuid; v_req2 uuid; v_status text; v_count integer; v_lc_before jsonb; v_lc_after jsonb;
BEGIN
  RAISE NOTICE '--- communication adapter end to end ---';

  -- 6a. Visible as pending work.
  SELECT count(*) INTO v_count FROM public.bn_communication_adapter_pending_v1(200) p
   WHERE p.source_intent_id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: intent not pending (got %)', v_count; END IF;

  SELECT to_jsonb(lc) INTO v_lc_before FROM public.bn_life_certificate lc
   WHERE lc.id = 'dddddddd-0000-4000-8000-000000000001'::uuid;

  -- 6b. Dispatch.
  v := public.bn_communication_adapter_dispatch_v1('BN_LIFE_CERTIFICATE',
        'eeeeeeee-0000-4000-8000-000000000001'::uuid);
  IF v->>'status' <> 'DISPATCHED' THEN RAISE EXCEPTION 'FAIL: dispatch status %', v->>'status'; END IF;
  v_req := (v->>'communication_request_id')::uuid;

  SELECT count(*) INTO v_count FROM public.communication_request WHERE id = v_req;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: expected exactly one communication_request'; END IF;
  SELECT count(*) INTO v_count FROM public.communication_recipient WHERE request_id = v_req;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: expected exactly one recipient (got %)', v_count; END IF;

  SELECT delivery_status INTO v_status FROM public.bn_life_certificate_communication_intent
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_status <> 'REQUESTED' THEN RAISE EXCEPTION 'FAIL: intent status % after dispatch', v_status; END IF;

  -- 6c. Replay is idempotent.
  v := public.bn_communication_adapter_dispatch_v1('BN_LIFE_CERTIFICATE',
        'eeeeeeee-0000-4000-8000-000000000001'::uuid);
  v_req2 := (v->>'communication_request_id')::uuid;
  IF v->>'status' <> 'REPLAYED' OR v_req2 <> v_req THEN
    RAISE EXCEPTION 'FAIL: replay produced % / %', v->>'status', v_req2; END IF;
  SELECT count(*) INTO v_count FROM public.communication_recipient WHERE request_id = v_req;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: replay duplicated recipients'; END IF;

  -- 6d. Sync each supported Hub state through to the Benefits status.
  UPDATE public.communication_request SET status = 'queued' WHERE id = v_req;
  PERFORM public.bn_communication_adapter_sync_v1(200);
  SELECT delivery_status INTO v_status FROM public.bn_life_certificate_communication_intent
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_status <> 'QUEUED' THEN RAISE EXCEPTION 'FAIL: queued mapped to %', v_status; END IF;

  UPDATE public.communication_request SET status = 'sent' WHERE id = v_req;
  PERFORM public.bn_communication_adapter_sync_v1(200);
  SELECT delivery_status INTO v_status FROM public.bn_life_certificate_communication_intent
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_status <> 'DISPATCHED' THEN RAISE EXCEPTION 'FAIL: sent mapped to %', v_status; END IF;

  UPDATE public.communication_request SET status = 'delivered' WHERE id = v_req;
  PERFORM public.bn_communication_adapter_sync_v1(200);
  SELECT delivery_status INTO v_status FROM public.bn_life_certificate_communication_intent
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_status <> 'DELIVERED' THEN RAISE EXCEPTION 'FAIL: delivered mapped to %', v_status; END IF;

  UPDATE public.communication_request SET status = 'bounced' WHERE id = v_req;
  PERFORM public.bn_communication_adapter_sync_v1(200);
  SELECT delivery_status INTO v_status FROM public.bn_life_certificate_communication_intent
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_status <> 'FAILED' THEN RAISE EXCEPTION 'FAIL: bounced mapped to %', v_status; END IF;

  -- 6e. Unknown Hub status falls back to REQUESTED.
  UPDATE public.communication_request SET status = 'martian' WHERE id = v_req;
  PERFORM public.bn_communication_adapter_sync_v1(200);
  SELECT delivery_status INTO v_status FROM public.bn_life_certificate_communication_intent
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_status <> 'REQUESTED' THEN RAISE EXCEPTION 'FAIL: unknown Hub status mapped to %', v_status; END IF;

  -- 6f. A CANCELLED intent is never overwritten by sync.
  UPDATE public.bn_life_certificate_communication_intent SET delivery_status = 'CANCELLED'
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  UPDATE public.communication_request SET status = 'delivered' WHERE id = v_req;
  PERFORM public.bn_communication_adapter_sync_v1(200);
  SELECT delivery_status INTO v_status FROM public.bn_life_certificate_communication_intent
   WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'::uuid;
  IF v_status <> 'CANCELLED' THEN RAISE EXCEPTION 'FAIL: CANCELLED intent overwritten with %', v_status; END IF;

  -- 6g. A dispatch failure never mutates the Life Certificate obligation.
  PERFORM public.bn_communication_adapter_record_failure_v1('BN_LIFE_CERTIFICATE',
            'eeeeeeee-0000-4000-8000-000000000001'::uuid, 'E_PROVIDER_DOWN');
  SELECT to_jsonb(lc) INTO v_lc_after FROM public.bn_life_certificate lc
   WHERE lc.id = 'dddddddd-0000-4000-8000-000000000001'::uuid;
  IF (v_lc_before - 'modified_at') <> (v_lc_after - 'modified_at') THEN
    RAISE EXCEPTION 'FAIL: adapter activity mutated the Life Certificate obligation';
  END IF;

  -- 6h. Unregistered source modules are rejected.
  BEGIN
    v := public.bn_communication_adapter_dispatch_v1('BN_NOT_REGISTERED',
          'eeeeeeee-0000-4000-8000-000000000001'::uuid);
    RAISE EXCEPTION 'FAIL: unregistered source module accepted';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL;
  END;
END $adapter$;

DO $done$ BEGIN RAISE NOTICE 'BN_LC_HARNESS_RESULT: PASS (all scenarios executed, nothing skipped)'; END $done$;

ROLLBACK;
