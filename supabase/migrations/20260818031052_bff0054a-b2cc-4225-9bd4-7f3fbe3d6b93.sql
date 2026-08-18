
UPDATE public.omni_comms_template_family tf
   SET communication_action_id = a.id
  FROM public.omni_comms_communication_action a
 WHERE tf.communication_action_id IS NULL
   AND a.organization_id = tf.organization_id
   AND a.code = CASE WHEN upper(regexp_replace(tf.code, '[^A-Za-z0-9_]', '_', 'g')) ~ '^[A-Z]'
                     THEN left(upper(regexp_replace(tf.code, '[^A-Za-z0-9_]', '_', 'g')), 70)
                     ELSE left('A_' || upper(regexp_replace(tf.code, '[^A-Za-z0-9_]', '_', 'g')), 70)
                END;
