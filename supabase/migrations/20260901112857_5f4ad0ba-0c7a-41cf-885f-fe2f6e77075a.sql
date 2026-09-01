REVOKE ALL ON FUNCTION public.bn_notify_workbasket_arrival() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bn_render_workbasket_notification(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_render_workbasket_notification(text, jsonb) TO service_role;