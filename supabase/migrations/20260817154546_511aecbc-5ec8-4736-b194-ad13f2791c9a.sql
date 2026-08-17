INSERT INTO public.app_modules (id, name, display_name, icon, route, parent_id, sort_order, is_enabled, show_in_menu, description)
VALUES (
  gen_random_uuid(),
  'omni_comms_stationery',
  'Stationery',
  'FileText',
  '/admin/omnichannel-communications?view=stationery',
  '21a6c11c-8205-4fba-913b-002ea73a21b9',
  40,
  true,
  true,
  'Letterheads, media library, text blocks, headers & footers and signatures used by printed correspondence.'
)
ON CONFLICT (name) DO UPDATE
SET display_name = EXCLUDED.display_name,
    route = EXCLUDED.route,
    parent_id = EXCLUDED.parent_id,
    sort_order = EXCLUDED.sort_order,
    is_enabled = true,
    show_in_menu = true,
    description = EXCLUDED.description;