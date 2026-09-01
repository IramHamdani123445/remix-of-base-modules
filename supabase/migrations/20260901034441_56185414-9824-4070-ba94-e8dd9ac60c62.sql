
-- 1. Reference / label configuration for notices
CREATE TABLE IF NOT EXISTS public.ce_notice_ref (
  domain text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  group_code text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  numeric_value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, code)
);

GRANT SELECT ON public.ce_notice_ref TO authenticated;
GRANT ALL ON public.ce_notice_ref TO service_role;
ALTER TABLE public.ce_notice_ref ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ce_notice_ref_read ON public.ce_notice_ref;
CREATE POLICY ce_notice_ref_read ON public.ce_notice_ref FOR SELECT TO authenticated USING (true);

INSERT INTO public.ce_notice_ref (domain, code, label, group_code, display_order) VALUES
  ('STATUS','DRAFT','Draft','OPEN',10),
  ('STATUS','PENDING_APPROVAL','Pending Approval','OPEN',20),
  ('STATUS','APPROVED','Approved','OPEN',30),
  ('STATUS','REJECTED','Rejected','CLOSED',35),
  ('STATUS','SENT','Sent','ISSUED',40),
  ('STATUS','DELIVERED','Delivered','ISSUED',50),
  ('STATUS','ACKNOWLEDGED','Acknowledged','ISSUED',60),
  ('STATUS','FAILED','Delivery Failed','EXCEPTION',70),
  ('STATUS','CANCELLED','Cancelled','CLOSED',80),
  ('STATUS','WITHDRAWN','Withdrawn','CLOSED',85),
  ('STATUS','SUPERSEDED','Superseded','CLOSED',90),
  ('DELIVERY','PENDING','Not Yet Dispatched',NULL,10),
  ('DELIVERY','SENT','Dispatched',NULL,20),
  ('DELIVERY','DELIVERED','Delivered',NULL,30),
  ('DELIVERY','FAILED','Failed',NULL,40),
  ('RESPONSE','NOT_REQUIRED','No Response Required',NULL,10),
  ('RESPONSE','AWAITING','Awaiting Response',NULL,20),
  ('RESPONSE','OVERDUE','Response Overdue',NULL,30),
  ('RESPONSE','RECEIVED','Response Received',NULL,40),
  ('METHOD','EMAIL','Email',NULL,10),
  ('METHOD','SMS','SMS',NULL,20),
  ('METHOD','POST','Postal',NULL,30),
  ('METHOD','HAND','Hand Delivery',NULL,40),
  ('METHOD','PORTAL','Employer Portal',NULL,50),
  ('METHOD','PRINT','Print',NULL,60),
  ('TYPE','LATE_C3','Late C3 Filing','ROUTINE',10),
  ('TYPE','C3_NOT_SUBMITTED','C3 Not Submitted','ROUTINE',20),
  ('TYPE','PAYMENT_NOT_RECEIVED','Payment Not Received','ROUTINE',30),
  ('TYPE','WARNING','Warning Notice','WARNING',40),
  ('TYPE','DEMAND','Demand Notice','DEMAND',50),
  ('TYPE','FINAL_WARNING','Final Warning','FINAL',60),
  ('TYPE','LEGAL_WARNING','Legal Warning','FINAL',70),
  ('THRESHOLD','APPROVAL_AGEING_DAYS','Pending approval ageing (days)',NULL,10),
  ('THRESHOLD','APPROVED_NOT_SENT_DAYS','Approved but not sent (days)',NULL,20),
  ('THRESHOLD','DUE_SOON_DAYS','Response due soon (days)',NULL,30)
ON CONFLICT (domain, code) DO NOTHING;

UPDATE public.ce_notice_ref SET numeric_value = 3 WHERE domain='THRESHOLD' AND code='APPROVAL_AGEING_DAYS' AND numeric_value IS NULL;
UPDATE public.ce_notice_ref SET numeric_value = 2 WHERE domain='THRESHOLD' AND code='APPROVED_NOT_SENT_DAYS' AND numeric_value IS NULL;
UPDATE public.ce_notice_ref SET numeric_value = 3 WHERE domain='THRESHOLD' AND code='DUE_SOON_DAYS' AND numeric_value IS NULL;

-- Absorb any notice types already in use / configured on templates
INSERT INTO public.ce_notice_ref (domain, code, label, group_code, display_order)
SELECT DISTINCT 'TYPE', n.notice_type,
       initcap(replace(lower(n.notice_type), '_', ' ')), 'OTHER', 500
FROM public.ce_notices n
WHERE NULLIF(btrim(COALESCE(n.notice_type,'')),'') IS NOT NULL
ON CONFLICT (domain, code) DO NOTHING;

INSERT INTO public.ce_notice_ref (domain, code, label, group_code, display_order)
SELECT DISTINCT 'TYPE', t.category,
       initcap(replace(lower(t.category), '_', ' ')), 'TEMPLATE', 600
FROM public.ce_notice_templates t
WHERE NULLIF(btrim(COALESCE(t.category,'')),'') IS NOT NULL
ON CONFLICT (domain, code) DO NOTHING;

