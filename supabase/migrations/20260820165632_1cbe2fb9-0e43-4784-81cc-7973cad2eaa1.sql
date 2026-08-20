CREATE OR REPLACE FUNCTION public.bn_calc_config_save_rate_table_row_v2(
  p_row_id uuid,
  p_rate_table_id uuid,
  p_row_order integer,
  p_dimension_values jsonb,
  p_output_key text,
  p_output_value numeric,
  p_output_text text,
  p_output_type text,
  p_effective_from date,
  p_effective_to date,
  p_notes text,
  p_user_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_id uuid := p_row_id;
BEGIN
  IF p_user_code IS NULL OR btrim(p_user_code) = '' THEN
    RAISE EXCEPTION 'BN_CALC_ACTOR_REQUIRED';
  END IF;
  SELECT upper(status) INTO v_status FROM public.bn_rate_table WHERE id = p_rate_table_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'BN_CALC_RATE_TABLE_NOT_FOUND: %', p_rate_table_id; END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BN_CALC_IMMUTABLE_RATE_TABLE: % is % — create a successor version',
      p_rate_table_id, v_status;
  END IF;

  PERFORM public._bn_calc_boundary_enter();
  IF v_id IS NULL THEN
    INSERT INTO public.bn_rate_table_row (
      rate_table_id, row_order, dimension_values_json, output_key, output_value,
      output_text, output_type, effective_from, effective_to, notes, entered_by
    ) VALUES (
      p_rate_table_id, coalesce(p_row_order, 1), coalesce(p_dimension_values, '{}'::jsonb),
      p_output_key, p_output_value, p_output_text, coalesce(p_output_type, 'AMOUNT'),
      p_effective_from, p_effective_to, p_notes, p_user_code
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.bn_rate_table_row SET
      row_order = coalesce(p_row_order, row_order),
      dimension_values_json = coalesce(p_dimension_values, dimension_values_json),
      output_key = p_output_key,
      output_value = p_output_value,
      output_text = p_output_text,
      output_type = coalesce(p_output_type, output_type),
      effective_from = p_effective_from,
      effective_to = p_effective_to,
      notes = p_notes,
      modified_by = p_user_code,
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BN_CALC_RATE_ROW_NOT_FOUND: %', v_id; END IF;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bn_calc_config_save_rate_table_row_v2(uuid, uuid, integer, jsonb, text, numeric, text, text, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_calc_config_save_rate_table_row_v2(uuid, uuid, integer, jsonb, text, numeric, text, text, date, date, text, text) TO authenticated, service_role;