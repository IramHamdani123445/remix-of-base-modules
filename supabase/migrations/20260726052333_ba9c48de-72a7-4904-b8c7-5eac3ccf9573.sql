CREATE OR REPLACE FUNCTION public.comm_hub_controlled_live_scope_hash_v2(
  p_operator uuid,
  p_module text,
  p_event text,
  p_channel text,
  p_recipient_hash text,
  p_preview_approval uuid,
  p_dryrun_cert uuid,
  p_send_context text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    extensions.digest(
      concat_ws('|',
        coalesce(p_operator::text,''),
        coalesce(p_module,''),
        coalesce(p_event,''),
        coalesce(p_channel,''),
        coalesce(p_recipient_hash,''),
        coalesce(p_preview_approval::text,''),
        coalesce(p_dryrun_cert::text,''),
        coalesce(p_send_context,'STUB')
      ),
      'sha256'
    ),
    'hex'
  );
$$;

GRANT EXECUTE ON FUNCTION public.comm_hub_controlled_live_scope_hash_v2(uuid,text,text,text,text,uuid,uuid,text)
  TO authenticated, service_role;