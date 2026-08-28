DO $$
DECLARE
  v_maker uuid := '62c928c3-cd5e-421f-a010-50f9123fff70';
  v_checker uuid := '08655ffc-6bb2-4eea-bc5b-502c52cdcf85';
  v_rev text := '03fcd61c75a933ebf3e750d52d925c34b1efea81';
  r record;
  v_updated timestamptz;
  v_fp text;
  v_state text;
BEGIN
  PERFORM set_config('omni_comms.dispatch_worker','on', true);

  -- Park stale email work that predates the current release snapshot.
  UPDATE public.omni_comms_message m
     SET status = 'cancelled'
   FROM public.omni_comms_dispatch_job j
   WHERE j.message_id = m.id
     AND j.channel = 'email'
     AND j.status IN ('ready','held')
     AND j.created_at < now() - interval '10 minutes'
     AND m.status IN ('held','queued','rendered');

  UPDATE public.omni_comms_dispatch_job
     SET status = 'cancelled', is_runnable = false, completed_at = now(),
         hold_reason = 'superseded_release_snapshot'
   WHERE channel = 'email'
     AND status IN ('ready','held')
     AND created_at < now() - interval '10 minutes';

  FOR r IN SELECT id, channel FROM public.omni_comms_channel_release_control
            WHERE channel = 'email'
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_maker, 'role', 'authenticated')::text, true);

    SELECT updated_at, release_state INTO v_updated, v_state
      FROM public.omni_comms_channel_release_control WHERE id = r.id;
    IF v_state <> 'suspended' THEN
      PERFORM public.omni_comms_channel_release_control_suspend(
        r.id, v_updated, 'Re-approval cycle after stale-snapshot auto-suspend', 'reapprove:' || left(v_rev, 8));
    END IF;

    SELECT updated_at INTO v_updated FROM public.omni_comms_channel_release_control WHERE id = r.id;
    PERFORM public.omni_comms_channel_release_control_propose_pilot(
      r.id, v_updated, 'Controlled pilot re-proposal after stale-snapshot auto-suspend', 'reapprove:' || left(v_rev, 8));

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
    SELECT updated_at, release_fingerprint INTO v_updated, v_fp
      FROM public.omni_comms_channel_release_control WHERE id = r.id;

    PERFORM public.omni_comms_priv_channel_release_approve_activate(
      v_checker, r.id, v_updated, v_fp, v_rev,
      'Re-approved for controlled Internal Audit email certification after stale jobs were parked.',
      'reapprove-stale:' || left(v_rev, 8) || ':' || r.channel);
  END LOOP;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;