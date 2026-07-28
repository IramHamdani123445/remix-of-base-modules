
CREATE OR REPLACE FUNCTION public.omni_comms_priv_reject_nonlocal_refs(p_schema jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_node jsonb;
  v_val  jsonb;
  v_ref  text;
BEGIN
  IF p_schema IS NULL OR jsonb_typeof(p_schema) <> 'object' THEN
    RETURN;
  END IF;

  FOR v_node IN
    WITH RECURSIVE walk(node) AS (
      SELECT p_schema
      UNION ALL
      SELECT CASE
               WHEN jsonb_typeof(w.node) = 'object' THEN kv.value
               WHEN jsonb_typeof(w.node) = 'array'  THEN elem.value
             END
      FROM walk w
      LEFT JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.node) = 'object' THEN w.node ELSE '{}'::jsonb END) kv  ON jsonb_typeof(w.node) = 'object'
      LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.node) = 'array' THEN w.node ELSE '[]'::jsonb END) elem ON jsonb_typeof(w.node) = 'array'
      WHERE w.node IS NOT NULL
        AND jsonb_typeof(w.node) IN ('object','array')
    )
    SELECT node FROM walk WHERE node IS NOT NULL AND jsonb_typeof(node) = 'object'
  LOOP
    IF v_node ? '$ref' THEN
      v_val := v_node -> '$ref';
      -- A JSON Schema $ref keyword MUST be a string. If it is an object /
      -- array / other type it is a property named "$ref", not a reference,
      -- and must not be inspected. Only string-valued $refs are enforced.
      IF jsonb_typeof(v_val) = 'string' THEN
        v_ref := trim(both '"' from v_val::text);
        IF v_ref = '' OR left(v_ref, 1) <> '#' THEN
          RAISE EXCEPTION 'OC422 validation_error'
            USING ERRCODE = 'P0001', DETAIL = 'non_local_ref';
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;
