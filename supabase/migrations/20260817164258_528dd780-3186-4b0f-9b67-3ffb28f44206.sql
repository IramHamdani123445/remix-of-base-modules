-- Omni-Comms Stationery becomes the single home for correspondence assets.
-- Add the Disclaimers entry under Stationery.
INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id, sort_order, is_enabled, show_in_menu)
SELECT 'omni_comms_stationery_disclaimers', 'Disclaimers',
       'Legal disclaimers applied to correspondence.', 'FileText',
       '/admin/omnichannel-communications/stationery/disclaimers',
       'b4cfd764-3a78-4420-a0e5-8135814156da'::uuid, 70, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_modules WHERE name = 'omni_comms_stationery_disclaimers'
);

-- Hide the duplicated correspondence-asset entries elsewhere in Administration.
-- Routes stay alive (old bookmarks keep working); only the menu duplicates go.
UPDATE public.app_modules
SET show_in_menu = false, updated_at = now()
WHERE route IN (
  '/admin/org/assets/media',
  '/admin/org/assets/letterheads',
  '/admin/org/assets/signatures',
  '/admin/org/assets/disclaimers',
  '/admin/org/assets/headers-footers',
  '/admin/org/library/text-blocks',
  '/admin/organization/text-blocks',
  '/admin/organization/letterheads',
  '/admin/organization/media-library',
  '/admin/organization/document-assets'
);