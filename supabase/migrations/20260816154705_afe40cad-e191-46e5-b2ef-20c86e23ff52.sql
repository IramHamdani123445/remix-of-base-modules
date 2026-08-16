CREATE OR REPLACE FUNCTION public.omni_comms_priv_runtime_action_snapshot(
  p_organization_id uuid,
  p_department_id uuid,
  p_event_definition_id uuid,
  p_recipient_references text[] DEFAULT '{}'::text[]
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
  WITH actions AS (
    SELECT a.id, a.organization_id, a.department_id, a.event_definition_id,
           a.code, a.name, a.recipient_role, a.obligation, a.satisfaction_rule,
           a.legal_basis, a.priority, a.status
    FROM public.omni_comms_communication_action a
    WHERE a.event_definition_id = p_event_definition_id
      AND a.organization_id = p_organization_id
      AND a.status = 'active'
      AND (a.department_id IS NULL OR a.department_id = p_department_id)
  ),
  options AS (
    SELECT o.id, o.action_id, o.channel, o.rank, o.template_family_id,
           o.is_fallback, o.condition, o.status
    FROM public.omni_comms_action_channel_option o
    WHERE o.action_id IN (SELECT id FROM actions)
      AND o.status = 'active'
  ),
  policies AS (
    SELECT p.id, p.organization_id, p.department_id, p.action_id, p.mode,
           p.print_when, p.version_number, p.effective_from, p.effective_to
    FROM public.omni_comms_delivery_policy p
    WHERE p.organization_id = p_organization_id
      AND p.status = 'active'
      AND (p.department_id IS NULL OR p.department_id = p_department_id)
      AND (p.action_id IS NULL OR p.action_id IN (SELECT id FROM actions))
      AND p.effective_from <= now()
      AND (p.effective_to IS NULL OR p.effective_to > now())
  ),
  prefs AS (
    SELECT r.id, r.organization_id, r.recipient_role, r.recipient_reference,
           r.channel, r.preference, r.source
    FROM public.omni_comms_recipient_channel_preference r
    WHERE r.organization_id = p_organization_id
      AND r.recipient_reference = ANY(coalesce(p_recipient_references, '{}'::text[]))
      AND r.effective_from <= now()
      AND (r.effective_to IS NULL OR r.effective_to > now())
  )
  SELECT jsonb_build_object(
    'communication_actions',
      coalesce((SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.priority, a.code) FROM actions a), '[]'::jsonb),
    'action_channel_options',
      coalesce((SELECT jsonb_agg(to_jsonb(o.*) ORDER BY o.rank) FROM options o), '[]'::jsonb),
    'delivery_policies',
      coalesce((SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.version_number DESC) FROM policies p), '[]'::jsonb),
    'recipient_channel_preferences',
      coalesce((SELECT jsonb_agg(to_jsonb(r.*)) FROM prefs r), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_action_snapshot(uuid,uuid,uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_runtime_action_snapshot(uuid,uuid,uuid,text[]) TO service_role;
