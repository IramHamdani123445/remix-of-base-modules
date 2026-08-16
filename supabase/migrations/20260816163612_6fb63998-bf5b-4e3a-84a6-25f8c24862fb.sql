-- ── Print Phase 3B: governed print batches & reconciliation ──────────────

CREATE SEQUENCE IF NOT EXISTS public.omni_comms_print_batch_ref_seq;

CREATE TABLE public.omni_comms_print_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  batch_reference text NOT NULL UNIQUE,
  production_account_id uuid REFERENCES public.omni_comms_provider_account(id),
  profile_signature text NOT NULL,
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  cancellation_reason text,
  reconciliation_override_reason text,
  reconciliation_snapshot jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  locked_at timestamptz,
  locked_by uuid,
  started_at timestamptz,
  started_by uuid,
  reconciled_at timestamptz,
  reconciled_by uuid,
  completed_at timestamptz,
  completed_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_print_batch_status_chk CHECK (status IN
    ('draft','ready','locked','in_production','reconciling','completed','cancelled'))
);

CREATE INDEX omni_comms_print_batch_org_idx
  ON public.omni_comms_print_batch (organization_id, status, created_at DESC);

CREATE TABLE public.omni_comms_print_batch_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.omni_comms_print_batch(id) ON DELETE CASCADE,
  print_item_id uuid NOT NULL REFERENCES public.omni_comms_print_item(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  membership_status text NOT NULL DEFAULT 'active',
  expected_pages integer,
  expected_copies integer NOT NULL DEFAULT 1,
  profile_signature text NOT NULL,
  deferral_reason text,
  removal_reason text,
  closed_outcome text,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  CONSTRAINT omni_comms_print_batch_item_membership_chk CHECK (membership_status IN
    ('active','removed_before_lock','deferred','closed')),
  CONSTRAINT omni_comms_print_batch_item_unique UNIQUE (batch_id, print_item_id)
);

-- History across batches is allowed; only ONE active production membership.
CREATE UNIQUE INDEX omni_comms_print_batch_item_active_uniq
  ON public.omni_comms_print_batch_item (print_item_id)
  WHERE membership_status = 'active';

CREATE INDEX omni_comms_print_batch_item_batch_idx
  ON public.omni_comms_print_batch_item (batch_id, sequence_number);
CREATE INDEX omni_comms_print_batch_item_item_idx
  ON public.omni_comms_print_batch_item (print_item_id, added_at DESC);

ALTER TABLE public.omni_comms_print_attempt
  ADD COLUMN IF NOT EXISTS print_batch_id uuid REFERENCES public.omni_comms_print_batch(id);

CREATE INDEX IF NOT EXISTS omni_comms_print_attempt_batch_idx
  ON public.omni_comms_print_attempt (print_batch_id);

GRANT SELECT ON public.omni_comms_print_batch TO authenticated;
GRANT SELECT ON public.omni_comms_print_batch_item TO authenticated;
GRANT ALL ON public.omni_comms_print_batch TO service_role;
GRANT ALL ON public.omni_comms_print_batch_item TO service_role;

