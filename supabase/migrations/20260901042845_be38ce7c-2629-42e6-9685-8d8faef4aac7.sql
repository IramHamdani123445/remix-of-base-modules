-- ============================================================
-- 1. Canonical breach reference / configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_breach_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  tone text,
  numeric_value numeric,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, code)
);

GRANT SELECT ON public.ce_breach_ref TO authenticated;
GRANT ALL ON public.ce_breach_ref TO service_role;
ALTER TABLE public.ce_breach_ref ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_breach_ref_read" ON public.ce_breach_ref;
CREATE POLICY "ce_breach_ref_read" ON public.ce_breach_ref
  FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_ce_breach_ref_updated_at ON public.ce_breach_ref;
CREATE TRIGGER trg_ce_breach_ref_updated_at BEFORE UPDATE ON public.ce_breach_ref
  FOR EACH ROW EXECUTE FUNCTION public.ce_update_updated_at();

INSERT INTO public.ce_breach_ref (domain, code, label, description, tone, numeric_value, sort_order) VALUES
  ('BREACH_TYPE','MISSED_INSTALLMENT','Missed Installment','Installment unpaid beyond the configured grace period','destructive',NULL,10),
  ('BREACH_TYPE','PARTIAL_PAYMENT','Partial Payment / Shortfall','Installment part-paid beyond the configured grace period','warning',NULL,20),
  ('BREACH_TYPE','REPEATED_MISS','Repeated Miss','Missed installments at or beyond the configured threshold','destructive',NULL,30),
  ('BREACH_TYPE','ARRANGEMENT_DEFAULT','Arrangement Default','Arrangement transitioned to defaulted under the configured policy','destructive',NULL,40),

  ('BREACH_STATUS','OPEN','Open','Detected and awaiting compliance action','destructive',NULL,10),
  ('BREACH_STATUS','UNDER_REVIEW','Under Review','Assigned officer is investigating or engaging the employer','warning',NULL,20),
  ('BREACH_STATUS','RESOLVED','Resolved','Breach cured or resolved with recorded justification','success',NULL,30),
  ('BREACH_STATUS','CLOSED','Closed','Closed without cure (superseded, defaulted or written off)','muted',NULL,40),

  ('ESCALATION_STATUS','NONE','No escalation','No downstream enforcement raised','muted',NULL,10),
  ('ESCALATION_STATUS','CASE','Compliance Case','Tracked under a compliance case','default',NULL,20),
  ('ESCALATION_STATUS','VIOLATION','Violation raised','A violation records the arrangement default','warning',NULL,30),
  ('ESCALATION_STATUS','LEGAL_RECOMMENDED','Legal recommended','Legal recommendation raised, awaiting approval','warning',NULL,40),
  ('ESCALATION_STATUS','LEGAL_REFERRED','Legal referred','Referral handed to Legal','destructive',NULL,50),

  ('RESOLUTION_TYPE','PAYMENT_ALLOCATED','Payment allocated','Installment settled by an allocated payment',NULL,NULL,10),
  ('RESOLUTION_TYPE','CATCH_UP_AGREED','Catch-up agreed','Employer agreed and evidenced a catch-up schedule',NULL,NULL,20),
  ('RESOLUTION_TYPE','ARRANGEMENT_REVISED','Arrangement revised','Superseded by a revised arrangement',NULL,NULL,30),
  ('RESOLUTION_TYPE','DETECTION_ERROR','Detection error','Breach raised in error and withdrawn',NULL,NULL,40),
  ('RESOLUTION_TYPE','MANAGEMENT_WAIVED','Management waiver','Resolved by approved management decision',NULL,NULL,50),

  ('DETECTION_METHOD','AUTOMATIC','Automatic','Raised by the scheduled breach detection job',NULL,NULL,10),
  ('DETECTION_METHOD','MANUAL','Manual','Recorded manually by a compliance officer',NULL,NULL,20),

  ('SEVERITY','MINOR','Minor',NULL,'muted',NULL,10),
  ('SEVERITY','STANDARD','Standard',NULL,'warning',NULL,20),
  ('SEVERITY','MAJOR','Major',NULL,'warning',NULL,30),
  ('SEVERITY','CRITICAL','Critical',NULL,'destructive',NULL,40),

  ('THRESHOLD','RESPONSE_SLA_DAYS','Response interval (days)','Open breach must have recorded action within this many days',NULL,5,10),
  ('THRESHOLD','HIGH_VALUE_SHORTFALL','High-value shortfall','Shortfall at or above this amount is treated as high exposure',NULL,10000,20),
  ('THRESHOLD','SEVERITY_MAJOR_OFFSET','Major severity offset','Misses at threshold + this value are Major',NULL,1,30),
  ('THRESHOLD','SEVERITY_CRITICAL_OFFSET','Critical severity offset','Misses at threshold + this value are Critical',NULL,2,40),
  ('THRESHOLD','NEW_BREACH_DAYS','New breach window (days)','Breaches detected within this window count as new',NULL,7,50)
