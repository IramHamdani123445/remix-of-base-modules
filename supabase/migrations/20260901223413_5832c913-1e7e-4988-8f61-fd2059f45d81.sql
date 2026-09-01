-- 1. Governed module sender profile: INTERNAL_AUDIT / email -> ia_department_sender
INSERT INTO public.omni_comms_module_sender_profile
  (organization_id, department_id, caller_module_code, channel, sender_identity_id,
   profile_role, communication_class, is_default, allow_event_override,
   allow_organization_fallback, status, data_origin, activated_at)
SELECT si.organization_id, NULL, 'INTERNAL_AUDIT', 'email', si.id,
       'default', NULL, true, true, true, 'active', 'user', now()
  FROM public.omni_comms_sender_identity si
 WHERE si.code = 'ia_department_sender'
   AND NOT EXISTS (
     SELECT 1 FROM public.omni_comms_module_sender_profile m
      WHERE m.caller_module_code = 'INTERNAL_AUDIT' AND m.channel = 'email');

UPDATE public.omni_comms_module_sender_profile m
   SET sender_identity_id = si.id, status = 'active', is_default = true, updated_at = now()
  FROM public.omni_comms_sender_identity si
 WHERE si.code = 'ia_department_sender'
   AND m.caller_module_code = 'INTERNAL_AUDIT' AND m.channel = 'email';

-- 2. Repoint drifted Internal Audit email routes onto the canonical IA sender (by CODE)
UPDATE public.omni_comms_event_route r
   SET sender_identity_id = (SELECT id FROM public.omni_comms_sender_identity
                              WHERE code = 'ia_department_sender'),
       updated_at = now()
  FROM public.omni_comms_event_definition ed
 WHERE ed.id = r.event_definition_id
   AND ed.code LIKE 'INTERNAL_AUDIT.%'
   AND r.channel = 'email'
   AND r.sender_identity_id IS DISTINCT FROM
       (SELECT id FROM public.omni_comms_sender_identity WHERE code = 'ia_department_sender');

-- 3. Remove seed-time sender UUID coupling: the IA seed helper now resolves the
--    email sender from the governed module sender profile, falling back to the
--    payload only when no profile is configured.
DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_seed_internal_audit_event';

  IF v_def IS NULL THEN
    RAISE NOTICE 'IA seed helper not present; nothing to patch.';
    RETURN;
  END IF;

  v_def := replace(
    v_def,
    '(v_channel->>''senderIdentityId'')::uuid, ''explicit''',
    'COALESCE((SELECT msp.sender_identity_id
                 FROM public.omni_comms_module_sender_profile msp
                WHERE msp.caller_module_code = ''INTERNAL_AUDIT''
                  AND msp.channel = v_ch
                  AND msp.status = ''active''
                  AND msp.is_default
                ORDER BY msp.updated_at DESC
                LIMIT 1),
              (v_channel->>''senderIdentityId'')::uuid), ''explicit''');

  EXECUTE v_def;
END
$mig$;