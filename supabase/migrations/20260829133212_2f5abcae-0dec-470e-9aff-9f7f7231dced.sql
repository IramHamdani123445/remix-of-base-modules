CREATE OR REPLACE VIEW public.ce_v_employer_arrears_report
WITH (security_invoker = true) AS
WITH zone_pick AS (
  SELECT DISTINCT ON (v.employer_id)
         v.employer_id, v.zone_id
  FROM public.ce_violations v
  WHERE v.zone_id IS NOT NULL
  ORDER BY v.employer_id, v.updated_at DESC NULLS LAST
),
last_pay AS (
  SELECT ph.payer_id AS regno,
         MAX(COALESCE(p.payment_date, ph.date_received)) AS last_payment_date
  FROM public.cn_payment p
  JOIN public.cn_payment_header ph ON ph.payment_id = p.payment_id
  GROUP BY ph.payer_id
)
SELECT a.regno,
       a.employer_name,
       a.current_arrears,
       a.current_penalty,
       a.total_outstanding,
       a.has_arrears,
       COALESCE(z.zone_name, 'Unassigned') AS zone,
       lp.last_payment_date
FROM public.ce_v_employer_arrears_summary a
LEFT JOIN zone_pick zp ON zp.employer_id = a.regno::text
LEFT JOIN public.ce_zones z ON z.id = zp.zone_id
LEFT JOIN last_pay lp ON lp.regno::text = a.regno::text;

REVOKE ALL ON public.ce_v_employer_arrears_report FROM PUBLIC;
GRANT SELECT ON public.ce_v_employer_arrears_report TO authenticated;
GRANT SELECT ON public.ce_v_employer_arrears_report TO service_role;