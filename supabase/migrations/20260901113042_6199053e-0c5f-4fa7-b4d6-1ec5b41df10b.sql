CREATE OR REPLACE FUNCTION public.bn_notify_workbasket_arrival()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_basket        record;
  v_claim         record;
  v_benefit       text;
  v_step          text;
  v_tokens        jsonb;
  v_title         text;
  v_body          text;
  v_action        text;
  v_link          text;
  v_priority      text;
  v_actor         uuid := auth.uid();
BEGIN
  IF NEW.is_active IS DISTINCT FROM true OR NEW.completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT w.id, w.basket_code, w.basket_name, w.assigned_role,
           w.notify_title, w.notify_body, w.notify_action_label
      INTO v_basket
      FROM public.bn_workbasket w
     WHERE w.id = NEW.workbasket_id;

    IF v_basket.id IS NULL THEN RETURN NEW; END IF;

    SELECT c.id, c.claim_number, c.status, c.product_id
      INTO v_claim
      FROM public.bn_claim c
     WHERE c.id = NEW.claim_id;

    IF v_claim.id IS NULL THEN RETURN NEW; END IF;

    SELECT p.benefit_name INTO v_benefit
      FROM public.bn_product p
     WHERE p.id = v_claim.product_id;

    v_step := coalesce(v_claim.status, '');
    v_priority := CASE
      WHEN NEW.due_at IS NOT NULL AND NEW.due_at < now() THEN 'critical'
      WHEN coalesce(NEW.priority, 0) >= 8 THEN 'high'
      ELSE 'normal'
    END;

    v_tokens := jsonb_build_object(
      'claim_number', coalesce(v_claim.claim_number, ''),
      'benefit',      coalesce(v_benefit, 'Benefit claim'),
      'status',       coalesce(v_claim.status, ''),
      'step',         v_step,
      'basket_name',  coalesce(v_basket.basket_name, v_basket.basket_code),
      'basket_code',  coalesce(v_basket.basket_code, ''),
      'due_date',     coalesce(to_char(NEW.due_at, 'DD Mon YYYY'), ''),
      'priority',     v_priority
    );

    v_title := public.bn_render_workbasket_notification(nullif(v_basket.notify_title, ''), v_tokens);
    IF coalesce(v_title, '') = '' THEN
      v_title := 'Action required in ' || coalesce(v_basket.basket_name, v_basket.basket_code);
    END IF;

    v_body := public.bn_render_workbasket_notification(nullif(v_basket.notify_body, ''), v_tokens);
    IF coalesce(v_body, '') = '' THEN
      v_body := coalesce(v_claim.claim_number, 'Claim')
                || ' — ' || coalesce(v_benefit, 'Benefit claim')
                || ' · ' || coalesce(v_claim.status, '');
    END IF;
    IF NEW.due_at IS NOT NULL THEN
      v_body := v_body || ' · Due ' || to_char(NEW.due_at, 'DD Mon YYYY');
    END IF;

    v_action := nullif(coalesce(v_basket.notify_action_label, ''), '');
    IF v_action IS NULL THEN v_action := 'Open claim'; END IF;

    v_link := '/bn/claims/' || NEW.claim_id::text
              || '?basket=' || coalesce(v_basket.basket_code, '')
              || CASE WHEN v_step <> '' THEN '&step=' || v_step ELSE '' END;

    INSERT INTO public.in_app_notifications (
      user_id, title, body, link, action_label, module,
      notification_type, priority, source, related_record_id, metadata
    )
    SELECT DISTINCT ON (r.user_id)
      r.user_id,
      v_title,
      v_body,
      v_link,
      v_action,
      'BENEFITS',
      'BN_WORKBASKET_ARRIVAL',
      v_priority,
      'legacy',
      NEW.claim_id::text,
      jsonb_build_object(
        'assignment_id', NEW.id::text,
        'origin', 'benefits.workbasket',
        'claim_id', NEW.claim_id::text,
        'claim_number', v_claim.claim_number,
        'workbasket_id', v_basket.id::text,
        'basket_code', v_basket.basket_code,
        'basket_name', v_basket.basket_name,
        'status', v_claim.status,
        'step', v_step,
        'role_name', r.role_name,
        'severity', CASE WHEN v_priority = 'critical' THEN 'critical'
                         WHEN v_priority = 'high' THEN 'warning'
                         ELSE 'info' END
      )
    FROM (
      SELECT er.user_id, er.role_name
        FROM public.v_bn_user_effective_roles er
       WHERE er.role_name IN (
               SELECT wr.role_name
                 FROM public.bn_workbasket_role wr
                WHERE wr.workbasket_id = v_basket.id
               UNION
               SELECT v_basket.assigned_role
                WHERE NOT EXISTS (
                  SELECT 1 FROM public.bn_workbasket_role wr2
                   WHERE wr2.workbasket_id = v_basket.id
                )
                  AND v_basket.assigned_role IS NOT NULL
             )
         AND er.user_id IS NOT NULL
         AND (v_actor IS NULL OR er.user_id <> v_actor)
    ) r
    ORDER BY r.user_id, r.role_name
    ON CONFLICT DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[bn_notify_workbasket_arrival] skipped for assignment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bn_notify_workbasket_arrival() FROM PUBLIC, anon, authenticated;