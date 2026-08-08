
CREATE OR REPLACE FUNCTION public.bn_uprating_reference_data_v1(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ref jsonb; v_series jsonb; v_products jsonb; v_formulas jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT COALESCE(jsonb_object_agg(domain, items), '{}'::jsonb) INTO v_ref FROM (
    SELECT domain, jsonb_agg(jsonb_build_object('code',code,'label',label,'description',description)
             ORDER BY sort_order, label) items
      FROM public.bn_uprating_reference_value WHERE is_active GROUP BY domain) s;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('index_series_id',index_series_id,'series_code',series_code,
           'series_name',series_name,'unit',unit) ORDER BY series_code), '[]'::jsonb)
    INTO v_series FROM public.bn_uprating_index_series WHERE is_active;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'code',benefit_code,'label',
           COALESCE(benefit_name, benefit_code)) ORDER BY benefit_name NULLS LAST), '[]'::jsonb)
    INTO v_products FROM public.bn_product;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fv.id,'template_id',fv.formula_template_id,'label',
           COALESCE(ft.template_name, fv.formula_code, 'Formula') || ' v' || COALESCE(fv.version_no::text,'?'),
           'governance_status', fv.governance_status, 'is_active', fv.is_active)
           ORDER BY ft.template_name NULLS LAST, fv.version_no), '[]'::jsonb)
    INTO v_formulas FROM public.bn_formula_version fv
    LEFT JOIN public.bn_formula_template ft ON ft.id = fv.formula_template_id
   WHERE COALESCE(fv.is_active, false) = true;
  RETURN jsonb_build_object('status','OK','code',NULL,'data', jsonb_build_object(
    'reference', v_ref, 'index_series', v_series, 'products', v_products, 'formula_versions', v_formulas));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','ERROR','code','E_PERMISSION','message','You do not have permission to view uprating reference data.','data',NULL);
END; $fn$;
