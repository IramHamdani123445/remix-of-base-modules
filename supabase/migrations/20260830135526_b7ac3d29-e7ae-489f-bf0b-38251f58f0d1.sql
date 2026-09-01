-- =====================================================================
-- Omni-Comms — "My Communications" governed READ layer.
-- Read-only. Does not touch dispatch/authorization/provider/release code.
-- Ownership is resolved server-side from auth.uid(); no identity is accepted
-- from the caller, so a browser cannot request another user's inbox.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.omni_comms_in_app_my_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*), 0)::integer
    FROM public.in_app_notifications n
   WHERE n.user_id = auth.uid()
     AND n.source = 'omni_comms'
     AND n.is_read = false;
$$;

COMMENT ON FUNCTION public.omni_comms_in_app_my_unread_count() IS
  'Authoritative unread count of Omni-Comms in-app communications for the signed-in user. Excludes workflow approvals, legacy notifications and operational/admin attention.';

CREATE OR REPLACE FUNCTION public.omni_comms_in_app_list_my_communications(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_unread_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  title text,
  body text,
  link text,
  action_label text,
  severity text,
  category text,
  module_code text,
  event_code text,
  event_name text,
  entity_type text,
  entity_id text,
  is_read boolean,
  read_at timestamptz,
  acted_at timestamptz,
  created_at timestamptz,
  has_attachment boolean,
  request_id uuid,
  message_id uuid,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT n.*
      FROM public.in_app_notifications n
     WHERE n.user_id = auth.uid()
       AND n.source = 'omni_comms'
       AND (p_unread_only IS NOT TRUE OR n.is_read = false)
  ), counted AS (
    SELECT COUNT(*) AS c FROM mine
  )
  SELECT
    m.id,
    m.title,
    m.body,
    m.link,
    m.action_label,
    COALESCE(NULLIF(btrim(m.metadata ->> 'severity'), ''), 'info')          AS severity,
    COALESCE(ed.communication_class, 'informational')                       AS category,
    COALESCE(NULLIF(btrim(COALESCE(m.module, '')), ''), ed.module_code)     AS module_code,
    ed.code                                                                 AS event_code,
    ed.name                                                                 AS event_name,
    r.caller_entity_type                                                    AS entity_type,
    r.caller_entity_id::text                                                AS entity_id,
    m.is_read,
    m.read_at,
    m.acted_at,
    m.created_at,
    EXISTS (
      SELECT 1 FROM public.omni_comms_message_attachment a
       WHERE a.message_id = m.omni_comms_message_id
    )                                                                       AS has_attachment,
    m.omni_comms_request_id                                                 AS request_id,
    m.omni_comms_message_id                                                 AS message_id,
    counted.c                                                               AS total_count
  FROM mine m
  CROSS JOIN counted
  LEFT JOIN public.omni_comms_request r        ON r.id = m.omni_comms_request_id
  LEFT JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.omni_comms_in_app_list_my_communications(integer, integer, boolean) IS
  'Returns the signed-in user''s Omni-Comms in-app communications with business traceability (event, module, entity). Ownership resolved from auth.uid(); callers cannot request another user.';

REVOKE ALL ON FUNCTION public.omni_comms_in_app_my_unread_count() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.omni_comms_in_app_list_my_communications(integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_in_app_my_unread_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_in_app_list_my_communications(integer, integer, boolean) TO authenticated;