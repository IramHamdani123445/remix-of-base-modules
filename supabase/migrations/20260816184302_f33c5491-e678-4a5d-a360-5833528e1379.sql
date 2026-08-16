CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_postal_lines(p_snapshot jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog','public' AS $function$
  SELECT CASE
    WHEN jsonb_typeof(p_snapshot->'postal_address_lines') = 'array'
      THEN p_snapshot->'postal_address_lines'
    WHEN jsonb_typeof(p_snapshot->'address_lines') = 'array'
      THEN p_snapshot->'address_lines'
    WHEN coalesce(btrim(p_snapshot->>'print'),'') <> ''
      THEN (SELECT coalesce(jsonb_agg(btrim(l)), '[]'::jsonb)
              FROM unnest(string_to_array(p_snapshot->>'print', E'\n')) AS l
             WHERE btrim(l) <> '')
    WHEN coalesce(btrim(p_snapshot->>'postal'),'') <> ''
      THEN (SELECT coalesce(jsonb_agg(btrim(l)), '[]'::jsonb)
              FROM unnest(string_to_array(p_snapshot->>'postal', E'\n')) AS l
             WHERE btrim(l) <> '')
    ELSE '[]'::jsonb
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_postal_lines(jsonb) TO service_role;