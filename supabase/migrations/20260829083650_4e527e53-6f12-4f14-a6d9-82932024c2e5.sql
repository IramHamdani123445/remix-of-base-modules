DO $$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'ce_approve_partial_payment_v1'
    AND pronamespace = 'public'::regnamespace;

  v_new := replace(v_src,
    E'     public_notes, internal_notes, outstanding_amount, created_by, updated_by)',
    E'     public_notes, internal_notes, created_by, updated_by)');

  v_new := replace(v_new,
    E'     coalesce(p_comments,\'\'), round(p_approved_amount,2), v_actor, v_actor);',
    E'     coalesce(p_comments,\'\'), v_actor, v_actor);');

  IF v_new = v_src THEN
    RAISE EXCEPTION 'ce_approve_partial_payment_v1: expected invoice insert not found — aborting';
  END IF;

  EXECUTE v_new;
END $$;