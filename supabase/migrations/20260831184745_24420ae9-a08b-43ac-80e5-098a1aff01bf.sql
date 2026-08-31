CREATE OR REPLACE FUNCTION public.ce_next_number_v1(p_applies_to text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tpl public.ce_number_templates;
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_month int;
  v_val int;
  v_num text;
  v_pattern text;
  v_tries int := 0;
  v_exists boolean;
BEGIN
  SELECT * INTO v_tpl FROM public.ce_number_templates
   WHERE applies_to = p_applies_to AND is_active = true
   ORDER BY is_default DESC, created_at ASC LIMIT 1;
  IF v_tpl.id IS NULL THEN
    RAISE EXCEPTION 'CE-NUM-404: no active number template configured for %', p_applies_to USING ERRCODE='22023';
  END IF;

  -- Legacy rows store NULL for yearly-reset templates; keep that convention so the
  -- unique key (template_id, year, month) continues the SAME counter.
  v_month := CASE WHEN COALESCE(v_tpl.reset_frequency,'yearly') = 'monthly'
                  THEN EXTRACT(MONTH FROM now())::int ELSE NULL END;

  v_pattern := COALESCE(v_tpl.template_pattern, COALESCE(v_tpl.prefix,'NUM') || '-{YYYY}-{NNNNN}');

  LOOP
    v_tries := v_tries + 1;
    IF v_tries > 100 THEN
      RAISE EXCEPTION 'CE-NUM-500: unable to allocate a free number for %', p_applies_to USING ERRCODE='22023';
    END IF;

    IF v_month IS NULL THEN
      UPDATE public.ce_number_sequences
         SET current_value = COALESCE(current_value,0) + 1
       WHERE template_id = v_tpl.id AND year = v_year AND month IS NULL
      RETURNING current_value INTO v_val;
      IF v_val IS NULL THEN
        INSERT INTO public.ce_number_sequences(template_id, year, month, current_value)
        VALUES (v_tpl.id, v_year, NULL, 1)
        RETURNING current_value INTO v_val;
      END IF;
    ELSE
      INSERT INTO public.ce_number_sequences(template_id, year, month, current_value)
      VALUES (v_tpl.id, v_year, v_month, 1)
      ON CONFLICT (template_id, year, month)
      DO UPDATE SET current_value = public.ce_number_sequences.current_value + 1
      RETURNING current_value INTO v_val;
    END IF;

    v_num := replace(v_pattern, '{YYYY}', v_year::text);
    v_num := replace(v_num, '{MM}', lpad(COALESCE(v_month, EXTRACT(MONTH FROM now())::int)::text, 2, '0'));
    v_num := regexp_replace(v_num, '\{N+\}', lpad(v_val::text, GREATEST(COALESCE(v_tpl.padding_length,5),1), '0'));

    -- Numbers created before this generator existed are not reflected in the
    -- sequence counter, so skip any value that is already taken.
    IF p_applies_to = 'violation' THEN
      SELECT EXISTS (SELECT 1 FROM public.ce_violations WHERE violation_number = v_num) INTO v_exists;
    ELSE
      v_exists := false;
    END IF;

    EXIT WHEN NOT v_exists;
  END LOOP;

  RETURN v_num;
END $function$;