-- ── Deterministic production-profile compatibility signature ─────────────

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_profile_signature(
  p_profile jsonb, p_production_account_id uuid
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT lower(concat_ws('|',
    coalesce(p_production_account_id::text, 'no-account'),
    coalesce(nullif(btrim(p_profile->>'paper_size'),''), 'A4'),
    coalesce(nullif(btrim(p_profile->>'sides'),''), 'simplex'),
    coalesce(nullif(btrim(p_profile->>'colour_mode'),''), 'black_white'),
    coalesce(nullif(btrim(p_profile->>'letterhead_profile'),''), 'default'),
    coalesce(nullif(btrim(p_profile->>'envelope_profile'),''), 'default'),
    coalesce((
      SELECT string_agg(v, ',' ORDER BY v)
      FROM (
        SELECT DISTINCT btrim(x::text, '"') AS v
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_profile->'inserts') = 'array'
               THEN p_profile->'inserts' ELSE '[]'::jsonb END) x
      ) s), 'none'),
    coalesce(nullif(btrim(p_profile->>'special_handling'),''), 'none')
  ));
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_batch_transition_allowed(
  p_from text, p_to text
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT (p_from, p_to) IN (
    ('draft','ready'), ('draft','cancelled'),
    ('ready','draft'), ('ready','locked'), ('ready','cancelled'),
    ('locked','ready'), ('locked','in_production'),
    ('in_production','reconciling'),
    ('reconciling','in_production'), ('reconciling','completed')
  );
$$;

-- ── Evidence-derived reconciliation ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_batch_accounting(p_batch_id uuid)
RETURNS TABLE (
  batch_item_id uuid,
  print_item_id uuid,
  letter_reference text,
  membership_status text,
  physical_status text,
  expected_pages integer,
  expected_copies integer,
  batch_attempts integer,
  spoiled_or_failed_in_batch integer,
  printed_in_batch integer,
  accounting_state text
)
LANGUAGE sql STABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT
    bi.id,
    i.id,
    i.letter_reference,
    bi.membership_status,
    i.physical_status,
    coalesce(bi.expected_pages, i.page_count),
    bi.expected_copies,
    (SELECT count(*)::int FROM public.omni_comms_print_attempt a
      WHERE a.print_item_id = i.id AND a.print_batch_id = bi.batch_id),
    (SELECT count(*)::int FROM public.omni_comms_print_attempt a
      WHERE a.print_item_id = i.id AND a.print_batch_id = bi.batch_id
        AND a.outcome IN ('failed','spoiled')),
    (SELECT count(*)::int FROM public.omni_comms_print_attempt a
      WHERE a.print_item_id = i.id AND a.print_batch_id = bi.batch_id
        AND a.outcome = 'printed'),
    CASE
      WHEN bi.membership_status = 'removed_before_lock' THEN 'removed_before_lock'
      WHEN bi.membership_status = 'deferred' THEN 'deferred'
      WHEN i.physical_status = 'printed'
           AND EXISTS (SELECT 1 FROM public.omni_comms_print_attempt a
                        WHERE a.print_item_id = i.id AND a.print_batch_id = bi.batch_id
                          AND a.outcome IN ('failed','spoiled'))
        THEN 'reprinted_successfully'
      WHEN i.physical_status = 'printed' THEN 'printed'
      WHEN i.physical_status = 'print_failed' THEN 'failed'
      WHEN i.physical_status = 'spoiled' THEN 'spoiled'
      WHEN i.physical_status = 'held' THEN 'held'
      WHEN i.physical_status = 'printing' THEN 'in_progress'
      WHEN EXISTS (SELECT 1 FROM public.omni_comms_print_attempt a
                    WHERE a.print_item_id = i.id AND a.print_batch_id = bi.batch_id
                      AND a.outcome IN ('failed','spoiled'))
        THEN 'reprint_required'
      ELSE 'pending'
    END
  FROM public.omni_comms_print_batch_item bi
  JOIN public.omni_comms_print_item i ON i.id = bi.print_item_id
  WHERE bi.batch_id = p_batch_id
  ORDER BY bi.sequence_number;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_batch_reconciliation(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v jsonb;
  v_expected int; v_pages int; v_copies int;
  v_printed int; v_reprinted int; v_failed int; v_spoiled int;
  v_held int; v_deferred int; v_removed int; v_pending int;
  v_inprog int; v_reprint_req int;
BEGIN
  SELECT
    count(*) FILTER (WHERE accounting_state <> 'removed_before_lock'),
    coalesce(sum(coalesce(expected_pages,0) * greatest(expected_copies,1))
             FILTER (WHERE accounting_state <> 'removed_before_lock'), 0),
    coalesce(sum(greatest(expected_copies,1))
             FILTER (WHERE accounting_state <> 'removed_before_lock'), 0),
    count(*) FILTER (WHERE accounting_state = 'printed'),
    count(*) FILTER (WHERE accounting_state = 'reprinted_successfully'),
    count(*) FILTER (WHERE accounting_state = 'failed'),
    count(*) FILTER (WHERE accounting_state = 'spoiled'),
    count(*) FILTER (WHERE accounting_state = 'held'),
    count(*) FILTER (WHERE accounting_state = 'deferred'),
    count(*) FILTER (WHERE accounting_state = 'removed_before_lock'),
    count(*) FILTER (WHERE accounting_state = 'pending'),
    count(*) FILTER (WHERE accounting_state = 'in_progress'),
    count(*) FILTER (WHERE accounting_state = 'reprint_required')
  INTO v_expected, v_pages, v_copies, v_printed, v_reprinted, v_failed,
       v_spoiled, v_held, v_deferred, v_removed, v_pending, v_inprog, v_reprint_req
  FROM public.omni_comms_priv_print_batch_accounting(p_batch_id);

  v := jsonb_build_object(
    'expected_items',        v_expected,
    'expected_pages',        v_pages,
    'expected_copies',       v_copies,
    'printed',               v_printed,
    'reprinted_successfully', v_reprinted,
    'printed_satisfied',     v_printed + v_reprinted,
    'failed',                v_failed,
    'spoiled',               v_spoiled,
    'held',                  v_held,
    'deferred',              v_deferred,
    'removed_before_lock',   v_removed,
    'pending',               v_pending,
    'in_progress',           v_inprog,
    'reprint_required',      v_reprint_req,
    'unaccounted',           v_pending + v_inprog + v_reprint_req + v_failed + v_spoiled + v_held,
    'computed_at',           now()
  );
  v := v || jsonb_build_object(
    'reconciled',
    (v_pending + v_inprog + v_reprint_req + v_failed + v_spoiled + v_held) = 0
    AND (v_printed + v_reprinted + v_deferred) = v_expected);
  RETURN v;
END;
$$;

-- ── Batch creation ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_batch_preview(
  p_organization_id uuid,
  p_print_item_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_rows jsonb;
  v_sigs text[];
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'print_item_id', i.id,
           'letter_reference', i.letter_reference,
           'physical_status', i.physical_status,
           'page_count', i.page_count,
           'copies', greatest(coalesce((i.production_profile->>'copies')::int, 1), 1),
           'production_account_id', i.production_account_id,
           'production_account_name', pa.display_name,
           'production_profile', i.production_profile,
           'profile_signature',
             public.omni_comms_priv_print_profile_signature(i.production_profile, i.production_account_id),
           'eligible', i.physical_status = 'queued_for_print'
             AND NOT EXISTS (SELECT 1 FROM public.omni_comms_print_batch_item bi
                              WHERE bi.print_item_id = i.id AND bi.membership_status = 'active'),
           'blocker', CASE
             WHEN i.physical_status <> 'queued_for_print' THEN 'not_queued_for_print'
             WHEN EXISTS (SELECT 1 FROM public.omni_comms_print_batch_item bi
                           WHERE bi.print_item_id = i.id AND bi.membership_status = 'active')
               THEN 'already_in_active_batch'
             ELSE NULL END
         ) ORDER BY i.letter_reference), '[]'::jsonb)
  INTO v_rows
  FROM public.omni_comms_print_item i
  LEFT JOIN public.omni_comms_provider_account pa ON pa.id = i.production_account_id
  WHERE i.organization_id = p_organization_id
    AND i.id = ANY (coalesce(p_print_item_ids, ARRAY[]::uuid[]));

  SELECT array_agg(DISTINCT r->>'profile_signature') INTO v_sigs
  FROM jsonb_array_elements(v_rows) r;

  RETURN jsonb_build_object(
    'items', v_rows,
    'selected_count', jsonb_array_length(v_rows),
    'total_pages', coalesce((SELECT sum(((r->>'page_count')::int) * greatest((r->>'copies')::int,1))
                             FROM jsonb_array_elements(v_rows) r), 0),
    'total_copies', coalesce((SELECT sum(greatest((r->>'copies')::int,1))
                              FROM jsonb_array_elements(v_rows) r), 0),
    'distinct_profiles', coalesce(array_length(v_sigs,1), 0),
    'profile_signatures', to_jsonb(coalesce(v_sigs, ARRAY[]::text[])),
    'compatible', coalesce(array_length(v_sigs,1), 0) <= 1
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r
                       WHERE (r->>'eligible')::boolean IS NOT TRUE),
    'generated_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_batch_create(
  p_organization_id uuid,
  p_print_item_ids uuid[],
  p_notes text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('operate');
  v_batch public.omni_comms_print_batch%ROWTYPE;
  v_item public.omni_comms_print_item%ROWTYPE;
  v_sig text;
  v_first_sig text;
  v_account uuid;
  v_ref text;
  v_seq int := 0;
  v_id uuid;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  IF p_print_item_ids IS NULL OR array_length(p_print_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'OC422 no_items_selected'
      USING ERRCODE='P0001', DETAIL='no_items_selected';
  END IF;

  v_ref := 'PB-' || to_char(now(), 'YYYY') || '-' ||
           lpad(nextval('public.omni_comms_print_batch_ref_seq')::text, 6, '0');

  FOR v_item IN
    SELECT * FROM public.omni_comms_print_item
     WHERE id = ANY (p_print_item_ids) ORDER BY letter_reference FOR UPDATE
  LOOP
    IF v_item.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'OC403 cross_tenant_item'
        USING ERRCODE='P0001', DETAIL='cross_tenant_item';
    END IF;
    IF v_item.physical_status <> 'queued_for_print' THEN
      RAISE EXCEPTION 'OC412 item_not_queued_for_print'
        USING ERRCODE='P0001', DETAIL=v_item.letter_reference;
    END IF;

    v_sig := public.omni_comms_priv_print_profile_signature(
               v_item.production_profile, v_item.production_account_id);

    IF v_first_sig IS NULL THEN
      v_first_sig := v_sig;
      v_account := v_item.production_account_id;

      INSERT INTO public.omni_comms_print_batch (
        organization_id, department_id, batch_reference, production_account_id,
        profile_signature, profile_snapshot, status, notes, created_by, updated_by
      ) VALUES (
        p_organization_id, coalesce(p_department_id, v_item.department_id), v_ref,
        v_item.production_account_id, v_sig,
        jsonb_strip_nulls(jsonb_build_object(
          'paper_size', v_item.production_profile->>'paper_size',
          'sides', v_item.production_profile->>'sides',
          'colour_mode', v_item.production_profile->>'colour_mode',
          'letterhead_profile', v_item.production_profile->>'letterhead_profile',
          'envelope_profile', v_item.production_profile->>'envelope_profile',
          'inserts', v_item.production_profile->'inserts',
          'special_handling', v_item.production_profile->>'special_handling')),
        'draft', nullif(btrim(coalesce(p_notes,'')),''), v_uid, v_uid
      ) RETURNING * INTO v_batch;
    ELSIF v_sig <> v_first_sig THEN
      RAISE EXCEPTION 'OC412 incompatible_production_profile'
        USING ERRCODE='P0001', DETAIL=v_item.letter_reference;
    END IF;

    v_seq := v_seq + 1;
    BEGIN
      INSERT INTO public.omni_comms_print_batch_item (
        batch_id, print_item_id, organization_id, sequence_number,
        expected_pages, expected_copies, profile_signature, added_by
      ) VALUES (
        v_batch.id, v_item.id, p_organization_id, v_seq,
        v_item.page_count,
        greatest(coalesce((v_item.production_profile->>'copies')::int, 1), 1),
        v_sig, v_uid);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'OC409 item_already_in_active_batch'
        USING ERRCODE='P0001', DETAIL=v_item.letter_reference;
    END;
  END LOOP;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_item_not_found'
      USING ERRCODE='P0001', DETAIL='print_item_not_found';
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, metadata)
  VALUES (v_uid, 'omni_comms.print_batch.created', 'omni_comms', 'omni_comms_print_batch',
          v_batch.id::text, jsonb_build_object(
            'batch_reference', v_batch.batch_reference,
            'item_count', v_seq,
            'profile_signature', v_first_sig));

  RETURN jsonb_build_object(
    'id', v_batch.id,
    'batch_reference', v_batch.batch_reference,
    'status', v_batch.status,
    'version', v_batch.version,
    'item_count', v_seq,
    'profile_signature', v_first_sig,
    'production_account_id', v_account);
