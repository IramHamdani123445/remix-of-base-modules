
CREATE TABLE public.ce_detection_event_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code text NOT NULL UNIQUE,
  description text,
  target_job_code text NOT NULL DEFAULT 'JOB-VIOLATION-SCAN',
  qualifying_statuses text[] NOT NULL DEFAULT ARRAY['P','A','V'],
  is_enabled boolean NOT NULL DEFAULT true,
  debounce_minutes integer NOT NULL DEFAULT 10,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ce_detection_event_triggers TO authenticated;
GRANT ALL ON public.ce_detection_event_triggers TO service_role;

CREATE TABLE public.ce_detection_event_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code text NOT NULL,
  employer_id text NOT NULL,
  source_table text NOT NULL DEFAULT 'er_master',
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  detection_run_id uuid,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ce_detection_event_queue_pending
  ON public.ce_detection_event_queue (status, requested_at);
CREATE INDEX idx_ce_detection_event_queue_employer
  ON public.ce_detection_event_queue (employer_id, event_code, requested_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ce_detection_event_queue TO authenticated;
GRANT ALL ON public.ce_detection_event_queue TO service_role;

INSERT INTO public.ce_detection_event_triggers (event_code, description, target_job_code, qualifying_statuses, is_enabled, debounce_minutes)
VALUES (
  'EMPLOYER_REGISTERED',
  'Employer registration completed / employer entered an obligated status — run compliance violation detection for that employer.',
  'JOB-VIOLATION-SCAN',
  ARRAY['P','A','V'],
  true,
  10
);

CREATE OR REPLACE FUNCTION public.fn_ce_enqueue_employer_detection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.ce_detection_event_triggers%ROWTYPE;
  v_recent integer;
BEGIN
  SELECT * INTO v_cfg
  FROM public.ce_detection_event_triggers
  WHERE event_code = 'EMPLOYER_REGISTERED' AND is_enabled = true;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.regno IS NULL OR NEW.regno = '' THEN
    RETURN NEW;
  END IF;

  -- Only obligated statuses qualify, and only on entry into one of them.
  IF NEW.status IS NULL OR NOT (TRIM(NEW.status::text) = ANY (v_cfg.qualifying_statuses)) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT NULL
     AND TRIM(OLD.status::text) = ANY (v_cfg.qualifying_statuses)
     AND TRIM(OLD.status::text) = TRIM(NEW.status::text)
     AND OLD.regno = NEW.regno THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.ce_detection_event_queue q
  WHERE q.employer_id = NEW.regno
    AND q.event_code = v_cfg.event_code
    AND (q.status = 'PENDING'
         OR q.requested_at > now() - make_interval(mins => GREATEST(v_cfg.debounce_minutes, 0)));

  IF v_recent > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ce_detection_event_queue (event_code, employer_id, source_table, status)
  VALUES (v_cfg.event_code, NEW.regno, TG_TABLE_NAME, 'PENDING');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Detection enqueue must never block employer registration.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_enqueue_employer_detection ON public.er_master;
CREATE TRIGGER trg_ce_enqueue_employer_detection
AFTER INSERT OR UPDATE OF status, regno ON public.er_master
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_enqueue_employer_detection();

CREATE OR REPLACE FUNCTION public.ce_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_ce_detection_event_triggers_updated
BEFORE UPDATE ON public.ce_detection_event_triggers
FOR EACH ROW EXECUTE FUNCTION public.ce_touch_updated_at();

CREATE TRIGGER trg_ce_detection_event_queue_updated
BEFORE UPDATE ON public.ce_detection_event_queue
FOR EACH ROW EXECUTE FUNCTION public.ce_touch_updated_at();