ON CONFLICT (domain, code) DO NOTHING;

-- ============================================================
-- 2. Extend the canonical breach record
-- ============================================================
ALTER TABLE public.ce_arrangement_breaches
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS breach_status text,
  ADD COLUMN IF NOT EXISTS escalation_status text,
  ADD COLUMN IF NOT EXISTS case_id uuid,
  ADD COLUMN IF NOT EXISTS violation_id uuid,
  ADD COLUMN IF NOT EXISTS legal_referral_id uuid,
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by text,
  ADD COLUMN IF NOT EXISTS resolution_type text,
  ADD COLUMN IF NOT EXISTS resolution_reason text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS detection_rule text,
  ADD COLUMN IF NOT EXISTS detection_method text,
  ADD COLUMN IF NOT EXISTS consecutive_misses int,
  ADD COLUMN IF NOT EXISTS last_action_at timestamptz;

-- Backfill: legacy rows stored severity codes inside breach_type
UPDATE public.ce_arrangement_breaches
SET severity = CASE upper(COALESCE(breach_type,''))
                 WHEN 'CRITICAL' THEN 'CRITICAL'
                 WHEN 'MAJOR' THEN 'MAJOR'
                 WHEN 'MINOR' THEN 'MINOR'
                 WHEN 'STANDARD' THEN 'STANDARD'
                 ELSE severity END
WHERE severity IS NULL;

UPDATE public.ce_arrangement_breaches
SET breach_type = 'MISSED_INSTALLMENT'
WHERE upper(COALESCE(breach_type,'')) IN ('CRITICAL','MAJOR','MINOR','STANDARD');

UPDATE public.ce_arrangement_breaches SET severity = 'STANDARD' WHERE severity IS NULL;

UPDATE public.ce_arrangement_breaches
SET breach_status = CASE WHEN COALESCE(resolution,'') <> '' THEN 'RESOLVED' ELSE 'OPEN' END
WHERE breach_status IS NULL;

UPDATE public.ce_arrangement_breaches
SET detection_method = CASE WHEN upper(COALESCE(detected_by,'')) IN ('SYSTEM','SCHEDULER','CRON','E2EFIX','JOB') THEN 'AUTOMATIC' ELSE 'MANUAL' END
WHERE detection_method IS NULL;

UPDATE public.ce_arrangement_breaches b
SET case_id = a.case_id
FROM public.ce_payment_arrangements a
WHERE a.id = b.arrangement_id AND b.case_id IS NULL AND a.case_id IS NOT NULL;

UPDATE public.ce_arrangement_breaches
SET escalation_status = CASE WHEN case_id IS NOT NULL THEN 'CASE' ELSE 'NONE' END
WHERE escalation_status IS NULL;

UPDATE public.ce_arrangement_breaches
SET resolution_type = CASE WHEN upper(COALESCE(resolution,'')) = 'CURED' THEN 'PAYMENT_ALLOCATED' ELSE resolution_type END
WHERE resolution IS NOT NULL AND resolution_type IS NULL;

-- Backfill idempotency keys for legacy arrangement-level rows
UPDATE public.ce_arrangement_breaches
SET occurrence_key = 'ARR:' || arrangement_id::text || ':LEGACY:' || id::text
WHERE occurrence_key IS NULL AND arrangement_id IS NOT NULL;

ALTER TABLE public.ce_arrangement_breaches
  ALTER COLUMN breach_status SET DEFAULT 'OPEN',
  ALTER COLUMN escalation_status SET DEFAULT 'NONE',
  ALTER COLUMN detection_method SET DEFAULT 'AUTOMATIC';