END;
$$;

-- ── Membership mutation (editable states only) ───────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_batch_membership(
  p_batch_id uuid,
  p_operation text,
  p_print_item_ids uuid[],
  p_expected_version integer,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('operate');
  v_batch public.omni_comms_print_batch%ROWTYPE;
  v_item public.omni_comms_print_item%ROWTYPE;
  v_sig text;
  v_seq int;
  v_changed int := 0;
BEGIN
  SELECT * INTO v_batch FROM public.omni_comms_print_batch WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_batch_not_found'
      USING ERRCODE='P0001', DETAIL='print_batch_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_batch.organization_id, NULL);

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_batch.version THEN
    RAISE EXCEPTION 'OC413 concurrent_update'
      USING ERRCODE='P0001', DETAIL='concurrent_update';
  END IF;

  IF v_batch.status NOT IN ('draft','ready') THEN
    RAISE EXCEPTION 'OC412 batch_membership_locked'
      USING ERRCODE='P0001', DETAIL=v_batch.status;
  END IF;

  IF p_operation NOT IN ('add','remove') THEN
    RAISE EXCEPTION 'OC422 unknown_membership_operation'
      USING ERRCODE='P0001', DETAIL=p_operation;
  END IF;

  SELECT coalesce(max(sequence_number), 0) INTO v_seq
  FROM public.omni_comms_print_batch_item WHERE batch_id = v_batch.id;

  IF p_operation = 'add' THEN
    FOR v_item IN
      SELECT * FROM public.omni_comms_print_item
       WHERE id = ANY (coalesce(p_print_item_ids, ARRAY[]::uuid[]))
       ORDER BY letter_reference FOR UPDATE
    LOOP
      IF v_item.organization_id <> v_batch.organization_id THEN
        RAISE EXCEPTION 'OC403 cross_tenant_item'
          USING ERRCODE='P0001', DETAIL='cross_tenant_item';
      END IF;
      IF v_item.physical_status <> 'queued_for_print' THEN
        RAISE EXCEPTION 'OC412 item_not_queued_for_print'
          USING ERRCODE='P0001', DETAIL=v_item.letter_reference;
      END IF;
      v_sig := public.omni_comms_priv_print_profile_signature(
                 v_item.production_profile, v_item.production_account_id);
      IF v_sig <> v_batch.profile_signature THEN
        RAISE EXCEPTION 'OC412 incompatible_production_profile'
          USING ERRCODE='P0001', DETAIL=v_item.letter_reference;
      END IF;
      v_seq := v_seq + 1;
      BEGIN
        INSERT INTO public.omni_comms_print_batch_item (
          batch_id, print_item_id, organization_id, sequence_number,
          expected_pages, expected_copies, profile_signature, added_by
        ) VALUES (
          v_batch.id, v_item.id, v_batch.organization_id, v_seq,
          v_item.page_count,
          greatest(coalesce((v_item.production_profile->>'copies')::int, 1), 1),
          v_sig, v_uid);
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'OC409 item_already_in_active_batch'
          USING ERRCODE='P0001', DETAIL=v_item.letter_reference;
      END;
      v_changed := v_changed + 1;
    END LOOP;
  ELSE
    UPDATE public.omni_comms_print_batch_item
       SET membership_status = 'removed_before_lock',
           removal_reason = nullif(btrim(coalesce(p_reason,'')),''),
           closed_at = now(), closed_by = v_uid, closed_outcome = 'removed_before_lock'
     WHERE batch_id = v_batch.id
       AND membership_status = 'active'
       AND print_item_id = ANY (coalesce(p_print_item_ids, ARRAY[]::uuid[]));
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  UPDATE public.omni_comms_print_batch
     SET version = version + 1, updated_at = now(), updated_by = v_uid
   WHERE id = v_batch.id RETURNING * INTO v_batch;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, metadata)
  VALUES (v_uid, 'omni_comms.print_batch.membership_' || p_operation, 'omni_comms',
          'omni_comms_print_batch', v_batch.id::text,
          jsonb_strip_nulls(jsonb_build_object('changed', v_changed, 'reason', p_reason)));

  RETURN jsonb_build_object(
    'id', v_batch.id, 'status', v_batch.status,
    'version', v_batch.version, 'changed', v_changed);
