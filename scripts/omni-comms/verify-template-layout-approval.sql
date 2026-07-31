-- Omni-Comms — Template layout selection verification.
-- Read-only. Proves that (a) the listing RPCs expose layout state, and
-- (b) no draft template version can reach approval without a layout.

-- 1. Layout columns are exposed by the version get/list RPC result types.
SELECT p.proname, pg_get_function_result(p.oid) AS result_type
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('omni_comms_template_version_get',
                    'omni_comms_template_version_list',
                    'omni_comms_template_version_set_layout_selection',
                    'core_template_layout_version_list_published')
ORDER BY p.proname;

-- 2. Every draft template version and its persisted layout selection.
SELECT f.code AS family_code, tv.version_number, tv.channel, tv.status,
       tv.layout_selection_mode, tv.layout_id, tv.pinned_layout_version_id
FROM public.omni_comms_template_version tv
JOIN public.omni_comms_template_family f ON f.id = tv.template_family_id
ORDER BY f.code, tv.version_number;

-- 3. Drafts that would fail approval with layout_selection_required.
SELECT f.code AS family_code, tv.version_number
FROM public.omni_comms_template_version tv
JOIN public.omni_comms_template_family f ON f.id = tv.template_family_id
WHERE tv.status = 'draft'
  AND (tv.layout_selection_mode IS NULL
       OR tv.layout_id IS NULL
       OR (tv.layout_selection_mode = 'pinned' AND tv.pinned_layout_version_id IS NULL));

-- 4. Pinned versions must reference a published version of the same layout.
SELECT tv.id
FROM public.omni_comms_template_version tv
LEFT JOIN public.core_template_layout_version lv ON lv.id = tv.pinned_layout_version_id
WHERE tv.pinned_layout_version_id IS NOT NULL
  AND (lv.id IS NULL OR lv.layout_id <> tv.layout_id OR lv.status <> 'published');
