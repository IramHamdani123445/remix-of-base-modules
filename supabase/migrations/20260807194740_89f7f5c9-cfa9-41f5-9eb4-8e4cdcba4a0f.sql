
CREATE OR REPLACE FUNCTION public._bn_risk_person_display_name(p_ssn text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NULLIF(btrim(concat_ws(' ', m.firstname, m.surname)),'')
    FROM public.ip_master m
   WHERE p_ssn IS NOT NULL
     AND lpad(btrim(m.ssn), 12, '0') = lpad(btrim(p_ssn), 12, '0')
   ORDER BY m.id LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public._bn_risk_person_display_name(text) TO authenticated;
