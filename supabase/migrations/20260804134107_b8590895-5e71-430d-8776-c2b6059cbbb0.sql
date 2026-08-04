-- BN Phase 0 (final slice): retire raw Benefits table preview, harden object listing.

-- 1. Retire the raw row-preview surface entirely.
REVOKE ALL ON FUNCTION public.bn_preview_table(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bn_preview_table(text, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.bn_preview_table(text, int, int) FROM authenticated;
DROP FUNCTION IF EXISTS public.bn_preview_table(text, int, int);

-- 2. Harden bn_list_tables(): metadata only, fail-closed admin authorisation.
CREATE OR REPLACE FUNCTION public.bn_list_tables()
RETURNS TABLE(table_name text, object_type text, row_count bigint, has_created_at boolean, last_created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  r record;
  v_count bigint;
  v_last timestamptz;
  v_has_created boolean;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_admin(v_uid)
    OR public.has_permission(v_uid, 'benefits_management', 'admin')
  ) THEN
    RAISE EXCEPTION 'Benefits administrator authorisation required'
      USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT t.table_name AS tname, t.table_type AS ttype
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_name LIKE 'bn\_%' ESCAPE '\'
    ORDER BY t.table_name
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = r.tname
        AND c.column_name = 'created_at'
    ) INTO v_has_created;

    BEGIN
      IF v_has_created THEN
        EXECUTE format('SELECT count(*)::bigint, max(created_at) FROM public.%I', r.tname)
          INTO v_count, v_last;
      ELSE
        EXECUTE format('SELECT count(*)::bigint FROM public.%I', r.tname)
          INTO v_count;
        v_last := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_count := -1;
      v_last := NULL;
    END;

    table_name := r.tname;
    object_type := CASE WHEN r.ttype = 'BASE TABLE' THEN 'table' ELSE 'view' END;
    row_count := v_count;
    has_created_at := v_has_created;
    last_created_at := v_last;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.bn_list_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bn_list_tables() FROM anon;
GRANT EXECUTE ON FUNCTION public.bn_list_tables() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_list_tables() TO service_role;