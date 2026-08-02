-- Omni-Comms UI Phase 1 — navigation findability.
-- Present Omnichannel Communications as its own top-level administration
-- module entry instead of nesting it inside the legacy
-- "Communication & Document Engine" group. No routes, permissions, actions or
-- child rows change; only the menu placement of the existing root row.
UPDATE public.app_modules
   SET parent_id = NULL,
       sort_order = 910,
       show_in_menu = true,
       is_enabled = true
 WHERE name = 'omni_comms'
   AND route = '/admin/omnichannel-communications';