CREATE INDEX IF NOT EXISTS idx_ce_breaches_status ON public.ce_arrangement_breaches (breach_status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_breaches_case ON public.ce_arrangement_breaches (case_id);
CREATE INDEX IF NOT EXISTS idx_ce_breaches_assigned ON public.ce_arrangement_breaches (assigned_to);
CREATE INDEX IF NOT EXISTS idx_ce_breaches_detected_at ON public.ce_arrangement_breaches (detected_at DESC);

-- Keep breach_status coherent with the cure/resolution columns
CREATE OR REPLACE FUNCTION public.ce_breach_status_sync_trg()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.breach_status IS NULL THEN NEW.breach_status := 'OPEN'; END IF;
  IF NEW.escalation_status IS NULL THEN NEW.escalation_status := 'NONE'; END IF;
  IF NEW.detection_method IS NULL THEN NEW.detection_method := 'AUTOMATIC'; END IF;
  IF COALESCE(NEW.resolution,'') <> '' AND NEW.breach_status IN ('OPEN','UNDER_REVIEW') THEN
    NEW.breach_status := 'RESOLVED';
    NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  END IF;
  IF COALESCE(NEW.resolution,'') = '' AND NEW.breach_status = 'RESOLVED' THEN
    NEW.breach_status := 'OPEN';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ce_breach_status_sync ON public.ce_arrangement_breaches;
CREATE TRIGGER zz_ce_breach_status_sync BEFORE INSERT OR UPDATE ON public.ce_arrangement_breaches
  FOR EACH ROW EXECUTE FUNCTION public.ce_breach_status_sync_trg();

-- ============================================================
-- 3. Canonical detection: installment-level, idempotent, cure-aware
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_breach_detect_v1(
  p_actor text DEFAULT 'SYSTEM',
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grace int := public.ce_arrangement_grace_days();
  v_major int := COALESCE((SELECT numeric_value FROM public.ce_breach_ref WHERE domain='THRESHOLD' AND code='SEVERITY_MAJOR_OFFSET'),1);
  v_crit  int := COALESCE((SELECT numeric_value FROM public.ce_breach_ref WHERE domain='THRESHOLD' AND code='SEVERITY_CRITICAL_OFFSET'),2);
  a RECORD; r RECORD;
  v_key text; v_type text; v_sev text;
  v_overdue int; v_new int := 0; v_cured int := 0; v_defaulted int := 0;
  v_scanned int := 0; v_flagged int := 0; v_would int := 0;
  v_max_missed int; v_shortfall numeric;
BEGIN
  IF p_dry_run THEN
    SELECT count(*) INTO v_would
    FROM public.ce_installments i
    JOIN public.ce_payment_arrangements pa ON pa.id = i.arrangement_id
    WHERE pa.status = 'ACTIVE'
      AND i.due_date + v_grace < p_as_of_date
      AND COALESCE(i.paid_amount,0) < i.amount
      AND COALESCE(i.status,'PENDING') NOT IN ('PAID','CANCELLED','WAIVED');
    RETURN jsonb_build_object('dry_run',true,'as_of_date',p_as_of_date,'grace_days',v_grace,
                              'candidate_installments',v_would);
  END IF;

  FOR a IN SELECT * FROM public.ce_payment_arrangements WHERE status IN ('ACTIVE','BREACHED') LOOP
    v_scanned := v_scanned + 1;
    v_max_missed := GREATEST(COALESCE(a.max_missed_before_breach,2),1);
    v_overdue := 0;

    FOR r IN SELECT * FROM public.ce_installments WHERE arrangement_id = a.id ORDER BY installment_number LOOP
      IF r.due_date + v_grace < p_as_of_date
         AND COALESCE(r.paid_amount,0) < r.amount
         AND COALESCE(r.status,'PENDING') NOT IN ('PAID','CANCELLED','WAIVED') THEN

        v_overdue := v_overdue + 1;
        v_shortfall := r.amount - COALESCE(r.paid_amount,0);
        v_type := CASE WHEN COALESCE(r.paid_amount,0) > 0 THEN 'PARTIAL_PAYMENT' ELSE 'MISSED_INSTALLMENT' END;
        v_sev := CASE
                   WHEN v_overdue >= v_max_missed + v_crit THEN 'CRITICAL'
                   WHEN v_overdue >= v_max_missed + v_major THEN 'MAJOR'
                   WHEN v_overdue >= v_max_missed THEN 'STANDARD'
                   ELSE 'MINOR' END;

        UPDATE public.ce_installments
        SET status = CASE WHEN COALESCE(paid_amount,0) > 0 THEN 'PARTIAL' ELSE 'OVERDUE' END,
            is_overdue = true,
            overdue_days = GREATEST(0, p_as_of_date - due_date)
        WHERE id = r.id
          AND (is_overdue IS DISTINCT FROM true OR overdue_days IS DISTINCT FROM GREATEST(0, p_as_of_date - due_date));
        IF FOUND THEN v_flagged := v_flagged + 1; END IF;

        -- Idempotency: one breach per arrangement + installment + event type
        v_key := 'ARR:' || a.id::text || ':INST:' || r.id::text || ':' || v_type;

        INSERT INTO public.ce_arrangement_breaches (
          arrangement_id, breach_type, severity, description, detected_at, detected_by, created_by,
          installment_id, installment_number, due_date_at_breach,
          amount_outstanding_at_breach, grace_days_at_breach, occurrence_key,
          breach_status, escalation_status, detection_method, detection_rule,
          case_id, consecutive_misses
        ) VALUES (
          a.id, v_type, v_sev,
          format('Installment %s due %s: %s of %s unpaid beyond %s grace day(s)',
                 r.installment_number, r.due_date,
                 trim(to_char(v_shortfall,'999,999,990.00')),
                 trim(to_char(r.amount,'999,999,990.00')), v_grace),
          now(), p_actor, p_actor,
          r.id, r.installment_number, r.due_date, v_shortfall, v_grace, v_key,
          'OPEN', CASE WHEN a.case_id IS NOT NULL THEN 'CASE' ELSE 'NONE' END,
          CASE WHEN p_actor IN ('SYSTEM','SCHEDULER','CRON') THEN 'AUTOMATIC' ELSE 'MANUAL' END,
          'CE-BREACH-DETECT-V1', a.case_id, v_overdue
        )
        ON CONFLICT (occurrence_key) WHERE occurrence_key IS NOT NULL DO UPDATE
          SET amount_outstanding_at_breach = EXCLUDED.amount_outstanding_at_breach,
              consecutive_misses = EXCLUDED.consecutive_misses,
              severity = CASE WHEN public.ce_arrangement_breaches.breach_status IN ('OPEN','UNDER_REVIEW')
                              THEN EXCLUDED.severity ELSE public.ce_arrangement_breaches.severity END,
              updated_at = now();

        IF (SELECT created_at = updated_at FROM public.ce_arrangement_breaches WHERE occurrence_key = v_key) THEN
          v_new := v_new + 1;
          INSERT INTO public.ce_audit_log (entity_type, entity_id, action, description, new_values, performed_by, performed_at)
          VALUES ('ARRANGEMENT_BREACH', a.id, 'BREACH_DETECTED',
                  format('Breach detected on %s installment %s', a.arrangement_number, r.installment_number),
                  jsonb_build_object('occurrence_key', v_key, 'shortfall', v_shortfall,
                                     'breach_type', v_type, 'severity', v_sev, 'grace_days', v_grace),
                  p_actor, now());
        END IF;
      END IF;
    END LOOP;

    -- Arrangement-level breach flag
    IF v_overdue >= v_max_missed THEN
      UPDATE public.ce_payment_arrangements
      SET breach_detected = true,
          breach_date = COALESCE(breach_date, p_as_of_date),
          breach_reason = format('%s overdue installment(s) (threshold %s)', v_overdue, v_max_missed),
          missed_payments = v_overdue, updated_by = p_actor, updated_at = now()
      WHERE id = a.id;
    ELSE
      UPDATE public.ce_payment_arrangements
      SET missed_payments = v_overdue, updated_by = p_actor, updated_at = now()
      WHERE id = a.id AND missed_payments IS DISTINCT FROM v_overdue;
    END IF;

    -- Distinct DEFAULT event (separate from an installment breach)
    IF v_overdue > v_max_missed AND a.status <> 'DEFAULTED' THEN
      UPDATE public.ce_payment_arrangements
      SET status = 'DEFAULTED',
          breach_reason = COALESCE(breach_reason,'') ||
            format(' | Defaulted on %s: %s missed payments exceed threshold %s.', p_as_of_date, v_overdue, v_max_missed),
          updated_by = p_actor, updated_at = now()
      WHERE id = a.id;

      INSERT INTO public.ce_arrangement_breaches (
        arrangement_id, breach_type, severity, description, detected_at, detected_by, created_by,
        occurrence_key, breach_status, escalation_status, detection_method, detection_rule,
        case_id, consecutive_misses, grace_days_at_breach
      ) VALUES (
        a.id, 'ARRANGEMENT_DEFAULT', 'CRITICAL',
        format('Arrangement defaulted: %s missed installment(s) exceed the configured threshold of %s',
               v_overdue, v_max_missed),
        now(), p_actor, p_actor,
        'ARR:' || a.id::text || ':ARRANGEMENT_DEFAULT',
        'OPEN', CASE WHEN a.case_id IS NOT NULL THEN 'CASE' ELSE 'NONE' END,
        CASE WHEN p_actor IN ('SYSTEM','SCHEDULER','CRON') THEN 'AUTOMATIC' ELSE 'MANUAL' END,
        'CE-BREACH-DETECT-V1', a.case_id, v_overdue, v_grace
      )
      ON CONFLICT (occurrence_key) WHERE occurrence_key IS NOT NULL DO NOTHING;

      v_defaulted := v_defaulted + 1;

      INSERT INTO public.ce_audit_log (entity_type, entity_id, action, description, old_values, new_values, performed_by, performed_at)
      VALUES ('ARRANGEMENT', a.id, 'STATUS_CHANGE',
              format('Arrangement %s defaulted: %s missed payments', a.arrangement_number, v_overdue),
              jsonb_build_object('status', a.status),
              jsonb_build_object('status','DEFAULTED','missed_payments',v_overdue), p_actor, now());

      IF a.case_id IS NOT NULL THEN
        UPDATE public.ce_cases SET status = 'ESCALATED', updated_by = p_actor, updated_at = now()
        WHERE id = a.case_id AND COALESCE(is_deleted,false) = false AND status NOT IN ('CLOSED','ESCALATED');

        INSERT INTO public.ce_case_history (case_id, action, to_status, notes, performed_by, performed_at)
        VALUES (a.case_id, 'ARRANGEMENT_DEFAULTED', 'ESCALATED',
                format('Auto-escalated: arrangement %s defaulted with %s missed payments', a.arrangement_number, v_overdue),
                p_actor, now());
      END IF;
    END IF;
  END LOOP;

  -- Payment-driven cure: settled installment resolves its breach automatically
  WITH cured AS (
    UPDATE public.ce_arrangement_breaches b
    SET resolution = 'CURED',
        breach_status = 'RESOLVED',
        resolution_type = COALESCE(b.resolution_type,'PAYMENT_ALLOCATED'),
        resolution_reason = COALESCE(b.resolution_reason,'Installment settled — payment allocated'),
        payment_reference = COALESCE(b.payment_reference, i.payment_reference),
        resolved_at = now(), resolved_by = p_actor, updated_by = p_actor,
        resolution_notes = COALESCE(b.resolution_notes,'Installment settled after breach'),
        last_action_at = now()
    FROM public.ce_installments i
    WHERE i.id = b.installment_id
      AND b.breach_status IN ('OPEN','UNDER_REVIEW')
      AND (COALESCE(i.paid_amount,0) >= i.amount OR upper(COALESCE(i.status,'')) IN ('PAID','WAIVED','CANCELLED'))
    RETURNING b.id, b.arrangement_id, b.installment_number
  )
  SELECT count(*) INTO v_cured FROM cured;

  RETURN jsonb_build_object(
    'as_of_date', p_as_of_date,
    'grace_days', v_grace,
    'grace_days_source', 'ce_arrangement_policies',
    'arrangements_scanned', v_scanned,
    'installments_flagged_overdue', v_flagged,
    'breaches_created', v_new,
    'breaches_cured', v_cured,
    'arrangements_defaulted', v_defaulted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ce_breach_detect_v1(text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_breach_detect_v1(text, date, boolean) TO service_role;