END;
$$;

-- ── Governed defer / hold out of an active batch ─────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_batch_defer_item(
  p_batch_id uuid,
  p_print_item_id uuid,
  p_reason text,
  p_expected_item_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('operate');
  v_batch public.omni_comms_print_batch%ROWTYPE;
  v_item public.omni_comms_print_item%ROWTYPE;
  v_member public.omni_comms_print_batch_item%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'OC422 reason_required'
      USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;

  SELECT * INTO v_batch FROM public.omni_comms_print_batch WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_batch_not_found'
      USING ERRCODE='P0001', DETAIL='print_batch_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_batch.organization_id, NULL);

  IF v_batch.status NOT IN ('locked','in_production','reconciling') THEN
    RAISE EXCEPTION 'OC412 batch_not_deferrable'
      USING ERRCODE='P0001', DETAIL=v_batch.status;
  END IF;

  SELECT * INTO v_member FROM public.omni_comms_print_batch_item
   WHERE batch_id = v_batch.id AND print_item_id = p_print_item_id
     AND membership_status = 'active' FOR UPDATE;
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'OC404 batch_item_not_found'
      USING ERRCODE='P0001', DETAIL='batch_item_not_found';
  END IF;

  SELECT * INTO v_item FROM public.omni_comms_print_item
   WHERE id = p_print_item_id FOR UPDATE;

  IF p_expected_item_version IS NOT NULL AND p_expected_item_version <> v_item.version THEN
    RAISE EXCEPTION 'OC413 concurrent_update'
      USING ERRCODE='P0001', DETAIL='concurrent_update';
  END IF;

  IF v_item.physical_status = 'printing' THEN
    RAISE EXCEPTION 'OC412 attempt_in_progress'
      USING ERRCODE='P0001', DETAIL='attempt_in_progress';
  END IF;

  -- The print item leaves this production run but remains alive for a later one.
  IF v_item.physical_status <> 'held'
     AND public.omni_comms_priv_print_transition_allowed(v_item.physical_status, 'held') THEN
    UPDATE public.omni_comms_print_item
       SET physical_status = 'held', hold_reason = p_reason,
           version = version + 1, updated_at = now(), updated_by = v_uid
     WHERE id = v_item.id;
  END IF;

  UPDATE public.omni_comms_print_batch_item
     SET membership_status = 'deferred', deferral_reason = p_reason,
         closed_outcome = 'deferred', closed_at = now(), closed_by = v_uid
   WHERE id = v_member.id;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, metadata)
  VALUES (v_uid, 'omni_comms.print_batch.item_deferred', 'omni_comms',
          'omni_comms_print_batch_item', v_member.id::text,
          jsonb_build_object('batch_id', v_batch.id, 'print_item_id', p_print_item_id,
                             'reason', p_reason));

  RETURN jsonb_build_object(
    'batch_id', v_batch.id, 'print_item_id', p_print_item_id,
    'membership_status', 'deferred');
