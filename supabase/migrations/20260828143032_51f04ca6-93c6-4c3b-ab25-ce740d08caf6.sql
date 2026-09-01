CREATE TABLE IF NOT EXISTS public.omni_comms_tmp_prereq_probe (
  channel text, seq int, payload jsonb, captured_at timestamptz DEFAULT now());
ALTER TABLE public.omni_comms_tmp_prereq_probe ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.omni_comms_tmp_prereq_probe TO authenticated;
GRANT ALL ON public.omni_comms_tmp_prereq_probe TO service_role;
TRUNCATE public.omni_comms_tmp_prereq_probe;

INSERT INTO public.omni_comms_tmp_prereq_probe (channel, seq, payload)
SELECT rc.channel, (c->>'sequence')::int, c
FROM public.omni_comms_channel_release_control rc,
LATERAL jsonb_array_elements(
  public.omni_comms_priv_channel_release_prerequisites(
    rc.organization_id, rc.department_id, rc.channel, rc.id,
    '03fcd61c75a933ebf3e750d52d925c34b1efea81')) c
WHERE rc.channel IN ('email','in_app')
  AND (c->>'sequence')::int <= 31
  AND c->>'state' NOT IN ('passed','not_applicable');

INSERT INTO public.omni_comms_tmp_prereq_probe (channel, seq, payload)
SELECT 'certification', 0, public.omni_comms_priv_runtime_certification();