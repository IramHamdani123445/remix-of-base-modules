-- =========================================================
-- BUG-03 — Product cannot be set to Active, and the blocking
--          formula binding is invisible on screen.
--
-- bn_product_can_activate() counted every formula binding row
-- belonging to a product, regardless of:
--
--   * whether the binding is still active (is_active), so a
--     switched-off binding blocked activation permanently; and
--   * which product version it belongs to, so a binding left
--     behind by a superseded or deleted version still counted.
--
-- The Calculation screen, by contrast, lists only active bindings
-- for the version being viewed. A binding excluded by the screen
-- but counted by the guard is invisible to the user, so the
-- blocker could not be resolved from within the application.
--
-- It also reported two different faults under one code: a binding
-- whose formula version no longer exists was reported as
-- FORMULA_NOT_ACTIVE, telling the user to activate a formula that
-- had already been deleted.
--
-- Changes
--   1. every check now filters b.is_active = true
--   2. checks are scoped to the product's ACTIVE version where one
--      exists, matching what the Calculation screen shows
--   3. a missing formula version is reported separately as
--      FORMULA_BINDING_ORPHANED, with its own message
--   4. messages name the calculation stage so the user can find
--      the binding concerned
--   5. the variable-mapping check joined
--      bn_product_formula_variable_mapping.product_formula_binding_id,
--      a column that does not exist. The correct column is binding_id.
--      The live function therefore raised
--        column m.product_formula_binding_id does not exist
--      for every product that reached that check, and the caller
--      reported "Activation check failed" and refused activation.
--
-- The return signature is unchanged, so callers need no edit.
-- =========================================================

CREATE OR REPLACE FUNCTION public.bn_product_can_activate(_product_id uuid)
RETURNS TABLE (can_activate boolean, blocker_code text, blocker_message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version_id      uuid;
  v_binding_count   int;
  v_orphan_count    int;
  v_orphan_stages   text;
  v_inactive_count  int;
  v_inactive_stages text;
  v_unmapped_count  int;
BEGIN
  -- Scope to the product's ACTIVE version when it has one. This matches
  -- the Calculation screen, which shows bindings for the selected version.
  -- Products with no ACTIVE version yet are checked across all versions,
  -- which is the pre-existing behaviour for a product being activated for
  -- the first time.
  SELECT pv.id INTO v_version_id
  FROM public.bn_product_version pv
  WHERE pv.product_id = _product_id
    AND upper(pv.status) = 'ACTIVE'
  ORDER BY pv.version_number DESC
  LIMIT 1;

  -- 1. Must have at least one live formula binding -----------------------
  SELECT COUNT(*) INTO v_binding_count
  FROM public.bn_product_formula_binding b
  WHERE b.product_id = _product_id
    AND b.is_active = true
    AND (v_version_id IS NULL OR b.product_version_id = v_version_id);

  IF v_binding_count = 0 THEN
    RETURN QUERY SELECT false, 'NO_FORMULA_BOUND',
      'Product has no formula binding. Bind an ACTIVE formula version before activating.';
    RETURN;
  END IF;

  -- 2. No binding may point at a formula version that no longer exists ---
  SELECT COUNT(*), string_agg(DISTINCT coalesce(b.calculation_stage, 'unnamed stage'), ', ')
    INTO v_orphan_count, v_orphan_stages
  FROM public.bn_product_formula_binding b
  LEFT JOIN public.bn_formula_version v ON v.id = b.formula_version_id
  WHERE b.product_id = _product_id
    AND b.is_active = true
    AND (v_version_id IS NULL OR b.product_version_id = v_version_id)
    AND v.id IS NULL;

  IF v_orphan_count > 0 THEN
    RETURN QUERY SELECT false, 'FORMULA_BINDING_ORPHANED',
      format(
        '%s formula binding(s) refer to a formula version that no longer exists (stage: %s). Remove the binding, or rebind it to an ACTIVE formula version.',
        v_orphan_count, coalesce(v_orphan_stages, 'unknown'));
    RETURN;
  END IF;

  -- 3. Every remaining binding must point at an ACTIVE formula version ---
  SELECT COUNT(*), string_agg(DISTINCT coalesce(b.calculation_stage, 'unnamed stage'), ', ')
    INTO v_inactive_count, v_inactive_stages
  FROM public.bn_product_formula_binding b
  JOIN public.bn_formula_version v ON v.id = b.formula_version_id
  WHERE b.product_id = _product_id
    AND b.is_active = true
    AND (v_version_id IS NULL OR b.product_version_id = v_version_id)
    AND v.governance_status <> 'ACTIVE';

  IF v_inactive_count > 0 THEN
    RETURN QUERY SELECT false, 'FORMULA_NOT_ACTIVE',
      format(
        '%s formula binding(s) reference a non-ACTIVE formula version (stage: %s). Activate the formula first, or rebind to an ACTIVE version.',
        v_inactive_count, coalesce(v_inactive_stages, 'unknown'));
    RETURN;
  END IF;

  -- 4. Variables declared on the version must all have a mapping row ----
  SELECT COUNT(*) INTO v_unmapped_count
  FROM public.bn_product_formula_binding b
  JOIN public.bn_formula_version v ON v.id = b.formula_version_id
  LEFT JOIN public.bn_product_formula_variable_mapping m
    ON m.binding_id = b.id
  WHERE b.product_id = _product_id
    AND b.is_active = true
    AND (v_version_id IS NULL OR b.product_version_id = v_version_id)
    AND v.expression IS NOT NULL
    AND v.expression <> ''
    AND m.id IS NULL;

  IF v_unmapped_count > 0 THEN
    RETURN QUERY SELECT false, 'VARIABLES_UNMAPPED',
      'One or more formula bindings have no variable mappings. Map every formula variable to a product parameter or data source.';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, NULL::text;
END$$;

GRANT EXECUTE ON FUNCTION public.bn_product_can_activate(uuid) TO authenticated, service_role;