END;
$$;

-- ── Governed batch lifecycle ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_batch_action(
  p_id uuid,
  p_action text,
  p_expected_version integer,
  p_reason text DEFAULT NULL,
  p_equipment_reference text DEFAULT NULL,
  p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('operate');
  v_batch public.omni_comms_print_batch%ROWTYPE;
  v_next text;
  v_before jsonb;
  v_rec jsonb;
  v_started int := 0;
  v_item record;
BEGIN
  SELECT * INTO v_batch FROM public.omni_comms_print_batch WHERE id = p_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_batch_not_found'
      USING ERRCODE='P0001', DETAIL='print_batch_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_batch.organization_id, NULL);

  IF v_batch.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'OC412 batch_immutable'
      USING ERRCODE='P0001', DETAIL=v_batch.status;
  END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_batch.version THEN
    RAISE EXCEPTION 'OC413 concurrent_update'
      USING ERRCODE='P0001', DETAIL='concurrent_update';
  END IF;

  v_next := CASE p_action
    WHEN 'mark_ready'          THEN 'ready'
    WHEN 'revert_to_draft'     THEN 'draft'
    WHEN 'lock'                THEN 'locked'
    WHEN 'unlock'              THEN 'ready'
    WHEN 'start_production'    THEN 'in_production'
    WHEN 'begin_reconciliation' THEN 'reconciling'
    WHEN 'resume_production'   THEN 'in_production'
    WHEN 'complete'            THEN 'completed'
    WHEN 'cancel'              THEN 'cancelled'
    ELSE NULL END;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'OC422 unknown_batch_action'
      USING ERRCODE='P0001', DETAIL=p_action;
  END IF;

  IF p_action = 'cancel' AND v_batch.status NOT IN ('draft','ready') THEN
    RAISE EXCEPTION 'OC412 batch_not_cancellable'
      USING ERRCODE='P0001', DETAIL=v_batch.status;
  END IF;

  IF NOT public.omni_comms_priv_print_batch_transition_allowed(v_batch.status, v_next) THEN
    RAISE EXCEPTION 'OC412 invalid_batch_transition'
      USING ERRCODE='P0001', DETAIL=format('%s->%s', v_batch.status, v_next);
  END IF;

  IF p_action IN ('cancel','unlock') AND coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'OC422 reason_required'
      USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;

  IF p_action IN ('mark_ready','lock') THEN
    IF NOT EXISTS (SELECT 1 FROM public.omni_comms_print_batch_item
                    WHERE batch_id = v_batch.id AND membership_status = 'active') THEN
      RAISE EXCEPTION 'OC412 batch_empty'
        USING ERRCODE='P0001', DETAIL='batch_empty';
    END IF;
  END IF;

  v_before := public.omni_comms_priv_print_batch_reconciliation(v_batch.id);

  -- Physical production start: reuse the existing Print Item state machine
  -- and the existing immutable Print Attempt model.
  IF p_action = 'start_production' THEN
    FOR v_item IN
      SELECT i.* FROM public.omni_comms_print_batch_item bi
      JOIN public.omni_comms_print_item i ON i.id = bi.print_item_id
      WHERE bi.batch_id = v_batch.id AND bi.membership_status = 'active'
        AND i.physical_status = 'queued_for_print'
      ORDER BY bi.sequence_number
      FOR UPDATE OF i
    LOOP
      INSERT INTO public.omni_comms_print_attempt (
        print_item_id, organization_id, attempt_number, print_batch_id,
        production_provider_id, production_account_id, operator_id,
        equipment_reference, outcome, idempotency_key
      ) VALUES (
        v_item.id, v_item.organization_id, v_item.attempt_count + 1, v_batch.id,
        (SELECT provider_id FROM public.omni_comms_provider_account
          WHERE id = coalesce(v_item.production_account_id, v_batch.production_account_id)),
        coalesce(v_item.production_account_id, v_batch.production_account_id), v_uid,
        p_equipment_reference, 'in_progress',
        v_item.id::text || ':' || (v_item.attempt_count + 1)::text);

      UPDATE public.omni_comms_print_item
         SET physical_status = 'printing',
             attempt_count = attempt_count + 1,
             version = version + 1,
             updated_at = now(), updated_by = v_uid
       WHERE id = v_item.id;
      v_started := v_started + 1;
    END LOOP;
  END IF;

  IF p_action = 'complete' THEN
    v_rec := public.omni_comms_priv_print_batch_reconciliation(v_batch.id);
    IF (v_rec->>'reconciled')::boolean IS NOT TRUE THEN
      IF NOT p_override THEN
        RAISE EXCEPTION 'OC412 batch_not_reconciled'
          USING ERRCODE='P0001', DETAIL=v_rec::text;
      END IF;
      IF coalesce(btrim(p_reason),'') = '' THEN
        RAISE EXCEPTION 'OC422 override_reason_required'
          USING ERRCODE='P0001', DETAIL='override_reason_required';
      END IF;
      -- Exceptional operational override requires elevated governance rights.
      PERFORM public.omni_comms_priv_require_capability('configure');
      IF EXISTS (SELECT 1 FROM public.omni_comms_priv_print_batch_accounting(v_batch.id)
                  WHERE accounting_state = 'in_progress') THEN
        RAISE EXCEPTION 'OC412 attempt_in_progress'
          USING ERRCODE='P0001', DETAIL='attempt_in_progress';
      END IF;
    END IF;

    UPDATE public.omni_comms_print_batch_item
       SET membership_status = 'closed',
           closed_outcome = a.accounting_state,
           closed_at = now(), closed_by = v_uid
      FROM public.omni_comms_priv_print_batch_accounting(v_batch.id) a
     WHERE omni_comms_print_batch_item.id = a.batch_item_id
       AND omni_comms_print_batch_item.membership_status = 'active';
  END IF;

  UPDATE public.omni_comms_print_batch
     SET status = v_next,
         version = version + 1,
         updated_at = now(), updated_by = v_uid,
         locked_at = CASE WHEN p_action = 'lock' THEN now() ELSE locked_at END,
         locked_by = CASE WHEN p_action = 'lock' THEN v_uid ELSE locked_by END,
         started_at = CASE WHEN p_action = 'start_production' AND started_at IS NULL
                           THEN now() ELSE started_at END,
         started_by = CASE WHEN p_action = 'start_production' AND started_by IS NULL
                           THEN v_uid ELSE started_by END,
         reconciled_at = CASE WHEN p_action IN ('begin_reconciliation','complete')
                              THEN now() ELSE reconciled_at END,
         reconciled_by = CASE WHEN p_action IN ('begin_reconciliation','complete')
                              THEN v_uid ELSE reconciled_by END,
         completed_at = CASE WHEN p_action = 'complete' THEN now() ELSE completed_at END,
         completed_by = CASE WHEN p_action = 'complete' THEN v_uid ELSE completed_by END,
         cancelled_at = CASE WHEN p_action = 'cancel' THEN now() ELSE cancelled_at END,
         cancelled_by = CASE WHEN p_action = 'cancel' THEN v_uid ELSE cancelled_by END,
         cancellation_reason = CASE WHEN p_action = 'cancel' THEN p_reason ELSE cancellation_reason END,
         reconciliation_override_reason = CASE
           WHEN p_action = 'complete' AND p_override THEN p_reason
           ELSE reconciliation_override_reason END,
         reconciliation_snapshot = CASE
           WHEN p_action = 'complete' THEN v_rec ELSE reconciliation_snapshot END
   WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  IF p_action = 'cancel' THEN
    UPDATE public.omni_comms_print_batch_item
       SET membership_status = 'closed', closed_outcome = 'batch_cancelled',
           closed_at = now(), closed_by = v_uid
     WHERE batch_id = v_batch.id AND membership_status = 'active';
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id,
                                 old_value, new_value, metadata)
  VALUES (v_uid, 'omni_comms.print_batch.' || p_action, 'omni_comms',
          'omni_comms_print_batch', v_batch.id::text,
          v_before::text, coalesce(v_rec, v_before)::text,
          jsonb_strip_nulls(jsonb_build_object(
            'batch_reference', v_batch.batch_reference,
            'reason', p_reason,
            'override', nullif(p_override, false),
            'attempts_started', nullif(v_started, 0),
            'evidence_before', v_before,
            'evidence_after', v_rec)));

  RETURN jsonb_build_object(
    'id', v_batch.id,
    'batch_reference', v_batch.batch_reference,
    'status', v_batch.status,
    'version', v_batch.version,
    'attempts_started', v_started,
    'reconciliation', coalesce(v_rec, public.omni_comms_priv_print_batch_reconciliation(v_batch.id)));
