-- =====================================================================
-- BN Medical Reviews — idempotency hardening (forward-only)
-- Adds semantic-payload comparison and controlled errors.
-- =====================================================================

CREATE OR REPLACE FUNCTION public._bn_mr_semantic_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  -- Optimistic-concurrency metadata is deliberately excluded so the same
  -- business intent can be retried after a version refresh. Every business
  -- field (entity, provider, time, outcome, reason, decision, determination,
  -- proposal kind) remains part of the fingerprint.
  SELECT (COALESCE(p_payload, '{}'::jsonb) - 'version' - 'expected_row_version' - 'row_version')
$function$;

REVOKE ALL ON FUNCTION public._bn_mr_semantic_payload(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bn_mr_cmd_begin(p_command text, p_idem text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; v_fp text;
BEGIN
  IF p_idem IS NULL OR btrim(p_idem) = '' THEN
    RAISE EXCEPTION 'E_IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE='P0001';
  END IF;

  v_fp := public._bn_mr_fingerprint(public._bn_mr_semantic_payload(p_payload));

  SELECT * INTO r FROM public.bn_medical_review_idempotency
   WHERE idempotency_key = p_idem;

  IF r.idempotency_key IS NULL THEN
    RETURN NULL;
  END IF;

  IF r.command_code IS DISTINCT FROM p_command THEN
    RAISE EXCEPTION 'E_IDEMPOTENCY_KEY_REUSED' USING ERRCODE='P0001';
  END IF;

  IF r.request_fingerprint IS DISTINCT FROM v_fp THEN
    RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH' USING ERRCODE='P0001';
  END IF;

  RETURN r.response || jsonb_build_object('replayed', true);
END $function$;

CREATE OR REPLACE FUNCTION public._bn_mr_cmd_finish(p_command text, p_idem text, p_payload jsonb, p_response jsonb, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; v_fp text; v_inserted boolean := false;
BEGIN
  v_fp := public._bn_mr_fingerprint(public._bn_mr_semantic_payload(p_payload));

  INSERT INTO public.bn_medical_review_idempotency
    (idempotency_key, command_code, request_fingerprint, response, actor_user_id)
  VALUES (p_idem, p_command, v_fp, p_response, p_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted THEN
    RETURN p_response;
  END IF;

  -- Concurrent insert conflict: only replay when command AND semantic
  -- fingerprint both match the stored row.
  SELECT * INTO r FROM public.bn_medical_review_idempotency
   WHERE idempotency_key = p_idem;

  IF r.command_code IS DISTINCT FROM p_command THEN
    RAISE EXCEPTION 'E_IDEMPOTENCY_KEY_REUSED' USING ERRCODE='P0001';
  END IF;
  IF r.request_fingerprint IS DISTINCT FROM v_fp THEN
    RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH' USING ERRCODE='P0001';
  END IF;

  RETURN r.response || jsonb_build_object('replayed', true);
END $function$;

REVOKE ALL ON FUNCTION public._bn_mr_cmd_begin(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_mr_cmd_finish(text, text, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;