CREATE OR REPLACE FUNCTION public.trg_ia_action_status_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trigger_config record;
  v_event_code text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_code := 'ACTION_ASSIGNED';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    CASE NEW.status
      WHEN 'Completed' THEN v_event_code := 'ACTION_COMPLETED';
      WHEN 'Overdue' THEN v_event_code := 'ACTION_OVERDUE';
      ELSE v_event_code := NULL;
    END CASE;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_event_code IS NOT NULL THEN
    SELECT * INTO v_trigger_config FROM ia_notification_triggers
     WHERE event_code = v_event_code AND is_enabled = true LIMIT 1;

    IF FOUND AND v_trigger_config.auto_fire THEN
      IF NEW.responsible_person IS NOT NULL THEN
        -- IA-W2-D04: responsible_person is a person's NAME, not a user id.
        INSERT INTO ia_auto_notification_log (
          event_code, engagement_id, entity_type, entity_id,
          recipient_name, subject, channel, delivery_status)
        VALUES (
          v_event_code, NEW.engagement_id, 'action', NEW.id,
          NEW.responsible_person,
          v_event_code || ': ' || COALESCE(NEW.action_description, NEW.id::text),
          'in_app', 'Queued');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;