END;
$$;

-- ── Projections ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_batch_list(
  p_organization_id uuid,
  p_statuses text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT count(*) INTO v_total
  FROM public.omni_comms_print_batch b
  WHERE b.organization_id = p_organization_id
    AND (p_statuses IS NULL OR b.status = ANY (p_statuses))
    AND (coalesce(btrim(p_search),'') = '' OR b.batch_reference ILIKE '%' || p_search || '%');

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'created_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', b.id,
      'batch_reference', b.batch_reference,
      'status', b.status,
      'version', b.version,
      'created_at', b.created_at,
      'locked_at', b.locked_at,
      'started_at', b.started_at,
      'completed_at', b.completed_at,
      'production_account_id', b.production_account_id,
      'production_account_name', pa.display_name,
      'profile_signature', b.profile_signature,
      'profile_snapshot', b.profile_snapshot,
      'notes', b.notes,
      'cancellation_reason', b.cancellation_reason,
      'reconciliation_override_reason', b.reconciliation_override_reason,
      'age_hours', round(extract(epoch FROM (now() - b.created_at)) / 3600.0, 1),
      'reconciliation', coalesce(b.reconciliation_snapshot,
                                 public.omni_comms_priv_print_batch_reconciliation(b.id))
    ) AS r
    FROM public.omni_comms_print_batch b
    LEFT JOIN public.omni_comms_provider_account pa ON pa.id = b.production_account_id
    WHERE b.organization_id = p_organization_id
      AND (p_statuses IS NULL OR b.status = ANY (p_statuses))
      AND (coalesce(btrim(p_search),'') = '' OR b.batch_reference ILIKE '%' || p_search || '%')
    ORDER BY b.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    OFFSET greatest(0, coalesce(p_offset, 0))
  ) s;

  RETURN jsonb_build_object(
    'batches', v_rows, 'total', v_total, 'generated_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_batch_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_batch public.omni_comms_print_batch%ROWTYPE;
  v_full boolean;
  v_items jsonb;
BEGIN
  SELECT * INTO v_batch FROM public.omni_comms_print_batch WHERE id = p_id;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_batch_not_found'
      USING ERRCODE='P0001', DETAIL='print_batch_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_batch.organization_id, NULL);
  v_full := public.has_permission(v_uid, 'omni_comms', 'operate');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'batch_item_id', a.batch_item_id,
           'print_item_id', a.print_item_id,
           'letter_reference', a.letter_reference,
           'membership_status', a.membership_status,
           'physical_status', a.physical_status,
           'accounting_state', a.accounting_state,
           'expected_pages', a.expected_pages,
           'expected_copies', a.expected_copies,
           'batch_attempts', a.batch_attempts,
           'spoiled_or_failed_in_batch', a.spoiled_or_failed_in_batch,
           'printed_in_batch', a.printed_in_batch,
           'recipient_display', CASE WHEN v_full THEN i.recipient_display
                                     ELSE left(coalesce(i.recipient_display,'—'),1) || '•••' END,
           'request_id', i.request_id,
           'message_id', i.message_id,
           'item_version', i.version,
           'hold_reason', i.hold_reason,
           'last_failure_reason', i.last_failure_reason)), '[]'::jsonb)
  INTO v_items
  FROM public.omni_comms_priv_print_batch_accounting(v_batch.id) a
  JOIN public.omni_comms_print_item i ON i.id = a.print_item_id;

  RETURN jsonb_build_object(
    'batch', jsonb_build_object(
      'id', v_batch.id,
      'batch_reference', v_batch.batch_reference,
      'status', v_batch.status,
      'version', v_batch.version,
      'production_account_id', v_batch.production_account_id,
      'profile_signature', v_batch.profile_signature,
      'profile_snapshot', v_batch.profile_snapshot,
      'notes', v_batch.notes,
      'cancellation_reason', v_batch.cancellation_reason,
      'reconciliation_override_reason', v_batch.reconciliation_override_reason,
      'created_at', v_batch.created_at,
      'locked_at', v_batch.locked_at,
      'started_at', v_batch.started_at,
      'reconciled_at', v_batch.reconciled_at,
      'completed_at', v_batch.completed_at,
      'cancelled_at', v_batch.cancelled_at),
    'items', v_items,
    'reconciliation', coalesce(v_batch.reconciliation_snapshot,
                               public.omni_comms_priv_print_batch_reconciliation(v_batch.id)),
    'full_detail_permitted', v_full,
    'generated_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_print_batch_create(uuid, uuid[], text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_print_batch_membership(uuid, text, uuid[], integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_print_batch_defer_item(uuid, uuid, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_print_batch_action(uuid, text, integer, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_print_batch_list(uuid, text[], text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_print_batch_detail(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_print_batch_preview(uuid, uuid[]) FROM anon;