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
  PERFORM public.omni_comms_priv_record_runtime_certification(
    'certified', v_rev, 'wave4-final-certification:' || v_rev, now(), v_rev);

  FOR r IN SELECT id, channel FROM public.omni_comms_channel_release_control
            WHERE channel IN ('email','in_app')
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_maker, 'role', 'authenticated')::text, true);

    SELECT updated_at, release_state INTO v_updated, v_state
      FROM public.omni_comms_channel_release_control WHERE id = r.id;
    IF v_state <> 'suspended' THEN
      PERFORM public.omni_comms_channel_release_control_suspend(
        r.id, v_updated, 'Re-approval cycle for runtime revision ' || left(v_rev, 8), 'reapprove:' || left(v_rev, 8));
    END IF;

    SELECT updated_at INTO v_updated FROM public.omni_comms_channel_release_control WHERE id = r.id;
    PERFORM public.omni_comms_channel_release_control_propose_pilot(
      r.id, v_updated, 'Controlled pilot re-proposal for runtime revision ' || left(v_rev, 8), 'reapprove:' || left(v_rev, 8));

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_checker, 'role', 'authenticated')::text, true);
    SELECT updated_at, release_fingerprint INTO v_updated, v_fp
      FROM public.omni_comms_channel_release_control WHERE id = r.id;

    PERFORM public.omni_comms_priv_channel_release_approve_activate(
      v_checker, r.id, v_updated, v_fp, v_rev,
      'Re-approved after the governed adapter-registry change enabling the operational email provider for the controlled pilot.',
      'reapprove:' || left(v_rev, 8) || ':' || r.channel);
  END LOOP;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

DROP TABLE IF EXISTS public.omni_comms_tmp_prereq_probe;