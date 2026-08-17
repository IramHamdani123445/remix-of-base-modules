-- Effective print stationery (letterhead header/footer + print footer),
-- honouring the organisation default and the department override /
-- inheritance flags held on core_department_profile.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_html_to_lines(p_html text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT coalesce(
    (SELECT jsonb_agg(l ORDER BY ord)
       FROM (
         SELECT btrim(regexp_replace(x, '\s+', ' ', 'g')) AS l, ord
           FROM unnest(
                  string_to_array(
                    regexp_replace(
                      replace(replace(replace(replace(replace(
                        regexp_replace(
                          regexp_replace(coalesce(p_html,''), '<\s*(br|/p|/div|/h[1-6]|/li|/tr)[^>]*>', E'\n', 'gi'),
                          '<[^>]*>', '', 'g'),
                        '&nbsp;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&#39;', ''''),
                      '[ \t]+', ' ', 'g'),
                    E'\n')
                ) WITH ORDINALITY AS t(x, ord)
       ) s
      WHERE l <> ''),
    '[]'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_stationery_effective(
  p_organization_id uuid,
  p_department_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_org public.core_organization;
  v_prof public.core_department_profile;
  v_lh_id uuid;
  v_pf_id uuid;
  v_lh_source text := 'organization';
  v_pf_source text := 'organization';
  v_lh public.comm_letterhead;
  v_pf public.comm_print_footer;
BEGIN
  SELECT * INTO v_org FROM public.core_organization
   WHERE p_organization_id IS NULL OR id = p_organization_id
   ORDER BY (id = p_organization_id) DESC LIMIT 1;

  v_lh_id := v_org.default_letterhead_id;
  v_pf_id := v_org.default_print_footer_id;

  IF p_department_id IS NOT NULL THEN
    SELECT * INTO v_prof FROM public.core_department_profile
     WHERE department_id = p_department_id LIMIT 1;
    IF FOUND THEN
      IF coalesce(v_prof.inherit_letterhead_from_org, true) = false
         AND v_prof.default_letterhead_id IS NOT NULL THEN
        v_lh_id := v_prof.default_letterhead_id;
        v_lh_source := 'department';
      END IF;
      IF coalesce(v_prof.inherit_print_footer_from_org, true) = false
         AND v_prof.default_print_footer_id IS NOT NULL THEN
        v_pf_id := v_prof.default_print_footer_id;
        v_pf_source := 'department';
      END IF;
    END IF;
  END IF;

  IF v_lh_id IS NOT NULL THEN
    SELECT * INTO v_lh FROM public.comm_letterhead WHERE id = v_lh_id AND coalesce(is_active, true) LIMIT 1;
  END IF;
  IF v_pf_id IS NOT NULL THEN
    SELECT * INTO v_pf FROM public.comm_print_footer WHERE id = v_pf_id AND coalesce(is_active, true) LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'letterhead_id', v_lh.id,
    'letterhead_name', v_lh.name,
    'letterhead_source', CASE WHEN v_lh.id IS NULL THEN NULL ELSE v_lh_source END,
    'header_lines', public.omni_comms_priv_print_html_to_lines(v_lh.header_html),
    'letterhead_footer_lines', public.omni_comms_priv_print_html_to_lines(v_lh.footer_html),
    'print_footer_id', v_pf.id,
    'print_footer_name', v_pf.name,
    'print_footer_source', CASE WHEN v_pf.id IS NULL THEN NULL ELSE v_pf_source END,
    'footer_lines', public.omni_comms_priv_print_html_to_lines(v_pf.footer_html),
    'page_footer', nullif(btrim(coalesce(v_pf.page_footer, '')), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_print_stationery_effective(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_stationery_effective(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_html_to_lines(text) TO authenticated, service_role;