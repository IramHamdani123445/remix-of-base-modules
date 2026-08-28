DO $$
DECLARE
  v_rev text := '3bce9462e4aad97faab772c73bdcd0a6d7440ca3';
BEGIN
  -- 1. Record the exact deployed revision as the certified runtime revision.
  UPDATE public.omni_comms_runtime_certification
     SET certification_state         = 'certified',
         certified_commit            = v_rev,
         observed_runtime_revision   = v_rev,
         observed_dispatcher_revision= v_rev,
         observed_at                 = now(),
         certified_at                = now(),
         workflow_run_id             = 'wave4-final-runtime-certification:' || v_rev,
         updated_at                  = now()
   WHERE singleton;

  -- 2. Governed re-approval: pilot channels approved against that revision only.
  UPDATE public.omni_comms_channel_release_control
     SET approved_commit    = v_rev,
         release_expires_at = now() + interval '6 days',
         approved_at        = now(),
         approval_note      = 'Wave 4 final runtime re-approval against deployed revision ' || v_rev,
         updated_at         = now()
   WHERE channel::text IN ('email','in_app')
     AND release_state::text = 'controlled_pilot';

  -- 3. Open controlled TEST dispatch from now (no retroactive release).
  PERFORM public.omni_comms_priv_set_dispatch_certified_from(
    v_rev,
    'xynceskeiiisiefqlgxo',
    'Wave 4 controlled TEST activation; certification-safe adapters only.'
  );
END $$;