-- 2. Collision-safe server-side notice numbering
CREATE TABLE IF NOT EXISTS public.ce_notice_number_seq (
  year integer PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_notice_number_seq TO authenticated;
GRANT ALL ON public.ce_notice_number_seq TO service_role;
ALTER TABLE public.ce_notice_number_seq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ce_notice_number_seq_read ON public.ce_notice_number_seq;
CREATE POLICY ce_notice_number_seq_read ON public.ce_notice_number_seq FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.ce_notice_allocate_number_v1()
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::int;
  v_next bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  INSERT INTO public.ce_notice_number_seq(year, last_value)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_value = public.ce_notice_number_seq.last_value + 1,
        updated_at = now()
  RETURNING last_value INTO v_next;

  RETURN 'CN-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_notice_allocate_number_v1() TO authenticated;

-- Seed the sequence past any existing CN-YYYY-NNNNNN numbers so we never collide
INSERT INTO public.ce_notice_number_seq(year, last_value)
SELECT y, mx FROM (
  SELECT substring(notice_number from 4 for 4)::int AS y,
         MAX(substring(notice_number from 9)::bigint) AS mx
  FROM public.ce_notices
  WHERE notice_number ~ '^CN-[0-9]{4}-[0-9]+$'
  GROUP BY 1
) q
ON CONFLICT (year) DO UPDATE
  SET last_value = GREATEST(public.ce_notice_number_seq.last_value, EXCLUDED.last_value);

-- 3. Consolidated register view (notice + case + violation + latest delivery + response state)
CREATE OR REPLACE VIEW public.ce_v_notice_register AS
SELECT
  n.id,
  n.notice_number,
  n.employer_id,
  n.employer_name,
  n.case_id,
  c.case_number,
  n.violation_id,
  v.violation_number,
  n.notice_type,
  COALESCE(rt.label, NULL) AS notice_type_label,
  COALESCE(rt.group_code, 'OTHER') AS notice_type_group,
  n.status,
  rs.label AS status_label,
  COALESCE(rs.group_code, 'OPEN') AS status_group,
  n.subject,
  n.delivery_method,
  rm.label AS delivery_method_label,
  n.created_at,
  n.created_by,
  n.sent_at,
  n.delivered_at,
  n.acknowledged_at,
  n.due_response_date,
  n.response_received,
  n.response_date,
  n.template_id,
  t.template_code,
  t.template_name,
  n.dms_document_ref,
  n.stage_code,
  d.attempt_number AS delivery_attempts,
  d.channel AS last_delivery_channel,
  d.sent_at AS last_attempt_at,
  d.delivered_at AS last_delivered_at,
  d.failure_reason AS delivery_failure_reason,
  CASE
    WHEN d.status = 'DELIVERED' OR n.delivered_at IS NOT NULL THEN 'DELIVERED'
    WHEN d.status = 'FAILED' OR n.status = 'FAILED' THEN 'FAILED'
    WHEN d.status IS NOT NULL OR n.sent_at IS NOT NULL THEN 'SENT'
    ELSE 'PENDING'
  END AS delivery_status,
  resp.response_count,
  resp.last_response_date,
  CASE
    WHEN COALESCE(resp.response_count, 0) > 0 OR n.response_received IS TRUE THEN 'RECEIVED'
    WHEN n.due_response_date IS NULL THEN 'NOT_REQUIRED'
    WHEN n.status IN ('DRAFT','PENDING_APPROVAL','APPROVED','CANCELLED','WITHDRAWN','SUPERSEDED','REJECTED') THEN 'NOT_REQUIRED'
    WHEN n.due_response_date < CURRENT_DATE THEN 'OVERDUE'
    ELSE 'AWAITING'
  END AS response_state
FROM public.ce_notices n
LEFT JOIN public.ce_cases c ON c.id = n.case_id
LEFT JOIN public.ce_violations v ON v.id = n.violation_id
LEFT JOIN public.ce_notice_templates t ON t.id = n.template_id
LEFT JOIN public.ce_notice_ref rt ON rt.domain = 'TYPE' AND rt.code = n.notice_type
LEFT JOIN public.ce_notice_ref rs ON rs.domain = 'STATUS' AND rs.code = n.status
LEFT JOIN public.ce_notice_ref rm ON rm.domain = 'METHOD' AND rm.code = upper(COALESCE(n.delivery_method,''))
LEFT JOIN LATERAL (
  SELECT l.status, l.channel, l.sent_at, l.delivered_at, l.failure_reason, l.attempt_number
  FROM public.ce_notice_delivery_log l
  WHERE l.notice_id = n.id
  ORDER BY l.attempt_number DESC, l.created_at DESC
  LIMIT 1
) d ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS response_count, max(r.response_date) AS last_response_date
  FROM public.ce_notice_responses r WHERE r.notice_id = n.id
) resp ON true;

GRANT SELECT ON public.ce_v_notice_register TO authenticated;
GRANT SELECT ON public.ce_v_notice_register TO service_role;

CREATE INDEX IF NOT EXISTS idx_ce_notices_created_at ON public.ce_notices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_notices_status ON public.ce_notices(status);
CREATE INDEX IF NOT EXISTS idx_ce_notices_employer ON public.ce_notices(employer_id);
CREATE INDEX IF NOT EXISTS idx_ce_notice_delivery_log_notice ON public.ce_notice_delivery_log(notice_id, attempt_number DESC);
