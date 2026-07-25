-- Phase 4B3 hotfix: Preview gate canonical status + delivery-attempt join
-- Root cause:
--   1. get_comm_hub_go_live_gate_snapshot required v_snap.status = 'ACTIVE',
--      but the CHECK constraint on communication_preview_snapshot allows only
--      ('PREPARED','SUPERSEDED','EXPIRED','REVOKED'). Fresh snapshots therefore
--      never pass the Preview gate.
--   2. The same function joined communication_delivery_attempt on a
--      non-existent request_id column, causing
--      "column request_id does not exist" during gate evaluation. Delivery
--      attempts are linked to messages (message_id), and messages hold
--      request_id.

DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(oid)
    INTO v_def
    FROM pg_proc
   WHERE proname = 'get_comm_hub_go_live_gate_snapshot'
     AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_comm_hub_go_live_gate_snapshot not found';
  END IF;

  -- Fix (2): join delivery attempts via communication_message.
  v_def := replace(
    v_def,
    'SELECT count(*) INTO v_delivery_attempts FROM communication_delivery_attempt WHERE request_id = v_exec.request_id;',
    'SELECT count(*) INTO v_delivery_attempts
       FROM communication_delivery_attempt da
       JOIN communication_message m ON m.id = da.message_id
      WHERE m.request_id = v_exec.request_id;'
  );

  -- Fix (1a): canonical ready state for a Preview snapshot is PREPARED,
  -- not ACTIVE. Zero-required-unresolved + populated hashes remains the
  -- readiness contract.
  v_def := replace(
    v_def,
    'ELSIF v_snap.status = ''ACTIVE'' AND COALESCE(jsonb_array_length(v_snap.unresolved_variables),0) = 0',
    'ELSIF v_snap.status = ''PREPARED'' AND COALESCE(jsonb_array_length(v_snap.unresolved_variables),0) = 0'
  );

  -- Fix (1b): summary text and required_value display should also read PREPARED.
  v_def := replace(
    v_def,
    'v_status := ''PASSED''; v_summary := ''Preview snapshot is active with zero unresolved variables.'';',
    'v_status := ''PASSED''; v_summary := ''Preview snapshot is prepared with zero unresolved variables.'';'
  );
  v_def := replace(
    v_def,
    '''required_value'',''ACTIVE with zero unresolved variables''',
    '''required_value'',''PREPARED with zero unresolved variables, populated content and recipient hashes'''
  );

  -- Guard: refuse to deploy a definition that still contains the broken idioms.
  IF v_def ~ 'communication_delivery_attempt WHERE request_id' THEN
    RAISE EXCEPTION 'patch failed: legacy delivery_attempt.request_id predicate still present';
  END IF;
  IF v_def ~ 'v_snap.status = ''ACTIVE''' THEN
    RAISE EXCEPTION 'patch failed: legacy ACTIVE snapshot check still present';
  END IF;

  EXECUTE v_def;
END
$mig$;

-- Regression probe: run the gate for the most recent PREPARED snapshot
-- for APPEALS/APPEAL_RECEIVED_NOTICE and assert Preview passes.
DO $regress$
DECLARE
  v_snap_id uuid;
  v_snap_status text;
  v_snap_unresolved int;
  v_result jsonb;
  v_preview jsonb;
  v_preview_status text;
BEGIN
  SELECT id, status, COALESCE(jsonb_array_length(unresolved_variables),0)
    INTO v_snap_id, v_snap_status, v_snap_unresolved
    FROM public.communication_preview_snapshot
   WHERE module_code = 'APPEALS' AND event_code = 'APPEAL_RECEIVED_NOTICE'
     AND status = 'PREPARED'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_snap_id IS NULL THEN
    RAISE NOTICE 'regression: no PREPARED snapshot present for APPEALS/APPEAL_RECEIVED_NOTICE; skipping evaluation';
    RETURN;
  END IF;

  v_result := public.get_comm_hub_go_live_gate_snapshot(
    'APPEALS','APPEAL_RECEIVED_NOTICE','email', v_snap_id, NULL, NULL
  );

  SELECT g INTO v_preview
    FROM jsonb_array_elements(v_result->'gates') g
   WHERE g->>'id' = 'preview.snapshot'
   LIMIT 1;

  v_preview_status := v_preview->>'status';
  IF v_preview_status <> 'PASSED' THEN
    RAISE EXCEPTION 'regression FAIL: expected preview.snapshot PASSED, got % (snapshot=% status=% unresolved=%)',
      v_preview_status, v_snap_id, v_snap_status, v_snap_unresolved;
  END IF;

  RAISE NOTICE 'regression PASS: preview.snapshot=PASSED for snapshot %', v_snap_id;
END
$regress$;